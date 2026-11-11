import type { Page } from "playwright";
import { boneRow, dragDoc, line, mouseStroke, setColor, skeletonOf } from "./helpers";

/** Brazo de 2 huesos (hombro 300,300 → codo 450,300 → muñeca 600,300) y un trazo rojo grueso vinculado como deformable. */
export async function armSetup(page: Page, opts: { frames?: number; hideRig?: boolean } = {}) {
  await page.keyboard.press("o"); // sin papel cebolla
  await page.getByTestId("brush-size").fill("40");
  await setColor(page, "#ff0000");
  await mouseStroke(page, line(300, 300, 600, 300, 2));
  await page.getByTestId("tool-rig").click();
  await page.getByTestId("rig-new").click();
  await dragDoc(page, [300, 300], [450, 300]);
  await dragDoc(page, [450, 300], [600, 300]);
  await page.getByTestId("rig-create").click();
  await page.getByTestId("rig-mode-pose").click();
  const sk = await skeletonOf(page);
  const [up, lo] = sk.bones as Array<{ id: string; name: string }>;
  await page.getByTestId("bind-mode").selectOption("skin");
  await page.getByTestId("bind-bone").selectOption(up!.id);
  for (const cb of await page.getByTestId("bind-infl").all()) await cb.check();
  // fotogramas extra: «Duplicar» copia el dibujo y la pose (los trazos se comparten, no se duplican en memoria)
  for (let i = 1; i < (opts.frames ?? 1); i++) await page.getByTestId("dup-frame").click();
  if (opts.frames && opts.frames > 1) await page.getByTestId("first").click();
  if (opts.hideRig ?? true) await page.getByTestId("rig-toggle-show").click();
  await boneRow(page, lo!.name).click();
  return { up: up!, lo: lo! };
}

export const keyedCells = (page: Page) => page.locator("[data-testid=frame-cell].keyed").count();
export const goto = (page: Page, i: number) => page.evaluate((k) => window.__gas!.model.setFrameIndex(k), i);
