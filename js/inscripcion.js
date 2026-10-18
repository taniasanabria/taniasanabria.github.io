/*
 * inscripcion.js: inscripción online a los cursos (se carga recién cuando alguien toca "Inscribirme").
 * 1) La clienta completa nombre, teléfono y email → public.crear_inscripcion() la guarda como pendiente
 *    (y Tania recibe el aviso push).
 * 2) Se le muestran el monto (curso + matrícula), los datos de transferencia o QR que Tania carga en
 *    Ajustes y un botón para mandarle el comprobante por WhatsApp.
 * 3) Cuando Tania confirma el pago, le envía su código para entrar al aula (/alumnas/).
 * Si Supabase no responde o todavía no tiene la parte de cursos, la solicitud sigue como antes
 * (crear_reserva o WhatsApp), así nunca se pierde una inscripción.
 * Pago con tarjeta: queda listo para enchufar con config.js → PAGOS.tarjeta (ver supabase/PASOS.md).
 */
import { SUPABASE, PAGOS, URL_SITIO } from './config.js';
import { rpc } from './datos.js';
import { esc, icono, opcionesCurso, montoCurso, formatoGs, fichaCurso } from './render.js';

const V = new URL(import.meta.url).search;
let api = null;
let dlg = null;
let actual = null; // { curso (servicio), opcion }

const $ = (s, r = dlg) => r.querySelector(s);
const MENSAJES = {
  NOMBRE_INVALIDO: 'Escribí tu nombre y apellido.',
  TELEFONO_INVALIDO: 'Escribí un teléfono válido (ej: 0981 123 456).',
  EMAIL_INVALIDO: 'Revisá tu email: lo vas a usar para entrar a las clases.',
  ELEGI_UNA_OPCION: 'Elegí una de las opciones del curso.',
  CURSO_NO_DISPONIBLE: 'Este curso no está disponible en este momento. Escribile a Tania por WhatsApp.',
  NOTAS_DEMASIADO_LARGAS: 'El comentario es muy largo.',
};

function cargarCss() {
  if (document.getElementById('css-cursos')) return Promise.resolve();
  return new Promise((ok) => {
    const l = document.createElement('link');
    l.id = 'css-cursos'; l.rel = 'stylesheet'; l.href = new URL('../css/cursos.css' + V, import.meta.url).href;
    l.onload = ok; l.onerror = ok;
    document.head.append(l);
  });
}

const whatsapp = () => api.catalogo().negocio.whatsapp;
const urlWa = (texto) => `https://api.whatsapp.com/send?phone=${whatsapp()}&text=${encodeURIComponent(texto)}`;
const urlAula = () => new URL((api.catalogo().alumnas || 'alumnas/'), URL_SITIO || location.href).href;

