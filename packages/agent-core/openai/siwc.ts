/**
 * Sign in with ChatGPT (SIWC) for open-source apps: the OAuth pieces that are
 * the same whatever the host. Pure functions over `fetch` and WebCrypto —
 * nothing here touches chrome.* or node:*, so the extension and the Bun harness
 * share one implementation and differ only in how they open the browser and
 * receive the loopback callback.
 *
 * Contract (developers.openai.com/siwc/token-sharing-open-source):
 * - First sign-in registers a client inline: `client_id=dynamic_agent_client`
 *   plus `agent_name_hint` and a stable `ext_agent_host_id`. The callback
 *   carries the issued `client_id` (`oaiapp_…`) to save and reuse.
 * - The callback must be an HTTP loopback on 127.0.0.1 at `/auth/callback`;
 *   only the port may vary, and `localhost` is not accepted.
 * - Tokens come from a form-encoded POST to the token endpoint with PKCE; no
 *   client secret. Refresh tokens rotate.
 */

export const SIWC = {
  authorizeUrl: "https://auth.openai.com/api/accounts/authorize",
  tokenUrl: "https://auth.openai.com/api/accounts/oauth/token",
  issuer: "https://auth.openai.com",
  openidConfigurationUrl: "https://auth.openai.com/.well-known/openid-configuration",
  /** The first-time registration entrypoint. Never saved, never used for token exchange. */
  dynamicClientId: "dynamic_agent_client",
  resource: "https://api.openai.com/v1",
  scopes: ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"],
  /** The scope that authorizes inference billed to the user's ChatGPT plan. */
  planUsageScope: "chatgpt.tokens.use.direct",
  callbackPath: "/auth/callback",
  /** Shown to the user when they name the agent; used consistently across installs. */
  agentName: "AI Homepage",
  usageUrl: "https://chatgpt.com/settings/usage",
} as const;

/** Build the loopback redirect URI for a port. Only the port may vary. */
export function callbackUri(port: number): string {
  return `http://127.0.0.1:${port}${SIWC.callbackPath}`;
}

/** Whether a URL is a callback for this app: exact scheme, host and path, any port. */
export function isCallbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && u.hostname === "127.0.0.1" && u.pathname === SIWC.callbackPath;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// crypto helpers
// ---------------------------------------------------------------------------

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(digest);
}

