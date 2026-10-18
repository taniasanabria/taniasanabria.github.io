# Pasos en el panel de Supabase (una sola vez)

Proyecto: `https://wfngdgqihtiqkokhxjqv.supabase.co`

Los archivos SQL son **idempotentes**: se pueden volver a ejecutar sin perder datos, y el seed no pisa lo que Tania cambie desde el panel.

1. **SQL Editor → New query.** Pegar todo `supabase/schema.sql` y tocar **Run**.
   - Al final tiene que aparecer una fila con `Esquema listo`, la hora actual de Paraguay y `zona_ok = true`.
   - Puede aparecer un aviso de "destructive operation", porque el script borra y vuelve a crear las políticas. Confirmar.
2. **SQL Editor → New query.** Pegar todo `supabase/seed.sql` y tocar **Run**. Carga 19 servicios, 8 álbumes, 35 fotos del sitio y el horario semanal.
3. **Authentication → Users → Add user → Create new user.**
   - Email: `tanialomaqui18@gmail.com`
   - Una contraseña (pasársela a Tania por un medio privado).
   - Marcar **Auto Confirm User**.
   - El email ya está habilitado como administrador en la tabla `admins`, cargada por schema.sql. Cualquier otra cuenta que inicie sesión no ve nada.
4. **Authentication → Sign In / Providers** (en versiones anteriores: Settings).
   - Desactivar **Allow new users to sign up**.
   - Dejar habilitado el proveedor **Email**.
   - Anonymous sign-ins: desactivado.
5. **Authentication → URL Configuration.**
   - Site URL: `https://taniasanabria.github.io`
   - Redirect URLs: agregar `https://taniasanabria.github.io/admin/`. Se usa para el enlace de "Olvidé mi contraseña".
6. **Database → Publications → supabase_realtime.** Verificar que `reservas` esté tildada. schema.sql ya la agrega; esto es solo para comprobar.
7. **Storage.** Verificar que exista el bucket **fotos** marcado como *Public*. Lo crea schema.sql, con un límite de 5 MB y los formatos webp, jpeg y png.
8. **(Opcional, recomendado) Authentication → Emails → SMTP Settings.** El correo integrado de Supabase permite muy pocos envíos por hora. Para que "Olvidé mi contraseña" sea confiable, configurar un SMTP propio (por ejemplo, Gmail con contraseña de aplicación, Brevo o Resend).
9. Avisar para hacer `git push`. GitHub Pages publica el sitio y el panel queda en `https://taniasanabria.github.io/admin/`.
10. Primera vez en el panel, en **Ajustes**: cargar los **datos para el pago** (banco, alias, titular). Sin esos datos, el mensaje de aprobación sale sin datos de pago.

## Avisos al celular de Tania (push, gratis, sin cuentas nuevas)
> ✅ **Estado (17/10/2026): instalado y funcionando.** La función `avisar-reserva` está publicada con Verify JWT desactivado, los secretos VAPID están cargados y `avisos.sql` se ejecutó. Los pasos de abajo quedan como referencia, por si hay que reinstalar o mover el proyecto. **No regenerar las claves VAPID** (los celulares tendrían que volver a activar los avisos).

Sin este paso igual funcionan los avisos **con el panel abierto o en segundo plano** (sonido, vibración, notificación, número en la pestaña y en el ícono). Este paso agrega el aviso **con el panel cerrado**.

Opción A (recomendada, un comando): crear un token personal en **supabase.com/dashboard/account/tokens** (con la cuenta de Tania) y ejecutar
```
SUPABASE_ACCESS_TOKEN=sbp_xxx bash tools/desplegar-avisos.sh
```
Hace todo: ejecuta `supabase/avisos.sql`, genera las claves VAPID y las guarda **solo** como secretos de la función, y despliega `avisar-reserva`. Después se puede borrar el token.

