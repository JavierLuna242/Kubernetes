<?php
// Catálogo e identidad de "Café Altura · Tienda": pesos colombianos, catálogo de café en lugar de la ropa de
// demostración, logo propio, portada con foto y sin los bloques de ejemplo. Lo ejecuta instalar-tienda.sh como www-data.
// Al repetirlo se rehace el catálogo inicial (borra los productos, categorías y características que haya).

require '/var/www/html/config/config.inc.php';

$D = '/tmp/tienda'; // ConfigMap prestashop-tienda: instalacion/ y tema/ (logo, favicon, estilos)
$FOTOS = '/tmp/fotos'; // ConfigMap prestashop-fotos: fotos de Wikimedia Commons con la etiqueta de la tienda
$idiomas = array_column(Language::getLanguages(false), 'id_lang');
$es = (int) Language::getIdByIso('es');
$t = fn (string $texto) => array_fill_keys($idiomas, $texto);
$inicio = (int) Configuration::get('PS_HOME_CATEGORY');
$db = Db::getInstance();

// El nombre cambia con el contenido: Cloudflare guarda las imágenes en caché por su URL.
function publicar(string $archivo, string $carpeta, string $nombre): string
{
    $extension = pathinfo($archivo, PATHINFO_EXTENSION);
    $final = $nombre . '-' . substr(md5_file($archivo), 0, 8) . '.' . $extension;
    copy($archivo, _PS_IMG_DIR_ . $carpeta . $final);
    return $final;
}

// --- Identidad: nombre, ciudad, logo y favicon. El correo de la tienda no se muestra en el pie. ---
Configuration::updateValue('PS_SHOP_NAME', 'Café Altura · Tienda');
Configuration::updateValue('PS_SHOP_CITY', 'Bucaramanga');
Configuration::updateValue('PS_SHOP_COUNTRY_ID', (int) Country::getByIso('CO'));
Configuration::updateValue('PS_CONTACT_INFO_DISPLAY_EMAIL', 0);
Configuration::updateValue('PS_LOGO', publicar("$D/logo.png", '', 'logo-cafe-altura'));
copy("$D/favicon.ico", _PS_IMG_DIR_ . 'favicon.ico');
Configuration::updateValue('PS_IMG_UPDATE_TIME', time()); // va en la URL del favicon (?…): Cloudflare pide el nuevo

// --- Moneda: peso colombiano sin decimales, escrito como en Colombia ($ 32.000); las demás se desactivan. ---
$cop = (int) Currency::getIdByIsoCode('COP');
$moneda = new Currency($cop ?: null);
if (!$cop) {
    $moneda->iso_code = 'COP';
    $moneda->numeric_iso_code = '170';
    $moneda->conversion_rate = 1;
    $moneda->active = 1;
    $moneda->name = $t('Peso colombiano');
    $moneda->symbol = $t('$');
}
$moneda->precision = 0;
$moneda->pattern = $t('¤ #,##0.00'); // el español de España (es-ES) pondría "32.000 $"
$moneda->save();
$cop = (int) $moneda->id;
Configuration::updateValue('PS_CURRENCY_DEFAULT', $cop);
foreach (Currency::getCurrencies(false, false) as $c) {
    if ((int) $c['id_currency'] !== $cop) {
        $otra = new Currency((int) $c['id_currency']);
        $otra->active = 0;
        $otra->update();
    }
}

// --- Catálogo: fuera los productos, categorías y características de demostración. ---
foreach (Product::getProducts($es, 0, 0, 'id_product', 'ASC') as $p) {
    if ($p['reference'] !== 'LAB6-PRUEBA') { // el producto de la prueba de persistencia (evidencias) se conserva
        (new Product((int) $p['id_product']))->delete();
    }
}
foreach (Category::getCategories($es, false, false) as $c) {
    $categoria = new Category((int) $c['id_category']);
    if ($categoria->id > $inicio && Validate::isLoadedObject($categoria)) {
        $categoria->delete(); // borra también sus subcategorías
    }
}
foreach (Feature::getFeatures($es) as $f) {
    (new Feature((int) $f['id_feature']))->delete();
}
foreach (Manufacturer::getManufacturers() as $m) {
    (new Manufacturer((int) $m['id_manufacturer']))->delete(); // marcas de ropa de la demostración
}
foreach (Supplier::getSuppliers() as $s) {
    (new Supplier((int) $s['id_supplier']))->delete();
}
// Cliente de demostración (John DOE) y sus 5 pedidos de ejemplo: se borran en todas las tablas con id_order.
$demo = (int) Customer::customerExists('pub@prestashop.com', true);
if ($demo) {
    $pedidos = implode(',', array_map('intval', array_column(
        $db->executeS('SELECT id_order FROM ' . _DB_PREFIX_ . "orders WHERE id_customer = $demo"), 'id_order')) ?: [0]);
    $db->execute('DELETE t FROM ' . _DB_PREFIX_ . 'order_detail_tax t JOIN ' . _DB_PREFIX_
        . "order_detail d USING (id_order_detail) WHERE d.id_order IN ($pedidos)");
    $tablas = $db->executeS("SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_NAME = 'id_order' AND TABLE_NAME LIKE '" . _DB_PREFIX_ . "%'");
    foreach (array_column($tablas, 'TABLE_NAME') as $tabla) {
        $db->execute("DELETE FROM `$tabla` WHERE id_order IN ($pedidos)");
    }
    (new Customer($demo))->delete(); // también sus direcciones y carritos
}

