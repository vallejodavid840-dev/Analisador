import type { Animation, Rect, Stroke } from "@gas/core";
import { strokesOf } from "@gas/engine";
import { clipBaseIndex, clipToMask, compositeInk, drawLayerImage, drawStrokes, paintPieces, type Ctx2D } from "@gas/render";
import { LayerCache, cacheScaleFor, ctxOf, frameImage, liveInk, liveScratch, opacityScratch, maskScratch, clipScratch } from "./cache";
import { handlesFor, ROTATE_OFFSET_PX } from "./handles";
import type { EditorModel } from "./model";
import { drawRigOverlay } from "./rig-overlay";

export interface RefItem { id: string; view: string; img: HTMLImageElement; x: number; y: number; scale: number; opacity: number }

export interface View {
  zoom: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

interface Live {
  layerId: string;
  canvas: HTMLCanvasElement;
  ctx: Ctx2D;
  /** Trazo en construcción (su `points` crece). */
  stroke: Stroke;
}

const ONION_BEFORE = "#ff4d6d";
const ONION_AFTER = "#2fd3a8";

/** Muestra el documento: papel, papel cebolla, capas, trazo en vivo y superposición de selección. */
export class Viewport {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  readonly cache = new LayerCache();
  view: View = { zoom: 1, x: 0, y: 0 };
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private autoFit = true;
  private queued = false;
  private live: Live | null = null;
  marquee: Rect | null = null;
  /** Hueso que se está dibujando (vista previa mientras se arrastra). */
  rigGhost: { a: [number, number]; b: [number, number] } | null = null;
  onViewChange: () => void = () => undefined;
  /** Para pruebas y diagnóstico: nº de redibujados. */
  renders = 0;
  private readonly ro: ResizeObserver;
  private readonly unsub: () => void;

  constructor(
    private readonly host: HTMLElement,
    private readonly model: EditorModel,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "stage-canvas";
    this.canvas.setAttribute("data-testid", "stage");
    this.ctx = this.canvas.getContext("2d", { alpha: false }) as CanvasRenderingContext2D;
    host.prepend(this.canvas);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.unsub = model.subscribe(() => this.requestRender());
    this.resize();
  }

  dispose(): void {
    this.ro.disconnect();
    this.unsub();
    this.cache.clear();
  }

  /* ───── vista ───── */
  private resize(): void {
    const r = this.host.getBoundingClientRect();
    this.cssW = Math.max(1, Math.floor(r.width));
    this.cssH = Math.max(1, Math.floor(r.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.ceil(this.cssW * this.dpr);
    this.canvas.height = Math.ceil(this.cssH * this.dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    if (this.autoFit) this.fit(false);
    this.requestRender();
  }

  fit(user = true): void {
    const d = this.model.doc;
    const margin = Math.min(24, this.cssW * 0.04);
    const zoom = Math.min((this.cssW - margin * 2) / d.width, (this.cssH - margin * 2) / d.height);
    const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.view = { zoom: z, x: (this.cssW - d.width * z) / 2, y: (this.cssH - d.height * z) / 2 };
    if (user) this.autoFit = true;
    this.onViewChange();
    this.requestRender();
  }

  setView(v: View): void {
    this.autoFit = false;
    this.view = { zoom: clamp(v.zoom, MIN_ZOOM, MAX_ZOOM), x: v.x, y: v.y };
    this.onViewChange();
    this.requestRender();
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    const { zoom, x, y } = this.view;
    const z = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const k = z / zoom;
    this.setView({ zoom: z, x: sx - (sx - x) * k, y: sy - (sy - y) * k });
  }
  zoomCenter(factor: number): void {
    this.zoomAt(factor, this.cssW / 2, this.cssH / 2);
  }
  panBy(dx: number, dy: number): void {
    this.setView({ ...this.view, x: this.view.x + dx, y: this.view.y + dy });
  }

  toWorld(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(clientX - r.left - this.view.x) / this.view.zoom, (clientY - r.top - this.view.y) / this.view.zoom];
  }
  get cssSize(): [number, number] {
    return [this.cssW, this.cssH];
  }

  /* ───── trazo en vivo ───── */
  /** Empieza un trazo: se pinta punto a punto en un lienzo propio y se compone sobre la capa activa. */
  beginLive(stroke: Stroke): void {
    const d = this.model.doc;
    const cs = cacheScaleFor(d);
    const handle = liveInk(Math.ceil(d.width * cs), Math.ceil(d.height * cs));
    const canvas = handle.canvas as HTMLCanvasElement;
    const ctx = handle.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(cs, 0, 0, cs, 0, 0);
    this.live = { layerId: this.model.layerId, canvas, ctx, stroke };
    this.liveUpdate();
  }

  /** Pinta el último tramo disponible. Equivale exactamente al dibujo completo (ver tests de @gas/render). */
  liveUpdate(): void {
    const L = this.live;
    if (!L) return;
    const n = L.stroke.points.length / 3;
    if (n === 1) paintPieces(L.ctx, L.stroke, 0, 1);
    else if (n === 2) {
      // Quita el círculo del primer toque y empieza el trazo real.
      const cs = cacheScaleFor(this.model.doc);
      L.ctx.setTransform(1, 0, 0, 1, 0, 0);
      L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
      L.ctx.setTransform(cs, 0, 0, cs, 0, 0);
      paintPieces(L.ctx, L.stroke, 0, 1);
    } else if (n > 2) paintPieces(L.ctx, L.stroke, n - 2, n - 1);
    this.requestRender();
  }

  /** Termina de pintar el trazo (último tramo) antes de confirmarlo. */
  liveFinish(): void {
    const L = this.live;
    if (!L) return;
    const n = L.stroke.points.length / 3;
    if (n >= 2) paintPieces(L.ctx, L.stroke, n - 1, n);
  }

  cancelLive(): void {
    this.live = null;
    this.requestRender();
  }

  /**
   * Incorpora el trazo confirmado al mapa de bits de la capa (pintando solo ese trazo, sin repintar todo)
   * y lo registra con la nueva identidad del array tras el commit.
   */
  bakeLive(before: readonly Stroke[], after: readonly Stroke[]): void {
    const L = this.live;
    this.live = null;
    if (!L) return;
    const doc = this.model.doc;
    const target = this.cache.adopt(before, after, doc);
    // Se pinta con el MISMO código que al recargar o rehacer (no copiando el lienzo en vivo): lo que se ve al
    // terminar el trazo es exactamente lo que se verá siempre, píxel a píxel.
    drawStrokes(ctxOf(target), [L.stroke], { pixelWidth: target.width, pixelHeight: target.height, scale: cacheScaleFor(doc), scratch: opacityScratch });
    this.requestRender();
  }

  /* ───── dibujo ───── */
  requestRender(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.render();
    });
  }

