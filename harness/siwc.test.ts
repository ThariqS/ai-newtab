import { describe, expect, test } from "bun:test";
import {
  SIWC,
  SiwcError,
  applyRefresh,
  callbackUri,
  createAuthorizationRequest,
  createTokenProvider,
  credentialsFromTokenResponse,
  decodeJwt,
  isCallbackUrl,
  parseCallback,
  type SiwcCredentials,
} from "@homepage/agent-core";

function jwt(payload: object): string {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  return `${b64(JSON.stringify({ alg: "RS256" }))}.${b64(JSON.stringify(payload))}.sig`;
}

describe("authorization request", () => {
  test("first-time registration uses dynamic_agent_client, the agent name, PKCE and the loopback URI", async () => {
    const { url, pending } = await createAuthorizationRequest({ hostId: "urn:uuid:host", redirectUri: callbackUri(1455) });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(SIWC.authorizeUrl);
    const p = u.searchParams;
    expect(p.get("client_id")).toBe("dynamic_agent_client");
    expect(p.get("agent_name_hint")).toBe(SIWC.agentName);
    expect(p.get("ext_agent_host_id")).toBe("urn:uuid:host");
    expect(p.get("redirect_uri")).toBe("http://127.0.0.1:1455/auth/callback");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")).toBe("openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
    expect(p.get("resource")).toBe("https://api.openai.com/v1");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("state")).toBe(pending.state);
    expect(p.get("nonce")).toBe(pending.nonce);
    expect(p.has("id_token_hint")).toBe(false);
    expect(pending.isRegistration).toBe(true);
  });

  test("reauthorization reuses the issued client and hints, without agent_name_hint", async () => {
    const { url, pending } = await createAuthorizationRequest({
      clientId: "oaiapp_123",
      hostId: "urn:uuid:host",
      redirectUri: callbackUri(50000),
      idTokenHint: "idtok",
      loginHint: "user@example.com",
      promptConsent: true,
    });
    const p = new URL(url).searchParams;
    expect(p.get("client_id")).toBe("oaiapp_123");
    expect(p.has("agent_name_hint")).toBe(false);
    expect(p.get("id_token_hint")).toBe("idtok");
    expect(p.get("login_hint")).toBe("user@example.com");
    expect(p.get("prompt")).toBe("consent");
    expect(pending.isRegistration).toBe(false);
  });

  test("callback URLs are recognized by scheme, host and path only", () => {
    expect(isCallbackUrl("http://127.0.0.1:1455/auth/callback?code=x")).toBe(true);
    expect(isCallbackUrl("http://127.0.0.1:60000/auth/callback")).toBe(true);
    expect(isCallbackUrl("http://localhost:1455/auth/callback")).toBe(false);
    expect(isCallbackUrl("http://127.0.0.1:1455/callback")).toBe(false);
    expect(isCallbackUrl("https://127.0.0.1:1455/auth/callback")).toBe(false);
  });
});

describe("callback parsing", () => {
  const base = { redirectUri: callbackUri(1455), state: "S", nonce: "N", codeVerifier: "V", createdAt: "" };

  test("registration needs an issued client_id", () => {
    const pending = { ...base, clientId: "dynamic_agent_client", isRegistration: true };
    expect(parseCallback("http://127.0.0.1:1455/auth/callback?code=C&state=S&client_id=oaiapp_9", pending)).toEqual({ code: "C", clientId: "oaiapp_9" });
    expect(() => parseCallback("http://127.0.0.1:1455/auth/callback?code=C&state=S", pending)).toThrow(/issued client ID/);
    expect(() => parseCallback("http://127.0.0.1:1455/auth/callback?code=C&state=S&client_id=dynamic_agent_client", pending)).toThrow(/issued client ID/);
  });

  test("reauthorization keeps the pending client and rejects a different one", () => {
    const pending = { ...base, clientId: "oaiapp_1", isRegistration: false };
    expect(parseCallback("http://127.0.0.1:1455/auth/callback?code=C&state=S", pending)).toEqual({ code: "C", clientId: "oaiapp_1" });
    expect(() => parseCallback("http://127.0.0.1:1455/auth/callback?code=C&state=S&client_id=oaiapp_2", pending)).toThrow(/different client ID/);
  });

  test("state mismatch and OAuth errors stop the attempt", () => {
    const pending = { ...base, clientId: "oaiapp_1", isRegistration: false };
    expect(() => parseCallback("http://127.0.0.1:1455/auth/callback?code=C&state=OTHER", pending)).toThrow(SiwcError);
    try {
      parseCallback("http://127.0.0.1:1455/auth/callback?error=access_denied&state=S", pending);
    } catch (err) {
      expect((err as SiwcError).code).toBe("access_denied");
    }
  });
});

