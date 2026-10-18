# Preguntas pendientes para Tania / Harold

No se inventó ningún dato. Donde había contradicciones se mantuvo el texto actual del sitio, y quedan listadas acá para confirmarlas. Las ya respondidas figuran como resueltas.

## Resuelto (respuestas de Tania, 17/10/2026)
- ✅ **Dirección:** "Las Residentas 460 esq. 8 de Diciembre". Aplicada en el pie, en la sección de contacto y en el JSON-LD.
- ✅ **Domingos y fuera de horario:** solo con turno previo y con costo adicional. El formulario los permite y muestra un aviso claro, la nota queda en el mensaje de WhatsApp y la regla figura en las políticas y en el pie.
- ✅ **Fotografía Beauty:** Gs. 350.000 + Matrícula Gs. 100.000 (total Gs. 450.000). Ahora coinciden la tarjeta, el detalle, el formulario y el mensaje.
- ✅ **Pagos:** desde la web se puede elegir abonar el total o solo la seña. El saldo se paga por transferencia o QR directamente a Tania. Todavía no hay cobro en línea; los campos quedaron listos en `negocio.pago` (`opciones: ["total","seña"]`, `enLinea: false`, `proveedor: null`).

## Datos del negocio (pendientes)
1. **Efectivo y tarjetas:** las normas de 3 servicios decían "Efectivo, Transferencias, QR y Tarjetas". Siguiendo la respuesta sobre pagos, ahora dicen "total o seña desde la web; saldo por transferencia o QR". ¿Se sigue aceptando efectivo o tarjeta en el Studio? Si es así, se vuelve a agregar.
2. **Monto del costo adicional** de domingos y horarios especiales: ¿hay un monto fijo o un porcentaje para publicar? Hoy dice "a confirmar por Tania".
3. **Rango fuera de horario:** el formulario ofrece turnos de 06:00 a 22:00 (los que caen fuera del horario habitual se marcan con costo adicional). ¿Es un rango razonable?
4. **Eventos (Glitter Bar / Neon Party):** ¿el costo adicional también aplica a eventos de noche o en domingo? Hoy los eventos ofrecen de 08:00 a 23:00 sin aviso por horario; solo el domingo muestra el aviso.
5. **Tolerancia de puntualidad:** el servicio Aerógrafo tiene una tolerancia distinta a la de los demás servicios. ¿Es intencional?
6. **Datos de pago:** ¿qué banco, alias o QR se va a usar? Hay que cargarlos en el panel (Ajustes → Datos para el pago) para que salgan en el mensaje de aprobación.

## Agenda y reservas (fase 2, valores supuestos, se cambian desde el panel)
- **Duración de cada servicio en la agenda:** se tomó el número más alto del texto de duración (por ejemplo, "2 a 2,5 horas" = 150 min). Cejas, trenzas y tocados no tenían duración y quedaron en 60 min. Revisar en Servicios → "Minutos que ocupa en la agenda".
- **Turnos:** cada 30 minutos, con al menos 2 horas de anticipación y hasta 60 días adelante. Se cambia en Ajustes.
- **Horario semanal:** se cargó a partir del horario publicado en el sitio. Revisar en Horarios.
- **Eventos y Academia:** no ocupan agenda. Se piden con fecha preferida y Tania confirma. Los pedidos para domingo se marcan con costo adicional.
- **Solicitudes pendientes:** bloquean su horario hasta que se aprueben o se rechacen. No vencen solas.
- **Anti-spam:** máximo 3 solicitudes pendientes por teléfono en 24 horas, y 30 solicitudes web cada 10 minutos en total.
- **Zona horaria:** UTC-3 fija (`Etc/GMT+3`), porque Paraguay ya no cambia la hora desde octubre de 2024.
- **Fotos faltantes (punto 9):** se pueden subir directamente desde el panel (pestaña Fotos), sin compilar.

