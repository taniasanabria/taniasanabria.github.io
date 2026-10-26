/*
 * app.js: interacción del sitio (menú, detalles, visor de fotos, formulario de reserva, compartir).
 * El contenido principal ya viene en el HTML; aquí solo se agrega comportamiento.
 */
import { cargarCatalogo, cargarManifiestoFotos, cargarDesdeSupabase, rpc, supabaseActivo } from './datos.js';
import { detalleServicio, fotosDisponibles, indiceReservas, rutaFoto, seccionCategoria, galeriaPrincipal, seccionDestacados, opcionesServicio, esc } from './render.js';
import { iniciarCarruseles, refrescarCarruseles } from './carrusel.js';
import { crearVisor } from './visor.js';
import { pintarDias, pintarHoras } from './agenda-ui.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

let catalogo;
let manifiesto;
let reservas;
let modoSupabase = false; // true cuando Supabase respondió: horarios reales y reservas registradas en línea

// ------------------------------------------------------------------
// Aviso breve (toast)
// ------------------------------------------------------------------
let temporizadorAviso;
function aviso(texto) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.add('visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => el.classList.remove('visible'), 3200);
}

// ------------------------------------------------------------------
// Diálogos: <dialog> nativo (Esc, foco y accesibilidad incluidos).
// El botón "atrás" del celular cierra el diálogo abierto sin cambiar la URL.
// ------------------------------------------------------------------
const pila = [];
let cerrandoPorAtras = false;
let esperandoAtras = 0; // history.back() propios que todavía no llegaron como popstate

function abrirDialogo(dlg, origen) {
  if (dlg.open) return;
  dlg._origen = origen || document.activeElement;
  dlg.showModal();
  pila.push(dlg);
  document.documentElement.classList.add('con-dialogo');
  history.pushState({ dialogo: dlg.id }, '');
}

function alCerrarDialogo(dlg) {
  const i = pila.indexOf(dlg);
  if (i !== -1) pila.splice(i, 1);
  if (!pila.length) document.documentElement.classList.remove('con-dialogo');
  if (dlg._origen && document.contains(dlg._origen)) dlg._origen.focus({ preventScroll: true });
  if (!cerrandoPorAtras && history.state && history.state.dialogo === dlg.id) {
    esperandoAtras++;
    history.back();
  }
}

function registrarDialogo(dlg) {
  dlg.addEventListener('close', () => alCerrarDialogo(dlg));
  // Cerrar tocando fuera del contenido
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
    if (e.target.closest('[data-cerrar]')) dlg.close();
  });
}

function prepararDialogos() {
  for (const dlg of $$('dialog')) registrarDialogo(dlg);
  window.addEventListener('popstate', () => {
    if (esperandoAtras > 0) { esperandoAtras--; return; }
    const arriba = pila[pila.length - 1];
    if (arriba) {
      cerrandoPorAtras = true;
      arriba.close();
      cerrandoPorAtras = false;
    }
  });
}

// ------------------------------------------------------------------
// Detalle de servicio
// ------------------------------------------------------------------
function servicioPorId(id) {
  return catalogo.servicios.find((s) => s.id === id);
}

function abrirDetalle(id, origen) {
  const s = servicioPorId(id);
  if (!s) return;
  if (s.categoria === 'academia') cargarInscripcion().catch(() => {}); // precarga: "Inscribirme" abre al instante
  const dlg = $('#dlg-detalle');
  $('#detalle-contenido').innerHTML = detalleServicio(s, manifiesto);
  dlg.classList.toggle('tema-neon', s.categoria === 'eventos');
  abrirDialogo(dlg, origen);
  $('.dialogo-cuerpo', dlg).scrollTop = 0;
  iniciarCarruseles(dlg);
}

// ------------------------------------------------------------------
// Visor de fotos
// ------------------------------------------------------------------
let visor = null;

function coleccion(clave) {
  if (clave.startsWith('galeria-')) {
    const g = catalogo.galerias.find((x) => 'galeria-' + x.id === clave);
    return g ? { fotos: fotosDisponibles(g.fotos, manifiesto), titulo: g.titulo } : null;
  }
  const s = servicioPorId(clave);
  return s ? { fotos: fotosDisponibles(s.fotos, manifiesto), titulo: s.nombre } : null;
}

function abrirVisor(clave, indice, origen) {
  const c = coleccion(clave);
  if (!c || !c.fotos.length) return;
  visor.abrir(c.fotos, indice, c.titulo, origen);
}

function prepararVisor() {
  visor = crearVisor({ dlg: $('#dlg-visor'), abrirDialogo, rutaFoto, manifiesto: () => manifiesto });
}