function construir() {
  dlg = document.createElement('dialog');
  dlg.className = 'dialogo dialogo-inscripcion';
  dlg.id = 'dlg-inscripcion';
  dlg.setAttribute('aria-labelledby', 'ins-titulo');
  dlg.innerHTML = `
  <div class="dialogo-barra"><button type="button" class="btn-cerrar" data-cerrar aria-label="Cerrar">${icono('xmark')}</button></div>
  <div class="dialogo-cuerpo">
    <form id="form-inscripcion" novalidate>
      <p class="sobretitulo">Inscripción online</p>
      <h2 class="dialogo-titulo" id="ins-titulo"></h2>
      <div id="ins-ficha"></div>
      <fieldset class="ins-opciones" id="ins-opciones" hidden><legend>Elegí la modalidad</legend><div id="ins-opciones-lista"></div></fieldset>
      <div class="campo-fila">
        <div class="campo">
          <label for="ins-nombre">Nombre y apellido</label>
          <input id="ins-nombre" name="nombre" type="text" autocomplete="name" placeholder="Ej: María López" required maxlength="120">
        </div>
        <div class="campo">
          <label for="ins-telefono">Teléfono / WhatsApp</label>
          <input id="ins-telefono" name="telefono" type="tel" inputmode="tel" autocomplete="tel" placeholder="Ej: 0981 123 456" required maxlength="30">
        </div>
      </div>
      <div class="campo">
        <label for="ins-email">Email</label>
        <input id="ins-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="Ej: maria@gmail.com" required maxlength="160" aria-describedby="ins-email-ayuda">
        <p class="campo-ayuda" id="ins-email-ayuda">Con este email vas a entrar al aula para ver las clases y materiales.</p>
      </div>
      <div class="campo">
        <label for="ins-notas">Comentarios <span class="opcional">(opcional)</span></label>
        <textarea id="ins-notas" name="notas" rows="2" maxlength="1000" placeholder="Ej: horario que te queda mejor, consultas…"></textarea>
      </div>
      <div class="trampa" aria-hidden="true"><label for="ins-sitio">No completar</label><input id="ins-sitio" name="sitio_web" type="text" tabindex="-1" autocomplete="off"></div>
      <p class="form-error" id="ins-error" role="alert"></p>
      <button type="submit" class="btn btn-primario btn-grande btn-ancho" id="ins-enviar">${icono('check')} <span>Inscribirme</span></button>
      <p class="campo-ayuda centrado">Tu lugar queda reservado como pendiente hasta que Tania reciba el pago.</p>
    </form>
    <div class="ins-ok" id="ins-ok" hidden tabindex="-1"></div>
  </div>`;
  document.body.append(dlg);
  api.registrarDialogo(dlg);
  $('#form-inscripcion').addEventListener('submit', enviar);
  $('#form-inscripcion').addEventListener('input', (e) => {
    if (e.target.getAttribute('aria-invalid') === 'true') marcar(e.target, false);
    $('#ins-error').textContent = '';
  });
  $('#ins-opciones').addEventListener('change', pintarMonto);
}

function marcar(el, invalido) {
  el.closest('.campo')?.classList.toggle('campo-invalido', invalido);
  el.setAttribute('aria-invalid', invalido ? 'true' : 'false');
}

function cursoDe(id) {
  const lista = api.catalogo().servicios.filter((s) => s.categoria === 'academia');
  return lista.find((s) => s.id === id || (s.variantes || []).some((v) => v.id === id));
}

function opcionElegida() {
  const ops = opcionesCurso(actual);
  if (ops.length === 1) return ops[0];
  const r = dlg.querySelector('input[name="opcion"]:checked');
  return r ? ops.find((o) => o.id === r.value) : null;
}

function pintarMonto() {
  const o = opcionElegida();
  const caja = $('#ins-monto');
  if (!caja) return;
  const m = o ? montoCurso(o.precioTexto) : null;
  caja.hidden = !(m && m.total);
  if (m && m.total) caja.innerHTML = `${m.mensual ? 'Para inscribirte (1.ª cuota + matrícula)' : 'Total a pagar'}: <strong>${formatoGs(m.total)}</strong>`;
}

export async function abrirInscripcion(id, origen, apiApp) {
  api = apiApp;
  await cargarCss();
  if (!dlg) construir();
  const s = cursoDe(id);
  if (!s) return false;
  actual = s;
  const f = $('#form-inscripcion');
  f.hidden = false; $('#ins-ok').hidden = true; $('#ins-error').textContent = '';
  dlg.querySelectorAll('[aria-invalid="true"]').forEach((el) => marcar(el, false));
  $('#ins-titulo').textContent = s.tituloDetalle || s.nombre;
  $('#ins-ficha').innerHTML = fichaCurso(s) + '<p class="ins-monto" id="ins-monto" aria-live="polite" hidden></p>';
  const ops = opcionesCurso(s);
  $('#ins-opciones').hidden = ops.length < 2;
  $('#ins-opciones-lista').innerHTML = ops.length < 2 ? '' : ops.map((o) => `<label class="check"><input type="radio" name="opcion" value="${esc(o.id)}"${o.id === id ? ' checked' : ''}> <span><strong>${esc(o.etiqueta)}</strong> · ${esc(o.precioVisible)}</span></label>`).join('');
  pintarMonto();
  $('#ins-enviar').disabled = false;
  api.abrirDialogo(dlg, origen);
  $('.dialogo-cuerpo').scrollTop = 0;
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) $('#ins-nombre').focus();
  return true;
}

const telefonoValido = (t) => { const d = t.replace(/[^\d+]/g, ''); return /^(\+?595|0)?9\d{8}$/.test(d) || /^\+?\d{8,15}$/.test(d); };
const emailValido = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

