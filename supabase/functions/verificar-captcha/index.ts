// Edge function "verificar-captcha" (opcional, apagada hasta configurar Cloudflare Turnstile).
// 1) Verifica el token de Turnstile con TURNSTILE_SECRET.
// 2) Llama a la RPC pedida (solo crear_reserva / crear_inscripcion / anotar_lista_espera) con el encabezado
//    x-captcha-ok = CAPTCHA_CLAVE y la IP real de la clienta (así siguen valiendo los límites por IP).
// Secretos: supabase secrets set TURNSTILE_SECRET=... CAPTCHA_CLAVE=<clave larga al azar>
// En SQL:   alter database postgres set app.captcha_clave = '<la misma clave>';
//           update public.ajustes_privados set captcha_obligatorio = true where id = 1;
const PERMITIDAS = new Set(['crear_reserva', 'crear_inscripcion', 'anotar_lista_espera']);
const CORS = { 'Access-Control-Allow-Origin': 'https://taniasanabria.github.io', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METODO' }, 405);
  const { fn, args, token } = await req.json().catch(() => ({}));
  if (!PERMITIDAS.has(fn)) return json({ error: 'FUNCION_INVALIDA' }, 400);
  const ip = req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const f = new FormData(); f.append('secret', Deno.env.get('TURNSTILE_SECRET') || ''); f.append('response', String(token || '')); if (ip) f.append('remoteip', ip);
  const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f }).then((r) => r.json()).catch(() => ({ success: false }));
  if (!v.success) return json({ ok: false, error: 'CAPTCHA_INVALIDO' });
  const url = Deno.env.get('SUPABASE_URL')!; const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json',
    'x-captcha-ok': Deno.env.get('CAPTCHA_CLAVE') || '', 'x-forwarded-for': ip }, body: JSON.stringify(args || {}) });
  return new Response(await r.text(), { status: r.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
