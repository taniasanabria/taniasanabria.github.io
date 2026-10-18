/*
 * app.js: interacción del sitio (menú, detalles, visor de fotos, formulario de reserva, compartir).
 * El contenido principal ya viene en el HTML; aquí solo se agrega comportamiento.
 */
import { cargarCatalogo, cargarManifiestoFotos, cargarDesdeSupabase, rpc, supabaseActivo } from './datos.js';
import { detalleServicio, fotosDisponibles, indiceReservas, rutaFoto, seccionCategoria, galeriaPrincipal, opcionesServicio, esc } from './render.js';

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
}

// ------------------------------------------------------------------
// Visor de fotos
// ------------------------------------------------------------------
const visor = { fotos: [], indice: 0, titulo: '' };

function coleccion(clave) {
  if (clave.startsWith('galeria-')) {
    const g = catalogo.galerias.find((x) => 'galeria-' + x.id === clave);
    return g ? { fotos: fotosDisponibles(g.fotos, manifiesto), titulo: g.titulo } : null;
  }
  const s = servicioPorId(clave);
  return s ? { fotos: fotosDisponibles(s.fotos, manifiesto), titulo: s.nombre } : null;
}

function mostrarFoto() {
  const base = visor.fotos[visor.indice];
  const info = manifiesto[base];
  const img = $('#visor-img');
  const anchos = info.anchos;
  img.classList.remove('ampliada');
  img.width = info.w;
  img.height = info.h;
  img.srcset = anchos.map((a) => `${rutaFoto(base, a, info)} ${a}w`).join(', ');
  img.sizes = '100vw';
  img.src = rutaFoto(base, anchos[anchos.length - 1], info);
  img.alt = `${visor.titulo}: foto ${visor.indice + 1} de ${visor.fotos.length}`;
  $('#visor-contador').textContent = `${visor.indice + 1} / ${visor.fotos.length}`;
  const varias = visor.fotos.length > 1;
  $('#visor-prev').hidden = !varias;
  $('#visor-sig').hidden = !varias;
  // Precargar la siguiente
  if (varias) {
    const sig = visor.fotos[(visor.indice + 1) % visor.fotos.length];
    const pre = new Image();
    pre.src = rutaFoto(sig, manifiesto[sig].anchos[manifiesto[sig].anchos.length - 1], manifiesto[sig]);
  }
}

function moverVisor(paso) {
  if (visor.fotos.length < 2) return;
  visor.indice = (visor.indice + paso + visor.fotos.length) % visor.fotos.length;
  mostrarFoto();
}

function abrirVisor(clave, indice, origen) {
  const c = coleccion(clave);
  if (!c || !c.fotos.length) return;
  visor.fotos = c.fotos;
  visor.titulo = c.titulo;
  visor.indice = Math.max(0, Math.min(indice || 0, c.fotos.length - 1));
  mostrarFoto();
  abrirDialogo($('#dlg-visor'), origen);
}

function prepararVisor() {
  const dlg = $('#dlg-visor');
  const img = $('#visor-img');
  $('#visor-prev').addEventListener('click', () => moverVisor(-1));
  $('#visor-sig').addEventListener('click', () => moverVisor(1));
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); moverVisor(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); moverVisor(1); }
  });
  // Deslizar para cambiar de foto; tocar para acercar/alejar. Se distingue arrastre de toque.
  let inicio = null;
  const escenario = $('#visor-escenario');
  escenario.addEventListener('pointerdown', (e) => { inicio = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  escenario.addEventListener('pointerup', (e) => {
    if (!inicio) return;
    const dx = e.clientX - inicio.x;
    const dy = e.clientY - inicio.y;
    const ampliada = img.classList.contains('ampliada');
    if (!ampliada && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      moverVisor(dx < 0 ? 1 : -1);
    } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && e.target === img) {
      img.classList.toggle('ampliada');
      if (img.classList.contains('ampliada')) {
        const r = img.getBoundingClientRect();
        escenario.scrollLeft = (e.clientX - r.left) - escenario.clientWidth / 2;
        escenario.scrollTop = (e.clientY - r.top) - escenario.clientHeight / 2;
      }
    } else if (!ampliada && e.target === escenario && Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      dlg.close();
    }
    inicio = null;
  });
  escenario.addEventListener('pointercancel', () => { inicio = null; });
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
  if (modoSupabase && datos && datos.usaTurno) return generarHorasLibres(datos);
  $('#r-dias').hidden = true;
  $('#r-hora').disabled = false;
  return generarHorasFijas();
}

// Horarios reales desde Supabase (solo los libres; nunca se ven datos de otras clientas).
let pedidoHoras = 0;
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
    cargarDiasLibres(datos, n);
    return;
  }
  sel.innerHTML = '<option value="">Buscando horarios libres…</option>';
  sel.disabled = true;
  ayuda.textContent = '';
  let libres;
  try {
    libres = await rpc('horarios_libres', { p_fecha: fecha, p_servicio: datos.id });
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
  sel.innerHTML = html + OPCION_COORDINAR;
  if (libres.length) {
    ayuda.textContent = `${libres.length === 1 ? 'Queda 1 horario libre' : `Hay ${libres.length} horarios libres`} este día.`;
    $('#r-dias').hidden = true;
  } else {
    ayuda.textContent = 'Este día no tiene horarios libres. Elegí otra fecha o "a coordinar".';
    cargarDiasLibres(datos, n);
  }
  actualizarAvisoExtra();
}

