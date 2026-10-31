# Architecture

There is no server. The parties involved depend on the engine, and you run the
extension either way.

| | Runs where | Does what |
|---|---|---|
| **Extension** (service worker) | Your browser | Hosts the build: runs the chosen engine, executes `getHistory` / `getPageHtml`, persists the homepage, holds every credential |
| **Extension** (new-tab page(s)) | Your browser | Thin view: subscribes to the worker over a port, renders live progress and the finished homepage |
| **Claude engine** — orchestration layer | Anthropic | Runs the agent loop, persists the session event log, emits `agent.custom_tool_use` |
| **Claude engine** — session sandbox | Anthropic | Runs `read` / `grep` / `glob` / `write` over the mounted pages |
| **OpenAI engine** — Responses API | OpenAI | Runs the model, one stateless request per turn (`store: false`); the loop and the sandbox run in the worker |

The build is hosted **in the service worker** (`apps/extension/lib/build-manager.ts`), so it
survives closing the tab, shows up in every open tab, and can run headless on a
`chrome.alarms` schedule. The two browser tools execute in the extension with either
engine, because they need `chrome.history` and `chrome.tabs`. There is no inbound
connection and no public endpoint.

## Engines

`packages/agent-core/engine.ts` is the switch: `runHomepageBuild(opts)` dispatches on
`opts.engine`. Both engines share the browser bridge, the KV store, the history digest,
the site filter, the tool schemas, the editorial instructions and the result shape.

### Claude (`agent-core/claude/`)

The worker drives a Claude Managed Agents session. Anthropic never executes the browser
tools — it emits an event and waits for a `user.custom_tool_result` on the same
authenticated stream. The sandbox tools run in the session's sandbox.

```
service worker        Anthropic loop        sandbox
    │                       │                  │
    ├─ sessions.create ────▶│                  │
    ├─ events.stream ──────▶│  (open first)    │
    ├─ user.message ───────▶│                  │
    │◀─ custom_tool_use ────┤  getHistory      │
    ├─ chrome.history ──────┤                  │
    ├─ custom_tool_result ─▶│                  │
    │◀─ custom_tool_use ────┤  getPageHtml     │
    ├─ tabs + scripting     │                  │
    ├─ files.upload ───────────────────────────▶
    ├─ resources.add ──────────────────────────▶  mounts /mnt/session/uploads/pages/*.html
    ├─ custom_tool_result ─▶│                  │
    │                       ├─ grep / read ───▶│
    │◀─ agent.message ──────┤                  │
    │◀─ status_idle ────────┤  end_turn        │
    ├─ files.list(scope_id) ───────────────────▶  /mnt/session/outputs/homepage.tsx
    └─ sessions.delete ────▶│                  │
```

### Claude through Message Batches (`agent-core/claude/batch-orchestrator.ts`)

Settings → "Use the Message Batches API" (`claudeApiMode: "batch"`) bills every token at
half price. Managed Agents sessions can't run through batches, and a batch request is
single-shot, so this mode runs the agent loop in the worker, like the OpenAI engine, over
the plain Messages API: every model turn is submitted as a one-request batch, polled until
it ends, and its `tool_use` blocks run locally against the same in-memory sandbox and
browser tools (`runTool` from `openai/orchestrator.ts`).

```
service worker                         Anthropic batch queue
    ├─ getHistory (chrome.history), before any turn
    ├─ batches.create([turn 1]) ──────────▶ queued
    ├─ batches.retrieve … (5 s, 10 s, … 60 s) ─▶ ended
    ├─ batches.results → tool_use getPageHtml
    ├─ tabs + scripting → sandbox
    ├─ batches.create([turn 2: history + tool_results]) ─▶ …
    ├─ … tool_use write /mnt/session/outputs/homepage.tsx
    └─ done: no further turn for a closing message
```

Each turn can wait minutes, so the loop spends as few turns as it can. The history digest
is read before the first turn and handed over in the kickoff, so no turn goes to
getHistory. The kickoff asks for wide turns with every independent tool call together.
The build ends as soon as the homepage file is written. The conversation is append-only,
with thinking blocks passed back verbatim. Requests carry `cache_control` with the
1-hour TTL, since turns can be more than five minutes apart, and `effort: "medium"`. The
checkpoint (`claudeBatchBuild`) holds the transcript, the sandbox and the batch in
flight. A worker killed mid-wait resumes by polling that same batch, and a cancelled
build cancels its queued batch. A turn that errors on the server side is submitted
again, at most twice. A request error, a refusal or an expired batch ends the build with
a plain message.

