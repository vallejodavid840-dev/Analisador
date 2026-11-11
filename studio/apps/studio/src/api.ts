import type { NewProject, Project } from "@gas/core";

export interface SummaryRow {
  summary?: { id: string; name: string; updatedAt: string; fps: number; seasons: number; episodes: number };
  error?: { id: string; message: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError("No hay conexión con el servidor del estudio", 0, "network");
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { message?: string; error?: string };
    throw new ApiError(b.message ?? `Error ${res.status}`, res.status, b.error ?? "unknown");
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

export const api = {
  list: () => request<{ projects: SummaryRow[] }>("/api/projects").then((r) => r.projects),
  create: (input: NewProject) => request<Project>("/api/projects", json("POST", input)),
  load: (id: string) => request<Project>(`/api/projects/${encodeURIComponent(id)}`),
  save: (p: Project) => request<Project>(`/api/projects/${encodeURIComponent(p.id)}`, json("PUT", p)),
};

import type { Animation } from "@gas/core";

const animUrl = (pid: string, eid: string) => `/api/projects/${encodeURIComponent(pid)}/episodes/${encodeURIComponent(eid)}/animation`;

export const animationApi = {
  load: (pid: string, eid: string) => request<Animation>(animUrl(pid, eid)),
  save: (pid: string, a: Animation) => request<{ revision: number }>(animUrl(pid, a.episodeId), json("PUT", a)),
  /** Envío al cerrar la pestaña: `keepalive` sobrevive a la descarga de la página (límite ~64 KB; si no cabe, queda el borrador local). */
  saveOnExit: (pid: string, a: Animation): boolean => {
    const body = JSON.stringify(a);
    if (body.length > 60_000) return false;
    void fetch(animUrl(pid, a.episodeId), { method: "PUT", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    return true;
  },
};
