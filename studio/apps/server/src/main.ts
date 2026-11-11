import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app";

const here = fileURLToPath(new URL(".", import.meta.url));
const dataDir = resolve(process.env["STUDIO_DATA_DIR"] ?? resolve(here, "../../../studio-data"));
const staticDir = resolve(process.env["STUDIO_STATIC_DIR"] ?? resolve(here, "../../studio/dist"));
// 0.0.0.0 permite abrir el estudio desde un móvil Android en la misma red.
const host = process.env["HOST"] ?? "0.0.0.0";
const port = Number(process.env["PORT"] ?? 4173);

const app = await buildApp({ dataDir, staticDir, logger: true });
await app.listen({ host, port });
app.log.info(`Proyectos en: ${dataDir}`);
