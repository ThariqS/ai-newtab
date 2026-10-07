/**
 * Proves the agent's deliverable is actually renderable, rather than merely
 * regex-shaped like React.
 *
 * Mirrors what the new-tab page does: transform TSX -> JS (sucrase, same as
 * apps/extension/lib/transpile.ts), then evaluate and server-render it. If this
 * passes, Sandpack will mount it.
 *
 * Run: pnpm agent:verify [path]   (default: the last pnpm agent:run output)
 */
import { readFileSync } from "node:fs";
import { transform } from "sucrase";
import React from "react";
import { renderToString } from "react-dom/server";
import { OUT_PATH } from "./node-bridge";

const path = process.argv[2] ?? OUT_PATH;
const source = readFileSync(path, "utf-8");

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

// ---- 1. transform ---------------------------------------------------------
let js: string;
try {
  js = transform(source, {
    transforms: ["typescript", "jsx", "imports"],
    jsxRuntime: "classic",
  }).code;
} catch (err) {
  fail(`sucrase failed to transform ${path}: ${err}`);
}
console.log(`✅ transforms (TSX -> JS, ${source.length}b -> ${js.length}b)`);

// ---- 2. evaluate in a CommonJS shim exposing only React -------------------
const module_ = { exports: {} as any };
const require_ = (name: string) => {
  if (name === "react") return React;
  fail(`component imported "${name}" — only "react" is allowed (it renders standalone)`);
};

try {
  new Function("require", "module", "exports", "React", js)(
    require_,
    module_,
    module_.exports,
    React,
  );
} catch (err) {
  fail(`component threw while evaluating: ${err}`);
}

const Component = module_.exports.default ?? module_.exports.PersonalizedHomepage;
if (typeof Component !== "function") {
  fail(`no default-exported component found (got ${typeof Component})`);
}
console.log(`✅ default export is a component (${Component.name || "anonymous"})`);

// ---- 3. render ------------------------------------------------------------
let html: string;
try {
  html = renderToString(React.createElement(Component));
} catch (err) {
  fail(`render threw: ${err}`);
}

if (html.trim().length < 500) fail(`rendered output suspiciously small (${html.length}b)`);
console.log(`✅ renders to ${html.length} bytes of HTML`);

// ---- 4. the deliverable actually contains real, linkable content ----------
const hrefs = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
const unique = new Set(hrefs);
if (unique.size < 5) fail(`only ${unique.size} distinct external links — expected real scraped URLs`);
console.log(`✅ ${unique.size} distinct external links`);

const placeholders = hrefs.filter((h) => /example\.com|placeholder|#$/.test(h));
if (placeholders.length) fail(`placeholder links present: ${placeholders.slice(0, 3).join(", ")}`);
console.log(`✅ no placeholder links`);

const domains = new Set([...unique].map((u) => new URL(u).hostname.replace(/^www\./, "")));
console.log(`\nLinked domains (${domains.size}):`);
for (const d of [...domains].sort().slice(0, 12)) console.log(`   ${d}`);

console.log(`\n\x1b[32mVERIFIED\x1b[0m — ${path} is a renderable homepage.`);
