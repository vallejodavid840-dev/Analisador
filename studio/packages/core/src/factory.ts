import { CURRENT_SCHEMA_VERSION, ProjectSchema, type NewProject, type Project } from "./schema";

export const DEFAULT_SETTINGS = { fps: 24, width: 1920, height: 1080 } as const;

/** Genera un identificador válido según `ID_PATTERN`. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function createProject(input: NewProject, now: Date = new Date()): Project {
  const iso = now.toISOString();
  return ProjectSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId(),
    name: input.name,
    createdAt: iso,
    updatedAt: iso,
    settings: { ...DEFAULT_SETTINGS, ...input.settings },
    seasons: [],
  });
}

export function addSeason(project: Project, name?: string): Project {
  const n = project.seasons.length + 1;
  return {
    ...project,
    seasons: [...project.seasons, { id: newId(), name: name ?? `Temporada ${n}`, episodes: [] }],
  };
}

export function addEpisode(project: Project, seasonId: string, title?: string): Project {
  if (!project.seasons.some((s) => s.id === seasonId)) {
    throw new Error(`Temporada inexistente: ${seasonId}`);
  }
  return {
    ...project,
    seasons: project.seasons.map((s) =>
      s.id === seasonId
        ? { ...s, episodes: [...s.episodes, { id: newId(), title: title ?? `Episodio ${s.episodes.length + 1}` }] }
        : s,
    ),
  };
}
