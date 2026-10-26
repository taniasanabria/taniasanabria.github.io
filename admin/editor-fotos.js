/*
 * Editor de fotos del Panel de Tania (sin dependencias, todo en <canvas>).
 * Recortar (libre, 1:1, 4:5, 16:9, original), girar, espejar, filtros con intensidad,
 * ajustes (exposición, brillo, contraste, luces, sombras, saturación, calidez, tinte,
 * nitidez, desenfoque, grano), viñeta graduable (oscura o clara, tamaño, suavidad, centro)
 * y "Agregar logo" (arrastrar con el dedo, achicar con pellizco o con la esquina, opacidad).
 *
 *   const r = await editarImagen(fuente, { titulo, acciones: [{ id: 'reemplazar', texto: 'Guardar' }, …] });
 *   // r = null (canceló) o { accion, blob, ancho, alto }   (blob JPEG de alta calidad, lado mayor ≤ 2000 px)
 *
 * "fuente" puede ser un File/Blob o una URL (las del bucket público "fotos" permiten CORS).
 */
const LOGO_TANIA = new URL('../img/logo-marca.webp', import.meta.url).href;
const MAX_LADO = 2000;
const MAX_VISTA = 1400;
const MAX_PROC = 900; // la vista previa de ajustes se procesa a este tamaño (fluido en el celular)
const AJUSTES = [ // [clave, texto, grupo, mínimo]
  ['exposicion', 'Exposición', 'luz', -100], ['brillo', 'Brillo', 'luz', -100], ['contraste', 'Contraste', 'luz', -100],
  ['luces', 'Luces', 'luz', -100], ['sombras', 'Sombras', 'luz', -100],
  ['saturacion', 'Saturación', 'color', -100], ['calidez', 'Calidez', 'color', -100], ['tinte', 'Tinte', 'color', -100],
  ['nitidez', 'Nitidez', 'detalle', 0], ['desenfoque', 'Desenfoque', 'detalle', 0], ['grano', 'Grano', 'detalle', 0],
];
const GRUPOS = [['luz', '☀️ Luz'], ['color', '🌡️ Color'], ['detalle', '🔍 Detalle']];
const aj0 = () => Object.fromEntries(AJUSTES.map(([k]) => [k, 0]));
const vin0 = () => ({ fuerza: 0, tam: 50, suave: 60, cx: 0.5, cy: 0.5 });
// Filtros: valores que se suman a los ajustes (escalados por la intensidad). mono/sepia/glow 0..1, vin = viñeta.
const FILTROS = [
  ['ninguno', 'Original', {}],
  ['natural', 'Natural', { contraste: 8, saturacion: 8, calidez: 5, luces: -12, sombras: 12, nitidez: 15 }],
  ['calido', 'Cálido', { calidez: 38, tinte: 6, saturacion: 10, exposicion: 5 }],
  ['glam', 'Glam', { contraste: 24, saturacion: 18, calidez: 12, luces: -18, sombras: 8, nitidez: 35, vin: 35 }],
  ['byn', 'B&N', { mono: 1, contraste: 22, sombras: -5 }],
  ['vintage', 'Vintage', { sepia: 0.45, contraste: -14, saturacion: -20, sombras: 28, grano: 28, vin: 30 }],
  ['suave', 'Suave', { glow: 0.5, exposicion: 6, contraste: -10, calidez: 8, luces: -8 }],
  ['frio', 'Frío', { calidez: -32, tinte: -4, contraste: 10, saturacion: -4 }],
  ['dorado', 'Dorado', { calidez: 26, tinte: 10, saturacion: 16, sombras: 12, vin: 22 }],
];
const RATIOS = [['libre', 'Libre'], ['original', 'Original'], ['1', '1:1'], ['0.8', '4:5'], ['1.7778', '16:9']];