  private drawLiveOnLayer(ctx: CanvasRenderingContext2D, bmp: HTMLCanvasElement | null, d: Animation): void {
    const L = this.live!;
    const s = L.stroke;
    if (s.kind === "pen") {
      if (bmp) ctx.drawImage(bmp, 0, 0, d.width, d.height);
      ctx.globalAlpha = s.opacity;
      ctx.drawImage(L.canvas, 0, 0, d.width, d.height);
      ctx.globalAlpha = 1;
      return;
    }
    // Borrador: se aplica sobre una copia de la capa para no tocar la original hasta confirmar.
    const tmp = liveScratch(L.canvas.width, L.canvas.height);
    tmp.ctx.setTransform(1, 0, 0, 1, 0, 0);
    tmp.ctx.globalAlpha = 1;
    if (bmp) {
      // «copy» sustituye el contenido de una vez (una operación a pantalla completa menos que limpiar y copiar)
      tmp.ctx.globalCompositeOperation = "copy";
      tmp.ctx.drawImage(bmp, 0, 0);
    } else {
      tmp.ctx.globalCompositeOperation = "source-over";
      tmp.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
    }
    tmp.ctx.globalCompositeOperation = "source-over";
    compositeInk(tmp.ctx, L.canvas, s);
    ctx.drawImage(tmp.canvas as HTMLCanvasElement, 0, 0, d.width, d.height);
  }

