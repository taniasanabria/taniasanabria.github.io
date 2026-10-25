/*
 * agenda-ui.js: piezas visuales de agenda (sin datos personales: solo libre/ocupado/cupos).
 * - Reserva: tira de próximos días con estado y horarios como botones (espejo del <select> #r-hora,
 *   que sigue siendo la fuente de verdad del formulario).
 * - Cursos: grilla de días y horarios con lugares libres / últimos lugares / completo.
 */
import { esc, icono } from './render.js';

export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const normal = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** "Lunes 09:00–11:00" (o el viejo "Martes 18:00") → { dia: 'Martes', orden: 1, hora: '18:00', texto }. Si no se reconoce el día, dia = null. */
export function partirHorario(texto) {
  const t = String(texto || '').trim();
  const m = t.match(/^([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\.?\s*(.*)$/);
  if (m) {
    const k = DIAS_SEMANA.findIndex((d) => normal(d).startsWith(normal(m[1]).slice(0, 3)) && normal(m[1]).length >= 3);
    if (k >= 0) return { dia: DIAS_SEMANA[k], orden: k, hora: m[2].replace(/^(de|a las|-|,)\s*/i, '').trim() || 'Horario a confirmar', texto: t };
  }
  return { dia: null, orden: 99, hora: t, texto: t };
}

/** Umbral de "últimos lugares": 2 o el 20 % del cupo. */
export const pocos = (disp, cupo) => disp > 0 && disp <= Math.max(2, Math.ceil((cupo || 10) * 0.2));

/** HTML de la grilla de horarios de un curso. `lista` = [{ horario, cupo, ocupados, disponibles }]. */
export function grillaHorariosCurso(lista) {
  const grupos = new Map();
  for (const h of lista) {
    const p = partirHorario(h.horario);
    const clave = p.dia || 'Otros horarios';
    if (!grupos.has(clave)) grupos.set(clave, { orden: p.orden, items: [] });
    grupos.get(clave).items.push({ ...h, p });
  }
  const libresTotales = lista.filter((h) => h.disponibles > 0);
  const unico = libresTotales.length === 1;
  const minutos = (t) => { const m = String(t).match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 9999; };
  return [...grupos.entries()].sort((a, b) => a[1].orden - b[1].orden).map(([dia, g]) => {
    g.items.sort((x, y) => minutos(x.p.hora) - minutos(y.p.hora));
    const lleno = g.items.every((h) => h.disponibles <= 0);
    const chips = g.items.map((h) => {
      const completo = h.disponibles <= 0;
      const ultimos = pocos(h.disponibles, h.cupo);
      const estado = completo ? 'completo' : ultimos ? 'ultimos' : 'libre';
      const badge = completo ? 'Completo' : ultimos ? (h.disponibles === 1 ? '¡Último lugar!' : `Últimos ${h.disponibles}`) : `${h.disponibles} lugares`;
      const pct = h.cupo ? Math.min(100, Math.round((h.ocupados / h.cupo) * 100)) : 0;
      return `<label class="hora-chip estado-${estado}">
        <input type="radio" name="horario" value="${esc(h.horario)}"${completo ? ' disabled' : ''}${unico && !completo ? ' checked' : ''}>
        <span class="hora-chip-hora">${esc(h.p.hora.replace(/\s*[–—-]\s*(?=\d)/, ' – '))}</span>
        <span class="hora-chip-estado">${esc(badge)}</span>
        <span class="hora-chip-barra" aria-hidden="true"><i style="width:${pct}%"></i></span>
        <span class="solo-lector">${esc(h.horario)}: ${completo ? 'completo, sin lugares' : `${h.disponibles} de ${h.cupo} lugares libres`}</span>
      </label>`;
    }).join('');
    return `<div class="dia-grupo${lleno ? ' dia-lleno' : ''}">
      <p class="dia-grupo-titulo"><span>${esc(dia)}</span>${lleno ? '<em>Completo</em>' : ''}</p>
      <div class="dia-grupo-horas">${chips}</div>
    </div>`;
  }).join('');
}

/** Estado sin horarios cargados: elegante, con acceso al chat. */
export function horariosAConfirmar() {
  return `<div class="horarios-pendientes">
    ${icono('clock')}
    <div><strong>Horarios a confirmar</strong><p>Tania está armando los próximos grupos. Inscribite y te avisamos el día y horario, o consultá en el chat.</p>
    <button type="button" class="btn btn-texto" data-cerrar data-chat>${icono('comment-dots')} Consultar en el chat</button></div>
  </div>`;
}

// ------------------------------------------------------------------ Reserva de turnos
const FMT_DIA = new Intl.DateTimeFormat('es-PY', { weekday: 'short', timeZone: 'UTC' });
const FMT_MES = new Intl.DateTimeFormat('es-PY', { month: 'short', timeZone: 'UTC' });

/** Tira de días. `dias` = [{ fecha:'AAAA-MM-DD', estado:'libre'|'pocos'|'extra'|'completo'|'cerrado', nota }]. */
export function pintarDias(cont, dias, seleccion) {
  cont.innerHTML = dias.map((d) => {
    const f = new Date(d.fecha + 'T12:00:00Z');
    const off = d.estado === 'completo' || d.estado === 'cerrado';
    return `<button type="button" role="listitem" class="dia-celda estado-${d.estado}${d.fecha === seleccion ? ' elegido' : ''}" data-fecha="${esc(d.fecha)}"${off ? ' disabled aria-disabled="true"' : ''} aria-pressed="${d.fecha === seleccion}" aria-label="${esc(FMT_DIA.format(f))} ${f.getUTCDate()}: ${esc(d.nota)}">
      <span class="dia-celda-sem">${esc(FMT_DIA.format(f).replace('.', ''))}</span>
      <span class="dia-celda-num">${f.getUTCDate()}</span>
      <span class="dia-celda-mes">${esc(FMT_MES.format(f).replace('.', ''))}</span>
      <span class="dia-celda-nota">${esc(d.nota)}</span>
    </button>`;
  }).join('');
  const el = cont.querySelector('.elegido');
  if (el) el.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/** Horarios como botones a partir del <select> (grupos = optgroups). */
export function pintarHoras(sel, cont) {
  const grupos = [];
  const sueltas = [];
  for (const nodo of sel.children) {
    if (nodo.tagName === 'OPTGROUP') grupos.push({ titulo: nodo.label, ops: [...nodo.children] });
    else if (nodo.value) sueltas.push(nodo);
  }
  const boton = (o) => {
    const ocupado = o.disabled;
    const extra = o.dataset.extra === '1';
    const coord = o.value === 'a coordinar';
    const hora = coord ? 'A coordinar' : (o.dataset.hora || o.textContent.replace(/\s*hs.*$/, '').replace(/\s*·.*$/, '').trim());
    const nota = ocupado ? 'Ocupado' : extra ? 'Recargo' : coord ? 'por chat' : 'Libre';
    return `<button type="button" class="hora-boton${ocupado ? ' ocupado' : ''}${extra ? ' extra' : ''}${coord ? ' coordinar' : ''}${o.value && o.value === sel.value ? ' elegido' : ''}"${ocupado ? ' disabled' : ` data-valor="${esc(o.value)}"`} aria-pressed="${!!o.value && o.value === sel.value}"><span>${esc(hora)}</span><small>${nota}</small></button>`;
  };
  const libres = grupos.flatMap((g) => g.ops).filter((o) => !o.disabled).length;
  let html = grupos.filter((g) => g.ops.length).map((g) => `<p class="horas-grupo">${esc(g.titulo)}</p><div class="horas-grilla">${g.ops.map(boton).join('')}</div>`).join('');
  if (sueltas.length) html += `<div class="horas-grilla horas-extra">${sueltas.map(boton).join('')}</div>`;
  const vacio = !grupos.length && sueltas.every((o) => o.value === 'a coordinar');
  cont.innerHTML = vacio ? `<p class="horas-vacio">${icono('calendar-check')} Elegí un día para ver los horarios.</p>${html}` : html;
  return { libres };
}
