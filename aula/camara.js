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
export async function tomarFotos({ max = 6, sello = 'Aula Tania Sanabria' } = {}) {
  if (!camaraEnVivoDisponible()) throw new Error('SIN_CAMARA');
  const cam = $('#camara'), v = $('#cam-video'), prev = $('#cam-preview'), aviso = $('#cam-aviso');
  const fotos = []; let pendiente = null;
  const contar = () => { $('#cam-contador').textContent = `${fotos.length} / ${max}`;
    $('#cam-miniaturas').innerHTML = fotos.slice(-3).map((f) => `<img src="${f.url}" alt="">`).join(''); $('#cam-listo').disabled = !fotos.length; };
  cam.hidden = false; document.body.style.overflow = 'hidden'; aviso.textContent = 'Abriendo la cámara…'; contar();
  try { await abrirFlujo(); aviso.textContent = ''; }
  catch (e) {
    cam.hidden = true; document.body.style.overflow = '';
    if (/NotAllowed|Permission/i.test(e.name)) throw new Error('PERMISO_CAMARA');
    throw new Error('SIN_CAMARA');
  }
  return new Promise((ok) => {
    const modo = (revisar) => { $('#cam-abajo-disparo').hidden = revisar; $('#cam-abajo-revisar').hidden = !revisar; prev.hidden = !revisar; v.hidden = revisar; };
    const fin = () => { cerrarFlujo(); cam.hidden = true; document.body.style.overflow = ''; modo(false);
      for (const b of ['#cam-disparo', '#cam-listo', '#cam-cerrar', '#cam-girar', '#cam-usar', '#cam-repetir']) $(b).onclick = null;
      ok(fotos.map((f) => f.blob)); };
    $('#cam-disparo').onclick = async () => {
      if (!v.videoWidth) return;
      if (fotos.length >= max) { aviso.textContent = `Máximo ${max} fotos.`; setTimeout(() => (aviso.textContent = ''), 1800); return; }
      const blob = await sellar(v, v.videoWidth, v.videoHeight, sello);
      const pista = flujo && flujo.getVideoTracks()[0]; const aj = pista && pista.getSettings ? pista.getSettings() : {};
      blob.meta = { origen: 'camara-en-vivo', tomada: new Date().toISOString(), camara: frente ? 'frontal' : 'trasera',
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