Opción B (a mano, desde el panel de Supabase):
1. **SQL Editor:** pegar `supabase/avisos.sql` y tocar **Run**. Tiene que mostrar `Avisos listos` y `pg_net_ok = true`. Si sale `false`, activar **Database → Extensions → pg_net** y volver a correrlo.
2. **Claves VAPID:** `node --input-type=module -e "import('./supabase/functions/avisar-reserva/webpush.js').then(async m => console.log(await m.generarClavesVapid()))"`
3. **Edge Functions → Secrets:** cargar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` = `mailto:tanialomaqui18@gmail.com`. No guardar la privada en ningún otro lado.
4. **Edge Functions → Deploy a new function → Via editor**, nombre `avisar-reserva`: pegar `index.ts` y agregar `webpush.js` como segundo archivo (si el editor no lo permite, usar la opción A), y **desactivar "Verify JWT"**.
5. Comprobar: `https://wfngdgqihtiqkokhxjqv.supabase.co/functions/v1/avisar-reserva` debe responder `{"vapidPublicKey":"B…"}`.

Cómo funciona: cada solicitud nueva desde la web dispara un trigger que, con `pg_net`, le pasa **solo el id** a la función. La función lee la reserva con la service key, avisa **una sola vez** por reserva (tabla `avisos_enviados`) y solo si está pendiente y tiene menos de 15 minutos, así que no hace falta proteger la llamada con otra clave. Los celulares suscriptos están en `push_suscripciones` (solo visibles para la admin); los que dejan de existir se borran solos. Si el aviso falla, la reserva se guarda igual.

## Cursos online (inscripciones, pago y aula de alumnas)
> Hasta que se haga este paso, el sitio igual funciona: las inscripciones llegan como solicitudes comunes en **Citas** (con aviso al celular) y la pestaña **Cursos** del panel muestra "Falta activar los cursos".

**Orden importante: el paso 2 antes que el 3.**

1. **SQL Editor → New query.** Pegar todo `supabase/cursos.sql` y tocar **Run** (requiere haber corrido antes `schema.sql` y `avisos.sql`). Al final tiene que aparecer `Cursos listos` con `monto_ok = true`, `auth_ok = true` y `vinculo_ok = true`. Es idempotente.
   - Si `vinculo_ok` sale `false` (Supabase no dejó crear el trigger en `auth.users`), no pasa nada: el hook del paso 2 hace el mismo vínculo.
2. **Authentication → Hooks → Add hook → Before User Created** → tipo **Postgres** → schema `public`, función **`hook_antes_de_crear_usuario`** → **Create**. (Gratis en el plan Free.)
   Este hook es el candado: solo deja crear una cuenta si el email y el **código de acceso** coinciden con una alumna a la que Tania le dio acceso. Cualquier otro registro se rechaza, incluido el email de la admin.
3. **Authentication → Sign In / Providers**:
   - Activar **Allow new users to sign up** (lo filtra el hook; sin el hook NO activarlo).
   - En **Email**, desactivar **Confirm email** (las alumnas no reciben correo; el código les llega por WhatsApp).
   - Anonymous sign-ins: sigue desactivado.
4. **Storage:** verificar que exista el bucket **cursos**, *privado* (lo crea cursos.sql, 25 MB por archivo, PDF/JPG/PNG/WEBP). Las alumnas lo leen solo con enlaces firmados de 1 hora.
5. **(Opcional) Edge Functions → avisar-reserva → redeploy** con el `index.ts` actualizado: el aviso dice "Nueva inscripción: …" y al tocarlo abre la pestaña Cursos. **Sin redeploy también avisa** (cada inscripción crea una solicitud "espejo" en `reservas`, que dispara el mismo trigger), solo que con el título "Nueva solicitud: Inscripción: …". Con token: `SUPABASE_ACCESS_TOKEN=sbp_xxx npx supabase functions deploy avisar-reserva --no-verify-jwt --project-ref wfngdgqihtiqkokhxjqv`.

