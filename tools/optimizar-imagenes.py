#!/usr/bin/env python3
"""Convierte las fotos originales a WebP optimizado en varios tamaños.

Uso:  python3 tools/optimizar-imagenes.py <carpeta-originales> [carpeta-salida]
Por defecto la salida es img/ dentro del sitio. Requiere Pillow (pip install pillow).

Para cada foto 'nombre.jpg' genera:
  img/nombre-480.webp, img/nombre-960.webp, img/nombre-1440.webp (sin agrandar)
y escribe img/manifiesto.json con los anchos y proporción de cada foto,
que usa tools/build.mjs para armar srcset, width y height.
"""
import json, os, sys
from PIL import Image, ImageOps

ANCHOS_FOTO = [480, 960, 1440]
ESPECIALES = {  # imágenes de marca con tamaños propios
    'retrato.png': [280, 560],
    'logo.png': [96, 192],
    'marmol.jpg': [800, 1400],
}
OMITIR = {'certificado-plantilla.jpg', '577466.jpg'}  # plantilla vacía; logo grande solo para redes

def main():
    origen = sys.argv[1]
    destino = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'img')
    os.makedirs(destino, exist_ok=True)
    manifiesto = {}
    for archivo in sorted(os.listdir(origen)):
        if archivo in OMITIR or not archivo.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        im = ImageOps.exif_transpose(Image.open(os.path.join(origen, archivo)))
        base = os.path.splitext(archivo)[0]
        anchos = ESPECIALES.get(archivo, ANCHOS_FOTO)
        generados = []
        for w in anchos:
            w_real = min(w, im.width)
            if w_real in generados:
                continue
            copia = im.copy()
            copia.thumbnail((w_real, 100000), Image.LANCZOS)
            if copia.mode not in ('RGB', 'RGBA'):
                copia = copia.convert('RGBA' if 'A' in copia.mode else 'RGB')
            ruta = os.path.join(destino, f'{base}-{w_real}.webp')
            copia.save(ruta, 'WEBP', quality=80 if w >= 960 else 76, method=6)
            generados.append(w_real)
        manifiesto[base] = {'anchos': generados, 'w': im.width, 'h': im.height}
        print(f'{archivo}: {im.width}x{im.height} -> {generados}')
    with open(os.path.join(destino, 'manifiesto.json'), 'w', encoding='utf-8') as f:
        json.dump(manifiesto, f, ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
