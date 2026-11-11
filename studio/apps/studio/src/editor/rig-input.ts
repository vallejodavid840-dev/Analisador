import { hitBone, restStates, toDeg, type Vec } from "@gas/engine";
import type { EditorModel } from "./model";
import type { Viewport } from "./viewport";

type Drag =
  | { kind: "create"; parent: string | null; head: Vec; tail: Vec }
  | { kind: "rotate"; boneId: string; head: Vec; r0: number; prev: number; acc: number }
  | { kind: "translate"; boneId: string; p0: Vec; x0: number; y0: number }
  | { kind: "head"; boneId: string; p0: Vec; head0: Vec }
  | { kind: "tail"; boneId: string };

const angleOf = (c: Vec, p: Vec) => Math.atan2(p[1] - c[1], p[0] - c[0]);
const wrap = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
};

/**
 * Herramienta «Esqueleto» del lienzo.
 *  Editar esqueleto: arrastrar una articulación o un hueso lo mueve; el extremo cambia longitud/orientación;
 *    con «Dibujar hueso» activo, arrastrar crea un hueso nuevo (enganchado al hueso que haya bajo el punto inicial).
 *  Poner pose: arrastrar un hueso lo GIRA alrededor de su articulación (los hijos lo heredan) y respeta sus límites;
 *    arrastrar la articulación de la raíz la desplaza. Cada gesto deja una sola entrada de historial.
 */
export class RigPointer {
  private drag: Drag | null = null;

  constructor(
    private readonly model: EditorModel,
    private readonly vp: Viewport,
  ) {}

  get active(): boolean {
    return this.drag !== null;
  }

  /** Devuelve true si el gesto se ha iniciado. */
  down(world: Vec, touch: boolean): boolean {
    const m = this.model;
    const info = m.rigStates();
    if (!info) {
      m.notice("Primero crea un esqueleto en el panel «Esqueleto» (Nuevo esqueleto o Plantilla humanoide).");
      return false;
    }
    const { sk, states, pose } = info;
    const tol = (touch ? 26 : 12) / this.vp.view.zoom;
    const hit = hitBone(sk, states, world[0], world[1], tol);
    const editing = m.rig.mode === "edit";

    if (editing && m.rig.create) {
      // El hueso nace enganchado a lo que haya bajo el punto: la cola de un hueso, o un punto de su cuerpo.
      let parent: string | null = null;
      let head: Vec = world;
      if (hit) {
        const s = states.get(hit.boneId)!;
        parent = hit.boneId;
        if (hit.part === "body") {
          const dx = s.tail[0] - s.head[0];
          const dy = s.tail[1] - s.head[1];
          const t = Math.max(0, Math.min(1, ((world[0] - s.head[0]) * dx + (world[1] - s.head[1]) * dy) / (dx * dx + dy * dy)));
          head = [s.head[0] + dx * t, s.head[1] + dy * t];
        } else head = hit.part === "tail" ? s.tail : s.head;
      }
      this.drag = { kind: "create", parent, head, tail: world };
      this.vp.rigGhost = { a: head, b: world };
      this.vp.requestRender();
      return true;
    }

    if (!hit) {
      m.selectBone(null);
      return false;
    }
    m.selectBone(hit.boneId);
    const bone = sk.bones.find((b) => b.id === hit.boneId)!;
    const st = states.get(bone.id)!;

    if (editing) {
      if (hit.part === "tail") this.drag = { kind: "tail", boneId: bone.id };
      else this.drag = { kind: "head", boneId: bone.id, p0: world, head0: st.head };
      return true;
    }
    // Poner pose
    if (hit.part === "head" && bone.parent === null) {
      const cur = pose.get(bone.id)!;
      this.drag = { kind: "translate", boneId: bone.id, p0: world, x0: cur.x, y0: cur.y };
      return true;
    }
    this.drag = { kind: "rotate", boneId: bone.id, head: st.head, r0: pose.get(bone.id)!.r, prev: angleOf(st.head, world), acc: 0 };
    return true;
  }

  move(world: Vec): void {
    const d = this.drag;
    if (!d) return;
    const m = this.model;
    switch (d.kind) {
      case "create":
        d.tail = world;
        this.vp.rigGhost = { a: d.head, b: world };
        this.vp.requestRender();
        break;
      case "rotate": {
        const cur = angleOf(d.head, world);
        d.acc += wrap(cur - d.prev); // ángulo acumulado: sin saltos de 360° y permite vueltas completas
        d.prev = cur;
        m.poseBoneLive(d.boneId, { r: d.r0 + toDeg(d.acc) });
        break;
      }
      case "translate":
        m.poseBoneLive(d.boneId, { r: m.rigStates()!.pose.get(d.boneId)!.r, x: d.x0 + (world[0] - d.p0[0]), y: d.y0 + (world[1] - d.p0[1]) });
        break;
      case "head":
        m.moveBoneHeadLive(d.boneId, [d.head0[0] + world[0] - d.p0[0], d.head0[1] + world[1] - d.p0[1]]);
        break;
      case "tail":
        m.setBoneTailLive(d.boneId, world);
        break;
    }
  }

  up(cancelled: boolean): void {
    const d = this.drag;
    this.drag = null;
    this.vp.rigGhost = null;
    if (!d) return;
    const m = this.model;
    if (d.kind === "create") {
      if (!cancelled && Math.hypot(d.tail[0] - d.head[0], d.tail[1] - d.head[1]) >= 6) m.addBone({ parent: d.parent, head: d.head, tail: d.tail });
      else if (!cancelled) m.notice("Arrastra para dar longitud al hueso.");
      this.vp.requestRender();
      return;
    }
    if (cancelled) m.rigCancel();
    else m.rigEnd();
  }

  cancel(): void {
    this.drag = null;
    this.vp.rigGhost = null;
    this.model.rigCancel();
  }
}

void restStates;
