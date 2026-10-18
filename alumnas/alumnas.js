/*
 * Aula de alumnas. Entran con su email + el código de acceso que Tania les pasa por WhatsApp.
 * - El código es la contraseña de su cuenta de Supabase Auth. La primera vez la cuenta se crea sola:
 *   el hook "Before User Created" (supabase/cursos.sql) solo lo permite si email + código coinciden
 *   con una alumna habilitada. No hace falta email de confirmación (sin costo, sin SMTP).
 * - Las clases se leen de la tabla "lecciones" y los PDF/fotos del bucket privado "cursos":
 *   RLS deja ver solo los cursos a los que Tania le dio acceso.
 */
import { SUPABASE } from '../js/config.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const sb = window.supabase.createClient(SUPABASE.url, SUPABASE.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'aula-tania' },
});
const estado = { cursos: [], email: '' };

let tToast;
function toast(t, mal = false) {
  const el = $('#toast'); el.textContent = t; el.classList.toggle('mal', mal); el.classList.add('visible');
  clearTimeout(tToast); tToast = setTimeout(() => el.classList.remove('visible'), mal ? 5000 : 3000);
}
function vista(n) {
  for (const v of ['cargando', 'ingreso', 'cursos', 'curso']) $('#vista-' + v).hidden = v !== n;
  $('#btn-salir').hidden = n === 'ingreso' || n === 'cargando';
  window.scrollTo(0, 0);
}

// "abcd 2345" → "ABCD-2345"
export function normalizarCodigo(t) {
  const c = String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

function mensajeError(e, fase) {
  const m = `${e?.code || ''} ${e?.message || ''}`;
  if (e?.status === 429 || /rate limit|too many/i.test(m)) return 'Demasiados intentos. Esperá unos minutos y probá de nuevo.';
  if (/fetch|network|Failed/i.test(m)) return 'Sin conexión. Revisá internet e intentá de nuevo.';
  if (fase === 'alta') {
    if (/already|exists|registered/i.test(m)) return 'El código no coincide con tu cuenta. Revisá el último mensaje de Tania (o pedile que te lo reenvíe).';
    if (/not allowed|disabled/i.test(m)) return 'El aula todavía no está habilitada. Avisale a Tania, por favor.';
    if (/confirm/i.test(m)) return 'Tu cuenta necesita confirmación. Avisale a Tania, por favor.';
    return 'El email o el código no coinciden con una alumna habilitada. Revisá que sea el mismo email con el que te inscribiste.';
  }
  return e?.message || 'Ocurrió un error.';
}

async function ingresar(e) {
  e.preventDefault();
  const f = e.target;
  const email = f.email.value.trim().toLowerCase();
  const codigo = normalizarCodigo(f.codigo.value);
  const err = $('#ingreso-error'); err.textContent = '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Escribí tu email.'; f.email.focus(); return; }
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codigo)) { err.textContent = 'El código tiene 8 letras y números (ej: ABCD-2345).'; f.codigo.focus(); return; }
  f.codigo.value = codigo;
  const btn = $('#i-entrar'); btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    let { error } = await sb.auth.signInWithPassword({ email, password: codigo });
    if (error && /invalid/i.test(`${error.code} ${error.message}`)) {
      // Primera vez: se crea la cuenta (el servidor verifica email + código).
      const r = await sb.auth.signUp({ email, password: codigo, options: { data: { codigo } } });
      if (r.error) { err.textContent = mensajeError(r.error, 'alta'); return; }
      if (!r.data.session) { err.textContent = mensajeError({ message: 'confirm' }, 'alta'); return; }
      error = null;
    }
    if (error) { err.textContent = mensajeError(error); return; }
    await entrar();
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

async function entrar() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { vista('ingreso'); return; }
  estado.email = user.email;
  const { data, error } = await sb.rpc('mis_cursos');
  if (error) { toast(mensajeError(error), true); vista('ingreso'); return; }
  estado.cursos = data || [];
  $('#hola').textContent = `Hola, ${user.email}`;
  const pedido = new URLSearchParams(location.hash.slice(1)).get('curso');
  if (estado.cursos.length === 1 || estado.cursos.some((c) => c.servicio_id === pedido)) {
    await abrirCurso(estado.cursos.some((c) => c.servicio_id === pedido) ? pedido : estado.cursos[0].servicio_id);
    return;
  }
  $('#lista-cursos').innerHTML = estado.cursos.length
    ? estado.cursos.map((c) => `<button type="button" class="curso-item" data-curso="${esc(c.servicio_id)}"><span><strong>${esc(c.curso_nombre || c.nombre)}</strong><span>${c.clases} ${c.clases === 1 ? 'clase' : 'clases'}</span></span><span aria-hidden="true">›</span></button>`).join('')
    : '<p class="vacio">Todavía no tenés cursos habilitados. Si ya pagaste, avisale a Tania para que te dé acceso.</p>';
  vista('cursos');
}

// ---------- videos: YouTube (no listado) y Google Drive
export function video(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const h = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(h)) id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/) || [])[1];
  if (id && /^[\w-]{6,}$/.test(id)) return { tipo: 'youtube', id, embed: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&autoplay=1&playsinline=1`, portada: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  if (h === 'drive.google.com') {
    const d = (u.pathname.match(/\/file\/d\/([\w-]{10,})/) || [])[1] || u.searchParams.get('id');
    if (d && /^[\w-]{10,}$/.test(d)) return { tipo: 'drive', id: d, embed: `https://drive.google.com/file/d/${d}/preview` };
  }
  if (h === 'vimeo.com') { const v = (u.pathname.match(/^\/(\d+)/) || [])[1]; if (v) return { tipo: 'vimeo', id: v, embed: `https://player.vimeo.com/video/${v}?autoplay=1` }; }
  return null;
}

