#!/usr/bin/env node
/*
 * Genera index.html, 404.html, sitemap.xml, robots.txt y site.webmanifest
 * a partir de data/catalogo.json, data/sitio.json, img/manifiesto.json y src/plantilla.html.
 *
 * Uso:  node tools/build.mjs
 * Requiere Node 18 o superior. No usa dependencias externas.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../js/render.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => readFileSync(join(raiz, p), 'utf8');
const leerJSON = (p) => JSON.parse(leer(p));
const escribir = (p, t) => writeFileSync(join(raiz, p), t.replace(/[ \t]+$/gm, ''));

const catalogo = leerJSON('data/catalogo.json');
const sitio = leerJSON('data/sitio.json');
const manifiesto = leerJSON('img/manifiesto.json');
const n = catalogo.negocio;
const URL_SITIO = sitio.url.endsWith('/') ? sitio.url : sitio.url + '/';
const rutaBase = new URL(URL_SITIO).pathname; // "/" en un sitio de usuario (taniasanabria.github.io)
const VERSION = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''); // AAAAMMDDhhmm (UTC): cambia en cada publicación

// --- Validación: toda foto referenciada debe existir (evita imágenes rotas) ---
const faltantes = new Set();
const revisar = (lista) => (lista || []).forEach((f) => { if (!manifiesto[f]) faltantes.add(f); });
catalogo.servicios.forEach((s) => revisar(s.fotos));
catalogo.galerias.forEach((g) => revisar(g.fotos));
if (faltantes.size) {
  console.warn('ATENCIÓN: fotos en "fotos" que no existen en img/ (se mostrarán como marcador):', [...faltantes].join(', '));
}

// --- JSON-LD (datos estructurados para Google) ---
const diasEs = { Monday: 'Monday', Tuesday: 'Tuesday', Wednesday: 'Wednesday', Thursday: 'Thursday', Friday: 'Friday', Saturday: 'Saturday', Sunday: 'Sunday' };
const jsonld = {
  '@context': 'https://schema.org',
  '@type': 'BeautySalon',
  '@id': URL_SITIO + '#negocio',
  name: `${n.nombre} ${n.subtitulo}`,
  alternateName: n.nombreLegal,
  description: sitio.descripcion,
  url: URL_SITIO,
  image: URL_SITIO + sitio.imagenCompartir,
  logo: URL_SITIO + 'img/icono-512.png',
  telephone: '+' + n.whatsapp,
  priceRange: 'Gs. 80.000 - Gs. 1.500.000',
  currenciesAccepted: 'PYG',
  paymentAccepted: 'Transferencia bancaria, QR',
  address: {
    '@type': 'PostalAddress',
    streetAddress: n.calle,
    addressLocality: n.ciudad,
    addressRegion: n.departamento,
    addressCountry: n.pais,
  },
  hasMap: n.mapa,
  openingHoursSpecification: n.horario.map((h) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: h.dias.map((d) => 'https://schema.org/' + diasEs[d]),
    opens: h.abre,
    closes: h.cierra,
  })),
  sameAs: Object.values(n.redes),
  makesOffer: catalogo.servicios.filter((s) => !s.variantes).map((s) => ({
    '@type': 'Offer',
    name: s.nombre,
    description: s.resumen,
    priceCurrency: 'PYG',
    ...(/^Gs\. [\d.]+$/.test(s.precioTotal || s.precio) ? { price: (s.precioTotal || s.precio).replace(/[^\d]/g, '') } : {}),
    url: URL_SITIO + '#servicio-' + s.id,
  })),
};

// --- Íconos: incluir en el sprite solo los que se usan ---
const spriteCompleto = leer('tools/iconos.svg');
const simbolos = Object.fromEntries([...spriteCompleto.matchAll(/<symbol id="i-([a-z0-9-]+)"[\s\S]*?<\/symbol>/g)].map((m) => [m[1], m[0]]));

const I = (nombre) => R.icono(nombre);
const accesos = catalogo.categorias
  .map((c) => `<a class="acceso" href="#${R.esc(c.id)}"><span class="acceso-titulo">${R.esc(c.titulo)}</span><span class="acceso-desc">${R.esc(c.descripcion)}</span></a>`)
  .concat([`<a class="acceso" href="#galeria"><span class="acceso-titulo">Galería de Fotos</span><span class="acceso-desc">Explorá nuestro portafolio y resultados reales</span></a>`])
  .join('');

// Menú de categorías (barra fija): cada botón abre una vista exclusiva (#maquillaje, #galeria…).
const ICONOS_CAT = { maquillaje: 'wand-magic-sparkles', estetica: 'scissors', eventos: 'bolt', academia: 'graduation-cap' };
const CORTOS_CAT = { maquillaje: 'Maquillaje', estetica: 'Estética & Hair', eventos: 'Eventos VIP', academia: 'Academia' };
const itemMenu = (id, texto, ic) => `<a class="menu-cat" href="#${R.esc(id)}" data-ir="${R.esc(id)}">${R.icono(ic)}<span>${R.esc(texto)}</span></a>`;
const menuCats = [itemMenu('inicio', 'Inicio', 'house-chimney')]
  .concat(catalogo.categorias.map((c) => itemMenu(c.id, c.menu || CORTOS_CAT[c.id] || c.titulo, ICONOS_CAT[c.id] || 'star')))
  .concat([itemMenu('galeria', 'Galería', 'images'), itemMenu('sobre-tania', 'Sobre Tania', 'crown'), itemMenu('contacto', 'Contacto', 'location-dot')])
  .join('');
const destacados = R.seccionDestacados(catalogo.galerias, manifiesto);

const retratoHero = R.imagen('retrato', manifiesto, { alt: 'Tania Sanabria, maquilladora profesional, con sus brochas', sizes: '(min-width: 900px) 420px, 52vw', prioridad: true, clase: 'hero-retrato' });
const retratoBio = R.imagen('retrato', manifiesto, { alt: 'Retrato de Tania Sanabria', sizes: '(min-width: 900px) 360px, 70vw', clase: 'bio-retrato' });

const certificados = (catalogo.certificados || []).length
  ? `<h3 class="bio-subtitulo">Mis certificaciones</h3><div class="certificados">${catalogo.certificados.map((c) => `<figure>${R.imagen(c.foto, manifiesto, { alt: c.titulo, sizes: '200px', anchoMax: 480 })}<figcaption>${R.esc(c.titulo)}</figcaption></figure>`).join('')}</div>`
  : '';

const jsonSeguro = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

const reemplazos = {
  TITULO: R.esc(sitio.titulo),
  DESCRIPCION: R.esc(sitio.descripcion),
  URL: URL_SITIO,
  SUPABASE_ORIGEN: (sitio.supabase && sitio.supabase.url) ? new URL(sitio.supabase.url).origin : URL_SITIO,
  OG_IMAGEN: URL_SITIO + sitio.imagenCompartir,
  COLOR: sitio.colorTema,
  VERSION,
  JSONLD: jsonSeguro(jsonld),
  ACCESOS: accesos,
  HERO_RETRATO: retratoHero,
  SECCIONES: catalogo.categorias.map((c) => R.seccionCategoria(c, catalogo.servicios, manifiesto)).join('\n'),
  GALERIA: R.galeriaPrincipal(catalogo.galerias, manifiesto),
  BIO_FOTO: retratoBio,
  BIO_TEXTO: R.esc(catalogo.bio.texto),
  CERTIFICADOS: certificados,
  OPCIONES: R.opcionesServicio(catalogo.categorias, catalogo.servicios),
  POLITICA: R.esc(n.politicaSena),
  POLITICA_HORARIO: R.esc(n.politicaHorario),
  HORARIO_ESPECIAL: R.esc(n.horarioEspecial),
  DIRECCION: R.esc(n.direccion),
  HORARIO: R.esc(n.horarioTexto),
  ATENCION: R.esc(n.atencionNota),
  MAPA: R.esc(n.mapa),
  FB: R.esc(n.redes.facebook), IG: R.esc(n.redes.instagram), TT: R.esc(n.redes.tiktok),
  WA: n.whatsapp, TEL: R.esc(n.telefonoVisible),
  ANIO: String(new Date().getFullYear()),
  DATOS: jsonSeguro(catalogo),
  MANIFIESTO: jsonSeguro(manifiesto),
  ICONO_MENU: I('bars'), ICONO_CALENDARIO: I('calendar-check'), ICONO_CANDADO: I('user-lock'), ICONO_RELOJ: I('clock'),
  ICONO_UBICACION: I('location-dot'), ICONO_IG: I('instagram'), ICONO_FB: I('facebook-f'), ICONO_TT: I('tiktok'),
  ICONO_COMPARTIR: I('share-nodes'), ICONO_INFO: I('circle-info'), ICONO_WA: I('whatsapp'), ICONO_CHAT: I('comment-dots'), ICONO_MAPA: I('map-location-dot'),
  ICONO_LUPA: I('magnifying-glass-plus'), MENU_CATS: menuCats, DESTACADOS: destacados,
  ICONO_X: I('xmark'), ICONO_IZQ: I('chevron-left'), ICONO_DER: I('chevron-right'), ICONO_CHECK: I('check'),
};

let html = leer('src/plantilla.html');
for (const [clave, valor] of Object.entries(reemplazos)) {
  if (clave === 'SPRITE') continue;
  html = html.split(`{{${clave}}}`).join(valor);
}
// Íconos usados por el HTML, por app.js y por los datos (detalles que se arman al vuelo)
const usados = new Set([...html.matchAll(/#i-([a-z0-9-]+)/g)].map((m) => m[1]));
for (const m of leer('js/app.js').matchAll(/icono\('([a-z0-9-]+)'/g)) usados.add(m[1]);
for (const f of ['js/render.js', 'js/inscripcion.js', 'js/carrusel.js', 'js/visor.js', 'js/agenda-ui.js']) for (const m of leer(f).matchAll(/icono\('([a-z0-9-]+)'/g)) usados.add(m[1]);
for (const m of JSON.stringify(catalogo).matchAll(/"icono":"([a-z0-9-]+)"/g)) usados.add(m[1]);
const sinIcono = [...usados].filter((u) => !simbolos[u]);
if (sinIcono.length) throw new Error('Íconos inexistentes en tools/iconos.svg: ' + sinIcono.join(', '));
const sprite = `<svg xmlns="http://www.w3.org/2000/svg" class="sprite" aria-hidden="true"><!-- Íconos: Font Awesome Free 6.5.1 (CC BY 4.0) https://fontawesome.com -->${[...usados].sort().map((u) => simbolos[u]).join('')}</svg>`;
html = html.replace('{{SPRITE}}', sprite);
if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('Quedaron marcadores sin reemplazar: ' + html.match(/\{\{[A-Z_]+\}\}/g).join(', '));
escribir('index.html', html);

// --- 404 en español (GitHub Pages la sirve para cualquier ruta inexistente) ---
escribir('404.html', `<!DOCTYPE html>
<html lang="es-PY">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Página no encontrada | Tania Sanabria Makeup Studio</title>
  <meta name="robots" content="noindex">
  <base href="${rutaBase}">
  <link rel="icon" href="img/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="stylesheet" href="css/estilos.css?v=${VERSION}">
</head>
<body class="pagina-404">
  <main class="error-404">
    <img src="img/logo-completo-320.webp" srcset="img/logo-completo-320.webp 1x, img/logo-completo-640.webp 2x" width="160" height="140" alt="Logo de Tania Sanabria Makeup Studio">
    <p class="sobretitulo">Error 404</p>
    <h1>Esta página <span class="acento">no existe</span></h1>
    <p>Puede que el enlace esté incompleto o que la página haya cambiado de lugar.</p>
    <p class="hero-acciones">
      <a class="btn btn-primario" href="./">Ir al inicio</a>
      <a class="btn btn-secundario" href="./#chat">Preguntá en el chat</a>
    </p>
  </main>
</body>
</html>
`);

// --- sitemap y robots ---
const hoy = new Date().toISOString().slice(0, 10);
escribir('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${URL_SITIO}</loc><lastmod>${hoy}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
`);
escribir('robots.txt', `# Permite que los buscadores indexen todo el sitio, salvo el panel de administración y el aula de alumnas.
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /alumnas/

Sitemap: ${URL_SITIO}sitemap.xml
`);
escribir('site.webmanifest', JSON.stringify({
  name: 'Tania Sanabria Makeup Studio',
  short_name: 'Tania Sanabria',
  lang: 'es-PY',
  start_url: './',
  display: 'standalone',
  background_color: '#faf7f2',
  theme_color: sitio.colorTema,
  icons: [
    { src: 'img/icono-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'img/icono-512.png', sizes: '512x512', type: 'image/png' },
  ],
}, null, 2) + '\n');
if (!existsSync(join(raiz, '.nojekyll'))) escribir('.nojekyll', '');

// --- Configuración compartida por el sitio y el panel (/admin/) ---
const sb = sitio.supabase || {};
escribir('js/config.js', `// Generado por tools/build.mjs desde data/sitio.json. No editar a mano.
// La clave "anon" de Supabase es pública por diseño; la seguridad está en las políticas RLS (supabase/schema.sql).
export const FUENTE_DATOS = ${JSON.stringify(sitio.fuenteDatos || 'embebido')};
export const SUPABASE = ${JSON.stringify({ url: sb.url || '', anonKey: sb.anonKey || '' }, null, 2)};
export const URL_SITIO = ${JSON.stringify(URL_SITIO)};
// Asistente del sitio: backend opcional con IA (null = solo el motor local, sin costo).
export const CHAT = ${JSON.stringify({ backend: (sitio.chat && sitio.chat.backend) || null })};
// Cursos: pasarela de pago con tarjeta (null = todavía no; se paga por transferencia o QR).
export const PAGOS = ${JSON.stringify({ tarjeta: (sitio.pagos && sitio.pagos.tarjeta) || null })};
`);

console.log(`Listo: index.html (${(html.length / 1024).toFixed(1)} KB), 404.html, sitemap.xml, robots.txt, site.webmanifest. URL: ${URL_SITIO}`);
