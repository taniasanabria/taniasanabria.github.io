/*
 * render.js: funciones puras que convierten los datos del catálogo en HTML.
 * Se usan en dos lugares:
 *   1) tools/build.mjs (Node) para generar index.html estático (bueno para SEO y velocidad);
 *   2) js/app.js (navegador) para armar los detalles, la galería y el formulario al vuelo.
 * No tocan el DOM: reciben datos y devuelven texto HTML.
 */

export function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function icono(nombre, clase = '') {
  return `<svg class="ic${clase ? ' ' + clase : ''}" aria-hidden="true" focusable="false"><use href="#i-${esc(nombre)}"></use></svg>`;
}

/** Ruta de la foto en un ancho dado. */
export function rutaFoto(base, ancho) {
  return `img/${base}-${ancho}.webp`;
}

/**
 * <img> responsiva. `manifiesto` viene de img/manifiesto.json.
 * Si la foto no existe en el manifiesto devuelve un marcador elegante (nunca una imagen rota).
 */
export function imagen(base, manifiesto, { alt = '', sizes = '100vw', clase = '', prioridad = false, anchoMax } = {}) {
  const info = manifiesto && manifiesto[base];
  if (!info) return marcador({ clase });
  let anchos = info.anchos.slice();
  if (anchoMax) anchos = anchos.filter((a) => a <= anchoMax).concat(anchos.filter((a) => a > anchoMax).slice(0, 1));
  const src = rutaFoto(base, anchos[Math.min(1, anchos.length - 1)]);
  const srcset = anchos.map((a) => `${rutaFoto(base, a)} ${a}w`).join(', ');
  const alto = Math.round((info.h / info.w) * 1000);
  return `<img${clase ? ` class="${esc(clase)}"` : ''} src="${src}" srcset="${srcset}" sizes="${esc(sizes)}" width="1000" height="${alto}" alt="${esc(alt)}" ${prioridad ? 'fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"'}>`;
}

/** Marcador para servicios o álbumes que todavía no tienen fotos. */
export function marcador({ clase = '', texto = 'Fotos próximamente' } = {}) {
  return `<span class="marcador${clase ? ' ' + esc(clase) : ''}" role="img" aria-label="${esc(texto)}"><span class="marcador-monograma" aria-hidden="true">TS</span><span class="marcador-texto">${esc(texto)}</span></span>`;
}

export function fotosDisponibles(lista, manifiesto) {
  return (lista || []).filter((f) => manifiesto && manifiesto[f]);
}

function filaMeta(s) {
  const partes = [];
  if (s.duracion) partes.push(`<span>${icono('clock')}${esc(s.duracion)}</span>`);
  if (s.sena) partes.push(`<span>${icono('hand-holding-dollar')}Seña ${esc(s.sena)}</span>`);
  return partes.length ? `<p class="tarjeta-meta">${partes.join('')}</p>` : '';
}

/** Tarjeta de servicio o curso para la grilla de una categoría. */
export function tarjetaServicio(s, manifiesto) {
  const fotos = fotosDisponibles(s.fotos, manifiesto);
  const media = fotos.length
    ? imagen(fotos[0], manifiesto, { alt: `${s.nombre}: trabajo de Tania Sanabria`, sizes: '(min-width: 1100px) 340px, (min-width: 700px) 45vw, 92vw', anchoMax: 960 })
    : marcador();
  const contador = fotos.length > 1 ? `<span class="tarjeta-contador">${icono('images')}${fotos.length} fotos</span>` : '';
  const precio = s.variantes ? s.variantes.map((v) => `${esc(v.precio)}`).join(' · ') : esc(s.precio);
  return `
<article class="tarjeta" id="servicio-${esc(s.id)}">
  <button type="button" class="tarjeta-media" data-detalle="${esc(s.id)}"><span class="solo-lector">Ver detalles de ${esc(s.nombre)}</span>${media}${contador}</button>
  <div class="tarjeta-cuerpo">
    <h3 class="tarjeta-titulo">${esc(s.nombre)}</h3>
    <p class="tarjeta-resumen">${esc(s.resumen)}</p>
    ${filaMeta(s)}
    <p class="tarjeta-precio">${precio}${s.precioNota ? ` <small>${esc(s.precioNota)}</small>` : ''}</p>
    <div class="tarjeta-acciones">
      <button type="button" class="btn btn-primario" data-reservar="${esc(s.variantes ? s.variantes[0].id : s.id)}">${esc(s.cta || 'Reservar')}</button>
      <button type="button" class="btn btn-texto" data-detalle="${esc(s.id)}">Ver detalles ${icono('chevron-right')}</button>
    </div>
  </div>
</article>`;
}