Cómo funciona:
- **Inscripción** (`crear_inscripcion`, SECURITY DEFINER): valida nombre/teléfono/email, calcula el monto (curso + matrícula; en cursos mensuales, 1.ª cuota + matrícula), aplica anti-spam (3 pendientes por teléfono o email en 24 h, 30 cada 10 minutos), guarda la inscripción y su reserva espejo (sin bloquear la agenda), y le devuelve a la clienta el monto, la referencia `C-XXXXX`, los **datos para el pago** y el QR de Ajustes.
- **Pago:** Tania lo marca en el panel (`admin_registrar_pago`). Al dar acceso se genera el **código** de la alumna (`XXXX-XXXX`, uno por email, sirve para todos sus cursos) y se abre WhatsApp con el enlace al aula y el código.
- **Aula** (`/alumnas/`, noindex): la alumna escribe su email y el código. La primera vez se crea su cuenta (el código es su contraseña; el hook lo valida); después entra directo y la sesión queda guardada.
- **RLS:** `lecciones` y los archivos del bucket `cursos` solo los ve la admin o una alumna con inscripción **pagada y con acceso** a ese curso, verificando a la vez el id de su cuenta y su email. Si Tania quita el acceso o cancela, deja de ver las clases al instante.
- **Videos:** YouTube "No listado" o Google Drive "Cualquier persona con el enlace". Ojo: quien tenga el enlace del video puede verlo; lo protegido es el listado de clases y los archivos subidos.

### Enchufar el pago con tarjeta más adelante (uPay / Bancard)
Todo queda listo; solo falta la pasarela:
1. Crear una Edge Function (p. ej. `pago-iniciar`) que reciba `POST {"inscripcion": "<uuid>", "referencia": "C-XXXXX"}`, lea el monto de `inscripciones` con la service key, cree el cobro en la pasarela y responda `{"url": "https://…"}` (la página de pago).
2. Crear la función del webhook de la pasarela (p. ej. `pago-confirmado`): verifica la firma de la pasarela y llama `select public._registrar_pago('<uuid>', 'tarjeta', '<id de la transacción>', true, <monto>)` con la service key. Eso marca pagada, da acceso y genera el código (Tania igual le manda el WhatsApp con el código, o se agrega el envío por email).
3. En `data/sitio.json` poner `"pagos": {"tarjeta": {"url": "https://wfngdgqihtiqkokhxjqv.supabase.co/functions/v1/pago-iniciar", "etiqueta": "Pagar con tarjeta"}}`, correr `node tools/build.mjs` y publicar. Aparece el botón **Pagar con tarjeta** en la pantalla de pago, junto a la transferencia y el QR.
Las claves de la pasarela van **solo** como secretos de las funciones, nunca en el repositorio.

### (Opcional) Enlace mágico por email en vez de código
Requiere SMTP propio (el correo integrado de Supabase solo envía a miembros del equipo del proyecto y muy pocos por hora). Con SMTP configurado se podría sumar "Entrar con enlace por email"; el código por WhatsApp sigue siendo la opción sin costo y sin configuración.

## Qué expone la clave pública (anon)
- **Lectura:** servicios activos, fotos activas, álbumes y ajustes públicos (WhatsApp y textos de políticas).
- **Turnos libres:** solo a través de `horarios_libres` y `dias_con_turnos`, que no devuelven datos de clientas.
- **Nuevas solicitudes:** solo a través de `crear_reserva`. Valida que el horario esté libre y aplica límites anti-spam: 3 solicitudes pendientes por teléfono en 24 horas y 30 solicitudes web cada 10 minutos.
- **Inscripciones a cursos:** solo a través de `crear_inscripcion`, que devuelve los datos para el pago y el QR **únicamente** después de una inscripción válida.
- **Nunca accesibles:** `reservas`, `inscripciones`, `alumnos`, `lecciones` (salvo alumnas habilitadas), el bucket `cursos`, `ajustes_privados` (datos de pago y plantillas), `horario_semanal`, `bloqueos`, `turnos_extra`, `push_suscripciones` ni `avisos_enviados`.
- **Función `avisar-reserva`:** con GET devuelve solo la clave pública VAPID. Con POST no devuelve datos de clientas, y no avisa dos veces la misma reserva.

## Volver a cargar el catálogo inicial
`node tools/generar-seed.mjs` regenera `supabase/seed.sql` desde `data/catalogo.json`. Solo agrega lo que falta; no pisa nada.
