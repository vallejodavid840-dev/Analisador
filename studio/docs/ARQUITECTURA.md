# Arquitectura (estado: Fase 1)

```
apps/studio  (UI, Vite + TS, sin framework)  ──HTTP──>  apps/server (Fastify)
   │      │                                                  │
   │      └──> @gas/engine (operaciones, historial, reproducción)
   │      └──> @gas/render (pintado de trazos, Canvas2D)    @gas/storage (disco)
   └──────────> @gas/core (modelo, esquemas, geometría, migraciones) <──┘
```

- `packages/core`: TypeScript puro, sin DOM ni Node: esquemas (proyecto y animación), geometría, migraciones.
- `packages/engine`: operaciones **puras e inmutables** sobre la animación (capas, fotogramas, trazos), historial por instantáneas y reloj de reproducción. Sin DOM.
- `packages/render`: pinta trazos en cualquier contexto Canvas2D (navegador o Node). Lo reutilizará el exportador de la Fase 2 para que lo exportado sea idéntico a lo que se ve.
- `packages/storage`: lectura/escritura de proyectos en disco.
- `apps/server`: API REST local (`/api/projects`) y servidor de la interfaz compilada.
- `apps/studio`: interfaz en español (`src/es.ts` concentra todos los textos), táctil (objetivos ≥48 px), sin dependencias de UI.

Paquetes previstos y aún **no creados**: `combat`, `audio`, `export` (ver plan por fases).

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

Todas MIT/Apache-2.0/ISC: fastify, @fastify/static, zod, tsx, vite, typescript, vitest, eslint, typescript-eslint, playwright, concurrently, @napi-rs/canvas (solo en tests). Revisar con `npm ls` + `npx license-checker` antes de distribuir.