## Avisos de reservas nuevas (17/10/2026)
- ✅ **Con el panel abierto o en segundo plano:** sonido, vibración, mensaje en pantalla, notificación del sistema, número de pendientes en la pestaña (`(2) Panel de Tania`), en la solapa Citas y en el ícono de la app (Android/Chrome).
- ✅ **Panel instalable** como app (`admin/manifest.webmanifest` + `admin/sw.js`). En Ajustes, la tarjeta "Avisos de reservas nuevas" muestra el estado y tiene **Activar avisos** y **Probar aviso**.
- ✅ **Con el panel cerrado (push):** instalado en Supabase. La Edge Function `avisar-reserva` está publicada (Verify JWT desactivado), las claves VAPID están cargadas como secretos y el trigger con `pg_net` está activo.
- Tania tiene que abrir el panel y tocar **Activar avisos** una vez en cada celular. Los que ya lo activaron se suscriben solos al volver a abrir el panel.
- **iPhone:** las notificaciones web solo funcionan con iOS 16.4 o superior y con el panel agregado a la pantalla de inicio.
- No cambiar las claves VAPID: si se cambian, hay que volver a tocar "Activar avisos" en cada celular.
- Alternativas descartadas por ahora: email con Resend (requiere crear una cuenta) y bot de Telegram (requiere que Tania cree el bot). Se pueden sumar más adelante sobre el mismo trigger.

## Asistente del sitio (chat para clientas, 17/10/2026)
- ✅ Botón "¿Dudas? Preguntame" (escritorio) y botón 💬 en la barra inferior (celular). Se descarga recién al tocarlo, así que no afecta la velocidad de la página. No aparece en `/admin/`.
- Responde **solo con los datos del sitio**: los servicios, precios y señas que Tania edita en el panel, más los horarios, la dirección, las políticas y los cursos (`data/catalogo.json`). Si no sabe algo, lo dice y ofrece **Hablar con Tania** por WhatsApp, con la pregunta ya escrita.
- Lleva al formulario de reserva con el servicio ya elegido.
- Pruebas: `node tools/probar-chat.mjs` corre más de 40 preguntas de ejemplo y verifica que ningún precio de las respuestas falte en el catálogo.
- **Para decidir:**
  - Una IA conversacional (opcional, `sitio.json → chat.backend`). El sitio ya está preparado para conectarla, pero necesita un proveedor de IA (con cuenta y, en general, con costo). Hoy está apagada, con costo cero.
  - Si conviene registrar las preguntas que el asistente no supo responder, para ir mejorándolo. Hoy no se guarda nada.
- Cuando Tania agregue servicios nuevos, el asistente los encuentra por el nombre. Para sinónimos extra (por ejemplo "boda" → Novias), editar `SINONIMOS` en `js/chat-motor.js`.

## Cursos online (17/10/2026)
- ✅ Ficha de cada curso (modalidad, inversión con matrícula, total, programa), **Inscribirme online**, pantalla de pago (transferencia / QR + referencia + WhatsApp del comprobante), pestaña **Cursos** en el panel (cobros, acceso, clases con videos/PDF/fotos) y **aula de alumnas** en `/alumnas/`.
- **Falta (dashboard de Supabase, una vez):** ejecutar `supabase/cursos.sql`, crear el hook *Before User Created*, y recién después activar los registros con "Confirm email" apagado. Ver `supabase/PASOS.md → Cursos online`.
- **Tania:** cargar en Ajustes los datos de pago y (opcional) la imagen del QR; cargar las clases de cada curso; revisar en Servicios la *Modalidad* y el *Contenido* de cada curso.
- **Para decidir:**
  - **Monto de la inscripción:** hoy se pide el total (curso + matrícula; en cursos mensuales, 1.ª cuota + matrícula). ¿Se prefiere solo una seña para reservar el lugar?
  - **Datos de pago visibles** para quien se inscribe (solo después de inscribirse, nunca en la página). ¿OK?
  - **Acceso con código por WhatsApp** (gratis, sin correo). El enlace mágico por email necesita un SMTP propio (p. ej. Gmail con contraseña de aplicación).
  - Videos en YouTube "No listado"/Drive: quien tenga el enlace puede verlo. Para videos más protegidos haría falta un servicio pago (Vimeo, Bunny Stream).
  - **Pago con tarjeta:** cuando esté el RUC y uPay o Bancard, se enchufa sin tocar el resto (ver PASOS.md).
  - Cupos por curso y fechas de inicio: hoy no hay límite de inscriptas.

## Certificados
7. Las dos imágenes de "certificados" del sitio viejo eran **la misma plantilla vacía, repetida**. Se ocultaron. Hacen falta fotos o escaneos de los certificados reales (`data/catalogo.json` → `certificados`).

