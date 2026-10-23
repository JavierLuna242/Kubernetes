#!/bin/sh
# Deja el sitio listo: instala WordPress (si la base está vacía), activa el tema y crea el contenido inicial.
# Se puede repetir sin problema. Uso:  kubectl exec -n wordpress deploy/wordpress -- configurar-sitio
set -e
wp() { command wp --allow-root --path=/var/www/html "$@"; }

if ! wp core is-installed; then
    wp core install --url="$WP_URL" --title="IoT Platform" --admin_user=admin \
        --admin_password="$WP_ADMIN_PASSWORD" --admin_email=admin@javier.life --skip-email
    wp option update WPLANG es_CO # el paquete de idioma viene en la imagen
    wp option update blogdescription "Telemetría, control y alertas para tus dispositivos"
    wp option update timezone_string America/Bogota
    wp option update date_format "j \d\e F \d\e Y"
    wp post delete 1 2 3 --force # entrada, página y política de privacidad de ejemplo

    inicio=$(wp post create --post_type=page --post_status=publish --post_title=Inicio --porcelain)
    novedades=$(wp post create --post_type=page --post_status=publish --post_title=Novedades --porcelain)
    wp option update show_on_front page
    wp option update page_on_front "$inicio"
    wp option update page_for_posts "$novedades"

    wp post create --post_status=publish --post_title="Cada dispositivo con su propia credencial" --post_content="<p>Al registrar un dispositivo, la plataforma le entrega un token propio. Su usuario MQTT es su id y solo puede publicar en <code>iot/&lt;id&gt;/telemetry</code> y leer <code>iot/&lt;id&gt;/cmd</code>. Si un token se filtra, se rota desde la página Dispositivos y las conexiones abiertas se cierran al instante.</p>"
    wp post create --post_status=publish --post_title="Gemelo digital: lo que pides y lo que el dispositivo reporta" --post_content="<p>Cada dispositivo tiene un estado deseado, que es lo que pide la plataforma, y un estado reportado, que es lo que dice su telemetría. El deseado viaja como mensaje retenido: aunque el dispositivo esté desconectado, lo recibe al volver. La página Dispositivos muestra qué propiedades ya están sincronizadas.</p>"
    wp post create --post_status=publish --post_title="Reglas que avisan y actúan" --post_content="<p>Las reglas vigilan cualquier métrica. Al dispararse avisan por Telegram y, si se configura, envían un comando al dispositivo. Al resolverse pueden enviar otro: por ejemplo, encender un ventilador cuando la temperatura supera 30 °C y apagarlo cuando baja.</p>"
fi

wp theme activate iot-platform
wp rewrite structure '/%postname%/'
echo "Sitio listo: $WP_URL"
