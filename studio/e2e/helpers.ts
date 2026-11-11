import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Animation } from "@gas/core";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../apps/server/src/app";

export const SHOTS = resolve(process.env["SCREENSHOT_DIR"] ?? "e2e/output");
mkdirSync(SHOTS, { recursive: true });

const PREINSTALLED = "/opt/pw-browsers/chromium";

export interface Env {
  app: FastifyInstance;
  browser: Browser;
  dataDir: string;
  base: string;
  close(): Promise<void>;
}

export async function startEnv(o: { ffmpeg?: { ffmpeg: string; ffprobe: string } } = {}): Promise<Env> {
  const dataDir = await mkdtemp(join(tmpdir(), "gas-e2e-"));
  const app = await buildApp({ dataDir, staticDir: resolve("apps/studio/dist"), ...(o.ffmpeg ? { ffmpeg: o.ffmpeg } : {}) });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const browser = await chromium.launch(existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED, args: ["--no-sandbox"] } : {});
  return {
    app, browser, dataDir, base,
    async close() {
      await browser.close();
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Crea por API un proyecto con una temporada y un episodio. */
export async function createEpisode(env: Env, o: { name?: string; fps?: number; width?: number; height?: number } = {}) {
  const post = await fetch(`${env.base}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: o.name ?? "Serie de prueba", settings: { fps: o.fps ?? 24, width: o.width ?? 1280, height: o.height ?? 720 } }) });
  const p = (await post.json()) as { id: string; seasons: unknown[] };
  const put = await fetch(`${env.base}/api/projects/${p.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...p, seasons: [{ id: "t1", name: "Temporada 1", episodes: [{ id: "ep1", title: "Episodio 1" }] }] }) });
  if (!put.ok) throw new Error(await put.text());
  return { projectId: p.id, episodeId: "ep1", url: `${env.base}/#/p/${p.id}/e/ep1` };
}

export async function openPage(env: Env, opts: Parameters<Browser["newContext"]>[0] = {}): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await env.browser.newContext({ locale: "es-ES", viewport: { width: 1366, height: 800 }, ...opts });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return { ctx, page, errors };
}

export async function openEditorPage(env: Env, url: string, opts: Parameters<Browser["newContext"]>[0] = {}) {
  const r = await openPage(env, opts);
  await r.page.goto(url);
  await r.page.getByTestId("stage").waitFor();
  await settle(r.page);
  return r;
}

export const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Coordenadas de documento → coordenadas de pantalla (client). */
export async function toScreen(page: Page, wx: number, wy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([x, y]) => {
    const c = document.querySelector("canvas.stage-canvas") as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const v = window.__gas!.viewport.view;
    return { x: r.left + v.x + x! * v.zoom, y: r.top + v.y + y! * v.zoom };
  }, [wx, wy]);
}

/** Color en pantalla (RGB) del punto de documento (wx, wy). */
export async function docPixel(page: Page, wx: number, wy: number): Promise<[number, number, number]> {
  const s = await toScreen(page, wx, wy);
  return page.evaluate(({ x, y }) => {
    const c = document.querySelector("canvas.stage-canvas") as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    const d = c.getContext("2d")!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  }, s);
}

export const isWhite = (p: number[]) => p.every((v) => v >= 250);
export const isRed = (p: number[]) => p[0]! > 200 && p[1]! < 90 && p[2]! < 90;

/** Dibuja un trazo con el ratón siguiendo puntos de documento. */
export async function mouseStroke(page: Page, pts: Array<[number, number]>): Promise<void> {
  const first = await toScreen(page, pts[0]![0], pts[0]![1]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) {
    const s = await toScreen(page, x, y);
    await page.mouse.move(s.x, s.y, { steps: 3 });
  }
  await page.mouse.up();
  await settle(page);
}

export const line = (x0: number, y0: number, x1: number, y1: number, n = 12): Array<[number, number]> =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n] as [number, number]);

export const strokes = (page: Page) => page.evaluate(() => window.__gas!.model.currentStrokes().map((s) => ({ ...s })));
export const doc = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__gas!.model.doc)));
export const waitSaved = (page: Page) => page.waitForFunction(() => window.__gas!.autosave.status === "saved" && !window.__gas!.autosave.dirty, undefined, { timeout: 15_000 });

export async function setColor(page: Page, hex: string): Promise<void> {
  await page.getByTestId("color-hex").fill(hex);
}

export async function serverAnimation(env: Env, projectId: string, episodeId: string) {
  const r = await fetch(`${env.base}/api/projects/${projectId}/episodes/${episodeId}/animation`);
  return (await r.json()) as Animation;
}