// ------------------------------------------------------------------
// Formulario de reserva → WhatsApp
// ------------------------------------------------------------------
const DIAS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DIAS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fechaLocalISO(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function horarioDelDia(fechaISO) {
  if (!fechaISO) return null;
  const [a, m, d] = fechaISO.split('-').map(Number);
  const dia = new Date(a, m - 1, d).getDay();
  const h = catalogo.negocio.horario.find((x) => x.dias.includes(DIAS_EN[dia]));
  return { dia, horario: h || null };
}

const HORA_EXTRA_DESDE = 6 * 60;  // primer turno ofrecido fuera de horario
const HORA_EXTRA_HASTA = 22 * 60; // último turno ofrecido fuera de horario

function generarHoras() {
  const datos = reservas[$('#r-servicio').value];
  pintarTiraDias(datos);
  if (modoSupabase && datos && datos.usaTurno) return generarHorasLibres(datos);
  $('#r-dias').hidden = true;
  $('#r-hora').disabled = false;
  return generarHorasFijas();
}

// Horarios reales desde Supabase (solo los libres; nunca se ven datos de otras clientas).
let pedidoHoras = 0;
let hayHorariosDelDia = true;
const OPCION_COORDINAR = '<option value="a coordinar">Otro horario / a coordinar por WhatsApp</option>';

async function generarHorasLibres(datos) {
  const sel = $('#r-hora');
  const fecha = $('#r-fecha').value;
  const ayuda = $('#r-fecha-info');
  const n = ++pedidoHoras;
  if (!fecha) {
    sel.innerHTML = '<option value="">Elegí primero una fecha…</option>' + OPCION_COORDINAR;
    ayuda.textContent = '';
    actualizarAvisoExtra();
    return;
  }
  sel.innerHTML = '<option value="">Buscando horarios libres…</option>';
  sel.disabled = true;
  ayuda.textContent = '';
  let libres; let ocupados = [];
  try {
    // horarios_del_dia: todos los horarios con libre/ocupado (sin datos de nadie). Si aún no existe, horarios_libres.
    let todos = null;
    if (hayHorariosDelDia) {
      try { todos = await rpc('horarios_del_dia', { p_fecha: fecha, p_servicio: datos.id }); } catch { hayHorariosDelDia = false; }
    }
    if (Array.isArray(todos)) { libres = todos.filter((h) => h.libre); ocupados = todos.filter((h) => !h.libre); }
    else libres = await rpc('horarios_libres', { p_fecha: fecha, p_servicio: datos.id });
  } catch (err) {
    if (n !== pedidoHoras) return;
    console.info('Horarios en línea no disponibles; se usa el modo WhatsApp.', err.codigo || err);
    modoSupabase = false;
    aplicarModoReserva();
    generarHoras();
    return;
  }
  if (n !== pedidoHoras) return;
  sel.disabled = false;
  const opcion = (h) => `<option value="${esc(h.inicio)}" data-hora="${esc(h.hora)}"${h.costo_extra ? ' data-extra="1"' : ''}>${esc(h.hora)} hs${h.costo_extra ? ' (costo adicional)' : ''}</option>`;
  const normales = libres.filter((h) => !h.costo_extra);
  const extra = libres.filter((h) => h.costo_extra);
  let html = `<option value="">${libres.length ? 'Elegí un horario libre…' : 'No quedan horarios libres este día'}</option>`;
  if (normales.length) html += `<optgroup label="Horarios libres">${normales.map(opcion).join('')}</optgroup>`;
  if (extra.length) html += `<optgroup label="Domingo / fuera de horario · costo adicional">${extra.map(opcion).join('')}</optgroup>`;
  if (ocupados.length) html += `<optgroup label="Ya reservados (no disponibles)">${ocupados.map((h) => `<option disabled>${esc(h.hora)} hs · ocupado</option>`).join('')}</optgroup>`;
  sel.innerHTML = html + OPCION_COORDINAR;
  if (libres.length) {
    ayuda.textContent = `${libres.length === 1 ? 'Queda 1 horario libre' : `Hay ${libres.length} horarios libres`} este día.${ocupados.length ? ` ${ocupados.length === 1 ? '1 ya está reservado' : `${ocupados.length} ya están reservados`}.` : ''}`;
    $('#r-dias').hidden = true;
  } else {
    ayuda.textContent = 'Este día está completo. Elegí otro día de la lista o "A coordinar".';
  }
  actualizarAvisoExtra();
}

// Tira de los próximos 14 días con su estado (libre, últimos turnos, completo, recargo).
const cacheDias = new Map();
let pedidoDias = 0;
async function pintarTiraDias(datos) {
  const caja = $('#r-dias-tira');
  const cont = $('#r-dias-tira-lista');
  const n = ++pedidoDias;
  const hoy = new Date();
  const fechas = Array.from({ length: 14 }, (_, k) => fechaLocalISO(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + k)));
  let mapa = null;
  if (modoSupabase && datos && datos.usaTurno) {
    const c = cacheDias.get(datos.id);
    if (c && Date.now() - c.t < 60000) mapa = c.mapa;
    else {
      try {
        const dias = await rpc('dias_con_turnos', { p_servicio: datos.id, p_dias: 21 });
        mapa = Object.fromEntries((dias || []).map((d) => [d.fecha, d]));
        cacheDias.set(datos.id, { t: Date.now(), mapa });
      } catch { mapa = null; }
      if (n !== pedidoDias) return;
    }
  }
  const esEvento = datos && datos.esEvento;
  const dias = fechas.map((fecha) => {
    const info = horarioDelDia(fecha);
    if (mapa) {
      const d = mapa[fecha];
      if (d) {
        if (d.costo_extra) return { fecha, estado: 'extra', nota: 'Recargo' };
        if (d.libres <= 3) return { fecha, estado: 'pocos', nota: d.libres === 1 ? 'Último turno' : `Últimos ${d.libres}` };
        return { fecha, estado: 'libre', nota: 'Disponible' };
      }
      return info && info.horario ? { fecha, estado: 'completo', nota: 'Completo' } : { fecha, estado: 'cerrado', nota: 'Sin turnos' };
    }
    if (!esEvento && info && !info.horario) return { fecha, estado: 'extra', nota: 'Recargo' };
    return { fecha, estado: 'libre', nota: 'Disponible' };
  });
  pintarDias(cont, dias, $('#r-fecha').value);
  caja.hidden = !datos || datos.id === 'consulta';
}

function marcarDiaElegido() {
  const v = $('#r-fecha').value;
  $$('#r-dias-tira-lista .dia-celda').forEach((b) => { const si = b.dataset.fecha === v; b.classList.toggle('elegido', si); b.setAttribute('aria-pressed', String(si)); });
}

