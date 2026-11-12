import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { FrameRenderer } from "../../export/src/pipeline";
import { applySpecs, bodyLayers, newCharacterDoc, restOf, headLayers, faceLayers, hairLayers, garmentLayers, DEFAULT_FACE, DEFAULT_HAIR, DEFAULT_GARMENT, EXPRESSIONS, ensureSkeleton, type GarmentParams } from "../src";

const OUT = process.env.GALLERY;
function build(skin: string, face: object, hair: object, gs: Array<Partial<GarmentParams> & { type: GarmentParams["type"] }>, expr = "neutral", props: object = {}) {
  let d = newCharacterDoc("c1");
  d = { ...d, character: { ...d.character!, proportions: { ...d.character!.proportions, ...props } } };
  d = ensureSkeleton(d);
  const rest = restOf(d)!;
  const fp = { ...DEFAULT_FACE, skin, ...face };
  d = applySpecs(d, 0, bodyLayers(rest, { skin }));
  d = applySpecs(d, 0, headLayers(rest, fp));
  for (const g of gs) d = applySpecs(d, 0, garmentLayers(rest, { ...DEFAULT_GARMENT[g.type], ...g }));
  d = applySpecs(d, 0, faceLayers(rest, fp, EXPRESSIONS[expr]!.p));
  d = applySpecs(d, 0, hairLayers(rest, { ...DEFAULT_HAIR, ...hair }));
  return d;
}
describe.skipIf(!OUT)("galería", () => {
  it("personajes", async () => {
    mkdirSync(OUT!, { recursive: true });
    const a = build("#f0c8a8", { eyeStyle: "afilado", jaw: "marcada", browStyle: "cortada", iris: "#7a4a2a" }, { style: "puntiagudo", color: "#d9c06a", seed: 3 }, [
      { type: "pantalon", color: "#2d3a55", width: 2.6, length: 1.25, sag: 0.7, folds: 0.9, texture: "denim" },
      { type: "zapatillas", color: "#e9e6e0", color2: "#c93a3a" },
      { type: "camiseta", color: "#e6e1d6", print: "emblema" },
      { type: "chaqueta", color: "#8a1f2c", width: 1.7, length: 1.7, open: 0.5, zipper: false, buttons: 0, print: "franjas" },
    ], "desafiante", { heightCm: 178, build: 0.55, shoulders: 1.1 });
    writeFileSync(`${OUT}/a.png`, await new FrameRenderer(a, 1000, 1300, "#e9e6ef").png(0));
    const b = build("#e8be9c", { eyeStyle: "intenso", jaw: "cuadrada", browStyle: "gruesa", iris: "#2a2a30" }, { style: "undercut", color: "#101014" }, [
      { type: "pantalon", color: "#1c1c26", width: 2.2, length: 1.15, texture: "liso", sag: 0.3 },
      { type: "zapatillas", color: "#f0f0f0", color2: "#222" },
      { type: "camiseta", color: "#f2f2f2" },
      { type: "uniforme", length: 1.75, open: 0.4, buttons: 5 },
    ], "serio", { heightCm: 182, build: 0.5 });
    writeFileSync(`${OUT}/b.png`, await new FrameRenderer(b, 1000, 1300, "#e9e6ef").png(0));
    const c = build("#f3d3b8", { eyeStyle: "caido", jaw: "afilada", browStyle: "fina", iris: "#5a7a5a" }, { style: "largo", color: "#4a2a2a" }, [
      { type: "pantalon", color: "#5a6a52", width: 1.5, length: 1.0, texture: "cuadros", color2: "#a8b89a" },
      { type: "botas" },
      { type: "sudadera", color: "#c9a23a", width: 1.7 },
    ], "sonrisaArrogante", { heightCm: 168, build: 0.2, heads: 7.4 });
    writeFileSync(`${OUT}/c.png`, await new FrameRenderer(c, 1000, 1300, "#e9e6ef").png(0));
  });
});
