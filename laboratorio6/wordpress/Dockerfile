# WordPress armado desde cero: PHP + Apache, núcleo oficial de WordPress, configuración y tema propios.
# Sin temas ni plugins de fábrica: solo el tema iot-platform.
FROM php:8.3-apache

ARG WP_VERSION=6.8.3
ARG WP_CLI_VERSION=2.12.0

RUN docker-php-ext-install mysqli opcache && a2enmod rewrite \
 && apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o /tmp/wp.tgz https://wordpress.org/wordpress-${WP_VERSION}.tar.gz \
 && echo "$(curl -fsSL https://wordpress.org/wordpress-${WP_VERSION}.tar.gz.sha1)  /tmp/wp.tgz" | sha1sum -c - \
 && tar -xzf /tmp/wp.tgz -C /var/www/html --strip-components=1 \
 && rm -rf /tmp/wp.tgz /var/www/html/wp-content/themes/* /var/www/html/wp-content/plugins/* \
 && curl -fsSL -o /tmp/es.zip https://downloads.wordpress.org/translation/core/${WP_VERSION}/es_CO.zip \
 && unzip -q /tmp/es.zip -d /var/www/html/wp-content/languages && rm /tmp/es.zip \
 && curl -fsSL -o /usr/local/bin/wp https://github.com/wp-cli/wp-cli/releases/download/v${WP_CLI_VERSION}/wp-cli-${WP_CLI_VERSION}.phar \
 && chmod +x /usr/local/bin/wp

COPY wp-config.php .htaccess /var/www/html/
COPY tema /var/www/html/wp-content/themes/iot-platform
COPY configurar-sitio.sh /usr/local/bin/configurar-sitio
RUN chmod +x /usr/local/bin/configurar-sitio && chown -R www-data:www-data /var/www/html