// Los horarios se muestran como botones (espejo del <select> #r-hora).
function refrescarHoras() {
  const sel = $('#r-hora');
  const caja = $('#r-horas-chips');
  const lista = $('#r-horas-lista');
  $('#form-reserva').classList.add('con-chips');
  caja.hidden = false;
  if (sel.disabled) { lista.innerHTML = '<div class="horas-cargando" aria-busy="true"><span></span><span></span><span></span><span></span></div>'; $('#r-horas-titulo').textContent = 'Buscando horarios libres…'; return; }
  pintarHoras(sel, lista);
  const f = $('#r-fecha').value;
  if (f) {
    const [a, m, d] = f.split('-').map(Number);
    const fecha = new Date(a, m - 1, d);
    $('#r-horas-titulo').textContent = `Horarios del ${DIAS_ES[fecha.getDay()].toLowerCase()} ${d}/${m}`;
  } else $('#r-horas-titulo').textContent = 'Horarios';
}

function aplicarModoReserva() {
  $('#reserva-bajada').textContent = modoSupabase
    ? 'Elegí el servicio, el día y un horario libre. Tania te confirma por WhatsApp.'
    : 'Completá tus datos y te llevamos a WhatsApp con la solicitud lista para enviar a Tania.';
  $('#r-enviar-texto').textContent = modoSupabase ? 'Enviar solicitud' : 'Enviar solicitud por WhatsApp';
}

function generarHorasFijas() {
  const sel = $('#r-hora');
  const actual = sel.value;
  const info = horarioDelDia($('#r-fecha').value);
  pedidoHoras++;
  const datos = reservas[$('#r-servicio').value];
  const esEvento = datos && datos.esEvento;
  const opciones = ['<option value="">Elegí un horario…</option>'];
  let abre = '09:00';
  let cierra = '20:00';
  if (info && info.horario) { abre = info.horario.abre; cierra = info.horario.cierra; }
  const aMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const hhmm = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const domingo = !!(info && !info.horario);
  if (!esEvento) {
    // Horario habitual + horarios fuera de horario (con costo adicional, solo con turno previo).
    const normales = [];
    const extra = [];
    for (let t = HORA_EXTRA_DESDE; t <= HORA_EXTRA_HASTA; t += 30) {
      const dentro = !domingo && t >= aMin(abre) && t < aMin(cierra);
      (dentro ? normales : extra).push(t);
    }
    if (normales.length) {
      opciones.push(`<optgroup label="Horario habitual">${normales.map((t) => `<option value="${hhmm(t)}">${hhmm(t)} hs</option>`).join('')}</optgroup>`);
    }
    opciones.push(`<optgroup label="${domingo ? 'Domingo' : 'Fuera de horario'} · costo adicional">${extra.map((t) => `<option value="${hhmm(t)}" data-extra="1">${hhmm(t)} hs (costo adicional)</option>`).join('')}</optgroup>`);
  } else {
    for (let t = 8 * 60; t <= 23 * 60; t += 30) {
      const hh = String(Math.floor(t / 60)).padStart(2, '0');
      const mm = String(t % 60).padStart(2, '0');
      opciones.push(`<option value="${hh}:${mm}">${hh}:${mm} hs</option>`);
    }
  }
  opciones.push(OPCION_COORDINAR);
  sel.innerHTML = opciones.join('');
  if ([...sel.options].some((o) => o.value === actual)) sel.value = actual;

  const ayuda = $('#r-fecha-info');
  if (domingo) {
    ayuda.textContent = `Los domingos se atiende solo con turno previo. Horario habitual: ${catalogo.negocio.horarioTexto}`;
  } else if (esEvento) {
    ayuda.textContent = 'Para eventos indicá el horario aproximado de inicio de la fiesta.';
  } else {
    ayuda.textContent = '';
  }
  actualizarAvisoExtra();
}

/** ¿La solicitud cae en domingo o fuera del horario habitual? (implica costo adicional) */
function esFueraDeHorario() {
  const info = horarioDelDia($('#r-fecha').value);
  const opcion = $('#r-hora').selectedOptions[0];
  return !!((info && !info.horario) || (opcion && opcion.dataset.extra));
}

function actualizarAvisoExtra() {
  $('#r-extra').hidden = !esFueraDeHorario();
}

function actualizarServicio() {
  const datos = reservas[$('#r-servicio').value];
  const info = $('#r-servicio-info');
  info.textContent = datos && datos.precio ? `Valor de referencia: ${datos.precio}` : '';
  if (datos && datos.categoria === 'academia') {
    info.innerHTML = `${esc(info.textContent)} · <button type="button" class="btn-link" data-reservar="${esc(datos.id)}">Inscribite online y pagá por transferencia o QR</button>`;
  }
  $('#r-tocado-campo').hidden = !(datos && datos.permiteTocado);
  if ($('#r-tocado-campo').hidden) $('#r-tocado').checked = false;
  $('#r-personas-campo').hidden = !(datos && (datos.esEvento || /^maquillaje-(social|alta)/.test(datos.id)));
  const conSena = !!(datos && datos.sena);
  $('#r-politica').hidden = !conSena;
  if (conSena) {
    $('#r-sena').textContent = datos.sena;
    $('#r-pago-sena').textContent = datos.sena;
    $('#r-pago-total').textContent = datos.precio || 'a confirmar';
    $('#form-reserva').querySelector('input[name="pago"][value="seña"]').checked = true;
  }
  $('#r-acepto').checked = false;
  generarHoras();
}

