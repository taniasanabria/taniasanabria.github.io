/*
 * chat.js: asistente virtual del sitio (se carga recién cuando la visita toca el botón del chat).
 * Las respuestas salen de chat-motor.js con el catálogo vivo (el mismo que muestra la página).
 * Opcional: si config.js define CHAT.backend (URL de una Edge Function con IA), las preguntas que el
 * motor local no entiende se le envían; si falla o no está, se deriva a Tania por WhatsApp.
 */
import { CHAT } from './config.js';

const V = new URL(import.meta.url).search;
const { responder, bienvenida } = await import('./chat-motor.js' + V);

const CLAVE = 'tania-chat-v1';
const MAX_GUARDADOS = 40;
let api = null;
let raiz = null;
let origenFoco = null;
let memoria = { mensajes: [], estado: {} };

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const formatear = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const tactil = () => matchMedia('(hover: none), (pointer: coarse)').matches;

function cargarCss() {
  if (document.getElementById('css-chat')) return Promise.resolve();
  return new Promise((ok) => {
    const l = document.createElement('link');
    l.id = 'css-chat'; l.rel = 'stylesheet'; l.href = new URL('../css/chat.css' + V, import.meta.url).href;
    l.onload = ok; l.onerror = ok;
    document.head.append(l);
  });
}
function guardar() {
  try { sessionStorage.setItem(CLAVE, JSON.stringify({ ...memoria, mensajes: memoria.mensajes.slice(-MAX_GUARDADOS) })); } catch { /* modo privado */ }
}
function recuperar() {
  try { const m = JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); if (m && Array.isArray(m.mensajes)) memoria = m; } catch { /* nada */ }
}

