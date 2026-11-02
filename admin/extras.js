// Pestaña "Resumen" del panel: métricas del mes, recordatorios de mañana (24 h), lista de espera y certificados.
// Nada se envía solo: cada mensaje abre WhatsApp con el texto listo para que Tania lo revise y lo mande.
const B = () => window.panelBase;
const $ = (s, r = document) => r.querySelector(s);
const ZONA = 'America/Asuncion';
const SITIO = 'https://taniasanabria.github.io/';
const gs = (n) => 'Gs. ' + Math.round(n || 0).toLocaleString('es-PY');
const hoyPY = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
const sumar = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const inicioPY = (iso) => new Date(iso + 'T00:00:00-03:00');
const fechaPY = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date(ts));
const horaPY = (ts) => new Intl.DateTimeFormat('es-PY', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts));
const diaLargo = (iso) => new Intl.DateTimeFormat('es-PY', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso + 'T12:00:00Z'));
const montoDe = (t) => { const m = String(t || '').match(/(\d{1,3}(?:\.\d{3})+|\d{4,})/); return m ? Number(m[1].replace(/\D/g, '')) : 0; };
const ENV = 'panel.recordatorios';
const enviados = () => { try { return JSON.parse(localStorage.getItem(ENV) || '{}'); } catch { return {}; } };
const faltaTabla = (e) => e && /does not exist|schema cache|PGRST20/.test(e.message || e.code || '');

function abrirWa(tel, texto) { window.open(B().urlWhatsApp(tel, texto), '_blank', 'noopener'); }

