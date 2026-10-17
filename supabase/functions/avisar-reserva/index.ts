// Edge Function "avisar-reserva": manda una notificación push al celular de Tania cuando entra una solicitud nueva.
//
//  GET  → { vapidPublicKey }  (el panel la usa para suscribirse; es pública)
//  POST { id }  → lo llama el trigger de la base (pg_net) al insertarse una reserva desde la web.
//
// No necesita clave secreta para llamarla: solo recibe el id, lee la reserva con la service key y
// envía UNA sola vez por reserva (tabla avisos_enviados), y solo si está pendiente y es reciente.
// Secretos (solo en Supabase → Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase automáticamente.
import { enviarPush } from './webpush.js';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID = {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  subject: Deno.env.get('VAPID_SUBJECT') ?? 'https://taniasanabria.github.io/',
};
const ZONA = 'Etc/GMT+3';
const PANEL = 'https://taniasanabria.github.io/admin/#citas';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function rest(ruta: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_SB}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: SERVICIO, Authorization: `Bearer ${SERVICIO}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${ruta}: ${texto.slice(0, 200)}`);
  return texto ? JSON.parse(texto) : null;
}

const fmt = (d: Date, op: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-PY', { timeZone: ZONA, ...op }).format(d);
function cuando(r: Record<string, string | null>) {
  if (r.inicio) {
    const d = new Date(r.inicio);
    return `${fmt(d, { weekday: 'long', day: 'numeric', month: 'numeric' })} · ${fmt(d, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  if (r.fecha_preferida) {
    const d = new Intl.DateTimeFormat('es-PY', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'numeric' }).format(new Date(r.fecha_preferida + 'T12:00:00Z'));
    return `${d} · ${r.hora_preferida && r.hora_preferida !== 'a coordinar' ? r.hora_preferida : 'hora a coordinar'}`;
  }
  return 'fecha a coordinar';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET') return json({ vapidPublicKey: VAPID.publicKey || null });
  if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405);
  if (!VAPID.publicKey || !VAPID.privateKey) return json({ error: 'faltan las claves VAPID' }, 500);

  let id = '';
  try { id = String((await req.json()).id ?? ''); } catch { /* cuerpo inválido */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'id inválido' }, 400);

  try {
    const [r] = await rest(`reservas?id=eq.${id}&select=*`);
    if (!r) return json({ enviado: 0, motivo: 'no existe' });
    const edadMin = (Date.now() - new Date(r.creado).getTime()) / 60000;
    if (r.estado !== 'pendiente' || edadMin > 15) return json({ enviado: 0, motivo: 'no corresponde' });
    // Una sola vez por reserva: si ya existe la fila, no se vuelve a avisar.
    const marcadas = await rest('avisos_enviados?on_conflict=reserva_id', {
      method: 'POST', body: JSON.stringify({ reserva_id: id }),
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    });
    if (!marcadas?.length) return json({ enviado: 0, motivo: 'ya avisada' });

    const pendientes = (await rest('reservas?estado=eq.pendiente&select=id')).length;
    const mensaje = {
      titulo: `Nueva solicitud: ${r.servicio_nombre}`,
      cuerpo: `${r.cliente_nombre} · ${cuando(r)}${r.costo_extra ? ' · costo adicional' : ''}\nTocá para aprobar o rechazar.`,
      url: PANEL, tag: `reserva-${id}`, pendientes,
    };
    const subs = await rest('push_suscripciones?select=endpoint,p256dh,auth');
    let enviado = 0; const errores: string[] = [];
    await Promise.all(subs.map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        const res = await enviarPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, mensaje, VAPID, { tema: 'reservas' });
        if (res.ok) { enviado++; await rest(`push_suscripciones?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'PATCH', body: JSON.stringify({ ultimo_envio: new Date().toISOString() }) }); }
        else if (res.expirada) await rest(`push_suscripciones?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' });
        else errores.push(`${res.status} ${res.detalle}`);
      } catch (e) { errores.push(String(e)); }
    }));
    if (errores.length) console.error('push con error:', errores);
    return json({ enviado, dispositivos: subs.length, errores: errores.length });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
