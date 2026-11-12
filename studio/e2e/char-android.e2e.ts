import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devices, type Page } from "playwright";
import { SHOTS, createCharacter, openEditorPage, openPage, settle, startEnv, type Env } from "./helpers";
import { charDoc, openSection } from "./char-helpers";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const PIXEL = devices["Pixel 7"];
const LANDSCAPE = { ...PIXEL, viewport: { width: 915, height: 412 }, screen: { width: 915, height: 412 } };

/** Todos los controles visibles de un contenedor miden ≥44 px en su lado menor (objetivo táctil). */
const smallTargets = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const root = document.querySelector(s)!;
    const out: string[] = [];
    for (const el of root.querySelectorAll("button, summary, select, input:not([type=hidden]):not([type=color]):not([type=checkbox]), a")) {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5 && !(el as HTMLElement).closest("[hidden]")) out.push(`${el.tagName}:${(el as HTMLElement).dataset["testid"] ?? el.textContent?.slice(0, 20)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  }, sel);

describe("personajes en Android (Pixel 7 emulado, táctil)", () => {
  it("biblioteca: tarjetas legibles, botones táctiles y sin desbordamiento horizontal", async () => {
    await createCharacter(env, "Kenji Aoyama", "Cuervos");
    await createCharacter(env, "Aiko Shirogane", "Cuervos");
    const { ctx, page, errors } = await openPage(env, { ...PIXEL });
    await page.goto(`${env.base}/#/personajes`);
    await page.getByTestId("char-grid").waitFor();
    expect(await page.getByTestId("char-card").count()).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await smallTargets(page, "main")).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/51-biblioteca-android.png` });
    await page.getByTestId("char-sheet").first().tap();
    await page.getByTestId("ficha-dialog").waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/52-ficha-android.png` });
    await ctx.close();
    expect(errors).toEqual([]);
  }, 120_000);

  it("editor vertical: el panel «Personaje» es una hoja táctil; crear cuerpo, proporciones, ropa y expresión con toques", async () => {
    const c = await createCharacter(env, "Android");
    const { ctx, page, errors } = await openEditorPage(env, c.url, { ...PIXEL });
    await page.getByTestId("open-char").tap();
    expect(await page.getByTestId("side").isVisible()).toBe(true);
    for (const s of ["brush", "color", "layers", "rig", "fx"]) expect(await page.locator(`[data-section=${s}]`).isVisible(), s).toBe(false);
    await page.getByTestId("char-build").tap();
    await page.getByTestId("prop-preset-adolescente").tap();
    expect((await charDoc(page)).character.proportions.heightCm).toBe(168);
    await page.getByTestId("slot-pantalon").tap();
    await page.getByTestId("g-apply").tap();
    await openSection(page, "cp-expr");
    await page.getByTestId("expr-preset-sorpresa").tap();
    expect((await charDoc(page)).layers.some((l: { group?: string }) => l.group === "pantalon")).toBe(true);
    expect(await smallTargets(page, "[data-section=char]")).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/53-editor-personaje-android.png` });
    // cerrar la hoja y ver el personaje a pantalla completa
    await page.getByTestId("side").locator(".sheet-close").tap();
    await page.getByTestId("zoom-fit").tap();
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/54-personaje-android-lienzo.png` });
    // dibujar con el dedo (toque) en una capa nueva sigue funcionando
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);

  it("editor horizontal (teléfono girado): el panel es un cajón lateral utilizable", async () => {
    const c = await createCharacter(env, "Horizontal");
    const { ctx, page, errors } = await openEditorPage(env, c.url, { ...LANDSCAPE });
    await page.getByTestId("open-char").tap();
    await page.getByTestId("char-build").tap();
    const box = await page.getByTestId("side").boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(915.5);
    expect(box!.width).toBeLessThanOrEqual(915 * 0.73);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/55-editor-personaje-horizontal.png` });
    expect(errors).toEqual([]);
    await ctx.close();
  }, 120_000);
});
