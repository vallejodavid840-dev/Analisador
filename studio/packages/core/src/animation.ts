import { z } from "zod";
import { IdSchema, FpsSchema } from "./schema";
import { migrate, ProjectFormatError, type Migration } from "./migrate";
import { CharacterBlockSchema, InstanceSchema } from "./character";
import { MAX_SKELETONS, PoseKeySchema, SkeletonSchema } from "./rig";

/** Versión del formato de `episodes/<id>.json`. Independiente de la del proyecto. */
export const ANIMATION_SCHEMA_VERSION = 3;

/** Fase 4: 128 (antes 64) para poder tener varios personajes con sus capas de sombra en un episodio. */
export const MAX_LAYERS = 128;
export const MAX_FRAMES = 2000;
export const MAX_HOLD = 48;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color no válido");

/**
 * Un trazo vectorial. `points` es una lista plana [x, y, presión, x, y, presión, …]
 * en píxeles del lienzo (origen arriba-izquierda). Presión 0–1 (ratón = 1).
 * Ancho en cada punto = size · (1 − sens · (1 − presión)).
 * `eraser` borra lo que hay debajo dentro de su capa (no destructivo: deshacer es exacto).
 * `fill` (Fase 4) es una forma cerrada rellena: `points` es su contorno (el último punto se une con el primero).
 */
export const StrokeSchema = z.object({
  id: IdSchema,
  kind: z.enum(["pen", "eraser", "fill"]),
  color: HexColor,
  size: z.number().min(0.1).max(2000),
  opacity: z.number().min(0).max(1),
  sens: z.number().min(0).max(1),
  points: z
    .array(z.number())
    .min(3)
    .max(300_000)
    .refine((a) => a.length % 3 === 0, "points debe tener longitud múltiplo de 3"),
});

export const LayerSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(60),
  visible: z.boolean(),
  locked: z.boolean(),
  /** Fase 4 (todo opcional: ausente = normal). Opacidad de la capa entera. */
  opacity: z.number().min(0).max(1).optional(),
  /** Modo de mezcla con lo de debajo (sombras = multiplicar, luces = trama/aclarar, brillos = sumar). */
  blend: z.enum(["normal", "multiply", "screen", "overlay", "add"]).optional(),
  /** Recorta la capa a lo dibujado en la capa base de debajo (sombras que no se salen de la prenda). */
  clip: z.boolean().optional(),
  /** Desenfoque en unidades del lienzo (sombras suaves). 0 = duro. */
  blur: z.number().min(0).max(60).optional(),
  /** Parte del personaje a la que pertenece (head, eyes, brows, mouth, hair-front, torso…). */
  part: z.string().trim().min(1).max(40).optional(),
  /** Agrupa las capas de un mismo personaje/prenda al insertarlas en episodios. */
  group: z.string().trim().min(1).max(60).optional(),
});

export const FrameSchema = z.object({
  id: IdSchema,
  /** Cuántos fotogramas del reloj dura este dibujo (2 = «a doses» en animación tradicional). */
  hold: z.number().int().min(1).max(MAX_HOLD),
  /** Trazos por capa (clave = id de capa). Orden del array = orden de dibujo. */
  cells: z.record(IdSchema, z.array(StrokeSchema)),
  /** Keyframes de pose por esqueleto (Fase 3). Un fotograma sin entrada se interpola entre sus keys vecinos. */
  poses: z.record(IdSchema, PoseKeySchema).optional(),
});

export const AnimationSchema = z.object({
  schemaVersion: z.literal(ANIMATION_SCHEMA_VERSION),
  episodeId: IdSchema,
  /** Contador que incrementa el servidor en cada guardado (control de concurrencia). */
  revision: z.number().int().min(0),
  fps: FpsSchema,
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(7680),
  /** De abajo (índice 0) a arriba. */
  layers: z.array(LayerSchema).min(1).max(MAX_LAYERS),
  frames: z.array(FrameSchema).min(1).max(MAX_FRAMES),
  /** Esqueletos y vínculos (Fase 3). Ausente en animaciones anteriores: se leen igual, sin rig. */
  rigs: z.array(SkeletonSchema).max(MAX_SKELETONS).optional(),
  /** Datos de personaje (Fase 4): solo existe en el dibujo de un personaje de la biblioteca. */
  character: CharacterBlockSchema.optional(),
  /** Personajes de la biblioteca insertados en este episodio (Fase 4). */
  instances: z.array(InstanceSchema).max(12).optional(),
});

export type Stroke = z.infer<typeof StrokeSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type Animation = z.infer<typeof AnimationSchema>;

/** Id corto aleatorio (válido según ID_PATTERN) para trazos, que se crean a miles. */
export function shortId(): string {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function longId(): string {
  return globalThis.crypto.randomUUID();
}

export interface NewAnimation {
  episodeId: string;
  fps: number;
  width: number;
  height: number;
}

export function createAnimation(input: NewAnimation): Animation {
  return AnimationSchema.parse({
    schemaVersion: ANIMATION_SCHEMA_VERSION,
    episodeId: input.episodeId,
    revision: 0,
    fps: input.fps,
    width: input.width,
    height: input.height,
    layers: [
      { id: longId(), name: "Color", visible: true, locked: false },
      { id: longId(), name: "Líneas", visible: true, locked: false },
    ],
    frames: [{ id: longId(), hold: 1, cells: {} }],
  });
}

/**
 * v1 → v2 (Fase 3): se añaden `rigs` y `frames[].poses`, ambos OPCIONALES, así que un documento v1 es ya un v2
 * válido; la migración solo sube la versión. (Una aplicación anterior rechazará un v2 con «versión más nueva»
 * en vez de descartar el rig en silencio al guardar.)
 */
export const ANIMATION_MIGRATIONS: readonly Migration[] = [
  { from: 1, to: 2, up: (raw) => raw },
  /** v2 → v3 (Fase 4): propiedades de capa, trazos «fill» y bloque `character`, todo opcional. */
  { from: 2, to: 3, up: (raw) => raw },
];

export function parseAnimation(raw: unknown): Animation {
  const { data } = migrate(raw, ANIMATION_MIGRATIONS, ANIMATION_SCHEMA_VERSION);
  const r = AnimationSchema.safeParse(data);
  if (!r.success) {
    throw new ProjectFormatError(
      `Animación inválida: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      "invalid",
    );
  }
  return r.data;
}
