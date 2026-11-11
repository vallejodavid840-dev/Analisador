import { frameIndexAtTick, msOfTick, tickAtElapsed, tickOfFrame, totalTicks } from "@gas/engine";
import type { EditorModel } from "./model";

/** Reproduce la animación con un reloj propio (independiente del refresco de pantalla): fps reales = fps del proyecto. */
export class Player {
  private raf = 0;
  private startTick = 0;
  private startTime = 0;
  /** Diagnóstico: cada cambio de dibujo con su marca de tiempo (ms). */
  readonly log: Array<{ index: number; t: number }> = [];

  constructor(private readonly model: EditorModel) {}

  play(): void {
    const m = this.model;
    if (m.playing) return;
    if (totalTicks(m.doc) < 2) {
      m.notice("Añade más fotogramas para poder reproducir.");
      return;
    }
    m.playing = true;
    this.log.length = 0;
    this.startTick = tickOfFrame(m.doc, m.frameIndex);
    this.startTime = performance.now();
    this.log.push({ index: m.frameIndex, t: 0 });
    m.emit({ ui: true });
    const step = (now: number) => {
      if (!m.playing) return;
      const doc = m.doc;
      const tick = this.startTick + tickAtElapsed(now - this.startTime, doc.fps);
      if (!m.loop && tick >= totalTicks(doc)) {
        m.setFrameIndex(doc.frames.length - 1);
        this.pause();
        return;
      }
      const idx = frameIndexAtTick(doc, tick, m.loop);
      if (idx !== m.frameIndex) {
        m.setFrameIndex(idx);
        if (this.log.length < 5000) this.log.push({ index: idx, t: now - this.startTime });
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  pause(): void {
    cancelAnimationFrame(this.raf);
    if (!this.model.playing) return;
    this.model.playing = false;
    this.model.emit({ ui: true });
  }

  toggle(): void {
    if (this.model.playing) this.pause();
    else this.play();
  }

  /** Si cambia el FPS durante la reproducción, el reloj continúa desde el dibujo actual. */
  rebase(): void {
    if (!this.model.playing) return;
    this.startTick = tickOfFrame(this.model.doc, this.model.frameIndex);
    this.startTime = performance.now();
  }

  /** Útil para estimar: tiempo ideal del tick n. */
  static idealMs(tick: number, fps: number): number {
    return msOfTick(tick, fps);
  }
}