async function enviar(e) {
  e.preventDefault();
  const f = e.target;
  const o = opcionElegida();
  const nombre = f.nombre.value.trim(); const tel = f.telefono.value.trim(); const email = f.email.value.trim().toLowerCase(); const notas = f.notas.value.trim();
  const errores = [];
  if (!o) errores.push([dlg.querySelector('input[name="opcion"]'), MENSAJES.ELEGI_UNA_OPCION]);
  if (nombre.length < 3) errores.push([f.nombre, MENSAJES.NOMBRE_INVALIDO]);
  if (!telefonoValido(tel)) errores.push([f.telefono, MENSAJES.TELEFONO_INVALIDO]);
  if (!emailValido(email)) errores.push([f.email, MENSAJES.EMAIL_INVALIDO]);
  errores.forEach(([el]) => el && el.type !== 'radio' && marcar(el, true));
  if (errores.length) { $('#ins-error').textContent = errores[0][1]; (errores[0][0] || f.nombre).focus(); return; }

  const m = montoCurso(o.precioTexto);
  const base = { curso: o.nombre, precio: o.precioTexto, monto_gs: m.total, nombre, email, telefono: tel };
  if (f.sitio_web.value) { mostrarOk({ ...base, referencia: null, modo: 'registrada' }); return; } // trampa para robots

  const boton = $('#ins-enviar');
  boton.disabled = true; boton.lastElementChild.textContent = 'Enviando…';
  try {
    if (!api.enLinea()) throw Object.assign(new Error('sin-supabase'), { codigo: 'SIN_CONEXION' });
    const r = await rpc('crear_inscripcion', { p_curso: o.id, p_nombre: nombre, p_telefono: tel, p_email: email, p_notas: notas || null });
    if (!r || r.ok === false) throw Object.assign(new Error('inscripcion'), { codigo: (r && r.error) || 'ERROR' });
    mostrarOk({ ...base, ...r, modo: 'online', id: r.id });
  } catch (err) {
    const msg = MENSAJES[err.codigo];
    if (msg) { $('#ins-error').textContent = msg; }
    else if (err.codigo === 'DEMASIADAS_SOLICITUDES') {
      mostrarOk({ ...base, modo: 'whatsapp', aviso: 'Ya recibimos varias inscripciones con estos datos. Escribile a Tania por WhatsApp.' });
    } else {
      // La función todavía no está instalada o no hay conexión: se registra como solicitud (como antes) o por WhatsApp.
      let registrada = false;
      try {
        if (api.enLinea()) {
          const r = await rpc('crear_reserva', { p_servicio: o.id, p_nombre: nombre, p_telefono: tel, p_email: email, p_pago: 'total', p_notas: ['Inscripción online.', notas].filter(Boolean).join(' ') });
          registrada = !!(r && r.ok);
        }
      } catch { /* sigue por WhatsApp */ }
      mostrarOk({ ...base, modo: registrada ? 'registrada' : 'whatsapp' });
    }
  } finally {
    boton.disabled = false; boton.lastElementChild.textContent = 'Inscribirme';
  }
}

function mensajeComprobante(d) {
  return [`¡Hola Tania! Me inscribí al *${d.curso}* desde la web.`, d.referencia ? `Referencia: *${d.referencia}*` : '',
    d.monto_gs ? `Monto: ${formatoGs(d.monto_gs)}` : '', `Nombre: ${d.nombre}`, `Email: ${d.email}`,
    d.modo === 'online' ? 'Te envío el comprobante de pago 👇' : '¿Me pasás los datos para el pago?'].filter(Boolean).join('\n');
}

