# Tania Sanabria · Makeup Studio — sitio web

Sitio estático pensado para **GitHub Pages**. No usa frameworks ni dependencias en tiempo de ejecución.

## Estructura
- `data/catalogo.json`: negocio, servicios, precios, señas, galerías y certificados. **Es la única fuente de los datos.**
- `data/sitio.json`: URL pública, título, descripción y la fuente de datos.
- `src/plantilla.html`: plantilla de la página, con marcadores `{{...}}`.
- `js/render.js`: funciones que convierten los datos en HTML. Las usan tanto la compilación como el navegador.
- `js/datos.js`: carga de datos. El sitio se muestra al instante con los datos embebidos y después se actualiza con Supabase (`fuenteDatos: "supabase"` en `data/sitio.json`). Si Supabase no responde en 6 s, queda la versión estática y la reserva se envía por WhatsApp como antes.
- `admin/`: panel de Tania (`/admin/`, con `noindex`). Usa `admin/vendor/supabase.js` (supabase-js 2.118.0, MIT).
- `supabase/schema.sql`, `supabase/seed.sql`, `supabase/PASOS.md`: base de datos, carga inicial y pasos en el panel de Supabase.
- `js/app.js`: diálogos, visor de fotos, formulario de reserva por WhatsApp, menú, compartir y enlaces viejos.
- `css/estilos.css`, `fonts/` (woff2 alojadas en el propio sitio), `img/` (WebP en 480/960/1440 más `manifiesto.json`).
- `tools/build.mjs`: genera `index.html`, `404.html`, `sitemap.xml`, `robots.txt` y `site.webmanifest`.
- `tools/optimizar-imagenes.py`: convierte fotos originales a WebP responsivo y actualiza el manifiesto.

## Compilar
```bash
node tools/build.mjs          # Node 18 o superior
```

## Agregar fotos
1. Copiar los originales (JPG o PNG) a una carpeta, por ejemplo `../originales`, usando el nombre que figura en `fotosPendientes` (ej. `novias-1.jpg`).
2. `pip install pillow && python3 tools/optimizar-imagenes.py ../originales`
3. En `data/catalogo.json`, mover el nombre de `fotosPendientes` a `fotos`.
4. `node tools/build.mjs`

Mientras una foto no existe, se muestra un marcador "Fotos próximamente". Los álbumes vacíos se ocultan solos.

## Cambiar la URL o el dominio
Editar `url` en `data/sitio.json` y volver a compilar. El `404.html` usa `<base href>` con esa ruta. Para un dominio propio, agregar un archivo `CNAME`.

## Publicar en GitHub Pages
```bash
# En la cuenta de GitHub de Tania (taniasanabria):
gh repo create taniasanabria/taniasanabria.github.io --public --source . --push
# Luego: Settings → Pages → Deploy from branch → main / (root).
# Al ser un sitio de usuario, se publica en https://taniasanabria.github.io/
```

## Probar localmente
Usar cualquier servidor estático, por ejemplo `npx serve .`, sirviendo la carpeta en la raíz (`/`), igual que en GitHub Pages.

URL pública: https://taniasanabria.github.io/

## Panel de Tania — guía paso a paso

**Entrar**
1. En el celular, abrir **https://taniasanabria.github.io/admin/**.
2. Tip: en el menú del navegador, elegir "Agregar a pantalla de inicio" para tenerlo como una app.
3. Escribir el email (`tanialomaqui18@gmail.com`) y la contraseña, y tocar **Entrar**. La sesión queda abierta; para cerrarla, tocar **Salir**.
4. Si te olvidaste la contraseña, tocá **Olvidé mi contraseña**. Te llega un correo con un enlace para crear una nueva.

