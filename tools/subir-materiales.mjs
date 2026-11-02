// Sube las guías PDF de cada clase (materiales/pdf + indice.json) al bucket "cursos" y crea/actualiza la clase en "lecciones".
// Idempotente: si la clase (curso + nivel + mes + título) ya existe, reemplaza su PDF. Solo con una cuenta de ADMIN.
// Uso: ADMIN_EMAIL=... ADMIN_PASS=... node tools/subir-materiales.mjs [/ruta/a/materiales/pdf]
//      (SUPA_URL y SUPA_ANON opcionales: por defecto, el proyecto de producción de js/config.js)
import fs from 'node:fs'; import crypto from 'node:crypto';
const cfg = fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
const URL_ = process.env.SUPA_URL || cfg.match(/"url":\s*"([^"]+)"/)[1];
const ANON = process.env.SUPA_ANON || cfg.match(/"anonKey":\s*"([^"]+)"/)[1];
const DIR = process.argv[2] || '/workspace/taniasanabria/materiales/pdf';
const indice = JSON.parse(fs.readFileSync(`${DIR}/indice.json`, 'utf8'));
const r0 = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASS }) });
const ses = await r0.json(); if (!ses.access_token) { console.error('No se pudo iniciar sesión:', ses.error_description || ses.msg || r0.status); process.exit(1); }
const H = { apikey: ANON, Authorization: `Bearer ${ses.access_token}` };
const rest = async (path, opt = {}) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { ...opt, headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opt.headers || {}) } });
  const t = await r.text(); if (!r.ok) throw new Error(`${r.status} ${t}`); return t ? JSON.parse(t) : null; };
let nuevas = 0, reemplazadas = 0;
for (const it of indice) {
  const filtro = `servicio_id=eq.${it.servicio_id}&mes=eq.${it.mes}&titulo=eq.${encodeURIComponent(it.titulo)}&variante_id=${it.variante_id ? 'eq.' + it.variante_id : 'is.null'}`;
  const previa = (await rest(`lecciones?select=id,archivo&${filtro}`))[0];
  const blob = fs.readFileSync(`${DIR}/${it.archivo}`); const ruta = `${it.servicio_id}/${crypto.randomUUID()}.pdf`;
  const up = await fetch(`${URL_}/storage/v1/object/cursos/${ruta}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: blob });
  if (!up.ok) throw new Error(`Storage ${up.status} ${await up.text()} (${it.archivo})`);
  const fila = { servicio_id: it.servicio_id, variante_id: it.variante_id, mes: it.mes, modulo: it.modulo, titulo: it.titulo, descripcion: it.descripcion,
    semana: (it.mes - 1) * 4 + it.clase, tipo: 'archivo', url: null, archivo: ruta, archivo_nombre: it.archivo, archivo_bytes: blob.length, activo: true };
  if (previa) {
    await rest(`lecciones?id=eq.${previa.id}`, { method: 'PATCH', body: JSON.stringify(fila) });
    if (previa.archivo) await fetch(`${URL_}/storage/v1/object/cursos`, { method: 'DELETE', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [previa.archivo] }) });
    reemplazadas++;
  } else { await rest('lecciones', { method: 'POST', body: JSON.stringify({ ...fila, orden: it.mes * 100 + it.clase * 10 }) }); nuevas++; }
  process.stdout.write(`✓ ${it.codigo}\n`);
}
console.log(`Listo: ${nuevas} clases nuevas, ${reemplazadas} PDF reemplazados (${indice.length} en total).`);
