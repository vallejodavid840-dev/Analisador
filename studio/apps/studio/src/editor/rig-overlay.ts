import { strokeBounds, unionBounds } from "@gas/core";
import { restStates, skinPreview, type BoneState } from "@gas/engine";
import type { EditorModel } from "./model";

export const BONE_COLORS = ["#35d0ff", "#ffc233", "#ff6b9a", "#7cf29a", "#b48cff", "#ff8a3d", "#4ad3c3", "#f2e07a", "#6ea8ff", "#ff5b5b", "#9be24a", "#e08cff"];
export const boneColor = (index: number) => BONE_COLORS[index % BONE_COLORS.length]!;

const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

function drawBone(ctx: CanvasRenderingContext2D, s: BoneState, color: string, zoom: number, selected: boolean, dim: boolean): void {
  const dx = Math.cos(s.angle);
  const dy = Math.sin(s.angle);
  const hw = Math.min(s.length * 0.22, 8 / zoom);
  const k = Math.min(0.28, (14 / zoom) / s.length);
  const mx = s.head[0] + dx * s.length * k;
  const my = s.head[1] + dy * s.length * k;
  ctx.beginPath();
  ctx.moveTo(s.head[0], s.head[1]);
  ctx.lineTo(mx - dy * hw, my + dx * hw);
  ctx.lineTo(s.tail[0], s.tail[1]);
  ctx.lineTo(mx + dy * hw, my - dx * hw);
  ctx.closePath();
  ctx.fillStyle = alpha(color, selected ? 0.7 : dim ? 0.18 : 0.38);
  ctx.fill();
  ctx.lineWidth = (selected ? 2.4 : 1.4) / zoom;
  ctx.strokeStyle = selected ? "#ffffff" : alpha(color, dim ? 0.5 : 1);
  ctx.stroke();
}

/**
 * Esqueleto sobre el dibujo (coordenadas del lienzo; `ctx` ya tiene el zoom y el desplazamiento aplicados).
 * Muestra: huesos con color propio, articulaciones, asas del hueso seleccionado, el contorno de las capas
 * vinculadas al hueso seleccionado y, opcionalmente, los pesos de influencia de la capa activa.
 */
export function drawRigOverlay(ctx: CanvasRenderingContext2D, m: EditorModel, zoom: number, touch: boolean): void {
  if (!m.rig.show) return;
  const info = m.rigStates();
  if (!info) return;
  const { sk, states } = info;
  const sel = m.rig.boneId;
  const editing = m.rig.mode === "edit";
  const frame = m.renderedFrame();
  ctx.setLineDash([]);

  // Contorno punteado de las capas vinculadas al hueso seleccionado
  if (sel) {
    const idx = sk.bones.findIndex((b) => b.id === sel);
    const color = boneColor(idx);
    const bound = sk.bindings.filter((b) => b.bone === sel || b.influences.includes(sel));
    ctx.save();
    ctx.setLineDash([7 / zoom, 5 / zoom]);
    ctx.lineWidth = 1.6 / zoom;
    ctx.strokeStyle = color;
    for (const b of bound) {
      const strokes = frame.cells[b.layerId];
      if (!strokes?.length) continue;
      const r = unionBounds(strokes.map(strokeBounds));
      if (r) ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
  }

  // Pesos de influencia de la capa activa (deformable)
  const lb = m.layerBinding;
  if (m.rig.weights && lb && lb.skeleton.id === sk.id && lb.binding.mode === "skin") {
    const raw = m.frame.cells[m.layerId];
    const prev = raw?.length ? skinPreview(raw, lb.binding, sk) : null;
    if (prev) {
      const drawn = m.showRest ? prev.strokes : frame.cells[m.layerId];
      const colors = prev.ids.map((id) => boneColor(sk.bones.findIndex((b) => b.id === id)));
      const rgb = colors.map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
      const k = prev.ids.length;
      const total = prev.strokes.reduce((n, s) => n + s.points.length / 3, 0);
      const step = Math.max(1, Math.ceil(total / 1800));
      let seen = 0;
      const r = (touch ? 3.2 : 2.4) / zoom;
      prev.strokes.forEach((s, si) => {
        const pts = drawn?.[si]?.points ?? s.points;
        const w = prev.weights[si]!;
        for (let i = 0; i < s.points.length / 3; i++, seen++) {
          if (seen % step) continue;
          let R = 0, G = 0, B = 0;
          for (let j = 0; j < k; j++) {
            const wj = w[i * k + j]!;
            R += rgb[j]![0]! * wj; G += rgb[j]![1]! * wj; B += rgb[j]![2]! * wj;
          }
          ctx.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`;
          ctx.beginPath();
          ctx.arc(pts[i * 3]!, pts[i * 3 + 1]!, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // Huesos
  sk.bones.forEach((b, i) => drawBone(ctx, states.get(b.id)!, boneColor(i), zoom, b.id === sel, !!sel && b.id !== sel));
  const jr = (touch ? 8 : 5.5) / zoom;
  sk.bones.forEach((b, i) => {
    const s = states.get(b.id)!;
    ctx.beginPath();
    ctx.arc(s.head[0], s.head[1], jr * (b.parent ? 0.85 : 1.15), 0, Math.PI * 2);
    ctx.fillStyle = "#08080c";
    ctx.fill();
    ctx.lineWidth = 2 / zoom;
    ctx.strokeStyle = b.id === sel ? "#ffffff" : boneColor(i);
    ctx.stroke();
  });
  // Asa del extremo del hueso seleccionado: arrastrarla cambia longitud/orientación (editar) o gira el hueso (pose)
  const sb = sel ? sk.bones.find((b) => b.id === sel) : null;
  if (sb) {
    const s = states.get(sb.id)!;
    ctx.beginPath();
    ctx.arc(s.tail[0], s.tail[1], jr * 1.15, 0, Math.PI * 2);
    ctx.fillStyle = editing ? "#ffc233" : "#e8323c";
    ctx.fill();
    ctx.lineWidth = 2 / zoom;
    ctx.strokeStyle = "#08080c";
    ctx.stroke();
  }
  void restStates;
}
