import { z } from "zod";
import { IdSchema } from "./schema";
import { PoseKeySchema } from "./rig";

/**
 * Bloque «personaje» (Fase 4). Vive DENTRO del documento de dibujo del personaje (`Animation.character`) para que
 * deshacer/rehacer, guardado, borradores y exportación traten todo igual. Cada VISTA del personaje es un dibujo
 * (fotograma) independiente: una vista nunca se genera girando otra.
 */

export const VIEW_KINDS = ["front", "threeQuarter", "side", "back"] as const;
export const ViewKindSchema = z.enum(VIEW_KINDS);
export type ViewKind = z.infer<typeof ViewKindSchema>;

const f = (min: number, max: number) => z.number().min(min).max(max);

/** Proporciones paramétricas. Todo es relativo, así que sirve igual para un adolescente que para un adulto. */
export const ProportionsSchema = z.object({
  /** Altura ficticia en cm (solo informativa + escala de cabeza). */
  heightCm: f(120, 230),
  /** Cabezas de alto (anime adolescente/adulto: 6,8–8,2). */
  heads: f(5.5, 9.5),
  /** 0,8–1,5: ancho de hombros relativo a lo normal. */
  shoulders: f(0.7, 1.6),
  /** 0 = delgado, 1 = fornido. */
  build: f(0, 1),
  arms: f(0.75, 1.3),
  legs: f(0.75, 1.3),
  hands: f(0.6, 1.5),
  feet: f(0.6, 1.5),
  /** Longitud del torso. */
  torso: f(0.8, 1.25),
  /** -1 = espalda recta/pecho abierto, 0 = natural, 1 = encorvado. */
  posture: f(-1, 1),
});
export type Proportions = z.infer<typeof ProportionsSchema>;

export const DEFAULT_PROPORTIONS: Proportions = Object.freeze({
  heightCm: 172,
  heads: 7.6,
  shoulders: 1,
  build: 0.4,
  arms: 1,
  legs: 1,
  hands: 1,
  feet: 1,
  torso: 1,
  posture: 0,
});

/** Estado de una expresión: los dibujos de las capas de rostro (ojos, cejas, boca, marcas…) en el momento de guardarla. */
export const ExpressionSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(60),
  /** Trazos por capa (clave = id de capa). Solo capas con `part` de rostro. */
  cells: z.record(IdSchema, z.array(z.any())),
  /** Preajuste paramétrico con el que se generó, si lo hubo (informativo). */
  preset: z.string().max(40).optional(),
});

export const GarmentParamValue = z.union([z.number().finite(), z.string().max(60), z.boolean()]);

/** Prenda paramétrica: sus parámetros se conservan para volver a editarla (anchura, largo, mangas, cuello…). */
export const GarmentSchema = z.object({
  id: IdSchema,
  type: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  params: z.record(z.string().max(40), GarmentParamValue),
  /** Capas que la componen (base, sombras, detalles). */
  layerIds: z.array(IdSchema).max(24),
});

/** Pose guardada con nombre (clave de pose completa del esqueleto del personaje). */
export const SavedPoseSchema = z.object({ id: IdSchema, name: z.string().trim().min(1).max(60), key: PoseKeySchema });
export type SavedPose = z.infer<typeof SavedPoseSchema>;

export const CharacterBlockSchema = z.object({
  proportions: ProportionsSchema,
  /** Qué fotograma es cada vista. */
  views: z.array(z.object({ frameId: IdSchema, kind: ViewKindSchema })).max(8),
  expressions: z.array(ExpressionSchema).max(40),
  garments: z.array(GarmentSchema).max(40),
  poses: z.array(SavedPoseSchema).max(60).default([]),
  /** Parámetros con los que se generó cada herramienta (rostro, pelo, piel…), para volver a editarlos. */
  look: z.record(z.string().max(40), z.any()).default({}),
  /** Imágenes de referencia por vista (archivos en la biblioteca; no se exportan). */
  refs: z
    .array(z.object({ id: IdSchema, view: ViewKindSchema, file: z.string().max(80), opacity: z.number().min(0).max(1), x: z.number(), y: z.number(), scale: z.number().min(0.05).max(20), visible: z.boolean() }))
    .max(16)
    .default([]),
  /** Paletas guardadas (piel, cabello, ropa…). */
  palettes: z
    .array(z.object({ name: z.string().trim().min(1).max(40), colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(24) }))
    .max(30),
});
export type CharacterBlock = z.infer<typeof CharacterBlockSchema>;
export type Expression = z.infer<typeof ExpressionSchema>;
export type Garment = z.infer<typeof GarmentSchema>;

/** Ficha del personaje (metadatos editables a mano; no forman parte del dibujo). */
export const CharacterSheetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  age: z.string().max(20),
  height: z.string().max(20),
  description: z.string().max(4000),
  personality: z.string().max(4000),
  gang: z.string().max(80),
  rank: z.string().max(80),
  history: z.string().max(8000),
  relations: z.string().max(4000),
  design: z.string().max(4000),
  outfit: z.string().max(4000),
});
export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;
export const EMPTY_SHEET = (name: string): CharacterSheet => ({ name, age: "", height: "", description: "", personality: "", gang: "", rank: "", history: "", relations: "", design: "", outfit: "" });

/** Registro de la biblioteca (character.json). El dibujo va aparte, en drawing.json. */
export const CharacterMetaSchema = z.object({
  schemaVersion: z.literal(1),
  id: IdSchema,
  sheet: CharacterSheetSchema,
  folder: z.string().trim().max(60),
  tags: z.array(z.string().trim().min(1).max(30)).max(20),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Miniatura (data URL PNG pequeña) de la vista frontal; la genera el editor al guardar. */
  thumbnail: z.string().max(200_000).nullable(),
});
export type CharacterMeta = z.infer<typeof CharacterMetaSchema>;

/** Un personaje insertado en un episodio. Es una COPIA autónoma: sobrevive aunque se borre o cambie el personaje de la biblioteca. */
export const InstanceSchema = z.object({
  id: IdSchema,
  characterId: IdSchema,
  name: z.string().trim().min(1).max(80),
  view: ViewKindSchema,
  scale: z.number().min(0.01).max(50),
  tx: z.number(),
  ty: z.number(),
  skeletonId: IdSchema.nullable(),
  layerIds: z.array(IdSchema).max(128),
  expressions: z.array(ExpressionSchema).max(40),
  poses: z.array(SavedPoseSchema).max(60),
});
export type Instance = z.infer<typeof InstanceSchema>;
