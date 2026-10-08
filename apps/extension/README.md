# @homepage/extension

The browser extension (WXT + React): MV3 for Chrome, MV2 for Firefox. See the
[root README](../../README.md) for setup and [ARCHITECTURE.md](../../ARCHITECTURE.md)
for how it fits together.

```bash
pnpm build           # → .output/chrome-mv3
pnpm build:firefox   # → .output/firefox-mv2
pnpm dev             # hot-reload dev build (dev:firefox for Firefox)
pnpm typecheck
```

- `entrypoints/background.ts`: the service worker that hosts the build
- `entrypoints/newtab/`: the new-tab UI, a thin client onto the worker
- `lib/`: the build manager, the two browser tools, storage and the page↔worker protocol
