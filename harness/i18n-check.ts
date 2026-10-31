/**
 * Translation coverage. `pnpm i18n:check` reports every language; `pnpm
 * i18n:check fr` only that one. Missing keys are listed with the English text
 * to translate, ready to paste into the catalog. Placeholder, tag and plural
 * mistakes exit 1; missing keys alone don't, since they fall back to English.
 */
import { LOCALES } from "../apps/extension/lib/i18n";
import { MESSAGE_KEYS, auditCatalog } from "../apps/extension/lib/i18n/audit";
import en from "../apps/extension/lib/i18n/locales/en";

const wanted = process.argv.slice(2);
const locales = wanted.length ? LOCALES.filter((locale) => wanted.includes(locale.code)) : LOCALES;
if (wanted.length && locales.length !== wanted.length) {
  console.error(`Unknown language code. Registered: ${LOCALES.map((l) => l.code).join(", ")} (apps/extension/lib/i18n/locales/index.ts).`);
  process.exit(1);
}

let mistakes = 0;
for (const locale of locales) {
  const audit = auditCatalog(locale);
  const done = MESSAGE_KEYS.length - audit.missing.length;
  const percent = Math.floor((done / MESSAGE_KEYS.length) * 100);
  console.log(`${locale.code.padEnd(6)} ${locale.name.padEnd(12)} ${String(percent).padStart(3)}%  ${done}/${MESSAGE_KEYS.length}`);

  for (const { key, expected, actual } of audit.mismatched) {
    console.log(`  ✗ ${key}: uses ${actual.join(" ") || "nothing"}, English uses ${expected.join(" ") || "nothing"}`);
  }
  for (const { key, problem } of audit.badPlurals) console.log(`  ✗ ${key}: ${problem}`);
  for (const key of audit.unknown) console.log(`  ✗ ${key}: not an English key (renamed or removed?)`);
  mistakes += audit.mismatched.length + audit.badPlurals.length + audit.unknown.length;

  if (audit.missing.length) {
    console.log(`  missing, shown in English until translated:`);
    for (const key of audit.missing) console.log(`    ${JSON.stringify(key)}: ${JSON.stringify(en[key])},`);
  }
}

if (mistakes) {
  console.error(`\n${mistakes} mistake(s) to fix.`);
  process.exit(1);
}
