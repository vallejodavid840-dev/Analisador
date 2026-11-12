import type { Page } from "playwright";
import { settle } from "./helpers";

/** Mueve un deslizador del panel y dispara input+change (como al soltarlo). */
export async function setRange(page: Page, testid: string, value: number): Promise<void> {
  await page.getByTestId(testid).evaluate((el, v) => {
    const i = el as HTMLInputElement;
    i.value = String(v);
    i.dispatchEvent(new Event("input", { bubbles: true }));
    i.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await settle(page);
}

export const openSection = async (page: Page, testid: string) => {
  const d = page.getByTestId(testid);
  if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator("summary").click();
};

export const charDoc = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__gas!.model.doc)));

export const layerByGroup = (d: { layers: Array<{ id: string; group?: string }> }, g: string) => d.layers.find((l) => l.group === g);

/** Caja (x0,y0,x1,y1) de todos los trazos de una capa en el dibujo `fi` de un documento. */
export function bboxOf(d: { frames: Array<{ cells: Record<string, Array<{ points: number[] }>> }> }, layerId: string, fi = 0, minY = -Infinity) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of d.frames[fi]!.cells[layerId] ?? []) for (let i = 0; i < s.points.length; i += 3) {
    const y = s.points[i + 1]!;
    if (y < minY) continue;
    x0 = Math.min(x0, s.points[i]!); x1 = Math.max(x1, s.points[i]!); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
