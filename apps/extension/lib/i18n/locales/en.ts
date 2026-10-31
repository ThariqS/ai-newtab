/**
 * English: the source catalog. Every key the interface uses is defined here,
 * and every other language falls back to these texts for the keys it leaves
 * out. Add new strings here first; see ../README.md.
 */
import type { Message } from "..";

export default {
  // ---- extension ------------------------------------------------------------
  // chrome://extensions and the Web Store. At most 45 and 132 characters.
  "manifest.name": "AI Homepage",
  "manifest.description": "A new-tab page an agent rebuilds daily from what you've actually been browsing.",
  "app.title": "Your Homepage",
  "app.loading": "Loading…",

  // ---- shared ---------------------------------------------------------------
  "common.cancel": "Cancel",
  "common.dismiss": "Dismiss",
  "common.close": "Close",
  "common.signOut": "Sign out",
  "common.settings": "Settings",

  // ---- first screen: choose and connect an engine ----------------------------
  "setup.title": "Choose who writes your homepage",
  "setup.intro": "Each build is one agent run. Pick the engine, then connect it. You can switch later in Settings.",
  "setup.claude.hint": "Anthropic API key, billed per build",
  "setup.openai.hint": "Your ChatGPT plan, or an API key",
  "setup.openai.plan": "Use my ChatGPT plan (Sign in with ChatGPT)",
  "setup.openai.apiKey": "Use an OpenAI API key",

  "apiKey.anthropic.title": "Connect your Anthropic API key",
  "apiKey.anthropic.body":
    "The agent runs inside this extension and talks to the Anthropic API directly. Your key is stored in <code>chrome.storage.local</code> on this machine and is never sent anywhere else. Keys come from console.anthropic.com.",
  "apiKey.openai.title": "Connect your OpenAI API key",
  "apiKey.openai.body":
    "The agent runs inside this extension and talks to the OpenAI API directly. Your key is stored in <code>chrome.storage.local</code> on this machine and is never sent anywhere else. Keys come from platform.openai.com.",
  "apiKey.save": "Save key",

  "signIn.title": "Sign in with ChatGPT",
  "signIn.body":
    "The agent runs inside this extension and talks to the OpenAI API with your ChatGPT plan (Plus or Pro), through Sign in with ChatGPT. No API key is needed. Your tokens are stored in <code>chrome.storage.local</code> on this machine and are never sent anywhere else.",
  "signIn.howItWorks":
    "A ChatGPT tab opens to sign in and approve this app. When it redirects back, this page picks the sign-in up automatically and the tab closes itself.",
  "signIn.waiting": "Waiting for ChatGPT… finish signing in in the tab that opened.",
  "signIn.continue": "Continue with ChatGPT",
  "signIn.otherAccount": "Use a different ChatGPT account",
  "signIn.otherAccountTitle": "Register this app with a different ChatGPT account or workspace",

  "planUsage.title": "Allow ChatGPT plan usage",
  "planUsage.body":
    "You are signed in, but this app was not allowed to use your ChatGPT plan for requests. Building a homepage needs that permission.",
  "planUsage.bodyAs":
    "You are signed in as {email}, but this app was not allowed to use your ChatGPT plan for requests. Building a homepage needs that permission.",
  "planUsage.waiting": "Waiting for ChatGPT…",
  "planUsage.enable": "Enable ChatGPT plan usage",

  // ---- no homepage yet --------------------------------------------------------
  "home.title": "Build your homepage",
  "home.intro":
    "The agent reads your browsing history, opens the pages you actually follow, and writes a homepage from what it finds today.",
  "home.build": "Build today's homepage",
  "home.resume": "Resume interrupted build",

  // ---- buttons over the homepage ----------------------------------------------
  "toolbar.building": "Building… {step}/{total}",
  "toolbar.viewProgress": "View build progress",
  "toolbar.rebuild": "Rebuild",
  "toolbar.rebuildNow": "Rebuild now",
  "toolbar.customize": "Customize homepage",

  // ---- build progress ---------------------------------------------------------
  "progress.title": "Building your homepage",
  "progress.step.prepare": "Preparing agent",
  "progress.step.history": "Reading your history",
  "progress.step.pages": "Opening pages in your browser",
  "progress.step.analyze": "Analyzing pages",
  "progress.step.write": "Writing your homepage",
  "progress.back": "Back to homepage",
  "progress.agent": "Agent",
  "progress.warmingUp": "Warming up — reading what you’ve been browsing…",
  "progress.log": "Activity log",
  "progress.days": { one: "the last day", other: "the last {count} days" },
  "progress.pages": { one: "{count} page", other: "{count} pages" },
  "progress.batchSubmitting": "submitting to the batch queue",
  "progress.batchWaiting": "waiting in the batch queue · {duration}",
  "duration.seconds": "{count} s",
  "duration.minutes": "{count} min",
  "duration.hours": "{hours} h {minutes} min",

  // ---- failures ---------------------------------------------------------------
  // The details after "Build failed." come from the engine or the API and stay as they are sent.
  "error.buildFailed": "Build failed.",
  "error.retry": "Retry",
  "error.activityLog": { one: "Activity log ({count} line)", other: "Activity log ({count} lines)" },
  "error.noAnthropicKey": "No Anthropic API key found. Add your key and try again.",
  "error.noOpenAIKey": "No OpenAI API key found. Add your key and try again.",
  "error.notSignedIn": "Not signed in with ChatGPT, or ChatGPT plan usage was not granted. Sign in and try again.",
  "error.cancelled": "Build cancelled.",
  "error.notificationTitle": "Homepage build failed",

  // ---- ChatGPT usage limit ----------------------------------------------------
  "notice.title": "ChatGPT usage limit reached",
  "notice.titleAt": "ChatGPT usage limit reached at {time}",
  "notice.titleOn": "ChatGPT usage limit reached on {date}",
  "notice.banner": "This is your last homepage; the next one will be built once your plan's allowance for apps resets.",
  "notice.panel":
    "Your ChatGPT plan's allowance for apps like this one is used up for now, so no homepage was built. Nothing is broken: the allowance resets on its own. Check when on ChatGPT, or build with an API key in the meantime.",
  "notice.panelFooter":
    "An API key is billed per build to your OpenAI API account. You can switch back to your ChatGPT plan in Settings.",
  "notice.seeUsage": "See usage on ChatGPT",
  "notice.buildWithKey": "Build with my OpenAI API key",
  "notice.useKey": "Use an OpenAI API key",
  "notice.tryAgain": "Try again",

  // ---- settings ---------------------------------------------------------------
  "settings.title": "Customize your homepage",
  "settings.instructions.label": "Standing instructions",
  "settings.instructions.help": "The agent follows them on every build.",
  "settings.instructions.placeholder":
    "e.g. 'Focus on tech news and Rust releases', 'Always surface unread GitHub PRs first'",
  "settings.instructions.languageTip": "To get the homepage in a given language, say so here.",
  "settings.blocked.label": "Sites the agent never reads",
  "settings.blocked.help": "One per line. Subdomains are included. Use *.example.com for wildcards.",
  "settings.blocked.count": { one: "{count} site", other: "{count} sites" },
  "settings.discard": "Discard your unsaved changes?",
  "settings.applyNow": "These apply right away.",
  "settings.group.display": "Display",
  "settings.group.agent": "Agent",
  "settings.group.schedule": "Schedule",
  "settings.language.label": "Language",
  "settings.language.auto": "Same as the browser ({language})",
  "settings.look.label": "Look",
  "settings.look.agent": "As the agent built it",
  "settings.look.help": "The agent's own typography and colours. A look changes them instantly; the stories stay.",
  "settings.links.label": "Links open in",
  "settings.links.newTab": "a new tab",
  "settings.links.sameTab": "this tab",
  "settings.links.help": "Cmd/Ctrl-click and the middle button always open a background tab.",
  "settings.engine.label": "Engine",
  "settings.model.label": "Model",
  "settings.model.none": "No models listed",
  "settings.model.refresh": "Fetch the models these credentials offer",
  "settings.batch.label": "Message Batches: half price, slower",
  "settings.batch.on": "Each step waits in Anthropic's batch queue, usually a few minutes, at most 24 hours. The homepage appears when it is done.",
  "settings.batch.off": "Off: standard price, done in a few minutes.",
  "settings.key.anthropic": "Anthropic API key: <b>{status}</b>",
  "settings.key.openai": "OpenAI API key: <b>{status}</b>",
  "settings.key.saved": "saved",
  "settings.key.missing": "missing",
  "settings.key.change": "Change key",
  "settings.key.add": "Add key",
  "settings.openai.plan": "ChatGPT plan",
  "settings.openai.apiKey": "API key",
  "settings.chatgpt.account": "ChatGPT account: <b>{account}</b>",
  "settings.chatgpt.signedIn": "signed in",
  "settings.chatgpt.notSignedIn": "not signed in",
  "settings.chatgpt.noPlanUsage": "(plan usage not granted)",
  "settings.chatgpt.switch": "Switch account",
  "settings.chatgpt.switchTitle": "Sign out and forget this app's registration, so the next sign-in can use another account",
  "settings.chatgpt.usage": "Usage counts against your ChatGPT plan. Review it at <link>chatgpt.com/settings/usage</link>.",
  "settings.auto.label": "Rebuild automatically each morning",
  "settings.auto.help": "One edition in the background, the first time Chrome is open between 5am and noon. Uses your key or plan.",
  "settings.save": "Save & rebuild",

  "engine.claude": "Claude (Anthropic API key)",
  "engine.openai": "OpenAI (ChatGPT plan or API key)",

  // One per look in agent-core/skins.ts; the look names themselves are not translated.
  "look.metropolitan": "Blackletter masthead, serif headlines, black on white, a quiet blue for links.",
  "look.ledger": "Dense financial broadsheet: Didone small-caps masthead, hairline double rules, navy accent.",
  "look.capital": "Blackletter masthead over bold sans headlines and serif body, slate accent, strong rules.",
  "look.nationwide": "Bright all-sans look: blue masthead block, colour-coded sections, generous white space.",
  "look.boreal": "Cream paper, heavy old-style serif masthead, deep red accent, elegant serif throughout.",

  // ---- theme button -----------------------------------------------------------
  "theme.system": "Theme: follows the system",
  "theme.dark": "Theme: dark",
  "theme.light": "Theme: light",
  "theme.to.system": "follow the system",
  "theme.to.dark": "switch to dark",
  "theme.to.light": "switch to light",
  "theme.title": "{current} — click to {next}",
  "theme.label": "{current}. Click to {next}.",
} satisfies Record<string, Message>;
