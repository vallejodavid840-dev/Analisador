# Formato de proyecto `.gangstudio`

Un proyecto es una **carpeta** `<id>.gangstudio/` con JSON versionado. Formato abierto, apto para git.

```
<id>.gangstudio/
  project.json      metadatos, ajustes (fps, resolución), temporadas y episodios
  characters/       (vacía; se usará en la Fase 4)
  gangs/            (Fase 7)
  scenes/           (Fase 5)
  episodes/<idEpisodio>.json   dibujo y animación del episodio (Fase 1)
  episodes/<idEpisodio>.json.prev   copia de la versión anterior (se renueva en cada guardado)
  exports/          vídeos e imágenes exportados (Fase 2); `.tmp-*` son temporales y se limpian solos
  assets/           (imágenes, audio)
```

## `project.json` (schemaVersion 1)

| Campo | Tipo | Notas |
|---|---|---|
| `schemaVersion` | entero | versión del formato |
| `id` | `[A-Za-z0-9_-]{1,64}` | también es el nombre de la carpeta (seguro frente a `../`) |
| `name` | texto 1–120 | |
| `createdAt`, `updatedAt` | ISO 8601 | `updatedAt` crece estrictamente en cada guardado |
| `settings.fps` | entero 1–120 | preajustes 12, 24, 30 |
| `settings.width/height` | entero 16–7680 | |
| `seasons[].episodes[]` | `{id, name/title}` | |

La definición ejecutable es `packages/core/src/schema.ts` (Zod).

## Garantías de integridad

- **Escritura atómica**: archivo temporal + `rename`; un corte no deja un `project.json` a medias.
- **Control de concurrencia**: guardar exige que `updatedAt` coincida con el del disco; si otro dispositivo guardó antes → error 409 y la interfaz ofrece recargar. Nunca se pisan cambios en silencio.
- **Archivos dañados**: se informan en la lista y **no se modifican ni se borran**.
- **Versiones más nuevas**: se rechazan sin tocar el archivo.
- **Migraciones**: `packages/core/src/migrate.ts`. Al abrir un proyecto antiguo se guarda primero `project.json.bak-v<N>` y luego se reescribe migrado. El registro está vacío porque la v1 es la primera (ver «Limitaciones»).

## `episodes/<idEpisodio>.json` (schemaVersion 1) — Fase 1

**`project.json` no cambia con la Fase 1**: los proyectos de la Fase 0 se abren igual y guardar dibujos nunca lo reescribe
(hay un test que lo comprueba byte a byte). Si un episodio aún no tiene archivo, se ofrece uno vacío con el FPS y la resolución del proyecto, sin escribir nada hasta el primer guardado.

| Campo | Tipo | Notas |
|---|---|---|
| `schemaVersion` | 1 | versión propia, independiente de la del proyecto; con su registro de migraciones |
| `episodeId` | id | debe existir en `project.json` |
| `revision` | entero ≥ 0 | la incrementa el servidor en cada guardado (control de concurrencia) |
| `fps` | entero 1–120 | presets 12/24/30; se hereda del proyecto al crear |
| `width`, `height` | entero | resolución del lienzo, copiada del proyecto |
| `layers[]` | `{id, name, visible, locked}` | de ABAJO (índice 0) a ARRIBA; 1–64 capas |
| `frames[]` | `{id, hold, cells}` | 1–2000 dibujos; `hold` 1–48 = cuántos fotogramas del reloj dura (2 = «a doses») |
| `frames[].cells` | `{[idCapa]: Stroke[]}` | trazos por capa, en orden de dibujo; las capas vacías no tienen entrada |

**Stroke** (vectorial, editable): `{id, kind: "pen"|"eraser", color: "#rrggbb", size, opacity, sens, points}`

- `points` es una lista plana `[x, y, presión, x, y, presión, …]` en píxeles del lienzo. Presión 0–1 (ratón y dedo = 1).
- Ancho en cada punto = `size · (1 − sens · (1 − presión))`.
- `eraser` borra lo que hay debajo **dentro de su capa**; es un trazo más (no destructivo), por eso deshacer es exacto.
- Los puntos se redondean a 0,1 px y la presión a 0,01 para que los archivos sean compactos.

Los **ajustes de la interfaz** (herramienta, tamaños, color, papel cebolla, «dibujar con el dedo») no van en el proyecto:
se guardan por dispositivo en `localStorage`.

### Integridad (Fase 1)

- Guardado con **control de revisión**: si otro dispositivo guardó antes → 409 y el cliente se detiene en vez de pisarlo
  (si el servidor ya tiene exactamente lo mismo, p. ej. por el envío al cerrar la pestaña, adopta su revisión sin avisar).
- Escritura atómica y copia `.prev` antes de sobrescribir. Un archivo dañado se informa y **no se modifica**.
- **Borrador local** (IndexedDB) en cada cambio: si se cae la red o el navegador muere, el trabajo se recupera al volver.

## Fase 3: `schemaVersion 2` del episodio (rigging)

Campos **opcionales** añadidos: `rigs[]` (esqueletos: `bones`, `bindings`) y `frames[].poses` (`{[idEsqueleto]: {bones: {[idHueso]: {r, x?, y?}}, ease}}`). Detalle en `RIGGING.md`.

- Migración v1→v2: sin cambios de datos (los campos nuevos son opcionales). Un episodio v1 se abre igual.
- Al guardar por primera vez un archivo v1 ya migrado, se conserva una copia `<episodio>.json.bak-v1` (una sola vez) además de `.prev`.
- Al borrar una capa se eliminan sus vínculos.

## Fase 4: `schemaVersion 3` del dibujo (personajes)

Todo opcional (un v2 es ya un v3 válido): capas con `opacity`, `blend`, `clip`, `blur`, `part`, `group`; trazos `kind: "fill"` (forma cerrada rellena); `character` (proporciones, vistas, expresiones, prendas, poses guardadas, parámetros `look`, referencias, paletas) e `instances` (personajes insertados en un episodio). `MAX_LAYERS` pasa de 64 a 128. La migración v2→v3 no cambia datos; el primer guardado conserva `.bak-v2`.

Biblioteca (`<datos>/_personajes/<id>/`): `character.json` (ficha de 11 campos, carpeta, etiquetas, miniatura), `drawing.json`, `files/`. Detalle en `PERSONAJES.md`.
