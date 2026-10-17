// Web Push sin dependencias (solo WebCrypto): cifrado aes128gcm (RFC 8291) + autenticación VAPID (RFC 8292).
// Funciona igual en Deno (Supabase Edge Functions), en Node 20+ y en navegadores.
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function deB64u(texto) {
  const t = String(texto).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function unir(...partes) {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}
async function hmac(clave, datos) {
  const k = await subtle.importKey('raw', clave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, datos));
}

/** Genera un par de claves VAPID: { publicKey, privateKey } en base64url (formato de la librería web-push). */
export async function generarClavesVapid() {
  const par = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await subtle.exportKey('raw', par.publicKey));
  const jwk = await subtle.exportKey('jwk', par.privateKey);
  return { publicKey: b64u(pub), privateKey: jwk.d };
}

async function claveVapid(publica, privada) {
  const pub = deB64u(publica);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY inválida');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: privada, ext: true };
  return subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** Cabecera Authorization VAPID para un endpoint. */
export async function cabeceraVapid(endpoint, { publicKey, privateKey, subject }) {
  const aud = new URL(endpoint).origin;
  const cab = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const cuerpo = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const firma = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await claveVapid(publicKey, privateKey), enc.encode(`${cab}.${cuerpo}`));
  return `vapid t=${cab}.${cuerpo}.${b64u(firma)}, k=${publicKey}`;
}

/** Cifra el mensaje para una suscripción ({ keys: { p256dh, auth } }). Devuelve el cuerpo binario aes128gcm. */
export async function cifrar(suscripcion, texto) {
  const uaPub = deB64u(suscripcion.keys.p256dh);
  const auth = deB64u(suscripcion.keys.auth);
  const efimera = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await subtle.exportKey('raw', efimera.publicKey));
  const uaClave = await subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secreto = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaClave }, efimera.privateKey, 256));
  // RFC 8291 §3.4
  const prkClave = await hmac(auth, secreto);
  const ikm = await hmac(prkClave, unir(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const sal = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(sal, ikm);
  const cek = (await hmac(prk, unir(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, unir(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const datos = unir(enc.encode(texto), new Uint8Array([2])); // 0x02 = último (y único) registro
  const k = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, datos));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return unir(sal, rs, new Uint8Array([asPub.length]), asPub, cifrado);
}

/**
 * Envía una notificación push. Devuelve { ok, status, expirada } (expirada = la suscripción ya no existe: borrarla).
 * vapid = { publicKey, privateKey, subject }  (subject: "mailto:…" o una URL https)
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} suscripcion
 * @param {string | object} mensaje
 * @param {{ publicKey: string, privateKey: string, subject: string }} vapid
 * @param {{ ttl?: number, urgencia?: string, tema?: string }} [opciones]
 */
export async function enviarPush(suscripcion, mensaje, vapid, { ttl = 86400, urgencia = 'high', tema } = {}) {
  const cuerpo = await cifrar(suscripcion, typeof mensaje === 'string' ? mensaje : JSON.stringify(mensaje));
  /** @type {Record<string, string>} */
  const cab = {
    Authorization: await cabeceraVapid(suscripcion.endpoint, vapid),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgencia,
  };
  if (tema) cab.Topic = tema;
  const r = await fetch(suscripcion.endpoint, { method: 'POST', headers: cab, body: cuerpo });
  const detalle = r.ok ? '' : (await r.text().catch(() => '')).slice(0, 300);
  return { ok: r.ok, status: r.status, expirada: r.status === 404 || r.status === 410, detalle };
}
