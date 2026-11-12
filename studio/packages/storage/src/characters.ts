import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ANIMATION_SCHEMA_VERSION,
  AnimationSchema,
  CharacterMetaSchema,
  CharacterSheetSchema,
  EMPTY_SHEET,
  ID_PATTERN,
  longId,
  parseAnimation,
  type Animation,
  type CharacterMeta,
  type CharacterSheet,
} from "@gas/core";
import { StorageError } from "./index";

export const CHARACTERS_DIR = "_personajes";
const META = "character.json";
const DRAWING = "drawing.json";
const FILES = "files";
/** Un archivo de la biblioteca (referencia, hoja…): nombre simple, sin rutas. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,78}\.(png|jpg|jpeg|webp)$/i;
const MAX_FILE_BYTES = 12 * 2 ** 20;

export interface CharacterListQuery {
  q?: string;
  folder?: string;
}

export interface CharacterStore {
  list(query?: CharacterListQuery): Promise<CharacterMeta[]>;
  /** Crea un personaje con el dibujo inicial que se le pase (el servidor genera el de 4 vistas). */
  create(input: { name: string; folder?: string; drawing: (id: string) => Animation }): Promise<CharacterMeta>;
  getMeta(id: string): Promise<CharacterMeta>;
  /** Cambia ficha, carpeta, etiquetas o miniatura. La ficha se valida entera. */
  updateMeta(id: string, patch: { sheet?: CharacterSheet; folder?: string; tags?: string[]; thumbnail?: string | null }): Promise<CharacterMeta>;
  loadDrawing(id: string): Promise<Animation>;
  /** Con control de revisión, igual que los episodios. Deja `.prev` y `.bak-v<N>` al migrar. */
  saveDrawing(drawing: Animation): Promise<{ revision: number }>;
  duplicate(id: string, name?: string): Promise<CharacterMeta>;
  remove(id: string): Promise<void>;
  putFile(id: string, name: string, data: Buffer): Promise<void>;
  filePath(id: string, name: string): Promise<string>;
  listFiles(id: string): Promise<string[]>;
  deleteFile(id: string, name: string): Promise<void>;
}

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(data)}\n`, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
const assertId = (id: string) => {
  if (!ID_PATTERN.test(id)) throw new StorageError(`Identificador no válido: ${id}`, "invalid-id");
};
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function createCharacterStore(projectsRoot: string): CharacterStore {
  const root = join(projectsRoot, CHARACTERS_DIR);
  const dirOf = (id: string) => join(root, id);

  async function readMeta(id: string): Promise<CharacterMeta> {
    assertId(id);
    let text: string;
    try {
      text = await readFile(join(dirOf(id), META), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new StorageError(`Personaje no encontrado: ${id}`, "not-found");
      throw err;
    }
    const r = CharacterMetaSchema.safeParse(JSON.parse(text));
    if (!r.success) throw new StorageError(`La ficha del personaje está dañada y no se ha modificado (${r.error.issues[0]?.message ?? "?"}).`, "corrupt");
    if (r.data.id !== id) throw new StorageError("El id de la ficha no coincide con su carpeta", "corrupt");
    return r.data;
  }

  async function readDrawing(id: string): Promise<{ anim: Animation; fromVersion: number }> {
    assertId(id);
    let text: string;
    try {
      text = await readFile(join(dirOf(id), DRAWING), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new StorageError(`Personaje no encontrado: ${id}`, "not-found");
      throw err;
    }
    try {
      const raw: unknown = JSON.parse(text);
      const fromVersion = Number((raw as { schemaVersion?: unknown }).schemaVersion);
      return { anim: parseAnimation(raw), fromVersion };
    } catch (err) {
      throw new StorageError(`El dibujo del personaje está dañado y no se ha modificado (${err instanceof Error ? err.message : String(err)}). Hay una copia en «.prev».`, "corrupt");
    }
  }

  const now = () => new Date().toISOString();

  return {
    async list(query = {}) {
      await mkdir(root, { recursive: true });
      const out: CharacterMeta[] = [];
      for (const e of await readdir(root, { withFileTypes: true })) {
        if (!e.isDirectory() || !ID_PATTERN.test(e.name)) continue;
        try {
          out.push(await readMeta(e.name));
        } catch {
          /* una ficha ilegible no oculta a las demás; se informa al abrirla */
        }
      }
      const q = query.q ? fold(query.q.trim()) : "";
      const filtered = out.filter((m) => {
        if (query.folder !== undefined && query.folder !== "" && m.folder !== query.folder) return false;
        if (!q) return true;
        const hay = fold([m.sheet.name, m.sheet.gang, m.sheet.rank, m.sheet.description, m.sheet.personality, m.sheet.outfit, m.folder, ...m.tags].join(" "));
        return q.split(/\s+/).every((t) => hay.includes(t));
      });
      return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async create({ name, folder, drawing }) {
      const id = longId();
      const doc = drawing(id);
      const parsed = AnimationSchema.safeParse(doc);
      if (!parsed.success) throw new StorageError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "invalid");
      const sheet = CharacterSheetSchema.safeParse(EMPTY_SHEET(name));
      if (!sheet.success) throw new StorageError("El nombre no es válido (1–80 caracteres)", "invalid");
      const meta: CharacterMeta = { schemaVersion: 1, id, sheet: sheet.data, folder: (folder ?? "").trim().slice(0, 60), tags: [], createdAt: now(), updatedAt: now(), thumbnail: null };
      await mkdir(join(dirOf(id), FILES), { recursive: true });
      await writeJsonAtomic(join(dirOf(id), DRAWING), { ...parsed.data, revision: 1 });
      await writeJsonAtomic(join(dirOf(id), META), meta);
      return meta;
    },

    getMeta: readMeta,

    async updateMeta(id, patch) {
      const cur = await readMeta(id);
      const next: CharacterMeta = { ...cur, updatedAt: now() };
      if (patch.sheet) {
        const s = CharacterSheetSchema.safeParse(patch.sheet);
        if (!s.success) throw new StorageError(s.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "invalid");
        next.sheet = s.data;
      }
      if (patch.folder !== undefined) next.folder = patch.folder.trim().slice(0, 60);
      if (patch.tags) next.tags = [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))].slice(0, 20);
      if (patch.thumbnail !== undefined) next.thumbnail = patch.thumbnail;
      const ok = CharacterMetaSchema.safeParse(next);
      if (!ok.success) throw new StorageError(ok.error.issues.map((i) => i.message).join("; "), "invalid");
      const file = join(dirOf(id), META);
      await copyFile(file, `${file}.prev`);
      await writeJsonAtomic(file, ok.data);
      return ok.data;
    },

    async loadDrawing(id) {
      return (await readDrawing(id)).anim;
    },

    async saveDrawing(incoming) {
      const parsed = AnimationSchema.safeParse(incoming);
      if (!parsed.success) throw new StorageError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "invalid");
      const anim = parsed.data;
      const id = anim.episodeId; // el id del personaje viaja en `episodeId`
      const meta = await readMeta(id);
      const file = join(dirOf(id), DRAWING);
      const cur = await readDrawing(id);
      if (anim.revision !== cur.anim.revision) throw new StorageError("El personaje cambió en el disco desde que lo abriste (¿otro dispositivo?). Recárgalo antes de guardar.", "conflict");
      await copyFile(file, `${file}.prev`);
      if (cur.fromVersion < ANIMATION_SCHEMA_VERSION) {
        const bak = `${file}.bak-v${cur.fromVersion}`;
        if (!(await exists(bak))) await copyFile(file, bak);
      }
      const revision = cur.anim.revision + 1;
      await writeJsonAtomic(file, { ...anim, revision });
      await writeJsonAtomic(join(dirOf(id), META), { ...meta, updatedAt: now() });
      return { revision };
    },

    async duplicate(id, name) {
      const src = await readMeta(id);
      const drawing = (await readDrawing(id)).anim;
      const nid = longId();
      const nm = (name?.trim() || `${src.sheet.name} (copia)`).slice(0, 80);
      const meta: CharacterMeta = { ...src, id: nid, sheet: { ...src.sheet, name: nm }, createdAt: now(), updatedAt: now() };
      await mkdir(join(dirOf(nid), FILES), { recursive: true });
      await writeJsonAtomic(join(dirOf(nid), DRAWING), { ...drawing, episodeId: nid, revision: 1 });
      for (const f of await this.listFiles(id)) await copyFile(join(dirOf(id), FILES, f), join(dirOf(nid), FILES, f));
      await writeJsonAtomic(join(dirOf(nid), META), meta);
      return meta;
    },

    async remove(id) {
      await readMeta(id); // 404 si no existe; no borra nada que no sea un personaje
      await rm(dirOf(id), { recursive: true, force: true });
    },

    async putFile(id, name, data) {
      await readMeta(id);
      if (!FILE_NAME.test(name)) throw new StorageError("Nombre de archivo no válido (solo letras, números, guiones; PNG/JPG/WEBP)", "invalid");
      if (data.length === 0 || data.length > MAX_FILE_BYTES) throw new StorageError("El archivo está vacío o supera 12 MB", "invalid");
      await mkdir(join(dirOf(id), FILES), { recursive: true });
      const tmp = join(dirOf(id), FILES, `.${randomBytes(5).toString("hex")}.tmp`);
      await writeFile(tmp, data);
      await rename(tmp, join(dirOf(id), FILES, name));
    },

    async filePath(id, name) {
      await readMeta(id);
      if (!FILE_NAME.test(name)) throw new StorageError("Nombre de archivo no válido", "invalid");
      const p = join(dirOf(id), FILES, name);
      if (!(await exists(p))) throw new StorageError("Archivo no encontrado", "not-found");
      return p;
    },

    async listFiles(id) {
      await readMeta(id);
      try {
        return (await readdir(join(dirOf(id), FILES))).filter((f) => FILE_NAME.test(f)).sort();
      } catch {
        return [];
      }
    },

    async deleteFile(id, name) {
      await rm(await this.filePath(id, name), { force: true });
    },
  };
}
