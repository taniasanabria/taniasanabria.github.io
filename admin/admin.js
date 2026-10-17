/*
 * Panel de Tania (admin). Usa Supabase: Auth (email + contraseña), tablas con RLS, Storage y Realtime.
 * Solo funciona para emails cargados en la tabla public.admins (ver supabase/schema.sql).
 */
import { SUPABASE } from '../js/config.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const gs = (n) => (n || n === 0 ? 'Gs. ' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '');
const CATEGORIAS = { maquillaje: 'Maquillaje', estetica: 'Estética & Hair', eventos: 'Eventos VIP', academia: 'Academia' };
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ESTADOS = { pendiente: 'Pendiente', aprobada: 'Confirmada', pagada: 'Pagada', rechazada: 'Rechazada', cancelada: 'Cancelada' };

const sb = window.supabase.createClient(SUPABASE.url, SUPABASE.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'panel-tania' },
});

const estado = {
  zona: 'Etc/GMT+3', ajustes: null, privados: null, servicios: [], albumes: [], horario: [],
  pendientesVistos: null, vista: 'dia', fechaAgenda: null, canal: null, sondeo: null, email: '',
};

// ------------------------------------------------------------------ utilidades
let tToast;
function toast(texto, mal = false) {
  const t = $('#toast');
  t.textContent = texto;
  t.classList.toggle('mal', mal);
  t.classList.add('visible');
  clearTimeout(tToast);
  tToast = setTimeout(() => t.classList.remove('visible'), mal ? 5000 : 3200);
}
function mostrarVista(nombre) {
  for (const v of ['cargando', 'login', 'clave', 'panel']) $('#vista-' + v).hidden = v !== nombre;
}
function hoyISO() { return new Intl.DateTimeFormat('en-CA', { timeZone: estado.zona }).format(new Date()); }
function sumarDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function diaSemana(iso) { return new Date(iso + 'T12:00:00Z').getUTCDay(); }
function desfase(iso) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: estado.zona, timeZoneName: 'longOffset' }).formatToParts(new Date(iso + 'T12:00:00Z')).find((x) => x.type === 'timeZoneName').value;
    return p === 'GMT' ? '+00:00' : p.replace('GMT', '');
  } catch { return '-03:00'; }
}
const instante = (fecha, hora = '00:00') => new Date(`${fecha}T${hora}:00${desfase(fecha)}`);
const fmtFecha = (d, op) => new Intl.DateTimeFormat('es-PY', { timeZone: estado.zona, ...op }).format(d);
const fmtDiaISO = (iso, op = { weekday: 'long', day: 'numeric', month: 'numeric' }) => new Intl.DateTimeFormat('es-PY', { timeZone: 'UTC', ...op }).format(new Date(iso + 'T12:00:00Z'));
const horaDe = (ts) => fmtFecha(new Date(ts), { hour: '2-digit', minute: '2-digit', hour12: false });
const fechaLocalDe = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: estado.zona }).format(new Date(ts));

function numeroWhatsApp(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('595')) return d;
  if (d.startsWith('0')) return '595' + d.slice(1);
  if (d.length === 9 && d.startsWith('9')) return '595' + d;
  return d;
}
const urlWhatsApp = (tel, texto) => `https://api.whatsapp.com/send?phone=${numeroWhatsApp(tel)}&text=${encodeURIComponent(texto)}`;

function textoCuando(r) {
  if (r.inicio) {
    const ini = new Date(r.inicio);
    const dia = fmtFecha(ini, { weekday: 'long', day: 'numeric', month: 'numeric' });
    return `${dia} · ${horaDe(r.inicio)}${r.fin ? '–' + horaDe(r.fin) : ''}`;
  }
  if (r.fecha_preferida) return `${fmtDiaISO(r.fecha_preferida)} · ${r.hora_preferida && r.hora_preferida !== 'a coordinar' ? r.hora_preferida : 'hora a coordinar'}`;
  return 'Fecha a coordinar';
}

function rellenar(plantilla, r) {
  const total = r.pago === 'total';
  const valores = {
    nombre: (r.cliente_nombre || '').split(/\s+/)[0],
    servicio: r.servicio_nombre,
    fecha: r.inicio ? fmtFecha(new Date(r.inicio), { weekday: 'long', day: 'numeric', month: 'numeric' }) : (r.fecha_preferida ? fmtDiaISO(r.fecha_preferida) : 'a coordinar'),
    hora: r.inicio ? horaDe(r.inicio) : (r.hora_preferida && r.hora_preferida !== 'a coordinar' ? r.hora_preferida : 'a coordinar'),
    sena: r.sena_ref || 'a coordinar',
    precio: r.precio_ref || 'a coordinar',
    monto: total ? (r.precio_ref || 'a coordinar') : (r.sena_ref || r.precio_ref || 'a coordinar'),
    pago: total ? 'el total' : 'la seña',
    datos_pago: (estado.privados && estado.privados.datos_pago) || '(te paso los datos de pago por aquí)',
  };
  return String(plantilla || '').replace(/\{(\w+)\}/g, (m, k) => (k in valores ? valores[k] : m));
}

function errorLegible(error) {
  if (!error) return '';
  if (error.code === '23P01') return 'Ese horario se superpone con otra cita.';
  if (error.code === '42501' || /row-level security|permission/i.test(error.message || '')) return 'No tenés permiso para hacer esto. Volvé a ingresar.';
  if (/fetch|network|Failed/i.test(error.message || '')) return 'Sin conexión. Revisá internet e intentá de nuevo.';
  return error.message || 'Ocurrió un error.';
}

// ------------------------------------------------------------------ sonido de aviso
let audio;
function prepararAudio() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch { /* sin audio */ }
}
function sonar() {
  if (!audio) return;
  const t = audio.currentTime;
  [[880, 0], [1320, 0.18]].forEach(([f, d]) => {
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = f; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.25);
    o.connect(g).connect(audio.destination); o.start(t + d); o.stop(t + d + 0.3);
  });
  if (navigator.vibrate) navigator.vibrate([150, 80, 150]);
}
document.addEventListener('pointerdown', prepararAudio, { passive: true });

// ------------------------------------------------------------------ ingreso
async function iniciarSesion(e) {
  e.preventDefault();
  const f = e.target;
  const btn = $('#l-entrar');
  $('#login-error').textContent = '';
  if (!f.email.value.trim() || !f.clave.value) { $('#login-error').textContent = 'Completá email y contraseña.'; return; }
  btn.disabled = true; btn.textContent = 'Entrando…';
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.clave.value });
  btn.disabled = false; btn.textContent = 'Entrar';
  if (error) { $('#login-error').textContent = /invalid/i.test(error.message) ? 'Email o contraseña incorrectos.' : errorLegible(error); return; }
  f.clave.value = '';
  await entrarAlPanel();
}

