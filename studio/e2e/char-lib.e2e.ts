import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SHOTS, openPage, settle, startEnv, type Env } from "./helpers";

let env: Env;
beforeAll(async () => (env = await startEnv()));
afterAll(() => env.close());

const V = { viewport: { width: 1280, height: 860 } } as const;

describe("biblioteca de personajes", () => {
  it("crear, buscar, ficha, renombrar, carpeta, duplicar y eliminar con confirmación; todo persiste al recargar", async () => {
    const { ctx, page, errors } = await openPage(env, V);
    await page.goto(`${env.base}/`);
    await page.getByTestId("open-library").click();
    await page.getByTestId("lib-empty").waitFor();
    await page.screenshot({ path: `${SHOTS}/40-biblioteca-vacia.png` });

    // crear (se abre el editor del personaje) y volver
    await page.getByTestId("char-new").click();
    await page.getByTestId("new-char-input").fill("Kenji Aoyama");
    await page.getByTestId("new-char-ok").click();
    await page.getByTestId("editor").waitFor();
    expect(await page.getByTestId("doc-title").textContent()).toBe("Kenji Aoyama");
    await page.getByTestId("exit").click();
    await page.getByTestId("char-grid").waitFor();
    expect(await page.getByTestId("char-card").count()).toBe(1);

    // segundo personaje y ficha completa
    await page.getByTestId("char-new").click();
    await page.getByTestId("new-char-input").fill("Aiko Shirogane");
    await page.getByTestId("new-char-ok").click();
    await page.getByTestId("editor").waitFor();
    await page.getByTestId("open-ficha").click();
    const data: Record<string, string> = {
      age: "17", height: "176 cm", gang: "Los Cuervos de Shibuya", rank: "Segunda al mando",
      description: "Delgada y alta. Mirada fría.\nLleva el uniforme largo abierto.", personality: "Seria, leal, explosiva si se meten con los suyos",
      history: "Expulsada de tres institutos.", relations: "Rival de Kenji; protege a los novatos", design: "Pelo negro con flequillo largo; cicatriz en la ceja", outfit: "Gakuran largo, camiseta roja, pantalón recto oversized",
    };
    for (const [k, v] of Object.entries(data)) await page.getByTestId(`ficha-${k}`).fill(v);
    await page.getByTestId("ficha-folder").fill("Cuervos");
    await page.getByTestId("ficha-tags").fill("lugarteniente, delincuente escolar");
    await page.getByTestId("ficha-save").click();
    await page.getByText("Ficha guardada.").waitFor();
    await page.screenshot({ path: `${SHOTS}/41-ficha.png` });
    await page.getByTestId("ficha-dialog-close").click();
    await page.getByTestId("exit").click();
    await page.getByTestId("char-grid").waitFor();
    expect(await page.getByTestId("char-card").count()).toBe(2);

    // buscar: por pandilla (de la ficha), por etiqueta, sin acentos; y sin resultados
    await page.getByTestId("lib-search").fill("cuervos");
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=char-card]").length === 1);
    expect(await page.getByTestId("char-name").textContent()).toBe("Aiko Shirogane");
    await page.getByTestId("lib-search").fill("DELINCUENTE");
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=char-card]").length === 1);
    await page.getByTestId("lib-search").fill("zzz");
    await page.getByTestId("lib-empty").waitFor();
    await page.getByTestId("lib-search").fill("");
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=char-card]").length === 2);

    // renombrar, mover a carpeta y filtrar por carpeta
    const aiko = page.locator("[data-testid=char-card]", { hasText: "Aiko Shirogane" });
    await aiko.getByTestId("char-rename").click();
    await page.getByTestId("rename-input").fill("Aiko «Cuervo» Shirogane");
    await page.getByTestId("rename-ok").click();
    await page.locator("[data-testid=char-card]", { hasText: "Aiko «Cuervo»" }).waitFor();
    const kenji = page.locator("[data-testid=char-card]", { hasText: "Kenji" });
    await kenji.getByTestId("char-folder").click();
    await page.getByTestId("folder-input").fill("Cuervos");
    await page.getByTestId("folder-ok").click();
    await page.getByTestId("lib-folder").selectOption("Cuervos");
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=char-card]").length === 2);
    await page.getByTestId("lib-folder").selectOption("");

    // duplicar
    await kenji.getByTestId("char-dup").click();
    await page.locator("[data-testid=char-card]", { hasText: "Kenji Aoyama (copia)" }).waitFor();
    expect(await page.getByTestId("char-card").count()).toBe(3);

    // eliminar: cancelar no borra; confirmar sí
    const copia = page.locator("[data-testid=char-card]", { hasText: "(copia)" });
    await copia.getByTestId("char-del").click();
    await page.getByTestId("del-confirm-cancel").click();
    expect(await page.getByTestId("char-card").count()).toBe(3);
    await copia.getByTestId("char-del").click();
    expect(await page.getByTestId("del-confirm").textContent()).toContain("conservan su copia");
    await page.screenshot({ path: `${SHOTS}/42-eliminar-confirmacion.png` });
    await page.getByTestId("del-confirm-ok").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-testid=char-card]").length === 2);
    await page.screenshot({ path: `${SHOTS}/43-biblioteca.png` });

    // «cerrar y abrir el programa»: página nueva, mismo servidor → la información sigue ahí, con la ficha completa
    await ctx.close();
    const again = await openPage(env, V);
    await again.page.goto(`${env.base}/#/personajes`);
    await again.page.waitForFunction(() => document.querySelectorAll("[data-testid=char-card]").length === 2);
    const names = await again.page.getByTestId("char-name").allTextContents();
    expect(names.sort()).toEqual(["Aiko «Cuervo» Shirogane", "Kenji Aoyama"]);
    const list = await (await fetch(`${env.base}/api/characters`)).json() as { characters: Array<{ id: string; sheet: Record<string, string>; folder: string; tags: string[] }> };
    const a = list.characters.find((c) => c.sheet.name.startsWith("Aiko"))!;
    for (const [k, v] of Object.entries(data)) expect(a.sheet[k], k).toBe(v);
    expect(a.folder).toBe("Cuervos");
    expect(a.tags).toEqual(["lugarteniente", "delincuente escolar"]);
    expect(errors).toEqual([]);
    expect(again.errors).toEqual([]);
    await settle(again.page);
    await again.ctx.close();
  }, 180_000);
});