function bloqueVideo(l) {
  const v = video(l.url);
  if (!v) return `<p><a class="btn btn-principal" href="${esc(l.url)}" target="_blank" rel="noopener">▶ Ver el video</a></p>`;
  return `<div class="video"><button type="button" class="video-portada" data-embed="${esc(v.embed)}" data-titulo="${esc(l.titulo)}"${v.portada ? ` style="background-image:url('${esc(v.portada)}')"` : ''}><span>▶ Ver video</span></button></div>`;
}

async function abrirCurso(id) {
  const c = estado.cursos.find((x) => x.servicio_id === id);
  if (!c) return;
  vista('curso');
  $('#btn-volver').hidden = estado.cursos.length < 2;
  $('#t-curso').textContent = c.curso_nombre || c.nombre;
  $('#lista-clases').innerHTML = '<p class="cargando">Cargando clases…</p>';
  history.replaceState(null, '', '#curso=' + encodeURIComponent(id));
  const { data, error } = await sb.from('lecciones').select('id,modulo,titulo,descripcion,tipo,url,archivo,archivo_nombre,orden').eq('servicio_id', id).order('orden').order('creado');
  if (error) { $('#lista-clases').innerHTML = `<p class="vacio">${esc(mensajeError(error))}</p>`; return; }
  const archivos = data.filter((l) => l.tipo === 'archivo').map((l) => l.archivo);
  const firmadas = {};
  if (archivos.length) {
    const r = await sb.storage.from('cursos').createSignedUrls(archivos, 3600);
    (r.data || []).forEach((x) => { if (x.signedUrl) firmadas[x.path] = x.signedUrl; });
  }
  let modulo = null; let n = 0;
  const html = data.map((l) => {
    let cab = '';
    if ((l.modulo || '') !== (modulo || '')) { modulo = l.modulo; if (modulo) cab = `<h2 class="modulo">${esc(modulo)}</h2>`; }
    n++;
    let cuerpo = '';
    if (l.tipo === 'video') cuerpo = bloqueVideo(l);
    else if (l.tipo === 'enlace') cuerpo = `<p><a class="btn btn-borde" href="${esc(l.url)}" target="_blank" rel="noopener">Abrir enlace ↗</a></p>`;
    else {
      const u = firmadas[l.archivo];
      if (!u) cuerpo = '<p class="suave">Este archivo no está disponible ahora. Probá recargar la página.</p>';
      else if (/\.pdf$/i.test(l.archivo)) cuerpo = `<p><a class="btn btn-principal" href="${esc(u)}" target="_blank" rel="noopener">📄 Abrir ${esc(l.archivo_nombre || 'PDF')}</a></p>`;
      else cuerpo = `<a href="${esc(u)}" target="_blank" rel="noopener"><img class="foto-clase" src="${esc(u)}" alt="${esc(l.titulo)}" loading="lazy"></a>`;
    }
    return `${cab}<article class="clase"><h3><span class="num">${n}.</span> ${esc(l.titulo)}</h3>${l.descripcion ? `<p>${esc(l.descripcion)}</p>` : ''}${cuerpo}</article>`;
  }).join('');
  $('#lista-clases').innerHTML = html || '<p class="vacio">Tania todavía no cargó clases en este curso. ¡Muy pronto!</p>';
}

function prepararEventos() {
  $('#form-ingreso').addEventListener('submit', ingresar);
  $('#i-codigo').addEventListener('blur', (e) => { e.target.value = normalizarCodigo(e.target.value); });
  $('#btn-salir').addEventListener('click', async () => { await sb.auth.signOut(); history.replaceState(null, '', location.pathname); vista('ingreso'); });
  $('#btn-volver').addEventListener('click', () => { history.replaceState(null, '', location.pathname); entrarLista(); });
  $('#lista-cursos').addEventListener('click', (e) => { const b = e.target.closest('[data-curso]'); if (b) abrirCurso(b.dataset.curso); });
  $('#lista-clases').addEventListener('click', (e) => {
    const p = e.target.closest('[data-embed]'); if (!p) return;
    const f = document.createElement('iframe');
    f.src = p.dataset.embed; f.title = p.dataset.titulo || 'Video de la clase';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true; f.referrerPolicy = 'strict-origin-when-cross-origin';
    p.replaceWith(f);
  });
}
async function entrarLista() {
  $('#lista-cursos').innerHTML = estado.cursos.map((c) => `<button type="button" class="curso-item" data-curso="${esc(c.servicio_id)}"><span><strong>${esc(c.curso_nombre || c.nombre)}</strong><span>${c.clases} ${c.clases === 1 ? 'clase' : 'clases'}</span></span><span aria-hidden="true">›</span></button>`).join('');
  vista('cursos');
}

async function arrancar() {
  prepararEventos();
  // Número de WhatsApp actualizado (el que Tania carga en Ajustes)
  sb.from('ajustes').select('whatsapp').eq('id', 1).single().then(({ data }) => { if (data?.whatsapp) $('#enlace-wa').href = `https://wa.me/${data.whatsapp}?text=${encodeURIComponent('¡Hola Tania! Necesito mi código de acceso al aula de alumnas.')}`; });
  const q = new URLSearchParams(location.search);
  if (q.get('email')) $('#i-email').value = q.get('email');
  const { data: { session } } = await sb.auth.getSession();
  if (session) await entrar(); else vista('ingreso');
}
if (window.supabase) arrancar().catch((e) => { console.warn(e); vista('ingreso'); $('#ingreso-error').textContent = 'No se pudo conectar. Revisá internet y recargá la página.'; });
