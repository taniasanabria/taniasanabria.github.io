/*
 * comprobante.js: después de reservar un turno o inscribirse a un curso.
 *  - Muestra los datos de transferencia (solo los devuelve Supabase para un turno/inscripción recién creado).
 *  - Pide la foto/captura (o PDF) del comprobante, la achica en el celular (máx. ~1,5 MB) y la sube al
 *    bucket PRIVADO "comprobantes" (el público solo puede subir; no puede ver ni listar).
 *  - Botón "Enviar por WhatsApp" (mensaje con los datos + enlace al comprobante dentro del panel /admin/)
 *    y, si el celular lo permite, "Compartir comprobante" (manda la imagen misma a WhatsApp).
 * Si supabase/comprobantes.sql todavía no se ejecutó, todo esto se oculta solo y queda el flujo anterior.
 */
import { SUPABASE, URL_SITIO } from './config.js';
import { rpc } from './datos.js';
import { botonesCopiar, activarCopiar } from './copiar.js';

export const WA_TANIA = '595976122979';
const MAX = 1.5 * 1024 * 1024;
const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const gs = (n) => 'Gs. ' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const base = () => (URL_SITIO || (location.origin + '/')).replace(/\/?$/, '/');
export const enlaceAdmin = (tipo, id) => `${base()}admin/#comprobante=${tipo}:${id}`;
export const enlaceSubirDespues = (tipo, id) => `${location.origin}${location.pathname}?comprobante=${tipo}:${id}`;
export const urlWhatsapp = (texto, tel = WA_TANIA) => `https://api.whatsapp.com/send?phone=${tel}&text=${encodeURIComponent(texto)}`;

/** Achica una imagen a JPEG (lado mayor 1600 px, baja calidad hasta entrar en 1,5 MB). PDF: se acepta si ya pesa ≤ 1,5 MB. */
export async function comprimir(file) {
  if (file.type === 'application/pdf') {
    if (file.size > MAX) throw new Error('El PDF pesa más de 1,5 MB. Mandá una captura de pantalla del comprobante.');
    return { blob: file, ext: 'pdf', tipo: 'application/pdf' };
  }
  if (!/^image\//.test(file.type)) throw new Error('Elegí una foto, captura o PDF del comprobante.');
  let img;
  try { img = await createImageBitmap(file); } catch {
    img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error('No se pudo leer la imagen.')); i.src = URL.createObjectURL(file); });
  }
  let lado = 1600;
  for (let intento = 0; intento < 6; intento++) {
    const k = Math.min(1, lado / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    const q = [0.82, 0.72, 0.62, 0.55, 0.5, 0.45][intento];
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', q));
    if (blob && blob.size <= MAX) return { blob, ext: 'jpg', tipo: 'image/jpeg' };
    lado = Math.round(lado * 0.8);
  }
  throw new Error('La imagen es demasiado grande. Probá con una captura de pantalla.');
}

/** Sube al bucket privado y marca "comprobante enviado". tipo: 'r' (turno) | 'i' (inscripción). */
export async function subirComprobante(tipo, id, archivo) {
  const ruta = `${tipo}/${id}/${Date.now()}.${archivo.ext}`;
  const r = await fetch(`${SUPABASE.url}/storage/v1/object/comprobantes/${ruta}`, {
    method: 'POST', body: archivo.blob,
    headers: { apikey: SUPABASE.anonKey, Authorization: `Bearer ${SUPABASE.anonKey}`, 'Content-Type': archivo.tipo, 'x-upsert': 'false', 'cache-control': '3600' },
  });
  if (!r.ok) throw new Error('No se pudo subir el comprobante (' + r.status + '). Probá de nuevo o envialo por WhatsApp.');
  const m = await rpc('registrar_comprobante', { p_tipo: tipo, p_id: id, p_ruta: ruta });
  if (!m || m.ok === false) throw new Error('No se pudo registrar el comprobante.');
  return ruta;
}

/** Datos de pago de un turno/inscripción recién creado (null si comprobantes.sql no está instalado). */
export async function datosPago(tipo, id) {
  try {
    const r = await rpc(tipo === 'r' ? 'datos_pago_reserva' : 'datos_pago_inscripcion', { p_id: id });
    return r && r.ok ? r : null;
  } catch { return null; }
}

/**
 * Pinta en `cont` el bloque de pago (opcional), la subida del comprobante y los botones de WhatsApp.
 * op: { tipo, id, mensaje (texto base para WhatsApp), pago: {datos_pago, monto_texto, es_sena}|null, conPago: bool, tel }
 */
