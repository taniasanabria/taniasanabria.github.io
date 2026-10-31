/*
 * Aula Virtual · Tania Sanabria Makeup Academy (PWA: celular y computadora)
 * Alumnas: registro con email, sala de clases, materiales (PDF/fotos/videos), entregas SOLO con cámara,
 *          notas y comentarios de la profesora, catálogo de cursos con precios.
 * Tania (admin): corregir entregas (nota 1–5 + comentario), cargar materiales por curso y módulo, alumnas y accesos.
 * Seguridad: todo pasa por RLS de Supabase (supabase/aula.sql + cursos.sql).
 */
import { SUPABASE } from '../js/config.js';
import { tomarFotos } from './camara.js';

// Vista previa local (solo en localhost apunta a la base de pruebas; en producción usa la real)
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get('base') !== 'real';
const CFG = LOCAL ? { url: `${location.protocol}//${location.hostname}:54321`, anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvY2FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjEwNzgyNTM1OH0.HWC5pvLe-zSXO_aly5bXUlczRRvITVmeSHg3ViR0KCk' } : SUPABASE;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let sb;
const E = { user: null, perfil: null, admin: false, servicios: [], misCursos: [], inscripciones: [], entregas: [], urls: new Map() };

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
    NO_AUTORIZADO: 'No tenés permiso para esto.', 'Invalid login': 'Email o contraseña incorrectos.', 'already registered': 'Ese email ya tiene cuenta. Tocá "Entrar".',
    'Email not confirmed': 'Confirmá tu email: te enviamos un enlace a tu correo.', 'Password should': 'La contraseña debe tener al menos 6 caracteres.', fetch: 'Sin conexión. Revisá internet e intentá de nuevo.' };
  for (const k in T) if (m.includes(k)) return T[k];
  return e?.message || 'Ocurrió un error. Intentá de nuevo.';
}
const nombreCorto = () => (E.perfil?.nombre || E.user?.email || '').split(/[\s@]/)[0];