export async function projectJson(env: Env, projectId: string): Promise<string> {
  return readFile(join(env.dataDir, `${projectId}.gangstudio`, "project.json"), "utf8");
}

export async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", points: Array<{ x: number; y: number; id: number }>) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : points.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
}

export function penEvent(page: Page, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number, pressure: number, id = 7) {
  return page.evaluate(([t, cx, cy, p, pid]) => {
    const c = document.querySelector("canvas.stage-canvas")!;
    c.dispatchEvent(new PointerEvent(t as string, { pointerId: pid as number, pointerType: "pen", isPrimary: true, pressure: p as number, clientX: cx as number, clientY: cy as number, buttons: t === "pointerup" ? 0 : 1, button: 0, bubbles: true, cancelable: true }));
  }, [type, x, y, pressure, id] as const);
}

/** Crea por API un episodio con una animación REAL guardada en disco: un dibujo de color liso por fotograma. */
export async function seedColors(env: Env, o: { colors: string[]; hold?: number; holds?: number[]; fps?: number; width?: number; height?: number; extraStrokes?: number; name?: string }) {
  const w = o.width ?? 640;
  const h = o.height ?? 360;
  const ep = await createEpisode(env, { name: o.name ?? "Serie", fps: o.fps ?? 24, width: w, height: h });
  const url = `${env.base}/api/projects/${ep.projectId}/episodes/${ep.episodeId}/animation`;
  const base = (await (await fetch(url)).json()) as Animation;
  const layer = base.layers[1]!.id;
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const uid = () => Array.from({ length: 12 }, () => Math.floor(rnd() * 16).toString(16)).join("");
  const anim: Animation = {
    ...base,
    frames: o.colors.map((c, i) => ({
      id: `f${i}`, hold: o.holds?.[i] ?? o.hold ?? 1,
      cells: { [layer]: [
        { id: uid(), kind: "pen", color: c, size: Math.min(h * 2, 2000), opacity: 1, sens: 0, points: [0, h / 2, 1, w, h / 2, 1] },
        ...Array.from({ length: o.extraStrokes ?? 0 }, () => {
          const pts: number[] = [];
          let x = rnd() * w, y = rnd() * h;
          for (let k = 0; k < 40; k++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; pts.push(Math.round(x), Math.round(y), 0.8); }
          return { id: uid(), kind: "pen" as const, color: "#101018", size: 4, opacity: rnd() < 0.3 ? 0.6 : 1, sens: 0.4, points: pts };
        }),
      ] },
    })),
  };
  const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(anim) });
  if (!r.ok) throw new Error(await r.text());
  return { ...ep, anim };
}

/* ───────── Rigging ───────── */
export interface BoneGeo {
  head: [number, number];
  tail: [number, number];
}

/** Geometría (en el lienzo) del hueso por nombre, tal como se muestra ahora (reposo o pose según el modo). */
export const boneGeo = (page: Page, name: string): Promise<BoneGeo> =>
  page.evaluate((n) => {
    const m = window.__gas!.model;
    const info = m.rigStates()!;
    const b = info.sk.bones.find((x) => x.name === n);
    if (!b) throw new Error(`hueso «${n}» no existe: ${info.sk.bones.map((x) => x.name).join(", ")}`);
    const s = info.states.get(b.id)!;
    return { head: [...s.head] as [number, number], tail: [...s.tail] as [number, number] };
  }, name);

/** Giro de pose (grados) de un hueso en el fotograma actual. */
export const poseRot = (page: Page, name: string): Promise<number> =>
  page.evaluate((n) => {
    const info = window.__gas!.model.rigStates()!;
    const b = info.sk.bones.find((x) => x.name === n)!;
    return info.pose.get(b.id)!.r;
  }, name);

/** Arrastra con el ratón entre dos puntos del LIENZO. */
export async function dragDoc(page: Page, from: [number, number], to: [number, number], steps = 8): Promise<void> {
  const a = await toScreen(page, ...from);
  const b = await toScreen(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await settle(page);
}

export const boneRow = (page: Page, name: string) => page.locator("[data-testid=bone-row]", { hasText: name }).first();

/** Escribe en un campo numérico del panel y confirma (evento change). */
export async function setNum(page: Page, testid: string, value: number): Promise<void> {
  const el = page.getByTestId(testid);
  await el.fill(String(value));
  await el.blur();
  await settle(page);
}

export const skeletonOf = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__gas!.model.skeleton)));