### OpenAI (`agent-core/openai/`)

The worker runs the agent loop itself: one streamed `POST /v1/responses` per turn with
the whole transcript in `input`, every tool executed locally, and a checkpoint of the
transcript plus the in-memory sandbox written to the KV store after each step. The
bearer token is either a Sign in with ChatGPT access token (the user's ChatGPT plan)
or an API key; the loop only ever sees a `TokenProvider`.

```
service worker                       OpenAI /v1/responses
    │                                        │
    ├─ POST (instructions, input, tools) ───▶│  store:false, stream:true
    │◀─ SSE … function_call getHistory ──────┤
    ├─ chrome.history → digest               │
    ├─ POST (input + function_call_output) ─▶│
    │◀─ SSE … function_call getPageHtml ─────┤
    ├─ tabs + scripting → sanitize → mount in Sandbox (/mnt/session/uploads/pages/*.html)
    ├─ POST (…) ────────────────────────────▶│
    │◀─ SSE … function_call grep / read ─────┤
    ├─ Sandbox.grep / read                   │
    ├─ POST (…) ────────────────────────────▶│
    │◀─ SSE … function_call write ───────────┤
    ├─ Sandbox.write(/mnt/session/outputs/homepage.tsx)
    ├─ POST (…) ────────────────────────────▶│
    │◀─ SSE … message, response.completed ───┤  (no tool calls → loop ends)
    └─ read deliverable from Sandbox, drop checkpoint
```

What the ChatGPT-plan route requires of each request, enforced in `openai/client.ts` and
`openai/orchestrator.ts` and covered by `harness/orchestrator.test.ts`: `store: false`,
`stream: true`, `input` as an array carrying the whole transcript (never
`previous_response_id`), instructions in `instructions` (no `system` message), none of the
unsupported fields (`temperature`, `max_output_tokens`, `background`, …). Tools are
delivered as one `type: "namespace"` tool wrapping the six function tools; if the route
answers 400 for that shape the orchestrator falls back to an `additional_tools` developer
item, then to flat function tools, and remembers what worked (`apiCompat`). The same
mechanism drops `include: ["reasoning.encrypted_content"]` or the `reasoning` parameter if
either is rejected. `response.failed` is handled mid-stream: the
`subscription_sharing_*` codes become readable errors.

#### Sign in with ChatGPT in an extension

The OSS flow (`developers.openai.com/siwc/token-sharing-open-source`) is a public OAuth
client with PKCE whose callback **must** be `http://127.0.0.1:<port>/auth/callback` (only
the port may vary; `localhost` is refused). An extension cannot listen on a TCP port, so
`apps/extension/lib/siwc-auth.ts` does this instead:

1. `beginSignIn()` persists the attempt (state, nonce, PKCE verifier, the exact redirect
   URI with a random dynamic port) in `chrome.storage.session`, then opens the
   authorization URL in a tab. First sign-in: `client_id=dynamic_agent_client` with
   `agent_name_hint` and a stable `ext_agent_host_id` (`urn:uuid:…`, generated once per
   install). Later sign-ins: the issued `oaiapp_…` client ID with `id_token_hint`.
2. `background.ts` registers `webNavigation.onBeforeNavigate` / `onCommitted` /
   `onErrorOccurred` (and `tabs.onUpdated` as a fallback) at the top level, filtered to
   `127.0.0.1` + `/auth/callback`. These fire even if the worker was unloaded while the
   user sat on the consent screen.
3. `handleCallbackNavigation()` claims the pending attempt, validates `state`, takes the
   `code` (and the issued `client_id` on registration), exchanges it at the token endpoint
   with the verifier, validates the ID token claims (issuer, audience, nonce, expiry), and
   saves the credential record. The auth tab is closed and the originating new tab refocused.
4. `createTokenProvider()` (`openai/siwc.ts`) hands the orchestrator an access token,
   refreshing it five minutes before expiry with the rotating refresh token, serialized so
   two refreshes never race. A 401 mid-build forces one refresh and retries the turn. An
   unusable refresh token clears the tokens (not the registration) and the UI drops back to
   the setup screen.

The same helpers power `harness/siwc-login.ts`, which does the flow the way the docs draw
it: a real `Bun.serve` loopback listener plus the system browser.

### Looks

`packages/agent-core/skins.ts` holds five looks. They work because the component contract
makes the model declare a fixed set of custom properties on `:root` (`--paper`, `--ink`,
`--accent`, `--font-masthead`, …), take every font and colour from them, and mark its
structure with `data-part` attributes (`masthead`, `lead`, `section`, `headline`, …). A look
is a stylesheet rooted at `html[data-skin="…"]`, which outranks the component's `:root`
declarations in light, system-dark and forced-dark alike, plus a few rules on parts. The
preview bootstrap injects it into the sandbox document and swaps it over `postMessage`, so
changing the look never re-bundles or rebuilds the page.

### Keeping the worker alive

An MV3 service worker is torn down after ~30s idle, and a build spends most of its
wall clock waiting on the model. Three things keep it alive or bring it back:

- **During a turn**, the in-flight session fetch plus a 20s self-ping
  (`runtime.getPlatformInfo`) reset the idle timer.
- **A 1-minute alarm heartbeat** calls `BuildManager.tick()`. If an
  `activeSessionId` (Claude) or an `activeBuild` checkpoint (OpenAI) is in storage, the
  worker reattaches: the Claude orchestrator replays the session's event log, the OpenAI
  one reloads the transcript and the sandbox; both re-answer any tool call left hanging,
  and finish.
- **The same heartbeat** drives scheduled rebuilds (`lib/auto-rebuild.ts`), so the
  first new tab of the day already shows a fresh homepage.

### Tabs are views

Each new tab connects on a port (`lib/protocol.ts`), receives a snapshot of the
build state and the credential state, then streams phase/text/log deltas. Every open
tab shows the same live run. Keys and tokens never cross the port: the page saves a key
to storage and asks the worker to re-evaluate, or asks it to sign in, sign out or list
models, and gets back only what it needs to render. A throttled snapshot is also
mirrored to storage so a tab opened while the worker is asleep paints instantly.

The finished component renders inside a Sandpack iframe
(`entrypoints/newtab/components/HomepagePreview.tsx`): it is model-written code, so
it runs sandboxed, not in the extension's own page. That iframe has neither
`allow-top-navigation` nor `allow-popups-to-escape-sandbox`, so every click on a link is
handed to the parent page over `postMessage`, which opens it from the extension context:
a new tab or this tab per the "Links open in" setting, a background tab for modified
clicks. A link opened from inside the sandbox would inherit its restrictions.

### Theme

`lib/theme.ts` keeps one preference, `system | dark | light`, in `chrome.storage.local`
and mirrored in `localStorage` so `theme-boot.ts` can apply it before React renders
(MV3 forbids inline scripts, hence a module imported first). It lands as `data-theme` on
`<html>`; `styles.css` resolves colour tokens from that attribute and from
`prefers-color-scheme`, and every component uses the tokens. The preview iframe is
cross-origin, so its bootstrap receives the preference baked in and over `postMessage`
on change, and sets the same `data-theme` on its own `<html>`; the component contract
asks the model to honour it.

### Interface language

`lib/i18n/` holds one catalog per language (`locales/<code>.ts`) and a small translator
with no DOM or React, so the page and the worker share it. English is the source and the
fallback per key; plurals go through `Intl.PluralRules`, numbers and dates through `Intl`.
The preference (`auto` or a code) is a setting like any other: the page's provider
(`entrypoints/newtab/i18n.tsx`) follows it live through `storage.onChanged`, sets
`<html lang>` and the tab title, and mirrors it to `localStorage` for the first paint, like
the theme. The worker translates only what it writes itself (missing credentials,
"cancelled", the failure notification); engine and API error details stay as sent.
Progress details come from `agent-core` in English for the logs, with a `PhaseInfo`
alongside (days, pages, batch wait) that the page words in its own language.
`wxt.config.ts` generates `_locales/<code>/messages.json` from each catalog's `manifest.*`
keys, so Chrome shows the extension's name in its own UI language. How to add a language:
[`lib/i18n/README.md`](./apps/extension/lib/i18n/README.md).

## Layout

```
packages/agent-core/      host-agnostic — imports no chrome.*, browser.*, or node:*
  engine.ts               runHomepageBuild: dispatch on the engine; merged storage keys
  claude/
    orchestrator.ts       the Managed Agents session: lifecycle, event loop, tool dispatch, cleanup
    setup.ts              ensureAgent / ensureEnvironment (created once, cached by ID), model choices
    batch-orchestrator.ts the Message Batches mode: local loop, one batch per turn, polling, checkpoint
  openai/
    orchestrator.ts       the local agent loop over Responses: tool dispatch, checkpoint, fallbacks
    client.ts             Responses client over fetch + SSE, model listing, SIWC error codes
    siwc.ts               OAuth: authorize URL, PKCE, callback parsing, code exchange, refresh, token provider
    sandbox.ts            in-memory files: mount (re-flowed HTML), grep, read, glob, write (outputs only)
    tools.ts              the six function tools and how they are delivered (namespace / additional_tools / flat)
  prompt.ts               instructions + per-build kickoff message (shared)
  schemas.ts              tool input schemas and defaults (shared)
  history-digest.ts       narrows raw history to fit a tool result; subreddit-level site keys
  site-filter.ts          the editable block list and the always-on private-host rules
  types.ts                BrowserBridge, KVStore, RunPhase, CommonRunOptions, …

apps/extension/           MV3 extension (WXT + React)
  entrypoints/
    background.ts         service worker: hosts BuildManager, alarm heartbeat, OAuth callback listeners
    scraper.content.ts    injected into scraped tabs: scroll, return HTML
    newtab/               the new-tab UI (thin client onto the worker); i18n.tsx: the language as React context
  lib/
    build-manager.ts      single-flight build host, engine switch, broadcast, keepalive, resume, credentials front door
    openai-auth.ts        the OpenAI engine's credentials: ChatGPT plan (siwc-auth) or API key
    siwc-auth.ts          the extension side of Sign in with ChatGPT (storage, tab, callback capture)
    browser-bridge.ts     BrowserBridge over chrome.history / chrome.tabs
    history.ts            getHistory: group and rank chrome.history by site
    scraper.ts            getPageHtml: load URLs in a background window, sanitize HTML
    protocol.ts           page ↔ worker messages, credential state, the five UI build steps
    auto-rebuild.ts       when to rebuild on a schedule
    storage.ts            every chrome.storage key, settings, saved homepage, model catalog
    i18n/                 interface translations: locales/<code>.ts catalogs, the translator, audit.ts for the checks
    transpile.ts          TSX → JS for the preview

harness/                  Bun scripts: drive agent-core with a fixture/fetch bridge, test the extension
  siwc-login.ts           sign in with ChatGPT from the terminal with a real loopback listener
  fake-openai.ts          scripted stand-in for /responses, /models and the token endpoint, for tests
  claude-batch.test.ts    the Message Batches loop against a scripted stand-in for client.messages.batches
  i18n-check.ts           pnpm i18n:check: coverage per language, missing messages ready to paste
```

## Verification

| Command | Proves |
|---|---|
| `pnpm test` | The history digest is capped, ranked, drops `urls[]`, reports `totalSitesSeen`; the site filter through both engines' tool dispatch; the OpenAI loop against a scripted fake API (tool dispatch, sandbox grep/read/glob/write, checkpoint + resume with an orphaned call, 401 → refresh → retry, 400 → tool-delivery fallback, mid-stream `response.failed`); the Claude Message Batches loop against a scripted batches API (one request per batch, history read up front, stop on write, polling, resume of the batch in flight, cancel, resubmit, request errors, refusal, expiry); the SIWC request/callback/token contract; every catalog against English (placeholders, tags, plural categories, Chrome's name and description limits, French typography), French complete, language resolution, plurals, fallback |
| `pnpm i18n:check` | Coverage per language; lists missing messages with their English text; exits 1 on a placeholder, tag or plural mistake |
| `pnpm agent:login` | A real Sign in with ChatGPT: registration, PKCE, code exchange, granted scopes |
| `pnpm agent:models` | `GET /models` with the OpenAI credentials: what they offer |
| `pnpm agent:run` | Full build against the real API with either engine: tools, sandbox, deliverable, cleanup |
| `pnpm agent:verify` | The deliverable transforms, evaluates and server-renders |
| `pnpm agent:resume-test` | (Claude) A build killed with a tool call pending can be reattached and finished |
| `pnpm agent:retention <sessionId>` | (Claude) The session and every uploaded page body are actually deleted |
| `pnpm extension:test` | In headless Chrome: worker registers, new tab renders the setup screen, port protocol answers (snapshot + credential state), `chrome.history` reads, theme, looks, link target, the ChatGPT usage-limit banner, a Message Batches build end to end in the worker with the batch endpoints stubbed, and the interface language (generated `_locales`, live switch, reload, the worker's own messages, `auto` under an emulated fr-CA browser). Chrome runs with `--accept-lang=en-US` so the checks read the same on any machine. It prefers a Chrome for Testing build from the Playwright or Puppeteer cache: headless Chrome 156 stable on macOS quits after about 31 s |

The `agent:*` commands need credentials in `.env` (or a `pnpm agent:login`) and spend
API credits or plan usage. The harness's bridge uses fixture history and a plain
`fetch`, so it can't see logged-in pages — that's the whole reason `getPageHtml` runs
in your browser.

## Gotchas worth knowing

**`mount_path` is always re-rooted under `/mnt/session/uploads/`.** A leading `/` is
stripped, not honored — both at session-create time and via `resources.add()`:

| requested | resolved |
|---|---|
| `/workspace/pages/x.html` | `/mnt/session/uploads/workspace/pages/x.html` |
| `/mnt/session/uploads/x.html` | `/mnt/session/uploads/x.html` |
| *(omitted)* | `/mnt/session/uploads/<file_id>` |

Always report `resource.mount_path` from the response back to the model, never the
path you asked for, or it greps a file that isn't there.

**The result event field is `custom_tool_use_id`**, not `tool_use_id`. (`tool_use_id`
belongs to `user.tool_confirmation` and `user.tool_result`.)

**Never leave an `agent.custom_tool_use` unanswered.** Every path out of the handler
must send a result — a thrown error becomes a result with `is_error: true`, never a
reason to skip the send. An unanswered tool call idles the session forever.

**Don't break on `session.status_idle` alone.** The session idles every time it waits
for a tool result. Break only on `status_terminated`, or on `status_idle` where
`stop_reason.type !== "requires_action"`. And run the terminal check for *every* event,
including deduped ones — `continue`-ing on a duplicate can skip the terminal event that
arrived in the history fetch.

**`event_start` / `event_delta` stream events carry no `id`.** Skip them before dedupe.

**`files.upload()` takes no `purpose`.** Just `{ file }`.

**OpenAI: only the issued `client_id` works for token exchange.** `dynamic_agent_client` is
the registration entrypoint; the callback's `client_id` (`oaiapp_…`) is what you save and
send to the token endpoint and on every later sign-in. The redirect URI must match byte
for byte between the authorization request and the code exchange, port included.

**OpenAI: don't read output items only off `response.completed`.** A proxying route can
send a slim response object there; the client rebuilds items from `output_item.done`
events and uses the completed object as a cross-check.

**OpenAI: reasoning items without `encrypted_content` cannot be replayed.** With
`store: false` the transcript is resent each turn; a bare reasoning item is dropped rather
than echoed. And every `function_call` must get a `function_call_output`: a tool failure
becomes `{"error": "…"}`, never a skipped item.

**Refresh tokens rotate.** Use the latest one, store it together with the new access
token, and serialize refreshes (`createTokenProvider` does).

## Privacy

The editable blocked-sites list is enforced in agent-core's tool handlers, not
just the prompt: blocked domains are excluded from history digests and their
counts, and blocked or non-HTTP(S) page requests never reach the browser bridge.
Each scraped page's final URL is checked again before upload, so a redirect onto
a blocked host is dropped: the browser still loads it, but nothing it read is
sent. Loopback, private-IP and local-network hosts are always blocked, whatever
the list says. A name can still resolve to a private address (`fritz.box`, an
intranet name), so the scraper also records the address each page was served
from (`webRequest`, observe only) and the page is dropped before upload when it is
private. That address is only reported when the extension's own API requests
connect to a public address; behind a proxy at a private address, or when Chrome
reports no address, the name check is all there is. History digests still list
such a domain. Subresource loads are not intercepted.

With the Claude engine, the session event log persists every domain, title and scraped
page body server-side until deleted, and uploaded files persist independently. The
orchestrator deletes both in a `finally`. Confirm retention/ZDR eligibility against
current docs before distributing this.

With the OpenAI engine, what leaves the machine is the history digest, the tool results
the model asks for (grep matches and read ranges, not whole pages unless the model reads
them whole), and the model's own output, all inside Responses requests sent with
`store: false`. Nothing is uploaded as a file and no conversation is stored by the API
between turns; the only copy of a build in progress is the checkpoint in
`chrome.storage.local`, deleted when the build ends. OpenAI's own retention and
abuse-monitoring policies still apply to requests in flight.

The API keys and ChatGPT tokens live in `chrome.storage.local`, readable by anyone with
access to the browser profile. Fine for a tool you run yourself; **do not ship this to
the Web Store** without moving the credentials behind a proxy — and ChatGPT plan usage
is only offered to open-source, locally run apps in any case.
