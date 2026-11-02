// E2E (navegador real, base LOCAL): guías PDF por clase + liberación semanal + guía oral en Exámenes (admin).
// Uso: tools/probar-aula-semanas.sh && node tools/probar-aula-semanas-e2e.cjs   (servidor http en :8124 sobre el sitio)
const { chromium } = require('/workspace/pwtool/node_modules/playwright');
const { execSync } = require('child_process');
const W = 'http://127.0.0.1:8124';
const psql = (q) => execSync('/usr/lib/postgresql/17/bin/psql -h /tmp -p 54322 -U postgres -d tania -tAq -v ON_ERROR_STOP=1', { input: q }).toString().trim();
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  psql("delete from lecciones; notify pgrst, 'reload schema'"); await sleep(1500);
  execSync(`node tools/subir-materiales.mjs`, { env: { ...process.env, SUPA_URL: 'http://127.0.0.1:54321', SUPA_ANON: require('fs').readFileSync('/workspace/supa-local/anon-key.txt', 'utf8').trim(), ADMIN_EMAIL: 'tanialomaqui18@gmail.com', ADMIN_PASS: 'prueba-local-123' } });
  ok(psql("select count(*) from lecciones where archivo_nombre ~ '^[A-Z]+-M[0-9]+-C[0-9]+-' and semana is not null") === '64', '64 guías PDF cargadas como clases con su semana');
  const b = await chromium.launch(); const errores = [];
  const nueva = async () => { const p = await (await b.newContext({ viewport: { width: 400, height: 860 } })).newPage(); p.on('pageerror', (e) => errores.push(e.message)); p.on('dialog', (d) => d.accept()); return p; };
  const a = await nueva(); await a.goto(W + '/aula/'); await sleep(800);
  await a.click('[data-modo="registro"]'); await a.fill('#a-nombre', 'Caro Semana'); await a.fill('#a-tel', '0981 333 444');
  await a.fill('#a-email', 'caro.sem@example.com'); await a.fill('#a-clave', 'caro-123456'); await a.click('#a-btn'); await sleep(1500);
  const uid = psql("select id from auth.users where email='caro.sem@example.com'");
  psql(`insert into alumnos (email, codigo, user_id) values ('caro.sem@example.com','ABCD-EFGM','${uid}');
    insert into inscripciones (servicio_id, curso_nombre, precio_ref, cliente_nombre, cliente_telefono, cliente_email, acceso, estado, acceso_desde)
    values ('curso-maquillador-inicial','Inicial','-','Caro Semana','0981333444','caro.sem@example.com',true,'pagada', now() - interval '8 days');`);
  await a.goto(W + '/aula/#/curso/curso-maquillador-inicial'); await a.reload(); await sleep(2500);
  const t = await a.locator('#app').innerText(); if (process.env.VER) console.log(t);
  ok(/Clase 1 · Higiene y bioseguridad/.test(t) && /Clase 2 · Herramientas/.test(t), 'semanas 1 y 2 abiertas (aprobada hace 8 días)');
  ok(/Semana 3 · Clase 3 · La piel/.test(t) && /Se abre el/.test(t) && await a.locator('.semana-bloqueada').count() === 2, 'semanas 3 y 4 bloqueadas 🔒 con fecha de apertura');
  ok(await a.locator('.semana-bloqueada [data-leccion]').count() === 0, 'las semanas bloqueadas no se pueden abrir');
  const lid = psql("select id from lecciones where archivo_nombre like 'INI-M1-C1-%'");
  await a.evaluate(() => { window.open = (u) => { window.__abierto = u; return null; }; });
  await a.locator('[data-leccion]').first().click(); await sleep(1500);
  const abierto = await a.evaluate(() => window.__abierto || null);
  let pdfOk = false; if (abierto) { const r = await a.request.get(abierto).catch(() => null); pdfOk = !!r && r.ok() && (await r.body()).slice(0, 4).toString() === '%PDF'; }
  ok(pdfOk, 'la alumna abre la guía PDF de la clase 1 (URL firmada del bucket)');
  const l3 = psql("select id from lecciones where archivo_nombre like 'INI-M1-C3-%'");
  await a.goto(W + '/aula/#/clase/' + l3); await sleep(1500);
  ok(/no está disponible/.test(await a.locator('#app').innerText()), 'abrir por enlace directo una clase de semana cerrada: bloqueado');
  // Admin: guía oral en Exámenes
  const tn = await nueva(); await tn.goto(W + '/aula/'); await sleep(800);
  await tn.fill('#a-email', 'tanialomaqui18@gmail.com'); await tn.fill('#a-clave', 'prueba-local-123'); await tn.click('#a-btn'); await sleep(2000);
  await tn.goto(W + '/aula/#/admin/examenes'); await sleep(2000);
  const tx = await tn.locator('#app').innerText();
  ok(/Guía de preguntas orales/.test(tx) && await tn.locator('details.guia-oral').count() >= 10, 'Tania ve la guía de preguntas orales por curso y mes');
  await tn.goto(W + '/aula/#/admin/materiales'); await sleep(1500);
  ok(await tn.locator('#m-semana').count() === 1, 'formulario de materiales con campo Semana');
  ok(!errores.length, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await b.close();
})();
