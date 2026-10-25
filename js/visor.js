/*
 * visor.js: visor de fotos a pantalla completa.
 * - Deslizar a los costados para cambiar de foto (con la anterior y la siguiente ya cargadas).
 * - Pellizcar para hacer zoom, tocar dos veces para acercar/alejar, arrastrar para mover la foto ampliada.
 * - Rueda del mouse / botones + y − para zoom en escritorio; flechas del teclado; Esc o deslizar hacia abajo para cerrar.
 * Sin dependencias.
 */
const ZOOM_MAX = 4;
const DOBLE = 2.5;

export function crearVisor({ dlg, abrirDialogo, rutaFoto, manifiesto }) {
  const $ = (s) => dlg.querySelector(s);
  const escenario = $('#visor-escenario');
  const pista = $('#visor-pista');
  const estado = { fotos: [], indice: 0, titulo: '', s: 1, x: 0, y: 0 };
  pista.innerHTML = [0, 1, 2].map(() => '<div class="visor-slide"><div class="visor-zoom"><img alt="" draggable="false" decoding="async"></div><span class="visor-cargando" aria-hidden="true"></span></div>').join('');
  const slides = Array.from(pista.children);

  const man = () => manifiesto();
  function cargarEn(slide, base, prioridad) {
    const img = slide.querySelector('img');
    if (!base) { img.removeAttribute('src'); img.removeAttribute('srcset'); slide.dataset.base = ''; return; }
    if (slide.dataset.base === base) return;
    const info = man()[base];
    slide.dataset.base = base;
    slide.classList.add('cargando');
    img.onload = () => slide.classList.remove('cargando');
    img.onerror = () => slide.classList.remove('cargando');
    img.width = info.w; img.height = info.h;
    img.sizes = '100vw';
    img.srcset = info.anchos.map((a) => `${rutaFoto(base, a, info)} ${a}w`).join(', ');
    img.src = rutaFoto(base, info.anchos[info.anchos.length - 1], info);
    img.fetchPriority = prioridad ? 'high' : 'low';
    if (img.complete && img.naturalWidth) slide.classList.remove('cargando');
  }

  const n = () => estado.fotos.length;
  const idx = (k) => (k + n()) % n();
  function colocar() {
    const varias = n() > 1;
    cargarEn(slides[1], estado.fotos[estado.indice], true);
    cargarEn(slides[0], varias ? estado.fotos[idx(estado.indice - 1)] : null);
    cargarEn(slides[2], varias ? estado.fotos[idx(estado.indice + 1)] : null);
    slides[1].querySelector('img').alt = `${estado.titulo}: foto ${estado.indice + 1} de ${n()}`;
    pista.style.transition = 'none';
    pista.style.transform = 'translate3d(-100%,0,0)';
    escenario.style.removeProperty('--bajar');
    resetZoom(false);
    $('#visor-contador').textContent = `${estado.indice + 1} / ${n()}`;
    $('#visor-leyenda').textContent = estado.titulo ? `${estado.titulo} · Tania Sanabria Makeup Studio` : '';
    $('#visor-prev').hidden = !varias;
    $('#visor-sig').hidden = !varias;
  }

  // ---------- zoom ----------
  const zoomEl = () => slides[1].querySelector('.visor-zoom');
  const imgEl = () => slides[1].querySelector('img');
  function limites(s) {
    const img = imgEl(); const W = escenario.clientWidth; const H = escenario.clientHeight;
    const w = img.offsetWidth * s; const h = img.offsetHeight * s;
    return { x: Math.max(0, (w - W) / 2), y: Math.max(0, (h - H) / 2) };
  }
  function aplicar(animar) {
    const l = limites(estado.s);
    estado.x = Math.max(-l.x, Math.min(l.x, estado.x));
    estado.y = Math.max(-l.y, Math.min(l.y, estado.y));
    const z = zoomEl();
    z.style.transition = animar ? 'transform .28s cubic-bezier(.2,.8,.2,1)' : 'none';
    z.style.transform = `translate3d(${estado.x}px, ${estado.y}px, 0) scale(${estado.s})`;
    dlg.classList.toggle('ampliado', estado.s > 1.01);
  }
  function resetZoom(animar = true) { estado.s = 1; estado.x = 0; estado.y = 0; aplicar(animar); }
  // Zoom manteniendo fijo el punto (px, py) de la pantalla.
  function zoomA(s1, px, py, animar) {
    s1 = Math.max(1, Math.min(ZOOM_MAX, s1));
    const r = escenario.getBoundingClientRect();
    const mx = (px ?? r.left + r.width / 2) - (r.left + r.width / 2);
    const my = (py ?? r.top + r.height / 2) - (r.top + r.height / 2);
    const k = s1 / estado.s;
    estado.x = mx - (mx - estado.x) * k;
    estado.y = my - (my - estado.y) * k;
    estado.s = s1;
    if (s1 === 1) { estado.x = 0; estado.y = 0; }
    aplicar(animar);
  }

  // ---------- navegación ----------
  let ocupado = false;
  function mover(paso) {
    if (n() < 2 || ocupado) return;
    ocupado = true;
    resetZoom(false);
    pista.style.transition = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'transform .32s cubic-bezier(.2,.8,.2,1)';
    pista.style.transform = `translate3d(${paso > 0 ? -200 : 0}%,0,0)`;
    const fin = () => {
      ocupado = false;
      estado.indice = idx(estado.indice + paso);
      // Rotar los slides en lugar de recargar imágenes
      if (paso > 0) pista.append(slides.shift()); else pista.prepend(slides.pop());
      slides.splice(0, 3, ...pista.children);
      colocar();
    };
    if (pista.style.transition === 'none') fin(); else setTimeout(fin, 330);
  }

  // ---------- gestos ----------
  const punteros = new Map();
  let gesto = null; let ultimoTap = { t: 0, x: 0, y: 0 };
  escenario.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    escenario.setPointerCapture(e.pointerId);
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (punteros.size === 2) {
      const [a, b] = [...punteros.values()];
      gesto = { tipo: 'pinza', d0: Math.hypot(a.x - b.x, a.y - b.y), s0: estado.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x0: estado.x, y0: estado.y };
      pista.style.transition = 'none'; pista.style.transform = 'translate3d(-100%,0,0)';
    } else if (punteros.size === 1) {
      gesto = { tipo: null, x: e.clientX, y: e.clientY, x0: estado.x, y0: estado.y, t: performance.now() };
    }
  });
  escenario.addEventListener('pointermove', (e) => {
    if (!punteros.has(e.pointerId) || !gesto) return;
    punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesto.tipo === 'pinza' && punteros.size >= 2) {
      const [a, b] = [...punteros.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2;
      // Escala respecto al centro inicial + arrastre del centro
      const s1 = Math.max(1, Math.min(ZOOM_MAX, gesto.s0 * d / gesto.d0));
      const r = escenario.getBoundingClientRect();
      const mx = gesto.cx - (r.left + r.width / 2); const my = gesto.cy - (r.top + r.height / 2);
      const k = s1 / gesto.s0;
      estado.s = s1;
      estado.x = mx - (mx - gesto.x0) * k + (cx - gesto.cx);
      estado.y = my - (my - gesto.y0) * k + (cy - gesto.cy);
      aplicar(false);
      return;
    }
    const dx = e.clientX - gesto.x; const dy = e.clientY - gesto.y;
    if (!gesto.tipo && Math.hypot(dx, dy) > 8) gesto.tipo = estado.s > 1.01 ? 'mover' : Math.abs(dx) > Math.abs(dy) ? 'deslizar' : dy > 0 ? 'bajar' : 'nada';
    if (gesto.tipo === 'mover') { estado.x = gesto.x0 + dx; estado.y = gesto.y0 + dy; aplicar(false); }
    else if (gesto.tipo === 'deslizar' && n() > 1) { pista.style.transition = 'none'; pista.style.transform = `translate3d(calc(-100% + ${dx}px),0,0)`; }
    else if (gesto.tipo === 'bajar') { escenario.style.setProperty('--bajar', `${Math.max(0, dy)}px`); dlg.style.setProperty('--fondo', String(Math.max(0.25, 1 - dy / 500))); }
  });
  const soltar = (e) => {
    if (!punteros.has(e.pointerId)) return;
    punteros.delete(e.pointerId);
    if (!gesto) return;
    if (gesto.tipo === 'pinza') {
      if (punteros.size === 1) { const p = [...punteros.values()][0]; gesto = { tipo: 'mover', x: p.x, y: p.y, x0: estado.x, y0: estado.y }; }
      else { gesto = null; if (estado.s < 1.05) resetZoom(); }
      return;
    }
    if (punteros.size) return;
    const dx = e.clientX - gesto.x; const dy = e.clientY - gesto.y; const dt = performance.now() - gesto.t;
    if (gesto.tipo === 'deslizar' && n() > 1) {
      const rapido = Math.abs(dx) / Math.max(1, dt) > 0.45;
      if (Math.abs(dx) > escenario.clientWidth * 0.18 || (rapido && Math.abs(dx) > 30)) mover(dx < 0 ? 1 : -1);
      else { pista.style.transition = 'transform .25s ease'; pista.style.transform = 'translate3d(-100%,0,0)'; }
    } else if (gesto.tipo === 'bajar') {
      dlg.style.removeProperty('--fondo');
      if (dy > 110) dlg.close(); else escenario.style.removeProperty('--bajar');
    } else if (!gesto.tipo && e.type === 'pointerup') {
      // Toque: doble toque = zoom; toque simple fuera de la foto (sin zoom) = mostrar/ocultar controles
      const ahora = performance.now();
      if (ahora - ultimoTap.t < 320 && Math.hypot(e.clientX - ultimoTap.x, e.clientY - ultimoTap.y) < 30) {
        clearTimeout(ultimoTap.timer);
        if (estado.s > 1.01) resetZoom(); else zoomA(DOBLE, e.clientX, e.clientY, true);
        ultimoTap = { t: 0, x: 0, y: 0 };
      } else {
        const sobreFoto = e.target.tagName === 'IMG';
        ultimoTap = { t: ahora, x: e.clientX, y: e.clientY, timer: setTimeout(() => { if (!sobreFoto && estado.s <= 1.01) dlg.classList.toggle('sin-controles'); }, 330) };
      }
    }
    gesto = null;
  };
  escenario.addEventListener('pointerup', soltar);
  escenario.addEventListener('pointercancel', soltar);
  escenario.addEventListener('wheel', (e) => { e.preventDefault(); zoomA(estado.s * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY, false); }, { passive: false });
  escenario.addEventListener('dblclick', (e) => e.preventDefault());

  $('#visor-prev').addEventListener('click', () => mover(-1));
  $('#visor-sig').addEventListener('click', () => mover(1));
  $('#visor-mas').addEventListener('click', () => zoomA(estado.s * 1.6, null, null, true));
  $('#visor-menos').addEventListener('click', () => zoomA(estado.s / 1.6, null, null, true));
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); mover(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); mover(1); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomA(estado.s * 1.6, null, null, true); }
    else if (e.key === '-') { e.preventDefault(); zoomA(estado.s / 1.6, null, null, true); }
  });
  dlg.addEventListener('close', () => { resetZoom(false); dlg.classList.remove('sin-controles'); dlg.style.removeProperty('--fondo'); escenario.style.removeProperty('--bajar'); });
  window.addEventListener('resize', () => { if (dlg.open) aplicar(false); });

  return {
    abrir(fotos, indice, titulo, origen) {
      if (!fotos || !fotos.length) return;
      estado.fotos = fotos; estado.titulo = titulo || '';
      estado.indice = Math.max(0, Math.min(indice || 0, fotos.length - 1));
      slides.forEach((s) => { s.dataset.base = ''; });
      colocar();
      abrirDialogo(dlg, origen);
      dlg.focus();
    },
  };
}
