<?php
// Portada: qué es IoT Platform, sus funciones, cómo conectar un dispositivo y las últimas novedades.
get_header();

$funciones = [
    ['Telemetría por MQTT', 'Los dispositivos publican JSON por MQTT, en claro dentro de la red o cifrado por WebSocket (wss). Cada lectura se guarda en TimescaleDB.',
        '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/>'],
    ['Dashboards en vivo', 'Series de tiempo, indicadores, mapas GPS, mapas de calor y fórmulas entre métricas, actualizados al instante por WebSocket.',
        '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>'],
    ['Control y gemelo digital', 'Interruptores, botones y deslizadores envían comandos. El gemelo digital compara lo que pides con lo que el dispositivo reporta.',
        '<rect width="20" height="12" x="2" y="6" rx="6"/><circle cx="16" cy="12" r="2"/>'],
    ['Reglas y alertas', 'Avisos por Telegram al cruzar un umbral y comandos automáticos al dispararse o resolverse una regla. También hay un reporte diario.',
        '<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>'],
    ['Anomalías y pronóstico', 'Detecta lecturas fuera de lo normal y proyecta la tendencia de cada serie. Se calcula dentro de la plataforma, sin servicios externos.',
        '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'],
    ['Seguro por diseño', 'Cada dispositivo tiene su propia credencial y solo puede usar sus propios temas MQTT. Si un token se filtra, se rota al instante.',
        '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>'],
];
?>
<main>
  <section class="hero">
    <div class="contenedor">
      <div>
        <h1>Tus dispositivos, en vivo.</h1>
        <p>Conecta sensores por MQTT, mira sus datos en dashboards en tiempo real, contrólalos a distancia y recibe alertas en Telegram. Todo en una sola plataforma.</p>
        <div class="acciones">
          <a class="boton primario" href="<?php echo esc_url(IOTP_APP); ?>">Abrir la plataforma</a>
          <a class="boton" href="<?php echo esc_url(iotp_novedades_url()); ?>">Ver novedades</a>
        </div>
      </div>
      <div class="tarjeta panel-demo" aria-hidden="true">
        <div class="titulo"><span>invernadero-01 · temperatura</span><span class="en-vivo">● en vivo</span></div>
        <div class="valor">22,5 °C</div>
        <svg viewBox="0 0 300 120" preserveAspectRatio="none">
          <path d="M0 80 L20 74 L40 78 L60 66 L80 70 L100 58 L120 62 L140 50 L160 56 L180 44 L200 52 L220 40 L240 46 L260 34 L280 42 L300 30 L300 120 L0 120 Z" fill="var(--accent)" opacity="0.12"/>
          <path d="M0 80 L20 74 L40 78 L60 66 L80 70 L100 58 L120 62 L140 50 L160 56 L180 44 L200 52 L220 40 L240 46 L260 34 L280 42 L300 30" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
        </svg>
      </div>
    </div>
  </section>

  <section class="seccion" id="funciones">
    <div class="contenedor">
      <h2>Funciones</h2>
      <p class="muted">Todo lo que hace falta para llevar un sensor del protoboard a un panel con alertas.</p>
      <div class="rejilla">
        <?php foreach ($funciones as [$titulo, $texto, $icono]) : ?>
          <div class="tarjeta funcion">
            <?php echo iotp_icon($icono); ?>
            <h3><?php echo esc_html($titulo); ?></h3>
            <p><?php echo esc_html($texto); ?></p>
          </div>
        <?php endforeach; ?>
      </div>
    </div>
  </section>

  <section class="seccion" id="como-funciona">
    <div class="contenedor">
      <h2>Cómo funciona</h2>
      <p class="muted">Tres pasos y tu dispositivo ya está en un dashboard.</p>
      <div class="rejilla">
        <div class="tarjeta paso"><span class="numero">1</span><h3>Registra el dispositivo</h3><p class="muted">En la página Dispositivos eliges su id y recibes su token. Ese par es su credencial MQTT.</p></div>
        <div class="tarjeta paso"><span class="numero">2</span><h3>Publica sus lecturas</h3><p class="muted">Envía un JSON a <code>iot/&lt;id&gt;/telemetry</code>. Cada número es una métrica.</p>
<pre><code>{"temperatura": 22.5, "humedad": 60.1}</code></pre></div>
        <div class="tarjeta paso"><span class="numero">3</span><h3>Mira, controla y automatiza</h3><p class="muted">Arma dashboards, envía comandos a <code>iot/&lt;id&gt;/cmd</code> y crea reglas que avisan o actúan solas.</p></div>
      </div>
    </div>
  </section>

  <?php $ultimas = new WP_Query(['posts_per_page' => 3, 'ignore_sticky_posts' => true]); ?>
  <?php if ($ultimas->have_posts()) : ?>
  <section class="seccion">
    <div class="contenedor">
      <h2>Novedades</h2>
      <div class="rejilla">
        <?php while ($ultimas->have_posts()) : $ultimas->the_post(); ?>
          <?php get_template_part('tarjeta-entrada'); ?>
        <?php endwhile; wp_reset_postdata(); ?>
      </div>
    </div>
  </section>
  <?php endif; ?>
</main>
<?php get_footer(); ?>
