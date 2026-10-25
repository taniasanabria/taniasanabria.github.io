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

/**
 * Ruta de la foto en un ancho dado.
 * `info` es la entrada del manifiesto: si trae `url` (foto subida a Supabase Storage) se usa esa base;
 * si no, la foto está en img/ del repositorio.
 */
export function rutaFoto(base, ancho, info) {
  if (info && info.url) return `${info.url}-${ancho}.${info.ext || 'webp'}`;
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
  const src = rutaFoto(base, anchos[Math.min(1, anchos.length - 1)], info);
  const srcset = anchos.map((a) => `${rutaFoto(base, a, info)} ${a}w`).join(', ');
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
  if (s.categoria === 'academia') partes.push(`<span>${icono('hand-holding-dollar')}${esc(textoMatricula(s))}</span>`);
  else if (s.sena) partes.push(`<span>${icono('hand-holding-dollar')}Seña ${esc(s.sena)}</span>`);
  return partes.length ? `<p class="tarjeta-meta">${partes.join('')}</p>` : '';
}

/** Tarjeta de servicio o curso para la grilla de una categoría. */
export function tarjetaServicio(s, manifiesto) {
  const fotos = fotosDisponibles(s.fotos, manifiesto);
  const curso = s.categoria === 'academia';
  const tamano = '(min-width: 1100px) 340px, (min-width: 700px) 45vw, 92vw';
  const flyer = curso ? flyerCurso(s, manifiesto, { sizes: tamano, anchoMax: 960 }) : '';
  const media = flyer
    ? `<span class="flyer-fondo" aria-hidden="true">${imagen(s.flyer, manifiesto, { alt: '', sizes: '160px', anchoMax: 480 })}</span>${flyer}`
    : fotos.length
      ? imagen(fotos[0], manifiesto, { alt: `${s.nombre}: trabajo de Tania Sanabria`, sizes: tamano, anchoMax: 960 })
      : marcador();
  const contador = !flyer && fotos.length > 1 ? `<span class="tarjeta-contador">${icono('images')}${fotos.length} fotos</span>` : '';
  const precio = s.variantes ? s.variantes.map((v) => `${esc(v.precio)}`).join(' · ') : esc(s.precio);
  const nota = curso ? ' <small>· el curso</small>' : s.precioNota ? ` <small>${esc(s.precioNota)}</small>` : '';
  return `
<article class="tarjeta" id="servicio-${esc(s.id)}">
  <button type="button" class="tarjeta-media${flyer ? ' con-flyer' : ''}" data-detalle="${esc(s.id)}"><span class="solo-lector">Ver detalles de ${esc(s.nombre)}</span>${media}${contador}</button>
  <div class="tarjeta-cuerpo">
    <h3 class="tarjeta-titulo">${esc(s.nombre)}</h3>
    <p class="tarjeta-resumen">${esc(s.resumen)}</p>
    ${filaMeta(s)}
    <p class="tarjeta-precio">${precio}${nota}</p>
    <div class="tarjeta-acciones">
      <button type="button" class="btn btn-primario" data-reservar="${esc(s.variantes ? s.variantes[0].id : s.id)}">${esc(s.cta || 'Reservar')}</button>
      <button type="button" class="btn btn-texto" data-detalle="${esc(s.id)}">Ver detalles ${icono('chevron-right')}</button>
    </div>
  </div>
</article>`;
}

/** Nombre corto para los botones de subcategoría ("Maquillaje para Novias" → "Novias"). */
export function nombreCorto(s) {
  if (s.nombreCorto) return s.nombreCorto;
  return String(s.nombre)
    .replace(/^Maquillaje\s+(para\s+|de\s+)?/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/^Estación\s+/i, '')
    .replace(/^Experiencia\s+/i, '')
    .replace(/^Diseño y Perfilado de\s+/i, '')
    .trim() || s.nombre;
}