async function entrarAlPanel() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { mostrarVista('login'); return; }
  const { data: esAdmin, error } = await sb.rpc('es_admin');
  if (error || !esAdmin) {
    await sb.auth.signOut();
    mostrarVista('login');
    $('#login-error').textContent = error ? errorLegible(error) : 'Esta cuenta no tiene permiso para usar el panel.';
    return;
  }
  estado.email = user.email;
  $('#cuenta-email').textContent = 'Ingresaste como ' + user.email;
  mostrarVista('panel');
  await cargarBase();
  elegirTab(location.hash.replace('#', '') || 'citas', false);
  suscribirse();
  await registrarSW();
  await asegurarPush(); // renueva la suscripción si ya había permiso
  pintarAvisos();
}

// ------------------------------------------------------------------ datos base
async function cargarBase() {
  const [aj, pr, sv, al, ho] = await Promise.all([
    sb.from('ajustes').select('*').eq('id', 1).single(),
    sb.from('ajustes_privados').select('*').eq('id', 1).single(),
    sb.from('servicios').select('*').order('orden').order('nombre'),
    sb.from('albumes').select('*').order('orden'),
    sb.from('horario_semanal').select('*').order('dia').order('abre'),
  ]);
  const err = aj.error || pr.error || sv.error || al.error || ho.error;
  if (err) { toast(errorLegible(err), true); return; }
  estado.ajustes = aj.data; estado.privados = pr.data; estado.servicios = sv.data; estado.albumes = al.data; estado.horario = ho.data;
  estado.zona = aj.data.zona_horaria || 'Etc/GMT+3';
  estado.fechaAgenda = estado.fechaAgenda || hoyISO();
}

// ------------------------------------------------------------------ pestañas
const cargadores = { citas: cargarCitas, horarios: cargarHorarios, fotos: cargarFotos, servicios: pintarServicios, ajustes: pintarAjustes };
function elegirTab(nombre, foco = true) {
  if (!cargadores[nombre]) nombre = 'citas';
  $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === nombre)));
  $$('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + nombre; });
  history.replaceState(null, '', '#' + nombre);
  window.scrollTo(0, 0);
  cargadores[nombre]();
  if (foco) $('#tab-' + nombre + ' h2').focus?.();
}

// ------------------------------------------------------------------ citas
function tarjetaCita(r, { nueva = false } = {}) {
  const etiquetas = [`<span class="etiqueta e-${r.estado}">${ESTADOS[r.estado]}</span>`];
  if (r.costo_extra) etiquetas.push('<span class="etiqueta extra">Costo adicional</span>');
  if (r.sena_ref || r.pago === 'total') etiquetas.push(`<span class="etiqueta">${r.pago === 'total' ? 'Paga el total' + (r.precio_ref ? ': ' + esc(r.precio_ref) : '') : 'Seña ' + esc(r.sena_ref || '')}</span>`);
  if (r.personas) etiquetas.push(`<span class="etiqueta">${r.personas} ${r.personas === 1 ? 'persona' : 'personas'}</span>`);
  if (!r.bloquea && r.inicio) etiquetas.push('<span class="etiqueta">No ocupa agenda</span>');
  etiquetas.push(`<span class="etiqueta">${r.origen === 'web' ? 'Desde la web' : 'Cargada a mano'}</span>`);
  let acciones = '';
  if (r.estado === 'pendiente') {
    acciones = `<button type="button" class="btn btn-aprobar" data-accion="aprobar" data-id="${r.id}">✓ Aprobar</button>
      <button type="button" class="btn btn-rechazar" data-accion="rechazar" data-id="${r.id}">✕ Rechazar</button>`;
  } else if (r.estado === 'aprobada') {
    acciones = `<button type="button" class="btn btn-pagada" data-accion="pagada" data-id="${r.id}">💰 Marcar como pagada</button>
      <button type="button" class="btn btn-wa" data-accion="whatsapp" data-id="${r.id}">💬 WhatsApp</button>
      <button type="button" class="btn btn-borde" data-accion="cancelar" data-id="${r.id}">Cancelar cita</button>`;
  } else if (r.estado === 'pagada') {
    acciones = `<button type="button" class="btn btn-wa" data-accion="whatsapp" data-id="${r.id}">💬 WhatsApp</button>
      <button type="button" class="btn btn-borde" data-accion="cancelar" data-id="${r.id}">Cancelar cita</button>`;
  }
  return `<article class="cita estado-${r.estado}${nueva ? ' nueva' : ''}" data-reserva="${r.id}">
    <div class="cita-cuando">${esc(textoCuando(r))}</div>
    <div class="cita-servicio">${esc(r.servicio_nombre)}</div>
    <div class="cita-cliente">${esc(r.cliente_nombre)} · <a href="tel:${esc(r.cliente_telefono.replace(/[^\d+]/g, ''))}">${esc(r.cliente_telefono)}</a>${r.cliente_email ? ` · <a href="mailto:${esc(r.cliente_email)}">${esc(r.cliente_email)}</a>` : ''}</div>
    ${r.notas ? `<p class="cita-notas">📝 ${esc(r.notas)}</p>` : ''}
    <div class="etiquetas">${etiquetas.join('')}</div>
    ${acciones ? `<div class="cita-acciones">${acciones}</div>` : ''}
  </article>`;
}

const cacheReservas = new Map();

async function cargarPendientes({ avisar = false } = {}) {
  const { data, error } = await sb.from('reservas').select('*').eq('estado', 'pendiente')
    .order('inicio', { ascending: true, nullsFirst: false }).order('creado', { ascending: true });
  if (error) { toast(errorLegible(error), true); return; }
  data.forEach((r) => cacheReservas.set(r.id, r));
  const previos = estado.pendientesVistos;
  const nuevas = previos ? data.filter((r) => !previos.has(r.id)) : [];
  estado.pendientesVistos = new Set(data.map((r) => r.id));
  const n = data.length;
  $('#n-pendientes').textContent = n;
  $('#n-pendientes').classList.toggle('hay', n > 0);
  const ins = $('#insignia');
  ins.hidden = n === 0; ins.textContent = n;
  document.title = (n ? `(${n}) ` : '') + 'Panel de Tania · Tania Sanabria Makeup Studio';
  ponerInsigniaApp(n);
  $('#lista-pendientes').innerHTML = n
    ? data.map((r) => tarjetaCita(r, { nueva: nuevas.some((x) => x.id === r.id) })).join('')
    : '<p class="vacio">No hay solicitudes pendientes. 🎉</p>';
  if (nuevas.length && (avisar || previos)) {
    sonar();
    ins.classList.remove('latido'); void ins.offsetWidth; ins.classList.add('latido');
    toast(nuevas.length === 1 ? `Nueva solicitud: ${nuevas[0].cliente_nombre} · ${nuevas[0].servicio_nombre}` : `${nuevas.length} solicitudes nuevas`);
    notificarNuevas(nuevas);
  }
}

