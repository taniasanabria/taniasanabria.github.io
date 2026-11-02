// Autogestión del turno: la clienta confirma o cancela desde el enlace del recordatorio (?id=<uuid>).
// Solo muestra servicio, día y hora (nunca datos bancarios ni de otras personas).
import { rpc } from '../js/datos.js';
const caja = document.getElementById('caja');
const id = new URLSearchParams(location.search).get('id') || '';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fechaTxt = (iso) => { if (!iso) return 'a coordinar'; return new Intl.DateTimeFormat('es-PY', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso + 'T12:00:00Z')); };
const pintar = (html) => { caja.innerHTML = html; };
async function cargar() {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return pintar('<p class="err">El enlace no es válido. Escribile a Tania.</p>');
  let t;
  try { t = await rpc('turno_cliente', { p_id: id }); } catch { return pintar('<p class="err">No pudimos cargar tu turno ahora. Probá de nuevo en un rato o escribile a Tania.</p>'); }
  if (!t || !t.ok) return pintar('<p class="err">No encontramos ese turno. Escribile a Tania.</p>');
  const base = `<p class="dato">Hola${t.nombre ? ' ' + esc(t.nombre) : ''} 💄</p><p class="dato"><strong>${esc(t.servicio)}</strong></p><p class="dato">${esc(fechaTxt(t.fecha))} · ${esc(t.hora || '')} hs</p>`;
  if (t.estado === 'cancelada' || t.estado === 'rechazada') return pintar(base + '<p class="err">Este turno está cancelado.</p>');
  if (t.pasado) return pintar(base + '<p class="suave">Este turno ya pasó. ¡Gracias por elegirnos!</p>');
  pintar(base + (t.confirmo ? '<p class="ok">✓ Ya confirmaste tu asistencia. ¡Te esperamos!</p>' : '<button class="si" id="si">✅ Confirmo que voy</button>')
    + '<button class="no" id="no">Cancelar mi turno</button><p class="suave">Recordá: la seña no es reembolsable en caso de cancelación o inasistencia.</p>');
  const si = document.getElementById('si'); const no = document.getElementById('no');
  if (si) si.onclick = () => responder('confirmar');
  no.onclick = () => { if (confirm('¿Seguro que querés cancelar tu turno?')) responder('cancelar'); };
}
async function responder(accion) {
  try {
    const r = await rpc('turno_cliente_responder', { p_id: id, p_accion: accion });
    if (r && r.ok) return pintar(accion === 'confirmar' ? '<p class="ok">✓ ¡Gracias! Tu asistencia quedó confirmada. Te esperamos.</p>' : '<p class="ok">Tu turno quedó cancelado. Tania ya lo ve en su agenda.</p>');
    pintar('<p class="err">No se pudo (' + esc((r && r.error) || 'error') + '). Escribile a Tania.</p>');
  } catch { pintar('<p class="err">No se pudo ahora. Probá de nuevo o escribile a Tania.</p>'); }
}
cargar();