export function seccionCategoria(cat, servicios, manifiesto) {
  const lista = servicios.filter((s) => s.categoria === cat.id);
  const subs = lista.length > 2
    ? `<nav class="subcats" aria-label="Subcategorías de ${esc(cat.titulo)}"><a class="subcat activa" href="#${esc(cat.id)}" data-sub="" aria-current="true">Todos <span>${lista.length}</span></a>${lista
        .map((s) => `<a class="subcat" href="#${esc(cat.id)}/${esc(s.id)}" data-sub="${esc(s.id)}">${esc(nombreCorto(s))}</a>`)
        .join('')}</nav>`
    : '';
  return `
<section class="seccion vista${cat.tema ? ' tema-' + esc(cat.tema) : ''}" id="${esc(cat.id)}" data-vista="${esc(cat.id)}" aria-labelledby="titulo-${esc(cat.id)}">
  <div class="contenedor">
    <header class="seccion-cabecera">
      <p class="sobretitulo">${esc(cat.titulo)}</p>
      <h2 id="titulo-${esc(cat.id)}">${esc(cat.tituloSeccion)} <span class="acento">${esc(cat.resaltado)}</span></h2>
      <p class="seccion-bajada">${esc(cat.descripcion)}</p>
    </header>
    ${subs}
    <div class="grilla">${lista.map((s) => tarjetaServicio(s, manifiesto)).join('')}
    </div>
  </div>
</section>`;
}

/**
 * Carrusel 3D (coverflow) con luz LED detrás de cada foto. Cada foto es un botón que abre el visor
 * (data-lightbox + data-indice). Sin JS se ve como una tira deslizable con scroll horizontal.
 */
export function carrusel(clave, fotos, manifiesto, { titulo = '', etiqueta = '' } = {}) {
  if (!fotos.length) return '';
  return `<div class="carrusel" data-carrusel="${esc(clave)}" role="region" aria-roledescription="carrusel" aria-label="${esc(etiqueta || titulo)}">
  <div class="carrusel-pista">${fotos
    .map((f, i) => `<button type="button" class="carrusel-item" data-lightbox="${esc(clave)}" data-indice="${i}" aria-label="Ampliar foto ${i + 1} de ${fotos.length}${titulo ? ' · ' + esc(titulo) : ''}"><span class="carrusel-led" aria-hidden="true"></span><span class="carrusel-marco">${imagen(f, manifiesto, { alt: `${titulo}: foto ${i + 1}`, sizes: '(min-width: 900px) 340px, 64vw', anchoMax: 960 })}</span></button>`)
    .join('')}</div>
  ${fotos.length > 1 ? `<button type="button" class="carrusel-flecha prev" aria-label="Foto anterior" hidden>${icono('chevron-left')}</button><button type="button" class="carrusel-flecha sig" aria-label="Foto siguiente" hidden>${icono('chevron-right')}</button><div class="carrusel-puntos" aria-hidden="true"></div>` : ''}
</div>`;
}

function listaDetalles(items) {
  if (!items || !items.length) return '';
  return `<ul class="lista-detalles">${items
    .map((d) => `<li>${icono(d.icono || 'check')}<span>${d.etiqueta ? `<strong>${esc(d.etiqueta)}:</strong> ` : ''}${esc(d.texto)}</span></li>`)
    .join('')}</ul>`;
}

const NUM = '(\\d{1,3}(?:\\.\\d{3})+|\\d+)';
const aNumero = (m) => (m ? Number(m[1].replace(/\./g, '')) : null);
export const formatoGs = (n) => 'Gs. ' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Matrícula de un curso o de una opción (Gs.; null = sin matrícula). Misma regla que
 * public._matricula_de en supabase/cursos.sql: número en `matricula`, o el número del texto `sena`.
 * Al inscribirse se paga SOLO la matrícula; el curso se abona aparte, durante el curso.
 */
export function matriculaDe(o) {
  if (!o) return null;
  if (typeof o.matricula === 'number') return o.matricula > 0 ? o.matricula : null;
  const n = aNumero(String(o.sena || '').match(new RegExp(NUM)));
  return n > 0 ? n : null;
}

/** Opciones de inscripción de un curso: una por variante, o el curso mismo. */
export function opcionesCurso(s) {
  const op = (o, datos) => {
    const precio = String(o.precio || '').trim();
    return { ...datos, precioVisible: precio, matricula: matriculaDe(o), cursoGs: aNumero(precio.match(new RegExp(NUM))), mensual: /(mensual|\/\s*mes|por mes)/i.test(precio) };
  };
  return s.variantes && s.variantes.length
    ? s.variantes.map((v) => op(v, { id: v.id, etiqueta: v.etiqueta, nombre: v.nombreReserva || `${s.nombre}: ${v.etiqueta}` }))
    : [op(s, { id: s.id, etiqueta: '', nombre: s.nombreReserva || s.nombre })];
}

