import type { Rect } from "@gas/core";

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

export interface Handle {
  id: HandleId;
  x: number;
  y: number;
}

/** Distancia (px de pantalla) entre el borde superior de la caja y el tirador de rotación. */
export const ROTATE_OFFSET_PX = 34;

export function handlesFor(b: Rect, zoom: number): Handle[] {
  const { x, y, w, h } = b;
  const mx = x + w / 2;
  const my = y + h / 2;
  return [
    { id: "nw", x, y },
    { id: "n", x: mx, y },
    { id: "ne", x: x + w, y },
    { id: "e", x: x + w, y: my },
    { id: "se", x: x + w, y: y + h },
    { id: "s", x: mx, y: y + h },
    { id: "sw", x, y: y + h },
    { id: "w", x, y: my },
    { id: "rotate", x: mx, y: y - ROTATE_OFFSET_PX / zoom },
  ];
}

/** Punto fijo al escalar desde un tirador: el opuesto. */
export function anchorFor(b: Rect, id: HandleId): { x: number; y: number } {
  const { x, y, w, h } = b;
  const mx = x + w / 2;
  const my = y + h / 2;
  switch (id) {
    case "nw": return { x: x + w, y: y + h };
    case "n": return { x: mx, y: y + h };
    case "ne": return { x, y: y + h };
    case "e": return { x, y: my };
    case "se": return { x, y };
    case "s": return { x: mx, y };
    case "sw": return { x: x + w, y };
    case "w": return { x: x + w, y: my };
    default: return { x: mx, y: my };
  }
}
