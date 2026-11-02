/*
 * Cámara del Aula: las alumnas SOLO pueden entregar fotos sacadas en el momento.
 * - Usa la cámara en vivo (getUserMedia). No hay selector de galería.
 * - NO hay selector de archivos ni respaldo con <input type=file>: en algunos celulares ese respaldo deja
 *   elegir de la galería. Si el navegador no da cámara en vivo, se pide abrir el aula en Chrome o Safari.
 * - Cada foto lleva metadatos de la toma (blob.meta): fecha/hora, cámara usada, resolución del video.
 * - Cada foto se marca con la fecha y hora de la toma y el nombre de la alumna (sello en la imagen).
 */
const $ = (s) => document.querySelector(s);
const MAX_LADO = 1600, CALIDAD = 0.86;

function fechaHora(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Dibuja la imagen reducida + sello "Aula Tania Sanabria · Nombre · fecha hora" y devuelve un JPEG.
function sellar(fuente, ancho, alto, sello) {
  const k = Math.min(1, MAX_LADO / Math.max(ancho, alto));
  const c = document.createElement('canvas'); c.width = Math.round(ancho * k); c.height = Math.round(alto * k);
  const g = c.getContext('2d'); g.drawImage(fuente, 0, 0, c.width, c.height);
  const t = Math.max(14, Math.round(c.width / 48)); const h = t * 2.1;
  g.fillStyle = 'rgba(27,22,16,.62)'; g.fillRect(0, c.height - h, c.width, h);
  g.fillStyle = '#e9d18c'; g.font = `600 ${t}px Montserrat, system-ui, sans-serif`; g.textBaseline = 'middle';
  g.fillText(`📷 ${sello} · ${fechaHora()}`, t * .8, c.height - h / 2, c.width - t * 1.6);
  return new Promise((ok) => c.toBlob((b) => ok(b), 'image/jpeg', CALIDAD));
}

let flujo = null, frente = false;
async function abrirFlujo() {
  cerrarFlujo();
  flujo = await navigator.mediaDevices.getUserMedia({ audio: false,
    video: { facingMode: frente ? 'user' : { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
  const v = $('#cam-video'); v.srcObject = flujo; await v.play().catch(() => {});
}
function cerrarFlujo() { if (flujo) { flujo.getTracks().forEach((t) => t.stop()); flujo = null; } }

export function camaraEnVivoDisponible() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext; }

/** Abre la cámara y devuelve hasta `max` fotos (Blob JPEG). */
export async function tomarFotos({ max = 6, sello = 'Aula Tania Sanabria', titulo = '', fantasma = null } = {}) {
  if (!camaraEnVivoDisponible()) throw new Error('SIN_CAMARA');
  const cam = $('#camara'), v = $('#cam-video'), prev = $('#cam-preview'), aviso = $('#cam-aviso');
  const fotos = []; let pendiente = null; await huellaDispositivo();
  const contar = () => { $('#cam-contador').textContent = `${fotos.length} / ${max}`;
    $('#cam-miniaturas').innerHTML = fotos.slice(-3).map((f) => `<img src="${f.url}" alt="">`).join(''); $('#cam-listo').disabled = !fotos.length; };
  const fa = $('#cam-fantasma'), ti = $('#cam-titulo');
  if (fa) { fa.hidden = !fantasma; if (fantasma) fa.src = fantasma; }
  if (ti) { ti.hidden = !titulo; ti.textContent = titulo; }
  cam.hidden = false; document.body.style.overflow = 'hidden'; aviso.textContent = 'Abriendo la cámara…'; contar();
  try { await abrirFlujo(); aviso.textContent = ''; }
  catch (e) {
    cam.hidden = true; document.body.style.overflow = '';
    if (/NotAllowed|Permission/i.test(e.name)) throw new Error('PERMISO_CAMARA');
    throw new Error('SIN_CAMARA');
  }
  return new Promise((ok) => {
    const modo = (revisar) => { $('#cam-abajo-disparo').hidden = revisar; $('#cam-abajo-revisar').hidden = !revisar; prev.hidden = !revisar; v.hidden = revisar; };
    const fin = () => { cerrarFlujo(); cam.hidden = true; document.body.style.overflow = ''; modo(false); if (fa) fa.hidden = true; if (ti) ti.hidden = true;
      for (const b of ['#cam-disparo', '#cam-listo', '#cam-cerrar', '#cam-girar', '#cam-usar', '#cam-repetir']) $(b).onclick = null;
      ok(fotos.map((f) => f.blob)); };
    $('#cam-disparo').onclick = async () => {
      if (!v.videoWidth) return;
      if (fotos.length >= max) { aviso.textContent = `Máximo ${max} fotos.`; setTimeout(() => (aviso.textContent = ''), 1800); return; }
      const blob = await sellar(v, v.videoWidth, v.videoHeight, sello);
      const pista = flujo && flujo.getVideoTracks()[0]; const aj = pista && pista.getSettings ? pista.getSettings() : {};
      blob.meta = { origen: 'camara-en-vivo', tomada: new Date().toISOString(), dispositivo: await huellaDispositivo(), camara: frente ? 'frontal' : 'trasera',
        etiqueta: String(pista?.label || '').slice(0, 80), ancho: v.videoWidth, alto: v.videoHeight, fps: aj.frameRate || null };
      pendiente = { blob, url: URL.createObjectURL(blob) }; prev.src = pendiente.url; modo(true);
      if (navigator.vibrate) navigator.vibrate(30);
    };
    $('#cam-usar').onclick = () => { fotos.push(pendiente); pendiente = null; modo(false); contar(); if (fotos.length >= max) fin(); };
    $('#cam-repetir').onclick = () => { pendiente = null; modo(false); };
    $('#cam-listo').onclick = fin;
    $('#cam-cerrar').onclick = () => { fotos.length = 0; fin(); };
    $('#cam-girar').onclick = async () => { frente = !frente; try { await abrirFlujo(); } catch { frente = !frente; } };
  });
}

/** Huella del dispositivo (hash, no identifica a la persona): sirve para avisar a la profe si un set de fotos viene de otro equipo. */
let _huella = null;
export async function huellaDispositivo() {
  if (_huella) return _huella;
  const d = [navigator.userAgent, navigator.platform, navigator.language, screen.width + 'x' + screen.height, screen.colorDepth,
    navigator.hardwareConcurrency || '', navigator.maxTouchPoints || 0, Intl.DateTimeFormat().resolvedOptions().timeZone].join('|');
  try { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d)); _huella = [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join(''); }
  catch { let h = 0; for (const c of d) h = (h * 31 + c.charCodeAt(0)) | 0; _huella = 'h' + (h >>> 0).toString(16); }
  return _huella;
}

/**
 * Graba un video corto con la cámara EN VIVO (MediaRecorder). Sin selector de archivos.
 * min/max en segundos. Calidad moderada (≈ 0,9 Mbps → ~5–7 MB por minuto). Devuelve { blob, tipo, segundos, meta }.
 */
export async function grabarVideo({ min = 30, max = 60, titulo = 'Video de la técnica' } = {}) {
  if (!camaraEnVivoDisponible() || typeof MediaRecorder === 'undefined') throw new Error('SIN_CAMARA');
  const cam = $('#camara'), v = $('#cam-video'), aviso = $('#cam-aviso');
  const tipos = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const tipo = tipos.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
  const ti = $('#cam-titulo'); if (ti) { ti.hidden = false; ti.textContent = titulo; } const fa = $('#cam-fantasma'); if (fa) fa.hidden = true;
  cam.hidden = false; document.body.style.overflow = 'hidden'; aviso.textContent = 'Abriendo la cámara…';
  $('#cam-abajo-revisar').hidden = true; $('#cam-miniaturas').innerHTML = ''; $('#cam-contador').textContent = `0 s · mín. ${min} s`;
  try { await abrirFlujo(); aviso.textContent = `Tocá el botón para empezar a grabar (entre ${min} y ${max} segundos).`; }
  catch (e) { cam.hidden = true; document.body.style.overflow = ''; throw new Error(/NotAllowed|Permission/i.test(e.name) ? 'PERMISO_CAMARA' : 'SIN_CAMARA'); }
  const listo = $('#cam-listo'); listo.disabled = true; listo.textContent = 'Terminar';
  return new Promise((ok, mal) => {
    let rec = null, partes = [], ini = 0, reloj = null, cancelado = false;
    const disp = $('#cam-disparo');
    const limpiar = () => { clearInterval(reloj); cerrarFlujo(); cam.hidden = true; document.body.style.overflow = ''; disp.classList.remove('grabando'); listo.textContent = 'Listo';
      for (const b of ['#cam-disparo', '#cam-listo', '#cam-cerrar', '#cam-girar']) $(b).onclick = null; if (ti) ti.hidden = true; };
    const parar = () => { if (rec && rec.state !== 'inactive') rec.stop(); };
    disp.onclick = () => {
      if (rec) { if ((Date.now() - ini) / 1000 >= min) parar(); else aviso.textContent = `Grabá al menos ${min} segundos.`; return; }
      rec = new MediaRecorder(flujo, { ...(tipo ? { mimeType: tipo } : {}), videoBitsPerSecond: 900000 });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) partes.push(e.data); };
      rec.onstop = async () => {
        const seg = Math.round((Date.now() - ini) / 1000); limpiar();
        if (cancelado) return ok(null);
        const blob = new Blob(partes, { type: (tipo || 'video/webm').split(';')[0] });
        ok({ blob, tipo: blob.type, segundos: seg, meta: { origen: 'camara-en-vivo', grabado: new Date(ini).toISOString(), segundos: seg, dispositivo: await huellaDispositivo() } });
      };
      rec.start(1000); ini = Date.now(); disp.classList.add('grabando'); aviso.textContent = '● Grabando…';
      reloj = setInterval(() => { const t = Math.floor((Date.now() - ini) / 1000); $('#cam-contador').textContent = `${t} s / ${max} s`; listo.disabled = t < min; if (t >= max) parar(); }, 250);
    };
    listo.onclick = () => { if (rec && (Date.now() - ini) / 1000 >= min) parar(); };
    $('#cam-cerrar').onclick = () => { cancelado = true; if (rec) parar(); else { limpiar(); ok(null); } };
    $('#cam-girar').onclick = async () => { if (rec) return; frente = !frente; try { await abrirFlujo(); } catch { frente = !frente; } };
  });
}
