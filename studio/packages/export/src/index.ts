import { fileURLToPath } from "node:url";
export * from "./errors";
export * from "./plan";
export * from "./ffmpeg";
export * from "./pipeline";
/** Ruta del script del proceso hijo (para lanzarlo con `node --import tsx <ruta>`). */
export const RUNNER_PATH = fileURLToPath(new URL("./runner.ts", import.meta.url));
