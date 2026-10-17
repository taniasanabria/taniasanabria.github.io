# Pasos en el panel de Supabase (una sola vez)

Proyecto: `https://wfngdgqihtiqkokhxjqv.supabase.co`

Los dos archivos son **idempotentes**: se pueden volver a ejecutar sin perder datos, y el seed no pisa lo que Tania cambie desde el panel.

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

## Qué expone la clave pública (anon)
- **Lectura:** servicios activos, fotos activas, álbumes y ajustes públicos (WhatsApp y textos de políticas).
- **Turnos libres:** solo a través de `horarios_libres` y `dias_con_turnos`, que no devuelven datos de clientas.
- **Nuevas solicitudes:** solo a través de `crear_reserva`. Valida que el horario esté libre y aplica límites anti-spam: 3 solicitudes pendientes por teléfono en 24 horas y 30 solicitudes web cada 10 minutos.
- **Nunca accesibles:** `reservas`, `ajustes_privados` (datos de pago y plantillas), `horario_semanal`, `bloqueos` ni `turnos_extra`.

## Volver a cargar el catálogo inicial
`node tools/generar-seed.mjs` regenera `supabase/seed.sql` desde `data/catalogo.json`. Solo agrega lo que falta; no pisa nada.