async function cargarAgenda() {
  const desde = estado.vista === 'semana' ? sumarDias(estado.fechaAgenda, -((diaSemana(estado.fechaAgenda) + 6) % 7)) : estado.fechaAgenda;
  const dias = estado.vista === 'semana' ? 7 : 1;
  const hasta = sumarDias(desde, dias);
  const a = instante(desde).toISOString();
  const b = instante(hasta).toISOString();
  const [res, bloq, ext] = await Promise.all([
    sb.from('reservas').select('*').in('estado', ['pendiente', 'aprobada', 'pagada'])
      .or(`and(inicio.gte.${a},inicio.lt.${b}),and(inicio.is.null,fecha_preferida.gte.${desde},fecha_preferida.lt.${hasta})`)
      .order('inicio', { ascending: true, nullsFirst: false }),
    sb.from('bloqueos').select('*').gte('fecha', desde).lt('fecha', hasta),
    sb.from('turnos_extra').select('*').gte('fecha', desde).lt('fecha', hasta).order('inicio'),
  ]);
  if (res.error) { toast(errorLegible(res.error), true); return; }
  res.data.forEach((r) => cacheReservas.set(r.id, r));
  $('#ag-titulo').textContent = estado.vista === 'semana'
    ? `Semana del ${fmtDiaISO(desde, { day: 'numeric', month: 'long' })} al ${fmtDiaISO(sumarDias(desde, 6), { day: 'numeric', month: 'long' })}`
    : fmtDiaISO(desde, { weekday: 'long', day: 'numeric', month: 'long' });
  const hoy = hoyISO();
  let html = '';
  for (let i = 0; i < dias; i++) {
    const d = sumarDias(desde, i);
    const delDia = res.data.filter((r) => (r.inicio ? fechaLocalDe(r.inicio) : r.fecha_preferida) === d);
    const bl = (bloq.data || []).find((x) => x.fecha === d);
    const ex = (ext.data || []).filter((x) => x.fecha === d);
    const avisos = (bl ? `<p class="aviso-dia">⛔ Día bloqueado${bl.motivo ? ': ' + esc(bl.motivo) : ''}</p>` : '')
      + ex.map((x) => `<p class="aviso-dia extra">➕ Horario extra ${x.inicio.slice(0, 5)}–${x.fin.slice(0, 5)}${x.costo_extra ? ' (costo adicional)' : ''}</p>`).join('');
    const cuerpo = delDia.length ? delDia.map((r) => tarjetaCita(r)).join('') : '<p class="vacio">Sin citas</p>';
    html += estado.vista === 'semana'
      ? `<div class="dia-agenda${d === hoy ? ' hoy' : ''}"><h4>${esc(fmtDiaISO(d))}</h4>${avisos}<div class="lista">${cuerpo}</div></div>`
      : avisos + cuerpo;
  }
  $('#agenda').innerHTML = html;
}

async function cargarCitas() { await Promise.all([cargarPendientes(), cargarAgenda()]); }

async function cambiarEstado(r, nuevo) {
  const { error } = await sb.from('reservas').update({ estado: nuevo }).eq('id', r.id);
  if (error) { toast(errorLegible(error), true); return false; }
  return true;
}

function abrirWhatsApp(ventana, url) {
  if (ventana && !ventana.closed) { ventana.location.href = url; return; }
  const w = window.open(url, '_blank');
  if (!w) toast('Permití las ventanas emergentes para abrir WhatsApp.', true);
}

async function accionCita(accion, id, boton) {
  const r = cacheReservas.get(id);
  if (!r) return;
  if (accion === 'whatsapp') { window.open(urlWhatsApp(r.cliente_telefono, `¡Hola ${(r.cliente_nombre || '').split(/\s+/)[0]}! Soy Tania Sanabria. `), '_blank'); return; }
  if (accion === 'aprobar') {
    if (!estado.privados.datos_pago.trim() && !confirm('Todavía no cargaste los datos de pago en Ajustes. ¿Aprobar igual?')) return;
    const ventana = window.open('', '_blank'); // se abre ya (con el toque) para que el celular no la bloquee
    boton.disabled = true;
    if (await cambiarEstado(r, 'aprobada')) {
      abrirWhatsApp(ventana, urlWhatsApp(r.cliente_telefono, rellenar(estado.privados.mensaje_aprobacion, r)));
      toast('Cita confirmada ✓');
    } else if (ventana) ventana.close();
  } else if (accion === 'rechazar') {
    if (!confirm(`¿Rechazar la solicitud de ${r.cliente_nombre}? Se abrirá WhatsApp para avisarle.`)) return;
    const ventana = window.open('', '_blank');
    boton.disabled = true;
    if (await cambiarEstado(r, 'rechazada')) {
      abrirWhatsApp(ventana, urlWhatsApp(r.cliente_telefono, rellenar(estado.privados.mensaje_rechazo, r)));
      toast('Solicitud rechazada');
    } else if (ventana) ventana.close();
  } else if (accion === 'pagada') {
    boton.disabled = true;
    if (await cambiarEstado(r, 'pagada')) toast('Marcada como pagada 💰');
  } else if (accion === 'cancelar') {
    if (!confirm(`¿Cancelar la cita de ${r.cliente_nombre}? El horario vuelve a quedar libre.`)) return;
    boton.disabled = true;
    if (await cambiarEstado(r, 'cancelada')) toast('Cita cancelada');
  }
  await cargarCitas();
}

// Agregar cita a mano
function abrirNuevaCita() {
  const f = $('#form-cita');
  f.reset();
  $('#cita-error').textContent = '';
  $('#n-servicio').innerHTML = Object.entries(CATEGORIAS).map(([id, t]) => `<optgroup label="${esc(t)}">${estado.servicios.filter((s) => s.categoria === id)
    .map((s) => `<option value="${esc(s.id)}">${esc(s.nombre)}${s.activo ? '' : ' (inactivo)'}</option>`).join('')}</optgroup>`).join('');
  f.fecha.value = estado.fechaAgenda || hoyISO();
  $('#dlg-cita').showModal();
}
function fueraDeHorario(fecha, hora, durMin) {
  const dia = diaSemana(fecha);
  if (dia === 0) return true;
  const [h, m] = hora.split(':').map(Number);
  const ini = h * 60 + m; const fin = ini + durMin;
  return !estado.horario.some((x) => x.dia === dia && ini >= toMin(x.abre) && fin <= toMin(x.cierra));
}
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
async function guardarNuevaCita(e) {
  e.preventDefault();
  const f = e.target;
  const s = estado.servicios.find((x) => x.id === f.servicio.value);
  if (!s || !f.fecha.value || !f.hora.value || f.nombre.value.trim().length < 2 || f.telefono.value.replace(/\D/g, '').length < 6) {
    $('#cita-error').textContent = 'Completá servicio, fecha, hora, nombre y teléfono.'; return;
  }
  const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
  const fila = {
    servicio_id: s.id, servicio_nombre: s.extra?.nombreReserva || s.nombre, precio_ref: s.precio_reserva_texto || s.precio_texto,
    sena_ref: s.sena_gs ? gs(s.sena_gs) : null, inicio: instante(f.fecha.value, f.hora.value).toISOString(),
    cliente_nombre: f.nombre.value.trim(), cliente_telefono: f.telefono.value.trim(), notas: f.notas.value.trim() || null,
    pago: f.pago.value, estado: f.estado.value, origen: 'admin',
    costo_extra: f.costo_extra.checked || fueraDeHorario(f.fecha.value, f.hora.value, s.duracion_min),
  };
  const { error } = await sb.from('reservas').insert(fila);
  btn.disabled = false;
  if (error) { $('#cita-error').textContent = errorLegible(error); return; }
  $('#dlg-cita').close();
  toast('Cita agregada ✓');
  estado.fechaAgenda = f.fecha.value;
  await cargarCitas();
}