const urlWhatsApp = (texto) => {
  const n = api.catalogo().negocio.whatsapp;
  return `https://wa.me/${n}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
};

function construir() {
  raiz = document.createElement('section');
  raiz.className = 'chat';
  raiz.id = 'chat';
  raiz.hidden = true;
  raiz.tabIndex = -1;
  raiz.setAttribute('role', 'dialog');
  raiz.setAttribute('aria-modal', 'false');
  raiz.setAttribute('aria-labelledby', 'chat-titulo');
  raiz.innerHTML = `
    <div class="chat-cabecera">
      <img src="img/logo-96.webp" width="40" height="41" alt="">
      <div class="chat-titulos">
        <h2 id="chat-titulo">Asistente de Tania</h2>
        <p>Respuestas automáticas · <a class="chat-humano" href="${esc(urlWhatsApp('¡Hola Tania! Te escribo desde la web.'))}" target="_blank" rel="noopener">Hablar con Tania</a></p>
      </div>
      <button type="button" class="chat-cerrar" aria-label="Cerrar el asistente"><svg viewBox="0 0 384 512" aria-hidden="true" focusable="false"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/></svg></button>
    </div>
    <div class="chat-mensajes" tabindex="0" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversación"></div>
    <div class="chat-chips" role="group" aria-label="Respuestas rápidas"></div>
    <form class="chat-form" autocomplete="off">
      <label for="chat-texto" class="solo-lector">Escribí tu pregunta</label>
      <input id="chat-texto" name="texto" type="text" maxlength="300" placeholder="Escribí tu pregunta…" enterkeyhint="send">
      <button type="submit" class="chat-enviar" aria-label="Enviar"><svg viewBox="0 0 512 512" aria-hidden="true" focusable="false"><path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480V396.4c0-4 1.5-7.8 4.2-10.7L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3 .3 300.7 0 288.9s5.9-22.8 16.1-28.7l448-256c10.7-6.1 23.9-5.5 34 1.4z"/></svg></button>
    </form>`;
  document.body.append(raiz);
  raiz.querySelector('.chat-cerrar').addEventListener('click', cerrar);
  raiz.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } });
  raiz.querySelector('.chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const campo = e.target.texto;
    const t = campo.value.trim();
    if (!t) return;
    campo.value = '';
    preguntar(t, t);
  });
  raiz.querySelector('.chat-chips').addEventListener('click', alTocarChip);
}

function burbuja(de, texto, animar = true) {
  const caja = raiz.querySelector('.chat-mensajes');
  const el = document.createElement('div');
  el.className = `chat-msj chat-${de}${animar && !reducido() ? ' entra' : ''}`;
  el.innerHTML = `<span class="solo-lector">${de === 'yo' ? 'Vos:' : 'Asistente:'} </span>${formatear(texto)}`;
  caja.append(el);
  caja.scrollTop = caja.scrollHeight;
}

function pintarChips(chips) {
  const zona = raiz.querySelector('.chat-chips');
  zona.innerHTML = (chips || []).map((c, i) => {
    if (c.tipo === 'whatsapp') return `<a class="chat-chip chat-chip-wa" href="${esc(urlWhatsApp(c.valor))}" target="_blank" rel="noopener">${esc(c.etiqueta)}</a>`;
    if (c.tipo === 'enlace') return `<a class="chat-chip" href="${esc(c.valor)}" target="_blank" rel="noopener">${esc(c.etiqueta)} ↗</a>`;
    const clase = c.principal ? ' chat-chip-principal' : '';
    return `<button type="button" class="chat-chip${clase}" data-i="${i}">${esc(c.etiqueta)}</button>`;
  }).join('');
  zona._chips = chips || [];
  zona.hidden = !(chips && chips.length);
  zona.scrollTop = 0;
  const caja = raiz.querySelector('.chat-mensajes');
  caja.scrollTop = caja.scrollHeight;
}

function alTocarChip(e) {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  const c = e.currentTarget._chips[Number(b.dataset.i)];
  if (!c) return;
  if (c.tipo === 'preguntar') { preguntar(c.etiqueta.replace(/^[^\p{L}\p{N}¿¡]+/u, ''), c.valor); return; }
  if (c.tipo === 'reservar') { cerrar({ sinFoco: true }); api.abrirReserva(c.valor, origenFoco); return; }
  if (c.tipo === 'detalle') { cerrar({ sinFoco: true }); api.abrirDetalle(c.valor, origenFoco); }
}

let ocupado = false;
async function preguntar(mostrado, enviado) {
  if (ocupado) return;
  ocupado = true;
  burbuja('yo', mostrado);
  memoria.mensajes.push({ de: 'yo', texto: mostrado });
  pintarChips([]);
  const caja = raiz.querySelector('.chat-mensajes');
  const escribiendo = document.createElement('div');
  escribiendo.className = 'chat-msj chat-bot chat-escribiendo';
  escribiendo.setAttribute('aria-hidden', 'true');
  escribiendo.innerHTML = '<span></span><span></span><span></span>';
  caja.append(escribiendo); caja.scrollTop = caja.scrollHeight;
  let r;
  try { r = responder(enviado, api.catalogo(), memoria.estado); }
  catch (err) { console.warn('Asistente:', err); r = { texto: 'Uy, algo falló de mi lado. Escribile a Tania por WhatsApp y te ayuda. 💬', chips: [{ etiqueta: '💬 Hablar con Tania', tipo: 'whatsapp', valor: '' }], entendido: false }; }
  if (r.entendido === false && CHAT && CHAT.backend) r = (await consultarBackend(enviado, r)) || r;
  await new Promise((ok) => setTimeout(ok, reducido() ? 0 : 380));
  escribiendo.remove();
  burbuja('bot', r.texto);
  memoria.mensajes.push({ de: 'bot', texto: r.texto });
  memoria.chips = r.chips;
  pintarChips(r.chips);
  guardar();
  ocupado = false;
}

// Gancho para una IA futura (p. ej. Supabase Edge Function). Espera { respuesta: string }.
async function consultarBackend(pregunta, local) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(CHAT.backend, {
      method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pregunta, historial: memoria.mensajes.slice(-8) }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || typeof d.respuesta !== 'string' || !d.respuesta.trim()) return null;
    return { texto: d.respuesta.trim().slice(0, 1200), chips: local.chips, entendido: true };
  } catch { return null; } finally { clearTimeout(t); }
}

function abrir() {
  raiz.hidden = false;
  document.documentElement.classList.add('chat-abierto');
  document.querySelectorAll('[data-chat]').forEach((b) => b.setAttribute('aria-expanded', 'true'));
  requestAnimationFrame(() => raiz.classList.add('visible'));
  const caja = raiz.querySelector('.chat-mensajes');
  caja.scrollTop = caja.scrollHeight;
  // En el celular no se abre el teclado solo: el foco va al panel.
  (tactil() ? raiz : raiz.querySelector('#chat-texto')).focus({ preventScroll: true });
}
function cerrar({ sinFoco = false } = {}) {
  if (!raiz || raiz.hidden) return;
  raiz.classList.remove('visible');
  raiz.hidden = true;
  document.documentElement.classList.remove('chat-abierto');
  document.querySelectorAll('[data-chat]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  if (!sinFoco && origenFoco && origenFoco.isConnected) origenFoco.focus({ preventScroll: true });
}

/** Abre el asistente. puente = { catalogo(), abrirReserva(id, origen), abrirDetalle(id, origen) } */
export async function abrirChat(puente, origen) {
  api = puente;
  origenFoco = origen || document.activeElement;
  if (!raiz) {
    await cargarCss();
    construir();
    recuperar();
    if (memoria.mensajes.length) {
      memoria.mensajes.forEach((m) => burbuja(m.de, m.texto, false));
      pintarChips(memoria.chips && memoria.chips.length ? memoria.chips : bienvenida(api.catalogo()).chips);
    } else {
      const b = bienvenida(api.catalogo());
      burbuja('bot', b.texto, false);
      memoria.mensajes.push({ de: 'bot', texto: b.texto });
      memoria.chips = b.chips;
      pintarChips(b.chips);
    }
  }
  if (raiz.hidden) abrir(); else cerrar();
}
