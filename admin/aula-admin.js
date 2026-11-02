// Panel → pestaña Cursos → "Aula Virtual (online)": comprobantes de cuotas mensuales, exámenes por videollamada
// y trabajos sin corregir, en tiempo real. Materiales y correcciones se hacen en /aula/ (misma cuenta).
// Requiere supabase/migracion-aula-2026-11-02.sql; si falta, la sección queda oculta y no afecta nada.
const B = () => window.panelBase;
const $ = (s, r = document) => r.querySelector(s);
const gs = (n) => 'Gs. ' + Math.round(n || 0).toLocaleString('es-PY');
const fh = (t) => new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));
let canal = null, t = null;

async function cargar() {
  const caja = $('#aula-admin'); if (!caja || !B()?.sb) return;
  const { sb, esc } = B();
  const [p, x, e] = await Promise.all([sb.rpc('admin_pagos_aula', { p_estado: 'pendiente' }), sb.rpc('admin_examenes_aula'), sb.rpc('admin_entregas', { p_curso: null, p_estado: 'enviada' })]);
  if (p.error) { caja.hidden = true; return; }
  caja.hidden = false;
  const ex = (x.data || []).filter((r) => r.estado === 'solicitado' || r.estado === 'agendado');
  // Progresión por mérito (si ya está la migración): exámenes para corregir y alumnas atrasadas
  const [x2, sg] = await Promise.all([sb.rpc('admin_examenes_aula2'), sb.rpc('admin_aula_seguimiento')]);
  const exCorr = x2.error ? [] : (x2.data || []).filter((r) => r.estado === 'entregado');
  const atras = sg.error ? [] : (sg.data || []).filter((r) => r.atrasada);
  $('#aula-admin-cuerpo').innerHTML = `
    <p class="suave">Pagos por confirmar: <strong>${p.data.length}</strong> · Exámenes pedidos/agendados: <strong>${ex.length}</strong> · Trabajos sin corregir: <strong>${(e.data || []).length}</strong></p>
    ${p.data.map((r) => `<div class="tarjeta-simple" style="border:1px solid var(--linea,#e8dfcf);border-radius:12px;padding:.6rem .8rem;margin:.4rem 0">
      <strong>${esc(r.nombre)}</strong> · ${esc(r.curso)} · <b>mes ${r.mes}</b>${r.monto_gs ? ' · ' + gs(r.monto_gs) : ''} · ${fh(r.creado)}${r.nota ? '<br>💬 ' + esc(r.nota) : ''}
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem"><button type="button" class="btn btn-borde" data-aula-ver="${esc(r.ruta)}">🔍 Ver comprobante</button>
      <button type="button" class="btn btn-aprobar" data-aula-ok="${r.id}">✅ Pago recibido: abrir mes ${r.mes}</button><button type="button" class="btn btn-borde" data-aula-no="${r.id}">No llegó</button></div></div>`).join('')}
    ${ex.map((r) => `<p>🎥 <strong>${esc(r.nombre || r.email)}</strong> · examen ${esc(r.curso || '')} (mes ${r.mes}) · ${r.estado === 'agendado' && r.fecha ? 'agendado ' + fh(r.fecha) : 'pidió fecha' + (r.preferencia ? ': ' + esc(r.preferencia) : '')}</p>`).join('')}
    ${exCorr.map((r) => `<p>📝 <strong>${esc(r.nombre || r.email)}</strong> subió su examen de ${esc(r.curso || '')} (mes ${r.mes}): <a href="../aula/#/admin/examenes" target="_blank" rel="noopener">corregir</a></p>`).join('')}
    ${atras.length ? `<p>⏰ Atrasadas: ${atras.map((r) => `<strong>${esc(r.nombre)}</strong> (${esc(r.curso)}, mes ${r.mes}: ${r.aprobadas}/${r.clases})`).join(', ')} · <a href="../aula/#/admin/seguimiento" target="_blank" rel="noopener">ver seguimiento</a></p>` : ''}
    <p><a class="btn btn-borde" href="../aula/#/admin/pagos" target="_blank" rel="noopener">Abrir pagos y exámenes</a> <a class="btn btn-borde" href="../aula/#/admin/materiales" target="_blank" rel="noopener">Subir PDF por mes y nivel</a> <a class="btn btn-borde" href="../aula/#/admin" target="_blank" rel="noopener">Corregir trabajos</a></p>`;
  if (!canal) {
    const refrescar = () => { clearTimeout(t); t = setTimeout(cargar, 300); };
    canal = sb.channel('panel-aula').on('postgres_changes', { event: '*', schema: 'public', table: 'aula_pagos' }, refrescar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aula_examenes' }, refrescar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entregas' }, refrescar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aula_certificados' }, refrescar).subscribe();
  }
}

document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-aula-ver],[data-aula-ok],[data-aula-no]'); if (!b) return;
  const { sb, toast } = B();
  if (b.dataset.aulaVer) {
    const { data, error } = await sb.storage.from('pagos-aula').createSignedUrl(b.dataset.aulaVer, 600);
    if (error) return toast('No se pudo abrir el comprobante.', true); window.open(data.signedUrl, '_blank', 'noopener'); return;
  }
  const ok = !!b.dataset.aulaOk; const id = b.dataset.aulaOk || b.dataset.aulaNo;
  const resp = ok ? null : prompt('Mensaje para la alumna:', 'No pudimos confirmar la transferencia. Revisá el comprobante y volvé a enviarlo.');
  if (!ok && resp === null) return;
  b.disabled = true;
  const { error } = await sb.rpc('admin_revisar_pago_aula', { p_id: id, p_ok: ok, p_respuesta: resp });
  if (error) { b.disabled = false; return toast(error.message, true); }
  toast(ok ? 'Pago confirmado: el mes ya está abierto en el aula ✓' : 'Comprobante rechazado'); cargar();
});

// Espera a que el panel inicie sesión (panelBase.sb listo) y carga.
const espera = setInterval(async () => { const b = B(); if (!b?.sb) return; const { data } = await b.sb.auth.getSession(); if (data.session) { clearInterval(espera); cargar(); } }, 1500);
window.panelAula = { cargar };