/** An opaque, stable per-host identifier in the `urn:uuid:` form the docs accept. */
export function newHostId(): string {
  return `urn:uuid:${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// authorization request
// ---------------------------------------------------------------------------

export interface AuthorizationRequestInput {
  /** Issued client ID for a returning account; omit for a first-time registration. */
  clientId?: string;
  hostId: string;
  redirectUri: string;
  /** Retained ID token from a previous sign-in; skips the account selector. */
  idTokenHint?: string;
  loginHint?: string;
  /** `prompt=consent` re-asks for the plan-usage scope after an earlier decline. */
  promptConsent?: boolean;
}

/** Everything that must survive until the callback arrives, and nothing more. */
export interface PendingAuthorization {
  clientId: string;
  isRegistration: boolean;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: string;
}

export async function createAuthorizationRequest(
  input: AuthorizationRequestInput,
): Promise<{ url: string; pending: PendingAuthorization }> {
  const isRegistration = !input.clientId;
  const clientId = input.clientId ?? SIWC.dynamicClientId;
  const state = randomToken(24);
  const nonce = randomToken(24);
  const codeVerifier = randomToken(48);

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  if (isRegistration) params.set("agent_name_hint", SIWC.agentName);
  params.set("ext_agent_host_id", input.hostId);
  if (!isRegistration && input.idTokenHint) params.set("id_token_hint", input.idTokenHint);
  if (!isRegistration && input.loginHint) params.set("login_hint", input.loginHint);
  params.set("response_type", "code");
  params.set("redirect_uri", input.redirectUri);
  params.set("scope", SIWC.scopes.join(" "));
  params.set("resource", SIWC.resource);
  params.set("state", state);
  params.set("nonce", nonce);
  params.set("code_challenge_method", "S256");
  params.set("code_challenge", await pkceChallenge(codeVerifier));
  if (input.promptConsent) params.set("prompt", "consent");

  return {
    url: `${SIWC.authorizeUrl}?${params.toString()}`,
    pending: {
      clientId,
      isRegistration,
      redirectUri: input.redirectUri,
      state,
      nonce,
      codeVerifier,
      createdAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// callback
// ---------------------------------------------------------------------------

export class SiwcError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SiwcError";
  }
}

export interface ParsedCallback {
  code: string;
  /** The client ID to exchange with: issued on registration, retained on reauthorization. */
  clientId: string;
}

/**
 * Validate the loopback callback against the pending attempt. Throws on an
 * OAuth error, a state mismatch, or a client ID that contradicts the attempt.
 */
export function parseCallback(url: string, pending: PendingAuthorization): ParsedCallback {
  const params = new URL(url).searchParams;
  const state = params.get("state");
  if (!state || state !== pending.state) {
    throw new SiwcError("Sign-in callback did not match the pending attempt (state).", "state_mismatch");
  }
  const error = params.get("error");
  if (error) {
    const description = params.get("error_description") ?? "";
    throw new SiwcError(
      error === "access_denied"
        ? "Sign-in was cancelled or ChatGPT plan usage was declined."
        : `Sign-in failed: ${error}${description ? ` (${description})` : ""}`,
      error,
    );
  }
  const code = params.get("code");
  if (!code) throw new SiwcError("Sign-in callback carried no authorization code.", "missing_code");

  const callbackClientId = params.get("client_id");
  if (pending.isRegistration) {
    if (!callbackClientId || callbackClientId === SIWC.dynamicClientId) {
      throw new SiwcError("Registration did not return an issued client ID; try signing in again.", "registration_incomplete");
    }
    return { code, clientId: callbackClientId };
  }
  if (callbackClientId && callbackClientId !== pending.clientId) {
    throw new SiwcError("Sign-in returned a different client ID than expected; refusing to replace the saved registration.", "client_id_mismatch");
  }
  return { code, clientId: pending.clientId };
}

// ---------------------------------------------------------------------------
// token endpoint
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  earliest_refresh_at?: string;
}

/** One saved sign-in: the issued client, the verified identity and its rotating tokens. */
export interface SiwcCredentials {
  email: string | null;
  issuer: string;
  subject: string;
  clientId: string;
  hostId: string;
  idToken: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  /** Absolute ISO timestamp the access token expires at. */
  expiresAt: string;
  scopes: string[];
  savedAt: string;
}

export function hasPlanUsage(credentials: Pick<SiwcCredentials, "scopes">): boolean {
  return credentials.scopes.includes(SIWC.planUsageScope);
}

async function postForm(
  url: string,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Non-JSON body: fall through to the status check with the raw text.
  }
  if (!res.ok) {
    const code = typeof json.error === "string" ? json.error : `http_${res.status}`;
    const description =
      typeof json.error_description === "string" ? json.error_description : text.slice(0, 200);
    throw new SiwcError(`Token endpoint returned ${res.status} ${code}: ${description}`, code, res.status);
  }
  if (typeof json.access_token !== "string") {
    throw new SiwcError("Token endpoint returned no access_token.", "malformed_token_response", res.status);
  }
  return json as unknown as TokenResponse;
}

export async function exchangeCode(
  args: { code: string; clientId: string; codeVerifier: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  return postForm(
    SIWC.tokenUrl,
    {
      grant_type: "authorization_code",
      client_id: args.clientId,
      code: args.code,
      code_verifier: args.codeVerifier,
      redirect_uri: args.redirectUri,
      resource: SIWC.resource,
    },
    fetchImpl,
  );
}

export async function refreshTokens(
  args: { clientId: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  // `scope` is deliberately omitted so the existing grant is retained.
  return postForm(
    SIWC.tokenUrl,
    {
      grant_type: "refresh_token",
      client_id: args.clientId,
      refresh_token: args.refreshToken,
      resource: SIWC.resource,
    },
    fetchImpl,
  );
}

/** Refresh-token error codes after which the saved tokens are unusable and a new sign-in is needed. */
const UNUSABLE_REFRESH_CODES = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

export function isUnusableRefreshToken(err: unknown): boolean {
  return err instanceof SiwcError && UNUSABLE_REFRESH_CODES.has(err.code);
}

/**
 * End the renewable session. The revocation endpoint is discovered from the
 * OpenID configuration; an empty 200 is success, including for an already
 * invalid token. Returns false when revocation could not be confirmed.
 */
export async function revokeRefreshToken(
  args: { clientId: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const config = (await (await fetchImpl(SIWC.openidConfigurationUrl)).json()) as {
      revocation_endpoint?: string;
    };
    if (!config.revocation_endpoint) return false;
    const res = await fetchImpl(config.revocation_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: args.refreshToken,
        token_type_hint: "refresh_token",
        client_id: args.clientId,
      }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// ID token
// ---------------------------------------------------------------------------

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nonce?: string;
  email?: string;
  [claim: string]: unknown;
}

export function decodeJwt(token: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length < 2) throw new SiwcError("Malformed JWT.", "malformed_jwt");
  try {
    return JSON.parse(base64urlDecode(parts[1])) as JwtClaims;
  } catch {
    throw new SiwcError("Malformed JWT payload.", "malformed_jwt");
  }
}

/**
 * Check the ID token's claims against this attempt. The token arrived straight
 * from the token endpoint over TLS, so issuer authenticity rests on that
 * connection (OIDC Core §3.1.3.7 step 6) and the signature is not re-verified
 * here; a host that wants JWKS verification can add it on top.
 */
export function validateIdTokenClaims(
  claims: JwtClaims,
  expected: { clientId: string; nonce: string; now?: Date },
): { subject: string; email: string | null } {
  if (claims.iss !== SIWC.issuer) throw new SiwcError(`Unexpected ID token issuer: ${String(claims.iss)}`, "invalid_id_token");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expected.clientId)) throw new SiwcError("ID token audience does not match the client ID.", "invalid_id_token");
  if (claims.nonce !== expected.nonce) throw new SiwcError("ID token nonce does not match this sign-in attempt.", "invalid_id_token");
  const nowSeconds = Math.floor((expected.now ?? new Date()).getTime() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < nowSeconds - 60) throw new SiwcError("ID token has expired.", "invalid_id_token");
  if (typeof claims.sub !== "string" || !claims.sub) throw new SiwcError("ID token has no subject.", "invalid_id_token");
  return { subject: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
}

// ---------------------------------------------------------------------------
// credentials
// ---------------------------------------------------------------------------

/** Build the saved record from a code-exchange response. */
export function credentialsFromTokenResponse(
  tokens: TokenResponse,
  ctx: { clientId: string; hostId: string; pending: PendingAuthorization; now?: Date },
): SiwcCredentials {
  const now = ctx.now ?? new Date();
  if (!tokens.id_token) throw new SiwcError("Token response carried no ID token.", "missing_id_token");
  const identity = validateIdTokenClaims(decodeJwt(tokens.id_token), {
    clientId: ctx.clientId,
    nonce: ctx.pending.nonce,
    now,
  });
  return {
    email: identity.email,
    issuer: SIWC.issuer,
    subject: identity.subject,
    clientId: ctx.clientId,
    hostId: ctx.hostId,
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    tokenType: tokens.token_type ?? "Bearer",
    expiresAt: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
    scopes: (tokens.scope ?? "").split(/\s+/).filter(Boolean),
    savedAt: now.toISOString(),
  };
}

/** Merge a refresh response into the saved record: new access token, rotated refresh token, scopes, expiry. */
export function applyRefresh(
  credentials: SiwcCredentials,
  tokens: TokenResponse,
  now: Date = new Date(),
): SiwcCredentials {
  return {
    ...credentials,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? credentials.refreshToken,
    idToken: tokens.id_token ?? credentials.idToken,
    tokenType: tokens.token_type ?? credentials.tokenType,
    expiresAt: new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
    scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : credentials.scopes,
    savedAt: now.toISOString(),
  };
}

/** Refresh ahead of expiry so an in-flight build never trips over a stale token. */
export const REFRESH_LEEWAY_MS = 5 * 60 * 1000;

export function isExpiringSoon(credentials: Pick<SiwcCredentials, "expiresAt">, now: Date = new Date()): boolean {
  return new Date(credentials.expiresAt).getTime() - now.getTime() < REFRESH_LEEWAY_MS;
}

/**
 * Hosts supply this to the orchestrator. `forceRefresh` is set after a 401 so
 * a token revoked server-side is replaced (or the sign-in is surfaced as gone).
 */
export interface TokenProvider {
  getAccessToken(opts?: { forceRefresh?: boolean }): Promise<string>;
}

/**
 * A TokenProvider over a credential record held by the host. Refreshes are
 * serialized so a rotating refresh token is never raced. `persist` receives
 * the new record after every successful refresh; `onInvalid` fires when the
 * refresh token is unusable and a fresh sign-in is required.
 */
export function createTokenProvider(opts: {
  load: () => Promise<SiwcCredentials | undefined>;
  persist: (next: SiwcCredentials) => Promise<void>;
  onInvalid?: (err: SiwcError) => Promise<void>;
  fetch?: typeof fetch;
  now?: () => Date;
}): TokenProvider {
  let inflight: Promise<string> | null = null;
  const now = opts.now ?? (() => new Date());

  async function refresh(current: SiwcCredentials): Promise<string> {
    if (!current.refreshToken) {
      throw new SiwcError("No refresh token saved; sign in again.", "refresh_token_missing");
    }
    try {
      const tokens = await refreshTokens(
        { clientId: current.clientId, refreshToken: current.refreshToken },
        opts.fetch ?? fetch,
      );
      const next = applyRefresh(current, tokens, now());
      await opts.persist(next);
      return next.accessToken;
    } catch (err) {
      if (isUnusableRefreshToken(err) || (err instanceof SiwcError && err.code === "invalid_client")) {
        await opts.onInvalid?.(err as SiwcError);
        throw new SiwcError("Your ChatGPT sign-in has expired or was revoked. Sign in again.", "reauth_required");
      }
      throw err;
    }
  }

  return {
    async getAccessToken({ forceRefresh = false } = {}) {
      const current = await opts.load();
      if (!current) throw new SiwcError("Not signed in with ChatGPT.", "not_signed_in");
      if (!forceRefresh && !isExpiringSoon(current, now())) return current.accessToken;
      inflight ??= refresh(current).finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}
