import type { ApiError } from "../api";
import type { DocBackend } from "./backend";
import { deleteDraft, putDraft } from "./drafts";
import type { EditorModel } from "./model";

export type SaveStatus = "saved" | "dirty" | "saving" | "offline" | "conflict" | "error";

/**
 * Autoguardado seguro:
 *  - Espera a que no haya un trazo ni una transformación en curso (`isBusy`).
 *  - Un único guardado en vuelo; si el documento cambió mientras tanto, vuelve a guardar.
 *  - Cada cambio deja además un borrador local (IndexedDB), por si falla la red o se cierra la pestaña.
 *  - Revisión del servidor: si otro dispositivo guardó antes, se detiene (conflicto) en vez de pisarlo.
 */
export class AutoSave {
  status: SaveStatus = "saved";
  detail = "";
  /** Última versión del historial confirmada en el servidor. */
  private savedVersion: number;
  private baseRevision: number;
  private draftTimer = 0;
  private saveTimer = 0;
  private retryMs = 3000;
  private inflight = false;
  private stopped = false;
  private readonly key: string;
  private readonly unsub: () => void;
  onStatus: (s: SaveStatus, detail: string) => void = () => undefined;

  constructor(
    private readonly backend: DocBackend,
    private readonly model: EditorModel,
    baseRevision: number,
    private readonly isBusy: () => boolean,
    private readonly debounceMs = 1200,
  ) {
    this.baseRevision = baseRevision;
    this.savedVersion = model.history.version;
    this.key = backend.draftKey;
    this.unsub = model.subscribe((c) => {
      if (c.doc) this.changed();
    });
  }

  get dirty(): boolean {
    return this.model.history.version !== this.savedVersion;
  }

  /** Marca el documento actual como pendiente (p. ej. tras recuperar un borrador). */
  markDirty(): void {
    this.savedVersion = -1;
    this.changed();
  }

  private set(status: SaveStatus, detail = ""): void {
    this.status = status;
    this.detail = detail;
    this.onStatus(status, detail);
  }

  private changed(): void {
    if (this.stopped) return;
    if (this.status !== "conflict") this.set("dirty");
    clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => void this.writeDraft(), 250);
    this.schedule(this.debounceMs);
  }

  private schedule(ms: number): void {
    clearTimeout(this.saveTimer);
    if (this.status === "conflict") return;
    this.saveTimer = window.setTimeout(() => void this.save(), ms);
  }

  private async writeDraft(): Promise<void> {
    if (this.model.history.inTransient || !this.dirty) return;
    await putDraft(this.key, { baseRevision: this.baseRevision, savedAt: Date.now(), doc: this.model.doc });
  }

  /** Guarda ya si es seguro y hay algo pendiente. Devuelve true si el servidor quedó al día. */
  async save(): Promise<boolean> {
    if (this.stopped || this.status === "conflict") return false;
    if (this.inflight) return false;
    if (!this.dirty) {
      this.set("saved");
      return true;
    }
    if (this.isBusy() || this.model.history.inTransient) {
      this.schedule(400); // no es seguro ahora (a mitad de trazo): reintenta enseguida
      return false;
    }
    this.inflight = true;
    this.set("saving");
    const version = this.model.history.version;
    const doc = { ...this.model.doc, revision: this.baseRevision };
    try {
      const r = await this.backend.save(doc);
      this.baseRevision = r.revision;
      this.savedVersion = version;
      this.retryMs = 3000;
      if (this.dirty) {
        // Hubo cambios durante el guardado: el borrador pasa a la nueva revisión base.
        await this.writeDraft();
        this.set("dirty");
        this.schedule(this.debounceMs);
      } else {
        await deleteDraft(this.key);
        this.set("saved");
      }
      return !this.dirty;
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 409) {
        // ¿Es un conflicto real o ya está guardado lo mismo (p. ej. un envío al salir que sí llegó)?
        const same = await this.serverHasSameContent(doc, version);
        if (!same) this.set("conflict", e.message);
        else if (this.dirty) this.schedule(0);
        else this.set("saved");
      } else if (e.status === 0) {
        this.set("offline", e.message);
        this.schedule(this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 30_000);
      } else {
        this.set("error", e.message);
        this.schedule(this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 30_000);
      }
      return false;
    } finally {
      this.inflight = false;
    }
  }

  /** Si el servidor ya tiene exactamente lo que intentábamos guardar, adopta su revisión y no hay conflicto. */
  private async serverHasSameContent(sent: { revision: number }, version: number): Promise<boolean> {
    try {
      const server = await this.backend.load();
      const norm = (a: object) => JSON.stringify({ ...a, revision: 0 });
      if (norm(server) !== norm(sent)) return false;
      this.baseRevision = server.revision;
      this.savedVersion = version;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Al ocultar la pestaña (`final = false`): borrador inmediato y guardado normal.
   * Al descargar la página (`final = true`): además un envío con keepalive, que sobrevive al cierre.
   */
  flushOnExit(final: boolean): void {
    if (this.stopped || !this.dirty || this.status === "conflict") return;
    void this.writeDraft();
    if (this.isBusy() || this.model.history.inTransient) return;
    if (final) this.backend.saveOnExit({ ...this.model.doc, revision: this.baseRevision });
    else void this.save();
  }

  /** Descarta el borrador y detiene el autoguardado (tras resolver un conflicto recargando). */
  async discardDraft(): Promise<void> {
    clearTimeout(this.saveTimer);
    clearTimeout(this.draftTimer);
    await deleteDraft(this.key);
  }

  dispose(): void {
    this.stopped = true;
    clearTimeout(this.saveTimer);
    clearTimeout(this.draftTimer);
    this.unsub();
  }
}
