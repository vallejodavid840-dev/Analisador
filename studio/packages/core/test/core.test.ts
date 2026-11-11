import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  ProjectFormatError,
  addEpisode,
  addSeason,
  createProject,
  migrate,
  parseProject,
  ProjectSchema,
  ID_PATTERN,
  type Migration,
} from "../src";

describe("createProject", () => {
  it("crea un proyecto válido con valores por defecto", () => {
    const p = createProject({ name: "  Calle Roja  " });
    expect(p.name).toBe("Calle Roja");
    expect(p.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(p.settings).toEqual({ fps: 24, width: 1920, height: 1080 });
    expect(ID_PATTERN.test(p.id)).toBe(true);
    expect(ProjectSchema.safeParse(p).success).toBe(true);
  });

  it.each([12, 24, 30])("admite %i FPS", (fps) => {
    expect(createProject({ name: "x", settings: { fps } }).settings.fps).toBe(fps);
  });

  it.each([0, -1, 121, 23.5])("rechaza FPS inválido %s", (fps) => {
    expect(() => createProject({ name: "x", settings: { fps } })).toThrow();
  });

  it("rechaza nombres vacíos", () => {
    expect(() => createProject({ name: "   " })).toThrow();
  });
});

describe("temporadas y episodios", () => {
  it("añade sin mutar el original", () => {
    const p0 = createProject({ name: "Serie" });
    const p1 = addSeason(p0);
    const s = p1.seasons[0]!;
    const p2 = addEpisode(p1, s.id);
    expect(p0.seasons).toHaveLength(0);
    expect(p1.seasons[0]!.episodes).toHaveLength(0);
    expect(p2.seasons[0]!.episodes[0]!.title).toBe("Episodio 1");
    expect(ProjectSchema.safeParse(p2).success).toBe(true);
  });

  it("falla con una temporada inexistente", () => {
    expect(() => addEpisode(createProject({ name: "x" }), "nope")).toThrow();
  });
});

describe("migraciones", () => {
  const fake: Migration[] = [
    { from: 1, to: 2, up: (r) => ({ ...r, a: 1 }) },
    { from: 2, to: 3, up: (r) => ({ ...r, b: (r["a"] as number) + 1 }) },
  ];

  it("encadena migraciones en orden y no muta la entrada", () => {
    const input = { schemaVersion: 1 };
    const out = migrate(input, fake, 3);
    expect(out).toEqual({ data: { schemaVersion: 3, a: 1, b: 2 }, fromVersion: 1, migrated: true });
    expect(input).toEqual({ schemaVersion: 1 });
  });

  it("no migra si ya está en la versión objetivo", () => {
    expect(migrate({ schemaVersion: 3 }, fake, 3).migrated).toBe(false);
  });

  it("rechaza versiones más nuevas", () => {
    expect(() => migrate({ schemaVersion: 9 }, fake, 3)).toThrowError(ProjectFormatError);
  });

  it("falla si falta un paso", () => {
    expect(() => migrate({ schemaVersion: 1 }, [fake[1]!], 3)).toThrow(/No hay migración/);
  });

  it.each([null, [], "x", 3, {}, { schemaVersion: "1" }, { schemaVersion: 0 }, { schemaVersion: 1.5 }])(
    "rechaza entrada inválida %j",
    (bad) => {
      expect(() => migrate(bad)).toThrowError(ProjectFormatError);
    },
  );
});

describe("parseProject", () => {
  it("acepta un proyecto válido y lo reproduce", () => {
    const p = addSeason(createProject({ name: "Serie" }));
    const parsed = parseProject(JSON.parse(JSON.stringify(p)));
    expect(parsed.project).toEqual(p);
    expect(parsed.migrated).toBe(false);
  });

  it("rechaza ids con separadores de ruta", () => {
    const p = { ...createProject({ name: "x" }), id: "../etc" };
    expect(() => parseProject(p)).toThrowError(ProjectFormatError);
  });
});
