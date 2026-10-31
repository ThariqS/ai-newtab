# Translations

The extension's screens are translated from one catalog per language in
[`locales/`](./locales). English ([`en.ts`](./locales/en.ts)) is the source: it
defines every message, and any message a language hasn't translated yet shows
in English. Settings → **Language** picks one, or follows the browser.

What is translated: every screen of the extension, the worker's own failure
messages and notification, the progress details, and the extension's name and
description in `chrome://extensions`. What is not: the homepage itself (the
agent writes it; ask for a language in your standing instructions), names
(Claude, ChatGPT, the looks), and error details sent by an API, which stay as
sent so they can be searched and reported.

## Add a language

1. Create `locales/<code>.ts`, where `<code>` is the language's tag: `de`, `es`,
   `pt-BR`. For Chrome to translate the extension's name too, it must be one of
   the locales Chrome supports (listed in the
   [`chrome.i18n` reference](https://developer.chrome.com/docs/extensions/reference/api/i18n)).

   ```ts
   import type { Translation } from "..";

   export default {
   } satisfies Translation;
   ```

2. Register it in [`locales/index.ts`](./locales/index.ts). `name` is the
   language's name in that language; it is how people find it in the picker.

   ```ts
   import de from "./de";
   // …
   { code: "de", name: "Deutsch", messages: de },
   ```

3. Run `pnpm i18n:check de`. It prints every message still missing with its
   English text, ready to paste between the braces. Translate the values; keep
   the keys, the `{placeholders}` and the `<tags>…</tags>`, and move them
   wherever your grammar needs them. [`fr.ts`](./locales/fr.ts) is a complete
   example.
4. Check it:

   ```bash
   pnpm i18n:check de   # coverage, and anything still missing
   pnpm typecheck       # catches misspelled keys and a plural given as a plain string
   pnpm test            # placeholders, tags and plural forms against English
   ```

A partial translation works: what is missing shows in English until someone
translates it.

## Message format

```ts
"toolbar.building": "Building… {step}/{total}",                         // placeholders
"settings.key.openai": "OpenAI API key: <b>{status}</b>",              // rich text: the page renders <b>, <code>, <link>
"progress.pages": { one: "{count} page", other: "{count} pages" },      // plural forms, picked on {count}
```

- **Plurals** use the [CLDR categories](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)
  your language has (`zero`, `one`, `two`, `few`, `many`, `other`); `other` is
  required and covers any category you leave out. In French `one` covers 0 and
  1; in Polish you would add `few` and `many`. `pnpm test` rejects a category
  your language doesn't use.
- **Numbers, dates and times** are formatted with `Intl` in the active
  language; pass them as parameters, don't spell them in the message.
- **Typography** is the language's own: the French catalog puts a non-breaking
  space before `:` `;` `!` `?` and inside « », and a test keeps it that way.
  Add a similar check to `harness/i18n.test.ts` if your language has rules
  worth guarding.
- **Limits:** `manifest.name` fits in 45 characters and `manifest.description`
  in 132 (Chrome's limits; the tests check them).

## For developers

- Add a new string to `en.ts` first, then use it: `const { t } = useI18n()` and
  `t("my.key", { count })` in the page, `rich("my.key", { b: (s) => <b>{s}</b> })`
  for a message with tags. Keys are typed, so a typo doesn't compile.
- In the service worker, `createTranslator(resolveLocale(preference))` gives the
  same `t` (see `build-manager.ts`); there is no React or DOM in `index.ts`.
- Other languages fall back to English for the new key until someone translates
  it; `pnpm i18n:check` lists what each language is missing.
- The engines in `agent-core` stay English (logs, the CLI). A progress detail the
  page shows also carries a `PhaseInfo` with its facts, which the page words in
  its own language.
- `_locales/<code>/messages.json` is generated at build time from each catalog's
  `manifest.*` keys (see `wxt.config.ts`); don't add it by hand.
