# AI Homepage

A browser extension that turns your new-tab page into a homepage built from what
you've actually been browsing. An agent reads your history, opens the pages you
follow in your real (logged-in) browser, and writes a fresh React homepage from
what it finds. It rebuilds on a schedule, with no server.

The whole build runs from your browser: the extension's service worker drives a
[Claude Managed Agents](https://docs.claude.com) session using your own Anthropic
API key, and the new-tab page is a live view onto it.

> **Privacy, up front.** To build your homepage, the extension sends a digest of
> your browsing history (top domains, visit counts, a few page titles) and the
> sanitized HTML of up to 8 pages to the Anthropic API. These pages are loaded
> in your logged-in browser, so that can include private content. The session and
> every uploaded page are deleted at the end of each build. Your API key is stored
> in `chrome.storage.local`. See [ARCHITECTURE.md](./ARCHITECTURE.md#privacy).

## How it works

1. **`getHistory`**: the agent gets a ranked digest of your most-visited domains.
2. **`getPageHtml`**: it picks up to 8 pages, which the extension opens in a
   background window, sanitizes, and mounts into the agent's sandbox as files.
3. **`grep` / `read`**: the agent pulls headlines, posts and links out of those
   files inside its sandbox.
4. **`write`**: it writes a single React component, which the new tab renders.

The two custom tools run in the extension because they need `chrome.history` and
`chrome.tabs`. Everything else is the agent's own sandbox. Because the loop
lives in the service worker, a build survives closing the tab, shows up live in
every open tab, and can run headless on a schedule.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the event flow, the layout, and
the gotchas worth knowing.

## Getting started

Requires [pnpm](https://pnpm.io), plus [Bun](https://bun.sh) for the harness, and
an [Anthropic API key](https://console.anthropic.com).

```bash
pnpm install
pnpm build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
and pick `apps/extension/.output/chrome-mv3`. Open a new tab, paste your API key,
and hit **Build**. The first build takes a few minutes.

For development, `pnpm dev` runs WXT with hot reload.

## Settings

All of these are in the ⚙️ Settings modal on the new tab:

- **Standing instructions**: free text added to every build, e.g. "surface unread GitHub PRs first".
- **Rebuild automatically**: on by default; rebuilds in the background every 6/12/24/48 hours.
  It only runs after you've built once by hand, and it won't retry a failure until the next interval.

## Development

```
packages/agent-core   the agent loop: host-agnostic, no chrome.* or node:*
apps/extension        the MV3 extension (WXT + React)
harness               Bun scripts that run agent-core outside Chrome, and test the built extension
```

```bash
pnpm typecheck           # all packages
pnpm test                # unit tests (no API calls)
pnpm extension:test      # loads the built extension into headless Chrome (no API calls)

cp .env.example .env     # add ANTHROPIC_API_KEY, then:
pnpm agent:run           # a full build against the real API, with fixture history
pnpm agent:verify        # check the output actually renders
```

## Status

Early and experimental. It's built as a tool you run yourself with your own key.
Don't publish it to a store as-is: anyone with access to the browser profile can
read the stored API key.

## License

MIT
