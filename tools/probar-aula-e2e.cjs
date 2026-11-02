// E2E del Aula (navegador real) contra Supabase LOCAL. MODO=sin → base SIN la migración del aula (debe seguir andando).
// Uso: MODO=con|sin node tools/probar-aula-e2e.cjs   (requiere /workspace/supa-local y un servidor http en :8124 sobre el sitio)
const { chromium } = require('/workspace/pwtool/node_modules/playwright');
const { execSync } = require('child_process'); const fs = require('fs');
const W = 'http://127.0.0.1:8124', MODO = process.env.MODO || 'con';
const psql = (q) => execSync('/usr/lib/postgresql/17/bin/psql -h /tmp -p 54322 -U postgres -d tania -tAq -v ON_ERROR_STOP=1', { input: q }).toString().trim();
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + `[${MODO}] ` + m); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errores = [];
  const nueva = async () => { const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, permissions: ['camera'] }); const p = await ctx.newPage();
    p.on('pageerror', (e) => errores.push(e.message)); p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'No llegó' : undefined)); return p; };
  // Home: acceso al aula, sin botón suelto de WhatsApp
  const h = await nueva(); await h.goto(W + '/'); await sleep(800);
  ok(await h.locator('a.enlace-aula[href="aula/"]').count() === 1, 'cabecera con acceso "Aula Virtual"');
  ok(await h.locator('.banner-aula a[href="aula/"]').count() === 1, 'banner del Aula en la sección Academia');
  ok(await h.locator('a.whatsapp-flotante, .btn-whatsapp-flotante, a.wa-flotante').count() === 0, 'sin botón flotante de WhatsApp');
  // Alumna: crea cuenta en el aula
  const a = await nueva(); await a.goto(W + '/aula/'); await sleep(800);
  await a.click('[data-modo="registro"]'); await a.fill('#a-nombre', 'Ana Prueba'); await a.fill('#a-tel', '0981 555 444');
  await a.fill('#a-email', 'ana.e2e@example.com'); await a.fill('#a-clave', 'ana-123456'); await a.click('#a-btn'); await sleep(1500);
  // Tania le dio acceso (matrícula) al nivel "regular" de Artístico
  const uid = psql("select id from auth.users where email='ana.e2e@example.com'");
  psql(`insert into alumnos (email, codigo, user_id) values ('ana.e2e@example.com','ABCD-EFGK','${uid}');
    insert into inscripciones (id, servicio_id, variante_id, curso_nombre, precio_ref, cliente_nombre, cliente_telefono, cliente_email, acceso, estado)
    values ('bbbbbbbb-0000-0000-0000-000000000001','curso-maquillaje-artistico','curso-artistico-regular','Artístico regular','Gs. 500.000 / mes','Ana Prueba','0981555444','ana.e2e@example.com',true,'pagada');
    insert into lecciones (servicio_id, modulo, titulo, tipo, url ${MODO === 'con' ? ', mes, variante_id' : ''}) values
      ('curso-maquillaje-artistico','Módulo 1','Clase mes uno','enlace','https://example.com/1' ${MODO === 'con' ? ",1,null" : ''})
      ${MODO === 'con' ? ",('curso-maquillaje-artistico','Módulo 2','Clase mes dos','enlace','https://example.com/2',2,null),('curso-maquillaje-artistico','Módulo 1','Clase de masterclass','enlace','https://example.com/3',1,'curso-artistico-masterclass')" : ''};`);
  await a.reload(); await sleep(1500);
  await a.goto(W + '/aula/#/curso/curso-maquillaje-artistico'); await sleep(1500);
  const txt = await a.locator('#app').innerText();
  ok(/Clase mes uno/.test(txt), 've la clase del mes 1');
  ok(/no uses inteligencia artificial/i.test(txt) && /volver a presentarla/i.test(txt), 'aviso visible de IA con derecho a volver a presentar');
  await a.click('[data-tab="examen"]'); ok(/videollamada de WhatsApp/.test(await a.locator('#tab-examen').innerText()), 'pestaña Examen: por videollamada de WhatsApp (dentro del aula)');
  if (MODO === 'con') {
    ok(!/Clase mes dos/.test(txt), 'NO ve la clase del mes 2 (sin pago confirmado)');
    ok(!/Clase de masterclass/.test(txt), 'NO ve material de otro nivel');
    ok(/Mes 2/.test(txt) && await a.locator('.modulo.bloqueado').count() === 1, 'mes 2 se muestra bloqueado 🔒');
    // pedir examen
    await a.fill('#x-pref', 'martes de tarde'); await a.click('#f-examen button'); await sleep(1000);
    ok(psql("select count(*) from aula_examenes where estado='solicitado'") === '1', 'pidió examen por videollamada');
    // pagar mes 2: primero confirma intención, recién ahí ve los datos bancarios
    await a.goto(W + '/aula/#/pagar/bbbbbbbb-0000-0000-0000-000000000001'); await sleep(1000);
    ok(await a.locator('.datos-pago').count() === 0, 'datos bancarios ocultos antes de confirmar');
    await a.click('#pago-quiero'); await sleep(800);
    ok(await a.locator('.datos-pago').count() === 1, 'datos bancarios visibles después de confirmar');
    fs.writeFileSync('/tmp/comprobante.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    await a.setInputFiles('#pago-file', '/tmp/comprobante.png'); await a.click('#pago-btn'); await sleep(1500);
    ok(psql("select mes||':'||estado from aula_pagos") === '2:pendiente', 'comprobante del mes 2 registrado como pendiente');
    await a.goto(W + '/aula/#/curso/curso-maquillaje-artistico'); await sleep(1200);
    ok(!/Clase mes dos/.test(await a.locator('#app').innerText()), 'con comprobante pendiente el mes 2 sigue bloqueado');
    // entrega con cámara en vivo (cámara falsa de Chromium)
    await a.goto(W + '/aula/#/entregar/curso-maquillaje-artistico'); await sleep(800);
    ok(await a.locator('#app input[type=file]').count() === 0 && await a.locator('#cam-respaldo').count() === 0, 'entrega sin selector de archivos/galería');
    await a.fill('#e-titulo', 'Práctica uno'); await a.click('#abrir-cam'); await sleep(2000);
    await a.click('#cam-disparo'); await sleep(600); await a.click('#cam-usar'); await sleep(300); await a.click('#cam-listo'); await sleep(400);
    await a.click('#e-btn'); await sleep(2000);
    ok(psql("select mes||':'||(captura->>'origen')||':'||(captura->'fotos'->0->>'origen') from entregas") === '1:camara-en-vivo:camara-en-vivo', 'entrega guardada con mes 1 y metadatos de cámara en vivo');
    // Tania: confirma el pago y anula por IA
    const t = await nueva(); await t.goto(W + '/aula/'); await sleep(800);
    await t.fill('#a-email', 'tanialomaqui18@gmail.com'); await t.fill('#a-clave', 'prueba-local-123'); await t.click('#a-btn'); await sleep(1800);
    await t.goto(W + '/aula/#/admin/pagos'); await sleep(1500);
    ok(/Pagos y exámenes/.test(await t.locator('#app').innerText()), 'Tania ve Pagos y exámenes');
    await t.click('[data-ok]'); await sleep(1200);
    ok(psql("select meses_habilitados from inscripciones where id='bbbbbbbb-0000-0000-0000-000000000001'") === '2', 'Tania confirmó: mes 2 habilitado');
    await t.goto(W + '/aula/#/admin'); await sleep(1200); await t.click('[data-ia]'); await sleep(1200);
    ok(psql("select estado from entregas") === 'anulada_ia', 'Tania anuló la clase por IA');
    await a.goto(W + '/aula/#/curso/curso-maquillaje-artistico?trabajos'); await a.reload(); await sleep(1500);
    ok(/Clase mes dos/.test(await a.locator('#tab-clases').innerText()), 'alumna ya ve el mes 2');
    ok(/Anulada por uso de IA/i.test(await a.locator('#tab-trabajos').innerText()) && await a.locator('a:has-text("Volver a presentar")').count() === 1, 'alumna ve "Anulada por uso de IA" y puede volver a presentar');
    // panel /admin/: sección Aula
    const pa = await nueva(); await pa.goto(W + '/admin/'); await sleep(800);
    ok(fs.readFileSync('/workspace/taniasanabria/site/admin/index.html', 'utf8').includes('aula-admin.js'), 'panel carga aula-admin.js');
    await pa.close();
  }
  ok(!errores.length, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
