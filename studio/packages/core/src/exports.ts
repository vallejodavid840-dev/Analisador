import { z } from "zod";

/** Formatos de exportación. `png` = un fotograma; `png-seq` = todos, en un ZIP. */
export const ExportFormatSchema = z.enum(["mp4", "webm", "png-seq", "png"]);
export const QualitySchema = z.enum(["low", "medium", "high", "max"]);

export const ResolutionSchema = z.union([
  z.object({ kind: z.literal("original") }),
  /** Lado corto en píxeles (720 = «720p» en horizontal y 720×1280 en vertical). */
  z.object({ kind: z.literal("short-side"), px: z.number().int().min(16).max(7680) }),
]);

export const ExportOptionsSchema = z.object({
  format: ExportFormatSchema,
  /** Nombre sin ruta; se sanea y se le pone la extensión del formato. */
  fileName: z.string().min(1).max(300),
  resolution: ResolutionSchema,
  /** Por defecto, los FPS de la animación. */
  fps: z.number().int().min(1).max(120).optional(),
  quality: QualitySchema.default("high"),
  background: z.object({ transparent: z.boolean(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color no válido") }),
  /** Solo `png`: fotograma (0-based) a exportar. */
  frameIndex: z.number().int().min(0).optional(),
  /** Sustituir un archivo existente con el mismo nombre (si no, se rechaza). */
  overwrite: z.boolean().default(false),
  /** Si el nombre existe, usar «nombre (2)» en vez de rechazar. */
  autoRename: z.boolean().default(false),
});

export type ExportFormat = z.infer<typeof ExportFormatSchema>;
export type Quality = z.infer<typeof QualitySchema>;
export type ResolutionSpec = z.infer<typeof ResolutionSchema>;
export type ExportOptions = z.input<typeof ExportOptionsSchema>;
export type ParsedExportOptions = z.output<typeof ExportOptionsSchema>;

export type ExportJobState = "queued" | "running" | "done" | "error" | "cancelled";
export type ExportPhase = "queued" | "preparing" | "rendering" | "finalizing" | "validating" | "done";

export interface ExportResultDTO {
  fileName: string;
  bytes: number;
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSec: number;
  drawings: number;
}

/** Estado de un trabajo de exportación, tal como lo ve el cliente. */
export interface ExportJobDTO {
  id: string;
  projectId: string;
  episodeId: string;
  format: ExportFormat;
  fileName: string;
  state: ExportJobState;
  phase: ExportPhase;
  /** Fotogramas de salida procesados / totales: progreso REAL, no estimado. */
  done: number;
  total: number;
  error?: { code: string; message: string };
  result?: ExportResultDTO;
  createdAt: string;
  updatedAt: string;
}

export interface ExportFileDTO {
  name: string;
  bytes: number;
  modifiedAt: string;
}

export interface ExportCapabilitiesDTO {
  ffmpeg: { available: boolean; version: string | null; message: string | null };
  formats: Record<ExportFormat, { available: boolean; reason: string | null }>;
}