function categoria(string $nombre, string $url, callable $t, int $padre): int
{
    $c = new Category();
    $c->name = $t($nombre);
    $c->link_rewrite = $t($url);
    $c->id_parent = $padre;
    $c->active = 1;
    $c->add();
    return (int) $c->id;
}

function imagen(int $producto, string $archivo, int $posicion): void
{
    $img = new Image();
    $img->id_product = $producto;
    $img->position = $posicion;
    $img->cover = $posicion === 1 ? 1 : null;
    $img->add();
    $ruta = $img->getPathForCreation();
    ImageManager::resize($archivo, "$ruta.jpg");
    foreach (ImageType::getImagesTypes('products') as $tipo) {
        ImageManager::resize($archivo, $ruta . '-' . stripslashes($tipo['name']) . '.jpg', (int) $tipo['width'], (int) $tipo['height']);
    }
}

// Ficha técnica del producto (pestaña "Detalles"): una característica por nombre, un valor propio por producto.
function caracteristica(int $producto, string $nombre, string $valor, callable $t): void
{
    static $ids = [];
    if (!isset($ids[$nombre])) {
        $f = new Feature();
        $f->name = $t($nombre);
        $f->add();
        $ids[$nombre] = (int) $f->id;
    }
    $v = new FeatureValue();
    $v->id_feature = $ids[$nombre];
    $v->value = $t($valor);
    $v->custom = 1;
    $v->add();
    Product::addFeatureProductImport($producto, $ids[$nombre], (int) $v->id);
}

$cafe = categoria('Café', 'cafe', $t, $inicio);
$accesorios = categoria('Accesorios', 'accesorios', $t, $inicio);
$despensa = categoria('Despensa', 'despensa', $t, $inicio);

