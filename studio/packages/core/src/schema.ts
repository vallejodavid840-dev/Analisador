import { z } from "zod";

/** Versión actual del formato de proyecto. Súbela al cambiar el esquema y añade una migración. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Velocidades de fotogramas ofrecidas como preajuste. Se admite cualquier entero 1–120. */
export const FPS_PRESETS = [12, 24, 30] as const;

/** Identificadores: seguros para usarse como nombre de carpeta (sin separadores ni puntos). */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const IdSchema = z.string().regex(ID_PATTERN, "Identificador no válido");
const NameSchema = z.string().trim().min(1, "El nombre no puede estar vacío").max(120);
const IsoDate = z.string().datetime();

export const FpsSchema = z.number().int().min(1).max(120);

export const EpisodeSchema = z.object({
  id: IdSchema,
  title: NameSchema,
});

export const SeasonSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  episodes: z.array(EpisodeSchema),
});

export const ProjectSettingsSchema = z.object({
  fps: FpsSchema,
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(7680),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: IdSchema,
  name: NameSchema,
  createdAt: IsoDate,
  updatedAt: IsoDate,
  settings: ProjectSettingsSchema,
  seasons: z.array(SeasonSchema),
});

export type Episode = z.infer<typeof EpisodeSchema>;
export type Season = z.infer<typeof SeasonSchema>;
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type Project = z.infer<typeof ProjectSchema>;

/** Datos para crear un proyecto nuevo. */
export const NewProjectSchema = z.object({
  name: NameSchema,
  settings: ProjectSettingsSchema.partial().optional(),
});
export type NewProject = z.infer<typeof NewProjectSchema>;

/** Carpetas que forma parte del formato `.gangstudio` (ver docs/FORMATO_PROYECTO.md). */
export const PROJECT_SUBDIRS = ["characters", "gangs", "scenes", "episodes", "assets"] as const;