// Cursos: "Inscribirme" abre la inscripción online (módulo aparte, se carga al primer uso).
let inscripcionModulo = null;
const cargarInscripcion = () => (inscripcionModulo ||= import('./inscripcion.js' + VERSION_JS).catch((e) => { inscripcionModulo = null; throw e; }));
async function abrirCurso(id, origen) {
  try {
    const m = await cargarInscripcion();
    const ok = await m.abrirInscripcion(id, origen, { catalogo: () => catalogo, abrirDialogo, registrarDialogo, enLinea: () => modoSupabase, aviso });
    if (ok) return;
  } catch (err) {
    console.warn('No se pudo abrir la inscripción; se usa el formulario de reserva.', err);
  }
  abrirReserva(id, origen, { forzar: true });
}

function abrirReserva(idServicio, origen, { forzar = false } = {}) {
  if (!forzar && reservas[idServicio] && reservas[idServicio].categoria === 'academia') { abrirCurso(idServicio, origen); return; }
  const form = $('#form-reserva');
  form.hidden = false;
  $('#reserva-ok').hidden = true;
  $('#r-error').textContent = '';
  $$('.campo-invalido', form).forEach((el) => el.classList.remove('campo-invalido'));
  const sel = $('#r-servicio');
  sel.value = idServicio && reservas[idServicio] ? idServicio : '';
  const hoy = new Date();
  $('#r-fecha').min = fechaLocalISO(hoy);
  $('#r-enviar').disabled = false;
  aplicarModoReserva();
  actualizarServicio();
  abrirDialogo($('#dlg-reserva'), origen);
  // En el celular no forzamos el teclado: el foco va al primer campo vacío solo en escritorio.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    (sel.value ? $('#r-nombre') : sel).focus();
  }
}

function telefonoValido(t) {
  const d = t.replace(/[^\d+]/g, '');
  return /^(\+?595|0)?9\d{8}$/.test(d) || /^\+?\d{8,15}$/.test(d);
}

function marcar(el, invalido) {
  el.closest('.campo, .check, .politica').classList.toggle('campo-invalido', invalido);
  el.setAttribute('aria-invalid', invalido ? 'true' : 'false');
}

// Desfase horario de una zona en una fecha (ej. "-03:00"), para enviar fecha y hora locales a Supabase.
function desfaseZona(zona, fechaISO) {
  try {
    const parte = new Intl.DateTimeFormat('en-US', { timeZone: zona, timeZoneName: 'longOffset' })
      .formatToParts(new Date(`${fechaISO}T12:00:00Z`)).find((p) => p.type === 'timeZoneName').value;
    return parte === 'GMT' ? '+00:00' : parte.replace('GMT', '');
  } catch {
    return '-03:00';
  }
}

const MENSAJES_ERROR = {
  HORARIO_NO_DISPONIBLE: 'Ese horario se acaba de ocupar. Elegí otro, por favor.',
  FECHA_PASADA: 'Ese horario ya pasó. Elegí otro, por favor.',
  NOMBRE_INVALIDO: 'Escribí tu nombre y apellido.',
  TELEFONO_INVALIDO: 'Escribí un teléfono válido (ej: 0981 123 456).',
  EMAIL_INVALIDO: 'Revisá el email (o dejalo vacío).',
  SERVICIO_NO_DISPONIBLE: 'Ese servicio no está disponible en este momento. Preguntá en el chat.',
};

function mostrarReservaOk({ registrada, url, resumen, abrir, id, texto }) {
  const f = $('#form-reserva');
  const cajaPago = $('#reserva-pago');
  cajaPago.hidden = true; cajaPago.innerHTML = ''; $('#reserva-ok-registrada').classList.remove('con-pago');
  if (registrada && id) pintarPagoReserva(cajaPago, id, texto);
  $('#reserva-ok-titulo').textContent = registrada ? '¡Solicitud enviada!' : '¡Solicitud lista!';
  $('#reserva-ok-registrada').hidden = !registrada;
  $('#reserva-ok-whatsapp').hidden = registrada;
  $('#reserva-ok-resumen').textContent = resumen || '';
  $('#reserva-enlace').href = url;
  $('#reserva-enlace-extra').href = url;
  let ventana = null;
  if (abrir) {
    ventana = window.open(url, '_blank');
    if (ventana) ventana.opener = null;
  }
  f.hidden = true;
  const ok = $('#reserva-ok');
  ok.hidden = false;
  ok.focus();
  // Si el navegador bloqueó la ventana, el enlace visible sirve de respaldo.
  if (abrir && !ventana) aviso('Tocá el enlace para abrir WhatsApp.');
}

// Después de crear el turno: datos de transferencia + comprobante + WhatsApp (solo si comprobantes.sql está instalado).
async function pintarPagoReserva(caja, id, texto) {
  let mod;
  try { mod = await import('./comprobante.js'); } catch { return; }
  const pago = await mod.datosPago('r', id);
  if (!pago) return; // sin la función nueva: queda el flujo anterior
  const tel = (catalogo.negocio && catalogo.negocio.whatsapp) || mod.WA_TANIA;
  mod.pintarComprobante(caja, { tipo: 'r', id, pago, tel, conPago: !!(pago.datos_pago || pago.monto_gs || pago.monto_texto),
    mensaje: [texto, pago.monto_texto ? `💳 *${pago.es_sena ? 'Seña' : 'Monto'} a transferir:* ${pago.monto_texto}` : ''].filter(Boolean).join('\n') });
  caja.hidden = false;
  $('#reserva-ok-registrada').classList.add('con-pago');
}

