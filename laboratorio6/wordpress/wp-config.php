<?php
// Configuración de WordPress: todo sale de variables de entorno (Secret wordpress de Kubernetes).

define('DB_NAME', getenv('DB_NAME'));
define('DB_USER', getenv('DB_USER'));
define('DB_PASSWORD', getenv('DB_PASSWORD'));
define('DB_HOST', getenv('DB_HOST'));
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');
$table_prefix = 'wp_';

// Claves de las cookies de sesión: derivadas de un único secreto.
foreach (['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'] as $k) {
    define($k, hash('sha256', $k . getenv('WP_SALT')));
}

// Cloudflare termina el HTTPS y el túnel llega por HTTP: se respeta el esquema original.
if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') {
    $_SERVER['HTTPS'] = 'on';
}
// La URL es siempre WP_URL. Única excepción: kubectl port-forward a localhost, para probar sin el dominio.
// (Tomar cualquier Host de la petición permitiría generar enlaces y correos hacia otro dominio.)
$host = $_SERVER['HTTP_HOST'] ?? '';
$url = preg_match('/^(localhost|127\.0\.0\.1)(:\d+)?$/', $host) ? "http://$host" : getenv('WP_URL');
define('WP_HOME', $url);
define('WP_SITEURL', $url);

// La imagen es inmutable: temas, plugins y actualizaciones llegan con una imagen nueva, no desde el panel.
define('DISALLOW_FILE_MODS', true);
define('AUTOMATIC_UPDATER_DISABLED', true);
define('WP_POST_REVISIONS', 10);

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}
require_once ABSPATH . 'wp-settings.php';
