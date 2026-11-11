/**
 * Proceso hijo de exportación. Se ejecuta APARTE del servidor para que renderizar (que usa mucha CPU)
 * no bloquee la API ni el autoguardado, para que la memoria se libere al terminar y para que cancelar
 * sea tan simple como detener el proceso.
 * Protocolo (IPC): el padre envía {type:"start"|"cancel"}; el hijo responde con progress / spawn / result / error.
 */
import { parseAnimation } from "@gas/core";
import { ExportError } from "./errors";
import { runExport, type ExportRequest } from "./pipeline";

type StartMsg = { type: "start"; request: Omit<ExportRequest, "animation">; animation: unknown };
type Msg = StartMsg | { type: "cancel" };

const send = (m: unknown) => {
  if (process.connected) process.send?.(m);
};

const ac = new AbortController();
process.on("message", (msg: Msg) => {
  if (msg.type === "cancel") ac.abort();
  else if (msg.type === "start") void start(msg);
});
// Si el servidor desaparece, no seguimos trabajando huérfanos.
process.on("disconnect", () => ac.abort());
process.on("SIGTERM", () => ac.abort());

async function start(msg: StartMsg): Promise<void> {
  try {
    const animation = parseAnimation(msg.animation);
    const result = await runExport(
      { ...msg.request, animation },
      {
        signal: ac.signal,
        onProgress: (p) => send({ type: "progress", ...p, rss: process.memoryUsage().rss }),
        onSpawn: (pid) => send({ type: "spawn", pid }),
      },
    );
    send({ type: "result", result });
    process.exitCode = 0;
  } catch (e) {
    const err = e instanceof ExportError ? e : new ExportError("internal", `Error inesperado al exportar: ${(e as Error).message}`, (e as Error).stack);
    send({ type: "error", code: err.code, message: err.message, detail: err.detail });
    process.exitCode = err.code === "cancelled" ? 0 : 1;
  } finally {
    // Deja que el mensaje salga antes de cerrar.
    setTimeout(() => process.exit(), 20);
  }
}