/** "El curso (Gs. 350.000) se abona aparte…" para una opción de opcionesCurso(). */
export function cursoAparte(o) {
  return o.precioVisible ? `El curso (${o.precioVisible}) se abona aparte, durante el curso, directamente a Tania.` : 'El valor del curso se abona aparte, durante el curso, directamente a Tania.';
}

/** Matrícula para mostrar en la tarjeta: "Matrícula Gs. 100.000", "Sin matrícula" o la menor de las opciones. */
export function textoMatricula(s) {
  const ms = opcionesCurso(s).map((o) => o.matricula);
  const con = ms.filter(Boolean);
  if (!con.length) return 'Sin matrícula';
  const min = Math.min(...con);
  return con.length === ms.length && con.every((m) => m === min) ? `Matrícula ${formatoGs(min)}` : `Matrícula desde ${formatoGs(min)}`;
}

/** Ficha del curso: modalidad, lo que se paga al inscribirse (solo matrícula) y el valor del curso (aparte). */
export function fichaCurso(s) {
  const filas = [];
  const modalidad = s.modalidad || s.subtitulo;
  if (modalidad) filas.push(['Modalidad', esc(modalidad)]);
  const ops = opcionesCurso(s);
  for (const o of ops) {
    const inscripcion = o.matricula
      ? `Matrícula <strong>${formatoGs(o.matricula)}</strong> para inscribirte`
      : '<strong>Sin matrícula</strong>: te inscribís sin pagar y Tania te confirma el lugar';
    const curso = o.precioVisible ? `<br><small>Curso: <strong>${esc(o.precioVisible)}</strong> · se abona aparte, durante el curso</small>` : '';
    filas.push([o.etiqueta ? esc(o.etiqueta) : 'Inscripción', inscripcion + curso]);
  }
  filas.push(['Pago', ops.some((o) => o.matricula)
    ? 'La matrícula se paga por transferencia o QR: los datos aparecen al confirmar tu inscripción. El curso se abona aparte, durante el curso, directamente a Tania.'
    : 'No pagás nada para inscribirte. El curso se abona aparte, directamente a Tania.']);
  return `<dl class="ficha-curso">${filas.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

/** Flyer del curso (imagen completa, sin recortar). `clave` es la entrada del manifiesto. */
export function flyerCurso(s, manifiesto, { sizes = '(min-width: 700px) 560px, 92vw', anchoMax } = {}) {
  const info = s.flyer && manifiesto && manifiesto[s.flyer];
  if (!info) return '';
  return imagen(s.flyer, manifiesto, { alt: `Flyer: ${s.nombre}`, sizes, clase: 'flyer', anchoMax });
}

/** Contenido del cuadro de detalle de un servicio. */
export function detalleServicio(s, manifiesto) {
  const fotos = fotosDisponibles(s.fotos, manifiesto);
  const galeria = fotos.length
    ? carrusel(s.id, fotos, manifiesto, { titulo: s.nombre, etiqueta: `Fotos de ${s.nombre}` })
    : `<div class="tira-vacia">${marcador({ texto: 'Pronto vas a ver fotos de este servicio aquí' })}</div>`;

  const complemento = s.complemento
    ? `<div class="caja-complemento"><h3 class="sub">${icono('gem')} ${esc(s.complemento.titulo)}</h3><p>${esc(s.complemento.texto)}</p></div>`
    : '';
  const detalles = s.detalles && s.detalles.length ? `<h3 class="sub">${esc(s.detallesTitulo || 'Detalles')}</h3>${listaDetalles(s.detalles)}` : '';
  const secciones = (s.secciones || [])
    .map((sec) => `<h3 class="sub">${esc(sec.titulo)}</h3>${listaDetalles(sec.items.map((t) => ({ icono: 'check', texto: t })))}`)
    .join('');
  const beneficios = s.beneficios && s.beneficios.length ? `<div class="caja-suave">${listaDetalles(s.beneficios)}</div>` : '';
  const normas = s.normas && s.normas.length ? `<div class="caja-normas">${listaDetalles(s.normas)}</div>` : '';

  const pie = s.variantes
    ? s.variantes
        .map((v) => `<div class="pie-opcion"><div><span class="pie-etiqueta">${esc(v.etiqueta)}</span><span class="pie-precio">${esc(v.precio)}</span></div><button type="button" class="btn btn-primario" data-reservar="${esc(v.id)}">${esc(s.cta || 'Reservar')}</button></div>`)
        .join('')
    : `<div class="pie-opcion"><div><span class="pie-etiqueta">${s.categoria === 'academia' ? esc(textoMatricula(s)) : s.sena ? `Seña ${esc(s.sena)}` : 'Valor de referencia'}</span><span class="pie-precio">${esc(s.precio)}${s.categoria === 'academia' ? ' <small>el curso, aparte</small>' : s.precioNota ? ` <small>${esc(s.precioNota)}</small>` : ''}</span></div><button type="button" class="btn btn-primario" data-reservar="${esc(s.id)}">${esc(s.cta || 'Reservar')}</button></div>`;

  const curso = s.categoria === 'academia';
  const flyer = curso ? flyerCurso(s, manifiesto) : '';
  const flyerHtml = flyer ? `<figure class="flyer-detalle"><a href="${esc(rutaFoto(s.flyer, manifiesto[s.flyer].anchos[manifiesto[s.flyer].anchos.length - 1], manifiesto[s.flyer]))}" target="_blank" rel="noopener" aria-label="Ver el flyer de ${esc(s.nombre)} en grande">${flyer}</a></figure>` : '';
  return `
<h2 class="dialogo-titulo" id="detalle-titulo">${esc(s.tituloDetalle || s.nombre)}</h2>
${s.subtitulo && !curso ? `<p class="dialogo-subtitulo">${esc(s.subtitulo)}</p>` : `<p class="dialogo-subtitulo">${esc(s.resumen)}</p>`}
${flyerHtml}
${curso ? fichaCurso(s) : ''}
${flyer && !fotos.length ? '' : galeria}
${complemento}
${detalles}
${secciones}
${beneficios}
${normas}
<div class="dialogo-pie">${pie}
  <button type="button" class="btn btn-texto btn-compartir" data-compartir="servicio-${esc(s.id)}">${icono('share-nodes')} Compartir este servicio</button>
</div>`;
}

/** Inicio: carrusel con los trabajos destacados (primer álbum con fotos). */
export function seccionDestacados(galerias, manifiesto) {
  const g = galerias.map((x) => ({ ...x, fotos: fotosDisponibles(x.fotos, manifiesto) })).find((x) => x.fotos.length);
  if (!g) return '';
  return `<section class="seccion seccion-destacados vista" id="destacados" data-vista="inicio" aria-labelledby="titulo-destacados">
  <div class="contenedor">
    <header class="seccion-cabecera">
      <p class="sobretitulo">Portafolio</p>
      <h2 id="titulo-destacados">Trabajos <span class="acento">destacados</span></h2>
    </header>
    ${carrusel('galeria-' + g.id, g.fotos, manifiesto, { titulo: g.titulo, etiqueta: 'Trabajos destacados' })}
    <p class="centrado destacados-mas"><a class="btn btn-secundario" href="#galeria">${icono('images')} Ver toda la galería</a></p>
  </div>
</section>`;
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
    .map((g, gi) => `<div class="album-panel" data-album-panel="${esc(g.id)}"${gi ? ' hidden' : ''}>${carrusel('galeria-' + g.id, g.fotos, manifiesto, { titulo: g.titulo, etiqueta: `Álbum ${g.titulo}` })}</div>`)
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
        mapa[v.id] = { id: v.id, servicioId: s.id, nombre: v.nombreReserva || s.nombre, precio: v.precioReserva || v.precio, sena: v.sena ?? '', accion: v.accion || s.accion, categoria: s.categoria, usaTurno: s.usaTurno === true };
      }
    } else {
      mapa[s.id] = { id: s.id, servicioId: s.id, nombre: s.nombreReserva || s.nombre, precio: s.precioReserva || s.precio, sena: s.sena ?? '', accion: s.accion, categoria: s.categoria, permiteTocado: !!s.permiteTocado, esEvento: !!s.esEvento, usaTurno: s.usaTurno === true };
    }
  }
  mapa.consulta = { id: 'consulta', nombre: 'Consulta general', precio: '', sena: '', accion: 'hacer una consulta', categoria: 'otros', usaTurno: false };
  return mapa;
}
