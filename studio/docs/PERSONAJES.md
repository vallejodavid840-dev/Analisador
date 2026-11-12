# Editor de personajes (Fase 4)

Diseño de personajes de anime 2D sobre el motor de dibujo de la Fase 1, el esqueleto de la Fase 3 y la exportación de la Fase 2. Sin IA generativa: las herramientas son **generadores paramétricos de vectores** (geometría propia) más todas las herramientas de dibujo, que siguen disponibles para retocar cualquier cosa.

## Qué es un personaje
Un personaje es un documento de dibujo (`Animation`, formato v3) con un bloque `character` y 4 fotogramas = **4 vistas independientes** (frontal, tres cuartos, lateral, espalda). Ninguna vista se genera girando otra: se dibujan, se copian como punto de partida (`Copiar capas`) y/o se apoyan en imágenes de referencia propias.
Vive en la biblioteca local (`<datos>/_personajes/<id>/`: `character.json` = ficha, carpeta, etiquetas, miniatura; `drawing.json` = dibujo; `files/` = referencias y hojas PNG). El dibujo se guarda con control de revisión, `.prev` y `.bak-v<N>` al migrar.

## Herramientas (panel «Personaje»)
- **Proporciones** (10 parámetros: altura, cabezas de alto, hombros, complexión, brazos, piernas, torso, manos, pies, postura + 4 preajustes). Cambiarlas **mueve el esqueleto y reescala todo el dibujo vinculado** (retargeting con escala por hueso: coordenadas locales del hueso `u`,`v` ponderadas con los pesos del rig). Por defecto 7,6 cabezas: anime adolescente/adulto, no infantil.
- **Cuerpo y piel**: cuerpo base + esqueleto humanoide de 16 huesos, tonos de piel.
- **Rostro**: 5 formas de ojo, 5 de cejas (una con corte), 3 de nariz, 4 mandíbulas, orejas, color de ojos/cejas; marcas (cicatrices, tirita, moratón, arañazos, ojeras).
- **Cabello**: 5 peinados (corto desordenado, puntiagudo, largo, rapado lateral, flequillo largo), largo, desorden, raya, semilla de variación.
- **Ropa** (paramétrica y re-editable): pantalón (hasta baggy 3,4×, cintura caída, pliegues sobre el calzado, bolsillos, cinturón), camiseta amplia, camisa abierta, chaqueta larga, bomber, sudadera con capucha, uniforme (gakuran), chaleco, abrigo; zapatillas y botas. Anchura, largo, mangas y su anchura, cuello (alto, solapas, capucha, redondo, camisa), abertura, botones, cremallera, bolsillos, costuras, pliegues, colores, texturas (vaquero, tela, cuadros, rayas, puntos) y estampados.
- **Accesorios**: cadenas (cuello, cartera), guantes sin dedos, anillos, pendientes, hachimaki, mascarilla, muñequeras.
- **Expresiones**: 9 preajustes (neutral, serio, enojado, sonrisa leve, sonrisa arrogante, tristeza, sorpresa, mirada desafiante, dolor). Se dibujan en ojos/cejas/boca como trazos normales (retocables con el pincel) y se **guardan con nombre**; se reaplican en el personaje y en los episodios.
- **Poses guardadas**: claves de pose completas del esqueleto, reutilizables.
- **Vistas y referencias**: imágenes de referencia por vista (solo en pantalla, nunca se exportan), copia de capas entre vistas, hoja de referencia PNG de las 4 vistas, vista actual en PNG (con o sin fondo).
- **Acabado de capa** (también en episodios): opacidad, mezcla (normal, multiplicar, trama, superponer, sumar), **recorte a la capa de debajo** (sombra que no se sale de la prenda), desenfoque (sombra suave) y atajos «Sombra dura/suave», «Luz», «Brillo». La herramienta **Relleno (G)** pinta formas cerradas (trazo `fill`) para acabados no planos.

Todo está en una entrada de historial por acción (deshacer/rehacer), se guarda solo y se recupera.

## Rigging
Cada capa generada nace vinculada (rígida o deformable) al esqueleto, con la ropa asociada a sus partes. Cada vista guarda su propia pose de reposo explícita, de modo que posar la frontal no «filtra» a las demás. Las capas con `part`/`group` (cuerpo, pantalón, pelo…) mantienen su identidad.

## Reutilización en episodios
«Personajes → Insertar personaje…» copia al episodio (en **todos** sus dibujos; los trazos se comparten en memoria) las capas, el dibujo de la vista elegida, un esqueleto nuevo con sus vínculos, las expresiones y las poses guardadas, escalados a la resolución del episodio. La copia es autónoma (se puede borrar el original). Solo la vista frontal lleva esqueleto. Desde el panel se aplica una expresión a un dibujo o a todos, y una pose guardada como keyframe. Se pueden insertar varios personajes (límite práctico: capas totales ≤ 128).

## Limitaciones conocidas
- Los generadores (cuerpo, rostro, pelo, ropa, accesorios) producen la **vista frontal**. Tres cuartos, lateral y espalda se dibujan a mano (los bocetos de los personajes de prueba son siluetas de construcción, no ilustraciones acabadas).
- El estilo es vectorial y «limpio»: los personajes de prueba combinan generadores y retoques a mano, no equivalen a una ilustración de autor.
- Cada personaje usa ~25–30 capas; con varios en un episodio la memoria de mapas de bits (móvil) se agota antes y el lienzo se vuelve más lento (se re-rasteriza). Límite de formato: 128 capas.
- Las proporciones reescalan solo lo vinculado al esqueleto; capas sin vincular no se tocan. Al regenerar ojos/cejas/boca/prendas se sustituye lo dibujado a mano en esas capas (deshacer lo recupera).
- Reescalar no preserva trazos «a mano» muy finos con exactitud (aproximación por pesos); ida y vuelta de proporciones ≈ ±8 % de caja.
- Sin sincronización entre la copia insertada y el original de la biblioteca (es una copia).
- Las referencias admiten PNG/JPG/WEBP de hasta 12 MB; no se editan (solo opacidad/tamaño/visibilidad).
- Sin autenticación en el servidor (uso local).