// ------------------------------------------------------------------ horarios
async function cargarHorarios() {
  const { data: ho } = await sb.from('horario_semanal').select('*').order('dia').order('abre');
  estado.horario = ho || [];
  const orden = [1, 2, 3, 4, 5, 6, 0];
  $('#horario-semanal').innerHTML = orden.map((d) => {
    const h = estado.horario.find((x) => x.dia === d);
    return `<div class="dia-fila${h ? '' : ' cerrado'}" data-dia="${d}">
      <label class="check"><input type="checkbox" data-abierto ${h ? 'checked' : ''}> ${DIAS[d]}</label>
      <input type="time" step="900" data-abre value="${h ? h.abre.slice(0, 5) : '09:00'}" aria-label="${DIAS[d]}: abre">
      <input type="time" step="900" data-cierra value="${h ? h.cierra.slice(0, 5) : '18:00'}" aria-label="${DIAS[d]}: cierra">
    </div>`;
  }).join('');
  const hoy = hoyISO();
  const [bl, ex] = await Promise.all([
    sb.from('bloqueos').select('*').gte('fecha', hoy).order('fecha'),
    sb.from('turnos_extra').select('*').gte('fecha', hoy).order('fecha').order('inicio'),
  ]);
  $('#lista-bloqueos').innerHTML = (bl.data || []).length
    ? bl.data.map((b) => `<div class="item-simple"><span>⛔ ${esc(fmtDiaISO(b.fecha))}${b.motivo ? ' · ' + esc(b.motivo) : ''}</span><button type="button" class="btn btn-chico btn-borde" data-quitar-bloqueo="${b.fecha}">Quitar</button></div>`).join('')
    : '<p class="suave">No hay días bloqueados.</p>';
  $('#lista-extras').innerHTML = (ex.data || []).length
    ? ex.data.map((x) => `<div class="item-simple"><span>➕ ${esc(fmtDiaISO(x.fecha))} · ${x.inicio.slice(0, 5)}–${x.fin.slice(0, 5)}${x.costo_extra ? ' · costo adicional' : ''}</span><button type="button" class="btn btn-chico btn-borde" data-quitar-extra="${x.id}">Quitar</button></div>`).join('')
    : '<p class="suave">No hay horarios extra cargados.</p>';
}
async function guardarHorario() {
  const filas = $$('#horario-semanal .dia-fila').filter((f) => $('[data-abierto]', f).checked)
    .map((f) => ({ dia: Number(f.dataset.dia), abre: $('[data-abre]', f).value, cierra: $('[data-cierra]', f).value }));
  if (filas.some((x) => !x.abre || !x.cierra || x.abre >= x.cierra)) { toast('Revisá los horarios: la hora de cierre tiene que ser después de la de apertura.', true); return; }
  const { error } = await sb.rpc('admin_guardar_horario', { p_horario: filas });
  if (error) { toast(errorLegible(error), true); return; }
  toast('Horario guardado ✓');
  cargarHorarios();
}

