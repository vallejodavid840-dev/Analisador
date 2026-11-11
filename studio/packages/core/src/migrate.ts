import { CURRENT_SCHEMA_VERSION, ProjectSchema, type Project } from "./schema";

export type RawProject = Record<string, unknown>;

/** Una migración transforma un proyecto de la versión `from` a `to` (= from + 1). */
export interface Migration {
  readonly from: number;
  readonly to: number;
  up(raw: RawProject): RawProject;
}

/**
 * Registro de migraciones reales. Está vacío porque la versión 1 es la primera.
 * Al cambiar el esquema: sube CURRENT_SCHEMA_VERSION y añade aquí `{ from: N, to: N + 1, up }`.
 */
export const MIGRATIONS: readonly Migration[] = [];

export class ProjectFormatError extends Error {
  constructor(
    message: string,
    readonly code: "invalid" | "too-new" | "no-path",
  ) {
    super(message);
    this.name = "ProjectFormatError";
  }
}

export interface MigrationResult {
  data: RawProject;
  fromVersion: number;
  migrated: boolean;
}

/** Aplica en orden todas las migraciones necesarias. No modifica el objeto de entrada. */
export function migrate(
  raw: unknown,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): MigrationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ProjectFormatError("El archivo de proyecto no es un objeto JSON", "invalid");
  }
  const version = (raw as RawProject)["schemaVersion"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new ProjectFormatError("Falta schemaVersion o no es válido", "invalid");
  }
  if (version > target) {
    throw new ProjectFormatError(
      `El proyecto es de la versión ${version}, más nueva que la soportada (${target}). Actualiza la aplicación.`,
      "too-new",
    );
  }
  let data: RawProject = structuredClone(raw as RawProject);
  let current = version;
  while (current < target) {
    const step = migrations.find((m) => m.from === current);
    if (!step) {
      throw new ProjectFormatError(`No hay migración desde la versión ${current}`, "no-path");
    }
    data = { ...step.up(data), schemaVersion: step.to };
    current = step.to;
  }
  return { data, fromVersion: version, migrated: version !== target };
}

export interface ParsedProject {
  project: Project;
  fromVersion: number;
  migrated: boolean;
}

/** Migra si hace falta y valida contra el esquema actual. */
export function parseProject(raw: unknown): ParsedProject {
  const { data, fromVersion, migrated } = migrate(raw);
  const result = ProjectSchema.safeParse(data);
  if (!result.success) {
    throw new ProjectFormatError(
      `Proyecto inválido: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      "invalid",
    );
  }
  return { project: result.data, fromVersion, migrated };
}
