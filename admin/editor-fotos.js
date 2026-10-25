/*
 * Editor de fotos del Panel de Tania (sin dependencias, todo en <canvas>).
 * Recortar (libre, 1:1, 4:5, 16:9, original), girar, espejar, brillo/contraste/saturación
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
  <div class="ed-escena"><canvas class="ed-lienzo" aria-label="Vista previa de la foto"></canvas><div class="ed-ocupado" hidden>⏳ Procesando…</div></div>
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
  <div class="ed-panel" data-panel="ajustes" hidden>
    <label class="ed-slider">Brillo <input type="range" min="50" max="150" value="100" data-ajuste="brillo"><output>0</output></label>
    <label class="ed-slider">Contraste <input type="range" min="50" max="150" value="100" data-ajuste="contraste"><output>0</output></label>
    <label class="ed-slider">Saturación <input type="range" min="0" max="200" value="100" data-ajuste="saturacion"><output>0</output></label>
    <button type="button" class="ed-chip" data-ed="resetAjustes">Restablecer</button>
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
    <button type="button" role="tab" data-tab="ajustes"><span aria-hidden="true">🎚️</span>Ajustes</button>
    <button type="button" role="tab" data-tab="logo"><span aria-hidden="true">🏷️</span>Logo</button>
  </nav>`;
  document.body.append(dlg);
}

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
/** Brillo, contraste y saturación sobre los píxeles (funciona en todos los navegadores). */
function ajustar(c, a) {
  if (a.brillo === 100 && a.contraste === 100 && a.saturacion === 100) return;
  const x = c.getContext('2d');
  const im = x.getImageData(0, 0, c.width, c.height); const d = im.data;
  const b = a.brillo / 100, ct = a.contraste / 100, s = a.saturacion / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * b, g = d[i + 1] * b, bl = d[i + 2] * b;
    r = (r - 128) * ct + 128; g = (g - 128) * ct + 128; bl = (bl - 128) * ct + 128;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    d[i] = l + (r - l) * s; d[i + 1] = l + (g - l) * s; d[i + 2] = l + (bl - l) * s;
  }
  x.putImageData(im, 0, 0);
}
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

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
    aj: { brillo: 100, contraste: 100, saturacion: 100 },
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
  function rehacerAjustes() {
    vistaAj = document.createElement('canvas'); vistaAj.width = vista.width; vistaAj.height = vista.height;
    vistaAj.getContext('2d').drawImage(vista, 0, 0); ajustar(vistaAj, st.aj);
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
    ctx.drawImage(vistaAj, sx, sy, sw, sh, ox, oy, sw * e, sh * e);
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
    } else if (st.logo) {
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
    pedir();
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
    ajustar(out, st.aj);
    if (st.logo) {
      const l = st.logo; const w = l.s * out.width, h = (w * l.img.height) / l.img.width;
      x.globalAlpha = l.op; x.drawImage(l.img, l.x * out.width - w / 2, l.y * out.height - h / 2, w, h); x.globalAlpha = 1;
    }
    const blob = await new Promise((ok) => out.toBlob(ok, 'image/jpeg', 0.92));
    return { blob, ancho: out.width, alto: out.height };
  }

  /* ----- inicio ----- */
  rehacerVista(); aplicarRatio(); pintarRatios();
  $$('[data-ajuste]').forEach((r) => { r.value = 100; r.nextElementSibling.textContent = '0'; });
  st.logo = null; pintarLogoCtrl(); irA('recortar');
  ocupado.hidden = true;
  requestAnimationFrame(dibujar);

  return new Promise((resolver) => {
    const terminar = (v) => { ac.abort(); punteros.clear(); if (dlg.open) dlg.close(); bmp.close?.(); resolver(v); };
    on(dlg, 'cancel', (ev) => { ev.preventDefault(); terminar(null); });
    on(dlg, 'click', async (ev) => {
      const t = ev.target.closest('button'); if (!t) return;
      if (t.dataset.tab) { irA(t.dataset.tab); return; }
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
        case 'izq': st.rot = (st.rot + 270) % 360; rehacerVista(); aplicarRatio(); pedir(); break;
        case 'der': st.rot = (st.rot + 90) % 360; rehacerVista(); aplicarRatio(); pedir(); break;
        case 'espejoH': st.fh = !st.fh; rehacerVista(); st.crop.x = 1 - st.crop.x - st.crop.w; pedir(); break;
        case 'espejoV': st.fv = !st.fv; rehacerVista(); st.crop.y = 1 - st.crop.y - st.crop.h; pedir(); break;
        case 'resetAjustes': st.aj = { brillo: 100, contraste: 100, saturacion: 100 }; $$('[data-ajuste]').forEach((r) => { r.value = 100; r.nextElementSibling.textContent = '0'; }); rehacerAjustes(); pedir(); break;
        case 'logoTania': await ponerLogo(LOGO_TANIA); break;
        case 'logoQuitar': st.logo = null; pintarLogoCtrl(); pedir(); break;
        default:
      }
    });
    on(dlg, 'input', (ev) => {
      const a = ev.target.dataset.ajuste;
      if (a) { st.aj[a] = Number(ev.target.value); ev.target.nextElementSibling.textContent = String(Number(ev.target.value) - 100); rehacerAjustes(); pedir(); return; }
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
