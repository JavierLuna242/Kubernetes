<?php
// Tema IoT Platform: una hoja de estilos propia, sin librerías.

const IOTP_APP = 'https://iot.javier.life'; // el visualizador

add_action('after_setup_theme', function () {
    add_theme_support('title-tag');
    add_theme_support('html5', ['search-form', 'gallery', 'caption', 'style', 'script']);
});

add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('iot-platform', get_stylesheet_uri(), [], wp_get_theme()->get('Version'));
});

add_action('wp_head', function () {
    echo '<link rel="icon" type="image/svg+xml" href="' . esc_url(get_theme_file_uri('favicon.svg')) . '">' . "\n";
});

/** Ícono de trazo (estilo lucide, el mismo set del visualizador). $paths son trazos SVG fijos del tema. */
function iotp_icon(string $paths): string
{
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' . $paths . '</svg>';
}

const IOTP_LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#3d71d9"/><g transform="translate(4 4)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></g></svg>';

/** Enlace a la página de Novedades (la página de entradas). */
function iotp_novedades_url(): string
{
    $id = (int) get_option('page_for_posts');
    return $id ? get_permalink($id) : home_url('/');
}
