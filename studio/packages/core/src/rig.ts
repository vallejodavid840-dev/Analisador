import { z } from "zod";
import { IdSchema } from "./schema";

/**
 * Rigging 2D. Convenciones:
 *  - Ángulos en GRADOS; 0° apunta a +x y los positivos giran en sentido horario en pantalla (el eje y baja).
 *  - Un hueso va de su «cabeza» (articulación) a su «cola» (extremo) a lo largo de `length`.
 *  - Los huesos se guardan en orden topológico: el padre siempre aparece antes que sus hijos.
 *  - La geometría de un hueso es de REPOSO (la del dibujo); las poses solo guardan giros respecto al reposo.
 */

export const MAX_BONES = 128;
export const MAX_SKELETONS = 8;

const num = z.number().finite();

export const BoneSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(60),
  /** null = hueso raíz. */
  parent: IdSchema.nullable(),
  /** Solo raíz: posición de reposo de la cabeza en el lienzo. */
  x: num,
  y: num,
  /**
   * Solo hijos: punto de anclaje en el padre, en el espacio del padre.
   * `ax` = fracción de la longitud del padre (0 = su cabeza, 1 = su cola); `ay` = desplazamiento perpendicular en px.
   */
  ax: num,
  ay: num,
  /** Ángulo de reposo: absoluto en la raíz, relativo al padre en los hijos. */
  angle: num,
  length: z.number().min(1).max(20000),
  /** Límites del giro de pose respecto al reposo (grados). */
  min: z.number().min(-720).max(720),
  max: z.number().min(-720).max(720),
});

export const BindingSchema = z.object({
  layerId: IdSchema,
  /** rigid: toda la capa sigue a un hueso. skin: los puntos de los trazos se mezclan entre varios huesos según pesos. */
  mode: z.enum(["rigid", "skin"]),
  bone: IdSchema,
  /** Solo skin: huesos que influyen (incluye `bone`). */
  influences: z.array(IdSchema).max(MAX_BONES),
  /** Solo skin: anchura de la zona de mezcla (px). Más alto = transición más suave. */
  softness: z.number().min(1).max(500),
  /** Solo skin: nitidez. Más alto = cada punto obedece casi solo a su hueso más cercano. */
  sharpness: z.number().min(0.5).max(8),
});

export const SkeletonSchema = z
  .object({
    id: IdSchema,
    name: z.string().trim().min(1).max(60),
    bones: z.array(BoneSchema).max(MAX_BONES),
    bindings: z.array(BindingSchema).max(64),
  })
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    for (const [i, b] of s.bones.entries()) {
      if (seen.has(b.id)) ctx.addIssue({ code: "custom", message: `hueso duplicado ${b.id}`, path: ["bones", i] });
      if (b.parent !== null && !seen.has(b.parent)) {
        ctx.addIssue({ code: "custom", message: `el padre de «${b.name}» no existe o aparece después (orden/ciclo)`, path: ["bones", i, "parent"] });
      }
      if (b.min > b.max) ctx.addIssue({ code: "custom", message: `límites invertidos en «${b.name}»`, path: ["bones", i] });
      seen.add(b.id);
    }
  });

/** Giro (y desplazamiento, solo en raíces) de un hueso respecto a su reposo. */
export const BonePoseSchema = z.object({ r: num, x: num.optional(), y: num.optional() });

export const EaseSchema = z.enum(["linear", "smooth", "step"]);

/** Un keyframe de pose: la pose COMPLETA del esqueleto en ese fotograma. */
export const PoseKeySchema = z.object({
  bones: z.record(IdSchema, BonePoseSchema),
  /** Cómo se interpola desde este key hasta el siguiente. */
  ease: EaseSchema.default("linear"),
});

export type Bone = z.infer<typeof BoneSchema>;
export type Binding = z.infer<typeof BindingSchema>;
export type Skeleton = z.infer<typeof SkeletonSchema>;
export type BonePose = z.infer<typeof BonePoseSchema>;
export type Ease = z.infer<typeof EaseSchema>;
export type PoseKey = z.infer<typeof PoseKeySchema>;
