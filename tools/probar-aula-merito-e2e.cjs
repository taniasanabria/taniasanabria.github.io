// E2E de la progresión por mérito (navegador real + cámara falsa de Chromium) contra Supabase LOCAL con las 3 migraciones.
const { chromium } = require('/workspace/pwtool/node_modules/playwright');
const { execSync } = require('child_process');
const W = 'http://127.0.0.1:8124';
const psql = (q) => execSync('/usr/lib/postgresql/17/bin/psql -h /tmp -p 54322 -U postgres -d tania -tAq -v ON_ERROR_STOP=1', { input: q }).toString().trim();
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + '[mérito] ' + m); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errores = [];
  const nueva = async () => { const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, permissions: ['camera', 'microphone'] }); const p = await ctx.newPage();
    p.on('pageerror', (e) => errores.push(e.message)); p.on('dialog', (d) => d.accept()); return p; };
  const C = 'curso-maquillaje-artistico';
  const a = await nueva(); await a.goto(W + '/aula/'); await sleep(800);
  await a.click('[data-modo="registro"]'); await a.fill('#a-nombre', 'Ana Mérito'); await a.fill('#a-tel', '0981 555 444');
  await a.fill('#a-email', 'ana.m@example.com'); await a.fill('#a-clave', 'ana-123456'); await a.click('#a-btn'); await sleep(1500);
  const uid = psql("select id from auth.users where email='ana.m@example.com'");
  psql(`insert into alumnos (email, codigo, user_id) values ('ana.m@example.com','ABCD-EFGK','${uid}');
    insert into inscripciones (id, servicio_id, variante_id, curso_nombre, precio_ref, cliente_nombre, cliente_telefono, cliente_email, acceso, estado)
    values ('bbbbbbbb-0000-0000-0000-000000000001','${C}','curso-artistico-regular','Artístico regular','Gs. 500.000 / mes','Ana Mérito','0981555444','ana.m@example.com',true,'pagada');
    insert into lecciones (id, servicio_id, modulo, titulo, tipo, url, mes) values ('00000000-0000-0000-0000-0000000000b1','${C}','Módulo 1','Práctica ojos','enlace','https://example.com/1',1),
      ('00000000-0000-0000-0000-0000000000b2','${C}','Módulo 2','Práctica mes dos','enlace','https://example.com/2',2);`);
  await a.reload(); await sleep(1500);
  await a.goto(W + `/aula/#/curso/${C}`); await sleep(1500);
  let txt = await a.locator('#app').innerText();
  ok(/0 de 1 clases aprobadas/.test(txt), 'barra de progreso: "0 de 1 clases aprobadas"');
  ok(!/Práctica mes dos/.test(txt) && /Se abre cuando/.test(txt), 'mes 2 bloqueado con los requisitos por mérito');
  ok(!(await a.locator('#f-examen').count()), 'no se puede pedir examen sin clases aprobadas');
  await a.click('a:has-text("Cuestionario + práctica")'); await sleep(1500);
  const nq = await a.locator('#f-quiz fieldset').count(); ok(nq === 4, 'mini cuestionario de 4 preguntas antes de la práctica');
  for (let i = 0; i < nq; i++) await a.locator(`#f-quiz input[name=q${i}]`).first().check();
  await a.click('#f-quiz button'); await sleep(1200);
  ok(/Resultado: \d de 4/.test(await a.locator('#app').innerText()), 'cuestionario corregido automáticamente');
  await a.click('#q-seguir'); await sleep(1000);
  await a.fill('#e-titulo', 'Ojos ahumados'); await a.click('#abrir-cam'); await sleep(2000);
  await a.click('#cam-disparo'); await sleep(600); await a.click('#cam-usar'); await sleep(300); await a.click('#cam-listo'); await sleep(400);
  await a.click('#e-btn'); await sleep(2000);
  ok(psql("select leccion_id is not null and captura ? 'dispositivo' from entregas") === 't', 'entrega vinculada a la clase, con huella del dispositivo');
  // Tania corrige con rúbrica
  const t = await nueva(); await t.goto(W + '/aula/'); await sleep(800);
  await t.fill('#a-email', 'tanialomaqui18@gmail.com'); await t.fill('#a-clave', 'prueba-local-123'); await t.click('#a-btn'); await sleep(2000);
  await t.goto(W + '/aula/#/admin'); await sleep(1500);
  ok(await t.locator('.entrega [data-crit]').count() === 5, 'rúbrica de 5 criterios al corregir');
  for (const g of await t.locator('.entrega [data-crit]').all()) await g.locator('[data-n="4"]').click();
  await t.click('[data-guardar]'); await sleep(1500);
  ok(psql("select estado||':'||calificacion||':'||(rubrica->>'Piel') from entregas") === 'corregida:4:4', 'clase aprobada con rúbrica');
  await a.goto(W + `/aula/#/curso/${C}?examen`); await a.reload(); await sleep(1800);
  ok(/1 de 1 clases aprobadas/i.test(await a.locator('#app').innerText()), 'progreso: 1 de 1 aprobadas');
  await a.fill('#x-pref', 'jueves'); await a.click('#f-examen button'); await sleep(1200);
  ok(psql("select estado from aula_examenes") === 'solicitado', 'pidió el examen del mes 1');
  // Tania genera el código al empezar la videollamada
  await t.goto(W + '/aula/#/admin/examenes'); await sleep(1500);
  await t.click('[data-codigo]'); await sleep(1200);
  const cod = (await t.locator('[data-codigo-valor]').innerText()).trim(); ok(/^\d{4}$/.test(cod), 'Tania ve el código de 4 dígitos con cuenta regresiva');
  await a.reload(); await sleep(1800);
  await a.fill('#x-codigo', cod === '0000' ? '1111' : '0000'); await a.click('#x-entrar'); await sleep(1000);
  ok(!(await a.locator('[data-foto]').count()), 'código incorrecto: no deja subir');
  await a.fill('#x-codigo', cod); await a.click('#x-entrar'); await sleep(1200);
  ok(await a.locator('[data-foto]').count() === 3, 'código correcto: pide las 3 fotos (sin maquillaje, mitad, final)');
  for (const k of ['sin', 'mitad', 'final']) {
    await a.click(`[data-foto="${k}"]`); await sleep(1800);
    if (k !== 'sin') ok(await a.locator('#cam-fantasma').isVisible(), `foto "${k}": guía con la primera foto para el mismo encuadre`);
    await a.click('#cam-disparo'); await sleep(600); await a.click('#cam-usar'); await sleep(800);
  }
  await a.click('#x-video'); await sleep(1800); await a.click('#cam-disparo'); await sleep(31500); await a.click('#cam-listo'); await sleep(1500);
  ok(/s grabados/.test(await a.locator('#app').innerText()), 'video de 30+ s grabado con la cámara (MediaRecorder)');
  await a.click('#x-enviar'); await sleep(3000);
  ok(psql("select estado||':'||cardinality(fotos)||':'||(video is not null) from aula_examenes") === 'entregado:3:true', 'examen subido: 3 fotos + video');
  // Tania califica el examen
  await t.goto(W + '/aula/#/admin/examenes'); await t.reload(); await sleep(1800);
  ok(await t.locator('video[data-video]').count() === 1, 'Tania ve el video del examen');
  for (const g of await t.locator('[data-ex] [data-crit]').all()) await g.locator('[data-n="5"]').click();
  await t.fill('[data-ex] [data-com]', '¡Muy bien!'); await t.click('[data-aprobar]'); await sleep(1500);
  ok(psql("select estado from aula_examenes") === 'aprobado', 'examen aprobado con rúbrica y comentario');
  ok(psql("select meses_habilitados from inscripciones where id='bbbbbbbb-0000-0000-0000-000000000001'") === '1', 'aprobado pero sin pago confirmado: mes 2 sigue cerrado');
  psql(`insert into storage.objects (bucket_id, name) values ('pagos-aula','${uid}/99999999-9999-9999-9999-999999999999.jpg');
    insert into aula_pagos (inscripcion_id, user_id, mes, ruta) values ('bbbbbbbb-0000-0000-0000-000000000001','${uid}',2,'${uid}/99999999-9999-9999-9999-999999999999.jpg');`);
  await t.goto(W + '/aula/#/admin/pagos'); await sleep(1500); await t.click('[data-ok]'); await sleep(1500);
  ok(psql("select meses_habilitados from inscripciones where id='bbbbbbbb-0000-0000-0000-000000000001'") === '2', 'examen aprobado + pago confirmado: mes 2 abierto');
  await a.goto(W + `/aula/#/curso/${C}`); await a.reload(); await sleep(1800);
  ok(/Práctica mes dos/.test(await a.locator('#app').innerText()), 'la alumna ya ve el mes 2');
  // Portafolio
  await a.goto(W + '/aula/#/notas'); await sleep(1200); await a.locator('[data-porta]').first().check(); await sleep(1000);
  await a.goto(W + '/aula/#/portafolio'); await sleep(1000);
  ok(/Ojos ahumados/.test(await a.locator('#app').innerText()), 'portafolio privado con el trabajo elegido');
  // Seguimiento, plazos y certificado
  psql(`insert into aula_plazos values ('${C}', 2, current_date - 1)`);
  await t.goto(W + '/aula/#/admin/seguimiento'); await sleep(1500);
  ok(/Atrasada/.test(await t.locator('#app').innerText()), 'seguimiento marca atrasada (plazo vencido)');
  await t.click('[data-cert]'); await sleep(1500);
  const cert = psql('select codigo from aula_certificados'); ok(/^TS-/.test(cert), 'certificado emitido con código');
  const v = await nueva(); await v.goto(W + '/verificar/?codigo=' + cert); await sleep(1500);
  const vt = await v.locator('#r').innerText(); ok(/Certificado válido/.test(vt) && /Ana Mérito/.test(vt) && !/0981|@/.test(vt), 'verificación pública: nombre, curso y fecha, sin datos personales');
  await v.goto(W + '/verificar/?codigo=TS-AAAA-BBBB'); await sleep(1200); ok(/No encontramos/.test(await v.locator('#r').innerText()), 'código falso: no encontrado');
  await a.goto(W + `/aula/#/certificado/${C}`); await sleep(1500); ok(/Certificado/.test(await a.locator('#app').innerText()) && (await a.locator('#app').innerText()).includes(cert), 'la alumna ve e imprime su certificado');
  // Configuración: agregar pregunta
  await t.goto(W + '/aula/#/admin/config'); await sleep(1500);
  await t.fill('#f-preg [name=p]', '¿Qué neutraliza el verde?'); await t.fill('#f-preg [name=o]', '*El rojo\nEl azul'); await t.click('#f-preg button'); await sleep(1200);
  ok(psql("select count(*) from aula_preguntas where pregunta like '%verde?'") === '1', 'Tania agrega preguntas al cuestionario');
  ok(!errores.length, 'sin errores de JavaScript' + (errores.length ? ': ' + errores.join(' | ') : ''));
  await b.close();
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
