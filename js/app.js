/*
 * app.js: interacción del sitio (menú, detalles, visor de fotos, formulario de reserva, compartir).
 * El contenido principal ya viene en el HTML; aquí solo se agrega comportamiento.
 */
import { cargarCatalogo, cargarManifiestoFotos } from './datos.js';
import { detalleServicio, fotosDisponibles, indiceReservas, rutaFoto } from './render.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

let catalogo;
let manifiesto;
let reservas;

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

function prepararDialogos() {
  for (const dlg of $$('dialog')) {
    dlg.addEventListener('close', () => alCerrarDialogo(dlg));
    // Cerrar tocando fuera del contenido
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
      if (e.target.closest('[data-cerrar]')) dlg.close();
    });
  }
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
  img.srcset = anchos.map((a) => `${rutaFoto(base, a)} ${a}w`).join(', ');
  img.sizes = '100vw';
  img.src = rutaFoto(base, anchos[anchos.length - 1]);
  img.alt = `${visor.titulo}: foto ${visor.indice + 1} de ${visor.fotos.length}`;
  $('#visor-contador').textContent = `${visor.indice + 1} / ${visor.fotos.length}`;
  const varias = visor.fotos.length > 1;
  $('#visor-prev').hidden = !varias;
  $('#visor-sig').hidden = !varias;
  // Precargar la siguiente
  if (varias) {
    const sig = visor.fotos[(visor.indice + 1) % visor.fotos.length];
    const pre = new Image();
    pre.src = rutaFoto(sig, manifiesto[sig].anchos[manifiesto[sig].anchos.length - 1]);
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

function generarHoras() {
  const sel = $('#r-hora');
  const actual = sel.value;
  const info = horarioDelDia($('#r-fecha').value);
  const datos = reservas[$('#r-servicio').value];
  const esEvento = datos && datos.esEvento;
  const opciones = ['<option value="">Elegí un horario…</option>'];
  let abre = '09:00';
  let cierra = '20:00';
  if (info && info.horario) { abre = info.horario.abre; cierra = info.horario.cierra; }
  const aMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  if (!esEvento) {
    for (let t = aMin(abre); t < aMin(cierra); t += 30) {
      const hh = String(Math.floor(t / 60)).padStart(2, '0');
      const mm = String(t % 60).padStart(2, '0');
      opciones.push(`<option value="${hh}:${mm}">${hh}:${mm} hs</option>`);
    }
  } else {
    for (let t = 8 * 60; t <= 23 * 60; t += 30) {
      const hh = String(Math.floor(t / 60)).padStart(2, '0');
      const mm = String(t % 60).padStart(2, '0');
      opciones.push(`<option value="${hh}:${mm}">${hh}:${mm} hs</option>`);
    }
  }
  opciones.push('<option value="a coordinar">Otro horario / a coordinar</option>');
  sel.innerHTML = opciones.join('');
  if ([...sel.options].some((o) => o.value === actual)) sel.value = actual;

  const ayuda = $('#r-fecha-info');
  if (info && !info.horario && !esEvento) {
    ayuda.textContent = `Los ${DIAS_ES[info.dia].toLowerCase()}s no figuran en el horario del Studio (${catalogo.negocio.horarioTexto}). Podés enviar igual la solicitud para consultar disponibilidad.`;
  } else if (esEvento) {
    ayuda.textContent = 'Para eventos indicá el horario aproximado de inicio de la fiesta.';
  } else {
    ayuda.textContent = '';
  }
}

function actualizarServicio() {
  const datos = reservas[$('#r-servicio').value];
  const info = $('#r-servicio-info');
  info.textContent = datos && datos.precio ? `Valor de referencia: ${datos.precio}` : '';
  $('#r-tocado-campo').hidden = !(datos && datos.permiteTocado);
  if ($('#r-tocado-campo').hidden) $('#r-tocado').checked = false;
  $('#r-personas-campo').hidden = !(datos && (datos.esEvento || /^maquillaje-(social|alta)/.test(datos.id)));
  const conSena = !!(datos && datos.sena);
  $('#r-politica').hidden = !conSena;
  if (conSena) $('#r-sena').textContent = datos.sena;
  $('#r-acepto').checked = false;
  generarHoras();
}

function abrirReserva(idServicio, origen) {
  const form = $('#form-reserva');
  form.hidden = false;
  $('#reserva-ok').hidden = true;
  $('#r-error').textContent = '';
  $$('.campo-invalido', form).forEach((el) => el.classList.remove('campo-invalido'));
  const sel = $('#r-servicio');
  sel.value = idServicio && reservas[idServicio] ? idServicio : '';
  const hoy = new Date();
  $('#r-fecha').min = fechaLocalISO(hoy);
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

function enviarReserva(e) {
  e.preventDefault();
  const f = e.target;
  const datos = reservas[f.servicio.value];
  const errores = [];
  const chequear = (el, ok, msg) => { marcar(el, !ok); if (!ok) errores.push({ el, msg }); };
  chequear(f.servicio, !!datos, 'Elegí un servicio.');
  chequear(f.nombre, f.nombre.value.trim().length >= 3, 'Escribí tu nombre y apellido.');
  chequear(f.telefono, telefonoValido(f.telefono.value), 'Escribí un teléfono válido (ej: 0981 123 456).');
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
  let servicio = datos.nombre;
  if (f.tocado.checked) servicio += ' + Añadir Tocado Exclusivo';

  const lineas = [
    '📱 *--- NUEVA SOLICITUD WEB ---*',
    `👤 *Cliente:* ${f.nombre.value.trim()}`,
    `📞 *Teléfono:* ${f.telefono.value.trim()}`,
    `💅 *Servicio:* ${servicio}`,
  ];
  if (datos.precio) lineas.push(`💰 *Valor de Referencia:* ${datos.precio}`);
  lineas.push(`📅 *Fecha preferida:* ${fechaTexto}`);
  lineas.push(`🕒 *Horario preferido:* ${f.hora.value === 'a coordinar' ? 'A coordinar' : f.hora.value + ' hs'}`);
  if (!$('#r-personas-campo').hidden && f.personas.value) lineas.push(`👥 *Personas:* ${f.personas.value}`);
  if (f.notas.value.trim()) lineas.push(`📝 *Comentarios:* ${f.notas.value.trim()}`);
  lineas.push(datos.sena ? `✅ *Acepta política de seña previa (${datos.sena}).*` : '✅ *Consultas y diseño personalizado (Sin seña previa).*');
  lineas.push('*---------------------------------------*');
  lineas.push(`¡Hola Tania! Me contacto porque quisiera ${datos.accion}, por favor.`);

  const url = `https://wa.me/${catalogo.negocio.whatsapp}?text=${encodeURIComponent(lineas.join('\n'))}`;
  $('#reserva-enlace').href = url;
  const ventana = window.open(url, '_blank');
  if (ventana) ventana.opener = null;
  f.hidden = true;
  const ok = $('#reserva-ok');
  ok.hidden = false;
  ok.focus();
  if (!ventana) {
    // Si el navegador bloqueó la ventana, el enlace visible sirve de respaldo.
    aviso('Tocá el enlace para abrir WhatsApp.');
  }
}

function prepararReserva() {
  const f = $('#form-reserva');
  $('#r-servicio').addEventListener('change', actualizarServicio);
  $('#r-fecha').addEventListener('change', generarHoras);
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

function prepararGaleria() {
  const chips = $$('.chip');
  chips.forEach((chip) => chip.addEventListener('click', () => {
    chips.forEach((c) => c.setAttribute('aria-selected', String(c === chip)));
    $$('[data-album-panel]').forEach((p) => { p.hidden = p.dataset.albumPanel !== chip.dataset.album; });
  }));
}

function prepararClics() {
  document.addEventListener('click', (e) => {
    const reservar = e.target.closest('[data-reservar]');
    if (reservar) { e.preventDefault(); abrirReserva(reservar.dataset.reservar, reservar); return; }
    const detalle = e.target.closest('[data-detalle]');
    if (detalle) { e.preventDefault(); abrirDetalle(detalle.dataset.detalle, detalle); return; }
    const foto = e.target.closest('[data-lightbox]');
    if (foto) { e.preventDefault(); abrirVisor(foto.dataset.lightbox, Number(foto.dataset.indice), foto); return; }
    const comp = e.target.closest('[data-compartir]');
    if (comp) { e.preventDefault(); compartir(comp.dataset.compartir); }
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

async function iniciar() {
  [catalogo, manifiesto] = await Promise.all([cargarCatalogo(), cargarManifiestoFotos()]);
  reservas = indiceReservas(catalogo.servicios);
  prepararDialogos();
  prepararVisor();
  prepararReserva();
  prepararMenu();
  prepararGaleria();
  prepararClics();
  atenderHash();
  window.addEventListener('hashchange', atenderHash);
  document.documentElement.classList.add('js-listo');
}

iniciar().catch((err) => {
  // Si algo falla, el sitio sigue mostrando todo el contenido estático y los enlaces de WhatsApp.
  console.warn('No se pudo iniciar la interacción del sitio:', err);
});
