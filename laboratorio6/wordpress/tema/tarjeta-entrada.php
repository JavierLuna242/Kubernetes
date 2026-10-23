<article class="tarjeta entrada-tarjeta">
  <div class="fecha"><?php echo esc_html(get_the_date()); ?></div>
  <h3><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
  <p><?php echo esc_html(wp_trim_words(get_the_excerpt(), 28)); ?></p>
</article>