// ---------- Datos ----------
async function cargarServicios() {
  const { data, error } = await sb.from('servicios').select('id,nombre,descripcion,precio_texto,sena_gs,extra,orden').eq('categoria', 'academia').eq('activo', true).order('orden');
  if (error) throw error; E.servicios = data || [];
}
const servicio = (id) => E.servicios.find((s) => s.id === id);
async function cargarAlumna() {
  const [c, i, e] = await Promise.all([sb.rpc('mis_cursos'), sb.rpc('aula_mis_inscripciones'), sb.from('entregas').select('*').order('creado', { ascending: false })]);
  E.misCursos = c.data || []; E.inscripciones = i.data || []; E.entregas = e.data || [];
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
  const ad = [['#/admin', 'check', 'Corregir', pend], ['#/admin/materiales', 'subir', 'Materiales'], ['#/admin/alumnas', 'alumnas', 'Alumnas'], ['#/perfil', 'usuario', 'Perfil']];
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
  await cargarServicios();
  if (E.admin) { await contarPendientes(); }
  else { await asegurarPerfil(); await cargarAlumna(); }
  navegacion();
  if (!E.admin && !E.perfil) location.hash = '#/perfil';
  else if (E.admin && !location.hash.startsWith('#/admin') && location.hash !== '#/perfil') location.hash = '#/admin';
  router();
}
async function contarPendientes() { const r = await sb.rpc('admin_entregas', { p_curso: null, p_estado: 'enviada' }); E.adminPend = (r.data || []).length; }

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
  const { data: lecciones } = await sb.from('lecciones').select('*').eq('servicio_id', id).eq('activo', true).order('orden').order('creado');
  const ent = E.entregas.filter((e) => e.servicio_id === id);
  const mods = new Map(); for (const l of lecciones || []) { const m = l.modulo || 'General'; if (!mods.has(m)) mods.set(m, []); mods.get(m).push(l); }
  const programa = (s.extra?.detalles || []).map((d) => d.texto);
  const clase = (l) => {
    const img = l.tipo === 'archivo' && /\.(jpg|png|webp)$/.test(l.archivo);
    const icono = img ? `<img data-bucket="cursos" data-ruta="${esc(l.archivo)}" alt="">` : ic(l.tipo === 'archivo' ? 'pdf' : TIPO_IC[l.tipo]);
    const tipo = l.tipo === 'archivo' ? (img ? 'Foto' : 'PDF') : l.tipo === 'video' ? 'Video' : 'Enlace';
    return `<button class="clase" data-leccion="${l.id}"><span class="clase-ic">${icono}</span><span><strong>${esc(l.titulo)}</strong><small>${tipo}${l.descripcion ? ' · ' + esc(l.descripcion.slice(0, 80)) : ''}</small></span><span class="flecha">›</span></button>`;
  };
  const tabClases = mods.size ? [...mods].map(([m, ls], i) => `<section class="modulo"><h3><span class="modulo-num">${i + 1}</span>${esc(m)}</h3>${ls.map(clase).join('')}</section>`).join('')
    : `<div class="vacio"><span class="grande">📚</span>La profe todavía no subió materiales a este curso.<br>Te van a aparecer acá.</div>
       ${programa.length ? `<div class="tarjeta" style="margin-top:1rem"><h3>${esc(s.extra?.detallesTitulo || 'Programa')}</h3><ul class="modulos">${programa.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}`;
  const tabTrabajos = (ent.length ? ent.map((e) => tarjetaEntrega(e)).join('') : '<div class="vacio"><span class="grande">📷</span>Todavía no entregaste trabajos en este curso.</div>');
  pintar(`<a class="volver" href="#/">‹ Mi sala</a>
    <div class="cabeza-curso" style="background-image:url('${portada(id, 1440)}')"><span class="etiqueta" style="align-self:flex-start">${(lecciones || []).length} clases · ${mods.size || programa.length} módulos</span><h1>${esc(s.extra?.tituloDetalle || s.nombre)}</h1><p style="margin:0;opacity:.9">${esc(s.extra?.subtitulo || '')}</p></div>
    <div class="subpestanas" role="tablist"><button role="tab" data-tab="clases" aria-selected="${pestana === 'clases'}">${ic('libro')} Clases</button><button role="tab" data-tab="trabajos" aria-selected="${pestana === 'trabajos'}">${ic('camara')} Mis trabajos (${ent.length})</button></div>
    <div id="tab-clases" ${pestana === 'clases' ? '' : 'hidden'}>${tabClases}</div><div id="tab-trabajos" ${pestana === 'trabajos' ? '' : 'hidden'}>${tabTrabajos}</div>
    <a class="btn btn-oro fab" href="#/entregar/${esc(id)}">${ic('camara')} Entregar trabajo</a>`);
  for (const b of $$('[data-tab]')) b.onclick = () => { for (const x of $$('[data-tab]')) x.setAttribute('aria-selected', x === b); $('#tab-clases').hidden = b.dataset.tab !== 'clases'; $('#tab-trabajos').hidden = b.dataset.tab !== 'trabajos'; };
  for (const b of $$('[data-leccion]')) b.onclick = () => abrirLeccion((lecciones || []).find((l) => l.id === b.dataset.leccion));
  hidratarFotos();
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
  const est = e.estado === 'enviada' ? '<span class="etiqueta gris">Esperando corrección</span>' : e.estado === 'rehacer' ? '<span class="etiqueta rojo">Para rehacer</span>' : '<span class="etiqueta verde">Corregido</span>';
  return `<article class="entrega"><div class="entrega-cab"><div><h3>${esc(e.titulo)}</h3><span class="chico suave">${conCurso && s ? esc(s.nombre) + ' · ' : ''}${e.modulo ? esc(e.modulo) + ' · ' : ''}${fechaHora(e.creado)}</span></div>${est}</div>
    <div class="fotos">${e.fotos.map((f) => `<button data-ver="${esc(f)}"><img data-bucket="entregas" data-ruta="${esc(f)}" alt="Foto del trabajo"></button>`).join('')}</div>
    ${e.mensaje ? `<p class="chico" style="margin:.2rem 0">💬 ${esc(e.mensaje)}</p>` : ''}
    ${e.calificacion ? `<div class="nota"><span class="nota-num">${e.calificacion}</span><div><div class="estrellas">${estrellas(e.calificacion)}</div><strong>${NOTA_TXT[e.calificacion]}</strong></div></div>` : ''}
    ${e.comentario ? `<div class="comentario"><b><img src="../img/retrato-280.webp" alt="">Comentario de la profe Tania</b>${esc(e.comentario).replace(/\n/g, '<br>')}</div>` : ''}</article>`;
}
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-ver]'); if (!b) return;
  const u = await urlFirmada('entregas', b.dataset.ver); if (u) visor(`<img src="${u}" alt="Foto del trabajo">`);
});

// ---------- Alumna: entregar trabajo (solo cámara) ----------
function vistaEntregar(id) {
  const s = servicio(id); if (!E.misCursos.some((c) => c.servicio_id === id)) { location.hash = '#/'; return; }
  const fotos = []; const mods = [...new Set((s.extra?.detalles || []).map((d) => d.texto))];
  pintar(`<a class="volver" href="#/curso/${esc(id)}">‹ ${esc(s.nombre)}</a><h1>Entregar trabajo práctico</h1>
    <div class="tarjeta"><form id="f-entrega" novalidate>
      <div class="paso"><span class="paso-num">1</span><div style="flex:1"><strong>¿Qué trabajo es?</strong>
        <label for="e-titulo">Título</label><input id="e-titulo" name="titulo" required maxlength="160" placeholder="Ej: Smokey eyes – práctica 1">
        ${mods.length ? `<label for="e-modulo">Módulo (opcional)</label><select id="e-modulo" name="modulo"><option value="">—</option>${mods.map((m) => `<option>${esc(m)}</option>`).join('')}</select>` : ''}</div></div>
      <div class="paso"><span class="paso-num">2</span><div style="flex:1"><strong>Sacá las fotos con la cámara</strong><p class="chico suave" style="margin:.2rem 0">Solo se aceptan fotos sacadas ahora mismo (no de la galería), así la profe ve tu trabajo real. Hasta 6 fotos.</p>
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
    catch (x) { toast(x.message === 'PERMISO_CAMARA' ? 'Permití el acceso a la cámara para poder entregar.' : 'No encontramos una cámara en este dispositivo. Entregá desde tu celular.', true); }
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
      const { error } = await sb.from('entregas').insert({ servicio_id: id, titulo: f.titulo.value.trim(), modulo: f.modulo?.value || null, mensaje: f.mensaje.value.trim(), fotos: rutas });
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
  pintar(`<h1>Mis notas</h1><p class="suave">Escala de 1 a 5 · tus promedios y los comentarios de la profe para seguir mejorando.</p>
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
async function vistaAdminCorregir() {
  const filtro = JSON.parse(sessionStorage.getItem('aula-filtro') || '{"estado":"enviada","curso":""}');
  const { data, error } = await sb.rpc('admin_entregas', { p_curso: filtro.curso || null, p_estado: filtro.estado || null });
  if (error) return pintar(`<div class="vacio">${esc(errorTxt(error))}</div>`);
  pintar(`<h1>Trabajos para corregir</h1><p class="suave">Mirá las fotos, poné la nota (1 a 5) y dejale un comentario para que mejore.</p>
    <div class="filtros"><select id="f-estado"><option value="enviada">Sin corregir</option><option value="corregida">Corregidos</option><option value="rehacer">Para rehacer</option><option value="">Todos</option></select>
      <select id="f-curso"><option value="">Todos los cursos</option>${E.servicios.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('')}</select></div>
    <div class="grilla" style="grid-template-columns:repeat(auto-fill,minmax(380px,1fr))">${(data || []).map((e) => `<article class="entrega" data-id="${e.id}">
      <div class="entrega-cab"><div><h3>${esc(e.titulo)}</h3><span class="chico"><strong>${esc(e.nombre)}</strong> · ${esc(e.curso)}</span><br><span class="chico suave">${e.modulo ? esc(e.modulo) + ' · ' : ''}${fechaHora(e.creado)}</span></div>
      ${e.estado === 'enviada' ? '<span class="etiqueta ambar">Nuevo</span>' : e.estado === 'rehacer' ? '<span class="etiqueta rojo">Rehacer</span>' : `<span class="nota-num" style="width:44px;height:44px;font-size:1.2rem">${e.calificacion ?? '–'}</span>`}</div>
      <div class="fotos">${e.fotos.map((f) => `<button data-ver="${esc(f)}"><img data-bucket="entregas" data-ruta="${esc(f)}" alt="Foto del trabajo"></button>`).join('')}</div>
      ${e.mensaje ? `<p class="chico" style="margin:.2rem 0">💬 ${esc(e.mensaje)}</p>` : ''}
      <div class="calificar"><div class="escala" role="group" aria-label="Nota">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-nota="${n}" aria-pressed="${e.calificacion === n}">${n}</button>`).join('')}</div>
        <div class="escala-txt" data-txt>${e.calificacion ? NOTA_TXT[e.calificacion] : '1 Insuficiente · 3 Bueno · 5 Excelente'}</div>
        <textarea data-com placeholder="Comentario para la alumna: qué salió bien y qué mejorar…" maxlength="3000">${esc(e.comentario || '')}</textarea>
        <div class="fila"><button class="btn btn-oro" data-guardar style="flex:1">Guardar corrección</button><button class="btn btn-borde btn-chico" data-rehacer>Pedir que lo rehaga</button></div></div></article>`).join('')
      || '<div class="vacio" style="grid-column:1/-1"><span class="grande">🎉</span>No hay trabajos en esta lista.</div>'}</div>`);
  $('#f-estado').value = filtro.estado; $('#f-curso').value = filtro.curso;
  for (const id of ['#f-estado', '#f-curso']) $(id).onchange = () => { sessionStorage.setItem('aula-filtro', JSON.stringify({ estado: $('#f-estado').value, curso: $('#f-curso').value })); vistaAdminCorregir(); };
  for (const art of $$('.entrega[data-id]')) {
    let nota = +(art.querySelector('[aria-pressed="true"]')?.dataset.nota || 0);
    for (const b of $$('[data-nota]', art)) b.onclick = () => { nota = +b.dataset.nota; for (const x of $$('[data-nota]', art)) x.setAttribute('aria-pressed', x === b); art.querySelector('[data-txt]').textContent = NOTA_TXT[nota]; };
    const guardar = async (estado) => {
      if (estado === 'corregida' && !nota) return toast('Elegí una nota del 1 al 5.', true);
      const { error } = await sb.rpc('admin_calificar', { p_id: art.dataset.id, p_calificacion: estado === 'rehacer' ? (nota || null) : nota, p_comentario: art.querySelector('[data-com]').value, p_estado: estado });
      if (error) return toast(errorTxt(error), true);
      toast(estado === 'rehacer' ? 'Le pediste que lo rehaga ✓' : 'Corrección guardada ✓'); await contarPendientes(); navegacion(); marcarNav(); vistaAdminCorregir();
    };
    art.querySelector('[data-guardar]').onclick = () => guardar('corregida');
    art.querySelector('[data-rehacer]').onclick = () => guardar('rehacer');
  }
  hidratarFotos();
}