let dlg;
function crearDialogo() {
  dlg = document.createElement('dialog');
  dlg.id = 'dlg-editor';
  dlg.className = 'editor';
  dlg.innerHTML = `
  <div class="ed-barra">
    <button type="button" class="ed-btn-txt" data-ed="cancelar">Cancelar</button>
    <strong class="ed-titulo">Editar foto</strong>
    <span class="ed-acciones"></span>
  </div>
  <div class="ed-escena"><canvas class="ed-lienzo" aria-label="Vista previa de la foto"></canvas><button type="button" class="ed-comparar" data-ed="comparar" aria-label="Mantener presionado para ver la original">👁 Ver original</button><div class="ed-ocupado" hidden>⏳ Procesando…</div></div>
  <div class="ed-panel" data-panel="recortar">
    <div class="ed-chips" role="group" aria-label="Proporción del recorte">${RATIOS.map(([v, t]) => `<button type="button" class="ed-chip" data-ratio="${v}">${t}</button>`).join('')}</div>
    <p class="ed-ayuda">Arrastrá el recuadro o sus esquinas.</p>
  </div>
  <div class="ed-panel" data-panel="girar" hidden>
    <div class="ed-chips">
      <button type="button" class="ed-chip" data-ed="izq">⟲ Girar izq.</button>
      <button type="button" class="ed-chip" data-ed="der">⟳ Girar der.</button>
      <button type="button" class="ed-chip" data-ed="espejoH">⇋ Espejo</button>
      <button type="button" class="ed-chip" data-ed="espejoV">⇵ Voltear</button>
    </div>
  </div>
  <div class="ed-panel" data-panel="filtros" hidden>
    <div class="ed-filtros" role="group" aria-label="Filtros">${FILTROS.map(([id, t]) => `<button type="button" class="ed-filtro" data-filtro="${id}"><canvas width="72" height="72"></canvas><span>${t}</span></button>`).join('')}</div>
    <label class="ed-slider ed-fil-int">Intensidad <input type="range" min="0" max="100" value="80" data-fil="int"><output>80</output></label>
    <button type="button" class="ed-chip ed-reset" data-ed="resetFiltro">↺ Restablecer</button>
  </div>
  <div class="ed-panel ed-scroll" data-panel="ajustes" hidden>
    <div class="ed-chips" role="group" aria-label="Grupo de ajustes">${GRUPOS.map(([g, t], i) => `<button type="button" class="ed-chip" data-grupo="${g}" aria-pressed="${i === 0}">${t}</button>`).join('')}</div>
    ${GRUPOS.map(([g], i) => `<div class="ed-grupo" data-g="${g}"${i ? ' hidden' : ''}>${AJUSTES.filter((a) => a[2] === g).map(([k, t, , min]) => `<label class="ed-slider">${t} <input type="range" min="${min}" max="100" value="0" data-ajuste="${k}"><output>0</output></label>`).join('')}</div>`).join('')}
    <button type="button" class="ed-chip ed-reset" data-ed="resetAjustes">↺ Restablecer ajustes</button>
  </div>
  <div class="ed-panel ed-scroll" data-panel="vineta" hidden>
    <label class="ed-slider">Intensidad <input type="range" min="-100" max="100" value="0" data-vin="fuerza"><output>0</output></label>
    <label class="ed-slider">Tamaño <input type="range" min="0" max="100" value="50" data-vin="tam"><output>50</output></label>
    <label class="ed-slider">Suavidad <input type="range" min="0" max="100" value="60" data-vin="suave"><output>60</output></label>
    <p class="ed-ayuda">Positivo = bordes oscuros · Negativo = bordes claros (blanco). Tocá o arrastrá sobre la foto para mover el centro.</p>
    <div class="ed-chips"><button type="button" class="ed-chip" data-ed="vinCentrar">⊙ Centrar</button><button type="button" class="ed-chip ed-reset" data-ed="resetVineta">↺ Restablecer</button></div>
  </div>
  <div class="ed-panel" data-panel="logo" hidden>
    <div class="ed-chips">
      <button type="button" class="ed-chip" data-ed="logoTania">✨ Logo de Tania</button>
      <label class="ed-chip ed-subir">📁 Otro PNG<input type="file" accept="image/png,image/webp,image/svg+xml" data-ed="logoArchivo"></label>
      <button type="button" class="ed-chip" data-ed="logoQuitar" hidden>Quitar logo</button>
    </div>
    <div class="ed-logo-ctrl" hidden>
      <label class="ed-slider">Tamaño <input type="range" min="4" max="90" value="22" data-logo="tam"><output></output></label>
      <label class="ed-slider">Opacidad <input type="range" min="10" max="100" value="90" data-logo="op"><output></output></label>
    </div>
    <p class="ed-ayuda">Arrastrá el logo con el dedo. Pellizcá o usá la esquina para cambiar el tamaño.</p>
  </div>
  <nav class="ed-tabs" role="tablist">
    <button type="button" role="tab" data-tab="recortar" aria-selected="true"><span aria-hidden="true">✂️</span>Recortar</button>
    <button type="button" role="tab" data-tab="girar"><span aria-hidden="true">🔄</span>Girar</button>
    <button type="button" role="tab" data-tab="filtros"><span aria-hidden="true">🎨</span>Filtros</button>
    <button type="button" role="tab" data-tab="ajustes"><span aria-hidden="true">🎚️</span>Ajustes</button>
    <button type="button" role="tab" data-tab="vineta"><span aria-hidden="true">◐</span>Viñeta</button>
    <button type="button" role="tab" data-tab="logo"><span aria-hidden="true">🏷️</span>Logo</button>
  </nav>`;
  document.body.append(dlg);
}

