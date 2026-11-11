# Renderizado y exportación (Fase 2)

Desde el editor, el botón **Exportar** abre la ventana de exportación. Todo es software libre y gratuito: no hay marcas de agua, límites de duración, créditos ni servicios externos. La exportación **no depende del editor**: el servidor lee el episodio guardado en disco y lo renderiza en un proceso aparte.

## Formatos

| Formato | Contenido | Transparencia | Notas |
|---|---|---|---|
| **MP4 · H.264** | Vídeo `yuv420p`, BT.709, `faststart` | No (H.264 no tiene canal alfa) | El más compatible: móviles, navegadores, redes y editores |
| **WebM · VP9** | Vídeo VP9 | **Sí** (`yuva420p`) | Para superponer sobre otro fondo (OBS, web, editores) |
| **Secuencia PNG** | `.zip` con un PNG por fotograma (`nombre/nombre_00001.png`…) | **Sí** | Incluye los fotogramas repetidos por duración, listo para otros programas |
| **Fotograma PNG** | El fotograma actual | **Sí** | |

Opciones: **resolución** (original, 480p, 720p, 1080p, 1440p, 4K; se re-renderiza el vector a ese tamaño, no se escala una imagen), **FPS** (12, 24, 30 o los del proyecto), **calidad** (baja/media/alta/máxima = CRF 28/23/18/14 en H.264 y 42/33/26/18 en VP9), **fondo** (blanco, color o transparente) y **nombre**.
La resolución se define por el *lado corto* (720 = 1280×720 en horizontal y 720×1280 en vertical) y en vídeo se ajusta a medidas **pares** (requisito de `yuv420p`).

## Precisión: el vídeo es la animación

- `planFrames` (`@gas/export/plan`) decide qué dibujo se ve en cada fotograma de salida con **las mismas funciones** que el reproductor del editor (`@gas/engine/playback`). El fotograma `k` de salida se muestra en el instante `k/fps`, es decir, en el tick `floor(k · fpsProyecto / fps)`. Con los mismos FPS hay exactamente un fotograma por tick; con otros FPS la duración total se conserva (±½ fotograma).
- Cada dibujo distinto se **renderiza una sola vez** y se repite según su duración: una animación de 3 minutos con duraciones largas cuesta lo que sus dibujos, no lo que sus fotogramas.
- El render usa `composeFrame` (`@gas/render`), la **misma función** que usa el editor para miniaturas y papel cebolla: capas visibles de abajo arriba, cada una aislada (el borrador solo afecta a su capa), trazos en orden, con su color, opacidad y presión.
- Se renderiza con `@napi-rs/canvas` (Skia). El editor usa el Canvas del navegador (también Skia, otra versión), así que la comparación píxel a píxel no es idéntica bit a bit: difiere solo el suavizado de bordes (ver «Medidas»).

## Arquitectura

```
editor ──POST /api/projects/:id/episodes/:eid/exports──> ExportManager (servidor, cola)
   ▲                                                         │ spawn: node --import tsx runner.ts
   │ GET /api/exports/:id (progreso real, cada ~350 ms)      ▼
   └──────────────────────────────────────  proceso hijo: runExport()
                                                  ├─ composeFrame (Skia) → RGBA ─pipe→ ffmpeg (libx264 / libvpx-vp9)
                                                  └─ PNG / ZIP
```

- **No bloquea la interfaz ni la API**: el render y FFmpeg corren en un **proceso hijo**; el servidor solo coordina. Hay una prueba que comprueba que `/api/health` responde en <250 ms mientras se exporta.
- **Memoria**: se procesa un dibujo a la vez (el RGBA de un fotograma se descarta al repetirlo); el ZIP tiene contrapresión (máx. ~64 MB esperando a disco). Al terminar, el proceso hijo se cierra y libera todo.
- **Cola**: una exportación a la vez por defecto (cada una usa mucha CPU); las demás esperan y se pueden cancelar.

## Seguridad e integridad

- **Sin archivos incompletos**: se escribe en `exports/.tmp-*`, se **valida** y solo entonces se publica. Ante un error o una cancelación no queda nada; los temporales siempre se borran y, al arrancar el servidor, se eliminan los de exportaciones interrumpidas (corte de luz, `kill -9`).
- **Validación del resultado**: `ffprobe -count_frames` **decodifica todo el vídeo** y se comprueba códec, tamaño, FPS, nº de fotogramas, duración y canal alfa. ZIP: directorio central, nº de imágenes y firma PNG; PNG: firma y dimensiones.
- **No sobrescribe sin autorización**: si el nombre existe, la API responde 409 con un nombre alternativo sugerido; la interfaz ofrece *guardar como «nombre (2)»*, *sustituir* o *cambiar el nombre*. La publicación usa `link()` (atómico), así que ni siquiera dos exportaciones simultáneas se pisan.
- **Nombres seguros**: sin rutas ni caracteres peligrosos, extensión forzada por el formato; la descarga rechaza `..`, ocultos y extensiones no exportables.
- **Cancelación**: se pide al proceso hijo que pare (mata FFmpeg y limpia); si no responde en 4 s se mata él y FFmpeg (`SIGKILL`). Probado: tras cancelar no queda ningún proceso de FFmpeg ni archivos.
- **Mensajes de error comprensibles**: sin espacio, permisos, falta de FFmpeg/códec, memoria insuficiente, resolución no válida, vídeo no válido…

## API

| Método y ruta | Descripción |
|---|---|
| `GET /api/export/capabilities` | Qué formatos se pueden exportar y por qué no (FFmpeg ausente, falta H.264/VP9/ffprobe) |
| `POST /api/projects/:id/episodes/:eid/exports` | Inicia (202 + trabajo). 400 opciones inválidas · 409 el archivo existe (con `suggestion`) · 503 sin FFmpeg/códec |
| `GET /api/exports/:jobId` | Estado: `queued/running/done/error/cancelled`, fase, `done/total` fotogramas (progreso real) |
| `POST /api/exports/:jobId/cancel` | Cancela |
| `GET /api/projects/:id/exports?episode=` | Archivos exportados y trabajos recientes |
| `GET /api/projects/:id/exports/files/:name[?inline=1]` | Descarga (o reproducción) con soporte de `Range` |

Los archivos viven en `<proyecto>.gangstudio/exports/`.

## FFmpeg

Es un programa **externo** (no se enlaza ni se redistribuye con el estudio): se busca en el `PATH` o en `FFMPEG_PATH` / `FFPROBE_PATH`. Si falta, el estudio lo dice con instrucciones (`apt install ffmpeg`, `brew install ffmpeg`, `winget install ffmpeg`) y los formatos PNG siguen funcionando. Necesita `libx264` (MP4), `libvpx-vp9` (WebM) y `ffprobe`. Licencias: FFmpeg es LGPL/GPL según la compilación (libx264 es GPL); al invocarlo como proceso aparte no afecta a la licencia del estudio. `yazl` (ZIP) y `@napi-rs/canvas` son MIT.

## Pruebas

- Unitarias: plan de fotogramas/resoluciones/nombres, mensajes de error, `composeFrame` y pipeline con **FFmpeg real** (decodifica el vídeo y comprueba el color de cada fotograma contra una derivación independiente del tiempo; 12/24/30 FPS; resoluciones; alfa; ZIP; cancelación; errores simulados; proyecto grande).
- API: ciclo completo, `Range`, progreso, cancelación en curso y en cola, nombres, errores.
- e2e (navegador real, escritorio y Pixel 7): ventana de exportación, progreso real, cancelar, sobrescritura, transparencia, comparación con el editor, guardado previo, sin FFmpeg, Android, ejemplos.
