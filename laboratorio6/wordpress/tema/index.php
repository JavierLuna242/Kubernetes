<?php
// Listado de entradas (Novedades, archivos, búsquedas) y respaldo para cualquier otra vista.
get_header();
?>
<main class="pagina">
  <div class="contenedor">
    <h1><?php echo is_home() ? esc_html(get_the_title(get_option('page_for_posts')) ?: 'Novedades') : wp_kses_post(get_the_archive_title() ?: 'Resultados'); ?></h1>
    <?php if (have_posts()) : ?>
      <div class="rejilla" style="grid-template-columns: 1fr">
        <?php while (have_posts()) : the_post(); ?>
          <?php get_template_part('tarjeta-entrada'); ?>
        <?php endwhile; ?>
      </div>
      <?php the_posts_pagination(['prev_text' => '← Anteriores', 'next_text' => 'Siguientes →']); ?>
    <?php else : ?>
      <p class="muted">No hay nada aquí. <a href="<?php echo esc_url(home_url('/')); ?>">Volver al inicio</a>.</p>
    <?php endif; ?>
  </div>
</main>
<?php get_footer(); ?>
