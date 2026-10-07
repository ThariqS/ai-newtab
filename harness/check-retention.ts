/**
 * Privacy check: the session event log holds every domain, title and page body
 * we sent, and uploaded files persist independently. Confirm both are gone after
 * a build.
 *
 * Run: pnpm agent:retention [sessionId]   (sessionId is printed by pnpm agent:run)
 */
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const sessionId = process.argv[2];

let failures = 0;
const check = (label: string, pass: boolean) => {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) failures++;
};

if (sessionId) {
  let gone = false;
  try {
    const session = await client.beta.sessions.retrieve(sessionId);
    gone = session.status === "terminated";
    console.log(`   session ${sessionId} still retrievable, status=${session.status}`);
  } catch (err: any) {
    gone = err?.status === 404;
    if (!gone) console.log(`   unexpected error: ${err?.status} ${err?.message}`);
  }
  check(`session ${sessionId} deleted`, gone);
}

// Any file we uploaded for mounting is an HTML page body. None should survive.
const lingering: string[] = [];
for await (const file of client.beta.files.list()) {
  if (file.mime_type === "text/html" || /\.html$/.test(file.filename)) {
    lingering.push(`${file.id} ${file.filename} (${file.size_bytes}b)`);
  }
}
check(`no scraped page bodies left in the Files API`, lingering.length === 0);
if (lingering.length) {
  console.log("   lingering:");
  for (const l of lingering.slice(0, 10)) console.log(`     ${l}`);
}

process.exit(failures === 0 ? 0 : 1);