function mostrarOk(d) {
  const ok = $('#ins-ok');
  const qr = d.qr_pago ? `${SUPABASE.url}/storage/v1/object/public/fotos/${encodeURIComponent(d.qr_pago)}` : '';
  const datos = (d.datos_pago || '').trim();
  const pagoTarjeta = d.modo === 'online' && PAGOS && PAGOS.tarjeta && PAGOS.tarjeta.url;
  let pago = '';
  if (d.modo === 'online') {
    pago = `<div class="ins-pago">
      <h3>${icono('receipt')} Cómo pagar</h3>
      ${d.monto_gs ? `<p class="ins-pago-monto">${d.mensual ? 'Para inscribirte (1.ª cuota + matrícula)' : 'Total a pagar'}: <strong>${formatoGs(d.monto_gs)}</strong></p>` : `<p>${esc(d.precio || '')}</p>`}
      ${d.referencia ? `<p>Referencia de tu inscripción: <strong class="ins-ref">${esc(d.referencia)}</strong> <small>(ponela en el concepto de la transferencia)</small></p>` : ''}
      ${datos ? `<p class="ins-pago-sub">Transferencia</p><pre class="ins-datos">${esc(datos)}</pre>` : ''}
      ${qr ? `<p class="ins-pago-sub">O pagá con QR</p><img class="ins-qr" src="${esc(qr)}" alt="Código QR para pagar a Tania Sanabria" width="240" height="240" loading="lazy">` : ''}
      ${!datos && !qr ? '<p>Tania te va a enviar por WhatsApp los datos para la transferencia o el QR.</p>' : ''}
      ${pagoTarjeta ? `<button type="button" class="btn btn-secundario btn-ancho" id="ins-tarjeta">${icono('credit-card')} ${esc(PAGOS.tarjeta.etiqueta || 'Pagar con tarjeta')}</button>` : ''}
    </div>`;
  }
  const titulo = d.modo === 'whatsapp' ? '¡Ya casi!' : '¡Inscripción recibida!';
  const bajada = d.modo === 'online'
    ? `${esc(d.nombre.split(/\s+/)[0])}, tu lugar en <strong>${esc(d.curso)}</strong> quedó reservado como pendiente.`
    : d.modo === 'registrada'
      ? `Tania recibió tu solicitud para <strong>${esc(d.curso)}</strong> y te va a escribir por WhatsApp con los datos de pago.`
      : esc(d.aviso || 'Enviale tu inscripción a Tania por WhatsApp y ella te pasa los datos de pago.');
  ok.innerHTML = `
    <h2 class="dialogo-titulo">${titulo} ${icono('check')}</h2>
    <p>${bajada}</p>
    ${pago}
    <ol class="ins-pasos">
      ${d.modo === 'online' ? '<li>Hacé la transferencia o pagá con el QR.</li><li><strong>Enviá el comprobante</strong> a Tania por WhatsApp (botón de abajo).</li>' : '<li>Escribile a Tania por WhatsApp (botón de abajo).</li><li>Pagá con los datos que te envíe.</li>'}
      <li>Cuando Tania confirme tu pago, te manda tu <strong>código de acceso</strong> para ver las clases en <a href="${esc(urlAula())}">el aula de alumnas</a>.</li>
    </ol>
    <a class="btn btn-primario btn-grande btn-ancho" id="ins-wa" href="${esc(urlWa(mensajeComprobante(d)))}" target="_blank" rel="noopener">${icono('whatsapp')} ${d.modo === 'online' ? 'Enviar comprobante por WhatsApp' : 'Escribir a Tania por WhatsApp'}</a>
    <button type="button" class="btn btn-secundario btn-ancho" data-cerrar>Listo</button>`;
  $('#form-inscripcion').hidden = true;
  ok.hidden = false;
  ok.focus();
  const bt = $('#ins-tarjeta');
  if (bt) bt.addEventListener('click', () => pagarConTarjeta(d, bt));
}

// Pasarela de tarjeta (futuro): la Edge Function crea el cobro y devuelve la URL de pago de uPay/Bancard.
async function pagarConTarjeta(d, boton) {
  boton.disabled = true;
  try {
    const r = await fetch(PAGOS.tarjeta.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE.anonKey, Authorization: `Bearer ${SUPABASE.anonKey}` },
      body: JSON.stringify({ inscripcion: d.id, referencia: d.referencia }),
    });
    const j = await r.json();
    if (!r.ok || !j.url || !/^https:\/\//.test(j.url)) throw new Error(j.error || 'sin url');
    location.href = j.url;
  } catch (err) {
    console.warn('Pago con tarjeta no disponible:', err);
    api.aviso('El pago con tarjeta no está disponible ahora. Podés pagar por transferencia o QR.');
    boton.disabled = false;
  }
}
