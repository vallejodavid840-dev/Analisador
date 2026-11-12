import type { Animation } from "@gas/core";
import { animationApi, characterApi } from "../api";
import { draftKey } from "./drafts";

/** De dónde viene y adónde va el documento que se edita: un episodio de un proyecto o un personaje de la biblioteca. */
export interface DocBackend {
  kind: "episode" | "character";
  draftKey: string;
  save(a: Animation): Promise<{ revision: number }>;
  saveOnExit(a: Animation): boolean;
  load(): Promise<Animation>;
}

export const episodeBackend = (projectId: string, episodeId: string): DocBackend => ({
  kind: "episode",
  draftKey: draftKey(projectId, episodeId),
  save: (a) => animationApi.save(projectId, a),
  saveOnExit: (a) => animationApi.saveOnExit(projectId, a),
  load: () => animationApi.load(projectId, episodeId),
});

export const characterBackend = (id: string): DocBackend => ({
  kind: "character",
  draftKey: `personaje/${id}`,
  save: (a) => characterApi.saveDrawing(a),
  saveOnExit: (a) => characterApi.saveDrawingOnExit(a),
  load: () => characterApi.drawing(id),
});
