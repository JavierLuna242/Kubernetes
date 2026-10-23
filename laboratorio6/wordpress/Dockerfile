# WordPress armado desde cero: PHP + Apache, núcleo oficial de WordPress, configuración y tema propios.
# Sin temas ni plugins de fábrica: solo el tema de bloques cafe-altura (HTML + theme.json, sin PHP propio).
FROM php:8.3-apache

ARG WP_VERSION=6.8.3
ARG WP_CLI_VERSION=2.12.0
ARG FONTSOURCE=https://cdn.jsdelivr.net/npm/@fontsource-variable

# gd + exif: miniaturas y orientación de las fotos que se suben a la biblioteca de medios.
RUN apt-get update && apt-get install -y --no-install-recommends unzip libjpeg62-turbo-dev libpng-dev libwebp-dev libfreetype-dev \
 && docker-php-ext-configure gd --with-jpeg --with-webp --with-freetype \
 && docker-php-ext-install mysqli opcache gd exif && a2enmod rewrite \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/wp.tgz https://wordpress.org/wordpress-${WP_VERSION}.tar.gz \
 && echo "$(curl -fsSL https://wordpress.org/wordpress-${WP_VERSION}.tar.gz.sha1)  /tmp/wp.tgz" | sha1sum -c - \
 && tar -xzf /tmp/wp.tgz -C /var/www/html --strip-components=1 \
 && rm -rf /tmp/wp.tgz /var/www/html/wp-content/themes/* /var/www/html/wp-content/plugins/* \
 && curl -fsSL -o /tmp/es.zip https://downloads.wordpress.org/translation/core/${WP_VERSION}/es_CO.zip \
 && unzip -q /tmp/es.zip -d /var/www/html/wp-content/languages && rm /tmp/es.zip \
 && curl -fsSL -o /usr/local/bin/wp https://github.com/wp-cli/wp-cli/releases/download/v${WP_CLI_VERSION}/wp-cli-${WP_CLI_VERSION}.phar \
 && chmod +x /usr/local/bin/wp

# Tipografías del tema (licencia OFL), servidas desde el propio sitio: DM Sans (texto) y Fraunces (títulos).
ARG FONTS=/var/www/html/wp-content/themes/cafe-altura/assets/fonts
RUN mkdir -p ${FONTS} \
 && curl -fsSL -o ${FONTS}/dm-sans.woff2 ${FONTSOURCE}/dm-sans@5.2.5/files/dm-sans-latin-wght-normal.woff2 \
 && curl -fsSL -o ${FONTS}/fraunces.woff2 ${FONTSOURCE}/fraunces@5.2.5/files/fraunces-latin-wght-normal.woff2

COPY wp-config.php .htaccess favicon.ico /var/www/html/
COPY tema /var/www/html/wp-content/themes/cafe-altura
COPY contenido /usr/local/share/sitio
COPY configurar-sitio.sh /usr/local/bin/configurar-sitio
RUN chmod +x /usr/local/bin/configurar-sitio && chown -R www-data:www-data /var/www/html
