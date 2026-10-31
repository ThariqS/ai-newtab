# AI Homepage

**A new tab that reads the internet for you.**

AI Homepage replaces Chrome's new-tab page with one that's written for you. An
agent looks at what you've actually been browsing, opens the pages you follow
(signed in as you), and writes a fresh homepage from what it finds there. It
rebuilds itself in the background, so each new tab is up to date.

![An example homepage in a morning-newspaper style](docs/preview.png)
<sub>Illustration. Your homepage is built from your own browsing, so its stories will be different.</sub>

A morning newspaper is just one look. You can describe any look and the next build
follows it: a quiet one-column digest, a dense dashboard, a green-on-black
terminal, a zine.

> **Privacy, up front.** To build your homepage, the extension sends a summary of
> your browsing history (top domains, visit counts, a few page titles) and the
> cleaned-up HTML of up to 10 pages to the model provider you chose, using your own
> credentials. Those pages are loaded in your signed-in browser, so they can include
> private content. With Claude, the agent session and every uploaded page are deleted
> when each build ends. With OpenAI, nothing is stored server-side between requests
> (`store: false`). Your API key or ChatGPT tokens stay in the extension's local
> storage. More detail in [ARCHITECTURE.md](./ARCHITECTURE.md#privacy).

---

## Install

You need Chrome (or another Chromium browser), [Node.js](https://nodejs.org) 20+,
and one of:

- an [Anthropic API key](https://console.anthropic.com) (the **Claude** engine, default), or
- a **ChatGPT Plus/Pro** subscription, or an [OpenAI API key](https://platform.openai.com)
  (the **OpenAI** engine).

```bash
git clone https://github.com/ThariqS/ai-newtab.git
cd ai-newtab
npx pnpm@10.11.1 install
npx pnpm@10.11.1 build
```

(If you already have [pnpm](https://pnpm.io), plain `pnpm install && pnpm build` works too.)

Then load it into Chrome:

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `apps/extension/.output/chrome-mv3`.

If Chrome asks whether to keep the changed new-tab page, choose **Keep it**.

## Your first homepage

1. Open a new tab and choose an engine:
   - **Claude**: paste your Anthropic API key.
   - **OpenAI, with your ChatGPT plan**: click **Continue with ChatGPT**. A ChatGPT tab
     opens: sign in, give the app a name if asked, and approve **ChatGPT plan usage**.
     The tab closes itself and the new tab shows you as signed in.
   - **OpenAI, with an API key**: pick "Use an OpenAI API key" and paste it.
2. Click **Build today's homepage**.
3. Watch it work. The progress view walks through each step: preparing the
   agent, reading your history, opening pages in your browser, analyzing them,
   and writing your homepage.

The first build takes a few minutes. You can close the tab while it runs, since
the build lives in the extension's background worker and appears in any new tab
you open.

### How Sign in with ChatGPT works here

ChatGPT plan usage is an OAuth flow for open-source, locally run apps. It requires a
callback on `http://127.0.0.1:<port>/auth/callback`, which a browser extension cannot
listen on. So the extension opens the ChatGPT authorization page in a tab and watches,
with `chrome.webNavigation`, for the redirect to that address. It reads the
authorization code off the URL before the (doomed) request is sent, closes the tab, and
exchanges the code for tokens from the service worker. Tokens are refreshed
automatically; **Sign out** in Settings revokes the session. There is no client secret
anywhere: it is a public OAuth client with PKCE.

## Make it yours

Click **⚙️ Settings** on the new tab.

**Instructions.** Anything you write here goes into every build and takes priority
over the agent's own defaults. This box sets both the content and the look:

| You write | You get |
| --- | --- |
| *"A morning newspaper. Serif type, a big masthead, a lead story, a column of briefs."* | A broadsheet front page |
| *"One calm column. No images. Five things worth reading, with one line on why."* | A quiet reading list |
| *"Dense dashboard: GitHub PRs and issues first, then Hacker News, then everything else."* | A work cockpit |
| *"Green-on-black terminal, monospace, like a 1980s BBS."* | Exactly that |
| *"Skip sports and politics. Always show the weather and my next three calendar events."* | Your rules, every day |

Click **Save & rebuild** to apply them right away.

**Sites the agent never reads.** Enter one host per line; subdomains are included,
and `*.example.com` is supported. The editable defaults include common webmail,
sign-in and document hosts. **Save & rebuild** saves the list and applies it to
history summaries and URLs requested through `getPageHtml`. A page that redirects
onto a blocked host is dropped before its content is uploaded. Local-network
addresses (localhost, private IPs, `.local` and `.internal` hosts) are always blocked.

**Engine and model.** Switch between Claude and OpenAI here. With Claude, choose which
model writes your page:

- **Claude Sonnet 5.5** (default): the best balance of quality and cost.
- **Claude Haiku 5.5**: the fastest and cheapest.
- **Claude Opus 5.5**: the most careful editor, and the most expensive.

**Message Batches (Claude).** The toggle under the Claude model, **Use the Message
Batches API: half price, slower**, sends builds through Anthropic's
[Message Batches API](https://platform.claude.com/docs/en/build-with-claude/batch-processing),
which bills every token at half the standard price. In exchange, each step of the build
waits in Anthropic's batch queue: usually a few minutes, at most 24 hours. A build takes a
handful of steps, so start it and let it run; the homepage appears when it is done, and the
morning edition works the same way. Off, builds run as a Managed Agents session at the
standard price.

With OpenAI, the list comes from `GET /v1/models` with your credentials: the models your
plan or organization offers, in OpenAI's order. The first one is the default. The new
model takes effect from your next build.

**Rebuild automatically each morning.** On by default. The extension builds one
morning edition a day, quietly in the background, the first time Chrome is open
between 5am and noon. If Chrome isn't open that morning, the day is skipped. It
only starts after you've built once by hand, and it tries at most once per
morning, so it never loops.

**ChatGPT account.** With the OpenAI engine, Settings shows who is signed in.
**Sign out** revokes the session and keeps the app registration, so signing back in is
one click. **Switch account** also forgets the registration, so the next sign-in can
register another ChatGPT account or workspace.

**Look.** Five looks re-dress the page instantly, without a rebuild: **Metropolitan**
(blackletter masthead, serif, black on white), **Ledger** (dense financial broadsheet,
Didone small caps, navy), **Capital** (blackletter over bold sans headlines, strong rules),
**Nationwide** (bright all-sans, colour-coded sections) and **Boréal** (cream paper, heavy
old-style serif, deep red). "As the agent built it" keeps the model's own choices. The
stories stay; only typography, palette and rules change. Pages built before this version
follow a look from their next build.

**↻ Rebuild** in the top-right corner rebuilds right away.

**Dark mode.** The icon button next to the buttons cycles **system → dark → light**
(screen, moon, sun). It restyles the extension's own screens and tells the generated page which
scheme you forced; pages built from now on honour it, older ones follow the system.

**Language.** The extension's screens are in English and French, and follow the browser's
language until you pick one in Settings → **Language**. The homepage itself is written by the
agent: to get it in a given language, say so in your standing instructions. Adding a language
is one file; see [apps/extension/lib/i18n/README.md](./apps/extension/lib/i18n/README.md).

## Good to know

- **Cost.** With an API key, each build is billed to that key; what it costs depends
  on the model and on how much it reads. With a ChatGPT plan, builds count against
  your plan's app usage instead. Plus plans share one five-hour limit across all apps.
  Pro plans don't have that one, but other limits, including per-app ones, can still
  apply. When a limit is reached, the page says so, keeps your last homepage, and links
  to [chatgpt.com/settings/usage](https://chatgpt.com/settings/usage). You can turn off
  automatic rebuilds to build only when you ask.
- **What it can see.** It ranks the sites in your history, with each subreddit you
  visit ranked on its own, and opens up to 10 of them per build. It skips search
  engines, webmail, banking and logged-out marketing pages. Anything it can't open is
  reported, not hidden.
- **Links are real.** Every link on the page comes from a page the agent actually
  read. It's told never to invent a URL. A plain click opens it in a new tab, or in
  this tab if you prefer (Settings → "Links open in"); cmd/ctrl-click and the middle
  button always open a background tab.
- **The look.** Without instructions, the page is a morning broadsheet: masthead,
  lead story, a column grid, briefs. Write anything in Settings to change that.
- **Interrupted builds.** If Chrome closes mid-build, the worker resumes it on its
  next wake, and the new tab offers **Resume interrupted build**.
- **Updating.** After pulling new code, run `npx pnpm@10.11.1 build` again, then
  click the reload icon on the extension in `chrome://extensions`.

## How it works

1. **`getHistory`**: the agent gets a ranked summary of your most-visited domains.
2. **`getPageHtml`**: it picks up to 10 pages, which the extension opens in a
   background window, cleans up, and mounts into the agent's sandbox as files.
3. **`grep` / `read` / `glob`**: the agent pulls headlines, posts and links out of
   those files inside its sandbox.
4. **`write`**: it writes one React component, which the new tab renders.

The two browser tools run in the extension because they need `chrome.history` and
`chrome.tabs`. Where the rest runs depends on the engine:

- **Claude**: the background worker drives a
  [Claude Managed Agents](https://docs.claude.com) session directly, with no server
  in between. The sandbox tools run in the session's sandbox, where shell access is off.
- **OpenAI**: the background worker runs the agent loop itself over the
  [Responses API](https://developers.openai.com/api/docs), one stateless request per
  turn, and the sandbox is an in-memory one in plain TypeScript. Nothing is executable.

Either way, scraped pages are untrusted input.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the event flow, the layout, and
the gotchas worth knowing.

## Development

```
packages/agent-core   the engines (claude/, openai/) and what they share: host-agnostic, no chrome.* or node:*
apps/extension        the MV3 extension (WXT + React)
harness               Bun scripts that run agent-core outside Chrome, and test the built extension
```

```bash
pnpm dev                 # WXT with hot reload
pnpm typecheck           # all packages
pnpm test                # unit tests (no API calls; needs Bun)
pnpm extension:test      # loads the built extension into headless Chrome (no API calls)
pnpm i18n:check          # translation coverage per language, and what is missing

cp .env.example .env     # add ANTHROPIC_API_KEY or OPENAI_API_KEY, or:
pnpm agent:login         # sign in with ChatGPT from the terminal (real loopback listener)
pnpm agent:models        # list the OpenAI models your credentials offer
pnpm agent:run           # a full build against the real API, with fixture history
pnpm agent:verify        # check the output actually renders
```

## Status

Early and experimental. It's a tool you run yourself with your own credentials. Don't
publish it to a store as-is: anyone with access to the browser profile can read the
stored keys and tokens, and ChatGPT plan usage is only offered to open-source, locally
run apps.

## License

MIT