async function cargarDiasLibres(datos, n) {
  const caja = $('#r-dias');
  try {
    const dias = await rpc('dias_con_turnos', { p_servicio: datos.id, p_dias: 21 });
    if (n !== pedidoHoras) return;
    const fmt = new Intl.DateTimeFormat('es-PY', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
    $('#r-dias-lista').innerHTML = dias.slice(0, 8)
      .map((d) => `<button type="button" class="dia-chip${d.costo_extra ? ' dia-extra' : ''}" data-fecha="${esc(d.fecha)}">${esc(fmt.format(new Date(d.fecha + 'T12:00:00Z')))}</button>`)
      .join('');
    caja.hidden = !dias.length;
  } catch {
    caja.hidden = true;
  }
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

function mostrarReservaOk({ registrada, url, resumen, abrir }) {
  const f = $('#form-reserva');
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

async function enviarReserva(e) {
  e.preventDefault();
  const f = e.target;
  const datos = reservas[f.servicio.value];
  const errores = [];
  const chequear = (el, ok, msg) => { marcar(el, !ok); if (!ok) errores.push({ el, msg }); };
  chequear(f.servicio, !!datos, 'Elegí un servicio.');
  chequear(f.nombre, f.nombre.value.trim().length >= 3, 'Escribí tu nombre y apellido.');
  chequear(f.telefono, telefonoValido(f.telefono.value), 'Escribí un teléfono válido (ej: 0981 123 456).');
  chequear(f.email, !f.email.value.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.value.trim()), 'Revisá el email (o dejalo vacío).');
  chequear(f.fecha, !!f.fecha.value && f.fecha.value >= f.fecha.min, 'Elegí una fecha a partir de hoy.');
  chequear(f.hora, !!f.hora.value, 'Elegí un horario (o "a coordinar").');
  if (datos && datos.sena) chequear(f.acepto, f.acepto.checked, 'Para continuar, aceptá la política de reserva.');
  if (errores.length) {
    $('#r-error').textContent = errores.map((x) => x.msg).join(' ');
    errores[0].el.focus();
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
    mostrarReservaOk({ registrada: true, url, resumen });
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
  $('#r-hora').addEventListener('change', actualizarAvisoExtra);
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
function prepararMenu() {
  const btn = $('#btn-menu');
  const nav = $('#nav');
  const uso = btn.querySelector('use');
  const estado = (abierto) => {
    nav.classList.toggle('abierto', abierto);
    btn.setAttribute('aria-expanded', String(abierto));
    btn.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
    if (uso) uso.setAttribute('href', abierto ? '#i-xmark' : '#i-bars');
  };
  const cerrar = () => estado(false);
  btn.addEventListener('click', () => estado(!nav.classList.contains('abierto')));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) cerrar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('abierto')) { cerrar(); btn.focus(); } });
  const cabecera = $('#cabecera');
  const observador = new IntersectionObserver(([en]) => cabecera.classList.toggle('compacta', !en.isIntersecting), { rootMargin: '-80px 0px 0px 0px' });
  observador.observe($('#inicio'));
}

function elegirAlbum(chip) {
  $$('.chip').forEach((c) => c.setAttribute('aria-selected', String(c === chip)));
  $$('[data-album-panel]').forEach((p) => { p.hidden = p.dataset.albumPanel !== chip.dataset.album; });
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
    const dia = e.target.closest('.dia-chip[data-fecha]');
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
  const hash = decodeURIComponent(location.hash.slice(1));
  if (!hash) return;
  // Enlace al asistente (p. ej. desde la página 404)
  if (hash === 'chat') { history.replaceState(null, '', location.pathname + location.search); abrirAsistente(); return; }
  // Enlace directo a un servicio o curso (botón "Compartir"): abre su ficha.
  const directo = hash.match(/^(?:servicio|curso)-(.+)$/);
  if (directo && servicioPorId(directo[1])) {
    document.getElementById('servicio-' + directo[1])?.scrollIntoView();
    if (!$('#dlg-detalle').open) abrirDetalle(directo[1]);
    return;
  }
  if (hash in ENLACES_VIEJOS) {
    const destino = ENLACES_VIEJOS[hash];
    if (!destino) return;
    if (servicioPorId(destino)) {
      history.replaceState(null, '', '#servicio-' + destino);
      document.getElementById('servicio-' + destino)?.scrollIntoView();
      abrirDetalle(destino);
    } else {
      history.replaceState(null, '', '#' + destino);
      document.getElementById(destino)?.scrollIntoView();
    }
  }
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
  atenderHash();
  window.addEventListener('hashchange', atenderHash);
  document.documentElement.classList.add('js-listo');
  actualizarDesdeSupabase();
}

iniciar().catch((err) => {
  // Si algo falla, el sitio sigue mostrando todo el contenido estático y los enlaces de WhatsApp.
  console.warn('No se pudo iniciar la interacción del sitio:', err);
});
