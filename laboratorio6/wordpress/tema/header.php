<!doctype html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<header class="cabecera">
  <div class="contenedor">
    <a class="marca" href="<?php echo esc_url(home_url('/')); ?>"><?php echo IOTP_LOGO; ?><?php bloginfo('name'); ?></a>
    <nav class="menu">
      <a href="<?php echo esc_url(home_url('/#funciones')); ?>">Funciones</a>
      <a href="<?php echo esc_url(home_url('/#como-funciona')); ?>">Cómo funciona</a>
      <a href="<?php echo esc_url(iotp_novedades_url()); ?>">Novedades</a>
      <a class="boton primario" href="<?php echo esc_url(IOTP_APP); ?>">Abrir plataforma</a>
    </nav>
  </div>
</header>