// ------------------------------------------------------------------ fotos
const urlStorage = (nombre) => `${SUPABASE.url}/storage/v1/object/public/fotos/${nombre}`;
function urlMiniatura(f) {
  const ancho = f.anchos.find((a) => a >= 400) || f.anchos[f.anchos.length - 1];
  return f.origen === 'sitio' ? `../img/${f.ruta}-${ancho}.webp` : urlStorage(`${f.ruta}-${ancho}.${f.formato || 'webp'}`);
}
function opcionesDestino(actual) {
  const s = estado.servicios.map((x) => `<option value="s:${esc(x.id)}"${actual === 's:' + x.id ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('');
  const a = estado.albumes.map((x) => `<option value="a:${esc(x.id)}"${actual === 'a:' + x.id ? ' selected' : ''}>${esc(x.titulo)}</option>`).join('');
  return `<optgroup label="Galería (álbumes)">${a}</optgroup><optgroup label="Servicios">${s}</optgroup>`;
}
const campoDestino = (dest) => (dest.startsWith('s:') ? { servicio_id: dest.slice(2), album_id: null } : { servicio_id: null, album_id: dest.slice(2) });
let fotosActuales = [];
async function cargarFotos() {
  const sel = $('#f-destino');
  const actual = sel.value || 'a:' + (estado.albumes[0] && estado.albumes[0].id);
  sel.innerHTML = opcionesDestino(actual);
  const { servicio_id, album_id } = campoDestino(sel.value);
  let q = sb.from('fotos').select('*').order('orden').order('creado');
  q = servicio_id ? q.eq('servicio_id', servicio_id) : q.eq('album_id', album_id);
  const { data, error } = await q;
  if (error) { toast(errorLegible(error), true); return; }
  fotosActuales = data;
  $('#f-grilla').innerHTML = data.length ? data.map((f, i) => `<div class="foto-item" data-foto="${f.id}">
      <img src="${esc(urlMiniatura(f))}" alt="${esc(f.alt || 'Foto ' + (i + 1))}" loading="lazy" width="300" height="400">
      <span class="foto-num">Foto ${i + 1} de ${data.length}${f.origen === 'sitio' ? ' · original del sitio' : ''}</span>
      <div class="foto-acciones">
        <button type="button" class="btn btn-borde" data-mover="-1" ${i === 0 ? 'disabled' : ''} aria-label="Mover antes">◀ Antes</button>
        <button type="button" class="btn btn-borde" data-mover="1" ${i === data.length - 1 ? 'disabled' : ''} aria-label="Mover después">Después ▶</button>
        <button type="button" class="btn btn-borde btn-borrar" data-borrar>🗑 Eliminar</button>
      </div>
      <select data-cambiar-destino aria-label="Mover a otro servicio o álbum"><option value="">Mover a…</option>${opcionesDestino('')}</select>
    </div>`).join('') : '<p class="vacio">Todavía no hay fotos aquí. Tocá “Subir fotos”.</p>';
}

function canvasABlob(canvas, tipo, calidad) { return new Promise((ok) => canvas.toBlob(ok, tipo, calidad)); }
async function optimizar(archivo) {
  let bmp;
  try { bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' }); }
  catch { throw new Error('No se pudo leer esta foto. Probá con una foto JPG o PNG.'); }
  const objetivo = [480, 960, 1440];
  let anchos = objetivo.filter((w) => w <= bmp.width);
  if (!anchos.length) anchos = [bmp.width];
  const salidas = [];
  let formato = 'webp';
  for (const w of anchos) {
    const h = Math.round((bmp.height * w) / bmp.width);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, w, h);
    let blob = formato === 'webp' ? await canvasABlob(c, 'image/webp', 0.82) : null;
    if (!blob || blob.type !== 'image/webp') { formato = 'jpg'; blob = await canvasABlob(c, 'image/jpeg', 0.85); }
    salidas.push({ w, h, blob });
  }
  // Si el navegador no supo generar WebP en alguna medida, todo se guarda como JPG (mismo formato para todas).
  if (formato === 'jpg') {
    for (const s of salidas) if (s.blob.type !== 'image/jpeg') {
      const c = document.createElement('canvas'); c.width = s.w; c.height = s.h; c.getContext('2d').drawImage(bmp, 0, 0, s.w, s.h);
      s.blob = await canvasABlob(c, 'image/jpeg', 0.85);
    }
  }
  const mayor = salidas[salidas.length - 1];
  bmp.close?.();
  return { salidas, formato, ancho: mayor.w, alto: mayor.h };
}

async function subirFotos(archivos) {
  const destino = $('#f-destino').value;
  const nombreDestino = $('#f-destino').selectedOptions[0].textContent;
  const prog = $('#f-progreso');
  prog.innerHTML = '';
  let orden = fotosActuales.reduce((m, f) => Math.max(m, f.orden), 0);
  let ok = 0;
  for (const archivo of archivos) {
    const linea = document.createElement('div');
    linea.textContent = `⏳ ${archivo.name}: optimizando…`;
    prog.append(linea);
    try {
      const { salidas, formato, ancho, alto } = await optimizar(archivo);
      const id = crypto.randomUUID();
      linea.textContent = `⏳ ${archivo.name}: subiendo…`;
      for (const s of salidas) {
        const { error } = await sb.storage.from('fotos').upload(`${id}-${s.w}.${formato}`, s.blob, { contentType: formato === 'webp' ? 'image/webp' : 'image/jpeg', cacheControl: '31536000', upsert: false });
        if (error) throw error;
      }
      orden += 10;
      const { error } = await sb.from('fotos').insert({ ...campoDestino(destino), origen: 'storage', ruta: id, anchos: salidas.map((s) => s.w), formato, ancho, alto, alt: `${nombreDestino}: trabajo de Tania Sanabria`, orden });
      if (error) throw error;
      const kb = Math.round(salidas.reduce((t, s) => t + s.blob.size, 0) / 1024);
      linea.textContent = `✓ ${archivo.name} (${Math.round(archivo.size / 1024)} KB → ${kb} KB)`;
      linea.className = 'ok';
      ok++;
    } catch (err) {
      linea.textContent = `✕ ${archivo.name}: ${errorLegible(err)}`;
      linea.className = 'mal';
    }
  }
  if (ok) toast(ok === 1 ? 'Foto subida ✓' : `${ok} fotos subidas ✓`);
  $('#f-archivos').value = '';
  cargarFotos();
}

async function moverFoto(id, paso) {
  const i = fotosActuales.findIndex((f) => f.id === id);
  const j = i + paso;
  if (i < 0 || j < 0 || j >= fotosActuales.length) return;
  // Se renumera toda la lista para que el orden quede prolijo.
  const lista = fotosActuales.slice();
  [lista[i], lista[j]] = [lista[j], lista[i]];
  const cambios = lista.map((f, k) => ({ f, orden: (k + 1) * 10 })).filter(({ f, orden }) => f.orden !== orden);
  const res = await Promise.all(cambios.map(({ f, orden }) => sb.from('fotos').update({ orden }).eq('id', f.id)));
  const err = res.find((r) => r.error);
  if (err) toast(errorLegible(err.error), true);
  cargarFotos();
}

async function borrarFoto(id) {
  const f = fotosActuales.find((x) => x.id === id);
  if (!f || !confirm('¿Eliminar esta foto? Se deja de mostrar en el sitio.')) return;
  if (f.origen === 'storage') {
    // Solo se borran los archivos si ninguna otra entrada usa la misma foto.
    const { data: usos, error: e1 } = await sb.from('fotos').select('id').eq('ruta', f.ruta);
    if (e1) { toast(errorLegible(e1), true); return; }
    if (usos.length <= 1) {
      const { error } = await sb.storage.from('fotos').remove(f.anchos.map((w) => `${f.ruta}-${w}.${f.formato || 'webp'}`));
      if (error) { toast(errorLegible(error), true); return; }
    }
  }
  const { error } = await sb.from('fotos').delete().eq('id', id);
  if (error) { toast(errorLegible(error), true); return; }
  toast('Foto eliminada');
  cargarFotos();
}

async function cambiarDestinoFoto(id, destino) {
  if (!destino) return;
  const { error } = await sb.from('fotos').update({ ...campoDestino(destino), orden: 9999 }).eq('id', id);
  if (error) { toast(errorLegible(error), true); return; }
  toast('Foto movida ✓');
  cargarFotos();
}

// ------------------------------------------------------------------ servicios
function pintarServicios() {
  const abiertos = new Set($$('#lista-servicios details[open]').map((d) => d.dataset.servicio));
  $('#lista-servicios').innerHTML = Object.entries(CATEGORIAS).map(([cat, titulo]) => {
    const lista = estado.servicios.filter((s) => s.categoria === cat);
    return `<h3 class="categoria-titulo">${esc(titulo)}</h3>` + lista.map((s, i) => {
      const variantes = (s.extra && s.extra.variantes) || [];
      return `<details class="servicio${s.activo ? '' : ' inactivo'}" data-servicio="${esc(s.id)}"${abiertos.has(s.id) ? ' open' : ''}>
      <summary><span class="servicio-nombre">${esc(s.nombre)}<span class="servicio-precio">${esc(s.precio_texto)}${s.sena_gs ? ' · seña ' + gs(s.sena_gs) : ''}${s.activo ? '' : ' · OCULTO en el sitio'}</span></span></summary>
      <form data-form-servicio="${esc(s.id)}">
        <label>Nombre <input name="nombre" value="${esc(s.nombre)}" required maxlength="120"></label>
        <label>Precio que se muestra <input name="precio_texto" value="${esc(s.precio_texto)}" placeholder="Ej: Gs. 250.000"></label>
        <label>Seña en guaraníes (vacío = sin seña) <input name="sena_gs" inputmode="numeric" value="${s.sena_gs ?? ''}" placeholder="Ej: 100000"></label>
        <label>Duración que se muestra <input name="duracion_texto" value="${esc(s.duracion_texto || '')}" placeholder="Ej: 1 hora"></label>
        <label>Minutos que ocupa en la agenda <input name="duracion_min" type="number" min="10" max="720" step="5" value="${s.duracion_min}"></label>
        <label>Descripción corta <textarea name="descripcion" rows="3">${esc(s.descripcion)}</textarea></label>
        <label>Precio en el mensaje de reserva (opcional) <input name="precio_reserva_texto" value="${esc(s.precio_reserva_texto || '')}"></label>
        ${variantes.map((v, k) => `<div class="variante"><label>Opción: ${esc(v.etiqueta)} — precio <input name="var-precio-${k}" value="${esc(v.precio || '')}"></label>
          <label>Seña de esta opción (texto, ej. Gs. 100.000) <input name="var-sena-${k}" value="${esc(v.sena || '')}"></label></div>`).join('')}
        <label class="check"><input type="checkbox" name="usa_turno" ${s.usa_turno ? 'checked' : ''}> Se reserva con horario de la agenda</label>
        <label class="check"><input type="checkbox" name="activo" ${s.activo ? 'checked' : ''}> Mostrar en el sitio (activo)</label>
        <div class="acciones">
          <button type="button" class="btn btn-borde btn-chico" data-orden="-1" ${i === 0 ? 'disabled' : ''}>↑ Subir</button>
          <button type="button" class="btn btn-borde btn-chico" data-orden="1" ${i === lista.length - 1 ? 'disabled' : ''}>↓ Bajar</button>
          <button type="submit" class="btn btn-principal">Guardar</button>
        </div>
      </form></details>`;
    }).join('');
  }).join('');
}
async function guardarServicio(form) {
  const s = estado.servicios.find((x) => x.id === form.dataset.formServicio);
  const sena = form.sena_gs.value.replace(/\D/g, '');
  const cambios = {
    nombre: form.nombre.value.trim(), precio_texto: form.precio_texto.value.trim(), sena_gs: sena ? Number(sena) : null,
    duracion_texto: form.duracion_texto.value.trim() || null, duracion_min: Number(form.duracion_min.value) || 60,
    descripcion: form.descripcion.value.trim(), precio_reserva_texto: form.precio_reserva_texto.value.trim() || null,
    usa_turno: form.usa_turno.checked, activo: form.activo.checked,
  };
  const m = cambios.precio_texto.match(/\d{1,3}(?:\.\d{3})+|\d+/);
  cambios.precio_gs = m ? Number(m[0].replace(/\./g, '')) : null;
  if (s.extra && Array.isArray(s.extra.variantes)) {
    cambios.extra = { ...s.extra, variantes: s.extra.variantes.map((v, k) => ({ ...v, precio: form[`var-precio-${k}`].value.trim(), sena: form[`var-sena-${k}`].value.trim() })) };
  }
  if (!cambios.nombre) { toast('El nombre no puede quedar vacío.', true); return; }
  const { data, error } = await sb.from('servicios').update(cambios).eq('id', s.id).select().single();
  if (error) { toast(errorLegible(error), true); return; }
  Object.assign(s, data);
  toast('Servicio guardado ✓');
  pintarServicios();
}
async function ordenarServicio(id, paso) {
  const s = estado.servicios.find((x) => x.id === id);
  const lista = estado.servicios.filter((x) => x.categoria === s.categoria);
  const i = lista.indexOf(s); const j = i + paso;
  if (j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  const base = Math.min(...lista.map((x) => x.orden));
  const res = await Promise.all(lista.map((x, k) => ({ x, orden: base + k * 10 })).filter(({ x, orden }) => x.orden !== orden)
    .map(({ x, orden }) => sb.from('servicios').update({ orden }).eq('id', x.id).then((r) => { if (!r.error) x.orden = orden; return r; })));
  const err = res.find((r) => r.error);
  if (err) toast(errorLegible(err.error), true);
  estado.servicios.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  pintarServicios();
}

// ------------------------------------------------------------------ ajustes
function pintarAjustes() {
  const f = $('#form-ajustes');
  const a = estado.ajustes; const p = estado.privados;
  f.whatsapp.value = a.whatsapp; f.politica_sena.value = a.politica_sena; f.politica_horario.value = a.politica_horario;
  f.intervalo_min.value = String(a.intervalo_min); f.anticipacion_horas.value = a.anticipacion_horas; f.dias_reserva_max.value = a.dias_reserva_max;
  f.datos_pago.value = p.datos_pago; f.mensaje_aprobacion.value = p.mensaje_aprobacion; f.mensaje_rechazo.value = p.mensaje_rechazo;
  pintarAvisos();
}
async function guardarAjustes(e) {
  e.preventDefault();
  const f = e.target;
  const wa = f.whatsapp.value.replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(wa)) { toast('El número de WhatsApp debe tener solo números, con 595 adelante (ej: 595976122979).', true); return; }
  const [a, p] = await Promise.all([
    sb.from('ajustes').update({ whatsapp: wa, politica_sena: f.politica_sena.value.trim(), politica_horario: f.politica_horario.value.trim(),
      intervalo_min: Number(f.intervalo_min.value), anticipacion_horas: Number(f.anticipacion_horas.value), dias_reserva_max: Number(f.dias_reserva_max.value) }).eq('id', 1).select().single(),
    sb.from('ajustes_privados').update({ datos_pago: f.datos_pago.value.trim(), mensaje_aprobacion: f.mensaje_aprobacion.value, mensaje_rechazo: f.mensaje_rechazo.value }).eq('id', 1).select().single(),
  ]);
  if (a.error || p.error) { toast(errorLegible(a.error || p.error), true); return; }
  estado.ajustes = a.data; estado.privados = p.data;
  toast('Ajustes guardados ✓');
}
async function cambiarClave(e) {
  e.preventDefault();
  const v = $('#k-nueva').value;
  if (v.length < 8) { toast('La contraseña debe tener al menos 8 caracteres.', true); return; }
  const { error } = await sb.auth.updateUser({ password: v });
  if (error) { toast(errorLegible(error), true); return; }
  $('#k-nueva').value = '';
  toast('Contraseña cambiada ✓');
}

// ------------------------------------------------------------------ avisos (notificaciones del sistema + push)
const avisos = { reg: null, clavePush: undefined, sub: null };
const hayNotificaciones = () => 'Notification' in window && 'serviceWorker' in navigator;
const hayPush = () => hayNotificaciones() && 'PushManager' in window;
const esIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function registrarSW() {
  if (avisos.reg || !('serviceWorker' in navigator)) return avisos.reg;
  try {
    avisos.reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.tipo === 'reserva-nueva') cargarPendientes({ avisar: true });
      if (e.data?.tipo === 'ir-a-citas') elegirTab('citas');
    });
  } catch (err) { console.warn('Service worker no disponible:', err); }
  return avisos.reg;
}

// Clave pública VAPID que entrega la Edge Function "avisar-reserva" (null si todavía no está instalada).
async function clavePushServidor() {
  if (avisos.clavePush !== undefined) return avisos.clavePush;
  try {
    const r = await fetch(`${SUPABASE.url}/functions/v1/avisar-reserva`, { headers: { apikey: SUPABASE.anonKey, Authorization: `Bearer ${SUPABASE.anonKey}` } });
    avisos.clavePush = r.ok ? ((await r.json()).vapidPublicKey || null) : null;
  } catch { avisos.clavePush = null; }
  return avisos.clavePush;
}
function bytesDeB64u(t) {
  const b = atob(t.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
async function guardarSuscripcion(sub) {
  const j = sub.toJSON();
  const { error } = await sb.from('push_suscripciones').upsert({
    endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, dispositivo: navigator.userAgent.slice(0, 300),
  });
  if (error) { console.warn('No se pudo guardar la suscripción push:', error); return false; }
  return true;
}
// Suscribe (o renueva) este dispositivo a los avisos push. Solo si ya hay permiso.
async function asegurarPush() {
  avisos.sub = null;
  if (!hayPush() || Notification.permission !== 'granted' || !avisos.reg) return false;
  const clave = await clavePushServidor();
  if (!clave) return false;
  try {
    await navigator.serviceWorker.ready;
    let sub = await avisos.reg.pushManager.getSubscription();
    const misma = sub && sub.options?.applicationServerKey
      && new Uint8Array(sub.options.applicationServerKey).join() === bytesDeB64u(clave).join();
    if (sub && !misma) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await avisos.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDeB64u(clave) });
    if (await guardarSuscripcion(sub)) avisos.sub = sub;
  } catch (err) { console.warn('No se pudo activar el push:', err); }
  return !!avisos.sub;
}
async function quitarPush() {
  try {
    const sub = avisos.reg && await avisos.reg.pushManager?.getSubscription();
    if (sub) { await sb.from('push_suscripciones').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch { /* nada */ }
  avisos.sub = null;
}

async function activarAvisos() {
  prepararAudio();
  if (!hayNotificaciones()) { toast('Este navegador no permite notificaciones. Probá con Chrome.', true); pintarAvisos(); return; }
  if (esIOS() && !instalada()) { toast('En iPhone primero agregá el panel a la pantalla de inicio (Compartir → Agregar a inicio) y abrilo desde ahí.', true); pintarAvisos(); return; }
  let permiso = Notification.permission;
  if (permiso === 'default') permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    toast('Las notificaciones están bloqueadas. Habilitalas en los ajustes del navegador para este sitio.', true);
    pintarAvisos(); return;
  }
  const push = await asegurarPush();
  toast(push ? 'Avisos activados ✓ Te van a llegar aunque el panel esté cerrado.' : 'Avisos activados ✓ (con el panel abierto)');
  pintarAvisos();
}

async function mostrarNotificacion(titulo, cuerpo, tag) {
  if (!hayNotificaciones() || Notification.permission !== 'granted') return false;
  const op = { body: cuerpo, tag, renotify: true, icon: '../img/icono-192.png', badge: '../img/favicon-32.png', vibrate: [200, 100, 200], data: { url: location.href.split('#')[0] + '#citas' } };
  try {
    const reg = avisos.reg || await navigator.serviceWorker.getRegistration();
    if (reg) { await reg.showNotification(titulo, op); return true; }
    new Notification(titulo, op); return true;
  } catch (err) { console.warn('No se pudo mostrar la notificación:', err); return false; }
}
// Aviso del sistema para solicitudes nuevas detectadas con el panel abierto (o en segundo plano).
function notificarNuevas(nuevas) {
  if (!document.hidden && document.hasFocus()) return; // en pantalla ya hay sonido + mensaje + insignia
  if (avisos.sub) return; // el push del servidor ya la muestra (evita duplicados)
  for (const r of nuevas.slice(0, 3)) {
    mostrarNotificacion(`Nueva solicitud: ${r.servicio_nombre}`, `${r.cliente_nombre} · ${textoCuando(r)}${r.costo_extra ? ' · costo adicional' : ''}\nTocá para aprobar o rechazar.`, `reserva-${r.id}`);
  }
  if (nuevas.length > 3) mostrarNotificacion(`${nuevas.length} solicitudes nuevas`, 'Tocá para verlas en el panel.', 'reservas-varias');
}
function ponerInsigniaApp(n) {
  try { if (n && navigator.setAppBadge) navigator.setAppBadge(n); else if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch { /* sin insignia */ }
}

async function pintarAvisos() {
  const lista = $('#avisos-estado'); const ayuda = $('#avisos-ayuda');
  const permiso = hayNotificaciones() ? Notification.permission : 'no';
  const clave = await clavePushServidor();
  const items = [];
  if (permiso === 'no') items.push(['no', 'Este navegador no permite notificaciones. Usá Chrome (Android) o Safari con el panel en la pantalla de inicio (iPhone).']);
  else if (permiso === 'granted') items.push(['si', 'Notificaciones permitidas en este celular.']);
  else if (permiso === 'denied') items.push(['no', 'Notificaciones bloqueadas. Tocá el candado 🔒 junto a la dirección → Permisos → Notificaciones → Permitir.']);
  else items.push(['no', 'Todavía no activaste los avisos en este celular.']);
  if (permiso === 'granted') {
    if (avisos.sub) items.push(['si', 'Avisos con el panel cerrado: activos.']);
    else if (!clave) items.push(['info', 'Por ahora el aviso llega con el panel abierto o en segundo plano. El aviso con el panel cerrado se activa cuando se termine de instalar en el servidor.']);
    else items.push(['no', 'Avisos con el panel cerrado: no se pudieron activar. Tocá “Activar avisos”.']);
  }
  if (esIOS() && !instalada()) items.push(['info', 'En iPhone, agregá el panel a la pantalla de inicio (Compartir → Agregar a inicio) y abrilo desde ese ícono.']);
  else if (!instalada()) items.push(['info', 'Consejo: agregá el panel a la pantalla de inicio (menú ⋮ → Agregar a la pantalla principal).']);
  lista.innerHTML = items.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join('');
  ayuda.textContent = 'Si el celular está en silencio o en “No molestar”, la notificación llega igual pero sin sonido.';
  const listo = permiso === 'granted' && (avisos.sub || !clave);
  $$('[data-activar-avisos]').forEach((b) => { b.textContent = listo ? (b.closest('#tarjeta-avisos') ? 'Volver a activar' : 'Activar avisos') : (b.closest('#tarjeta-avisos') ? 'Activar avisos en este celular' : 'Activar avisos'); });
  $('#aviso-activar').hidden = listo || permiso === 'no';
}

// ------------------------------------------------------------------ tiempo real
function suscribirse() {
  if (estado.canal) return;
  const marca = $('#estado-conexion');
  estado.canal = sb.channel('panel-reservas')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reservas' }, () => {
      cargarPendientes({ avisar: true });
      if (!$('#tab-citas').hidden) cargarAgenda();
    })
    .subscribe((st) => {
      const vivo = st === 'SUBSCRIBED';
      marca.textContent = vivo ? 'Avisos en vivo' : 'Actualiza cada minuto';
      marca.classList.toggle('en-vivo', vivo);
    });
  // Respaldo por si el tiempo real se corta (o el celular estuvo dormido).
  estado.sondeo = setInterval(() => cargarPendientes(), 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cargarPendientes(); });
}

// ------------------------------------------------------------------ eventos
function prepararEventos() {
  $('#form-login').addEventListener('submit', iniciarSesion);
  $('#l-ver').addEventListener('click', (e) => {
    const c = $('#l-clave'); const ver = c.type === 'password';
    c.type = ver ? 'text' : 'password'; e.currentTarget.setAttribute('aria-pressed', String(ver));
    e.currentTarget.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });
  $('#l-olvide').addEventListener('click', async () => {
    const email = $('#l-email').value.trim();
    if (!email) { $('#login-error').textContent = 'Escribí tu email arriba y volvé a tocar “Olvidé mi contraseña”.'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) { $('#login-error').textContent = errorLegible(error); return; }
    toast('Te enviamos un email para crear una contraseña nueva.');
  });
  $('#form-clave').addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = $('#c-nueva').value; const b = $('#c-repetir').value;
    if (a.length < 8) { $('#clave-error').textContent = 'Mínimo 8 caracteres.'; return; }
    if (a !== b) { $('#clave-error').textContent = 'Las contraseñas no coinciden.'; return; }
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { $('#clave-error').textContent = errorLegible(error); return; }
    toast('Contraseña guardada ✓');
    history.replaceState(null, '', location.pathname);
    entrarAlPanel();
  });
  $('#btn-salir').addEventListener('click', async () => {
    if (estado.canal) { await sb.removeChannel(estado.canal); estado.canal = null; }
    clearInterval(estado.sondeo);
    await quitarPush();
    ponerInsigniaApp(0);
    await sb.auth.signOut();
    estado.pendientesVistos = null;
    mostrarVista('login');
  });
  $$('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => elegirTab(b.dataset.tab)));
  // Citas
  $('#tab-citas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-accion]');
    if (b) { accionCita(b.dataset.accion, b.dataset.id, b); return; }
    const v = e.target.closest('[data-vista]');
    if (v) { estado.vista = v.dataset.vista; $$('[data-vista]').forEach((x) => x.setAttribute('aria-pressed', String(x === v))); cargarAgenda(); }
  });
  $('#ag-prev').addEventListener('click', () => { estado.fechaAgenda = sumarDias(estado.fechaAgenda, estado.vista === 'semana' ? -7 : -1); cargarAgenda(); });
  $('#ag-sig').addEventListener('click', () => { estado.fechaAgenda = sumarDias(estado.fechaAgenda, estado.vista === 'semana' ? 7 : 1); cargarAgenda(); });
  $('#ag-hoy').addEventListener('click', () => { estado.fechaAgenda = hoyISO(); cargarAgenda(); });
  $('#btn-nueva-cita').addEventListener('click', abrirNuevaCita);
  $('#form-cita').addEventListener('submit', guardarNuevaCita);
  $('#dlg-cita').addEventListener('click', (e) => { if (e.target.closest('[data-cerrar]') || e.target === e.currentTarget) $('#dlg-cita').close(); });
  // Horarios
  $('#btn-guardar-horario').addEventListener('click', guardarHorario);
  $('#horario-semanal').addEventListener('change', (e) => { const f = e.target.closest('.dia-fila'); if (f) f.classList.toggle('cerrado', !$('[data-abierto]', f).checked); });
  $('#form-bloqueo').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    if (!f.fecha.value) return;
    const { error } = await sb.from('bloqueos').upsert({ fecha: f.fecha.value, motivo: f.motivo.value.trim() });
    if (error) { toast(errorLegible(error), true); return; }
    f.reset(); toast('Día bloqueado ✓'); cargarHorarios();
  });
  $('#form-extra').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    if (!f.fecha.value || !f.inicio.value || !f.fin.value || f.inicio.value >= f.fin.value) { toast('Completá fecha y un horario válido (desde < hasta).', true); return; }
    const { error } = await sb.from('turnos_extra').insert({ fecha: f.fecha.value, inicio: f.inicio.value, fin: f.fin.value, costo_extra: f.costo_extra.checked });
    if (error) { toast(errorLegible(error), true); return; }
    f.reset(); f.costo_extra.checked = true; toast('Horario extra agregado ✓'); cargarHorarios();
  });
  $('#tab-horarios').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-quitar-bloqueo]');
    const x = e.target.closest('[data-quitar-extra]');
    if (!b && !x) return;
    const { error } = b ? await sb.from('bloqueos').delete().eq('fecha', b.dataset.quitarBloqueo) : await sb.from('turnos_extra').delete().eq('id', x.dataset.quitarExtra);
    if (error) { toast(errorLegible(error), true); return; }
    toast('Quitado ✓'); cargarHorarios();
  });
  // Fotos
  $('#f-destino').addEventListener('change', cargarFotos);
  $('#f-archivos').addEventListener('change', (e) => { const a = Array.from(e.target.files || []); if (a.length) subirFotos(a); });
  $('#f-grilla').addEventListener('click', (e) => {
    const item = e.target.closest('[data-foto]'); if (!item) return;
    const m = e.target.closest('[data-mover]'); if (m) { moverFoto(item.dataset.foto, Number(m.dataset.mover)); return; }
    if (e.target.closest('[data-borrar]')) borrarFoto(item.dataset.foto);
  });
  $('#f-grilla').addEventListener('change', (e) => {
    const s = e.target.closest('[data-cambiar-destino]'); if (s) cambiarDestinoFoto(e.target.closest('[data-foto]').dataset.foto, s.value);
  });
  // Servicios
  $('#lista-servicios').addEventListener('submit', (e) => { e.preventDefault(); guardarServicio(e.target); });
  $('#lista-servicios').addEventListener('click', (e) => { const b = e.target.closest('[data-orden]'); if (b) ordenarServicio(b.closest('details').dataset.servicio, Number(b.dataset.orden)); });
  // Avisos
  $$('[data-activar-avisos]').forEach((b) => b.addEventListener('click', activarAvisos));
  $('#btn-probar-aviso').addEventListener('click', async () => {
    prepararAudio(); sonar();
    if (window.Notification?.permission !== 'granted') { toast('Primero tocá “Activar avisos”.', true); return; }
    const ok = await mostrarNotificacion('Prueba de aviso ✓', 'Así te va a llegar cada solicitud nueva.', 'prueba');
    toast(ok ? 'Listo: revisá la notificación arriba en la pantalla.' : 'No se pudo mostrar la notificación.', !ok);
  });
  // Ajustes
  $('#form-ajustes').addEventListener('submit', guardarAjustes);
  $('#form-cambiar-clave').addEventListener('submit', cambiarClave);
}

async function arrancar() {
  prepararEventos();
  let recuperando = /type=recovery/.test(location.hash);
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') { recuperando = true; mostrarVista('clave'); }
  });
  const { data: { session } } = await sb.auth.getSession();
  if (recuperando) { mostrarVista('clave'); return; }
  if (session) await entrarAlPanel(); else mostrarVista('login');
}

arrancar().catch((err) => {
  console.warn('No se pudo iniciar el panel:', err);
  mostrarVista('login');
  $('#login-error').textContent = 'No se pudo conectar. Revisá internet y recargá la página.';
});
