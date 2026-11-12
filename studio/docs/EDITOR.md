# Editor de dibujo y animación (Fase 1)

Se abre desde un episodio con **Dibujar**. La URL (`#/p/<proyecto>/e/<episodio>`) conserva dónde estás: recargar reabre lo mismo.

## Herramientas

| Herramienta | Tecla | Qué hace |
|---|---|---|
| Pincel | B | Trazos vectoriales con tamaño (1–200 px), opacidad y sensibilidad a la presión |
| Borrador | E | Borra dentro de la capa activa (tamaño y opacidad propios) |
| Seleccionar | V | Clic o recuadro; mover, escalar (esquinas = proporcional, bordes = un eje), rotar (Mayús = saltos de 15°), voltear, duplicar, eliminar |
| Mover lienzo | H | Arrastrar para desplazar la vista |
| Relleno | G | Forma cerrada rellena (acabados no planos) |
| Esqueleto | K | Huesos, vínculos y poses (ver `RIGGING.md`); panel «Huesos» en móvil |

Zoom: rueda, pellizco, botones `−`/`+`, «100 %» y «Ajustar» (`0`). Desplazar: herramienta Mano, botón central, Alt+arrastrar o dos dedos.
`[` y `]` cambian el tamaño; `O` activa el papel cebolla; `Intro`/`Espacio` reproducen; `←`/`→` cambian de fotograma; `Ctrl+Z` / `Ctrl+Mayús+Z` (o `Ctrl+Y`) deshacen y rehacen; `Supr` elimina la selección; `Esc` deselecciona.

## Entrada

- **Ratón, táctil y lápiz** con Pointer Events. La presión solo se usa con **lápiz** (en ratón y dedo es constante: no todos los móviles reportan presión fiable).
- **Rechazo de palma**: con el lápiz apoyado se ignoran los dedos.
- Dos dedos = pellizco (zoom) y desplazamiento; cancela cualquier trazo que se hubiera empezado.
- «Dibujar con el dedo» desactivado: el dedo mueve el lienzo y solo el lápiz dibuja.
- Menú contextual del navegador desactivado en el lienzo (en Android una pulsación larga lo abriría).

## Capas
Crear, eliminar (con confirmación y deshacer), renombrar (lápiz o doble clic), ocultar, bloquear y reordenar. Las capas son **globales**: cada fotograma guarda sus trazos por capa. Una capa oculta o bloqueada no admite dibujo ni transformaciones (se avisa).

## Fotogramas y reproducción
Nuevo, duplicar, eliminar, **duración por dibujo** (`hold`, para animar «a doses/a treses»), miniaturas reales, navegación por botones, teclado o miniaturas. FPS 12 / 24 / 30 (se admite cualquier valor 1–120 heredado del proyecto).
La reproducción usa un reloj propio (`@gas/engine/playback`), independiente del refresco de pantalla: a 24 FPS pasan 24 ticks por segundo y cada dibujo dura `hold` ticks. Con bucle o sin él.
**Papel cebolla**: 0–5 fotogramas anteriores (rosa) y 0–5 siguientes (verde), cada uno más tenue; no es una capa ni se guarda en los datos; se oculta al reproducir.

## Historial
Un único historial **global** por instantáneas inmutables (500 pasos): cubre trazos, capas y fotogramas, así que cambiar de fotograma o capa no lo rompe. Al deshacer/rehacer se enfoca el fotograma que cambió (p. ej. el que reaparece al deshacer «eliminar»). Un arrastre de selección ocupa **una** entrada. El historial no se persiste entre sesiones.

## Guardado
Autoguardado ~1,2 s después del último cambio, **solo cuando es seguro** (no a mitad de trazo ni de arrastre). Estado visible: Guardado / Cambios sin guardar / Guardando… / Sin conexión · borrador local / Conflicto.
Además: borrador local en cada cambio, guardado al ocultar la pestaña, envío `keepalive` al cerrarla y guardado al pulsar «← Proyecto».

## Rendimiento
- Mapas de bits por capa y fotograma en caché **por identidad del array de trazos** (el motor es inmutable), con presupuesto de memoria LRU (320 MB escritorio, 128 MB táctil).
- El trazo en vivo se pinta tramo a tramo en un lienzo propio; al confirmarlo se incorpora al mapa de bits de la capa sin repintar todo.
- Los trazos translúcidos usan un lienzo temporal **del tamaño del trazo** (no del lienzo): pasó de ~16 ms a <1 ms por trazo.
- Tramos consecutivos de igual grosor se pintan con un único trazado.
- Miniaturas y papel cebolla se construyen a partir de las capas ya cacheadas o a baja resolución.

Medido (`e2e/output/perf.json`, doc de 600 trazos a 1920×1080): con CPU normal dibujar y borrar sostienen 60 fps; con la CPU limitada a 1/4, ~58 ms/fotograma (un lienzo **vacío** ya cuesta ~40 ms en este navegador sin GPU). Pintar en frío una capa de 600 trazos: ~0,6 s a 1/4 de CPU.

## Pruebas
`npm run check` (tipos, lint, 102 tests unitarios) y `npm run e2e` (navegador real: escritorio y Pixel 7 emulado con táctil por CDP). Los e2e usan `window.__gas` (solo lectura/diagnóstico) para leer el estado.
