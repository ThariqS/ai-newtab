/**
 * Sign in with ChatGPT from the terminal, the way the docs describe it: a real
 * HTTP loopback listener on 127.0.0.1, the system browser, PKCE, and a
 * form-encoded code exchange. Saves harness/.siwc-credentials.json (0600).
 *
 * Run: pnpm agent:login [--new-account] [--consent]
 *   --new-account  register a new client instead of reusing the saved one
 *   --consent      re-ask for the ChatGPT plan-usage permission (prompt=consent)
 */
import { spawn } from "node:child_process";
import {
  SIWC,
  callbackUri,
  createAuthorizationRequest,
  credentialsFromTokenResponse,
  exchangeCode,
  hasPlanUsage,
  parseCallback,
} from "@homepage/agent-core";
import { ensureHostId, loadRegistration, saveCredentials, saveRegistration } from "./siwc-credentials";

const newAccount = process.argv.includes("--new-account");
const promptConsent = process.argv.includes("--consent");
const TIMEOUT_MS = 5 * 60 * 1000;

const hostId = await ensureHostId();
const registration = newAccount ? undefined : await loadRegistration();

// Port 0 lets the OS pick a free one; the docs allow any port, only the path is fixed.
let resolveCallback!: (url: string) => void;
const callbackUrl = new Promise<string>((r) => (resolveCallback = r));
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== SIWC.callbackPath) return new Response("Not found", { status: 404 });
    resolveCallback(req.url);
    return new Response(
      "<!doctype html><meta charset=utf-8><title>AI Homepage</title><body style='font-family:system-ui;padding:40px'>" +
        "<h2>Signed in</h2><p>You can close this tab and return to the terminal.</p>",
      { headers: { "content-type": "text/html" } },
    );
  },
});
const redirectUri = callbackUri(server.port!);

const { url, pending } = await createAuthorizationRequest({
  clientId: registration?.clientId,
  hostId,
  redirectUri,
  idTokenHint: registration?.idToken ?? undefined,
  loginHint: registration?.email ?? undefined,
  promptConsent,
});

console.log(registration ? `Reauthorizing client ${registration.clientId}` : "Registering a new client (dynamic_agent_client)");
console.log(`Listening on ${redirectUri}`);
console.log(`\nIf the browser does not open, visit:\n${url}\n`);
spawn(process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open", [url], {
  stdio: "ignore",
  detached: true,
}).unref();

const received = await Promise.race([
  callbackUrl,
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for the callback")), TIMEOUT_MS)),
]).finally(() => setTimeout(() => server.stop(true), 500));

const { code, clientId } = parseCallback(received, pending);
const tokens = await exchangeCode({ code, clientId, codeVerifier: pending.codeVerifier, redirectUri });
const credentials = credentialsFromTokenResponse(tokens, { clientId, hostId, pending });

saveCredentials(credentials);
await saveRegistration({ clientId, email: credentials.email, subject: credentials.subject, idToken: credentials.idToken });

console.log(`\n✅ Signed in${credentials.email ? ` as ${credentials.email}` : ""}`);
console.log(`   client_id : ${clientId}`);
console.log(`   scopes    : ${credentials.scopes.join(" ")}`);
console.log(`   plan usage: ${hasPlanUsage(credentials) ? "granted" : "NOT granted — rerun with --consent"}`);
console.log(`   saved to  : harness/.siwc-credentials.json`);
process.exit(hasPlanUsage(credentials) ? 0 : 2);
