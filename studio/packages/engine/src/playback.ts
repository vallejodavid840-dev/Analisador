import type { Animation } from "@gas/core";

/** Duración total en fotogramas del reloj (suma de las duraciones de cada dibujo). */
export function totalTicks(a: Pick<Animation, "frames">): number {
  return a.frames.reduce((n, f) => n + f.hold, 0);
}

/** Tick del reloj (0-based) → índice del dibujo que se muestra. Hace bucle si `loop`; si no, se queda en el último. */
export function frameIndexAtTick(a: Pick<Animation, "frames">, tick: number, loop = true): number {
  const total = totalTicks(a);
  let t = Math.floor(tick);
  if (loop) t = ((t % total) + total) % total;
  else t = Math.min(Math.max(t, 0), total - 1);
  let acc = 0;
  for (let i = 0; i < a.frames.length; i++) {
    acc += a.frames[i]!.hold;
    if (t < acc) return i;
  }
  return a.frames.length - 1;
}

/** Primer tick en el que aparece el dibujo `index`. */
export function tickOfFrame(a: Pick<Animation, "frames">, index: number): number {
  let acc = 0;
  for (let i = 0; i < index && i < a.frames.length; i++) acc += a.frames[i]!.hold;
  return acc;
}

/** Ticks transcurridos tras `elapsedMs` a `fps` (reloj independiente del refresco de pantalla). */
export function tickAtElapsed(elapsedMs: number, fps: number): number {
  return Math.floor((elapsedMs / 1000) * fps + 1e-9);
}

/** Tiempo en ms en que debe empezar el tick `tick`. */
export function msOfTick(tick: number, fps: number): number {
  return (tick / fps) * 1000;
}
