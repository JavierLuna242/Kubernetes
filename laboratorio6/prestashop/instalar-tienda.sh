#!/bin/sh
# Post-instalación de PrestaShop: la imagen oficial ejecuta /tmp/post-install-scripts/* una sola vez, al terminar
# la instalación automática (disco de archivos vacío). Deja la tienda como "Café Altura · Tienda".
# Nunca falla: si fallara, el arranque de la imagen se detendría con su install.lock puesto y no volvería a arrancar.
# Para repetirlo a mano:  kubectl exec -n prestashop deploy/prestashop -- /tmp/post-install-scripts/instalar-tienda.sh
D=/tmp/tienda
CSS=/var/www/html/themes/hummingbird/assets/css # tema por defecto de PrestaShop 9
F=https://cdn.jsdelivr.net/npm/@fontsource-variable

# Carpeta del panel: el instalador la dejó con un nombre aleatorio (admin + números y letras); pasa a CARPETA_PANEL.
cd /var/www/html
for d in admin[0-9]*/; do
    [ -d "$d" ] && [ -n "$CARPETA_PANEL" ] && mv "${d%/}" "$CARPETA_PANEL" && rm -rf var/cache/* && echo "panel en /$CARPETA_PANEL"
done

cp "$D/custom.css" "$CSS/custom.css"
curl -fsSL -o "$CSS/dm-sans.woff2" "$F/dm-sans@5.2.5/files/dm-sans-latin-wght-normal.woff2" \
 && curl -fsSL -o "$CSS/fraunces.woff2" "$F/fraunces@5.2.5/files/fraunces-latin-wght-normal.woff2" \
 || echo "aviso: no se pudieron descargar las tipografías; la tienda usa las del sistema"
chown www-data:www-data "$CSS"/custom.css "$CSS"/*.woff2 2>/dev/null

runuser -u www-data -- php -d memory_limit=-1 "$D/tienda.php" \
 || echo "aviso: tienda.php falló; revisar el log y repetir el comando de arriba"
exit 0