const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
/* ---------- utilidades de imagen ---------- */
async function cargarBitmap(fuente) {
  let blob = fuente;
  if (typeof fuente === 'string') {
    const r = await fetch(fuente, { mode: 'cors', cache: 'reload' });
    if (!r.ok) throw new Error('No se pudo descargar la foto (' + r.status + ').');
    blob = await r.blob();
  }
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch {
    // SVG u otros formatos que createImageBitmap no acepta directo.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth || 512; c.height = img.naturalHeight || 512;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c;
    } catch { throw new Error('No se pudo leer esta imagen. Probá con JPG o PNG.'); }
    finally { URL.revokeObjectURL(url); }
  }
}
/** Dibuja la imagen girada/espejada a escala k. */
function base(bmp, rot, fh, fv, k) {
  const w = bmp.width, h = bmp.height;
  const gira = rot % 180 !== 0;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((gira ? h : w) * k)); c.height = Math.max(1, Math.round((gira ? w : h) * k));
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.translate(c.width / 2, c.height / 2);
  x.rotate((rot * Math.PI) / 180);
  x.scale(fh ? -1 : 1, fv ? -1 : 1);
  x.drawImage(bmp, (-w * k) / 2, (-h * k) / 2, w * k, h * k);
  return c;
}
/** Desenfoque de caja (3 pasadas ≈ gaussiano) sobre RGBA, radio en píxeles. */
function desenfocar(src, w, h, r) {
  r = Math.round(r); if (r < 1) return new Uint8ClampedArray(src);
  let a = new Uint8ClampedArray(src), b = new Uint8ClampedArray(src.length);
  const pasada = (o, d, horiz) => {
    const n = horiz ? w : h, m = horiz ? h : w, div = r * 2 + 1;
    for (let j = 0; j < m; j++) {
      const idx = (k) => 4 * (horiz ? j * w + k : k * w + j);
      for (let c = 0; c < 3; c++) {
        let suma = 0;
        for (let k = -r; k <= r; k++) suma += o[idx(Math.min(n - 1, Math.max(0, k))) + c];
        for (let k = 0; k < n; k++) {
          d[idx(k) + c] = suma / div;
          suma += o[idx(Math.min(n - 1, k + r + 1)) + c] - o[idx(Math.max(0, k - r)) + c];
        }
      }
      for (let k = 0; k < n; k++) d[idx(k) + 3] = o[idx(k) + 3];
    }
  };
  for (let p = 0; p < 2; p++) { pasada(a, b, true); pasada(b, a, false); }
  return a;
}
/** Combina los ajustes del usuario con el filtro elegido (escalado por intensidad). */
function efectivos(st) {
  const f = (FILTROS.find((x) => x[0] === st.filtro) || FILTROS[0])[2], k = st.filInt / 100;
  const e = { ...st.aj, mono: 0, sepia: 0, glow: 0 };
  for (const [c, v] of Object.entries(f)) if (c !== 'vin') e[c] = (e[c] || 0) + v * k;
  const vin = { ...st.vin, fuerza: limitar(st.vin.fuerza + (f.vin || 0) * k, -100, 100) };
  return { e, vin };
}
const neutro = (e, vin) => !vin.fuerza && Object.values(e).every((v) => !v);
/** Aplica filtro + ajustes + viñeta a un canvas. Todo se expresa relativo al tamaño, así la vista previa y la foto final coinciden. */
function procesar(c, st) {
  const { e, vin } = efectivos(st);
  if (neutro(e, vin)) return;
  const w = c.width, h = c.height, L = Math.max(w, h);
  const x = c.getContext('2d');
  const im = x.getImageData(0, 0, w, h); let d = im.data;
  if (e.desenfoque > 0) d.set(desenfocar(d, w, h, (e.desenfoque / 100) * 0.012 * L));
  if (e.nitidez > 0) {
    const bl = desenfocar(d, w, h, Math.max(1, 0.0016 * L)), amt = (e.nitidez / 100) * 1.6;
    for (let i = 0; i < d.length; i += 4) for (let c2 = 0; c2 < 3; c2++) d[i + c2] = d[i + c2] + (d[i + c2] - bl[i + c2]) * amt;
  }
  let glow = null;
  if (e.glow > 0) glow = desenfocar(d, w, h, 0.02 * L);
  const ex = Math.pow(2, (e.exposicion / 100) * 1.3), br = e.brillo * 0.5, ct = 1 + (e.contraste / 100) * (e.contraste > 0 ? 0.8 : 0.6);
  const sat = 1 + e.saturacion / 100, tmp = e.calidez * 0.28, tn = e.tinte * 0.22;
  const lu = e.luces * 0.7, so = e.sombras * 0.7, gr = e.grano * 0.45, mono = limitar(e.mono, 0, 1), sep = limitar(e.sepia, 0, 1), gl = limitar(e.glow, 0, 1);
  const vf = vin.fuerza / 100, vIn = (vin.tam / 100) * 0.85, vOut = vIn + 0.08 + (vin.suave / 100) * 0.9;
  const asp = w / h, rx = asp >= 1 ? 1 : asp, ry = asp >= 1 ? 1 / asp : 1;
  for (let py = 0, i = 0; py < h; py++) {
    const dy = ((py + 0.5) / h - vin.cy) * 2 * ry;
    for (let px = 0; px < w; px++, i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (glow) { // "beauty glow": mezcla en modo trama con la versión difusa
        r = r + (255 - r) * (glow[i] / 255) * gl * 0.6; g = g + (255 - g) * (glow[i + 1] / 255) * gl * 0.6; b = b + (255 - b) * (glow[i + 2] / 255) * gl * 0.6;
      }
      r = r * ex + br + tmp + tn * 0.5; g = g * ex + br - tn; b = b * ex + br - tmp + tn * 0.5;
      let l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (lu || so) {
        const lc = limitar(l, 0, 1), dd = lu * lc * lc + so * (1 - lc) * (1 - lc);
        r += dd; g += dd; b += dd;
      }
      r = (r - 128) * ct + 128; g = (g - 128) * ct + 128; b = (b - 128) * ct + 128;
      l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const s2 = sat * (1 - mono);
      r = l + (r - l) * s2; g = l + (g - l) * s2; b = l + (b - l) * s2;
      if (sep) {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
        r += (sr - r) * sep; g += (sg - g) * sep; b += (sb - b) * sep;
      }
      if (vf) {
        const dx = ((px + 0.5) / w - vin.cx) * 2 * rx, dist = Math.sqrt(dx * dx + dy * dy) / 1.2;
        let t = limitar((dist - vIn) / (vOut - vIn), 0, 1); t = t * t * (3 - 2 * t);
        const a = Math.abs(vf) * t;
        if (vf > 0) { r *= 1 - a; g *= 1 - a; b *= 1 - a; } else { r += (255 - r) * a; g += (255 - g) * a; b += (255 - b) * a; }
      }
      if (gr) { // grano estable: depende de la posición relativa, no del azar
        const qx = Math.floor((px / w) * 1400), qy = Math.floor((py / h) * 1400);
        let hs = (qx * 374761393 + qy * 668265263) | 0; hs = Math.imul(hs ^ (hs >>> 13), 1274126177);
        const n = (((hs ^ (hs >>> 16)) & 1023) / 1023 - 0.5) * gr;
        r += n; g += n; b += n;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }
  x.putImageData(im, 0, 0);
}

/* ---------- editor ---------- */
export async function editarImagen(fuente, opciones = {}) {
  if (!dlg) crearDialogo();
  const $ = (s) => dlg.querySelector(s);
  const $$ = (s) => Array.from(dlg.querySelectorAll(s));
  const lienzo = $('.ed-lienzo'); const ctx = lienzo.getContext('2d');
  const ocupado = $('.ed-ocupado');
  const acciones = opciones.acciones || [{ id: 'guardar', texto: 'Guardar' }];
  $('.ed-titulo').textContent = opciones.titulo || 'Editar foto';
  $('.ed-acciones').innerHTML = acciones.map((a, i) => `<button type="button" class="${i === acciones.length - 1 ? 'ed-btn-ok' : 'ed-btn-txt'}" data-accion="${a.id}">${a.texto}</button>`).join('');
  ocupado.hidden = false;
  if (!dlg.open) dlg.showModal();

  let bmp;
  try { bmp = await cargarBitmap(fuente); } catch (e) { dlg.close(); throw e; }

  const st = {
    tab: 'recortar', rot: 0, fh: false, fv: false,
    aj: aj0(), vin: vin0(), filtro: 'ninguno', filInt: 80, original: false, grupo: 'luz',
    ratio: opciones.ratio || 'libre',
    crop: { x: 0, y: 0, w: 1, h: 1 },       // normalizado sobre la imagen girada
    logo: null,                               // { img, x, y (centro, 0..1 del recorte), s (ancho / ancho recorte), op }
  };
  dlg.estado = st; // útil para pruebas automáticas
  let vista, vistaAj; // vista previa girada (≤ MAX_VISTA) y su versión ajustada
  let geo = null;     // cómo se mapea la imagen en el lienzo
  const ac = new AbortController(); const on = (el, ev, fn, o = {}) => el.addEventListener(ev, fn, { ...o, signal: ac.signal });

  function rehacerVista() {
    const k = Math.min(1, MAX_VISTA / Math.max(bmp.width, bmp.height));
    vista = base(bmp, st.rot, st.fh, st.fv, k);
    rehacerAjustes();
  }
  let vistaPeq; // vista reducida (≤ MAX_PROC) sobre la que se calcula la vista previa de los efectos
  function rehacerAjustes() {
    const k = Math.min(1, MAX_PROC / Math.max(vista.width, vista.height));
    if (!vistaPeq || vistaPeq.fuente !== vista) {
      vistaPeq = document.createElement('canvas'); vistaPeq.fuente = vista;
      vistaPeq.width = Math.round(vista.width * k); vistaPeq.height = Math.round(vista.height * k);
      const g = vistaPeq.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(vista, 0, 0, vistaPeq.width, vistaPeq.height);
    }
    // Se procesa solo la parte recortada (así la viñeta y el centro corresponden a la foto final).
    const c = st.crop, sx = Math.round(c.x * vistaPeq.width), sy = Math.round(c.y * vistaPeq.height);
    const cw = Math.max(1, Math.round(c.w * vistaPeq.width)), ch = Math.max(1, Math.round(c.h * vistaPeq.height));
    vistaAj = document.createElement('canvas'); vistaAj.width = cw; vistaAj.height = ch;
    vistaAj.getContext('2d').drawImage(vistaPeq, sx, sy, cw, ch, 0, 0, cw, ch); procesar(vistaAj, st);
    ajSucio = false;
  }
  let ajSucio = true;
  function miniaturas() {
    const t = 144, c = document.createElement('canvas'); c.width = t; c.height = t;
    const src = vistaPeq || vista, lado = Math.min(src.width, src.height);
    c.getContext('2d').drawImage(src, (src.width - lado) / 2, (src.height - lado) / 2, lado, lado, 0, 0, t, t);
    $$('[data-filtro]').forEach((b) => {
      const m = document.createElement('canvas'); m.width = t; m.height = t; m.getContext('2d').drawImage(c, 0, 0);
      procesar(m, { aj: aj0(), vin: vin0(), filtro: b.dataset.filtro, filInt: 100 });
      const cv = b.querySelector('canvas'); cv.width = t; cv.height = t; cv.getContext('2d').drawImage(m, 0, 0);
    });
  }
  const ratioNum = () => (st.ratio === 'libre' ? null : st.ratio === 'original' ? vista.width / vista.height : Number(st.ratio));
  function aplicarRatio() {
    const r = ratioNum();
    if (!r) { st.crop = { x: 0, y: 0, w: 1, h: 1 }; return; }
    const W = vista.width, H = vista.height;
    let w = W, h = W / r; if (h > H) { h = H; w = H * r; }
    st.crop = { x: (W - w) / 2 / W, y: (H - h) / 2 / H, w: w / W, h: h / H };
  }

  function dibujar() {
    const esc = dlg.querySelector('.ed-escena');
    const dpr = window.devicePixelRatio || 1;
    const cw = esc.clientWidth, ch = esc.clientHeight;
    if (lienzo.width !== Math.round(cw * dpr) || lienzo.height !== Math.round(ch * dpr)) { lienzo.width = Math.round(cw * dpr); lienzo.height = Math.round(ch * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const W = vista.width, H = vista.height, c = st.crop, pad = 22;
    const recorte = st.tab === 'recortar';
    // En "Recortar" se ve la foto entera; en el resto, solo lo recortado (como va a quedar).
    const sx = recorte ? 0 : c.x * W, sy = recorte ? 0 : c.y * H, sw = recorte ? W : c.w * W, sh = recorte ? H : c.h * H;
    const e = Math.min((cw - pad * 2) / sw, (ch - pad * 2) / sh);
    const ox = (cw - sw * e) / 2, oy = (ch - sh * e) / 2;
    geo = { e, ox, oy, sx, sy, W, H }; dlg.geo = geo;
    ctx.imageSmoothingQuality = 'high';
    if (recorte || st.original) ctx.drawImage(vista, sx, sy, sw, sh, ox, oy, sw * e, sh * e);
    else { if (ajSucio) rehacerAjustes(); ctx.drawImage(vistaAj, ox, oy, sw * e, sh * e); }
    if (recorte) {
      const r = rectCrop();
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath(); ctx.rect(ox, oy, sw * e, sh * e); ctx.rect(r.x, r.y, r.w, r.h); ctx.fill('evenodd');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.beginPath();
      for (const t of [1 / 3, 2 / 3]) { ctx.moveTo(r.x + r.w * t, r.y); ctx.lineTo(r.x + r.w * t, r.y + r.h); ctx.moveTo(r.x, r.y + r.h * t); ctx.lineTo(r.x + r.w, r.y + r.h * t); }
      ctx.stroke();
      ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      const L = Math.min(22, r.w / 3, r.h / 3);
      for (const [px, py, dx, dy] of [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]) {
        ctx.beginPath(); ctx.moveTo(px, py + dy * L); ctx.lineTo(px, py); ctx.lineTo(px + dx * L, py); ctx.stroke();
      }
    } else if (st.tab === 'vineta' && !st.original) {
      const vx = ox + st.vin.cx * sw * e, vy = oy + st.vin.cy * sh * e;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(vx, vy, 12, 0, Math.PI * 2); ctx.moveTo(vx - 18, vy); ctx.lineTo(vx + 18, vy); ctx.moveTo(vx, vy - 18); ctx.lineTo(vx, vy + 18); ctx.stroke(); ctx.shadowBlur = 0;
    }
    if (!recorte && st.logo && !st.original) {
      const l = rectLogo();
      ctx.globalAlpha = st.logo.op; ctx.drawImage(st.logo.img, l.x, l.y, l.w, l.h); ctx.globalAlpha = 1;
      if (st.tab === 'logo') {
        ctx.setLineDash([6, 4]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(l.x, l.y, l.w, l.h); ctx.setLineDash([]);
        ctx.fillStyle = '#c9a24a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(l.x + l.w, l.y + l.h, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }
  function rectCrop() {
    const { e, ox, oy, W, H } = geo, c = st.crop;
    return { x: ox + c.x * W * e, y: oy + c.y * H * e, w: c.w * W * e, h: c.h * H * e };
  }
  function rectLogo() {
    const { e, ox, oy } = geo, c = st.crop, l = st.logo;
    const cwp = c.w * geo.W * e, chp = c.h * geo.H * e;
    const w = l.s * cwp, h = (w * l.img.height) / l.img.width;
    return { x: ox + l.x * cwp - w / 2, y: oy + l.y * chp - h / 2, w, h, cwp, chp };
  }
  let pend = false;
  const pedir = () => { if (!pend) { pend = true; requestAnimationFrame(() => { pend = false; dibujar(); }); } };
  const pedirAj = () => { ajSucio = true; pedir(); };

  /* ----- gestos ----- */
  const punteros = new Map(); let gesto = null;
  const punto = (ev) => { const b = lienzo.getBoundingClientRect(); return { x: ev.clientX - b.left, y: ev.clientY - b.top }; };
  on(lienzo, 'pointerdown', (ev) => {
    lienzo.setPointerCapture(ev.pointerId);
    const p = punto(ev); punteros.set(ev.pointerId, p);
    if (st.tab === 'recortar') {
      const r = rectCrop(); const tol = ev.pointerType === 'mouse' ? 16 : 30;
      const esquinas = [['nw', r.x, r.y], ['ne', r.x + r.w, r.y], ['sw', r.x, r.y + r.h], ['se', r.x + r.w, r.y + r.h]];
      const q = esquinas.find(([, x, y]) => Math.hypot(p.x - x, p.y - y) < tol);
      if (q) gesto = { tipo: 'esquina', q: q[0], ini: { ...st.crop } };
      else if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) gesto = { tipo: 'mover', p0: p, ini: { ...st.crop } };
      else gesto = null;
    } else if (st.tab === 'vineta') {
      gesto = { tipo: 'vin' }; moverVin(p);
    } else if (st.tab === 'logo' && st.logo) {
      if (punteros.size === 2) {
        const [a, b] = [...punteros.values()];
        gesto = { tipo: 'pellizco', d0: Math.hypot(a.x - b.x, a.y - b.y), s0: st.logo.s }; return;
      }
      const l = rectLogo(); const tol = ev.pointerType === 'mouse' ? 16 : 30;
      if (Math.hypot(p.x - (l.x + l.w), p.y - (l.y + l.h)) < tol) gesto = { tipo: 'tam', cx: l.x + l.w / 2, cy: l.y + l.h / 2, d0: Math.hypot(p.x - (l.x + l.w / 2), p.y - (l.y + l.h / 2)), s0: st.logo.s };
      else gesto = { tipo: 'logo', p0: p, x0: st.logo.x, y0: st.logo.y };
    }
  });
  on(lienzo, 'pointermove', (ev) => {
    if (!punteros.has(ev.pointerId)) return;
    const p = punto(ev); punteros.set(ev.pointerId, p);
    if (!gesto) return;
    const { e, W, H } = geo;
    if (gesto.tipo === 'vin') { moverVin(p); return; }
    if (gesto.tipo === 'mover') {
      const c = gesto.ini;
      st.crop.x = limitar(c.x + (p.x - gesto.p0.x) / (W * e), 0, 1 - c.w);
      st.crop.y = limitar(c.y + (p.y - gesto.p0.y) / (H * e), 0, 1 - c.h);
    } else if (gesto.tipo === 'esquina') {
      const c = gesto.ini; const q = gesto.q;
      // trabajar en píxeles de la vista para respetar la proporción
      const ax = (q.includes('w') ? c.x + c.w : c.x) * W, ay = (q.includes('n') ? c.y + c.h : c.y) * H; // esquina fija
      const px = limitar((p.x - geo.ox) / e, 0, W), py = limitar((p.y - geo.oy) / e, 0, H);
      const minimo = Math.max(24, Math.min(W, H) * 0.05);
      let w = Math.max(minimo, Math.abs(px - ax)), h = Math.max(minimo, Math.abs(py - ay));
      const r = ratioNum();
      const maxW = q.includes('w') ? ax : W - ax, maxH = q.includes('n') ? ay : H - ay;
      if (r) { if (w / h > r) h = w / r; else w = h * r; if (w > maxW) { w = maxW; h = w / r; } if (h > maxH) { h = maxH; w = h * r; } }
      else { w = Math.min(w, maxW); h = Math.min(h, maxH); }
      const x = q.includes('w') ? ax - w : ax, y = q.includes('n') ? ay - h : ay;
      st.crop = { x: x / W, y: y / H, w: w / W, h: h / H };
    } else if (gesto.tipo === 'logo') {
      const l = rectLogo();
      // el logo no puede salirse de la foto
      const mx = Math.min(0.5, l.w / 2 / l.cwp), my = Math.min(0.5, l.h / 2 / l.chp);
      st.logo.x = limitar(gesto.x0 + (p.x - gesto.p0.x) / l.cwp, mx, 1 - mx);
      st.logo.y = limitar(gesto.y0 + (p.y - gesto.p0.y) / l.chp, my, 1 - my);
    } else if (gesto.tipo === 'tam') {
      const d = Math.hypot(p.x - gesto.cx, p.y - gesto.cy);
      ponerTam(gesto.s0 * (d / Math.max(1, gesto.d0)));
    } else if (gesto.tipo === 'pellizco' && punteros.size >= 2) {
      const [a, b] = [...punteros.values()];
      ponerTam(gesto.s0 * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, gesto.d0)));
    }
    pedir();
  });
  const soltar = (ev) => { punteros.delete(ev.pointerId); if (gesto && gesto.tipo === 'pellizco' && punteros.size === 1) gesto = null; else if (!punteros.size) gesto = null; };
  on(lienzo, 'pointerup', soltar); on(lienzo, 'pointercancel', soltar);
  on(window, 'resize', pedir);

  function moverVin(p) {
    const { e, ox, oy } = geo, c = st.crop;
    st.vin.cx = limitar((p.x - ox) / (c.w * geo.W * e), 0, 1); st.vin.cy = limitar((p.y - oy) / (c.h * geo.H * e), 0, 1);
    pedirAj();
  }
  function pintarControles() {
    $$('[data-ajuste]').forEach((r) => { r.value = st.aj[r.dataset.ajuste]; r.nextElementSibling.textContent = r.value; });
    $$('[data-vin]').forEach((r) => { r.value = st.vin[r.dataset.vin]; r.nextElementSibling.textContent = r.value; });
    $$('[data-filtro]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filtro === st.filtro)));
    const fi = $('[data-fil="int"]'); fi.value = st.filInt; fi.nextElementSibling.textContent = st.filInt; $('.ed-fil-int').hidden = st.filtro === 'ninguno';
    $$('[data-grupo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.grupo === st.grupo)));
    $$('.ed-grupo').forEach((g) => { g.hidden = g.dataset.g !== st.grupo; });
  }
  function ponerTam(s) {
    st.logo.s = limitar(s, 0.04, 0.95);
    const r = $('[data-logo="tam"]'); r.value = Math.round(st.logo.s * 100); r.nextElementSibling.textContent = r.value + '%';
  }
  function pintarLogoCtrl() {
    $('.ed-logo-ctrl').hidden = !st.logo; $('[data-ed="logoQuitar"]').hidden = !st.logo;
    if (st.logo) { ponerTam(st.logo.s); const o = $('[data-logo="op"]'); o.value = Math.round(st.logo.op * 100); o.nextElementSibling.textContent = o.value + '%'; }
  }
  async function ponerLogo(fuenteLogo) {
    try {
      const img = await cargarBitmap(fuenteLogo);
      const prev = st.logo;
      st.logo = { img, x: prev ? prev.x : 0.82, y: prev ? prev.y : 0.86, s: prev ? prev.s : 0.22, op: prev ? prev.op : 0.9 };
      pintarLogoCtrl(); pedir();
    } catch (e) { alert(e.message || 'No se pudo leer el logo.'); }
  }
  function pintarRatios() { $$('[data-ratio]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ratio === st.ratio))); }
  function irA(tab) {
    st.tab = tab;
    $$('.ed-tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $$('.ed-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    $('.ed-comparar').hidden = tab === 'recortar';
    dlg.querySelector('.ed-tabs [aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    pedirAj();
  }

  /* ----- resultado en alta calidad ----- */
  async function exportar() {
    const c = st.crop;
    const gira = st.rot % 180 !== 0;
    const FW = gira ? bmp.height : bmp.width, FH = gira ? bmp.width : bmp.height;
    const k = Math.min(1, MAX_LADO / Math.max(c.w * FW, c.h * FH));
    const b = base(bmp, st.rot, st.fh, st.fv, k);
    const out = document.createElement('canvas');
    const sx = Math.round(c.x * b.width), sy = Math.round(c.y * b.height);
    out.width = Math.max(1, Math.min(b.width - sx, Math.round(c.w * b.width)));
    out.height = Math.max(1, Math.min(b.height - sy, Math.round(c.h * b.height)));
    const x = out.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.fillStyle = '#fff'; x.fillRect(0, 0, out.width, out.height); // PNG con transparencia → fondo blanco en JPG
    x.drawImage(b, sx, sy, out.width, out.height, 0, 0, out.width, out.height);
    procesar(out, st);
    if (st.logo) {
      const l = st.logo; const w = l.s * out.width, h = (w * l.img.height) / l.img.width;
      x.globalAlpha = l.op; x.drawImage(l.img, l.x * out.width - w / 2, l.y * out.height - h / 2, w, h); x.globalAlpha = 1;
    }
    const blob = await new Promise((ok) => out.toBlob(ok, 'image/jpeg', 0.92));
    return { blob, ancho: out.width, alto: out.height };
  }

  /* ----- inicio ----- */
  rehacerVista(); aplicarRatio(); pintarRatios(); pintarControles();
  setTimeout(miniaturas, 30);
  st.logo = null; pintarLogoCtrl(); irA('recortar');
  ocupado.hidden = true;
  requestAnimationFrame(dibujar);

  return new Promise((resolver) => {
    const terminar = (v) => { ac.abort(); punteros.clear(); if (dlg.open) dlg.close(); bmp.close?.(); resolver(v); };
    const cmp = $('.ed-comparar');
    const verOrig = (v) => (ev) => { ev.preventDefault(); if (st.original !== v) { st.original = v; cmp.setAttribute('aria-pressed', String(v)); pedir(); } };
    on(cmp, 'pointerdown', verOrig(true)); for (const n of ['pointerup', 'pointerleave', 'pointercancel']) on(cmp, n, verOrig(false));
    on(cmp, 'contextmenu', (ev) => ev.preventDefault());
    on(dlg, 'cancel', (ev) => { ev.preventDefault(); terminar(null); });
    on(dlg, 'click', async (ev) => {
      const t = ev.target.closest('button'); if (!t) return;
      if (t.dataset.tab) { irA(t.dataset.tab); return; }
      if (t.dataset.filtro) { st.filtro = t.dataset.filtro; pintarControles(); pedirAj(); return; }
      if (t.dataset.grupo) { st.grupo = t.dataset.grupo; pintarControles(); return; }
      if (t.dataset.ratio) { st.ratio = t.dataset.ratio; aplicarRatio(); pintarRatios(); pedir(); return; }
      if (t.dataset.accion) {
        ocupado.hidden = false; $$('button').forEach((b) => { b.disabled = true; });
        try { const r = await exportar(); terminar({ accion: t.dataset.accion, ...r }); }
        catch (e) { alert(e.message || 'No se pudo guardar.'); }
        finally { ocupado.hidden = true; $$('button').forEach((b) => { b.disabled = false; }); }
        return;
      }
      switch (t.dataset.ed) {
        case 'cancelar': terminar(null); break;
        case 'izq': st.rot = (st.rot + 270) % 360; rehacerVista(); aplicarRatio(); pedirAj(); miniaturas(); break;
        case 'der': st.rot = (st.rot + 90) % 360; rehacerVista(); aplicarRatio(); pedirAj(); miniaturas(); break;
        case 'espejoH': st.fh = !st.fh; rehacerVista(); st.crop.x = 1 - st.crop.x - st.crop.w; pedirAj(); break;
        case 'espejoV': st.fv = !st.fv; rehacerVista(); st.crop.y = 1 - st.crop.y - st.crop.h; pedirAj(); break;
        case 'resetAjustes': st.aj = aj0(); pintarControles(); pedirAj(); break;
        case 'resetVineta': st.vin = vin0(); pintarControles(); pedirAj(); break;
        case 'vinCentrar': st.vin.cx = 0.5; st.vin.cy = 0.5; pedirAj(); break;
        case 'resetFiltro': st.filtro = 'ninguno'; st.filInt = 80; pintarControles(); pedirAj(); break;
        case 'logoTania': await ponerLogo(LOGO_TANIA); break;
        case 'logoQuitar': st.logo = null; pintarLogoCtrl(); pedir(); break;
        default:
      }
    });
    on(dlg, 'input', (ev) => {
      const a = ev.target.dataset.ajuste;
      if (a) { st.aj[a] = Number(ev.target.value); ev.target.nextElementSibling.textContent = ev.target.value; pedirAj(); return; }
      const v = ev.target.dataset.vin;
      if (v) { st.vin[v] = Number(ev.target.value); ev.target.nextElementSibling.textContent = ev.target.value; pedirAj(); return; }
      if (ev.target.dataset.fil) { st.filInt = Number(ev.target.value); ev.target.nextElementSibling.textContent = ev.target.value; pedirAj(); return; }
      const l = ev.target.dataset.logo;
      if (l && st.logo) {
        if (l === 'tam') ponerTam(Number(ev.target.value) / 100);
        else { st.logo.op = Number(ev.target.value) / 100; ev.target.nextElementSibling.textContent = ev.target.value + '%'; }
        pedir();
      }
    });
    on(dlg, 'change', (ev) => {
      if (ev.target.dataset.ed === 'logoArchivo' && ev.target.files[0]) { ponerLogo(ev.target.files[0]); ev.target.value = ''; }
    });
  });
}