export function seccionCategoria(cat, servicios, manifiesto) {
  const lista = servicios.filter((s) => s.categoria === cat.id);
  return `
<section class="seccion${cat.tema ? ' tema-' + esc(cat.tema) : ''}" id="${esc(cat.id)}" aria-labelledby="titulo-${esc(cat.id)}">
  <div class="contenedor">
    <header class="seccion-cabecera">
      <p class="sobretitulo">${esc(cat.titulo)}</p>
      <h2 id="titulo-${esc(cat.id)}">${esc(cat.tituloSeccion)} <span class="acento">${esc(cat.resaltado)}</span></h2>
      <p class="seccion-bajada">${esc(cat.descripcion)}</p>
    </header>
    <div class="grilla">${lista.map((s) => tarjetaServicio(s, manifiesto)).join('')}
    </div>
  </div>
</section>`;
}

function listaDetalles(items) {
  if (!items || !items.length) return '';
  return `<ul class="lista-detalles">${items
    .map((d) => `<li>${icono(d.icono || 'check')}<span>${d.etiqueta ? `<strong>${esc(d.etiqueta)}:</strong> ` : ''}${esc(d.texto)}</span></li>`)
    .join('')}</ul>`;
}

/** Contenido del cuadro de detalle de un servicio. */
export function detalleServicio(s, manifiesto) {
  const fotos = fotosDisponibles(s.fotos, manifiesto);
  const galeria = fotos.length
    ? `<div class="tira-fotos" role="list">${fotos
        .map((f, i) => `<button type="button" role="listitem" class="tira-foto" data-lightbox="${esc(s.id)}" data-indice="${i}" aria-label="Ampliar foto ${i + 1} de ${fotos.length}">${imagen(f, manifiesto, { alt: `${s.nombre}, foto ${i + 1}`, sizes: '(min-width: 700px) 200px, 40vw', anchoMax: 480 })}</button>`)
        .join('')}</div>`
    : `<div class="tira-vacia">${marcador({ texto: 'Pronto vas a ver fotos de este servicio aquí' })}</div>`;

  const complemento = s.complemento
    ? `<div class="caja-complemento"><h4>${icono('gem')} ${esc(s.complemento.titulo)}</h4><p>${esc(s.complemento.texto)}</p></div>`
    : '';
  const detalles = s.detalles && s.detalles.length ? `<h4>${esc(s.detallesTitulo || 'Detalles')}</h4>${listaDetalles(s.detalles)}` : '';
  const secciones = (s.secciones || [])
    .map((sec) => `<h4>${esc(sec.titulo)}</h4>${listaDetalles(sec.items.map((t) => ({ icono: 'check', texto: t })))}`)
    .join('');
  const beneficios = s.beneficios && s.beneficios.length ? `<div class="caja-suave">${listaDetalles(s.beneficios)}</div>` : '';
  const normas = s.normas && s.normas.length ? `<div class="caja-normas">${listaDetalles(s.normas)}</div>` : '';

  const pie = s.variantes
    ? s.variantes
        .map((v) => `<div class="pie-opcion"><div><span class="pie-etiqueta">${esc(v.etiqueta)}</span><span class="pie-precio">${esc(v.precio)}</span></div><button type="button" class="btn btn-primario" data-reservar="${esc(v.id)}">${esc(s.cta || 'Reservar')}</button></div>`)
        .join('')
    : `<div class="pie-opcion"><div><span class="pie-etiqueta">${s.sena ? `Seña ${esc(s.sena)}` : 'Valor de referencia'}</span><span class="pie-precio">${esc(s.precio)}${s.precioNota ? ` <small>${esc(s.precioNota)}</small>` : ''}</span></div><button type="button" class="btn btn-primario" data-reservar="${esc(s.id)}">${esc(s.cta || 'Reservar')}</button></div>`;

  return `
<h2 class="dialogo-titulo" id="detalle-titulo">${esc(s.tituloDetalle || s.nombre)}</h2>
${s.subtitulo ? `<p class="dialogo-subtitulo">${esc(s.subtitulo)}</p>` : `<p class="dialogo-subtitulo">${esc(s.resumen)}</p>`}
${galeria}
${complemento}
${detalles}
${secciones}
${beneficios}
${normas}
<div class="dialogo-pie">${pie}
  <button type="button" class="btn btn-texto btn-compartir" data-compartir="servicio-${esc(s.id)}">${icono('share-nodes')} Compartir este servicio</button>
</div>`;
}