## Fotos
8. Los cursos de la Academia reutilizan fotos de Maquillaje Social. ¿Hay fotos propias de las clases?
9. Faltan las siguientes fotos. En el sitio viejo daban error 404, y ahora se muestra un marcador elegante o se oculta el álbum:
- **Maquillaje HD con Aerógrafo** (`maquillaje-aerografo`): aerografo, aerografo-2, aerografo-3, aerografo-4, aerografo-5, aerografo-6
- **Maquillaje para Novias** (`maquillaje-novias`): novias, novias-1, novias-2, novias-3, novias-4, novias-5
- **Quinceañeras & Debutantes** (`maquillaje-quinceaneras`): quince-1, quince-2, quince-3, quince-4, mirada, tocado-2
- **Maquillaje Artístico FX & Halloween** (`maquillaje-artistico-fx`): fx-1, fx-2, fx-3, fx-4, neon-2, neon-3
- **Maquillaje de Delineados** (`maquillaje-delineados`): delineado-1, delineado-2, delineado-3, delineado-4, mirada, cejas-3
- **Diseño y Perfilado de Cejas** (`cejas`): cejas, cejas-2, cejas-3, mirada, delineado-1, delineado-2
- **Trenzas Kanekalon (Diseño Exclusivo)** (`trenzas`): trenzas-1
- **Tocados y Accesorios Nupciales** (`tocados`): tocado, tocado-2, tocado-3
- **Estación Glitter Bar Premium** (`glitter-bar`): glitter, glitter-2, glitter-3, neon, neon-2, caritas
- **Experiencia Neon Party** (`neon-party`): neon, neon-2, neon-3, glitter, glitter-2, fx-1
- **Combo: Glitter Bar + Neon Party** (`combo-glitter-neon`): glitter, glitter-2, glitter-3, neon, neon-2, neon-3
- **Art Makeup & Caritas Pintadas (Infantil)** (`caritas-pintadas`): caritas, caritas-2, caritas-3, glitter, glitter-2, neon
- **Automaquillaje Premium** (`curso-automaquillaje`): curso-auto-1, curso-auto-2, academia
- **Maquillador Inicial** (`curso-maquillador-inicial`): curso-inicial-1, curso-inicial-2, academia
- **Maquillador Avanzado** (`curso-maquillador-avanzado`): curso-avanzado-1, curso-avanzado-2, academia, aerografo, aerografo-2
- **Maquillaje Artístico** (`curso-maquillaje-artistico`): curso-artistico-1, curso-artistico-2, neon, glitter, fx-1, fx-2
- **Fotografía Beauty** (`curso-fotografia-beauty`): curso-foto-1, curso-foto-2, academia
- Álbum **Novias & Quinceañeras** (`novias`): 10 fotos (novias, novias-1, novias-2, novias-3, novias-4, novias-5, quince-1, quince-2, quince-3, quince-4)
- Álbum **Neón & Glitter Bar** (`neon`): 9 fotos (neon, neon-2, neon-3, glitter, glitter-2, glitter-3, caritas, caritas-2, caritas-3)
- Álbum **Nuestra Academia** (`academia`): 11 fotos (academia, curso-auto-1, curso-auto-2, curso-inicial-1, curso-inicial-2, curso-avanzado-1, curso-avanzado-2, curso-artistico-1, curso-artistico-2, curso-foto-1, curso-foto-2)
- Álbum **Artístico FX & Halloween** (`fx`): 4 fotos (fx-1, fx-2, fx-3, fx-4)
- Álbum **Delineados** (`delineados`): 5 fotos (delineado-1, delineado-2, delineado-3, delineado-4, mirada)
- Álbum **Cejas & Hair** (`cejas-hair`): 7 fotos (cejas, cejas-2, cejas-3, trenzas-1, tocado, tocado-2, tocado-3)
- Álbum **Aerógrafo HD** (`aerografo`): 6 fotos (aerografo, aerografo-2, aerografo-3, aerografo-4, aerografo-5, aerografo-6)

## Publicación
10. **Repositorio.** Definido: cuenta nueva `taniasanabria`, repo `taniasanabria.github.io`, URL `https://taniasanabria.github.io/`. Falta crear la cuenta y el repo. Si se usa otro nombre, hay que cambiar `url` en `data/sitio.json` y volver a compilar.
11. **Dominio propio.** ¿Se va a usar uno (por ejemplo, taniasanabria.com.py)? Si es así, hay que agregar el archivo `CNAME` y actualizar `url`.
