// Edge Function "avisar-aula": push al celular de Tania cuando una alumna del aula presenta un trabajo, pide/entrega un examen o sube un comprobante.
// POST { id } → lo llama el trigger de la base (pg_net) con el id de la fila de public.avisos_tania. Avisa UNA sola vez (push_enviado)
// y solo si el aviso es reciente (≤15 min). Usa los mismos secretos VAPID y los mismos dispositivos (push_suscripciones) que avisar-reserva.
import { enviarPush } from './webpush.js';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID = {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  subject: Deno.env.get('VAPID_SUBJECT') ?? 'https://taniasanabria.github.io/',
};
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function rest(ruta: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_SB}/rest/v1/${ruta}`, { ...init, headers: { apikey: SERVICIO, Authorization: `Bearer ${SERVICIO}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${ruta}: ${texto.slice(0, 200)}`);
  return texto ? JSON.parse(texto) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405);
  if (!VAPID.publicKey || !VAPID.privateKey) return json({ error: 'faltan las claves VAPID' }, 500);
  let id = '';
  try { id = String((await req.json()).id ?? ''); } catch { /* cuerpo inválido */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'id inválido' }, 400);
  try {
    // Marca "enviado" de forma atómica: si dos llamadas llegan juntas, solo una sigue.
    const limite = new Date(Date.now() - 15 * 60000).toISOString();
    const [a] = (await rest(`avisos_tania?id=eq.${id}&push_enviado=eq.false&creado=gte.${encodeURIComponent(limite)}`, {
      method: 'PATCH', body: JSON.stringify({ push_enviado: true }), headers: { Prefer: 'return=representation' },
    })) ?? [];
    if (!a) return json({ enviado: 0, motivo: 'no corresponde o ya avisada' });
    const mensaje = { titulo: a.titulo, cuerpo: a.cuerpo, url: a.url, tag: `aula-${a.id}` };
    const subs = await rest('push_suscripciones?select=endpoint,p256dh,auth');
    let enviado = 0; const errores: string[] = [];
    await Promise.all(subs.map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
      try {
        const res = await enviarPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, mensaje, VAPID, { tema: 'aula' });
        if (res.ok) { enviado++; await rest(`push_suscripciones?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'PATCH', body: JSON.stringify({ ultimo_envio: new Date().toISOString() }) }); }
        else if (res.expirada) await rest(`push_suscripciones?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' });
        else errores.push(`${res.status} ${res.detalle}`);
      } catch (e) { errores.push(String(e)); }
    }));
    if (errores.length) console.error('push con error:', errores);
    return json({ enviado, dispositivos: subs.length, errores: errores.length });
  } catch (e) { console.error(e); return json({ error: String(e) }, 500); }
});
