#!/bin/sh
# Deja el sitio listo: instala WordPress (si la base está vacía), activa el tema y crea el contenido inicial.
# Se puede repetir sin problema. Uso:  kubectl exec -n wordpress deploy/wordpress -- configurar-sitio
# El contenido de las páginas (bloques de WordPress) está en /usr/local/share/sitio (carpeta contenido/).
set -e
# wp-cli corre como www-data, igual que Apache: lo que suba a la biblioteca de medios queda con el dueño correcto.
wp() { runuser -u www-data -- env WP_CLI_CACHE_DIR=/tmp/wp-cli wp --path=/var/www/html "$@"; }
C=/usr/local/share/sitio

if ! wp core is-installed; then
    # La contraseña del panel llega por stdin y no se guarda en el pod (ni en el entorno ni en un archivo):
    #   kubectl get secret -n wordpress wordpress -o jsonpath='{.data.admin-password}' | base64 -d |
    #     kubectl exec -i -n wordpress deploy/wordpress -- configurar-sitio
    IFS= read -r clave || true
    [ -n "$clave" ] || { echo "Falta la contraseña del panel por stdin (ver arriba)." >&2; exit 1; }
    wp core install --url="$WP_URL" --title="Café Altura" --admin_user=admin \
        --admin_email=admin@javier.life --skip-email --admin_password="$clave"
    unset clave
    wp option update WPLANG es_CO # el paquete de idioma viene en la imagen
    wp option update blogdescription "Café de origen y pastelería hecha en casa"
    wp option update timezone_string America/Bogota
    wp option update date_format "j \d\e F \d\e Y"
    wp option update default_comment_status closed
    wp post delete 1 2 3 --force # entrada, página y política de privacidad de ejemplo

    pagina() { wp post create "$C/$1.html" --post_type=page --post_status=publish --post_title="$2" --post_name="$1" --menu_order="$3" --porcelain; }
    inicio=$(pagina inicio Inicio 0)
    pagina carta Carta 1 >/dev/null
    pagina nosotros Nosotros 2 >/dev/null
    pagina visitanos Visítanos 4 >/dev/null
    novedades=$(wp post create --post_type=page --post_status=publish --post_title=Novedades --post_name=novedades --menu_order=3 --porcelain)
    wp option update show_on_front page
    wp option update page_on_front "$inicio"
    wp option update page_for_posts "$novedades"

    # Menú del encabezado: el bloque de navegación usa el menú publicado más reciente.
    enlace() { printf '<!-- wp:navigation-link {"label":"%s","url":"/%s/","kind":"custom","isTopLevelLink":true} /-->' "$1" "$2"; }
    wp post create --post_type=wp_navigation --post_status=publish --post_title="Menú principal" \
        --post_content="$(enlace Carta carta)$(enlace Nosotros nosotros)$(enlace Novedades novedades)$(enlace Visítanos visitanos)"

    wp term update category 1 --name=General --slug=general
    wp term create category Café >/dev/null
    wp term create category Pastelería >/dev/null
    wp term create category Eventos >/dev/null
    wp post create --post_status=publish --post_category=Café --post_date="2026-10-06 08:00:00" \
        --post_title="Llegó la nueva cosecha de Huila" \
        --post_content="<!-- wp:paragraph --><p>Esta semana empezamos a servir el lote de octubre de la finca La Esperanza, en Pitalito: notas de panela, mandarina y chocolate. Lo tenemos en espresso y en filtrado, y también en bolsas de 250 g para llevar.</p><!-- /wp:paragraph -->"
    wp post create --post_status=publish --post_category=Pastelería --post_date="2026-10-13 08:00:00" \
        --post_title="El cheesecake de maracuyá entra a la carta" \
        --post_content="<!-- wp:paragraph --><p>Después de varios fines de semana como especial, el cheesecake de maracuyá se queda en la carta todos los días. Base de galleta de avena, poco azúcar y la fruta justa para que no empalague.</p><!-- /wp:paragraph -->"
    wp post create --post_status=publish --post_category=Eventos --post_date="2026-10-20 08:00:00" \
        --post_title="Taller de métodos de filtrado, los sábados" \
        --post_content="<!-- wp:paragraph --><p>Cada sábado a las 10:00 abrimos la barra para enseñar a preparar café en V60, Chemex y prensa francesa. Son grupos de seis personas, dura una hora e incluye una bolsa de café. Aparta tu cupo en la barra.</p><!-- /wp:paragraph -->"
fi

# Endurecimiento (también en sitios ya instalados): base al día tras subir de versión, sin pingbacks
# y el nombre público del autor distinto del usuario de acceso (el usuario no aparece en enlaces ni en la API).
wp core update-db
wp option update default_ping_status closed
wp user update admin --display_name="Equipo Café Altura" --nickname="Equipo Café Altura" --user_nicename=equipo

wp theme activate cafe-altura
wp rewrite structure '/%postname%/'
echo "Sitio listo: $WP_URL"