async function enviarReserva(e) {
  e.preventDefault();
  const f = e.target;
  const datos = reservas[f.servicio.value];
  const errores = [];
  const chequear = (el, ok, msg) => { marcar(el, !ok); if (el === f.hora) $('#r-horas-chips').classList.toggle('campo-invalido', !ok); if (!ok) errores.push({ el, msg }); };
  chequear(f.servicio, !!datos, 'Elegí un servicio.');
  chequear(f.nombre, f.nombre.value.trim().length >= 3, 'Escribí tu nombre y apellido.');
  chequear(f.telefono, telefonoValido(f.telefono.value), 'Escribí un teléfono válido (ej: 0981 123 456).');
  chequear(f.email, !f.email.value.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim()), 'Revisá el email (o dejalo vacío).');
  chequear(f.fecha, !!f.fecha.value && f.fecha.value >= f.fecha.min, 'Elegí una fecha a partir de hoy.');
  chequear(f.hora, !!f.hora.value, 'Elegí un horario (o "a coordinar").');
  if (datos && datos.sena) chequear(f.acepto, f.acepto.checked, 'Para continuar, aceptá la política de reserva.');
  if (errores.length) {
    $('#r-error').textContent = errores.map((x) => x.msg).join(' ');
    const foco = errores[0].el === f.hora && f.classList.contains('con-chips') ? ($('#r-horas-lista .hora-boton:not([disabled])') || $('#r-dias-tira-lista .dia-celda:not([disabled])')) : errores[0].el;
    if (foco) foco.focus();
    return;
  }
  $('#r-error').textContent = '';

  const [a, m, d] = f.fecha.value.split('-').map(Number);
  const fecha = new Date(a, m - 1, d);
  const fechaTexto = `${DIAS_ES[fecha.getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
  const opcionHora = f.hora.selectedOptions[0];
  const aCoordinar = f.hora.value === 'a coordinar';
  const horaLocal = aCoordinar ? '' : (opcionHora && opcionHora.dataset.hora) || f.hora.value;
  const horaTexto = aCoordinar ? 'A coordinar' : `${horaLocal} hs`;
  let servicio = datos.nombre;
  if (f.tocado.checked) servicio += ' + Añadir Tocado Exclusivo';
  const personas = !$('#r-personas-campo').hidden && f.personas.value ? Number(f.personas.value) : null;
  const extra = esFueraDeHorario();

  const lineas = [
    '📱 *--- NUEVA SOLICITUD WEB ---*',
    `👤 *Cliente:* ${f.nombre.value.trim()}`,
    `📞 *Teléfono:* ${f.telefono.value.trim()}`,
    `💅 *Servicio:* ${servicio}`,
  ];
  if (datos.precio) lineas.push(`💰 *Valor de Referencia:* ${datos.precio}`);
  lineas.push(`📅 *Fecha preferida:* ${fechaTexto}`);
  lineas.push(`🕒 *Horario preferido:* ${horaTexto}`);
  if (personas) lineas.push(`👥 *Personas:* ${personas}`);
  if (extra) lineas.push('⚠️ *Domingo / fuera de horario:* entiendo que tiene costo adicional.');
  if (f.notas.value.trim()) lineas.push(`📝 *Comentarios:* ${f.notas.value.trim()}`);
  if (datos.sena) {
    const pago = f.pago.value === 'total' ? `Total (${datos.precio || 'a confirmar'})` : `Solo la seña (${datos.sena}); el saldo por transferencia o QR`;
    lineas.push(`💳 *Forma de reserva:* ${pago}`);
  }
  lineas.push(datos.sena ? `✅ *Acepta política de seña previa (${datos.sena}).*` : '✅ *Consultas y diseño personalizado (Sin seña previa).*');
  lineas.push('*---------------------------------------*');
  lineas.push(`¡Hola Tania! Me contacto porque quisiera ${datos.accion}, por favor.`);
  // api.whatsapp.com directo: la redirección de wa.me rompe los emojis del texto.
  const url = `https://api.whatsapp.com/send?phone=${catalogo.negocio.whatsapp}&text=${encodeURIComponent(lineas.join('\n'))}`;
  const resumen = `${servicio} · ${fechaTexto} · ${horaTexto}`;

  // Trampa para robots: si el campo oculto viene completo, se finge éxito y no se registra nada.
  if (f.sitio_web.value) { mostrarReservaOk({ registrada: true, url, resumen }); return; }

  if (!modoSupabase) { mostrarReservaOk({ registrada: false, url, resumen, abrir: true }); return; }

  const notas = [f.tocado.checked ? 'Quiere añadir Tocado Exclusivo.' : '', f.notas.value.trim()].filter(Boolean).join(' ');
  const args = {
    p_servicio: datos.id,
    p_nombre: f.nombre.value.trim(),
    p_telefono: f.telefono.value.trim(),
    p_email: f.email.value.trim() || null,
    p_notas: notas || null,
    p_pago: f.pago.value === 'total' && datos.sena ? 'total' : 'sena',
    p_personas: personas,
    p_fecha_preferida: f.fecha.value,
    p_hora_preferida: aCoordinar ? 'a coordinar' : horaLocal,
  };
  if (!aCoordinar) {
    args.p_inicio = datos.usaTurno ? f.hora.value : `${f.fecha.value}T${horaLocal}:00${desfaseZona(catalogo.negocio.zonaHoraria || 'Etc/GMT+3', f.fecha.value)}`;
  }
  const boton = $('#r-enviar');
  boton.disabled = true;
  $('#r-enviar-texto').textContent = 'Enviando…';
  try {
    const r = await rpc('crear_reserva', args);
    if (!r || r.ok === false) throw Object.assign(new Error('reserva'), { codigo: (r && r.error) || 'ERROR' });
    mostrarReservaOk({ registrada: true, url, resumen, id: r.id, texto: lineas.join('\n') });
  } catch (err) {
    const msg = MENSAJES_ERROR[err.codigo];
    if (msg) {
      $('#r-error').textContent = msg;
      if (err.codigo === 'HORARIO_NO_DISPONIBLE' || err.codigo === 'FECHA_PASADA') { marcar(f.hora, true); generarHoras(); f.hora.focus(); }
    } else if (err.codigo === 'DEMASIADAS_SOLICITUDES') {
      aviso('Ya recibimos varias solicitudes desde este teléfono. Te abrimos WhatsApp para hablar directo con Tania.');
      mostrarReservaOk({ registrada: false, url, resumen, abrir: false });
    } else {
      // Sin conexión con Supabase u otro problema: la solicitud sigue por WhatsApp.
      console.info('No se pudo registrar la reserva en línea; se ofrece WhatsApp.', err.codigo || err);
      aviso('No pudimos registrar la solicitud en línea. Enviala por WhatsApp, por favor.');
      mostrarReservaOk({ registrada: false, url, resumen, abrir: false });
    }
  } finally {
    boton.disabled = false;
    aplicarModoReserva();
  }
}