// Fotos: [archivo en fotos/, crédito]. Las licencias CC BY piden nombrar al autor: va al final de la descripción.
$productos = [
    ['Café de Huila 250 g', 'cafe-huila', 'CA-HUI-250', 32000, $cafe,
        'Finca La Esperanza, Pitalito. Notas de panela, mandarina y chocolate. Tostión media, en grano o molido.',
        'El valle de Laboyos, al sur del Huila, da cafés dulces y balanceados. Este lote de la finca La Esperanza se seca al sol y lo tostamos cada semana en Bucaramanga.',
        ['Origen' => 'Pitalito, Huila', 'Altura' => '1.650 m s. n. m.', 'Variedad' => 'Caturra y Castillo', 'Proceso' => 'Lavado',
            'Tostión' => 'Media', 'Notas de cata' => 'Panela, mandarina, chocolate'],
        [['cafe-huila.jpg', 'MarkSweep (dominio público)'], ['cafe-huila-origen.jpg', 'Dhg94 (CC BY-SA 4.0)']]],
    ['Café de Nariño 250 g', 'cafe-narino', 'CA-NAR-250', 34000, $cafe,
        'Cultivado a más de 1.900 m en La Unión. Acidez brillante, notas de frutos rojos y caramelo.',
        'En las montañas de La Unión el café madura despacio, con días de sol y noches frías: por eso su acidez es brillante y su taza limpia. Ideal en método de filtro.',
        ['Origen' => 'La Unión, Nariño', 'Altura' => '1.900 m s. n. m.', 'Variedad' => 'Castillo', 'Proceso' => 'Lavado',
            'Tostión' => 'Media', 'Notas de cata' => 'Frutos rojos, caramelo'],
        [['cafe-narino.jpg', 'Jamain (CC BY-SA 4.0)'], ['cafe-narino-origen.jpg', 'Jefersonkardenas (CC BY-SA 3.0)']]],
    ['Café de Santander 250 g', 'cafe-santander', 'CA-SAN-250', 30000, $cafe,
        'De la Mesa de los Santos, cerca de la tienda. Cuerpo redondo, notas de cacao y nuez.',
        'La Mesa de los Santos queda a una hora de Bucaramanga, sobre el cañón del Chicamocha. Su café, con proceso honey, tiene cuerpo redondo y va muy bien con leche.',
        ['Origen' => 'Mesa de los Santos, Santander', 'Altura' => '1.600 m s. n. m.', 'Variedad' => 'Caturra', 'Proceso' => 'Honey',
            'Tostión' => 'Media-alta', 'Notas de cata' => 'Cacao, nuez'],
        [['cafe-santander.jpg', 'Daniel Ruswick (CC0)'], ['cafe-santander-origen.jpg', 'EEIM (CC BY-SA 4.0)']]],
    ['Taza de cerámica Café Altura', 'taza', 'CA-TAZA', 45000, $accesorios,
        'Taza de cerámica esmaltada de 300 ml, hecha a mano en Ráquira. Apta para lavavajillas.',
        'Cada taza la tornean y esmaltan artesanos de Ráquira, Boyacá, así que ninguna es igual a otra. Tamaño justo para un capuchino o un tinto doble.',
        ['Material' => 'Cerámica esmaltada', 'Capacidad' => '300 ml', 'Origen' => 'Ráquira, Boyacá', 'Cuidado' => 'Apta para lavavajillas'],
        [['taza.jpg', 'Edward (CC0)'], ['taza-servida.jpg', 'Janko Ferlic (CC0)']]],
    ['Granola de la casa 400 g', 'granola', 'CA-GRA-400', 22000, $despensa,
        'Avena tostada con miel, coco y almendras. Horneada en la cafetería.',
        'La misma granola que servimos en la cafetería con yogur y fruta. Sin conservantes: se hornea en pequeños lotes y se empaca en frasco.',
        ['Ingredientes' => 'Avena, miel, coco, almendras', 'Peso' => '400 g', 'Origen' => 'Horneada en Bucaramanga',
            'Conservación' => 'Lugar fresco y seco, 30 días'],
        [['granola.jpg', 'Shixart1985 (CC BY 2.0)'], ['granola-servida.jpg', 'T.Tseng (CC BY 2.0)']]],
];
foreach ($productos as [$nombre, $url, $ref, $precio, $cat, $corta, $larga, $ficha, $fotos]) {
    $creditos = implode(' y ', array_column($fotos, 1));
    $p = new Product();
    $p->name = $t($nombre);
    $p->link_rewrite = $t($url);
    $p->description_short = $t("<p>$corta</p>");
    $p->description = $t("<p>$larga</p><p><small>Fotos: $creditos, Wikimedia Commons. Etiqueta: Café Altura.</small></p>");
    $p->reference = $ref;
    $p->price = $precio;
    $p->id_tax_rules_group = 0;
    $p->id_category_default = $cat;
    $p->visibility = 'both';
    $p->active = 1;
    $p->add();
    $p->addToCategories([$inicio, $cat]); // en Inicio aparece en los destacados de la portada
    StockAvailable::setQuantity((int) $p->id, 0, 50);
    foreach ($fotos as $i => [$archivo]) {
        imagen((int) $p->id, "$FOTOS/$archivo", $i + 1);
    }
    foreach ($ficha as $rasgo => $valor) {
        caracteristica((int) $p->id, $rasgo, $valor, $t);
    }
}

// --- Portada: foto de un cafetal, invitación a comprar y franja de confianza (bloque de texto personalizado). ---
$portada = publicar("$FOTOS/portada-finca.webp", 'cms/', 'portada-finca');
$bienvenida = <<<HTML
<div class="ca-hero" style="background-image: url(/img/cms/$portada)">
  <div class="ca-hero__texto">
    <p class="ca-hero__antetitulo">Tostado cada semana en Bucaramanga</p>
    <h2>Café de origen colombiano, de la finca a tu taza</h2>
    <p>Granos de Huila, Nariño y Santander, comprados directo a las fincas y tostados en pequeños lotes.</p>
    <a class="btn btn-primary btn-lg" href="/$cafe-cafe">Ver los cafés</a>
    <a class="btn ca-hero__secundario btn-lg" href="https://wordpress.javier.life">Visita la cafetería</a>
  </div>
  <small class="ca-hero__credito">Foto: Paul from Hacketts Cove (CC BY 2.0), Wikimedia Commons</small>
