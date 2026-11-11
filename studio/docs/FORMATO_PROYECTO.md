# Formato de proyecto `.gangstudio`

Un proyecto es una **carpeta** `<id>.gangstudio/` con JSON versionado. Formato abierto, apto para git.

```
<id>.gangstudio/
  project.json      metadatos, ajustes (fps, resolución), temporadas y episodios
  characters/       (vacía en Fase 0; se usará en la Fase 4)
  gangs/            (Fase 7)
  scenes/           (Fase 5)
  episodes/         (Fases 1 y 8: fotogramas, timeline)
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
