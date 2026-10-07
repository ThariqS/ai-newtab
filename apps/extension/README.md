# @homepage/extension

The MV3 browser extension (WXT + React). See the [root README](../../README.md)
for setup and [ARCHITECTURE.md](../../ARCHITECTURE.md) for how it fits together.

```bash
pnpm build       # → .output/chrome-mv3
pnpm dev         # hot-reload dev build
pnpm typecheck
```

- `entrypoints/background.ts`: the service worker that hosts the build
- `entrypoints/newtab/`: the new-tab UI, a thin client onto the worker
- `lib/`: the build manager, the two browser tools, storage and the page↔worker protocol