function prepararReserva() {
  const f = $('#form-reserva');
  $('#r-servicio').addEventListener('change', actualizarServicio);
  $('#r-fecha').addEventListener('change', generarHoras);
  $('#r-hora').addEventListener('change', () => { actualizarAvisoExtra(); refrescarHoras(); });
  $('#r-fecha').addEventListener('change', marcarDiaElegido);
  new MutationObserver(refrescarHoras).observe($('#r-hora'), { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  $('#r-horas-lista').addEventListener('click', (e) => {
    const b = e.target.closest('.hora-boton[data-valor]');
    if (!b) return;
    const sel = $('#r-hora');
    sel.value = b.dataset.valor;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    $('#r-horas-chips').classList.remove('campo-invalido');
  });
  f.addEventListener('submit', enviarReserva);
  const limpiar = (e) => {
    if (e.target.getAttribute('aria-invalid') === 'true') marcar(e.target, false);
    if (!$$('[aria-invalid="true"]', f).length) $('#r-error').textContent = '';
  };
  f.addEventListener('input', limpiar);
  f.addEventListener('change', limpiar);
}

// ------------------------------------------------------------------
// Compartir (con manejo de cancelación y respaldo de copiar enlace)
// ------------------------------------------------------------------
async function compartir(ancla) {
  const url = location.origin + location.pathname + (ancla ? '#' + ancla : '');
  const datos = { title: 'Tania Sanabria · Makeup Studio Professional', url };
  if (navigator.share) {
    try {
      await navigator.share(datos);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // la persona canceló
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    aviso('¡Enlace copiado! Ya podés pegarlo en WhatsApp o Instagram.');
  } catch {
    window.prompt('Copiá este enlace:', url);
  }
}

// ------------------------------------------------------------------
// Menú móvil, galería por álbumes y delegación de clics
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// Vistas por categoría (#maquillaje, #academia/curso-x, #galeria/social…):
// cada botón del menú abre una sección exclusiva; el botón "atrás" y los enlaces directos funcionan.
// Sin JS (o para buscadores) todo el contenido sigue en la página.
// ------------------------------------------------------------------
let vistaActual = null;
const TITULO_BASE = document.title;

function vistasDisponibles() {
  return new Set($$('[data-vista]').flatMap((el) => el.dataset.vista.split(/\s+/)));
}

function mostrarVista(vista, { sub = '', album = '', arriba = true } = {}) {
  if (!vistasDisponibles().has(vista)) vista = 'inicio';
  const cambio = vista !== vistaActual;
  vistaActual = vista;
  document.documentElement.classList.add('vistas');
  for (const el of $$('[data-vista]')) {
    const activa = el.dataset.vista.split(/\s+/).includes(vista) && !(el.hidden && catalogo.categorias.some((c) => c.id === el.id));
    el.classList.toggle('activa', activa);
  }
  for (const a of $$('.menu-cat')) {
    const si = a.dataset.ir === vista;
    a.classList.toggle('activo', si);
    if (si) { a.setAttribute('aria-current', 'page'); a.scrollIntoView({ block: 'nearest', inline: 'center', behavior: cambio && vistaActual ? 'smooth' : 'auto' }); }
    else a.removeAttribute('aria-current');
  }
  // Subcategorías (filtro de tarjetas)
  const seccion = document.getElementById(vista);
  if (seccion && seccion.querySelector('.subcats')) {
    const valido = sub && seccion.querySelector(`#servicio-${CSS.escape(sub)}`);
    for (const l of $$('.subcat', seccion)) {
      const si = l.dataset.sub === (valido ? sub : '');
      l.classList.toggle('activa', si);
      if (si) { l.setAttribute('aria-current', 'true'); l.scrollIntoView({ block: 'nearest', inline: 'center' }); } else l.removeAttribute('aria-current');
    }
    for (const t of $$('.grilla > .tarjeta', seccion)) t.hidden = !!valido && t.id !== 'servicio-' + sub;
    seccion.querySelector('.grilla').classList.toggle('grilla-sola', !!valido);
  }
  if (vista === 'galeria' && album) {
    const chip = $(`.chip[data-album="${CSS.escape(album)}"]`);
    if (chip) elegirAlbum(chip, false);
  }
  const etiqueta = $(`.menu-cat[data-ir="${CSS.escape(vista)}"] span`);
  document.title = vista === 'inicio' || !etiqueta ? TITULO_BASE : `${etiqueta.textContent} · Tania Sanabria Makeup Studio`;
  if (arriba && (cambio || sub)) window.scrollTo({ top: 0, behavior: 'auto' });
  requestAnimationFrame(() => refrescarCarruseles());
}

function prepararMenu() {
  const cabecera = $('#cabecera');
  const observador = new IntersectionObserver(([en]) => cabecera.classList.toggle('compacta', !en.isIntersecting), { rootMargin: '-80px 0px 0px 0px' });
  observador.observe($('#inicio'));
  // Tocar la categoría en la que ya estás: vuelve arriba (y quita el filtro de subcategoría).
  $('#menu-cats').addEventListener('click', (e) => {
    const a = e.target.closest('.menu-cat');
    if (a && location.hash.split('/')[0] === '#' + a.dataset.ir) { e.preventDefault(); if (location.hash !== '#' + a.dataset.ir) location.hash = a.dataset.ir; else window.scrollTo({ top: 0, behavior: 'smooth' }); }
    if (a && !location.hash && a.dataset.ir === 'inicio') { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
}

function elegirAlbum(chip, actualizarUrl = true) {
  $$('.chip[data-album]').forEach((c) => c.setAttribute('aria-selected', String(c === chip)));
  $$('[data-album-panel]').forEach((p) => { p.hidden = p.dataset.albumPanel !== chip.dataset.album; });
  if (actualizarUrl) history.replaceState(history.state, '', '#galeria/' + chip.dataset.album);
  refrescarCarruseles($('#galeria'));
}

// Asistente virtual: se descarga recién al tocar el botón (no afecta la carga de la página).
const VERSION_JS = new URL(import.meta.url).search;
let chatModulo = null;
const cargarChat = () => (chatModulo ||= import('./chat.js' + VERSION_JS));
async function abrirAsistente(origen) {
  try {
    const m = await cargarChat();
    m.abrirChat({ catalogo: () => catalogo, abrirReserva, abrirDetalle }, origen);
  } catch (err) {
    console.warn('No se pudo abrir el asistente:', err);
    chatModulo = null;
    window.open(`https://wa.me/${catalogo.negocio.whatsapp}`, '_blank', 'noopener');
  }
}

function prepararClics() {
  // Precarga suave cuando el dedo o el mouse se acerca al botón del chat
  ['pointerenter', 'touchstart', 'focusin'].forEach((ev) => document.addEventListener(ev, (e) => {
    if (e.target.closest && e.target.closest('[data-chat]')) cargarChat().catch(() => { chatModulo = null; });
  }, { passive: true, capture: true }));
  document.addEventListener('click', (e) => {
    const asistente = e.target.closest('[data-chat]');
    if (asistente) { e.preventDefault(); abrirAsistente(asistente); return; }
    const reservar = e.target.closest('[data-reservar]');
    if (reservar) { e.preventDefault(); abrirReserva(reservar.dataset.reservar, reservar); return; }
    const detalle = e.target.closest('[data-detalle]');
    if (detalle) { e.preventDefault(); abrirDetalle(detalle.dataset.detalle, detalle); return; }
    const foto = e.target.closest('[data-lightbox]');
    if (foto) { e.preventDefault(); abrirVisor(foto.dataset.lightbox, Number(foto.dataset.indice), foto); return; }
    const comp = e.target.closest('[data-compartir]');
    if (comp) { e.preventDefault(); compartir(comp.dataset.compartir); return; }
    const chip = e.target.closest('.chip[data-album]');
    if (chip) { elegirAlbum(chip); return; }
    const dia = e.target.closest('.dia-chip[data-fecha], .dia-celda[data-fecha]');
    if (dia) { const campo = $('#r-fecha'); campo.value = dia.dataset.fecha; campo.dispatchEvent(new Event('change', { bubbles: true })); }
  });
}

// Enlaces viejos del sitio anterior (#modal-maq-novias, #cursos…) siguen funcionando.
const ENLACES_VIEJOS = {
  menu: 'inicio', neon: 'eventos', cursos: 'academia', biografia: 'sobre-tania', reserva: null,
  'modal-maq-social-general': 'maquillaje-social', 'modal-maq-social': 'maquillaje-alta-gama', 'modal-maq-aerografo': 'maquillaje-aerografo',
  'modal-maq-novias': 'maquillaje-novias', 'modal-maq-quince': 'maquillaje-quinceaneras', 'modal-maq-artistico-fx': 'maquillaje-artistico-fx',
  'modal-maq-delineado': 'maquillaje-delineados', 'modal-cejas': 'cejas', 'modal-trenzas': 'trenzas', 'modal-tocados': 'tocados',
  'modal-glitter': 'glitter-bar', 'modal-neon-party': 'neon-party', 'modal-glitter-neon': 'combo-glitter-neon', 'modal-caritas': 'caritas-pintadas',
  'modal-curso-auto': 'curso-automaquillaje', 'modal-curso-pro-inicial': 'curso-maquillador-inicial', 'modal-curso-pro-avanzado': 'curso-maquillador-avanzado',
  'modal-curso-vip': 'curso-maquillaje-artistico', 'modal-curso-foto': 'curso-fotografia-beauty',
};

function atenderHash() {
  let hash = decodeURIComponent(location.hash.slice(1));
  if (hash in ENLACES_VIEJOS) {
    const destino = ENLACES_VIEJOS[hash];
    if (!destino) { mostrarVista(vistaActual || 'inicio'); return; }
    hash = servicioPorId(destino) ? 'servicio-' + destino : destino;
    history.replaceState(null, '', '#' + hash);
  }
  if (!hash) { mostrarVista('inicio'); return; }
  // Enlace al asistente (p. ej. desde la página 404)
  if (hash === 'chat') { history.replaceState(null, '', location.pathname + location.search); mostrarVista(vistaActual || 'inicio', { arriba: false }); abrirAsistente(); return; }
  // Enlace directo a un servicio o curso (botón "Compartir"): abre su categoría y su ficha.
  const directo = hash.match(/^(?:servicio|curso)-(.+)$/);
  if (directo) {
    const s = servicioPorId(directo[1]);
    if (s) {
      mostrarVista(s.categoria);
      document.getElementById('servicio-' + directo[1])?.scrollIntoView({ block: 'center' });
      if (!$('#dlg-detalle').open) abrirDetalle(directo[1]);
      return;
    }
  }
  const [vista, sub] = hash.split('/');
  if (vistasDisponibles().has(vista)) { mostrarVista(vista, vista === 'galeria' ? { album: sub } : { sub }); return; }
  // Cualquier otro ancla: se muestra la vista que la contiene.
  const el = document.getElementById(hash);
  const contenedor = el && el.closest('[data-vista]');
  if (contenedor) {
    mostrarVista(contenedor.dataset.vista.split(/\s+/)[0], { arriba: false });
    el.scrollIntoView();
  } else if (!vistaActual) mostrarVista('inicio');
}

// ------------------------------------------------------------------
// Datos en vivo desde Supabase (lo que Tania cambia en /admin/)
// ------------------------------------------------------------------
function refrescarContenido(previo) {
  // Secciones por categoría: solo se reemplazan si cambió algo visible.
  for (const cat of catalogo.categorias) {
    const el = document.getElementById(cat.id);
    if (!el) continue;
    const nuevo = seccionCategoria(cat, catalogo.servicios, manifiesto);
    if (nuevo !== seccionCategoria(cat, previo.catalogo.servicios, previo.manifiesto)) {
      const plantilla = document.createElement('template');
      plantilla.innerHTML = nuevo.trim();
      el.replaceWith(plantilla.content.firstElementChild);
    }
    const hay = catalogo.servicios.some((s) => s.categoria === cat.id);
    document.getElementById(cat.id).hidden = !hay;
    document.querySelectorAll(`.acceso[href="#${cat.id}"]`).forEach((a) => { a.hidden = !hay; });
  }
  const galeria = galeriaPrincipal(catalogo.galerias, manifiesto);
  if (galeria !== galeriaPrincipal(previo.catalogo.galerias, previo.manifiesto)) $('#galeria-contenido').innerHTML = galeria;
  const dest = seccionDestacados(catalogo.galerias, manifiesto);
  if (dest !== seccionDestacados(previo.catalogo.galerias, previo.manifiesto) && $('#destacados') && dest) {
    const t = document.createElement('template'); t.innerHTML = dest.trim(); $('#destacados').replaceWith(t.content.firstElementChild);
  }
  const sel = $('#r-servicio');
  const opciones = opcionesServicio(catalogo.categorias, catalogo.servicios);
  if (opciones !== opcionesServicio(previo.catalogo.categorias, previo.catalogo.servicios)) {
    const valor = sel.value;
    sel.innerHTML = opciones;
    if (reservas[valor]) sel.value = valor;
  }
  // Textos del negocio editables desde el panel
  $$('[data-texto]').forEach((el) => { const t = catalogo.negocio[el.dataset.texto]; if (t && el.textContent !== t) el.textContent = t; });
  const viejo = previo.catalogo.negocio.whatsapp;
  const nuevoWa = catalogo.negocio.whatsapp;
  if (nuevoWa && viejo !== nuevoWa) {
    $$(`a[href*="wa.me/${viejo}"]`).forEach((a) => { a.href = a.href.replace(viejo, nuevoWa); });
  }
}

function subActual() {
  const [v, sub] = decodeURIComponent(location.hash.slice(1)).split('/');
  return v === 'galeria' ? { album: sub } : { sub };
}

async function actualizarDesdeSupabase() {
  if (!supabaseActivo()) return;
  try {
    const previo = { catalogo, manifiesto };
    const r = await cargarDesdeSupabase(catalogo, manifiesto);
    catalogo = r.catalogo;
    manifiesto = r.manifiesto;
    reservas = indiceReservas(catalogo.servicios);
    modoSupabase = true;
    refrescarContenido(previo);
    document.documentElement.classList.add('datos-en-vivo');
    iniciarCarruseles();
    if (!document.querySelector('dialog[open]')) { const v = vistaActual; vistaActual = null; mostrarVista(v || 'inicio', { arriba: false, ...subActual() }); }
    // Enlace directo a un curso o servicio que solo existe en Supabase (p. ej. un curso nuevo cargado por Tania).
    if (/^#(?:servicio|curso)-/.test(location.hash) && !$('#dlg-detalle').open && !document.querySelector('dialog[open]')) atenderHash();
    // Si la clienta ya tenía el formulario abierto, se actualizan los horarios.
    if ($('#dlg-reserva').open) { aplicarModoReserva(); generarHoras(); }
  } catch (err) {
    console.info('Se usan los datos embebidos (Supabase no disponible).', err.codigo || err);
  }
}

async function iniciar() {
  catalogo = cargarCatalogo();
  manifiesto = cargarManifiestoFotos();
  reservas = indiceReservas(catalogo.servicios);
  prepararDialogos();
  prepararVisor();
  prepararReserva();
  prepararMenu();
  prepararClics();
  iniciarCarruseles();
  atenderHash();
  window.addEventListener('hashchange', atenderHash);
  document.documentElement.classList.add('js-listo');
  actualizarDesdeSupabase();
  if (/[?&]comprobante=/.test(location.search)) import('./comprobante.js').then((m) => m.abrirDesdeEnlace(catalogo.negocio && catalogo.negocio.whatsapp)).catch(() => {});
}

iniciar().catch((err) => {
  // Si algo falla, el sitio sigue mostrando todo el contenido estático y los enlaces de WhatsApp.
  console.warn('No se pudo iniciar la interacción del sitio:', err);
});
