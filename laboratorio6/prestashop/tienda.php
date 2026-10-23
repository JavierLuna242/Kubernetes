<?php
// Catálogo e identidad de "Café Altura · Tienda": pesos colombianos, catálogo de café en lugar de la ropa de
// demostración, logo propio y sin los bloques de ejemplo. Lo ejecuta instalar-tienda.sh como www-data.
// Al repetirlo se rehace el catálogo inicial (borra los productos y categorías que haya).

require '/var/www/html/config/config.inc.php';

$D = '/tmp/tienda';
$idiomas = array_column(Language::getLanguages(false), 'id_lang');
$t = fn (string $texto) => array_fill_keys($idiomas, $texto);
$inicio = (int) Configuration::get('PS_HOME_CATEGORY');

// --- Identidad: nombre, ciudad, logo. El correo de la tienda no se muestra en el pie. ---
Configuration::updateValue('PS_SHOP_NAME', 'Café Altura · Tienda');
Configuration::updateValue('PS_SHOP_CITY', 'Bucaramanga');
Configuration::updateValue('PS_SHOP_COUNTRY_ID', (int) Country::getByIso('CO'));
Configuration::updateValue('PS_CONTACT_INFO_DISPLAY_EMAIL', 0);
// El nombre cambia con el contenido: Cloudflare guarda las imágenes en caché por su URL.
$logo = 'logo-cafe-altura-' . substr(md5_file("$D/logo.png"), 0, 8) . '.png';
copy("$D/logo.png", _PS_IMG_DIR_ . $logo);
Configuration::updateValue('PS_LOGO', $logo);

// --- Moneda: peso colombiano, sin decimales; las demás se desactivan. ---
$cop = (int) Currency::getIdByIsoCode('COP');
if (!$cop) {
    $moneda = new Currency();
    $moneda->iso_code = 'COP';
    $moneda->numeric_iso_code = '170';
    $moneda->precision = 0;
    $moneda->conversion_rate = 1;
    $moneda->active = 1;
    $moneda->name = $t('Peso colombiano');
    $moneda->symbol = $t('$');
    $moneda->add();
    $cop = (int) $moneda->id;
}
Configuration::updateValue('PS_CURRENCY_DEFAULT', $cop);
foreach (Currency::getCurrencies(false, false) as $c) {
    if ((int) $c['id_currency'] !== $cop) {
        $otra = new Currency((int) $c['id_currency']);
        $otra->active = 0;
        $otra->update();
    }
}

// --- Catálogo: fuera los productos y categorías de demostración. ---
foreach (Product::getProducts($idiomas[0], 0, 0, 'id_product', 'ASC') as $p) {
    (new Product((int) $p['id_product']))->delete();
}
foreach (Category::getCategories($idiomas[0], false, false) as $c) {
    $categoria = new Category((int) $c['id_category']);
    if ($categoria->id > $inicio && Validate::isLoadedObject($categoria)) {
        $categoria->delete(); // borra también sus subcategorías
    }
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

function imagen(int $producto, string $archivo): void
{
    $img = new Image();
    $img->id_product = $producto;
    $img->position = 1;
    $img->cover = 1;
    $img->add();
    $ruta = $img->getPathForCreation();
    ImageManager::resize($archivo, "$ruta.jpg");
    foreach (ImageType::getImagesTypes('products') as $tipo) {
        ImageManager::resize($archivo, $ruta . '-' . stripslashes($tipo['name']) . '.jpg', (int) $tipo['width'], (int) $tipo['height']);
    }
}

$cafe = categoria('Café', 'cafe', $t, $inicio);
$accesorios = categoria('Accesorios', 'accesorios', $t, $inicio);

$productos = [
    ['Café de Huila 250 g', 'cafe-huila', 'CA-HUI-250', 32000, $cafe,
        'Finca La Esperanza, Pitalito. Notas de panela, mandarina y chocolate. Tostión media, en grano o molido.'],
    ['Café de Nariño 250 g', 'cafe-narino', 'CA-NAR-250', 34000, $cafe,
        'Cultivado a más de 1.900 m en La Unión. Acidez brillante, notas de frutos rojos y caramelo.'],
    ['Café de Santander 250 g', 'cafe-santander', 'CA-SAN-250', 30000, $cafe,
        'De la Mesa de los Santos, cerca de la tienda. Cuerpo redondo, notas de cacao y nuez.'],
    ['Taza de cerámica Café Altura', 'taza', 'CA-TAZA', 45000, $accesorios,
        'Taza de cerámica esmaltada de 300 ml, hecha a mano en Ráquira. Apta para lavavajillas.'],
];
foreach ($productos as [$nombre, $url, $ref, $precio, $cat, $texto]) {
    $p = new Product();
    $p->name = $t($nombre);
    $p->link_rewrite = $t($url);
    $p->description_short = $t("<p>$texto</p>");
    $p->reference = $ref;
    $p->price = $precio;
    $p->id_tax_rules_group = 0;
    $p->id_category_default = $cat;
    $p->visibility = 'both';
    $p->active = 1;
    $p->add();
    $p->addToCategories([$inicio, $cat]); // en Inicio aparece en los destacados de la portada
    StockAvailable::setQuantity((int) $p->id, 0, 50);
    imagen((int) $p->id, "$D/$url.png");
}

// --- Portada y menú: sin carrusel ni bloques de ejemplo; el menú muestra las categorías nuevas. ---
foreach (['ps_imageslider', 'ps_banner', 'ps_customtext'] as $nombre) {
    $modulo = Module::getInstanceByName($nombre);
    if ($modulo && Module::isEnabled($nombre)) {
        $modulo->disable();
    }
}
Configuration::updateValue('MOD_BLOCKTOPMENU_ITEMS', "CAT$cafe,CAT$accesorios");

// --- Solo español: el instalador agrega inglés, y los títulos de dos bloques del pie quedan en inglés. ---
foreach (Language::getLanguages(false) as $l) {
    if ($l['iso_code'] !== 'es') {
        $idioma = new Language((int) $l['id_lang']);
        $idioma->active = 0;
        $idioma->update();
    }
}
$bloques = _DB_PREFIX_ . 'link_block_lang';
Db::getInstance()->execute("UPDATE `$bloques` SET name = 'Productos' WHERE name = 'Products'");
Db::getInstance()->execute("UPDATE `$bloques` SET name = 'Nuestra empresa' WHERE name = 'Our company'");

Tools::clearAllCache();
Media::clearCache(); // CSS/JS combinados: se regeneran con custom.css y con otro nombre (evita la caché de Cloudflare)
echo 'Tienda lista: ' . count($productos) . " productos, moneda COP\n";
