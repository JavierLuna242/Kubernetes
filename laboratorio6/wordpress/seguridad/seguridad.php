<?php
/**
 * Plugin Name: Seguridad Café Altura
 * Description: Límite de intentos de login, mensajes de error que no revelan usuarios y API sin listado de usuarios.
 * Va en mu-plugins: siempre activo y no se puede desactivar desde el panel.
 */

defined('ABSPATH') || exit;

const CA_MAX_INTENTOS = 5;            // fallos permitidos por IP...
const CA_VENTANA = 15 * MINUTE_IN_SECONDS; // ...en esta ventana; después, bloqueo hasta que expire

// IP real del visitante: el sitio solo se alcanza por el túnel de Cloudflare, que la envía en CF-Connecting-IP.
function ca_ip(): string {
    return $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
}

function ca_clave(): string {
    return 'ca_login_' . md5(ca_ip());
}

function ca_bloqueada(): bool {
    return (int) get_transient(ca_clave()) >= CA_MAX_INTENTOS;
}

// Cada fallo suma; el contador vence solo.
// ponytail: límite por IP; un ataque repartido entre muchas IP no lo nota. Para eso, Cloudflare Access o una regla de rate limiting en /wp-login.php.
add_action('wp_login_failed', function () {
    set_transient(ca_clave(), (int) get_transient(ca_clave()) + 1, CA_VENTANA);
});

// Bloqueada: se rechaza aunque la contraseña sea correcta.
add_filter('authenticate', function ($user) {
    return ca_bloqueada() ? new WP_Error('ca_bloqueo', 'bloqueada') : $user;
}, 99);

// Un único mensaje: no dice si el usuario existe.
add_filter('login_errors', function () {
    return ca_bloqueada()
        ? 'Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentarlo.'
        : '<strong>Error:</strong> usuario o contraseña incorrectos.';
});

// La lista de usuarios de la API solo para quien ya inició sesión (el editor la usa).
add_filter('rest_endpoints', function (array $rutas) {
    if (!is_user_logged_in()) {
        foreach (array_keys($rutas) as $ruta) {
            if (str_starts_with($ruta, '/wp/v2/users')) {
                unset($rutas[$ruta]);
            }
        }
    }
    return $rutas;
});

// Sin contraseñas de aplicación ni XML-RPC (Apache además bloquea xmlrpc.php) ni versión en el HTML.
add_filter('wp_is_application_passwords_available', '__return_false');
add_filter('xmlrpc_enabled', '__return_false');
add_filter('the_generator', '__return_empty_string');