describe("credentials", () => {
  const pending = { clientId: "oaiapp_1", isRegistration: false, redirectUri: callbackUri(1), state: "S", nonce: "N", codeVerifier: "V", createdAt: "" };
  const now = new Date("2026-10-12T10:00:00Z");
  const idToken = jwt({ iss: SIWC.issuer, aud: "oaiapp_1", sub: "user_1", email: "u@example.com", nonce: "N", exp: Math.floor(now.getTime() / 1000) + 600 });

  test("validates the ID token claims and records scopes and expiry", () => {
    const creds = credentialsFromTokenResponse(
      { access_token: "at", refresh_token: "rt", id_token: idToken, token_type: "Bearer", expires_in: 3600, scope: "openid email chatgpt.tokens.use.direct" },
      { clientId: "oaiapp_1", hostId: "urn:uuid:h", pending, now },
    );
    expect(creds.subject).toBe("user_1");
    expect(creds.email).toBe("u@example.com");
    expect(creds.expiresAt).toBe("2026-10-12T11:00:00.000Z");
    expect(creds.scopes).toEqual(["openid", "email", "chatgpt.tokens.use.direct"]);
    expect(decodeJwt(idToken).sub).toBe("user_1");
  });

  test("rejects a wrong nonce or audience", () => {
    const bad = jwt({ iss: SIWC.issuer, aud: "oaiapp_1", sub: "user_1", nonce: "WRONG", exp: 9999999999 });
    expect(() =>
      credentialsFromTokenResponse({ access_token: "at", id_token: bad, token_type: "Bearer", expires_in: 1 }, { clientId: "oaiapp_1", hostId: "h", pending, now }),
    ).toThrow(/nonce/);
    const wrongAud = jwt({ iss: SIWC.issuer, aud: "oaiapp_2", sub: "user_1", nonce: "N", exp: 9999999999 });
    expect(() =>
      credentialsFromTokenResponse({ access_token: "at", id_token: wrongAud, token_type: "Bearer", expires_in: 1 }, { clientId: "oaiapp_1", hostId: "h", pending, now }),
    ).toThrow(/audience/);
  });

  test("token provider refreshes early, serializes concurrent refreshes and rotates the refresh token", async () => {
    let saved: SiwcCredentials = {
      email: null, issuer: SIWC.issuer, subject: "s", clientId: "oaiapp_1", hostId: "h", idToken: null,
      accessToken: "old", refreshToken: "rt_0", tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), // inside the 5-minute leeway
      scopes: ["chatgpt.tokens.use.direct"], savedAt: "",
    };
    let refreshCalls = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      refreshCalls++;
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("client_id")).toBe("oaiapp_1");
      expect(body.get("refresh_token")).toBe("rt_0");
      expect(body.get("resource")).toBe(SIWC.resource);
      expect(body.has("scope")).toBe(false);
      return Response.json({ access_token: "new", refresh_token: "rt_1", token_type: "Bearer", expires_in: 3600 });
    }) as unknown as typeof fetch;
    const provider = createTokenProvider({ load: async () => saved, persist: async (n) => void (saved = n), fetch: fetchImpl });

    const [a, b] = await Promise.all([provider.getAccessToken(), provider.getAccessToken()]);
    expect(a).toBe("new");
    expect(b).toBe("new");
    expect(refreshCalls).toBe(1);
    expect(saved.refreshToken).toBe("rt_1");
    expect(await provider.getAccessToken()).toBe("new"); // fresh now: no refresh
    expect(refreshCalls).toBe(1);
  });

  test("an unusable refresh token clears the sign-in", async () => {
    let invalidated = false;
    const creds: SiwcCredentials = {
      email: null, issuer: SIWC.issuer, subject: "s", clientId: "oaiapp_1", hostId: "h", idToken: null,
      accessToken: "old", refreshToken: "rt", tokenType: "Bearer", expiresAt: new Date(0).toISOString(), scopes: [], savedAt: "",
    };
    const provider = createTokenProvider({
      load: async () => creds,
      persist: async () => {},
      onInvalid: async () => void (invalidated = true),
      fetch: (async () => Response.json({ error: "refresh_token_expired" }, { status: 400 })) as unknown as typeof fetch,
    });
    await expect(provider.getAccessToken()).rejects.toThrow(/Sign in again/);
    expect(invalidated).toBe(true);
    expect(applyRefresh(creds, { access_token: "x", token_type: "Bearer", expires_in: 10 }).refreshToken).toBe("rt");
  });
});
