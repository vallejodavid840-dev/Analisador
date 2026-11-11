export type ExportErrorCode =
  | "ffmpeg-missing"
  | "encoder-missing"
  | "file-exists"
  | "invalid-options"
  | "cancelled"
  | "disk-full"
  | "permission"
  | "ffmpeg-failed"
  | "validation-failed"
  | "render-failed"
  | "internal";

/** Error de exportación con un mensaje que el usuario puede entender (en español). */
export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string,
    /** Detalle técnico (salida de FFmpeg…) para el registro; no se muestra al usuario por defecto. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ExportError";
  }
}

/** Traduce la salida de error de FFmpeg (o del sistema) a un mensaje comprensible. */
export function describeFfmpegFailure(stderr: string, exitCode: number | null, signal?: string | null): ExportError {
  const s = stderr.trim();
  const last = s.split("\n").filter(Boolean).slice(-3).join(" · ");
  if (/no space left|ENOSPC|disk quota|not enough space/i.test(s)) {
    return new ExportError("disk-full", "No hay espacio suficiente en el disco para terminar la exportación. Libera espacio e inténtalo de nuevo.", last);
  }
  if (/permission denied|EACCES|EPERM|read-only file system/i.test(s)) {
    return new ExportError("permission", "No se puede escribir en la carpeta de exportaciones (permisos insuficientes).", last);
  }
  if (/unknown encoder|encoder .* not found|unrecognized option 'c:v'|Unknown encoder/i.test(s)) {
    return new ExportError("encoder-missing", "Esta instalación de FFmpeg no incluye el codificador necesario para este formato. Instala una versión completa de FFmpeg (con libx264 y libvpx).", last);
  }
  if (/dimensions? not divisible|width not divisible|height not divisible/i.test(s)) {
    return new ExportError("ffmpeg-failed", "La resolución elegida no es válida para este formato de vídeo (debe ser par).", last);
  }
  if (/out of memory|cannot allocate memory|ENOMEM|Failed to allocate/i.test(s)) {
    return new ExportError("ffmpeg-failed", "No hay memoria suficiente para exportar con esta resolución. Prueba con una resolución menor.", last);
  }
  if (signal) {
    return new ExportError("ffmpeg-failed", `FFmpeg se detuvo de forma inesperada (${signal}).`, last);
  }
  return new ExportError("ffmpeg-failed", `FFmpeg no pudo generar el vídeo (código ${exitCode ?? "?"}).${last ? ` Detalle: ${last}` : ""}`, last);
}