async function metricas() {
  const { sb, esc } = B();
  const hoy = hoyPY(); const mes = hoy.slice(0, 7); const desde = inicioPY(mes + '-01');
  const sig = new Date(desde); sig.setMonth(sig.getMonth() + 1);
  const [r, i] = await Promise.all([
    sb.from('reservas').select('servicio_nombre,estado,inicio,fecha_preferida,total_gs,pagado_gs,precio_ref,sena_ref,pago,creado')
      .gte('creado', new Date(desde.getTime() - 62 * 864e5).toISOString()).limit(2000),
    sb.from('inscripciones').select('curso_nombre,estado,monto_gs,pagado_en,cuotas_total,cuotas_pagadas,cuota_gs,deuda_gs,proximo_venc,cliente_nombre,cliente_telefono').limit(2000),
  ]);
  if (r.error) return `<p class="vacio">${esc(r.error.message)}</p>`;
  const delMes = (r.data || []).filter((x) => { const f = x.inicio ? fechaPY(x.inicio) : x.fecha_preferida; return f && f.slice(0, 7) === mes; });
  const activas = delMes.filter((x) => !['cancelada', 'rechazada'].includes(x.estado));
  const cobrado = activas.reduce((a, x) => a + (x.pagado_gs != null ? Number(x.pagado_gs) : x.estado === 'pagada' ? (x.total_gs || montoDe(x.precio_ref)) : 0), 0);
  const esperado = activas.reduce((a, x) => a + (x.total_gs || montoDe(x.precio_ref)), 0);
  const ins = i.error ? [] : i.data || [];
  const matriculas = ins.filter((x) => x.pagado_en && fechaPY(x.pagado_en).slice(0, 7) === mes).reduce((a, x) => a + Number(x.monto_gs || 0), 0);
  const vencidas = ins.filter((x) => x.estado !== 'cancelada' && x.proximo_venc && x.proximo_venc < hoy && Number(x.deuda_gs || 0) > 0);
  const top = Object.entries(activas.reduce((a, x) => { a[x.servicio_nombre] = (a[x.servicio_nombre] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const canceladas = delMes.length - activas.length;
  return `<div class="metricas">
    <div class="metrica"><small>Cobrado en turnos (${esc(mes)})</small><strong>${gs(cobrado)}</strong><span class="suave">de ${gs(esperado)} agendado</span></div>
    <div class="metrica"><small>Matrículas cobradas</small><strong>${gs(matriculas)}</strong></div>
    <div class="metrica"><small>Turnos del mes</small><strong>${activas.length}</strong><span class="suave">${canceladas} cancelados</span></div>
    <div class="metrica ${vencidas.length ? 'mal' : ''}"><small>Cuotas vencidas</small><strong>${vencidas.length}</strong><span class="suave">${gs(vencidas.reduce((a, x) => a + Number(x.deuda_gs || 0), 0))}</span></div>
  </div>
  <h3 class="subtitulo">Servicios más pedidos este mes</h3>
  ${top.length ? `<ol class="top">${top.map(([n, c]) => `<li>${esc(n)} <span class="pildora">${c}</span></li>`).join('')}</ol>` : '<p class="vacio">Todavía no hay turnos este mes.</p>'}
  ${vencidas.length ? `<h3 class="subtitulo">Alumnas con cuota vencida</h3><div class="lista">${vencidas.map((x) => `<div class="tarjeta fila-extra"><span><strong>${esc(x.cliente_nombre)}</strong> · ${esc(x.curso_nombre)} · vence ${esc(x.proximo_venc)} · debe ${gs(x.deuda_gs)}</span>
    <button type="button" class="btn btn-chico btn-borde" data-wa-cuota="${esc(x.cliente_telefono)}" data-nombre="${esc(x.cliente_nombre)}" data-curso="${esc(x.curso_nombre)}" data-monto="${esc(gs(x.deuda_gs))}">💬 Recordar</button></div>`).join('')}</div>` : ''}
  <p class="suave">Montos según lo cargado en el panel y la app (pagos registrados). Las cuotas del curso no se suman al mes porque se registran en la app.</p>`;
}

async function recordatorios() {
  const { sb, esc } = B();
  const man = sumar(hoyPY(), 1);
  const { data, error } = await sb.from('reservas').select('*').gte('inicio', inicioPY(man).toISOString()).lt('inicio', inicioPY(sumar(man, 1)).toISOString())
    .in('estado', ['aprobada', 'pagada']).order('inicio');
  if (error) return `<p class="vacio">${esc(error.message)}</p>`;
  if (!data.length) return `<p class="vacio">No hay turnos confirmados para mañana (${esc(diaLargo(man))}).</p>`;
  const env = enviados();
  return `<div class="lista">${data.map((r) => {
    const conf = r.cliente_confirmo ? ' · ✅ confirmó' : r.cliente_cancelo ? ' · ❌ canceló' : '';
    return `<div class="tarjeta fila-extra"><span><strong>${esc(horaPY(r.inicio))}</strong> ${esc(r.cliente_nombre)} · ${esc(r.servicio_nombre)}${conf}${env[r.id] ? ' · <em>recordatorio enviado</em>' : ''}</span>
    <button type="button" class="btn btn-chico ${env[r.id] ? 'btn-borde' : 'btn-principal'}" data-recordar="${esc(r.id)}">💬 Recordatorio</button></div>`; }).join('')}</div>
    <p class="suave">Abre WhatsApp con el mensaje listo y un enlace para que la clienta confirme o cancele sola. Revisalo y envialo vos.</p>`;
}
function textoRecordatorio(r) {
  const nom = String(r.cliente_nombre || '').split(' ')[0];
  return `¡Hola ${nom}! 💄 Soy Tania Sanabria. Te recuerdo tu turno de *${r.servicio_nombre}* mañana *${diaLargo(fechaPY(r.inicio))}* a las *${horaPY(r.inicio)} hs*.\n\n`
    + `Confirmá o cancelá acá: ${SITIO}turno/?id=${r.id}\n\n📍 Las Residentas 460 esq. 8 de Diciembre, Fernando de la Mora. ¡Te espero!`;
}

async function espera() {
  const { sb, esc } = B();
  const { data, error } = await sb.from('lista_espera').select('*').in('estado', ['esperando', 'avisada']).order('creado');
  if (error) return faltaTabla(error) ? '<p class="vacio">La lista de espera se activa al ejecutar supabase/migracion-2026-11-02.sql.</p>' : `<p class="vacio">${esc(error.message)}</p>`;
  if (!data.length) return '<p class="vacio">Nadie en lista de espera.</p>';
  const nombreCurso = (id) => (B().estado.servicios || []).find((s) => s.id === id)?.nombre || id;
  return `<div class="lista">${data.map((x, k) => `<div class="tarjeta fila-extra"><span><strong>${esc(x.nombre)}</strong> · ${esc(nombreCurso(x.servicio_id))}${x.horario ? ' · ' + esc(x.horario) : ''} · ${esc(fechaPY(x.creado))}${x.estado === 'avisada' ? ' · <em>avisada</em>' : ''}</span>
    <span><button type="button" class="btn btn-chico btn-principal" data-espera-avisar="${esc(x.id)}">💬 Avisar lugar</button>
    <button type="button" class="btn btn-chico btn-borde" data-espera-quitar="${esc(x.id)}">Quitar</button></span></div>`).join('')}</div>`;
}

async function certificados() {
  const { sb, esc } = B();
  const { data, error } = await sb.from('inscripciones').select('id,cliente_nombre,curso_nombre,fecha_inicio,estado').eq('estado', 'pagada').order('creado', { ascending: false }).limit(200);
  if (error) return `<p class="vacio">${esc(error.message)}</p>`;
  if (!data.length) return '<p class="vacio">Todavía no hay alumnas con matrícula pagada.</p>';
  return `<input type="search" id="cert-buscar" placeholder="Buscar alumna…" aria-label="Buscar alumna"><div class="lista" id="cert-lista">${data.map((x) => `<div class="tarjeta fila-extra" data-cert-nombre="${esc((x.cliente_nombre + ' ' + x.curso_nombre).toLowerCase())}"><span><strong>${esc(x.cliente_nombre)}</strong> · ${esc(x.curso_nombre)}</span>
    <button type="button" class="btn btn-chico btn-borde" data-cert="${esc(x.id)}">🎓 Certificado PDF</button></div>`).join('')}</div>
    <p class="suave">Abre el certificado listo para imprimir: elegí “Guardar como PDF”.</p>`;
}
function certificado(x) {
  const fecha = new Intl.DateTimeFormat('es-PY', { timeZone: ZONA, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const esc = B().esc;
  const w = window.open('', '_blank'); if (!w) { B().toast('Permití las ventanas emergentes para ver el certificado', true); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Certificado · ${esc(x.cliente_nombre)}</title>
  <style>@page{size:A4 landscape;margin:0}body{margin:0;font-family:Georgia,serif;background:#fff}
  .c{box-sizing:border-box;width:297mm;height:210mm;padding:18mm;border:6mm solid #1b1610;outline:1.2mm solid #c9a24a;outline-offset:-10mm;text-align:center;display:flex;flex-direction:column;justify-content:center;align-items:center;color:#1b1610}
  img{height:38mm}h1{font-size:15mm;letter-spacing:2mm;margin:4mm 0 2mm;color:#8a6a1f;font-weight:normal}
  .n{font-size:12mm;margin:6mm 0;border-bottom:.4mm solid #c9a24a;padding:0 12mm 2mm}.t{font-size:5.2mm;max-width:210mm;line-height:1.5}
  .f{margin-top:14mm;display:flex;gap:40mm;font-size:4.2mm}.f div{border-top:.3mm solid #1b1610;padding-top:2mm;min-width:60mm}</style></head>
  <body><div class="c"><img src="${location.origin}/img/logo-marca.webp" alt=""><h1>CERTIFICADO</h1><div class="t">Se certifica que</div>
  <div class="n">${esc(x.cliente_nombre)}</div><div class="t">completó satisfactoriamente el curso <strong>${esc(x.curso_nombre)}</strong>
  dictado en Tania Sanabria Makeup Studio Professional, Fernando de la Mora, Paraguay.</div>
  <div class="f"><div>${esc(fecha)}</div><div>Tania Sanabria · Instructora</div></div></div>
  <script>onload=()=>setTimeout(()=>print(),400)<\/script></body></html>`);
  w.document.close();
}

const cache = {};
async function cargar() {
  const caja = $('#resumen-contenido'); if (!caja) return;
  const [m, r, e, c] = await Promise.all([metricas(), recordatorios(), espera(), certificados()].map((p) => p.catch((err) => `<p class="vacio">${B().esc(String(err.message || err))}</p>`)));
  caja.innerHTML = `<div class="tarjeta"><h3>📊 Este mes</h3>${m}</div>
    <div class="tarjeta"><h3>⏰ Recordatorios de mañana</h3>${r}</div>
    <div class="tarjeta"><h3>📝 Lista de espera de cursos</h3>${e}</div>
    <div class="tarjeta"><h3>🎓 Certificados</h3>${c}</div>`;
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button'); if (!t || !$('#tab-resumen') || $('#tab-resumen').hidden) return;
  const { sb, toast } = B();
  if (t.dataset.recordar) {
    const { data: r } = await sb.from('reservas').select('*').eq('id', t.dataset.recordar).single();
    if (!r) return; abrirWa(r.cliente_telefono, textoRecordatorio(r));
    const env = enviados(); env[r.id] = Date.now(); localStorage.setItem(ENV, JSON.stringify(env)); cargar();
  } else if (t.dataset.waCuota) {
    abrirWa(t.dataset.waCuota, `¡Hola ${t.dataset.nombre.split(' ')[0]}! Soy Tania Sanabria 💄. Te recuerdo que tenés pendiente la cuota del curso *${t.dataset.curso}* (${t.dataset.monto}). Cualquier duda escribime. ¡Gracias!`);
  } else if (t.dataset.esperaAvisar) {
    const { data: x } = await sb.from('lista_espera').select('*').eq('id', t.dataset.esperaAvisar).single(); if (!x) return;
    abrirWa(x.telefono, `¡Hola ${x.nombre.split(' ')[0]}! Soy Tania Sanabria 💄. Se liberó un lugar en el curso que esperabas${x.horario ? ' (' + x.horario + ')' : ''}. Si todavía te interesa, inscribite acá: ${SITIO}#academia`);
    await sb.from('lista_espera').update({ estado: 'avisada', actualizado: new Date().toISOString() }).eq('id', x.id); cargar();
  } else if (t.dataset.esperaQuitar) {
    if (!confirm('¿Quitar de la lista de espera?')) return;
    const { error } = await sb.from('lista_espera').update({ estado: 'descartada' }).eq('id', t.dataset.esperaQuitar);
    if (error) toast(error.message, true); cargar();
  } else if (t.dataset.cert) {
    const { data: x } = await sb.from('inscripciones').select('cliente_nombre,curso_nombre').eq('id', t.dataset.cert).single(); if (x) certificado(x);
  }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'cert-buscar') return; const q = ev.target.value.trim().toLowerCase();
  document.querySelectorAll('[data-cert-nombre]').forEach((d) => { d.hidden = q && !d.dataset.certNombre.includes(q); });
});

window.panelExtras = { cargar, alCambiar: () => { if ($('#tab-resumen') && !$('#tab-resumen').hidden) cargar(); } };