  render(): void {
    this.renders++;
    const m = this.model;
    const d = m.doc;
    const ctx = this.ctx;
    const { zoom, x, y } = this.view;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#14141b";
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(zoom, zoom);
    // Sombra del papel con rectángulos translúcidos: un desenfoque (shadowBlur) en cada redibujado
    // era de lo más caro de todo el fotograma en móviles.
    ctx.fillStyle = "rgba(0,0,0,.16)";
    for (let k = 3; k >= 1; k--) {
      const g = (k * 5) / zoom;
      ctx.fillRect(-g, -g + 2 / zoom, d.width + g * 2, d.height + g * 2);
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, d.width, d.height);
    ctx.beginPath();
    ctx.rect(0, 0, d.width, d.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";

    // Papel cebolla: fotogramas vecinos, más tenues cuanto más lejos.
    const o = m.prefs.onion;
    if (o.enabled && !m.playing) {
      const i0 = m.frameIndex;
      const draw = (offset: number, tint: string, rank: number) => {
        if (!d.frames[i0 + offset]) return;
        const img = frameImage(d, m.renderedFrame(i0 + offset), { scale: 0.5, tint }); // con el rig aplicado, como se verá en la exportación
        ctx.globalAlpha = 0.42 * Math.pow(0.6, rank);
        ctx.drawImage(img, 0, 0, d.width, d.height);
      };
      for (let k = o.after; k >= 1; k--) draw(k, ONION_AFTER, k - 1);
      for (let k = o.before; k >= 1; k--) draw(-k, ONION_BEFORE, k - 1);
      ctx.globalAlpha = 1;
    }

    // Imágenes de referencia de la vista actual (por debajo del dibujo, solo en pantalla).
    if (this.refs.length) {
      const view = m.doc.character?.views.find((v) => v.frameId === m.frameId)?.kind;
      for (const r of this.refs) {
        if (r.view !== view) continue;
        ctx.globalAlpha = r.opacity;
        ctx.drawImage(r.img, r.x, r.y, r.img.naturalWidth * r.scale, r.img.naturalHeight * r.scale);
      }
      ctx.globalAlpha = 1;
    }

    // Capas de abajo a arriba.
    const frame = m.renderedFrame();
    const raw = m.frame;
    let mask: HTMLCanvasElement | null = null;
    const px = this.view.zoom * this.dpr; // px de pantalla por unidad (desenfoque de capa)
    for (let li = 0; li < d.layers.length; li++) {
      const layer = d.layers[li]!;
      const clipped = layer.clip === true && clipBaseIndex(d.layers, li) >= 0;
      if (!clipped) mask = null;
      if (!layer.visible) continue;
      const strokes = strokesOf(frame, layer.id);
      // Capa deformada por el rig: su array es nuevo en cada pose, así que no se cachea (se pinta en un lienzo compartido).
      const deformed = frame !== raw && strokes !== strokesOf(raw, layer.id);
      const bmp = deformed ? this.cache.renderTransient(strokes, d, this.view.zoom * this.dpr) : this.cache.get(strokes, d);
      const live = this.live && this.live.layerId === layer.id;
      if (!clipped && !live && bmp && d.layers[li + 1]?.clip === true) {
        // la siguiente capa se recorta a esta: copia (el lienzo transitorio se reutiliza para la capa siguiente)
        const m = maskScratch(bmp.width, bmp.height);
        m.ctx.setTransform(1, 0, 0, 1, 0, 0);
        m.ctx.globalCompositeOperation = "source-over";
        m.ctx.clearRect(0, 0, bmp.width, bmp.height);
        m.ctx.drawImage(bmp, 0, 0);
        mask = m.canvas as HTMLCanvasElement;
      }
      if (live) this.drawLiveOnLayer(ctx, bmp, d);
      else if (bmp && clipped) {
        if (!mask) continue;
        const t = clipScratch(bmp.width, bmp.height);
        t.ctx.setTransform(1, 0, 0, 1, 0, 0);
        t.ctx.globalCompositeOperation = "source-over";
        t.ctx.clearRect(0, 0, bmp.width, bmp.height);
        t.ctx.drawImage(bmp, 0, 0);
        clipToMask(t.ctx, mask, bmp.width, bmp.height);
        drawLayerImage(ctx as never, t.canvas, layer, d.width, d.height, px);
      } else if (bmp) drawLayerImage(ctx as never, bmp, layer, d.width, d.height, px);
    }
    ctx.restore();

    this.drawOverlay(ctx);
  }

  private refs: RefItem[] = [];
  /** Imágenes de referencia (solo se ven al editar: nunca se exportan ni entran en la hoja). */
  setReferences(items: RefItem[]): void {
    this.refs = items;
    this.requestRender();
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    const m = this.model;
    const { zoom, x, y } = this.view;
    const touch = matchMedia("(pointer: coarse)").matches;
    const hs = touch ? 8 : 5;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(zoom, zoom);
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    if (this.marquee) {
      const r = this.marquee;
      ctx.fillStyle = "rgba(53,208,255,.10)";
      ctx.strokeStyle = "#35d0ff";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    const b = m.prefs.tool === "select" ? m.selectionBounds() : null;
    if (b) {
      ctx.strokeStyle = "#35d0ff";
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      const hh = handlesFor(b, zoom);
      const rot = hh.find((h) => h.id === "rotate")!;
      ctx.beginPath();
      ctx.moveTo(b.x + b.w / 2, b.y);
      ctx.lineTo(rot.x, rot.y);
      ctx.stroke();
      for (const h of hh) {
        ctx.beginPath();
        if (h.id === "rotate") ctx.arc(h.x, h.y, (hs + 1) / zoom, 0, Math.PI * 2);
        else ctx.rect(h.x - hs / zoom, h.y - hs / zoom, (hs * 2) / zoom, (hs * 2) / zoom);
        ctx.fillStyle = h.id === "rotate" ? "#e8323c" : "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "#08080c";
        ctx.stroke();
      }
    }
    drawRigOverlay(ctx, m, zoom, touch);
    if (this.rigGhost) {
      const g = this.rigGhost;
      ctx.setLineDash([8 / zoom, 5 / zoom]);
      ctx.lineWidth = 3 / zoom;
      ctx.strokeStyle = "#ffc233";
      ctx.beginPath();
      ctx.moveTo(g.a[0], g.a[1]);
      ctx.lineTo(g.b[0], g.b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of [g.a, g.b]) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 6 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = "#ffc233";
        ctx.fill();
      }
    }
    ctx.restore();
    void ROTATE_OFFSET_PX;
  }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
