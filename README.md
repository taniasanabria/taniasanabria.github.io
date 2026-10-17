# Tania Sanabria · Makeup Studio — sitio web

Sitio estático pensado para **GitHub Pages**. No usa frameworks ni dependencias en tiempo de ejecución.

## Estructura
- `data/catalogo.json`: negocio, servicios, precios, señas, galerías y certificados. **Es la única fuente de los datos.**
- `data/sitio.json`: URL pública, título, descripción y la fuente de datos.
- `src/plantilla.html`: plantilla de la página, con marcadores `{{...}}`.
- `js/render.js`: funciones que convierten los datos en HTML. Las usan tanto la compilación como el navegador.
- `js/datos.js`: carga de datos (`embebido` | `json` | `supabase`). Incluye un ejemplo de Supabase comentado para el futuro panel de administración.
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

## Créditos
Íconos: Font Awesome Free 6.5.1 (CC BY 4.0). Fuentes: Cinzel y Montserrat (SIL OFL).
