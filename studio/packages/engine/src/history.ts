/**
 * Historial por instantáneas inmutables (con estructura compartida, así que es barato).
 * Es GLOBAL al documento: cambiar de fotograma o de capa no lo reinicia, y deshacer revierte
 * también la creación/borrado de capas y fotogramas.
 *
 * Operaciones continuas (arrastrar una selección) usan `beginTransient/setTransient/commitTransient`:
 * se ve el resultado al instante pero solo queda UNA entrada en el historial.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private current: T;
  private baseline: T | null = null;
  /** Aumenta con cada cambio del documento actual (para saber si hay algo por guardar). */
  version = 0;

  constructor(
    initial: T,
    private readonly limit = 500,
  ) {
    this.current = initial;
  }

  get present(): T {
    return this.current;
  }
  get canUndo(): boolean {
    return this.past.length > 0 || this.baseline !== null;
  }
  get canRedo(): boolean {
    return this.future.length > 0 && this.baseline === null;
  }
  get inTransient(): boolean {
    return this.baseline !== null;
  }

  /** Cambio atómico: una entrada de historial. Ignora cambios que no cambian nada. */
  commit(next: T): void {
    if (this.baseline !== null) throw new Error("commit durante una operación transitoria");
    if (next === this.current) return;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    this.version++;
  }

  beginTransient(): void {
    if (this.baseline !== null) throw new Error("ya hay una operación transitoria");
    this.baseline = this.current;
  }

  setTransient(next: T): void {
    if (this.baseline === null) throw new Error("no hay operación transitoria");
    if (next === this.current) return;
    this.current = next;
    this.version++;
  }

  commitTransient(): void {
    if (this.baseline === null) return;
    const base = this.baseline;
    this.baseline = null;
    if (this.current === base) return;
    this.past.push(base);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  cancelTransient(): void {
    if (this.baseline === null) return;
    if (this.current !== this.baseline) this.version++;
    this.current = this.baseline;
    this.baseline = null;
  }

  undo(): boolean {
    this.cancelTransient();
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(this.current);
    this.current = prev;
    this.version++;
    return true;
  }

  redo(): boolean {
    if (this.baseline !== null) return false;
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.current);
    this.current = next;
    this.version++;
    return true;
  }

  /** Sustituye el presente sin tocar el historial (p. ej. al actualizar `revision` tras guardar). */
  silentReplace(next: T): void {
    this.current = next;
    if (this.baseline !== null) this.baseline = next;
  }
}
