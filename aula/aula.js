/*
 * Aula Virtual · Tania Sanabria Makeup Academy (PWA: celular y computadora)
 * Alumnas: registro con email, sala de clases, materiales (PDF/fotos/videos), entregas SOLO con cámara,
 *          notas y comentarios de la profesora, catálogo de cursos con precios.
 * Tania (admin): corregir entregas (nota 1–5 + comentario), cargar materiales por curso y módulo, alumnas y accesos.
 * Seguridad: todo pasa por RLS de Supabase (supabase/aula.sql + cursos.sql).
 */
import { SUPABASE } from '../js/config.js';
import { tomarFotos, grabarVideo, huellaDispositivo } from './camara.js';

// Vista previa local (solo en localhost apunta a la base de pruebas; en producción usa la real)
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get('base') !== 'real';
const CFG = LOCAL ? { url: `${location.protocol}//${location.hostname}:54321`, anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvY2FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjEwNzgyNTM1OH0.HWC5pvLe-zSXO_aly5bXUlczRRvITVmeSHg3ViR0KCk' } : SUPABASE;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let sb;
const E = { user: null, perfil: null, admin: false, servicios: [], misCursos: [], inscripciones: [], entregas: [], urls: new Map(),
  v2: false, v3: false, config: [], avance: [], examenes: [], pagos: [], whatsapp: '595976122979' };
// v2 = la base ya tiene supabase/migracion-aula-2026-11-02.sql (meses por pago, niveles, pagos, exámenes). Sin ella el aula funciona como antes.

// ---------- Íconos (trazo fino, estilo del sitio) ----------
const I = {
  casa: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  libro: '<path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/><path d="M9 7h7"/>',
  estrella: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  camara: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  foto: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  enlace: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  check: '<path d="M5 12l5 5 9-10"/>', lista: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  subir: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>', alumnas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5c2.6 0 4.6 1.4 5.5 4.5"/>',
  ojo: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
const ic = (n, c = 'ic') => `<svg class="${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

// Fotos de Tania del sitio como portada de cada curso
const PORTADAS = { 'curso-automaquillaje': 'social-2', 'curso-maquillador-inicial': 'social-1', 'curso-maquillador-avanzado': 'social-alta-1',
  'curso-maquillaje-artistico': 'social-4', 'curso-fotografia-beauty': 'social-alta-3' };
const portada = (id, w = 960) => `../img/${PORTADAS[id] || 'maquillaje-social'}-${w}.webp`;
const NOTA_TXT = { 1: 'Insuficiente', 2: 'Regular', 3: 'Bueno', 4: 'Muy bueno', 5: 'Excelente' };
const estrellas = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const fecha = (t) => new Date(t).toLocaleDateString('es-PY', { day: 'numeric', month: 'short', year: 'numeric' });
const fechaHora = (t) => new Date(t).toLocaleString('es-PY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

let tToast;
function toast(t, mal = false) { const el = $('#toast'); el.textContent = t; el.classList.toggle('mal', mal); el.classList.add('visible'); clearTimeout(tToast); tToast = setTimeout(() => el.classList.remove('visible'), mal ? 5000 : 2800); }
function errorTxt(e) {
  const m = `${e?.code || ''} ${e?.message || e || ''}`;
  const T = { COMPLETA_TU_PERFIL: 'Completá tu nombre y celular en tu perfil para inscribirte.', YA_INSCRIPTA: 'Ya te inscribiste a este curso.', DEMASIADAS_SOLICITUDES: 'Ya hay solicitudes pendientes. Esperá la confirmación de Tania.',
    SIN_ACCESO_AL_CURSO: 'Todavía no tenés acceso a este curso.', FOTO_INVALIDA: 'La foto no es válida. Volvé a sacarla.', DEMASIADAS_ENTREGAS: 'Llegaste al máximo de entregas por hoy.',
    NO_AUTORIZADO: 'No tenés permiso para esto.', MES_BLOQUEADO: 'Ese mes todavía no está habilitado. Primero la profe tiene que confirmar tu pago.',
    PAGO_YA_ENVIADO: 'Ya enviaste un comprobante. Esperá que la profe lo confirme.', COMPROBANTE_INVALIDO: 'No se pudo registrar el comprobante. Volvé a subirlo.',
    FALTAN_CLASES_APROBADAS: 'Primero tienen que estar aprobadas todas las clases del mes.', FALTA_CUESTIONARIO: 'Primero respondé el cuestionario de la clase.',
    SIN_INTENTOS: 'Ya usaste todos los intentos de examen de este mes. Hablá con la profe.', EXAMEN_YA_APROBADO: 'Ya aprobaste el examen de este mes.',
    CODIGO_VENCIDO: 'El código venció o todavía no empezó la videollamada. Pedile a la profe un código nuevo.', CODIGO_BLOQUEADO: 'Demasiados intentos con código incorrecto. Pedile a la profe uno nuevo.',
    CODIGO_INVALIDO: 'Código incorrecto.', FALTAN_FOTOS: 'Faltan fotos: se necesitan las tres.', FALTA_VIDEO: 'Falta el video de la técnica.', RUBRICA_INVALIDA: 'La rúbrica va de 1 a 5.',
    'row-level security': 'No se pudo subir: el código del examen venció. Pedile a la profe uno nuevo.',
    EXAMEN_YA_PEDIDO: 'Ya pediste tu examen. La profe te va a escribir para agendar la videollamada.', REENTREGA_INVALIDA: 'Solo podés volver a presentar trabajos anulados o para rehacer.', 'Invalid login': 'Email o contraseña incorrectos.', 'already registered': 'Ese email ya tiene cuenta. Tocá "Entrar".',
    'Email not confirmed': 'Confirmá tu email: te enviamos un enlace a tu correo.', 'Password should': 'La contraseña debe tener al menos 6 caracteres.', fetch: 'Sin conexión. Revisá internet e intentá de nuevo.' };
  for (const k in T) if (m.includes(k)) return T[k];
  return e?.message || 'Ocurrió un error. Intentá de nuevo.';
}
const AVISO_IA = `<div class="aviso-ia" role="note"><strong>⚠️ Importante: no uses inteligencia artificial</strong>
  <p>Si se detecta que usaste IA (ChatGPT, generadores o editores de imágenes, filtros, etc.) en tus respuestas o en tus fotos, <b>la clase queda anulada</b>.
  Tenés derecho a <b>volver a presentarla</b>, hecha por vos y con fotos tomadas en el momento con la cámara del aula.</p></div>`;
const waUrl = (texto) => `https://wa.me/${E.whatsapp}?text=${encodeURIComponent(texto)}`;
const gs = (n) => 'Gs. ' + Number(n || 0).toLocaleString('es-PY');
const avanceDe = (id) => E.avance.filter((a) => a.servicio_id === id).sort((a, b) => b.meses_habilitados - a.meses_habilitados)[0];
const nombreCorto = () => (E.perfil?.nombre || E.user?.email || '').split(/[\s@]/)[0];

// ---------- Datos ----------
async function cargarServicios() {
  const { data, error } = await sb.from('servicios').select('id,nombre,descripcion,precio_texto,sena_gs,extra,orden').eq('categoria', 'academia').eq('activo', true).order('orden');
  if (error) throw error; E.servicios = data || [];
}
const servicio = (id) => E.servicios.find((s) => s.id === id);
async function cargarAlumna() {
  const [c, i, e, av] = await Promise.all([sb.rpc('mis_cursos'), sb.rpc('aula_mis_inscripciones'), sb.from('entregas').select('*').order('creado', { ascending: false }), sb.rpc('aula_mi_avance')]);
  E.misCursos = c.data || []; E.inscripciones = i.data || []; E.entregas = e.data || [];
  E.v2 = !av.error; E.avance = av.data || []; if (E.v2) await cargarConfig();
  if (E.v2) {
    const [x, p] = await Promise.all([sb.from('aula_examenes').select('*').order('creado', { ascending: false }), sb.from('aula_pagos').select('*').order('creado', { ascending: false })]);
    E.examenes = x.data || []; E.pagos = p.data || [];
  }
}
async function cargarWhatsapp() { const { data } = await sb.from('ajustes').select('whatsapp').limit(1).maybeSingle(); if (data?.whatsapp) E.whatsapp = data.whatsapp; }
// Tiempo real: cuando la profe confirma un pago, corrige o agenda el examen, el aula se actualiza sola.
let canalAula = null;
function escucharCambios() {
  if (canalAula || !E.v2) return;
  let t = null; const refrescar = () => { clearTimeout(t); t = setTimeout(async () => {
    if (E.admin) { await contarPendientes(); navegacion(); marcarNav(); if (/^#\/admin(\/(pagos|examenes|seguimiento))?$/.test(location.hash || '#/admin')) router(); return; }
    // No repintar si la alumna está a mitad de una entrega o de un pago
    await cargarAlumna(); if (!/^#\/(entregar|pagar)/.test(location.hash)) router(); }, 400); };
  canalAula = sb.channel('aula-alumna')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'aula_pagos' }, refrescar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'aula_examenes' }, refrescar)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entregas' }, refrescar)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inscripciones' }, refrescar).subscribe();
}
async function urlFirmada(bucket, ruta) {
  const k = bucket + '/' + ruta; if (E.urls.has(k)) return E.urls.get(k);
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(ruta, 3600); if (error) return null;
  const u = data.signedUrl.startsWith('http') ? data.signedUrl : CFG.url + '/storage/v1' + data.signedUrl;
  E.urls.set(k, u); return u;
}
async function hidratarFotos(raiz = document) {
  for (const img of $$('img[data-bucket]', raiz)) { const u = await urlFirmada(img.dataset.bucket, img.dataset.ruta); if (u) img.src = u; }
}

// ---------- Marco: navegación ----------
function navegacion() {
  const al = [['#/', 'casa', 'Mi sala'], ['#/cursos', 'libro', 'Cursos'], ['#/notas', 'estrella', 'Mis notas'], ['#/perfil', 'usuario', 'Perfil']];
  const pend = E.adminPend || 0;
  const ad = [['#/admin', 'check', 'Corregir', pend], ['#/admin/materiales', 'subir', 'Materiales'], ['#/admin/alumnas', 'alumnas', 'Alumnas'],
    ...(E.v3 ? [['#/admin/examenes', 'video', 'Exámenes', E.adminExam || 0], ['#/admin/pagos', 'lista', 'Pagos', E.adminPagos || 0], ['#/admin/seguimiento', 'estrella', 'Seguimiento']]
      : E.v2 ? [['#/admin/pagos', 'lista', 'Pagos y exámenes', E.adminPagos || 0]] : []), ['#/perfil', 'usuario', 'Perfil']];
  const items = E.admin ? ad : al;
  const html = items.map(([h, i, t, n]) => `<a href="${h}" data-ruta="${h}">${ic(i)}<span>${t}</span>${n ? `<span class="globo">${n}</span>` : ''}</a>`).join('');
  $('#nav-escritorio').innerHTML = html; $('#nav-movil').innerHTML = html; $('#nav-movil').hidden = false;
  $('#btn-perfil').hidden = false; $('#btn-perfil').textContent = (nombreCorto()[0] || '?').toUpperCase();
  $('#marca-sub').textContent = E.admin ? 'Panel de la profesora' : 'Aula Virtual';
}
function marcarNav() {
  const h = location.hash || '#/';
  for (const a of $$('[data-ruta]')) {
    const r = a.dataset.ruta; const act = r === h || (r !== '#/' && r !== '#/admin' && h.startsWith(r)) || (r === '#/' && h.startsWith('#/curso/')) || (r === '#/admin' && h === '#/admin');
    if (act) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}
const app = () => $('#app');
function pintar(html) { app().innerHTML = html; window.scrollTo(0, 0); }

// ---------- Ingreso / registro ----------
function vistaIngreso(modo = 'entrar') {
  $('#nav-movil').hidden = true; $('#nav-escritorio').innerHTML = ''; $('#btn-perfil').hidden = true;
  pintar(`<section class="ingreso">
    <div class="ingreso-foto"><div class="arco"></div><img src="../img/retrato-540.webp" width="540" height="768" alt="Tania Sanabria, maquilladora profesional"></div>
    <div>
      <h1>Tu <span class="acento">sala de clases</span></h1>
      <p class="bajada">Materiales, trabajos prácticos, notas y comentarios de la profesora Tania Sanabria, en tu celular o computadora.</p>
      <div class="tarjeta">
        <div class="pestanas" role="tablist"><button role="tab" data-modo="entrar" aria-selected="${modo === 'entrar'}">Entrar</button><button role="tab" data-modo="registro" aria-selected="${modo === 'registro'}">Crear cuenta</button></div>
        <form id="f-acceso" novalidate>
          ${modo === 'registro' ? `<label for="a-nombre">Nombre y apellido</label><input id="a-nombre" name="nombre" autocomplete="name" required maxlength="120">
          <label for="a-tel">Celular (WhatsApp)</label><input id="a-tel" name="telefono" type="tel" inputmode="tel" autocomplete="tel" placeholder="09xx xxx xxx" required maxlength="30">` : ''}
          <label for="a-email">Email</label><input id="a-email" name="email" type="email" inputmode="email" autocomplete="username" required maxlength="160">
          <label for="a-clave">Contraseña</label><div class="ver-clave"><input id="a-clave" name="clave" type="password" autocomplete="${modo === 'registro' ? 'new-password' : 'current-password'}" required minlength="6"><button type="button" id="ver-clave">Ver</button></div>
          ${modo === 'registro' ? '<p class="ayuda">Mínimo 6 caracteres.</p>' : '<p class="ayuda">¿Te inscribiste antes y tenés un código de Tania? Usalo como contraseña.</p>'}
          <p class="error" id="a-error" role="alert"></p>
          <button class="btn btn-oro btn-ancho" id="a-btn">${modo === 'registro' ? 'Crear mi cuenta' : 'Entrar a mi aula'}</button>
        </form>
        ${modo === 'entrar' ? '<p class="chico" style="text-align:center;margin:.8rem 0 0"><a href="#" id="olvide">Olvidé mi contraseña</a></p>' : ''}
      </div>
      <div class="sellos"><span>✦ Clases y materiales</span><span>✦ Entregas con cámara</span><span>✦ Notas y devoluciones</span></div>
      <p class="chico suave" style="text-align:center"><a href="../">← Volver al sitio de Tania</a></p>
    </div></section>`);
  for (const b of $$('[data-modo]')) b.onclick = () => vistaIngreso(b.dataset.modo);
  $('#ver-clave').onclick = (e) => { const i = $('#a-clave'); i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? 'Ver' : 'Ocultar'; };
  $('#olvide')?.addEventListener('click', async (e) => {
    e.preventDefault(); const email = $('#a-email').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('#a-error').textContent = 'Escribí tu email arriba y volvé a tocar "Olvidé mi contraseña".'; return; }
    await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    toast('Te enviamos un correo para crear una contraseña nueva.');
  });
  $('#f-acceso').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, err = $('#a-error'); err.textContent = '';
    const email = f.email.value.trim().toLowerCase(), clave = f.clave.value;
    if (modo === 'registro' && f.nombre.value.trim().length < 3) { err.textContent = 'Escribí tu nombre y apellido.'; return f.nombre.focus(); }
    if (modo === 'registro' && f.telefono.value.replace(/\D/g, '').length < 8) { err.textContent = 'Escribí tu número de celular.'; return f.telefono.focus(); }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Escribí un email válido.'; return f.email.focus(); }
    if (clave.length < 6) { err.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return f.clave.focus(); }
    const btn = $('#a-btn'); btn.disabled = true; btn.textContent = modo === 'registro' ? 'Creando tu cuenta…' : 'Entrando…';
    try {
      if (modo === 'registro') {
        const datos = { nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim() };
        localStorage.setItem('aula-perfil-pendiente', JSON.stringify({ email, ...datos }));
        const { data, error } = await sb.auth.signUp({ email, password: clave, options: { data: datos, emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) { pintar(`<div class="tarjeta" style="max-width:520px;margin:3rem auto;text-align:center"><span style="font-size:2.5rem">📩</span><h1>Revisá tu correo</h1><p>Te enviamos un enlace a <strong>${esc(email)}</strong> para confirmar tu cuenta. Después volvé y entrá con tu email y contraseña.</p><a class="btn btn-principal" href="#/">Ir a entrar</a></div>`); return; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: clave }); if (error) throw error;
      }
      await iniciarSesion();
    } catch (x) { err.textContent = errorTxt(x); btn.disabled = false; btn.textContent = modo === 'registro' ? 'Crear mi cuenta' : 'Entrar a mi aula'; }
  };
}

async function asegurarPerfil() {
  const { data } = await sb.from('perfiles').select('*').eq('user_id', E.user.id).maybeSingle();
  E.perfil = data;
  if (!data) {
    const md = E.user.user_metadata || {}; let p = {}; try { p = JSON.parse(localStorage.getItem('aula-perfil-pendiente') || '{}'); } catch {}
    const nombre = (md.nombre || (p.email === E.user.email ? p.nombre : '') || '').trim(), telefono = (md.telefono || p.telefono || '').trim();
    if (nombre.length >= 2) {
      const r = await sb.from('perfiles').insert({ user_id: E.user.id, email: E.user.email.toLowerCase(), nombre, telefono }).select().single();
      if (!r.error) { E.perfil = r.data; localStorage.removeItem('aula-perfil-pendiente'); }
    }
  }
}

async function iniciarSesion() {
  const { data } = await sb.auth.getUser(); E.user = data.user;
  if (!E.user) return vistaIngreso();
  const a = await sb.rpc('es_admin'); E.admin = a.data === true;
  await Promise.all([cargarServicios(), cargarWhatsapp()]);
  if (E.admin) { await contarPendientes(); }
  else { await asegurarPerfil(); await cargarAlumna(); }
  escucharCambios();
  navegacion();
  if (!E.admin && !E.perfil) location.hash = '#/perfil';
  else if (E.admin && !location.hash.startsWith('#/admin') && location.hash !== '#/perfil') location.hash = '#/admin';
  router();
}
async function contarPendientes() {
  const [r, p] = await Promise.all([sb.rpc('admin_entregas', { p_curso: null, p_estado: 'enviada' }), sb.rpc('admin_pagos_aula', { p_estado: 'pendiente' })]);
  E.adminPend = (r.data || []).length; E.v2 = !p.error; E.adminPagos = (p.data || []).length;
  if (E.v2) { await cargarConfig(); if (E.v3) { const x = await sb.rpc('admin_examenes_aula2'); E.adminExam = (x.data || []).filter((e) => ['entregado', 'solicitado'].includes(e.estado)).length; } }
}

// ---------- Alumna: Mi sala ----------
function tarjetaMiCurso(c) {
  const s = servicio(c.servicio_id) || {}; const ent = E.entregas.filter((e) => e.servicio_id === c.servicio_id);
  const notas = ent.filter((e) => e.calificacion); const prom = notas.length ? (notas.reduce((a, e) => a + e.calificacion, 0) / notas.length).toFixed(1) : null;
  return `<a class="curso" href="#/curso/${esc(c.servicio_id)}"><div class="curso-foto" style="background-image:url('${portada(c.servicio_id)}')"><span class="etiqueta">${c.clases} clases</span></div>
    <div class="curso-cuerpo"><h3>${esc(s.nombre || c.nombre)}</h3><p class="suave chico" style="margin:0">${esc(s.extra?.subtitulo || '')}</p>
    <div class="fila entre chico"><span>${ent.length} trabajo${ent.length === 1 ? '' : 's'} entregado${ent.length === 1 ? '' : 's'}</span>${prom ? `<span class="etiqueta">Promedio ${prom}</span>` : ''}</div>
    <div class="acciones"><span class="btn btn-principal btn-chico">Entrar al curso →</span></div></div></a>`;
}
function vistaSala() {
  const pend = E.inscripciones.filter((i) => !i.acceso);
  const corregidas = E.entregas.filter((e) => e.estado !== 'enviada');
  const notas = E.entregas.filter((e) => e.calificacion);
  const prom = notas.length ? (notas.reduce((a, e) => a + e.calificacion, 0) / notas.length).toFixed(1) : '–';
  pintar(`<section class="portada"><div><span class="eyebrow">Academia Tania Sanabria</span><h1>¡Hola, ${esc(nombreCorto())}!</h1><p>Bienvenida a tu sala de clases. Acá tenés tus cursos, materiales y las devoluciones de la profe.</p></div>
      <img src="../img/retrato-280.webp" width="280" height="398" alt=""></section>
    <div class="estadisticas"><div class="dato"><strong>${E.misCursos.length}</strong><span>Cursos</span></div><div class="dato"><strong>${E.entregas.length}</strong><span>Trabajos</span></div><div class="dato"><strong>${prom}</strong><span>Promedio</span></div></div>
    ${pend.length ? `<div class="tarjeta" style="border-color:#f0d896;background:#fffaf0">${pend.map((i) => `<p style="margin:.2rem 0"><span class="etiqueta ambar">En revisión</span> <strong>${esc(i.curso_nombre)}</strong> · Ref. ${esc(i.referencia)}</p>`).join('')}
      <p class="chico suave" style="margin:.5rem 0 0">Tania habilita tu acceso cuando confirma tu inscripción (matrícula). Te va a aparecer acá abajo automáticamente.</p></div>` : ''}
    <div class="dos-columnas"><div>
      <div class="seccion"><h2>Mis cursos</h2><a href="#/cursos">Ver todos los cursos →</a></div>
      ${E.misCursos.length ? `<div class="grilla" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${E.misCursos.map(tarjetaMiCurso).join('')}</div>`
        : `<div class="vacio"><span class="grande">💄</span><strong>Todavía no tenés cursos habilitados.</strong><p>Elegí tu curso e inscribite desde acá mismo.</p><a class="btn btn-oro" href="#/cursos">Ver cursos y precios</a></div>`}
    </div><div>
      <div class="seccion"><h2>Últimas devoluciones</h2><a href="#/notas">Ver notas →</a></div>
      ${corregidas.length ? corregidas.slice(0, 3).map((e) => tarjetaEntrega(e, true)).join('') : '<div class="vacio chico">Cuando la profe corrija tus trabajos, vas a ver acá tu nota y sus comentarios.</div>'}
    </div></div>`);
  hidratarFotos();
}

// ---------- Alumna: catálogo ----------
function vistaCatalogo() {
  const insc = new Set(E.inscripciones.map((i) => i.variante_id || i.servicio_id));
  const tarjeta = (s) => {
    const x = s.extra || {}; const vars = x.variantes || []; const mods = (x.detalles || []).map((d) => d.texto).slice(0, 5);
    const yaTiene = E.misCursos.some((c) => c.servicio_id === s.id);
    const boton = (id, txt) => yaTiene ? `<a class="btn btn-principal btn-chico" href="#/curso/${s.id}">Ir al curso</a>` : insc.has(id) ? '<span class="etiqueta ambar">Solicitud enviada</span>' : `<button class="btn btn-oro btn-chico" data-inscribir="${esc(id)}" data-nombre="${esc(txt)}">Inscribirme</button>`;
    return `<article class="curso"><div class="curso-foto" style="background-image:url('${portada(s.id)}')">${yaTiene ? '<span class="etiqueta verde">Ya cursás</span>' : ''}</div>
      <div class="curso-cuerpo"><h3>${esc(x.tituloDetalle || s.nombre)}</h3><p class="suave chico" style="margin:0">${esc(x.subtitulo || s.descripcion)}</p>
      ${vars.length ? `<div class="variantes">${vars.map((v) => `<div class="variante"><div><strong>${esc(v.etiqueta)}</strong><br><span class="precio" style="font-size:1rem">${esc(v.precio)}</span></div>${boton(v.id, v.nombreReserva || v.etiqueta)}</div>`).join('')}</div>`
        : `<div class="precio">${esc(s.precio_texto)} <small class="suave" style="font-family:var(--cuerpo);font-size:.75rem;font-weight:500">${esc(x.precioNota || '')}</small></div>`}
      ${s.sena_gs ? `<p class="chico suave" style="margin:0">Matrícula: Gs. ${Number(s.sena_gs).toLocaleString('es-PY')}</p>` : ''}
      ${mods.length ? `<p class="chico" style="margin:.4rem 0 0;font-weight:700;color:var(--tinta)">${esc(x.detallesTitulo || 'Módulos')}</p><ul class="modulos">${mods.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
      ${vars.length ? '' : `<div class="acciones">${boton(s.id, x.nombreReserva || s.nombre)}</div>`}</div></article>`;
  };
  pintar(`<h1>Cursos de la Academia</h1><p class="suave">Elegí tu curso. Al inscribirte se abona solo la matrícula; el curso se paga durante el cursado, directamente a Tania.</p>
    <div class="grilla">${E.servicios.map(tarjeta).join('')}</div>`);
  for (const b of $$('[data-inscribir]')) b.onclick = () => inscribirme(b.dataset.inscribir, b.dataset.nombre, b);
}
async function inscribirme(id, nombre, btn) {
  if (!E.perfil?.telefono) { toast('Primero completá tu nombre y celular.', true); location.hash = '#/perfil'; return; }
  if (!confirm(`¿Querés inscribirte a "${nombre}"?\n\nTania va a recibir tu solicitud y te escribe para confirmar.`)) return;
  btn.disabled = true;
  const { data, error } = await sb.rpc('aula_inscribirme', { p_curso: id, p_notas: 'Inscripción desde el Aula Virtual' });
  if (error) { btn.disabled = false; return toast(errorTxt(error), true); }
  await cargarAlumna();
  pintar(`<div class="tarjeta" style="max-width:560px;margin:1rem auto"><span class="etiqueta">Ref. ${esc(data.referencia)}</span><h1 style="margin-top:.6rem">¡Solicitud enviada!</h1>
    <p>Te inscribiste a <strong>${esc(data.curso)}</strong>.</p>
    ${data.matricula_gs ? `<p>Para confirmar tu lugar aboná la <strong>matrícula de Gs. ${Number(data.matricula_gs).toLocaleString('es-PY')}</strong>${data.datos_pago ? ':' : '. Tania te pasa los datos de pago por WhatsApp.'}</p>${data.datos_pago ? `<pre style="white-space:pre-wrap;background:var(--marfil);padding:.8rem;border-radius:12px;font-family:inherit">${esc(data.datos_pago)}</pre>` : ''}` : '<p>Tania te va a confirmar el lugar.</p>'}
    <p class="suave chico">Apenas Tania confirme, el curso aparece en tu sala con todas las clases.</p><a class="btn btn-principal" href="#/">Volver a mi sala</a></div>`);
}

// ---------- Alumna: un curso ----------
const TIPO_IC = { video: 'video', enlace: 'enlace' };
async function vistaCurso(id, pestana = 'clases') {
  const s = servicio(id); const tiene = E.misCursos.some((c) => c.servicio_id === id);
  if (!s || !tiene) { pintar(`<a class="volver" href="#/">‹ Mi sala</a><div class="vacio"><span class="grande">🔒</span>Este curso todavía no está habilitado para vos.<br><br><a class="btn btn-oro" href="#/cursos">Ver cursos</a></div>`); return; }
  // La base solo devuelve las clases de tu nivel y de los meses ya habilitados (RLS). El programa dice qué meses existen.
  const [{ data: lecciones }, prog] = await Promise.all([
    sb.from('lecciones').select('*').eq('servicio_id', id).eq('activo', true).order('orden').order('creado'),
    E.v2 ? sb.rpc('aula_programa', { p_curso: id }) : Promise.resolve({ data: [] })]);
  const av = avanceDe(id); const hab = av?.meses_habilitados || 1;
  const ent = E.entregas.filter((e) => e.servicio_id === id);
  const programa = (s.extra?.detalles || []).map((d) => d.texto);
  const clase = (l) => {
    const img = l.tipo === 'archivo' && /\.(jpg|png|webp)$/.test(l.archivo);
    const icono = img ? `<img data-bucket="cursos" data-ruta="${esc(l.archivo)}" alt="">` : ic(l.tipo === 'archivo' ? 'pdf' : TIPO_IC[l.tipo]);
    const tipo = l.tipo === 'archivo' ? (img ? 'Foto' : 'PDF') : l.tipo === 'video' ? 'Video' : 'Enlace';
    return `<button class="clase" data-leccion="${l.id}"><span class="clase-ic">${icono}</span><span><strong>${esc(l.titulo)}</strong><small>${tipo}${l.descripcion ? ' · ' + esc(l.descripcion.slice(0, 80)) : ''}</small></span><span class="flecha">›</span></button>`;
  };
  const porModulo = (ls) => { const mods = new Map(); for (const l of ls) { const m = l.modulo || 'General'; if (!mods.has(m)) mods.set(m, []); mods.get(m).push(l); } return mods; };
  let tabClases;
  if (E.v2) {
    const meses = new Map((prog.data || []).map((m) => [m.mes, m]));
    for (const l of lecciones || []) if (!meses.has(l.mes || 1)) meses.set(l.mes || 1, { mes: l.mes || 1, abierto: true, clases: 0, modulos: [] });
    const lista = [...meses.values()].sort((a, b) => a.mes - b.mes);
    const pendiente = E.pagos.find((p) => p.inscripcion_id === av?.inscripcion_id && p.estado === 'pendiente');
    const rechazado = E.pagos.find((p) => p.inscripcion_id === av?.inscripcion_id && p.estado === 'rechazado' && p.mes === hab + 1);
    tabClases = lista.length ? lista.map((m) => {
      if (m.abierto && m.mes <= hab) {
        const ls = (lecciones || []).filter((l) => (l.mes || 1) === m.mes);
        return `<section class="modulo"><h3><span class="modulo-num">${m.mes}</span>Mes ${m.mes}</h3>${[...porModulo(ls)].map(([mod, x]) => `<p class="modulo-sub">${esc(mod)}</p>${x.map(clase).join('')}`).join('') || '<p class="chico suave">Sin materiales todavía.</p>'}</section>`;
      }
      const siguiente = m.mes === hab + 1;
      return `<section class="modulo bloqueado"><h3><span class="modulo-num">🔒</span>Mes ${m.mes} <span class="chico suave">· ${m.clases} clase${m.clases === 1 ? '' : 's'}</span></h3>
        <p class="chico" style="margin:.3rem 0">${siguiente ? (pendiente ? '<span class="etiqueta ambar">Comprobante enviado</span> La profe lo está revisando. Apenas confirme el pago, este mes se abre solo.'
          : `${rechazado ? `<span class="etiqueta rojo">Pago no confirmado</span> ${esc(rechazado.respuesta || 'Revisá el comprobante y volvé a enviarlo.')}<br>` : ''}Para entrar a este mes tenés que abonar la cuota por transferencia y que la profe confirme el pago.`) : 'Se habilita después del mes anterior.'}</p>
        ${siguiente && !pendiente && av ? `<a class="btn btn-oro btn-chico" href="#/pagar/${esc(av.inscripcion_id)}">Pagar el mes ${m.mes}</a>` : ''}</section>`;
    }).join('') : `<div class="vacio"><span class="grande">📚</span>La profe todavía no subió materiales a tu nivel.<br>Te van a aparecer acá.</div>`;
    if (av && !lista.some((m) => m.mes === hab + 1) && !pendiente && hab < (av.meses_curso || 0) + 1 && lista.length) {
      tabClases += `<div class="tarjeta chico">¿Ya tenés que pagar el mes ${hab + 1}? <a href="#/pagar/${esc(av.inscripcion_id)}">Enviar comprobante</a></div>`;
    }
  } else {
    const mods = porModulo(lecciones || []);
    tabClases = mods.size ? [...mods].map(([m, ls], i) => `<section class="modulo"><h3><span class="modulo-num">${i + 1}</span>${esc(m)}</h3>${ls.map(clase).join('')}</section>`).join('')
      : `<div class="vacio"><span class="grande">📚</span>La profe todavía no subió materiales a este curso.<br>Te van a aparecer acá.</div>`;
  }
  if (!(lecciones || []).length && programa.length) tabClases += `<div class="tarjeta" style="margin-top:1rem"><h3>${esc(s.extra?.detallesTitulo || 'Programa')}</h3><ul class="modulos">${programa.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`;
  const tabTrabajos = (ent.length ? ent.map((e) => tarjetaEntrega(e)).join('') : '<div class="vacio"><span class="grande">📷</span>Todavía no entregaste trabajos en este curso.</div>');
  const ex = E.examenes.filter((x) => x.servicio_id === id); const exAbierto = ex.find((x) => ['solicitado', 'agendado'].includes(x.estado));
  const EX_TXT = { solicitado: ['ambar', 'Pedido: la profe te escribe para agendar'], agendado: ['', 'Agendado'], aprobado: ['verde', 'Aprobado'], desaprobado: ['rojo', 'No aprobado'] };
  const tabExamen = `<div class="tarjeta"><h2 style="margin-top:0">${ic('video')} Examen por videollamada</h2>
    <p>Las alumnas del curso online rinden el examen <strong>por videollamada de WhatsApp</strong> con la profe Tania. Vas a maquillar en vivo y la profe te va a ir pidiendo pasos y mirando el resultado.</p>
    <ul class="modulos"><li>Tené buena luz, el celular apoyado y tus productos a mano.</li><li>Conectate desde el número de WhatsApp de tu perfil (${esc(E.perfil?.telefono || 'completalo en Perfil')}).</li><li>La profe te confirma el día y la hora por acá y por WhatsApp.</li></ul>
    ${ex.map((x) => `<p class="chico"><span class="etiqueta ${EX_TXT[x.estado]?.[0] || 'gris'}">${EX_TXT[x.estado]?.[1] || esc(x.estado)}</span> Mes ${x.mes}${x.fecha ? ' · <strong>' + fechaHora(x.fecha) + '</strong>' : ''}${x.nota_profe ? ' · ' + esc(x.nota_profe) : ''}</p>`).join('')}
    ${E.v2 && !exAbierto ? `<form id="f-examen" novalidate><label for="x-pref">¿Qué días y horarios te quedan bien?</label><input id="x-pref" maxlength="300" placeholder="Ej: martes o jueves de tarde">
      <button class="btn btn-oro" style="margin-top:.6rem">Pedir mi examen</button></form>` : ''}
    <div class="fila" style="margin-top:.8rem"><a class="btn btn-borde" target="_blank" rel="noopener" href="${esc(waUrl(`Hola profe Tania, soy ${E.perfil?.nombre || ''}, alumna online de ${s.nombre}. Quiero coordinar mi examen por videollamada.`))}">${ic('video')} Coordinar por WhatsApp</a></div></div>`;
  const tabs = [['clases', 'libro', 'Clases'], ['trabajos', 'camara', `Mis trabajos (${ent.length})`], ['examen', 'video', 'Examen']];
  pintar(`<a class="volver" href="#/">‹ Mi sala</a>
    <div class="cabeza-curso" style="background-image:url('${portada(id, 1440)}')"><span class="etiqueta" style="align-self:flex-start">${(lecciones || []).length} clases${E.v2 ? ` · Mes ${hab} habilitado` : ''}</span><h1>${esc(s.extra?.tituloDetalle || s.nombre)}</h1><p style="margin:0;opacity:.9">${esc(av?.curso_nombre || s.extra?.subtitulo || '')}</p></div>
    ${AVISO_IA}
    <div class="subpestanas" role="tablist">${tabs.map(([t, i, n]) => `<button role="tab" data-tab="${t}" aria-selected="${pestana === t}">${ic(i)} ${n}</button>`).join('')}</div>
    <div id="tab-clases" data-panel ${pestana === 'clases' ? '' : 'hidden'}>${tabClases}</div><div id="tab-trabajos" data-panel ${pestana === 'trabajos' ? '' : 'hidden'}>${tabTrabajos}</div>
    <div id="tab-examen" data-panel ${pestana === 'examen' ? '' : 'hidden'}>${tabExamen}</div>
    <a class="btn btn-oro fab" href="#/entregar/${esc(id)}">${ic('camara')} Entregar trabajo</a>`);
  for (const b of $$('[data-tab]')) b.onclick = () => { for (const x of $$('[data-tab]')) x.setAttribute('aria-selected', x === b); for (const p of $$('[data-panel]')) p.hidden = p.id !== 'tab-' + b.dataset.tab; };
  for (const b of $$('[data-leccion]')) b.onclick = () => abrirLeccion((lecciones || []).find((l) => l.id === b.dataset.leccion));
  $('#f-examen')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
    const { error } = await sb.rpc('aula_pedir_examen', { p_curso: id, p_preferencia: $('#x-pref').value.trim() });
    if (error) { btn.disabled = false; return toast(errorTxt(error), true); }
    await cargarAlumna(); toast('¡Listo! La profe te va a escribir para agendar la videollamada.'); vistaCurso(id, 'examen');
  });
  hidratarFotos();
}

// ---------- Alumna: pagar el mes siguiente (transferencia) ----------
async function vistaPagar(inscId) {
  const av = E.avance.find((a) => a.inscripcion_id === inscId); if (!E.v2 || !av) { location.hash = '#/'; return; }
  const mes = av.meses_habilitados + 1; const pend = E.pagos.find((p) => p.inscripcion_id === inscId && p.estado === 'pendiente');
  const volver = `<a class="volver" href="#/curso/${esc(av.servicio_id)}">‹ ${esc(av.curso_nombre)}</a>`;
  if (pend) { pintar(`${volver}<div class="vacio"><span class="grande">⏳</span>Ya enviaste el comprobante del mes ${pend.mes}. La profe lo está revisando; apenas lo confirme, el mes se abre solo.</div>`); return; }
  pintar(`${volver}<h1>Pagar el mes ${mes}</h1><div class="tarjeta" style="max-width:620px">
    <p>El acceso a cada mes se habilita <strong>solo con pago por transferencia</strong>, cuando la profe confirma que recibió el pago${E.v3 ? ' <strong>y</strong> aprobaste las clases y el examen del mes anterior' : ''}.</p>
    ${av.cuota_gs ? `<p>Cuota del curso: <strong>${gs(av.cuota_gs)}</strong></p>` : ''}
    <div id="pago-paso1"><button class="btn btn-oro btn-ancho" id="pago-quiero">Sí, quiero pagar el mes ${mes} — ver datos para transferir</button></div>
    <div id="pago-paso2" hidden></div></div>`);
  $('#pago-quiero').onclick = async () => {
    const { data, error } = await sb.rpc('aula_datos_pago', { p_inscripcion: inscId }); if (error) return toast(errorTxt(error), true);
    $('#pago-paso1').hidden = true; const d = $('#pago-paso2'); d.hidden = false;
    d.innerHTML = `<h3>1. Transferí a esta cuenta</h3><pre class="datos-pago">${esc(data.datos_pago || 'La profe te pasa los datos por WhatsApp.')}</pre>
      <p class="chico suave">En el concepto poné: <strong>Ref. ${esc(data.referencia)} – mes ${mes}</strong></p>
      <h3>2. Subí el comprobante</h3><form id="f-pago" novalidate><label class="subir">${ic('subir')} <span id="pago-arch">Elegir captura o PDF del comprobante</span><input type="file" id="pago-file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>
      <label for="pago-nota">Nota (opcional)</label><input id="pago-nota" maxlength="500" placeholder="Ej: transferí desde la cuenta de mi mamá">
      <p class="error" id="pago-error"></p><button class="btn btn-oro btn-ancho" id="pago-btn">Enviar comprobante a la profe</button></form>`;
    $('#pago-file').onchange = (e) => { $('#pago-arch').textContent = e.target.files[0]?.name || 'Elegir comprobante'; };
    $('#f-pago').onsubmit = async (e) => {
      e.preventDefault(); const err = $('#pago-error'); err.textContent = ''; const file = $('#pago-file').files[0];
      if (!file) return (err.textContent = 'Elegí la captura o el PDF del comprobante.');
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[file.type];
      if (!ext) return (err.textContent = 'Solo JPG, PNG, WEBP o PDF.'); if (file.size > 8388608) return (err.textContent = 'El archivo pesa más de 8 MB.');
      const btn = $('#pago-btn'); btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        const ruta = `${E.user.id}/${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from('pagos-aula').upload(ruta, file, { contentType: file.type, upsert: false }); if (up.error) throw up.error;
        const { error: e2 } = await sb.rpc('aula_enviar_pago', { p_inscripcion: inscId, p_ruta: ruta, p_nota: $('#pago-nota').value.trim() }); if (e2) throw e2;
        await cargarAlumna(); toast('¡Comprobante enviado! Te avisamos acá cuando la profe lo confirme.'); location.hash = `#/curso/${av.servicio_id}`;
      } catch (x) { err.textContent = errorTxt(x); btn.disabled = false; btn.textContent = 'Enviar comprobante a la profe'; }
    };
  };
}
async function abrirLeccion(l) {
  if (!l) return;
  if (l.tipo !== 'archivo') {
    const yt = l.url.match(/(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/);
    if (yt) return visor(`<iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0" allow="autoplay; fullscreen" allowfullscreen></iframe>`);
    return window.open(l.url, '_blank', 'noopener');
  }
  const u = await urlFirmada('cursos', l.archivo); if (!u) return toast('No se pudo abrir el archivo.', true);
  if (/\.pdf$/.test(l.archivo)) { if (matchMedia('(max-width: 899px)').matches) return window.open(u, '_blank', 'noopener'); return visor(`<iframe src="${u}" title="${esc(l.titulo)}"></iframe>`); }
  visor(`<img src="${u}" alt="${esc(l.titulo)}">`);
}
function visor(html) { const d = $('#visor'); $('#visor-cuerpo').innerHTML = html; d.showModal(); }

function tarjetaEntrega(e, conCurso = false) {
  const s = servicio(e.servicio_id);
  const est = e.estado === 'enviada' ? '<span class="etiqueta gris">Esperando corrección</span>' : e.estado === 'rehacer' ? '<span class="etiqueta rojo">Para rehacer</span>'
    : e.estado === 'anulada_ia' ? '<span class="etiqueta rojo">Anulada por uso de IA</span>' : '<span class="etiqueta verde">Corregido</span>';
  const yaRehecha = E.entregas.some((x) => x.reemplaza_id === e.id);
  const reentregar = !E.admin && E.v2 && ['anulada_ia', 'rehacer'].includes(e.estado) && !yaRehecha
    ? `<a class="btn btn-oro btn-chico" href="#/entregar/${esc(e.servicio_id)}?reemplaza=${esc(e.id)}">${ic('camara')} Volver a presentar</a>` : yaRehecha ? '<span class="chico suave">Ya la volviste a presentar ✓</span>' : '';
  return `<article class="entrega"><div class="entrega-cab"><div><h3>${esc(e.titulo)}</h3><span class="chico suave">${conCurso && s ? esc(s.nombre) + ' · ' : ''}${e.modulo ? esc(e.modulo) + ' · ' : ''}${fechaHora(e.creado)}</span></div>${est}</div>
    <div class="fotos">${e.fotos.map((f) => `<button data-ver="${esc(f)}"><img data-bucket="entregas" data-ruta="${esc(f)}" alt="Foto del trabajo"></button>`).join('')}</div>
    ${e.mensaje ? `<p class="chico" style="margin:.2rem 0">💬 ${esc(e.mensaje)}</p>` : ''}
    ${e.calificacion ? `<div class="nota"><span class="nota-num">${e.calificacion}</span><div><div class="estrellas">${estrellas(e.calificacion)}</div><strong>${NOTA_TXT[e.calificacion]}</strong></div></div>` : ''}
    ${e.estado === 'anulada_ia' ? `<p class="chico" style="margin:.3rem 0;color:var(--rojo)">La profe detectó uso de inteligencia artificial en las respuestas o en las fotos, por eso la clase quedó anulada. Podés volver a presentarla.</p>` : ''}
    ${e.comentario ? `<div class="comentario"><b><img src="../img/retrato-280.webp" alt="">Comentario de la profe Tania</b>${esc(e.comentario).replace(/\n/g, '<br>')}</div>` : ''}
    ${E.v3 ? rubricaHtml(e.rubrica) : ''}
    ${E.v3 && !E.admin && e.estado === 'corregida' ? `<label class="interruptor chico"><input type="checkbox" data-porta="${e.id}" ${e.portafolio ? 'checked' : ''}> En mi portafolio</label>` : ''}
    ${e.reemplaza_id ? '<p class="chico suave" style="margin:.2rem 0">↻ Reentrega de una clase anterior</p>' : ''}${reentregar ? `<div class="acciones">${reentregar}</div>` : ''}</article>`;
}
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-ver]'); if (!b) return;
  const u = await urlFirmada('entregas', b.dataset.ver); if (u) visor(`<img src="${u}" alt="Foto del trabajo">`);
});

// ---------- Alumna: entregar trabajo (solo cámara) ----------
function vistaEntregar(id, q = '') {
  const s = servicio(id); if (!E.misCursos.some((c) => c.servicio_id === id)) { location.hash = '#/'; return; }
  const fotos = []; const mods = [...new Set((s.extra?.detalles || []).map((d) => d.texto))];
  const reemplaza = new URLSearchParams(q).get('reemplaza'); const previa = reemplaza && E.entregas.find((x) => x.id === reemplaza);
  const leccionId = new URLSearchParams(q).get('leccion') || previa?.leccion_id || null;
  const hab = avanceDe(id)?.meses_habilitados || 1;
  pintar(`<a class="volver" href="#/curso/${esc(id)}">‹ ${esc(s.nombre)}</a><h1>${previa ? 'Volver a presentar' : 'Entregar trabajo práctico'}</h1>
    ${previa ? `<p class="suave">Reentrega de <strong>${esc(previa.titulo)}</strong>.</p>` : ''}${AVISO_IA}
    <div class="tarjeta"><form id="f-entrega" novalidate>
      <div class="paso"><span class="paso-num">1</span><div style="flex:1"><strong>¿Qué trabajo es?</strong>
        <label for="e-titulo">Título</label><input id="e-titulo" name="titulo" required maxlength="160" placeholder="Ej: Smokey eyes – práctica 1" value="${esc(previa ? previa.titulo : '')}">
        ${E.v2 ? `<label for="e-mes">Mes de la clase</label><select id="e-mes" name="mes">${Array.from({ length: hab }, (_, i) => hab - i).map((m) => `<option value="${m}" ${previa?.mes === m ? 'selected' : ''}>Mes ${m}</option>`).join('')}</select>` : ''}
        ${mods.length ? `<label for="e-modulo">Módulo (opcional)</label><select id="e-modulo" name="modulo"><option value="">—</option>${mods.map((m) => `<option>${esc(m)}</option>`).join('')}</select>` : ''}</div></div>
      <div class="paso"><span class="paso-num">2</span><div style="flex:1"><strong>Sacá las fotos con la cámara</strong><p class="chico suave" style="margin:.2rem 0">Solo se aceptan fotos sacadas ahora mismo con la cámara del aula: no se puede elegir de la galería ni subir fotos de otras aplicaciones. Hasta 6 fotos.</p>
        <div class="tomadas" id="tomadas"></div><div class="sello-camara">${ic('check')} Cada foto queda sellada con tu nombre, la fecha y la hora.</div></div></div>
      <div class="paso"><span class="paso-num">3</span><div style="flex:1"><label for="e-msj" style="margin-top:0">Mensaje para la profe (opcional)</label><textarea id="e-msj" name="mensaje" maxlength="1000" placeholder="Contale qué productos usaste o qué te costó…"></textarea></div></div>
      <p class="error" id="e-error" role="alert"></p><button class="btn btn-oro btn-ancho" id="e-btn">Enviar a la profe</button>
    </form></div>`);
  const pintarFotos = () => { $('#tomadas').innerHTML = fotos.map((f, i) => `<div class="tomada"><img src="${f.url}" alt="Foto ${i + 1}"><button type="button" data-quitar="${i}" aria-label="Quitar">✕</button></div>`).join('')
      + (fotos.length < 6 ? `<button type="button" class="boton-camara" id="abrir-cam">${ic('camara')}${fotos.length ? 'Otra foto' : 'Abrir cámara'}</button>` : '');
    $('#abrir-cam')?.addEventListener('click', abrirCam); for (const b of $$('[data-quitar]')) b.onclick = () => { fotos.splice(+b.dataset.quitar, 1); pintarFotos(); }; };
  const abrirCam = async () => {
    try { const nuevas = await tomarFotos({ max: 6 - fotos.length, sello: `${E.perfil?.nombre || E.user.email} · Aula Tania Sanabria` });
      for (const b of nuevas) fotos.push({ blob: b, url: URL.createObjectURL(b) }); pintarFotos(); }
    catch (x) { toast(x.message === 'PERMISO_CAMARA' ? 'Permití el acceso a la cámara para poder entregar.' : 'No pudimos abrir la cámara en vivo. Abrí el aula en Chrome (Android) o Safari (iPhone) actualizado y volvé a intentar.', true); }
  };
  pintarFotos();
  $('#f-entrega').onsubmit = async (ev) => {
    ev.preventDefault(); const f = ev.target, err = $('#e-error'); err.textContent = '';
    if (f.titulo.value.trim().length < 2) { err.textContent = 'Poné un título al trabajo.'; return f.titulo.focus(); }
    if (!fotos.length) { err.textContent = 'Sacá al menos una foto con la cámara.'; return; }
    const btn = $('#e-btn'); btn.disabled = true;
    try {
      const rutas = [];
      for (let i = 0; i < fotos.length; i++) {
        btn.textContent = `Subiendo foto ${i + 1} de ${fotos.length}…`;
        const ruta = `${E.user.id}/${crypto.randomUUID()}.jpg`;
        const { error } = await sb.storage.from('entregas').upload(ruta, fotos[i].blob, { contentType: 'image/jpeg', upsert: false }); if (error) throw error;
        rutas.push(ruta);
      }
      btn.textContent = 'Enviando…';
      const fila = { servicio_id: id, titulo: f.titulo.value.trim(), modulo: f.modulo?.value || null, mensaje: f.mensaje.value.trim(), fotos: rutas };
      if (E.v3 && leccionId) fila.leccion_id = leccionId;
      if (E.v2) Object.assign(fila, { mes: +(f.mes?.value || hab), reemplaza_id: previa ? previa.id : null,
        captura: { origen: 'camara-en-vivo', dispositivo: await huellaDispositivo(), fotos: fotos.map((x) => x.blob.meta || null), enviada: new Date().toISOString(), agente: navigator.userAgent.slice(0, 200) } });
      const { error } = await sb.from('entregas').insert(fila);
      if (error) throw error;
      await cargarAlumna(); toast('¡Trabajo enviado! La profe te va a dejar su devolución.'); location.hash = `#/curso/${id}?trabajos`;
    } catch (x) { err.textContent = errorTxt(x); btn.disabled = false; btn.textContent = 'Enviar a la profe'; }
  };
}

// ---------- Alumna: notas ----------
function vistaNotas() {
  const porCurso = E.misCursos.map((c) => {
    const ent = E.entregas.filter((e) => e.servicio_id === c.servicio_id); const n = ent.filter((e) => e.calificacion);
    const prom = n.length ? n.reduce((a, e) => a + e.calificacion, 0) / n.length : null;
    return `<div class="tarjeta" style="margin-bottom:.8rem"><div class="fila entre"><div><h3 style="margin:0">${esc(c.nombre)}</h3><span class="chico suave">${ent.length} entregados · ${n.length} corregidos</span></div>
      ${prom ? `<span class="nota-num" title="Promedio">${prom.toFixed(1)}</span>` : '<span class="etiqueta gris">Sin notas aún</span>'}</div>
      ${prom ? `<div class="barra" style="margin-top:.7rem"><i style="width:${prom / 5 * 100}%"></i></div>` : ''}</div>`;
  }).join('');
  const corr = E.entregas.filter((e) => e.estado !== 'enviada');
  setTimeout(() => { for (const c of $$('[data-porta]')) c.onchange = async () => { const { error } = await sb.rpc('aula_portafolio', { p_entrega: c.dataset.porta, p_incluir: c.checked });
    if (error) { c.checked = !c.checked; return toast(errorTxt(error), true); } const e = E.entregas.find((x) => x.id === c.dataset.porta); if (e) e.portafolio = c.checked; toast(c.checked ? 'Agregado a tu portafolio ✓' : 'Quitado del portafolio'); }; }, 0);
  pintar(`<h1>Mis notas</h1><p class="suave">Escala de 1 a 5 · tus promedios y los comentarios de la profe para seguir mejorando.${E.v3 ? ' <a href="#/portafolio">Ver mi portafolio →</a>' : ''}</p>
    <div class="dos-columnas"><div>${corr.length ? corr.map((e) => tarjetaEntrega(e, true)).join('') : '<div class="vacio"><span class="grande">⭐</span>Todavía no hay trabajos corregidos.</div>'}</div><div>${porCurso || ''}</div></div>`);
  hidratarFotos();
}

// ---------- Perfil ----------
function vistaPerfil() {
  const p = E.perfil || {};
  pintar(`<h1>Mi perfil</h1><div class="tarjeta" style="max-width:560px">
    ${!E.admin && !E.perfil ? '<p class="etiqueta ambar">Completá tus datos para empezar</p>' : ''}
    <form id="f-perfil" novalidate>${E.admin ? '' : `<label for="p-nombre">Nombre y apellido</label><input id="p-nombre" name="nombre" value="${esc(p.nombre || '')}" required maxlength="120" autocomplete="name">
      <label for="p-tel">Celular (WhatsApp)</label><input id="p-tel" name="telefono" type="tel" value="${esc(p.telefono || '')}" maxlength="30" autocomplete="tel">`}
      <label>Email</label><input value="${esc(E.user.email)}" disabled>
      <p class="error" id="p-error"></p>${E.admin ? '' : '<button class="btn btn-principal">Guardar</button>'}</form>
    <hr style="border:0;border-top:1px solid var(--linea);margin:1.2rem 0"><div class="fila"><button class="btn btn-borde" id="instalar" hidden>📲 Instalar la app</button><a class="btn btn-borde" href="../">Sitio de Tania</a><button class="btn btn-peligro" id="salir">Cerrar sesión</button></div></div>`);
  $('#salir').onclick = async () => { await sb.auth.signOut(); E.user = null; location.hash = ''; vistaIngreso(); };
  if (window.__instalar) { $('#instalar').hidden = false; $('#instalar').onclick = () => window.__instalar.prompt(); }
  $('#f-perfil').onsubmit = async (e) => {
    e.preventDefault(); if (E.admin) return; const f = e.target;
    const datos = { user_id: E.user.id, email: E.user.email.toLowerCase(), nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim() };
    if (datos.nombre.length < 3) return ($('#p-error').textContent = 'Escribí tu nombre y apellido.');
    if (datos.telefono.replace(/\D/g, '').length < 8) return ($('#p-error').textContent = 'Escribí tu celular.');
    const { data, error } = await sb.from('perfiles').upsert(datos).select().single();
    if (error) return ($('#p-error').textContent = errorTxt(error));
    const nuevo = !E.perfil; E.perfil = data; navegacion(); toast('Datos guardados ✓'); if (nuevo) location.hash = '#/';
  };
}

// ---------- Admin: corregir ----------
// Datos de la toma (los manda el aula al sacar la foto con la cámara en vivo)
function capturaTxt(e) {
  const c = e.captura; if (!c || !c.origen) return '';
  const f = (c.fotos || []).filter(Boolean); const t = f[0]?.tomada;
  return `<br><span class="chico suave" title="${esc(c.agente || '')}">📷 Cámara en vivo${t ? ' · tomada ' + fechaHora(t) : ''}${f[0]?.ancho ? ` · ${f[0].ancho}×${f[0].alto}` : ''}</span>`;
}
async function vistaAdminCorregir() {
  const filtro = JSON.parse(sessionStorage.getItem('aula-filtro') || '{"estado":"enviada","curso":""}');
  let { data, error } = await sb.rpc(E.v3 ? 'admin_entregas3' : E.v2 ? 'admin_entregas2' : 'admin_entregas', { p_curso: filtro.curso || null, p_estado: filtro.estado || null });
  if (E.v3 && data) data = data.map((d) => d.admin_entregas3 || d);
  if (error) return pintar(`<div class="vacio">${esc(errorTxt(error))}</div>`);
  pintar(`<h1>Trabajos para corregir</h1><p class="suave">Mirá las fotos, poné la nota (1 a 5) y dejale un comentario para que mejore.</p>
    <div class="filtros"><select id="f-estado"><option value="enviada">Sin corregir</option><option value="corregida">Corregidos</option><option value="rehacer">Para rehacer</option>${E.v2 ? '<option value="anulada_ia">Anuladas por IA</option>' : ''}<option value="">Todos</option></select>
      <select id="f-curso"><option value="">Todos los cursos</option>${E.servicios.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('')}</select></div>
    <div class="grilla" style="grid-template-columns:repeat(auto-fill,minmax(380px,1fr))">${(data || []).map((e) => `<article class="entrega" data-id="${e.id}" data-curso="${esc(e.servicio_id)}">
      <div class="entrega-cab"><div><h3>${esc(e.titulo)}</h3><span class="chico"><strong>${esc(e.nombre)}</strong> · ${esc(e.curso)}</span><br><span class="chico suave">${e.modulo ? esc(e.modulo) + ' · ' : ''}${fechaHora(e.creado)}</span>${capturaTxt(e)}</div>
      ${e.estado === 'enviada' ? '<span class="etiqueta ambar">Nuevo</span>' : e.estado === 'rehacer' ? '<span class="etiqueta rojo">Rehacer</span>' : e.estado === 'anulada_ia' ? '<span class="etiqueta rojo">Anulada IA</span>' : `<span class="nota-num" style="width:44px;height:44px;font-size:1.2rem">${e.calificacion ?? '–'}</span>`}</div>
      <div class="fotos">${e.fotos.map((f) => `<button data-ver="${esc(f)}"><img data-bucket="entregas" data-ruta="${esc(f)}" alt="Foto del trabajo"></button>`).join('')}</div>
      ${e.mensaje ? `<p class="chico" style="margin:.2rem 0">💬 ${esc(e.mensaje)}</p>` : ''}
      ${E.v3 ? `${e.leccion ? `<p class="chico" style="margin:.2rem 0">📘 Clase: <b>${esc(e.leccion)}</b></p>` : ''}${flagsHtml(e.flags)}
        <div class="rubrica">${criteriosDe(e.servicio_id).map((c) => `<span>${esc(c)}</span><span class="escala" data-crit="${esc(c)}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-pressed="${(e.rubrica || {})[c] == n}">${n}</button>`).join('')}</span>`).join('')}</div>` : ''}
      <div class="calificar"><div class="escala" role="group" aria-label="Nota" ${E.v3 ? 'hidden' : ''}>${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-nota="${n}" aria-pressed="${e.calificacion === n}">${n}</button>`).join('')}</div>
        <div class="escala-txt" data-txt>${e.calificacion ? NOTA_TXT[e.calificacion] : '1 Insuficiente · 3 Bueno · 5 Excelente'}</div>
        <textarea data-com placeholder="Comentario para la alumna: qué salió bien y qué mejorar…" maxlength="3000">${esc(e.comentario || '')}</textarea>
        <div class="fila"><button class="btn btn-oro" data-guardar style="flex:1">${E.v3 ? '✅ Aprobar clase' : 'Guardar corrección'}</button><button class="btn btn-borde btn-chico" data-rehacer>Pedir que lo rehaga</button>${E.v2 ? '<button class="btn btn-peligro btn-chico" data-ia title="Anular por uso de inteligencia artificial">Anular por IA</button>' : ''}</div></div></article>`).join('')
      || '<div class="vacio" style="grid-column:1/-1"><span class="grande">🎉</span>No hay trabajos en esta lista.</div>'}</div>`);
  $('#f-estado').value = filtro.estado; $('#f-curso').value = filtro.curso;
  for (const id of ['#f-estado', '#f-curso']) $(id).onchange = () => { sessionStorage.setItem('aula-filtro', JSON.stringify({ estado: $('#f-estado').value, curso: $('#f-curso').value })); vistaAdminCorregir(); };
  for (const art of $$('.entrega[data-id]')) {
    let nota = +(art.querySelector('[data-nota][aria-pressed="true"]')?.dataset.nota || 0);
    const rub = {}; for (const g of $$('[data-crit]', art)) { const pre = g.querySelector('[aria-pressed="true"]'); if (pre) rub[g.dataset.crit] = +pre.dataset.n;
      for (const b of $$('[data-n]', g)) b.onclick = () => { rub[g.dataset.crit] = +b.dataset.n; for (const y of $$('[data-n]', g)) y.setAttribute('aria-pressed', y === b); }; }
    for (const b of $$('[data-nota]', art)) b.onclick = () => { nota = +b.dataset.nota; for (const x of $$('[data-nota]', art)) x.setAttribute('aria-pressed', x === b); art.querySelector('[data-txt]').textContent = NOTA_TXT[nota]; };
    const guardar = async (estado) => {
      if (E.v3) {
        const crit = criteriosDe(art.dataset.curso || ''); if (estado === 'corregida' && crit.some((c) => !rub[c])) return toast('Completá la rúbrica (1 a 5 en cada criterio).', true);
        if (estado === 'anulada_ia' && !confirm('¿Anular esta clase por uso de IA? La alumna va a ver el aviso y podrá volver a presentarla.')) return;
        const { error: e3 } = await sb.rpc('admin_calificar_rubrica', { p_id: art.dataset.id, p_estado: estado, p_rubrica: Object.keys(rub).length ? rub : null, p_comentario: art.querySelector('[data-com]').value });
        if (e3) return toast(errorTxt(e3), true);
        toast(estado === 'rehacer' ? 'Le pediste que lo rehaga ✓' : estado === 'anulada_ia' ? 'Clase anulada por IA ✓' : 'Clase aprobada ✓'); await contarPendientes(); navegacion(); marcarNav(); return vistaAdminCorregir();
      }
      if (estado === 'corregida' && !nota) return toast('Elegí una nota del 1 al 5.', true);
      if (estado === 'anulada_ia' && !confirm('¿Anular esta clase por uso de IA? La alumna va a ver el aviso y podrá volver a presentarla.')) return;
      const { error } = await sb.rpc('admin_calificar', { p_id: art.dataset.id, p_calificacion: estado === 'rehacer' ? (nota || null) : nota, p_comentario: art.querySelector('[data-com]').value, p_estado: estado });
      if (error) return toast(errorTxt(error), true);
      toast(estado === 'rehacer' ? 'Le pediste que lo rehaga ✓' : estado === 'anulada_ia' ? 'Clase anulada por IA ✓' : 'Corrección guardada ✓'); await contarPendientes(); navegacion(); marcarNav(); vistaAdminCorregir();
    };
    art.querySelector('[data-guardar]').onclick = () => guardar('corregida');
    art.querySelector('[data-rehacer]').onclick = () => guardar('rehacer');
    art.querySelector('[data-ia]')?.addEventListener('click', () => guardar('anulada_ia'));
  }
  hidratarFotos();
}

// ---------- Admin: materiales ----------
async function vistaAdminMateriales() {
  const cur = sessionStorage.getItem('aula-curso-mat') || E.servicios[0]?.id;
  const s = servicio(cur);
  const { data: lecciones } = await sb.from('lecciones').select('*').eq('servicio_id', cur).order(E.v2 ? 'mes' : 'orden').order('orden').order('creado');
  const modsCat = (s?.extra?.detalles || []).map((d) => d.texto); const modsUsados = [...new Set((lecciones || []).map((l) => l.modulo).filter(Boolean))];
  const vars = s?.extra?.variantes || []; const nivelTxt = (v) => v ? (vars.find((x) => x.id === v)?.etiqueta || v) : 'Todos los niveles';
  pintar(`${E.v3 ? '<p class="chico" style="float:right"><a href="#/admin/config">⚙️ Rúbrica, plazos y cuestionarios</a></p>' : ''}<h1>Materiales de los cursos</h1><p class="suave">Subí los PDF por mes/módulo y por nivel. Cada alumna ve solo los de su nivel y solo de los meses que ya tiene pagos y confirmados.</p>
    <div class="filtros"><select id="m-curso">${E.servicios.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select></div>
    <div class="dos-columnas"><div><h2>Clases cargadas (${(lecciones || []).length})</h2>
      ${(lecciones || []).length ? (lecciones || []).map((l) => `<div class="clase" style="cursor:default"><span class="clase-ic">${/\.(jpg|png|webp)$/.test(l.archivo || '') ? `<img data-bucket="cursos" data-ruta="${esc(l.archivo)}" alt="">` : ic(l.tipo === 'archivo' ? 'pdf' : TIPO_IC[l.tipo])}</span>
        <span><strong>${esc(l.titulo)}</strong><small>${E.v2 ? `Mes ${l.mes || 1}${l.semana ? ' · semana ' + l.semana : ''} · ${esc(nivelTxt(l.variante_id))} · ` : ''}${esc(l.modulo || 'General')}${l.activo ? '' : ' · <b style="color:var(--rojo)">oculta</b>'}</small></span>
        <span class="fila" style="margin-left:auto;flex-wrap:nowrap"><button class="btn btn-borde btn-chico" data-ocultar="${l.id}" data-activo="${l.activo}">${l.activo ? 'Ocultar' : 'Mostrar'}</button><button class="btn btn-peligro btn-chico" data-borrar="${l.id}" data-archivo="${esc(l.archivo || '')}" aria-label="Borrar">✕</button></span></div>`).join('')
        : '<div class="vacio">Este curso todavía no tiene materiales.</div>'}</div>
    <div class="tarjeta"><h2>Agregar material</h2><form id="f-mat" novalidate>
      ${E.v2 ? `<div class="fila" style="gap:.6rem;flex-wrap:nowrap"><div style="flex:0 0 7rem"><label for="m-mes">Mes</label><input id="m-mes" name="mes" type="number" min="1" max="36" value="1" required></div>
        <div style="flex:1"><label for="m-nivel">Nivel / categoría</label><select id="m-nivel" name="nivel"><option value="">Todos los niveles</option>${vars.map((v) => `<option value="${esc(v.id)}">${esc(v.etiqueta || v.id)}</option>`).join('')}</select></div></div>
        <label for="m-semana">Semana del curso (opcional)</label><input id="m-semana" name="semana" type="number" min="1" max="160" placeholder="Ej: 1 = se ve apenas aprobás; 2 = a los 7 días…">` : ''}
      <label for="m-modulo">Módulo</label><input id="m-modulo" name="modulo" list="m-mods" maxlength="120" placeholder="Ej: Módulo 1 – Teoría del color"><datalist id="m-mods">${[...new Set([...modsUsados, ...modsCat])].map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
      <label for="m-titulo">Título</label><input id="m-titulo" name="titulo" required maxlength="160">
      <label for="m-desc">Descripción (opcional)</label><textarea id="m-desc" name="descripcion" maxlength="4000"></textarea>
      <label for="m-tipo">Tipo</label><select id="m-tipo" name="tipo"><option value="archivo">PDF o foto</option><option value="video">Video (YouTube / Drive)</option><option value="enlace">Enlace</option></select>
      <div id="m-arch"><label class="subir" style="margin-top:.8rem">${ic('subir')} <span id="m-arch-txt">Elegir PDF o foto (máx. 25 MB)</span><input type="file" id="m-file" accept="application/pdf,image/jpeg,image/png,image/webp"></label></div>
      <div id="m-url" hidden><label for="m-link">Enlace</label><input id="m-link" type="url" placeholder="https://…"></div>
      <p class="error" id="m-error"></p><button class="btn btn-oro btn-ancho" id="m-btn">Publicar para las alumnas</button></form></div></div>`);
  $('#m-curso').value = cur; $('#m-curso').onchange = (e) => { sessionStorage.setItem('aula-curso-mat', e.target.value); vistaAdminMateriales(); };
  $('#m-tipo').onchange = (e) => { $('#m-arch').hidden = e.target.value !== 'archivo'; $('#m-url').hidden = e.target.value === 'archivo'; };
  $('#m-file').onchange = (e) => { $('#m-arch-txt').textContent = e.target.files[0]?.name || 'Elegir PDF o foto'; };
  for (const b of $$('[data-ocultar]')) b.onclick = async () => { await sb.from('lecciones').update({ activo: b.dataset.activo !== 'true' }).eq('id', b.dataset.ocultar); vistaAdminMateriales(); };
  for (const b of $$('[data-borrar]')) b.onclick = async () => {
    if (!confirm('¿Borrar este material? Las alumnas ya no lo van a ver.')) return;
    const { error } = await sb.from('lecciones').delete().eq('id', b.dataset.borrar); if (error) return toast(errorTxt(error), true);
    if (b.dataset.archivo) await sb.storage.from('cursos').remove([b.dataset.archivo]); toast('Material borrado'); vistaAdminMateriales();
  };
  hidratarFotos();
  $('#f-mat').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, err = $('#m-error'); err.textContent = ''; const tipo = f.tipo.value;
    if (f.titulo.value.trim().length < 1) { err.textContent = 'Escribí un título.'; return; }
    const fila = { servicio_id: cur, modulo: f.modulo.value.trim() || null, titulo: f.titulo.value.trim(), descripcion: f.descripcion.value.trim(), tipo, orden: (lecciones || []).length };
    if (E.v2) { const m = +f.mes.value; if (!(m >= 1 && m <= 36)) { err.textContent = 'El mes va de 1 a 36.'; return; } Object.assign(fila, { mes: m, variante_id: f.nivel.value || null });
      if (f.semana.value) { const w = +f.semana.value; if (!(w >= 1 && w <= 160)) { err.textContent = 'La semana va de 1 a 160.'; return; } fila.semana = w; } }
    const btn = $('#m-btn'); btn.disabled = true; btn.textContent = 'Publicando…';
    try {
      if (tipo === 'archivo') {
        const file = $('#m-file').files[0]; if (!file) throw new Error('Elegí un archivo PDF o una foto.');
        if (file.size > 26214400) throw new Error('El archivo pesa más de 25 MB.');
        const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]; if (!ext) throw new Error('Solo PDF, JPG, PNG o WEBP.');
        const ruta = `${cur}/${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from('cursos').upload(ruta, file, { contentType: file.type }); if (up.error) throw up.error;
        Object.assign(fila, { archivo: ruta, archivo_nombre: file.name.slice(0, 200), archivo_bytes: file.size });
      } else { const u = $('#m-link').value.trim(); if (!/^https:\/\/\S+$/.test(u)) throw new Error('Pegá un enlace que empiece con https://'); fila.url = u; }
      const { error } = await sb.from('lecciones').insert(fila); if (error) throw error;
      toast('Material publicado ✓'); vistaAdminMateriales();
    } catch (x) { err.textContent = errorTxt(x); btn.disabled = false; btn.textContent = 'Publicar para las alumnas'; }
  };
}

// ---------- Admin: alumnas ----------
async function vistaAdminAlumnas() {
  const { data, error } = await sb.rpc('admin_alumnas'); if (error) return pintar(`<div class="vacio">${esc(errorTxt(error))}</div>`);
  const pend = (data || []).filter((a) => !a.acceso);
  pintar(`<h1>Alumnas</h1><p class="suave">Activá el acceso cuando la alumna pagó la matrícula: el curso aparece en su sala al instante.</p>
    <div class="estadisticas"><div class="dato"><strong>${(data || []).filter((a) => a.acceso).length}</strong><span>Con acceso</span></div><div class="dato"><strong>${pend.length}</strong><span>Por habilitar</span></div><div class="dato"><strong>${(data || []).filter((a) => a.tiene_cuenta).length}</strong><span>Con cuenta</span></div></div>
    <input type="search" id="buscar" placeholder="Buscar por nombre, email o curso…" style="margin-bottom:.8rem">
    <div id="lista-al">${(data || []).map((a) => `<div class="alumna" data-q="${esc((a.nombre + ' ' + a.email + ' ' + a.curso).toLowerCase())}"><div class="fila entre"><div><strong>${esc(a.nombre)}</strong> <span class="chico suave">· ${esc(a.email)}</span><br><span class="chico">${esc(a.curso)} · Ref. ${esc(a.referencia)} · ${fecha(a.creado)}</span></div>
      <label class="interruptor"><input type="checkbox" data-acceso="${a.inscripcion_id}" ${a.acceso ? 'checked' : ''}>Acceso</label></div>
      <div class="fila chico">${a.tiene_cuenta ? '<span class="etiqueta verde">Tiene cuenta</span>' : '<span class="etiqueta gris">Sin cuenta aún</span>'}${a.estado === 'pagada' ? '<span class="etiqueta">Matrícula paga</span>' : '<span class="etiqueta ambar">Pago pendiente</span>'}
      <span>${a.entregas} trabajos${a.pendientes ? ` · <b>${a.pendientes} sin corregir</b>` : ''}</span>${a.promedio ? `<span class="etiqueta">Promedio ${a.promedio}</span>` : ''}
      ${a.telefono ? `<a href="https://wa.me/${esc(a.telefono.replace(/\D/g, '').replace(/^0/, '595'))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div></div>`).join('') || '<div class="vacio">Todavía no hay inscripciones.</div>'}</div>`);
  $('#buscar').oninput = (e) => { const q = e.target.value.toLowerCase().trim(); for (const d of $$('.alumna')) d.hidden = q && !d.dataset.q.includes(q); };
  for (const c of $$('[data-acceso]')) c.onchange = async () => {
    const { error } = await sb.rpc('admin_dar_acceso', { p_id: c.dataset.acceso, p_acceso: c.checked });
    if (error) { c.checked = !c.checked; return toast(errorTxt(error), true); } toast(c.checked ? 'Acceso habilitado ✓' : 'Acceso quitado');
  };
}

// ---------- Admin: pagos mensuales y exámenes ----------
async function vistaAdminPagos() {
  const [p, x, ins] = await Promise.all([sb.rpc('admin_pagos_aula', { p_estado: null }), sb.rpc('admin_examenes_aula'),
    sb.from('inscripciones').select('id,cliente_nombre,curso_nombre,variante_id,meses_habilitados,acceso').eq('acceso', true).neq('estado', 'cancelada').order('cliente_nombre')]);
  if (p.error) return pintar(`<div class="vacio">${esc(errorTxt(p.error))}</div>`);
  const pagos = p.data || []; const pend = pagos.filter((r) => r.estado === 'pendiente');
  const fila = (r) => `<div class="alumna" data-pago="${r.id}"><div class="fila entre"><div><strong>${esc(r.nombre)}</strong> <span class="chico suave">· ${esc(r.curso)}</span><br>
      <span class="chico">Mes ${r.mes}${r.monto_gs ? ' · ' + gs(r.monto_gs) : ''} · ${fechaHora(r.creado)}${r.nota ? ' · 💬 ' + esc(r.nota) : ''}</span></div>
      ${r.estado === 'pendiente' ? '<span class="etiqueta ambar">Por confirmar</span>' : r.estado === 'confirmado' ? '<span class="etiqueta verde">Confirmado</span>' : '<span class="etiqueta rojo">Rechazado</span>'}</div>
    <div class="fila chico"><button class="btn btn-borde btn-chico" data-comp="${esc(r.ruta)}">🔍 Ver comprobante</button>
      ${r.estado === 'pendiente' ? `<button class="btn btn-oro btn-chico" data-ok="${r.id}">✅ Pago recibido: abrir mes ${r.mes}</button><button class="btn btn-peligro btn-chico" data-no="${r.id}">No llegó</button>` : ''}
      ${r.telefono ? `<a href="https://wa.me/${esc(r.telefono.replace(/\D/g, '').replace(/^0/, '595'))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div></div>`;
  const EXE = { solicitado: 'Pedido', agendado: 'Agendado', aprobado: 'Aprobado', desaprobado: 'No aprobado' };
  pintar(`<h1>Pagos y exámenes del Aula</h1><p class="suave">Confirmá la transferencia y el mes siguiente se abre al instante para la alumna. Sin confirmar, sigue bloqueado.</p>
    <div class="estadisticas"><div class="dato"><strong>${pend.length}</strong><span>Pagos por confirmar</span></div><div class="dato"><strong>${(x.data || []).filter((e) => e.estado === 'solicitado').length}</strong><span>Exámenes pedidos</span></div></div>
    <div class="dos-columnas"><div><h2>Comprobantes</h2>${pagos.map(fila).join('') || '<div class="vacio">Todavía no hay comprobantes.</div>'}</div>
    <div><h2>Exámenes por videollamada</h2>${(x.data || []).map((e) => `<div class="alumna" data-ex="${e.id}"><div class="fila entre"><div><strong>${esc(e.nombre || e.email)}</strong> <span class="chico suave">· ${esc(e.curso || '')} · mes ${e.mes}</span><br>
        <span class="chico">${e.preferencia ? 'Prefiere: ' + esc(e.preferencia) : ''}${e.fecha ? ' · <b>' + fechaHora(e.fecha) + '</b>' : ''}</span></div><span class="etiqueta">${EXE[e.estado] || esc(e.estado)}</span></div>
        <div class="fila chico"><input type="datetime-local" data-fecha style="max-width:14rem"><button class="btn btn-borde btn-chico" data-ex-agendar>Agendar</button>
        <button class="btn btn-oro btn-chico" data-ex-estado="aprobado">Aprobado</button><button class="btn btn-borde btn-chico" data-ex-estado="desaprobado">No aprobado</button>
        ${e.telefono ? `<a href="https://wa.me/${esc(e.telefono.replace(/\D/g, '').replace(/^0/, '595'))}?text=${encodeURIComponent(`Hola ${e.nombre?.split(' ')[0] || ''}, soy Tania. Te escribo por tu examen por videollamada de ${e.curso || 'tu curso'}.`)}" target="_blank" rel="noopener">${ic('video')} WhatsApp</a>` : ''}</div></div>`).join('') || '<div class="vacio">No hay exámenes pedidos.</div>'}
      <h2>Meses habilitados por alumna</h2><p class="chico suave">Para pagos en efectivo o correcciones podés cambiar el número a mano.</p>
      ${(ins.data || []).map((i) => `<div class="fila entre alumna"><span><strong>${esc(i.cliente_nombre)}</strong><br><span class="chico suave">${esc(i.curso_nombre)}</span></span>
        <label class="chico">Hasta el mes <input type="number" min="1" max="36" value="${i.meses_habilitados || 1}" data-meses="${i.id}" style="width:4.5rem"></label></div>`).join('')}</div></div>`);
  for (const b of $$('[data-comp]')) b.onclick = async () => {
    const u = await urlFirmada('pagos-aula', b.dataset.comp); if (!u) return toast('No se pudo abrir.', true);
    if (/\.pdf$/.test(b.dataset.comp)) return window.open(u, '_blank', 'noopener'); visor(`<img src="${u}" alt="Comprobante">`);
  };
  const revisar = async (id, ok) => {
    const resp = ok ? null : prompt('¿Qué le decimos? (por ejemplo: "No me llegó la transferencia, revisá el comprobante")', 'No pudimos confirmar la transferencia. Revisá el comprobante y volvé a enviarlo.');
    if (!ok && resp === null) return;
    const { error } = await sb.rpc('admin_revisar_pago_aula', { p_id: id, p_ok: ok, p_respuesta: resp }); if (error) return toast(errorTxt(error), true);
    toast(ok ? 'Pago confirmado: el mes ya está abierto ✓' : 'Comprobante rechazado'); await contarPendientes(); navegacion(); marcarNav(); vistaAdminPagos();
  };
  for (const b of $$('[data-ok]')) b.onclick = () => revisar(b.dataset.ok, true);
  for (const b of $$('[data-no]')) b.onclick = () => revisar(b.dataset.no, false);
  for (const d of $$('[data-ex]')) {
    const enviar = async (estado, fecha) => { const { error } = await sb.rpc('admin_examen', { p_id: d.dataset.ex, p_estado: estado, p_fecha: fecha, p_nota: null }); if (error) return toast(errorTxt(error), true); toast('Examen actualizado ✓'); vistaAdminPagos(); };
    d.querySelector('[data-ex-agendar]').onclick = () => { const v = d.querySelector('[data-fecha]').value; if (!v) return toast('Elegí día y hora.', true); enviar('agendado', new Date(v + ':00-03:00').toISOString()); };
    for (const b of $$('[data-ex-estado]', d)) b.onclick = () => enviar(b.dataset.exEstado, null);
  }
  for (const c of $$('[data-meses]')) c.onchange = async () => {
    const { error } = await sb.rpc('admin_meses_aula', { p_inscripcion: c.dataset.meses, p_meses: +c.value }); if (error) return toast(errorTxt(error), true); toast(`Habilitado hasta el mes ${c.value} ✓`);
  };
}

// =====================================================================
// PROGRESIÓN POR MÉRITO (v3: supabase/migracion-aula-merito-2026-11-02.sql)
// =====================================================================
const CRITERIOS_DEF = ['Prolijidad', 'Difuminado', 'Piel', 'Cejas', 'Ojos'];
const criteriosDe = (curso) => E.config.find((c) => c.servicio_id === curso)?.criterios || CRITERIOS_DEF;
const FLAG_TXT = { fotos_separadas: (v) => `Fotos tomadas con ${v} h de diferencia`, fotos_viejas: () => 'Fotos tomadas hace más de 6 h', otro_dispositivo: () => 'Desde un dispositivo distinto al habitual', varios_dispositivos: () => 'Fotos de dispositivos distintos' };
const flagsHtml = (f) => Object.entries(f || {}).map(([k, v]) => `<span class="alerta-foto">⚠️ ${esc(FLAG_TXT[k] ? FLAG_TXT[k](v) : k)}</span>`).join('');
const rubricaHtml = (r) => r && Object.keys(r).length ? `<div class="rubrica">${Object.entries(r).map(([k, v]) => `<span>${esc(k)}</span><span class="estrellas">${estrellas(+v)} <b>${v}</b></span>`).join('')}</div>` : '';
const EXAMEN_TXT = { solicitado: 'pedido', agendado: 'agendado', en_curso: 'en curso', entregado: 'en corrección', aprobado: 'aprobado ✓', desaprobado: 'no aprobado' };
function textoProgreso(m) {
  const ex = m.examen_estado ? `examen ${EXAMEN_TXT[m.examen_estado] || m.examen_estado}` : m.completo ? 'examen pendiente' : 'examen al completar las clases';
  return `${m.aprobadas} de ${m.clases} clases aprobadas · ${ex}`;
}

async function vistaCursoMerito(id, pestana = 'clases') {
  const s = servicio(id);
  const [{ data: lecciones }, pr, qr] = await Promise.all([
    sb.from('lecciones').select('*').eq('servicio_id', id).eq('activo', true).order('mes').order('orden').order('creado'),
    sb.rpc('aula_progreso', { p_curso: id }), sb.from('aula_quiz_resultados').select('leccion_id,correctas,total')]);
  const sem = await sb.rpc('aula_semanas', { p_curso: id }); const semanas = sem.error ? [] : (sem.data || []);
  const prog = pr.data || []; const av = avanceDe(id); const hab = av?.meses_habilitados || 1;
  const quiz = new Set((qr.data || []).map((r) => r.leccion_id));
  const ent = E.entregas.filter((e) => e.servicio_id === id);
  const estadoClase = (l) => { const es = ent.filter((e) => e.leccion_id === l.id);
    if (es.some((e) => e.estado === 'corregida')) return ['verde', 'Aprobada'];
    if (es.some((e) => e.estado === 'enviada')) return ['gris', 'En corrección'];
    if (es.length) return ['rojo', es[0].estado === 'anulada_ia' ? 'Anulada (IA)' : 'Rehacer'];
    return ['ambar', 'Pendiente']; };
  const clase = (l) => {
    const img = l.tipo === 'archivo' && /\.(jpg|png|webp)$/.test(l.archivo);
    const icono = img ? `<img data-bucket="cursos" data-ruta="${esc(l.archivo)}" alt="">` : ic(l.tipo === 'archivo' ? 'pdf' : TIPO_IC[l.tipo]);
    const [c, t] = estadoClase(l);
    return `<div class="clase-fila"><button class="clase" data-leccion="${l.id}"><span class="clase-ic">${icono}</span><span><strong>${esc(l.titulo)}</strong><small>${esc(l.modulo || '')}${l.requiere_entrega === false ? ' · teoría' : ''}</small></span><span class="flecha">›</span></button>
      ${l.requiere_entrega !== false ? `<div class="fila chico" style="margin:.2rem 0 .6rem 3.2rem"><span class="etiqueta ${c}">${t}</span>${t === 'Aprobada' || t === 'En corrección' ? '' : `<a class="btn btn-oro btn-chico" href="#/clase/${l.id}">${quiz.has(l.id) ? 'Entregar práctica' : 'Cuestionario + práctica'}</a>`}</div>` : ''}</div>`;
  };
  const pendPago = E.pagos.find((p) => p.inscripcion_id === av?.inscripcion_id && p.estado === 'pendiente');
  const tabClases = prog.map((m) => {
    const pct = m.clases ? Math.round(m.aprobadas / m.clases * 100) : 100;
    const cab = `<h3><span class="modulo-num">${m.abierto ? m.mes : '🔒'}</span>Mes ${m.mes}</h3>
      <div class="barra-mes" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <p class="chico" style="margin:.1rem 0 .5rem">${textoProgreso(m)}${m.plazo ? ` · plazo: <b>${fecha(m.plazo + 'T12:00:00')}</b>` : ''}</p>`;
    if (!m.abierto) {
      const sig = m.mes === hab + 1;
      return `<section class="modulo bloqueado">${cab}<p class="chico">${sig ? `Se abre cuando: ✔ aprobás todas las clases del mes ${hab}, ✔ aprobás el examen del mes ${hab} por videollamada y ✔ la profe confirma el pago del mes ${m.mes}.` : 'Se habilita después del mes anterior.'}</p>
        ${sig ? (m.pago_estado === 'confirmado' ? '<span class="etiqueta verde">Pago confirmado</span>' : pendPago ? '<span class="etiqueta ambar">Comprobante en revisión</span>' : av ? `<a class="btn btn-borde btn-chico" href="#/pagar/${esc(av.inscripcion_id)}">Pagar el mes ${m.mes}</a>` : '') : ''}</section>`;
    }
    const ls = (lecciones || []).filter((l) => (l.mes || 1) === m.mes);
    const prox = semanas.filter((w) => w.mes === m.mes && !w.abierta);
    const filas = [...ls.map((l) => ({ semana: l.semana || 0, html: (l.semana ? `<p class="semana-tit chico">Semana ${l.semana}</p>` : '') + clase(l) })),
      ...prox.map((w) => ({ semana: w.semana, html: `<div class="clase-fila semana-bloqueada"><div class="clase" aria-disabled="true"><span class="clase-ic">🔒</span><span><strong>Semana ${w.semana} · ${esc(w.titulo)}</strong><small>Se abre el ${w.abre ? fecha(w.abre + 'T12:00:00') : 'cuando la profe te habilite'}</small></span></div></div>` }))]
      .sort((a, b) => a.semana - b.semana).map((x) => x.html).join('');
    return `<section class="modulo">${cab}${filas || '<p class="chico suave">La profe todavía no subió clases a este mes.</p>'}${prox.length ? '<p class="chico suave">Las clases se liberan una por semana desde que la profe aprobó tu inscripción.</p>' : ''}
      ${m.mes === hab && m.puede_pedir_examen ? `<a class="btn btn-oro btn-chico" href="#/curso/${esc(id)}?examen">Pedir examen del mes ${m.mes}</a>` : ''}</section>`;
  }).join('') || '<div class="vacio"><span class="grande">📚</span>La profe todavía no subió clases a tu nivel.</div>';
  const cert = prog.find((m) => m.certificado)?.certificado;
  const actual = prog.find((m) => m.mes === hab) || {};
  const ex = E.examenes.filter((x) => x.servicio_id === id && x.estado !== 'cancelado');
  const exAct = ex.find((x) => ['solicitado', 'agendado', 'en_curso'].includes(x.estado));
  const tabExamen = `<div class="tarjeta"><h2 style="margin-top:0">${ic('video')} Examen del mes ${hab}</h2>
    <p>El examen se rinde <strong>por videollamada de WhatsApp</strong> con la profe. Durante la llamada la profe te dicta un <strong>código de 4 dígitos</strong> (vale 15 minutos) y con él subís desde acá:</p>
    <ol class="modulos"><li>Foto de tu cara <b>sin maquillaje</b></li><li>Foto a <b>mitad del trabajo</b></li><li>Foto del <b>resultado final</b></li><li>Un <b>video de 30 a 60 segundos</b> aplicando una técnica</li></ol>
    <p class="chico suave">Las tres fotos con el mismo encuadre: el celular apoyado en el mismo lugar. Todo se saca con la cámara del aula en ese momento.</p>
    <p class="chico">Requisitos: ${actual.completo ? '✔' : '✖'} todas las clases del mes aprobadas (${actual.aprobadas ?? 0} de ${actual.clases ?? 0}) · intentos usados ${actual.intentos ?? 0} de ${actual.max_intentos ?? 3}</p>
    ${ex.map((x) => `<div class="paso-examen ${x.estado === 'aprobado' ? 'hecho' : ''}"><strong>Mes ${x.mes} · intento ${x.intento || 1}</strong> — ${EXAMEN_TXT[x.estado] || esc(x.estado)}${x.fecha ? ' · ' + fechaHora(x.fecha) : ''}
      ${rubricaHtml(x.rubrica)}${x.nota_profe ? `<div class="comentario"><b>Comentario de la profe</b>${esc(x.nota_profe)}</div>` : ''}</div>`).join('')}
    ${actual.puede_pedir_examen ? `<form id="f-examen" novalidate><label for="x-pref">¿Qué días y horarios te quedan bien para la videollamada?</label><input id="x-pref" maxlength="300" placeholder="Ej: martes o jueves de tarde">
      <button class="btn btn-oro" style="margin-top:.6rem">Pedir examen del mes ${hab}</button></form>` : ''}
    ${exAct ? `<div class="paso-examen"><strong>¿Ya estás en la videollamada?</strong><p class="chico">Escribí el código que te dicta la profe.</p>
      <div class="fila"><input id="x-codigo" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="0000" style="max-width:8rem;font-size:1.4rem;letter-spacing:.3em;text-align:center">
      <button class="btn btn-oro" id="x-entrar" data-examen="${exAct.id}">Empezar a subir</button></div></div>` : ''}
    <div class="fila" style="margin-top:.8rem"><a class="btn btn-borde" target="_blank" rel="noopener" href="${esc(waUrl(`Hola profe Tania, soy ${E.perfil?.nombre || ''}, alumna online de ${s.nombre}. Quiero coordinar mi examen del mes ${hab} por videollamada.`))}">${ic('video')} Coordinar por WhatsApp</a></div></div>
    ${cert ? `<div class="tarjeta"><h2>🎓 ¡Curso aprobado!</h2><p>Tu certificado tiene el código <strong>${esc(cert)}</strong>.</p><a class="btn btn-oro" href="#/certificado/${esc(id)}">Ver e imprimir certificado</a></div>` : ''}`;
  const tabTrabajos = (ent.length ? ent.map((e) => tarjetaEntrega(e)).join('') : '<div class="vacio"><span class="grande">📷</span>Todavía no entregaste trabajos en este curso.</div>');
  const tabs = [['clases', 'libro', 'Clases'], ['trabajos', 'camara', `Mis trabajos (${ent.length})`], ['examen', 'video', 'Examen']];
  pintar(`<a class="volver" href="#/">‹ Mi sala</a>
    <div class="cabeza-curso" style="background-image:url('${portada(id, 1440)}')"><span class="etiqueta" style="align-self:flex-start">Mes ${hab}${actual.clases != null ? ' · ' + esc(textoProgreso(actual)) : ''}</span><h1>${esc(s.extra?.tituloDetalle || s.nombre)}</h1><p style="margin:0;opacity:.9">${esc(av?.curso_nombre || '')}</p></div>
    ${AVISO_IA}
    <div class="subpestanas" role="tablist">${tabs.map(([t, i, n]) => `<button role="tab" data-tab="${t}" aria-selected="${pestana === t}">${ic(i)} ${n}</button>`).join('')}</div>
    <div id="tab-clases" data-panel ${pestana === 'clases' ? '' : 'hidden'}>${tabClases}</div><div id="tab-trabajos" data-panel ${pestana === 'trabajos' ? '' : 'hidden'}>${tabTrabajos}</div>
    <div id="tab-examen" data-panel ${pestana === 'examen' ? '' : 'hidden'}>${tabExamen}</div>`);
  for (const b of $$('[data-tab]')) b.onclick = () => { for (const x of $$('[data-tab]')) x.setAttribute('aria-selected', x === b); for (const p of $$('[data-panel]')) p.hidden = p.id !== 'tab-' + b.dataset.tab; };
  for (const b of $$('[data-leccion]')) b.onclick = () => abrirLeccion((lecciones || []).find((l) => l.id === b.dataset.leccion));
  $('#f-examen')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
    const { error } = await sb.rpc('aula_pedir_examen', { p_curso: id, p_preferencia: $('#x-pref').value.trim() });
    if (error) { btn.disabled = false; return toast(errorTxt(error), true); }
    await cargarAlumna(); toast('¡Listo! La profe te va a escribir para agendar la videollamada.'); vistaCursoMerito(id, 'examen');
  });
  $('#x-entrar')?.addEventListener('click', async (e) => {
    const cod = $('#x-codigo').value.trim(); if (!/^\d{4}$/.test(cod)) return toast('El código tiene 4 números.', true);
    const { data, error } = await sb.rpc('aula_examen_validar', { p_id: e.target.dataset.examen, p_codigo: cod });
    if (error) return toast(errorTxt(error), true); if (!data.ok) return toast('Código incorrecto. Pedile a la profe que te lo repita.', true);
    vistaExamenSubir(id, e.target.dataset.examen, cod, data);
  });
  hidratarFotos();
}

// Examen: 3 fotos con el mismo encuadre + video corto, todo con la cámara en vivo y con el código vigente
function vistaExamenSubir(curso, examenId, codigo, info) {
  const pasos = [['sin', 'Cara SIN maquillaje'], ['mitad', 'MITAD del trabajo'], ['final', 'RESULTADO FINAL']];
  const fotos = {}; let video = null; const vence = new Date(info.vence);
  const sello = `${E.perfil?.nombre || E.user.email} · Examen`;
  const pintarPasos = () => {
    pintar(`<a class="volver" href="#/curso/${esc(curso)}?examen">‹ Volver</a><h1>Examen por videollamada</h1>
      <p class="suave">El código vence a las <strong>${vence.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })}</strong>. Sacá todo ahora, con el celular apoyado siempre en el mismo lugar.</p>${AVISO_IA}
      ${pasos.map(([k, t], i) => `<div class="paso-examen ${fotos[k] ? 'hecho' : ''}"><strong>${i + 1}. ${t}</strong>
        ${fotos[k] ? `<div class="tomadas"><div class="tomada"><img src="${fotos[k].url}" alt=""></div></div>` : ''}
        <button type="button" class="btn ${fotos[k] ? 'btn-borde' : 'btn-oro'} btn-chico" data-foto="${k}" ${i && !fotos[pasos[i - 1][0]] ? 'disabled' : ''}>${ic('camara')} ${fotos[k] ? 'Repetir' : 'Sacar foto'}</button></div>`).join('')}
      <div class="paso-examen ${video ? 'hecho' : ''}"><strong>4. Video de 30 a 60 segundos aplicando una técnica${info.video_requerido ? '' : ' (opcional)'}</strong>
        ${video ? `<p class="chico">✔ ${video.segundos} s grabados (${(video.blob.size / 1048576).toFixed(1)} MB)</p>` : ''}
        <button type="button" class="btn ${video ? 'btn-borde' : 'btn-oro'} btn-chico" id="x-video">${ic('video')} ${video ? 'Grabar de nuevo' : 'Grabar video'}</button></div>
      <p class="error" id="x-error"></p><button class="btn btn-oro btn-ancho" id="x-enviar">Enviar examen a la profe</button>`);
    for (const b of $$('[data-foto]')) b.onclick = async () => {
      const k = b.dataset.foto; const t = pasos.find((p) => p[0] === k)[1];
      try { const r = await tomarFotos({ max: 1, sello, titulo: t, fantasma: k === 'sin' ? null : fotos.sin?.url });
        if (r[0]) fotos[k] = { blob: r[0], url: URL.createObjectURL(r[0]) }; pintarPasos(); }
      catch (x) { toast(x.message === 'PERMISO_CAMARA' ? 'Permití el acceso a la cámara.' : 'No pudimos abrir la cámara en vivo. Usá Chrome o Safari actualizado.', true); }
    };
    $('#x-video').onclick = async () => {
      try { const r = await grabarVideo({ min: 30, max: 60, titulo: 'Aplicá una técnica (30–60 s)' }); if (r) { if (r.blob.size > 15728640) return toast('El video pesa demasiado. Grabalo más corto.', true); video = r; } pintarPasos(); }
      catch (x) { toast('Este navegador no permite grabar video. Usá Chrome o Safari actualizado.', true); }
    };
    $('#x-enviar').onclick = async () => {
      const err = $('#x-error'); err.textContent = '';
      if (!pasos.every(([k]) => fotos[k])) return (err.textContent = 'Faltan fotos: se necesitan las tres.');
      if (info.video_requerido && !video) return (err.textContent = 'Falta el video de la técnica.');
      if (Date.now() > vence.getTime()) return (err.textContent = 'El código venció. Pedile a la profe uno nuevo.');
      const btn = $('#x-enviar'); btn.disabled = true;
      try {
        const base = `${E.user.id}/${examenId}/`; const rutas = [];
        for (const [i, [k]] of pasos.entries()) { btn.textContent = `Subiendo foto ${i + 1} de 3…`; const r = base + crypto.randomUUID() + '.jpg';
          const up = await sb.storage.from('examenes').upload(r, fotos[k].blob, { contentType: 'image/jpeg', upsert: false }); if (up.error) throw up.error; rutas.push(r); }
        let rv = null;
        if (video) { btn.textContent = 'Subiendo video…'; const ext = /mp4/.test(video.tipo) ? 'mp4' : 'webm'; rv = base + crypto.randomUUID() + '.' + ext;
          const up = await sb.storage.from('examenes').upload(rv, video.blob, { contentType: ext === 'mp4' ? 'video/mp4' : 'video/webm', upsert: false }); if (up.error) throw up.error; }
        btn.textContent = 'Enviando…';
        const captura = { origen: 'camara-en-vivo', dispositivo: await huellaDispositivo(), agente: navigator.userAgent.slice(0, 200),
          fotos: pasos.map(([k]) => fotos[k].blob.meta || null), video: video?.meta || null };
        const { error } = await sb.rpc('aula_examen_subir', { p_id: examenId, p_codigo: codigo, p_fotos: rutas, p_video: rv, p_captura: captura }); if (error) throw error;
        await cargarAlumna(); toast('¡Examen enviado! La profe lo corrige y te avisa.'); location.hash = `#/curso/${curso}?examen`;
      } catch (x) { err.textContent = errorTxt(x); btn.disabled = false; btn.textContent = 'Enviar examen a la profe'; }
    };
  };
  pintarPasos();
}

// Clase práctica: primero el mini cuestionario, después la entrega con cámara
async function vistaClase(lid) {
  const { data: l } = await sb.from('lecciones').select('*').eq('id', lid).maybeSingle();
  if (!l) { pintar('<div class="vacio"><span class="grande">🔒</span>Esta clase no está disponible.</div>'); return; }
  const { data: hecho } = await sb.from('aula_quiz_resultados').select('correctas,total').eq('leccion_id', lid).order('creado', { ascending: false }).limit(1);
  const { data: qs, error } = await sb.rpc('aula_quiz', { p_leccion: lid }); if (error) return pintar(`<div class="vacio">${esc(errorTxt(error))}</div>`);
  const ir = () => { location.hash = `#/entregar/${l.servicio_id}?leccion=${lid}`; };
  if (!(qs || []).length || (hecho || []).length) return ir();
  pintar(`<a class="volver" href="#/curso/${esc(l.servicio_id)}">‹ Volver</a><h1>${esc(l.titulo)}</h1><p class="suave">Antes de la práctica respondé estas ${qs.length} preguntas cortas de teoría.</p>${AVISO_IA}
    <form id="f-quiz" class="tarjeta" novalidate>${qs.map((q, i) => `<fieldset class="paso-examen" style="border-style:solid"><legend><strong>${i + 1}. ${esc(q.pregunta)}</strong>${q.tema ? ` <span class="chico suave">· ${esc(q.tema)}</span>` : ''}</legend>
      ${q.opciones.map((o, j) => `<label class="fila" style="gap:.5rem;font-weight:500"><input type="radio" name="q${i}" value="${j}" data-q="${q.id}" required> ${esc(o)}</label>`).join('')}</fieldset>`).join('')}
      <p class="error" id="q-error"></p><button class="btn btn-oro btn-ancho">Enviar respuestas</button></form>`);
  $('#f-quiz').onsubmit = async (e) => {
    e.preventDefault(); const resp = {}; for (const r of $$('#f-quiz input:checked')) resp[r.dataset.q] = +r.value;
    if (Object.keys(resp).length < qs.length) return ($('#q-error').textContent = 'Respondé todas las preguntas.');
    const { data, error: e2 } = await sb.rpc('aula_responder_quiz', { p_leccion: lid, p_respuestas: resp }); if (e2) return toast(errorTxt(e2), true);
    const det = new Map((data.detalle || []).map((d) => [d.id, d]));
    pintar(`<a class="volver" href="#/curso/${esc(l.servicio_id)}">‹ Volver</a><h1>Resultado: ${data.correctas} de ${data.total}</h1>
      <div class="tarjeta">${qs.map((q, i) => { const d = det.get(q.id); return `<p><strong>${i + 1}. ${esc(q.pregunta)}</strong><br>${d?.bien ? '✅ Bien' : `❌ Respuesta correcta: <b>${esc(q.opciones[d?.correcta] ?? '')}</b>`}</p>`; }).join('')}</div>
      <button class="btn btn-oro btn-ancho" id="q-seguir">${ic('camara')} Seguir con la práctica</button>`);
    $('#q-seguir').onclick = ir;
  };
}

function vistaPortafolio() {
  const mios = E.entregas.filter((e) => e.portafolio);
  pintar(`<a class="volver" href="#/notas">‹ Mis notas</a><h1>Mi portafolio</h1><p class="suave">Tus mejores trabajos aprobados. Es privado: solo lo ven vos y la profe. Elegí cuáles mostrar desde "Mis notas".</p>
    ${mios.length ? `<div class="grilla" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${mios.map((e) => tarjetaEntrega(e, true)).join('')}</div>` : '<div class="vacio"><span class="grande">🖼️</span>Todavía no elegiste trabajos para tu portafolio.</div>'}`);
  hidratarFotos();
}

async function vistaCertificado(curso) {
  const { data } = await sb.from('aula_certificados').select('*').order('creado', { ascending: false });
  const c = (data || []).find((x) => E.avance.some((a) => a.inscripcion_id === x.inscripcion_id && a.servicio_id === curso)) || (data || [])[0];
  if (!c) { pintar('<div class="vacio">Todavía no tenés certificado.</div>'); return; }
  const url = new URL(`../verificar/?codigo=${encodeURIComponent(c.codigo)}`, location.href).href;
  pintar(`<a class="volver no-imprimir" href="#/curso/${esc(curso)}?examen">‹ Volver</a>
    <div class="cert"><img src="../img/logo-192.webp" width="80" alt=""><p class="eyebrow">Tania Sanabria Makeup Academy</p><h1>Certificado</h1>
      <p>Se certifica que</p><h2 style="font-size:2rem;margin:.2rem 0">${esc(c.nombre)}</h2><p>aprobó el curso</p><h3>${esc(c.curso)}</h3>
      <p>el ${new Date(c.fecha + 'T12:00:00').toLocaleDateString('es-PY', { day: 'numeric', month: 'long', year: 'numeric' })}.</p>
      <p class="chico">Código de verificación: <strong>${esc(c.codigo)}</strong><br>${esc(url)}</p><p style="margin-top:2rem">______________________<br>Tania Sanabria</p></div>
    <div class="fila no-imprimir" style="margin-top:1rem"><button class="btn btn-oro" onclick="print()">Imprimir / guardar PDF</button><a class="btn btn-borde" href="${esc(url)}" target="_blank" rel="noopener">Ver página de verificación</a></div>`);
}

// ---------- Admin: exámenes (código, fotos, video, rúbrica) ----------
async function vistaAdminExamenes() {
  const [{ data, error }, gq] = await Promise.all([sb.rpc('admin_examenes_aula2'), sb.from('aula_examen_guia').select('*').order('orden')]);
  if (error) return pintar(`<div class="vacio">${esc(errorTxt(error))}</div>`);
  const guia = gq.error ? [] : (gq.data || []);
  const guiaDe = (cur, mes, v) => guia.filter((g) => g.servicio_id === cur && g.mes === mes && (!v || !g.variante_id || g.variante_id === v));
  const guiaHtml = (gs, abierta) => gs.length ? `<details class="guia-oral"${abierta ? ' open' : ''}><summary>🗣️ Preguntas orales para la videollamada (${gs.length})</summary><ol>${gs.map((g) => `<li><strong>${esc(g.pregunta)}</strong>${g.puntos_clave ? `<br><span class="chico suave">Puntos clave: ${esc(g.puntos_clave)}</span>` : ''}</li>`).join('')}</ol></details>` : '';
  const fila = (x) => {
    const crit = criteriosDe(x.servicio_id); const abierto = ['solicitado', 'agendado', 'en_curso'].includes(x.estado);
    return `<article class="entrega" data-ex="${x.id}" data-curso="${esc(x.servicio_id)}"><div class="entrega-cab"><div><h3>${esc(x.nombre || x.email)}</h3>
      <span class="chico">${esc(x.curso || '')} · mes ${x.mes} · intento ${x.intento || 1}</span><br><span class="chico suave">${x.preferencia ? 'Prefiere: ' + esc(x.preferencia) + ' · ' : ''}${x.fecha ? 'Agendado ' + fechaHora(x.fecha) : ''}</span></div>
      <span class="etiqueta ${x.estado === 'entregado' ? 'ambar' : x.estado === 'aprobado' ? 'verde' : x.estado === 'desaprobado' ? 'rojo' : ''}">${EXAMEN_TXT[x.estado] || esc(x.estado)}</span></div>
      ${guiaHtml(guiaDe(x.servicio_id, x.mes, x.variante_id), abierto)}
      ${abierto ? `<div class="fila chico"><input type="datetime-local" data-fecha style="max-width:14rem"><button class="btn btn-borde btn-chico" data-agendar>Agendar</button>
        ${x.telefono ? `<a href="https://wa.me/${esc(x.telefono.replace(/\D/g, '').replace(/^0/, '595'))}?text=${encodeURIComponent(`Hola ${(x.nombre || '').split(' ')[0]}, soy Tania. Te escribo por tu examen por videollamada.`)}" target="_blank" rel="noopener">${ic('video')} WhatsApp</a>` : ''}</div>
        <button class="btn btn-oro" data-codigo>🔑 Empezó la videollamada: generar código</button><div data-cod-caja>${x.codigo_vence && new Date(x.codigo_vence) > new Date() ? `<p class="chico">Hay un código vigente hasta ${fechaHora(x.codigo_vence)}. Generá otro si lo necesitás.</p>` : ''}</div>` : ''}
      ${x.fotos ? `<div class="fotos">${x.fotos.map((f, i) => `<button data-ver-ex="${esc(f)}" title="${['Sin maquillaje', 'Mitad', 'Final'][i]}"><img data-bucket="examenes" data-ruta="${esc(f)}" alt=""></button>`).join('')}</div>
        <p class="chico suave">1 Sin maquillaje · 2 Mitad · 3 Final${x.entregado_en ? ' · enviado ' + fechaHora(x.entregado_en) : ''}</p>${flagsHtml(x.flags)}
        ${x.video ? `<video data-video="${esc(x.video)}" controls playsinline preload="none" style="width:100%;max-height:320px;border-radius:12px;background:#000"></video>` : '<p class="chico">Sin video.</p>'}` : ''}
      ${x.estado === 'entregado' || x.estado === 'aprobado' || x.estado === 'desaprobado' ? `<div class="rubrica">${crit.map((c) => `<span>${esc(c)}</span><span class="escala" data-crit="${esc(c)}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-pressed="${(x.rubrica || {})[c] == n}">${n}</button>`).join('')}</span>`).join('')}</div>
        <textarea data-com maxlength="1000" placeholder="Comentario para la alumna">${esc(x.nota_profe || '')}</textarea>
        <div class="fila"><button class="btn btn-oro" data-aprobar style="flex:1">✅ Aprobado</button><button class="btn btn-peligro" data-desaprobar>No aprobado</button></div>` : ''}</article>`;
  };
  pintar(`<h1>Exámenes por videollamada</h1><p class="suave">Cuando empiece la videollamada generá el código (vale 15 minutos) y dictáselo: con él la alumna sube las 3 fotos y el video desde el aula. Al aprobar, el mes siguiente se abre si el pago ya está confirmado.</p>
    <div class="grilla" style="grid-template-columns:repeat(auto-fill,minmax(380px,1fr))">${(data || []).map(fila).join('') || '<div class="vacio">No hay exámenes.</div>'}</div>
    ${guia.length ? `<h2 id="guia-oral">Guía de preguntas orales (solo la ves vos)</h2>${[...new Set(guia.map((g) => g.servicio_id + '|' + (g.variante_id || '') + '|' + g.mes))].map((k) => { const [c, v, m] = k.split('|');
      return `<div class="tarjeta" style="margin-bottom:.6rem"><h3 style="margin:0">${esc(servicio(c)?.nombre || c)}${v ? ' · ' + esc(servicio(c)?.extra?.variantes?.find((x) => x.id === v)?.etiqueta || v) : ''} · Mes ${m}</h3>${guiaHtml(guia.filter((g) => g.servicio_id === c && (g.variante_id || '') === v && g.mes === +m), false)}</div>`; }).join('')}` : ''}`);
  for (const v of $$('video[data-video]')) urlFirmada('examenes', v.dataset.video).then((u) => { if (u) v.src = u; });
  for (const b of $$('[data-ver-ex]')) b.onclick = async () => { const u = await urlFirmada('examenes', b.dataset.verEx); if (u) visor(`<img src="${u}" alt="">`); };
  for (const art of $$('[data-ex]')) {
    const id = art.dataset.ex; const rub = {};
    for (const g of $$('[data-crit]', art)) { const pre = g.querySelector('[aria-pressed="true"]'); if (pre) rub[g.dataset.crit] = +pre.dataset.n;
      for (const b of $$('[data-n]', g)) b.onclick = () => { rub[g.dataset.crit] = +b.dataset.n; for (const y of $$('[data-n]', g)) y.setAttribute('aria-pressed', y === b); }; }
    art.querySelector('[data-codigo]')?.addEventListener('click', async () => {
      const { data: c, error: e } = await sb.rpc('admin_examen_codigo', { p_id: id }); if (e) return toast(errorTxt(e), true);
      const caja = art.querySelector('[data-cod-caja]'); const fin = new Date(c.vence);
      caja.innerHTML = `<p class="codigo-grande" data-codigo-valor>${esc(c.codigo)}</p><p class="chico" style="text-align:center">Dictáselo a la alumna. Vence en <b data-rest>15:00</b></p>`;
      const t = setInterval(() => { const r = Math.max(0, fin - Date.now()); const el = caja.querySelector('[data-rest]'); if (!el) return clearInterval(t);
        el.textContent = `${Math.floor(r / 60000)}:${String(Math.floor(r / 1000) % 60).padStart(2, '0')}`; if (!r) { clearInterval(t); el.textContent = 'vencido'; } }, 1000);
    });
    art.querySelector('[data-agendar]')?.addEventListener('click', async () => {
      const v = art.querySelector('[data-fecha]').value; if (!v) return toast('Elegí día y hora.', true);
      const { error: e } = await sb.rpc('admin_examen', { p_id: id, p_estado: 'agendado', p_fecha: new Date(v + ':00-03:00').toISOString(), p_nota: null });
      if (e) return toast(errorTxt(e), true); toast('Examen agendado ✓'); vistaAdminExamenes();
    });
    const calificar = async (ok) => {
      const crit = criteriosDe(art.dataset.curso); if (crit.some((c) => !rub[c])) return toast('Completá la rúbrica (1 a 5 en cada criterio).', true);
      const { error: e } = await sb.rpc('admin_examen_calificar', { p_id: id, p_aprobado: ok, p_rubrica: rub, p_comentario: art.querySelector('[data-com]').value });
      if (e) return toast(errorTxt(e), true); toast(ok ? 'Examen aprobado ✓' : 'Examen no aprobado (puede volver a rendir)'); vistaAdminExamenes();
    };
    art.querySelector('[data-aprobar]')?.addEventListener('click', () => calificar(true));
    art.querySelector('[data-desaprobar]')?.addEventListener('click', () => calificar(false));
  }
  hidratarFotos();
}

// ---------- Admin: seguimiento (atrasadas), plazos, configuración y cuestionarios ----------
async function vistaAdminSeguimiento() {
  const { data, error } = await sb.rpc('admin_aula_seguimiento'); if (error) return pintar(`<div class="vacio">${esc(errorTxt(error))}</div>`);
  const atr = (data || []).filter((a) => a.atrasada);
  pintar(`<h1>Seguimiento de alumnas</h1><p class="suave">Mes actual de cada alumna, clases aprobadas, última entrega y plazo. En rojo las que están atrasadas. <a href="#/admin/config">Plazos y configuración →</a></p>
    <div class="estadisticas"><div class="dato"><strong>${(data || []).length}</strong><span>Alumnas activas</span></div><div class="dato"><strong>${atr.length}</strong><span>Atrasadas</span></div><div class="dato"><strong>${(data || []).filter((a) => a.certificado).length}</strong><span>Certificadas</span></div></div>
    ${(data || []).map((a) => `<div class="alumna" ${a.atrasada ? 'style="border-color:#e7b2ab;background:#fdf1ef"' : ''}><div class="fila entre"><div><strong>${esc(a.nombre)}</strong> <span class="chico suave">· ${esc(a.curso)}</span><br>
      <span class="chico">Mes ${a.mes} · ${a.aprobadas} de ${a.clases} clases aprobadas (${a.enviadas} entregadas) · examen ${esc(EXAMEN_TXT[a.examen_estado] || 'sin pedir')}</span><br>
      <span class="chico suave">Última entrega: ${a.ultima_entrega ? fechaHora(a.ultima_entrega) : 'nunca'}${a.plazo ? ' · plazo ' + fecha(a.plazo + 'T12:00:00') : ''}</span></div>
      ${a.atrasada ? '<span class="etiqueta rojo">Atrasada</span>' : a.certificado ? `<span class="etiqueta verde">${esc(a.certificado)}</span>` : ''}</div>
      <div class="fila chico">${a.telefono ? `<a href="https://wa.me/${esc(a.telefono.replace(/\D/g, '').replace(/^0/, '595'))}?text=${encodeURIComponent(`Hola ${a.nombre.split(' ')[0]}, soy Tania. ¿Cómo vas con las clases del mes ${a.mes}? El plazo es ${a.plazo || 'pronto'}.`)}" target="_blank" rel="noopener">Escribirle por WhatsApp</a>` : ''}
      ${a.certificado ? '' : `<button class="btn btn-borde btn-chico" data-cert="${a.inscripcion_id}">Emitir certificado a mano</button>`}</div></div>`).join('') || '<div class="vacio">No hay alumnas con acceso.</div>'}`);
  for (const b of $$('[data-cert]')) b.onclick = async () => { if (!confirm('¿Emitir el certificado aunque no haya aprobado todo por el aula?')) return;
    const { data: c, error: e } = await sb.rpc('admin_emitir_certificado', { p_insc: b.dataset.cert }); if (e) return toast(errorTxt(e), true); toast('Certificado ' + c + ' ✓'); vistaAdminSeguimiento(); };
}

async function vistaAdminConfig() {
  const cur = sessionStorage.getItem('aula-curso-cfg') || E.servicios[0]?.id; const s = servicio(cur);
  const [cf, pl, pq, ls] = await Promise.all([sb.from('aula_config_curso').select('*').eq('servicio_id', cur).maybeSingle(), sb.from('aula_plazos').select('*').eq('servicio_id', cur).order('mes'),
    sb.from('aula_preguntas').select('*').or(`servicio_id.eq.${cur},servicio_id.is.null`).order('creado'), sb.from('lecciones').select('id,titulo,mes,requiere_entrega').eq('servicio_id', cur).order('mes').order('orden')]);
  const c = cf.data || { max_intentos: 3, criterios: CRITERIOS_DEF, video_requerido: true, meses_total: null };
  const meses = Math.max(c.meses_total || 0, ...(ls.data || []).map((l) => l.mes || 1), 1);
  const plazo = (m) => (pl.data || []).find((p) => p.mes === m)?.vence || '';
  pintar(`<h1>Configuración del curso</h1><div class="filtros"><select id="c-curso">${E.servicios.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select></div>
    <div class="dos-columnas"><div>
    <form id="f-cfg" class="tarjeta"><h2>Examen y rúbrica</h2>
      <label>Intentos de examen por mes</label><input name="max" type="number" min="1" max="10" value="${c.max_intentos}">
      <label>Criterios de la rúbrica (separados por coma)</label><input name="crit" value="${esc((c.criterios || CRITERIOS_DEF).join(', '))}">
      <label>Meses del curso (vacío = según las clases cargadas)</label><input name="meses" type="number" min="1" max="36" value="${c.meses_total || ''}">
      <label class="interruptor"><input type="checkbox" name="video" ${c.video_requerido ? 'checked' : ''}> Video de 30–60 s obligatorio en el examen</label>
      <button class="btn btn-oro" style="margin-top:.6rem">Guardar</button></form>
    <form id="f-plazos" class="tarjeta"><h2>Plazo de cada mes</h2>${Array.from({ length: meses }, (_, i) => i + 1).map((m) => `<label>Mes ${m}</label><input type="date" data-plazo="${m}" value="${plazo(m)}">`).join('')}
      <button class="btn btn-oro" style="margin-top:.6rem">Guardar plazos</button></form>
    <div class="tarjeta"><h2>Clases que piden entrega</h2><p class="chico suave">Las clases de teoría (solo PDF) no cuentan para aprobar el mes.</p>
      ${(ls.data || []).map((l) => `<label class="interruptor"><input type="checkbox" data-req="${l.id}" ${l.requiere_entrega !== false ? 'checked' : ''}> Mes ${l.mes || 1} · ${esc(l.titulo)}</label>`).join('') || '<p class="chico">Sin clases.</p>'}</div>
    </div><div class="tarjeta"><h2>Preguntas del cuestionario</h2><p class="chico suave">Antes de cada práctica la alumna responde 4 preguntas: primero las de esa clase, después las del curso, después las generales.</p>
      ${(pq.data || []).map((q) => `<div class="alumna"><strong>${esc(q.pregunta)}</strong><br><span class="chico">${q.opciones.map((o, j) => j === q.correcta ? `<b>✔ ${esc(o)}</b>` : esc(o)).join(' · ')}</span><br>
        <span class="chico suave">${esc(q.tema)} · ${q.leccion_id ? 'clase: ' + esc((ls.data || []).find((l) => l.id === q.leccion_id)?.titulo || '') : q.servicio_id ? 'este curso' : 'todos los cursos'}</span>
        <div class="fila"><button class="btn btn-borde btn-chico" data-qact="${q.id}" data-v="${q.activa}">${q.activa ? 'Desactivar' : 'Activar'}</button><button class="btn btn-peligro btn-chico" data-qdel="${q.id}">✕</button></div></div>`).join('')}
      <form id="f-preg"><h3>Agregar pregunta</h3><label>Pregunta</label><input name="p" maxlength="400" required>
        <label>Opciones (una por línea; marcá la correcta con * al principio)</label><textarea name="o" rows="4" placeholder="*Limpiarlas y desinfectarlas&#10;Guardarlas así"></textarea>
        <label>Tema</label><input name="t" maxlength="80" placeholder="Higiene, Colorimetría…">
        <label>¿Para qué?</label><select name="d"><option value="curso">Este curso</option><option value="todos">Todos los cursos</option>${(ls.data || []).map((l) => `<option value="${l.id}">Clase: ${esc(l.titulo)}</option>`).join('')}</select>
        <p class="error" id="p-err"></p><button class="btn btn-oro" style="margin-top:.6rem">Agregar</button></form></div></div>`);
  $('#c-curso').value = cur; $('#c-curso').onchange = (e) => { sessionStorage.setItem('aula-curso-cfg', e.target.value); vistaAdminConfig(); };
  $('#f-cfg').onsubmit = async (e) => { e.preventDefault(); const f = e.target;
    const crit = f.crit.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10); if (!crit.length) return toast('Poné al menos un criterio.', true);
    const { error: er } = await sb.from('aula_config_curso').upsert({ servicio_id: cur, max_intentos: +f.max.value || 3, criterios: crit, video_requerido: f.video.checked, meses_total: +f.meses.value || null, actualizado: new Date().toISOString() });
    if (er) return toast(errorTxt(er), true); await cargarConfig(); toast('Configuración guardada ✓'); };
  $('#f-plazos').onsubmit = async (e) => { e.preventDefault();
    for (const i of $$('[data-plazo]')) { const m = +i.dataset.plazo;
      const r = i.value ? await sb.from('aula_plazos').upsert({ servicio_id: cur, mes: m, vence: i.value }) : await sb.from('aula_plazos').delete().eq('servicio_id', cur).eq('mes', m);
      if (r.error) return toast(errorTxt(r.error), true); }
    toast('Plazos guardados ✓'); };
  for (const c2 of $$('[data-req]')) c2.onchange = async () => { const { error: er } = await sb.from('lecciones').update({ requiere_entrega: c2.checked }).eq('id', c2.dataset.req); if (er) toast(errorTxt(er), true); };
  for (const b of $$('[data-qact]')) b.onclick = async () => { await sb.from('aula_preguntas').update({ activa: b.dataset.v !== 'true' }).eq('id', b.dataset.qact); vistaAdminConfig(); };
  for (const b of $$('[data-qdel]')) b.onclick = async () => { if (confirm('¿Borrar la pregunta?')) { await sb.from('aula_preguntas').delete().eq('id', b.dataset.qdel); vistaAdminConfig(); } };
  $('#f-preg').onsubmit = async (e) => { e.preventDefault(); const f = e.target; const lineas = f.o.value.split('\n').map((x) => x.trim()).filter(Boolean);
    const cor = lineas.findIndex((x) => x.startsWith('*')); const ops = lineas.map((x) => x.replace(/^\*\s*/, ''));
    if (f.p.value.trim().length < 5) return ($('#p-err').textContent = 'Escribí la pregunta.');
    if (ops.length < 2 || ops.length > 5 || cor < 0) return ($('#p-err').textContent = 'Entre 2 y 5 opciones, y marcá la correcta con *.');
    const d = f.d.value; const fila = { pregunta: f.p.value.trim(), opciones: ops, correcta: cor, tema: f.t.value.trim(), servicio_id: d === 'todos' ? null : cur, leccion_id: d === 'curso' || d === 'todos' ? null : d };
    const { error: er } = await sb.from('aula_preguntas').insert(fila); if (er) return ($('#p-err').textContent = errorTxt(er)); toast('Pregunta agregada ✓'); vistaAdminConfig(); };
}
async function cargarConfig() { const { data, error } = await sb.from('aula_config_curso').select('*'); E.v3 = !error; E.config = data || []; }

// ---------- Router ----------
async function router() {
  if (!E.user) return;
  const [ruta, q] = (location.hash || '#/').slice(1).split('?');
  const p = ruta.split('/').filter(Boolean);
  marcarNav();
  try {
    if (E.admin) {
      if (p[0] === 'perfil') return vistaPerfil();
      if (p[1] === 'materiales') return await vistaAdminMateriales();
      if (p[1] === 'alumnas') return await vistaAdminAlumnas();
      if (p[1] === 'pagos' && E.v2) return await vistaAdminPagos();
      if (p[1] === 'examenes' && E.v3) return await vistaAdminExamenes();
      if (p[1] === 'seguimiento' && E.v3) return await vistaAdminSeguimiento();
      if (p[1] === 'config' && E.v3) return await vistaAdminConfig();
      return await vistaAdminCorregir();
    }
    if (p[0] === 'cursos') return vistaCatalogo();
    if (p[0] === 'curso') { const t = ['trabajos', 'examen'].includes(q) ? q : 'clases'; if (E.v3 && E.misCursos.some((c) => c.servicio_id === p[1])) return await vistaCursoMerito(p[1], t); return await vistaCurso(p[1], t); }
    if (p[0] === 'clase' && E.v3) return await vistaClase(p[1]);
    if (p[0] === 'portafolio') return vistaPortafolio();
    if (p[0] === 'certificado' && E.v3) return await vistaCertificado(p[1]);
    if (p[0] === 'entregar') return vistaEntregar(p[1], q);
    if (p[0] === 'pagar') return await vistaPagar(p[1]);
    if (p[0] === 'notas') return vistaNotas();
    if (p[0] === 'perfil') return vistaPerfil();
    return vistaSala();
  } catch (x) { pintar(`<div class="vacio">${esc(errorTxt(x))}<br><br><button class="btn btn-principal" onclick="location.reload()">Reintentar</button></div>`); }
}

// ---------- Arranque ----------
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__instalar = e; });
$('#visor').addEventListener('click', (e) => { if (e.target.closest('.visor-cerrar') || e.target.id === 'visor-cuerpo') { $('#visor').close(); $('#visor-cuerpo').innerHTML = ''; } });
$('#btn-perfil').onclick = () => { location.hash = '#/perfil'; };
window.addEventListener('hashchange', router);
if ('serviceWorker' in navigator && !LOCAL) navigator.serviceWorker.register('sw.js').catch(() => {});
async function arrancar() {
  if (!window.supabase) { await new Promise((ok) => window.addEventListener('load', ok, { once: true })); }
  sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'aula-virtual-tania' } });
  const { data } = await sb.auth.getSession();
  if (data.session) await iniciarSesion(); else vistaIngreso();
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { E.user = null; vistaIngreso(); } });
}
arrancar().catch((x) => pintar(`<div class="vacio">${esc(errorTxt(x))}</div>`));
