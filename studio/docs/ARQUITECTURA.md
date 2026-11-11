# Arquitectura (estado: Fase 0)

```
apps/studio  (UI, Vite + TS, sin framework)  ──HTTP──>  apps/server (Fastify)
        │                                                    │
        └──> @gas/core (modelo, esquemas, migraciones)  <──  @gas/storage (disco)
```

- `packages/core`: TypeScript puro, sin DOM ni Node. Lo usarán el motor y el exportador (Fases 1–2).
- `packages/storage`: lectura/escritura de proyectos en disco.
- `apps/server`: API REST local (`/api/projects`) y servidor de la interfaz compilada.
- `apps/studio`: interfaz en español (`src/es.ts` concentra todos los textos), táctil (objetivos ≥48 px), sin dependencias de UI.

Paquetes previstos y aún **no creados**: `engine`, `render`, `combat`, `audio`, `export` (ver plan por fases).

## Uso

```bash
cd studio && npm install
npm run dev        # servidor :4173 + interfaz :5173 con recarga
npm start          # compila y sirve todo en :4173
npm run check      # tipos + lint + tests unitarios
npm run e2e        # navegador real (escritorio y Android emulado)
```

Variables: `STUDIO_DATA_DIR` (proyectos; por defecto `studio/studio-data`), `PORT`, `HOST` (por defecto `0.0.0.0`).

**Desde Android**: con el PC y el móvil en la misma red Wi-Fi, abre `http://<IP-del-PC>:4173`.
Aviso: el servidor no tiene autenticación; úsalo solo en redes de confianza (`HOST=127.0.0.1` para restringirlo).

## Licencias de dependencias

Todas MIT/Apache-2.0/ISC: fastify, @fastify/static, zod, tsx, vite, typescript, vitest, eslint, typescript-eslint, playwright, concurrently. Revisar con `npm ls` + `npx license-checker` antes de distribuir.