/** Galería principal: solo álbumes que tienen fotos; los vacíos se ocultan. */
export function galeriaPrincipal(galerias, manifiesto) {
  const conFotos = galerias
    .map((g) => ({ ...g, fotos: fotosDisponibles(g.fotos, manifiesto) }))
    .filter((g) => g.fotos.length);
  const proximos = galerias.filter((g) => !fotosDisponibles(g.fotos, manifiesto).length).map((g) => g.titulo);
  if (!conFotos.length) return marcador({ texto: 'Galería en preparación' });
  const chips = conFotos.length > 1
    ? `<div class="chips" role="tablist" aria-label="Álbumes">${conFotos.map((g, i) => `<button type="button" role="tab" class="chip" aria-selected="${i === 0}" data-album="${esc(g.id)}">${esc(g.titulo)} <span>${g.fotos.length}</span></button>`).join('')}</div>`
    : `<p class="album-nombre">${esc(conFotos[0].titulo)} · ${conFotos[0].fotos.length} fotos</p>`;
  const albumes = conFotos
    .map((g, gi) => `<div class="grilla-fotos" data-album-panel="${esc(g.id)}"${gi ? ' hidden' : ''}>${g.fotos
      .map((f, i) => `<button type="button" class="foto-celda" data-lightbox="galeria-${esc(g.id)}" data-indice="${i}" aria-label="Ampliar foto ${i + 1} de ${g.fotos.length} del álbum ${esc(g.titulo)}">${imagen(f, manifiesto, { alt: `${g.titulo}: foto ${i + 1}`, sizes: '(min-width: 1100px) 260px, (min-width: 700px) 30vw, 46vw', anchoMax: 480 })}</button>`)
      .join('')}</div>`)
    .join('');
  const nota = proximos.length
    ? `<p class="galeria-nota">${icono('wand-magic-sparkles')} Muy pronto sumamos nuevos álbumes: ${esc(proximos.join(', '))}.</p>`
    : '';
  return chips + albumes + nota;
}

/** Opciones agrupadas para el selector de servicio del formulario. */
export function opcionesServicio(categorias, servicios) {
  const grupos = categorias
    .map((c) => {
      const opciones = servicios
        .filter((s) => s.categoria === c.id)
        .flatMap((s) => (s.variantes ? s.variantes.map((v) => ({ id: v.id, nombre: `${s.nombre}: ${v.etiqueta}` })) : [{ id: s.id, nombre: s.nombre }]))
        .map((o) => `<option value="${esc(o.id)}">${esc(o.nombre)}</option>`)
        .join('');
      return `<optgroup label="${esc(c.titulo)}">${opciones}</optgroup>`;
    })
    .join('');
  return `<option value="">Elegí un servicio…</option>${grupos}<optgroup label="Otros"><option value="consulta">Consulta general</option></optgroup>`;
}

/**
 * Devuelve un mapa id → datos de reserva (nombre para el mensaje, precio, seña, acción, flags),
 * incluyendo variantes de cursos.
 */
export function indiceReservas(servicios) {
  const mapa = {};
  for (const s of servicios) {
    if (s.variantes) {
      for (const v of s.variantes) {
        mapa[v.id] = { id: v.id, servicioId: s.id, nombre: v.nombreReserva || s.nombre, precio: v.precioReserva || v.precio, sena: v.sena ?? '', accion: v.accion || s.accion, categoria: s.categoria };
      }
    } else {
      mapa[s.id] = { id: s.id, servicioId: s.id, nombre: s.nombreReserva || s.nombre, precio: s.precioReserva || s.precio, sena: s.sena ?? '', accion: s.accion, categoria: s.categoria, permiteTocado: !!s.permiteTocado, esEvento: !!s.esEvento };
    }
  }
  mapa.consulta = { id: 'consulta', nombre: 'Consulta general', precio: '', sena: '', accion: 'hacer una consulta', categoria: 'otros' };
  return mapa;
}
