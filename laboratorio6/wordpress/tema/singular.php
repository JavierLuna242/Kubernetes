<?php
// Una entrada o una página.
get_header();
?>
<main class="pagina">
  <div class="contenedor">
    <?php while (have_posts()) : the_post(); ?>
      <article>
        <?php if (is_single()) : ?>
          <div class="fecha"><?php echo esc_html(get_the_date()); ?></div>
        <?php endif; ?>
        <h1><?php the_title(); ?></h1>
        <div class="contenido"><?php the_content(); ?></div>
      </article>
      <?php if (is_single()) : ?>
        <p><a href="<?php echo esc_url(iotp_novedades_url()); ?>">← Todas las novedades</a></p>
      <?php endif; ?>
    <?php endwhile; ?>
  </div>
</main>
<?php get_footer(); ?>
