# Preguntas pendientes para Tania / Harold

No se inventó ningún dato. Donde había contradicciones se mantuvo el texto actual del sitio, y quedan listadas acá para confirmarlas.

## Datos del negocio
1. **Dirección.** El sitio dice "Las Residentas 460 c/ **8 de Setiembre**", pero Google Maps muestra "**8 de diciembre**". ¿Cuál es la correcta? (Se mantuvo "8 de Setiembre".)
2. **Domingos.** El horario publicado es Lun–Vie 09–20 y Sáb 09–16. ¿El domingo está cerrado? (Hoy el formulario solo muestra un aviso suave si se elige un domingo.)
3. **Medios de pago.** Se menciona "Tarjetas" como medio de pago, pero la seña se paga solo por transferencia o QR. ¿Se acepta tarjeta para el saldo?
4. **Tolerancia de puntualidad.** El servicio Aerógrafo tiene una tolerancia distinta a la de los demás servicios. ¿Es intencional?

## Precios
5. **Fotografía Beauty.** La tarjeta dice "Gs. 350.000", pero el mensaje de reserva dice "Gs. 350.000 + Matrícula Gs. 100.000". ¿Se cobra matrícula? (Se mantuvieron los dos textos como estaban.)

## Certificados
6. Las dos imágenes de "certificados" del sitio viejo eran **la misma plantilla vacía, repetida**. Se ocultaron. Hacen falta fotos o escaneos de los certificados reales (`data/catalogo.json` → `certificados`).

## Fotos
7. Los cursos de la Academia reutilizan fotos de Maquillaje Social. ¿Hay fotos propias de las clases?
8. Faltan las siguientes fotos. En el sitio viejo daban error 404, y ahora se muestra un marcador elegante o se oculta el álbum:
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
9. **Repositorio.** Definido: cuenta nueva `taniasanabria`, repo `taniasanabria.github.io`, URL `https://taniasanabria.github.io/`. Falta crear la cuenta y el repo. Si se usa otro nombre, hay que cambiar `url` en `data/sitio.json` y volver a compilar.
10. **Dominio propio.** ¿Se va a usar uno (por ejemplo, taniasanabria.com.py)? Si es así, hay que agregar el archivo `CNAME` y actualizar `url`.
