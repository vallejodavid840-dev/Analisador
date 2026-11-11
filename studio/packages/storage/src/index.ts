import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ID_PATTERN,
  PROJECT_SUBDIRS,
  ProjectFormatError,
  ProjectSchema,
  createProject,
  parseProject,
  type NewProject,
  type Project,
} from "@gas/core";

export const PROJECT_DIR_SUFFIX = ".gangstudio";
export const PROJECT_FILE = "project.json";

export type StorageErrorCode = "not-found" | "corrupt" | "invalid-id" | "conflict" | "invalid";

export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: StorageErrorCode,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  fps: number;
  seasons: number;
  episodes: number;
}

export interface ListEntry {
  summary?: ProjectSummary;
  /** Presente cuando la carpeta existe pero no se pudo leer (se informa, nunca se oculta ni se borra). */
  error?: { id: string; message: string };
}

export interface ProjectStore {
  list(): Promise<ListEntry[]>;
  create(input: NewProject): Promise<Project>;
  load(id: string): Promise<Project>;
  /** Guarda con control de concurrencia: `project.updatedAt` debe coincidir con el guardado en disco. */
  save(project: Project): Promise<Project>;
}

function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new StorageError(`Identificador no válido: ${id}`, "invalid-id");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Escritura atómica: archivo temporal en la misma carpeta + rename. Un corte no deja medio archivo. */
async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export function createProjectStore(rootDir: string): ProjectStore {
  const dirOf = (id: string) => join(rootDir, `${id}${PROJECT_DIR_SUFFIX}`);
  const fileOf = (id: string) => join(dirOf(id), PROJECT_FILE);

  /** Lee y valida. Si `persist`, deja copia de seguridad y reescribe el proyecto migrado. */
  async function read(id: string, persist: boolean): Promise<Project> {
    assertId(id);
    let text: string;
    try {
      text = await readFile(fileOf(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StorageError(`Proyecto no encontrado: ${id}`, "not-found");
      }
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new StorageError(`project.json de ${id} está dañado (JSON inválido). No se ha modificado.`, "corrupt");
    }
    let parsed;
    try {
      parsed = parseProject(raw);
    } catch (err) {
      if (err instanceof ProjectFormatError) throw new StorageError(err.message, "corrupt");
      throw err;
    }
    if (parsed.migrated && persist) {
      const backup = join(dirOf(id), `${PROJECT_FILE}.bak-v${parsed.fromVersion}`);
      if (!(await exists(backup))) await copyFile(fileOf(id), backup);
      await writeJsonAtomic(fileOf(id), parsed.project);
    }
    if (parsed.project.id !== id) {
      throw new StorageError(`El id del proyecto no coincide con su carpeta (${id})`, "corrupt");
    }
    return parsed.project;
  }

  async function write(project: Project): Promise<void> {
    const dir = dirOf(project.id);
    await mkdir(dir, { recursive: true });
    await Promise.all(PROJECT_SUBDIRS.map((d) => mkdir(join(dir, d), { recursive: true })));
    await writeJsonAtomic(fileOf(project.id), project);
  }

  return {
    async list() {
      await mkdir(rootDir, { recursive: true });
      const entries = await readdir(rootDir, { withFileTypes: true });
      const out: ListEntry[] = [];
      for (const e of entries) {
        if (!e.isDirectory() || !e.name.endsWith(PROJECT_DIR_SUFFIX)) continue;
        const id = e.name.slice(0, -PROJECT_DIR_SUFFIX.length);
        try {
          const p = await read(id, false);
          out.push({
            summary: {
              id: p.id,
              name: p.name,
              updatedAt: p.updatedAt,
              fps: p.settings.fps,
              seasons: p.seasons.length,
              episodes: p.seasons.reduce((n, s) => n + s.episodes.length, 0),
            },
          });
        } catch (err) {
          out.push({ error: { id, message: err instanceof Error ? err.message : String(err) } });
        }
      }
      return out.sort((a, b) => (b.summary?.updatedAt ?? "").localeCompare(a.summary?.updatedAt ?? ""));
    },

    async create(input) {
      const project = createProject(input);
      await write(project);
      return project;
    },

    load: (id) => read(id, true),

    async save(incoming) {
      const parsed = ProjectSchema.safeParse(incoming);
      if (!parsed.success) {
        throw new StorageError(parsed.error.issues.map((i) => i.message).join("; "), "invalid");
      }
      const current = await read(parsed.data.id, true);
      if (current.updatedAt !== parsed.data.updatedAt) {
        throw new StorageError(
          "El proyecto cambió en el disco desde que lo abriste (¿otro dispositivo?). Recárgalo antes de guardar.",
          "conflict",
        );
      }
      // Garantiza un sello estrictamente creciente incluso con guardados en el mismo milisegundo.
      const prev = Date.parse(current.updatedAt);
      const updatedAt = new Date(Math.max(Date.now(), prev + 1)).toISOString();
      const saved: Project = { ...parsed.data, updatedAt };
      await write(saved);
      return saved;
    },
  };
}
