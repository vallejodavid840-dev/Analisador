# Rigging 2D (Fase 3)

Esqueleto de huesos + vínculos de capas + poses con keyframes, integrado en el editor, la línea de tiempo, el guardado y la exportación.
Sin IA generativa ni servicios externos: todo es matemática propia en `@gas/engine` (`rig.ts`, `rig-ops.ts`).

## Auditoría previa (lo que ya había y cómo se aprovechó)

- Dibujo **vectorial**: trazos con puntos de control (`points`), por capa y por fotograma. Esto permite deformar puntos reales sin perder calidad.
- Un único embudo de render, `composeFrame(layers, frame)`, usado por lienzo, miniaturas, papel cebolla y exportación. El rig se inserta **antes** de él con `posedFrame(doc, i)`: por eso editor, reproducción, PNG, MP4 y WebM muestran lo mismo (comprobado: diferencia 0 px editor↔PNG).
- Las capas son globales y los dibujos son por fotograma; el reloj de reproducción usa `frameStartTicks`. La interpolación usa ese mismo reloj.
- Formato: se añadió `schemaVersion 2` con campos **opcionales**; los proyectos v1 se abren sin cambios (ver `FORMATO_PROYECTO.md`).

## Arquitectura

| Pieza | Dónde | Qué hace |
|---|---|---|
| Esquemas | `core/src/rig.ts` | Bone, Binding, Skeleton, PoseKey, validación (orden padre→hijo, sin duplicados, mín ≤ máx) |
| Matemática | `engine/src/rig.ts` | estados de reposo/pose, matrices de hueso, interpolación, pesos, deformación, `posedFrame` (memoria LRU) |
| Operaciones | `engine/src/rig-ops.ts` | crear/editar/reparentar/borrar huesos, vínculos, keyframes, copiar/pegar pose, plantilla humanoide (16 huesos) |
| Interfaz | `apps/studio/src/editor/rig-*.ts` | herramienta «Esqueleto», panel «Huesos», entrada táctil/ratón/lápiz, superposición |
| Exportación | `export/src/pipeline.ts` | `posedFrame` antes de `composeFrame` |

### Huesos y jerarquía
Cada hueso tiene padre, ancla en el espacio del padre (`ax, ay`), ángulo de reposo, longitud y límites mín/máx. La raíz tiene posición propia. Ángulos en grados, eje Y hacia abajo, positivo = sentido horario. La rotación se hereda por la cadena; los límites se aplican **siempre** (también al interpolar). El humanoide es solo una plantilla: se pueden añadir, quitar y reorganizar huesos.

### Vínculos y deformación (descripción honesta)
- **Rígido**: toda la capa sigue la matriz de un hueso (p. ej. la cabeza).
- **Deformable**: cada **punto de control del trazo** se mueve con una mezcla lineal de las matrices de hasta 4 huesos (*linear blend skinning*). Pesos `w ∝ 1/(distancia + suavidad)^nitidez` a los segmentos de los huesos influyentes, normalizados (combinación convexa: nunca extrapola). Los trazos se densifican para que doblen bien.
- **No** hay malla de triángulos, ni conservación de volumen, ni squash/stretch. A ángulos grandes puede aparecer el efecto «caramelo» típico del skinning lineal. Lo que no está vinculado a un hueso no se mueve.

### Poses y animación
- La pose pertenece al dibujo (fotograma) — los keyframes son `frames[i].poses[skeletonId]`: `{ bones: {r, x?, y?}, ease: linear|smooth|step }`.
- Entre keyframes se interpola en el tiempo real del reloj (no por número de dibujo), así que respeta los «holds» y el FPS del proyecto.
- Editar un hueso en un fotograma crea/actualiza su keyframe. Duplicar fotograma copia sus poses.
- Copiar/pegar pose, pose de reposo, keyframe anterior/siguiente, duplicar al siguiente, eliminar keyframe, tipo de interpolación.

### Modos del editor
- **Editar esqueleto**: vista en reposo; crear, mover, reorientar y borrar huesos; ancla y límites.
- **Poner pose**: girar/mover huesos arrastrando o con campos numéricos.
- Dibujar sobre una capa vinculada solo se permite en vista de reposo o con «Ver sin deformar» (si no, el trazo caería deformado). «Copiar el dibujo de las capas vinculadas a todos los fotogramas» sincroniza el arte entre dibujos.

## Rendimiento
Memoria LRU de fotogramas deformados, caché de pesos por identidad del array de trazos, capas deformadas dibujadas por un lienzo temporal a escala de pantalla, miniaturas diferidas mientras se arrastra, panel sin refrescos durante la reproducción. Medido en Chromium sin GPU (`capturas/rig-perf.json`): 40 huesos, 60 trazos, 1920×1080, reproducción a 24 FPS sostenida al 72 % (la misma animación «horneada» sin rig: 53 %), arrastre 47 ms/fotograma. Caso extremo en zigzag: 47 %, 118 ms. Son cifras de un navegador por software, no de un móvil real.

## Limitaciones conocidas
- Sin squash/stretch ni escala de huesos (solo rotación + traslación de la raíz).
- Deformación por puntos de trazo, no malla; sin preservación de volumen.
- Máx. 4 influencias por punto, 128 huesos, 8 esqueletos por episodio.
- La pose es por dibujo, no se anima por debajo del fotograma.
- El borrador (goma) se deforma con su capa.
- El historial no se guarda en disco.
- Convención izq./der.: «izq.» es la izquierda **del personaje** (derecha en pantalla).
- Android probado en navegador emulado (táctil + viewport), no en dispositivo físico.