// ---------- Admin: materiales ----------
async function vistaAdminMateriales() {
  const cur = sessionStorage.getItem('aula-curso-mat') || E.servicios[0]?.id;
  const s = servicio(cur);
  const { data: lecciones } = await sb.from('lecciones').select('*').eq('servicio_id', cur).order('orden').order('creado');
  const modsCat = (s?.extra?.detalles || []).map((d) => d.texto); const modsUsados = [...new Set((lecciones || []).map((l) => l.modulo).filter(Boolean))];
  pintar(`<h1>Materiales de los cursos</h1><p class="suave">Subí PDF, fotos, videos o enlaces. Solo los ven las alumnas con acceso a ese curso.</p>
    <div class="filtros"><select id="m-curso">${E.servicios.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select></div>
    <div class="dos-columnas"><div><h2>Clases cargadas (${(lecciones || []).length})</h2>
      ${(lecciones || []).length ? (lecciones || []).map((l) => `<div class="clase" style="cursor:default"><span class="clase-ic">${/\.(jpg|png|webp)$/.test(l.archivo || '') ? `<img data-bucket="cursos" data-ruta="${esc(l.archivo)}" alt="">` : ic(l.tipo === 'archivo' ? 'pdf' : TIPO_IC[l.tipo])}</span>
        <span><strong>${esc(l.titulo)}</strong><small>${esc(l.modulo || 'General')}${l.activo ? '' : ' · <b style="color:var(--rojo)">oculta</b>'}</small></span>
        <span class="fila" style="margin-left:auto;flex-wrap:nowrap"><button class="btn btn-borde btn-chico" data-ocultar="${l.id}" data-activo="${l.activo}">${l.activo ? 'Ocultar' : 'Mostrar'}</button><button class="btn btn-peligro btn-chico" data-borrar="${l.id}" data-archivo="${esc(l.archivo || '')}" aria-label="Borrar">✕</button></span></div>`).join('')
        : '<div class="vacio">Este curso todavía no tiene materiales.</div>'}</div>
    <div class="tarjeta"><h2>Agregar material</h2><form id="f-mat" novalidate>
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
      return await vistaAdminCorregir();
    }
    if (p[0] === 'cursos') return vistaCatalogo();
    if (p[0] === 'curso') return await vistaCurso(p[1], q === 'trabajos' ? 'trabajos' : 'clases');
    if (p[0] === 'entregar') return vistaEntregar(p[1]);
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
