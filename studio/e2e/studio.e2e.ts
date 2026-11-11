import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../apps/server/src/app";

const shots = resolve(process.env["SCREENSHOT_DIR"] ?? "e2e/output");
mkdirSync(shots, { recursive: true });

let browser: Browser;
let app: FastifyInstance;
let dataDir: string;
let base: string;

// Chromium preinstalado en el entorno; en otros equipos, `npx playwright install chromium`.
const PREINSTALLED = "/opt/pw-browsers/chromium";

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "gas-e2e-"));
  app = await buildApp({ dataDir, staticDir: resolve("apps/studio/dist") });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  browser = await chromium.launch(existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED, args: ["--no-sandbox"] } : {});
});
afterAll(async () => {
  await browser?.close();
  await app?.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function newPage(opts: Parameters<Browser["newContext"]>[0] = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ locale: "es-ES", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => {
    throw e;
  });
  await page.goto(base);
  return { ctx, page };
}

describe("estudio en escritorio", () => {
  it("interfaz en español y flujo completo: crear, editar, guardar, recargar", async () => {
    const { ctx, page } = await newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    expect(await page.getAttribute("html", "lang")).toBe("es");
    await page.getByText("Estudio de producción de anime 2D").waitFor();
    await page.getByText("Aún no hay proyectos").waitFor();
    await page.screenshot({ path: join(shots, "01-inicio-escritorio.png") });

    // Validación: nombre vacío
    await page.getByRole("button", { name: "Crear proyecto" }).click();
    await page.getByText("Escribe un nombre.").waitFor();

    // Crear a 30 FPS
    await page.fill("#p-name", "Calle Roja");
    await page.selectOption("#p-fps", "30");
    await page.getByRole("button", { name: "Crear proyecto" }).click();
    await page.getByTestId("proj-name").waitFor();
    expect(await page.inputValue("[data-testid=proj-name]")).toBe("Calle Roja");
    expect(await page.inputValue("[data-testid=proj-fps]")).toBe("30");
    expect(await page.textContent("[data-testid=save-state]")).toBe("Guardado");
    expect(await page.isDisabled("[data-testid=save]")).toBe(true);

    // Editar: estructura de serie
    await page.getByTestId("add-season").click();
    await page.getByTestId("add-episode").click();
    await page.getByTestId("add-episode").click();
    await page.getByTestId("season-name").fill("Temporada 1: Los Colmillos");
    await page.getByTestId("episode-title").first().fill("Ep. 1 — Humo y neón");
    expect(await page.textContent("[data-testid=save-state]")).toBe("Cambios sin guardar");
    await page.selectOption("[data-testid=proj-fps]", "12");
    await page.screenshot({ path: join(shots, "02-proyecto-escritorio.png") });

    await page.getByTestId("save").click();
    await page.waitForFunction(() => document.querySelector("[data-testid=save-state]")?.textContent === "Guardado");

    // Recargar la página: persistencia real en disco
    await page.reload();
    // La URL conserva el proyecto abierto: recargar vuelve a él (Fase 1), con todo lo guardado
    await page.getByTestId("proj-name").waitFor();
    expect(await page.inputValue("[data-testid=proj-name]")).toBe("Calle Roja");
    await page.getByRole("button", { name: "← Proyectos" }).click();
    await page.getByText("Calle Roja").waitFor();
    await page.getByText(/12 FPS · 1 temporada · 2 episodios/).waitFor();
    await page.getByRole("button", { name: "Abrir" }).click();
    await page.getByTestId("proj-name").waitFor();
    expect(await page.inputValue("[data-testid=season-name]")).toBe("Temporada 1: Los Colmillos");
    expect(await page.inputValue("[data-testid=episode-title] >> nth=0")).toBe("Ep. 1 — Humo y neón");
    expect(await page.inputValue("[data-testid=episode-title] >> nth=1")).toBe("Episodio 2");
    expect(await page.inputValue("[data-testid=proj-fps]")).toBe("12");
    await ctx.close();
  });

  it("detecta conflicto entre dos dispositivos y permite recargar", async () => {
    const a = await newPage({ viewport: { width: 1000, height: 700 } });
    await a.page.fill("#p-name", "Conflicto");
    await a.page.getByRole("button", { name: "Crear proyecto" }).click();
    await a.page.getByTestId("proj-name").waitFor();
    const url = a.page.url();

    const b = await newPage({ viewport: { width: 1000, height: 700 } });
    await b.page.goto(new URL(url).origin); // la URL de A ya apunta a su proyecto: B parte de la lista
    // B abre el mismo proyecto desde la lista
    await b.page.locator(".project-card", { hasText: "Conflicto" }).getByRole("button", { name: "Abrir" }).click();
    await b.page.getByTestId("proj-name").waitFor();

    await a.page.getByTestId("add-season").click();
    await a.page.getByTestId("save").click();
    await a.page.waitForFunction(() => document.querySelector("[data-testid=save-state]")?.textContent === "Guardado");

    await b.page.getByTestId("add-season").click();
    await b.page.getByTestId("save").click();
    await b.page.getByRole("alert").waitFor();
    expect(await b.page.getByRole("alert").textContent()).toContain("cambió en el disco");
    await b.page.getByRole("button", { name: "Recargar desde el disco" }).click();
    await b.page.getByTestId("season").waitFor();
    expect(await b.page.getByTestId("season").count()).toBe(1); // lo de A, sin pisarlo
    await a.ctx.close();
    await b.ctx.close();
  });
});

describe("estudio en Android (Pixel 7 emulado, táctil)", () => {
  it("sin desbordes, objetivos táctiles ≥44px y flujo con toques", async () => {
    const { ctx, page } = await newPage({ ...devices["Pixel 7"] });
    await page.getByText("GANG ANIME STUDIO").waitFor();
    await page.screenshot({ path: join(shots, "03-inicio-android.png") });

    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);

    // Todos los controles interactivos miden al menos 44px de alto
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("button, input, select")]
        .map((el) => ({ el: el.id || el.textContent || el.tagName, h: el.getBoundingClientRect().height }))
        .filter((x) => x.h < 44),
    );
    expect(small).toEqual([]);

    await page.locator("#p-name").tap();
    await page.fill("#p-name", "Barrio Norte");
    await page.getByRole("button", { name: "Crear proyecto" }).tap();
    await page.getByTestId("proj-name").waitFor();
    await page.getByTestId("add-season").tap();
    await page.getByTestId("add-episode").tap();
    await page.getByTestId("save").tap();
    await page.waitForFunction(() => document.querySelector("[data-testid=save-state]")?.textContent === "Guardado");
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.screenshot({ path: join(shots, "04-proyecto-android.png") });
    await ctx.close();
  });
});