**Citas** (pestaña 📅)
1. Arriba están las **solicitudes pendientes**: lo que las clientas pidieron desde la web. El número rojo indica cuántas hay.
2. Con el panel abierto, cada solicitud nueva aparece sola, con un sonido, una vibración y un aviso.
3. Mientras está pendiente, ese horario no se ofrece a otras clientas.
4. **✓ Aprobar** abre WhatsApp con un mensaje listo para la clienta, que incluye la seña o el total y los datos de pago. Solo tenés que tocar enviar.
5. **✕ Rechazar** libera el horario y abre WhatsApp con un mensaje amable.
6. Cuando la clienta paga, tocá **Marcar como pagada**.
7. Más abajo está la **agenda**, por **Día** o por **Semana**, con flechas para moverte entre fechas.
8. **+ Agregar cita** sirve para anotar una cita que te pidieron por teléfono o en persona.

**Horarios** (pestaña 🕒)
1. **Horario de cada semana:** marcá los días que trabajás y en qué horario; después tocá **Guardar horario**.
2. **Bloquear un día:** por vacaciones, un curso o un día libre. Ese día no se ofrecen turnos.
3. **Abrir un horario extra:** por ejemplo, un domingo. La clienta lo ve marcado como "costo adicional".

**Fotos** (pestaña 📷)
1. Elegí dónde van las fotos: un álbum de la galería o un servicio.
2. Tocá **📷 Subir fotos** y seleccioná varias de la galería del celular. Se achican y optimizan solas antes de subirse.
3. Con **◀ Antes / Después ▶** cambiás el orden. Con **Eliminar** la sacás, y con **Mover a…** la pasás a otro álbum o servicio.

**Servicios** (pestaña 💄)
1. Tocá un servicio para editar el nombre, el precio que se muestra, la seña, la duración y la descripción.
2. **Mostrar en el sitio (activo)** muestra u oculta el servicio en la web sin borrarlo. Las flechas cambian el orden.
3. **Minutos que ocupa en la agenda** define cuánto tiempo bloquea el turno. Tocá **Guardar** para aplicar los cambios.

**Cursos** (pestaña 🎓)
1. **Inscripciones:** lo que llega desde la web, con la referencia (`C-XXXXX`) y el monto a pagar. El número rojo indica cuántas falta cobrar; en Citas también aparece un aviso.
2. Cuando la alumna te manda el comprobante por WhatsApp, tocá **💰 Registrar pago**, elegí transferencia/QR/efectivo, anotá el número del comprobante (opcional) y dejá tildado **Dar acceso a las clases**. Se abre WhatsApp con el enlace al aula y su **código de acceso**: solo tocá enviar.
3. **📲 Enviar acceso** vuelve a mandar el código; **Quitar acceso** la deja sin clases (sin borrar el pago); **Cancelar** anula la inscripción.
4. **＋ Agregar alumna** sirve para alguien que pagó en persona: queda pagada, con acceso, y te abre el WhatsApp con el código.
5. **Clases de cada curso:** elegí el curso y agregá clases: **Video** (pegá el enlace de YouTube subido como "No listado", o de Google Drive compartido como "Cualquier persona con el enlace"), **PDF o foto** (se sube desde el celular; las fotos se achican solas) u **Otro enlace**. Con *Módulo* las agrupás. Las flechas cambian el orden; **Ver** muestra cómo la ve la alumna.
6. Las alumnas entran en **https://taniasanabria.github.io/alumnas/** con su email y el código.

**Ajustes** (pestaña ⚙️)
1. Acá están el número de WhatsApp y los **datos para el pago** (banco y alias). Van en el mensaje de aprobación de las citas y se muestran a quien se inscribe a un curso (solo después de inscribirse). También podés subir la **imagen del QR** de cobro y editar el mensaje de acceso a las clases.
2. También podés editar los textos de las políticas del sitio, el intervalo entre turnos, la anticipación mínima y hasta cuántos días adelante se puede reservar.
3. Desde acá también se cambia la contraseña.

Los cambios se ven en la web al recargar la página. Si algún día Supabase no responde, la web sigue funcionando con los datos de la última publicación, y las reservas llegan por WhatsApp.

## Créditos
Íconos: Font Awesome Free 6.5.1 (CC BY 4.0). supabase-js (MIT). Fuentes: Cinzel y Montserrat (SIL OFL).