</div>
<ul class="ca-confianza">
  <li><strong>Envíos en Bucaramanga</strong><span>De 24 a 48 horas</span></li>
  <li><strong>Café de origen</strong><span>Huila, Nariño y Santander</span></li>
  <li><strong>Tostión semanal</strong><span>Siempre fresco</span></li>
  <li><strong>Pago contra entrega</strong><span>O por transferencia</span></li>
</ul>
HTML;
$db->update('info_lang', ['text' => pSQL($bienvenida, true)], '1');

// ps_customtext queda primero en la portada (el carrusel está apagado); "Últimas novedades" repetía los destacados.
foreach (['ps_imageslider', 'ps_banner'] as $nombre) {
    $modulo = Module::getInstanceByName($nombre);
    if ($modulo && Module::isEnabled($nombre)) {
        $modulo->disable();
    }
}
Module::getInstanceByName('ps_customtext')->enable();
Module::getInstanceByName('ps_newproducts')->unregisterHook('displayHome');

// --- Menú: categorías y un enlace al sitio de la cafetería (WordPress). ---
require_once _PS_MODULE_DIR_ . 'ps_mainmenu/ps_menutoplinks.class.php';
$db->delete('linksmenutop_lang');
$db->delete('linksmenutop');
Ps_MenuTopLinks::add($t('https://wordpress.javier.life'), $t('La cafetería'), 0, (int) Configuration::get('PS_SHOP_DEFAULT'));
$enlace = (int) $db->getValue('SELECT MAX(id_linksmenutop) FROM ' . _DB_PREFIX_ . 'linksmenutop');
Configuration::updateValue('MOD_BLOCKTOPMENU_ITEMS', "CAT$cafe,CAT$accesorios,CAT$despensa,LNK$enlace");

// --- Solo español, y en tono cercano: el instalador agrega inglés y deja textos de España ("Contacte con nosotros"). ---
foreach (Language::getLanguages(false) as $l) {
    if ($l['iso_code'] !== 'es') {
        $idioma = new Language((int) $l['id_lang']);
        $idioma->active = 0;
        $idioma->update();
    }
}
$bloques = _DB_PREFIX_ . 'link_block_lang';
$db->execute("UPDATE `$bloques` SET name = 'Productos' WHERE name = 'Products'");
$db->execute("UPDATE `$bloques` SET name = 'Nuestra empresa' WHERE name = 'Our company'");
// Traducciones propias (Internacional > Traducciones en el panel): pisan las del paquete de idioma.
$textos = [
    'Contact us' => 'Contáctanos',
    'Get our latest news and special sales' => 'Recibe nuestras novedades y ofertas',
    '%copyright% %year% - Ecommerce software by %prestashop%' => '%copyright% %year% Café Altura · Tienda hecha con %prestashop%',
];
foreach ($textos as $original => $texto) {
    $db->delete('translation', "`key` = '" . pSQL($original) . "' AND domain = 'ShopThemeGlobal' AND id_lang = $es");
    $db->insert('translation', ['id_lang' => $es, 'key' => pSQL($original), 'translation' => pSQL($texto), 'domain' => 'ShopThemeGlobal']);
}
Configuration::updateValue('NW_CONDITIONS', $t('Un correo al mes, sin spam. Te puedes dar de baja cuando quieras.'), true);
$contacto = new Meta((int) Meta::getMetaByPage('contact', $es)['id_meta']);
$contacto->title[$es] = 'Contáctanos'; // enlace del pie
$contacto->update();
// Bloque de garantías de la ficha de producto: trae "Security policy (edit with the Customer Reassurance module)".
$garantias = [
    1 => ['Pago seguro', 'Contra entrega o por transferencia.'],
    2 => ['Envíos en Bucaramanga', 'Te llega en 24 a 48 horas.'],
    3 => ['Recién tostado', 'Tostamos cada semana, en pequeños lotes.'],
];
foreach ($garantias as $id => [$titulo, $detalle]) {
    $db->update('psreassurance_lang', ['title' => pSQL($titulo), 'description' => pSQL($detalle)], "id_psreassurance = $id");
}

Tools::clearAllCache();
Media::clearCache(); // CSS/JS combinados: se regeneran con custom.css y con otro nombre (evita la caché de Cloudflare)
echo 'Tienda lista: ' . count($productos) . " productos, moneda COP\n";