export function pintarComprobante(cont, op) {
  const { tipo, id } = op;
  let archivo = null; let subido = op.yaEnviado || false;
  const pago = op.pago;
  const datos = (pago && pago.datos_pago || '').trim();
  const bloquePago = op.conPago && pago ? `<div class="ins-pago comp-pago">
      <h3>🧾 Cómo pagar</h3>
      ${pago.monto_texto || pago.monto_gs ? `<p class="ins-pago-monto">${pago.es_sena ? 'Seña a transferir' : 'Monto a transferir'}: <strong>${escH(pago.monto_gs ? gs(pago.monto_gs) : pago.monto_texto)}</strong></p>` : ''}
      ${datos ? `<p class="ins-pago-sub">Transferencia</p><pre class="ins-datos">${escH(datos)}</pre>${botonesCopiar(datos)}` : '<p>Tania te va a enviar por WhatsApp los datos para la transferencia.</p>'}
    </div>` : '';
  cont.innerHTML = `${bloquePago}
    <div class="comp-subida">
      <h3>📎 Comprobante de la transferencia</h3>
      <p class="comp-ayuda">Después de transferir, subí la foto o captura del comprobante (o el PDF). Es opcional, pero así Tania confirma más rápido.</p>
      <label class="btn btn-secundario btn-ancho comp-elegir"><input type="file" accept="image/*,application/pdf" class="comp-input" hidden> 📷 Elegir foto o captura</label>
      <div class="comp-vista" hidden></div>
      <p class="comp-estado" role="status" aria-live="polite">${subido ? '✅ Comprobante enviado.' : ''}</p>
      <button type="button" class="btn btn-secundario btn-ancho comp-compartir" hidden>📤 Compartir comprobante</button>
      <p class="comp-despues"><small>¿Todavía no transferiste? Guardá este enlace para <a href="${escH(enlaceSubirDespues(tipo, id))}" class="comp-link-despues">subir el comprobante después</a>.</small></p>
    </div>
    <a class="btn btn-primario btn-grande btn-ancho comp-wa" href="#" target="_blank" rel="noopener">💬 Enviar por WhatsApp</a>`;
  if (!cont._copiar) { activarCopiar(cont); cont._copiar = true; }
  const $ = (s) => cont.querySelector(s);
  const wa = $('.comp-wa');
  const actualizarWa = () => {
    const t = [op.mensaje, subido ? `🧾 *Comprobante:* ${enlaceAdmin(tipo, id)}` : (op.conPago ? '🧾 Te envío el comprobante de la transferencia.' : '')].filter(Boolean).join('\n');
    wa.href = urlWhatsapp(t, op.tel);
  };
  actualizarWa();
  const btShare = $('.comp-compartir');
  btShare.addEventListener('click', async () => {
    if (!archivo) return;
    const f = new File([archivo.blob], `comprobante.${archivo.ext}`, { type: archivo.tipo });
    try { await navigator.share({ files: [f], text: op.mensaje }); } catch (e) { /* cancelado */ }
  });
  $('.comp-input').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const est = $('.comp-estado'); const vista = $('.comp-vista');
    est.textContent = 'Preparando…'; est.classList.remove('error');
    try {
      archivo = await comprimir(f);
      vista.hidden = false;
      vista.innerHTML = archivo.ext === 'pdf' ? `<p>📄 ${escH(f.name)}</p>` : `<img src="${URL.createObjectURL(archivo.blob)}" alt="Vista previa del comprobante">`;
      est.textContent = `Subiendo (${Math.round(archivo.blob.size / 1024)} KB)…`;
      await subirComprobante(tipo, id, archivo);
      subido = true; est.textContent = '✅ Comprobante enviado. Ahora avisale a Tania por WhatsApp 👇';
      $('.comp-elegir').lastChild.textContent = ' 🔁 Cambiar comprobante';
      try {
        const fl = new File([archivo.blob], `comprobante.${archivo.ext}`, { type: archivo.tipo });
        if (navigator.canShare && navigator.canShare({ files: [fl] })) btShare.hidden = false;
      } catch { /* sin soporte */ }
      actualizarWa();
    } catch (err) {
      est.textContent = err.message || 'No se pudo subir.'; est.classList.add('error');
    }
    e.target.value = '';
  });
}

/** Enlace "subir después": ?comprobante=r:<id> o i:<id> abre un diálogo con los datos de pago y la subida. */
export async function abrirDesdeEnlace(tel) {
  const m = new URLSearchParams(location.search).get('comprobante');
  const k = m && m.match(/^([ri]):([0-9a-f-]{36})$/i); if (!k) return;
  const [, tipo, id] = k;
  const pago = await datosPago(tipo, id);
  const d = document.createElement('dialog'); d.className = 'dialogo dialogo-comprobante';
  d.innerHTML = `<div class="dialogo-cuerpo"><button type="button" class="dialogo-cerrar" aria-label="Cerrar" data-x>✕</button>
    <h2 class="dialogo-titulo">Subir comprobante</h2><div class="comp-cont"></div></div>`;
  document.body.appendChild(d);
  d.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) d.close(); });
  d.addEventListener('close', () => { history.replaceState(null, '', location.pathname + location.hash); d.remove(); });
  const cont = d.querySelector('.comp-cont');
  if (!pago) { cont.innerHTML = '<p>No encontramos esta reserva o el enlace ya venció. Escribile a Tania por WhatsApp.</p>'; }
  else {
    const qué = tipo === 'r' ? `mi turno de *${pago.servicio || ''}*` : `mi inscripción a *${pago.curso || ''}*${pago.referencia ? ` (Ref. ${pago.referencia})` : ''}`;
    pintarComprobante(cont, { tipo, id, pago, conPago: !!(pago.datos_pago || pago.monto_gs || pago.monto_texto), yaEnviado: pago.comprobante_estado === 'enviado', tel,
      mensaje: `¡Hola Tania! Te envío el comprobante de ${qué}.` });
  }
  d.showModal();
}
