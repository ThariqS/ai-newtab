/**
 * Sign in with ChatGPT inside the extension.
 *
 * The OAuth contract wants an HTTP loopback callback on 127.0.0.1. Nothing in
 * the extension can listen on a TCP port, so instead the authorization page is
 * opened in a tab and the redirect to `http://127.0.0.1:<port>/auth/callback`
 * is observed with `webNavigation.onBeforeNavigate` (which fires before the
 * doomed request is even sent) and, as a belt-and-braces fallback,
 * `tabs.onUpdated`. The code and state are read off that URL, the tab is
 * closed, and the code is exchanged from the service worker.
 *
 * The pending attempt (state, nonce, PKCE verifier) lives in
 * chrome.storage.session so it survives the worker being unloaded while the
 * user is on the consent screen, and dies with the browser.
 */
import {
  SIWC,
  SiwcError,
  callbackUri,
  createAuthorizationRequest,
  createTokenProvider,
  credentialsFromTokenResponse,
  exchangeCode,
  hasPlanUsage,
  isCallbackUrl,
  newHostId,
  parseCallback,
  revokeRefreshToken,
  type PendingAuthorization,
  type SiwcCredentials,
  type TokenProvider,
} from "@homepage/agent-core";
import type { AuthState } from "./protocol";

/** The Sign in with ChatGPT part of the credential state the page sees. */
export type SiwcState = Pick<AuthState["openai"], "signedIn" | "email" | "planUsage" | "pending" | "error">;

export const AUTH_KEYS = {
  /** The live token set for the signed-in account. */
  credentials: "siwcCredentials",
  /** Stable per-install host identifier, chosen before the first sign-in. */
  hostId: "siwcHostId",
  /** The issued client for this account; kept across sign-outs so re-sign-in reuses it. */
  registration: "siwcRegistration",
  /** Last sign-in error, shown on the sign-in screen until the next attempt. */
  lastError: "siwcLastError",
  /** Pending attempt (session storage). */
  pending: "siwcPendingAuth",
} as const;

export interface Registration {
  clientId: string;
  email: string | null;
  subject: string;
  /** Retained for `id_token_hint`; cleared on sign-out per the docs. */
  idToken: string | null;
}

interface PendingRecord {
  pending: PendingAuthorization;
  /** The tab the authorization page was opened in (closed on completion). */
  authTabId: number | null;
  /** The new-tab page that started the flow, to refocus when done. */
  originTabId: number | null;
  startedAt: string;
}

const local = () => browser.storage.local;
/** Session storage is MV3-only; fall back to local on browsers without it. */
const session = () => (browser.storage as { session?: typeof browser.storage.local }).session ?? browser.storage.local;

async function getOne<T>(area: typeof browser.storage.local, key: string): Promise<T | undefined> {
  const result = await area.get(key);
  return result[key] as T | undefined;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

export async function loadCredentials(): Promise<SiwcCredentials | undefined> {
  return getOne<SiwcCredentials>(local(), AUTH_KEYS.credentials);
}

export async function saveCredentials(credentials: SiwcCredentials): Promise<void> {
  await local().set({ [AUTH_KEYS.credentials]: credentials });
}

export async function loadRegistration(): Promise<Registration | undefined> {
  return getOne<Registration>(local(), AUTH_KEYS.registration);
}

async function ensureHostId(): Promise<string> {
  const existing = await getOne<string>(local(), AUTH_KEYS.hostId);
  if (existing) return existing;
  const id = newHostId();
  await local().set({ [AUTH_KEYS.hostId]: id });
  return id;
}

async function loadPending(): Promise<PendingRecord | undefined> {
  return getOne<PendingRecord>(session(), AUTH_KEYS.pending);
}

async function clearPending(): Promise<void> {
  await session().remove(AUTH_KEYS.pending);
}

export async function authState(): Promise<SiwcState> {
  const [credentials, pending, lastError] = await Promise.all([
    loadCredentials(),
    loadPending(),
    getOne<string>(local(), AUTH_KEYS.lastError),
  ]);
  return {
    signedIn: Boolean(credentials),
    email: credentials?.email ?? null,
    planUsage: credentials ? hasPlanUsage(credentials) : false,
    pending: Boolean(pending),
    error: lastError ?? null,
  };
}

export async function isSignedIn(): Promise<boolean> {
  return Boolean(await loadCredentials());
}

// ---------------------------------------------------------------------------
// token provider
// ---------------------------------------------------------------------------

/** Clear the token set but keep the registration, so the next sign-in reuses the issued client. */
async function dropTokens(): Promise<void> {
  const [credentials, registration] = await Promise.all([loadCredentials(), loadRegistration()]);
  if (credentials && registration) {
    await local().set({ [AUTH_KEYS.registration]: { ...registration, idToken: null } satisfies Registration });
  }
  await local().remove(AUTH_KEYS.credentials);
}

/** One provider per worker; refreshes are serialized inside it. */
export const tokenProvider: TokenProvider = createTokenProvider({
  load: loadCredentials,
  persist: saveCredentials,
  onInvalid: async (err) => {
    await dropTokens();
    await local().set({ [AUTH_KEYS.lastError]: `Your ChatGPT sign-in expired or was revoked (${err.code}). Sign in again.` });
  },
});

// ---------------------------------------------------------------------------
// sign-in flow
// ---------------------------------------------------------------------------

/** Loopback ports are chosen at random in the dynamic range; nothing listens, the navigation is only observed. */
function randomLoopbackPort(): number {
  return 49152 + Math.floor(Math.random() * (65535 - 49152));
}

export interface SignInOptions {
  /** Register a new client instead of reusing the saved one (switch ChatGPT account). */
  newAccount?: boolean;
  /** Re-ask consent so a previously declined plan-usage scope can be granted. */
  promptConsent?: boolean;
  /** The tab to refocus when the flow completes. */
  originTabId?: number | null;
}

/** Open the authorization page in a new tab and remember the attempt. */
export async function beginSignIn(opts: SignInOptions = {}): Promise<void> {
  await local().remove(AUTH_KEYS.lastError);
  const previous = await loadPending();
  if (previous?.authTabId != null) {
    await browser.tabs.remove(previous.authTabId).catch(() => {});
  }

  const hostId = await ensureHostId();
  const registration = opts.newAccount ? undefined : await loadRegistration();
  const redirectUri = callbackUri(randomLoopbackPort());
  const { url, pending } = await createAuthorizationRequest({
    clientId: registration?.clientId,
    hostId,
    redirectUri,
    idTokenHint: registration?.idToken ?? undefined,
    loginHint: registration?.email ?? undefined,
    promptConsent: opts.promptConsent,
  });

  // Persist before opening the tab: the callback can race a slow storage write otherwise.
  const record: PendingRecord = {
    pending,
    authTabId: null,
    originTabId: opts.originTabId ?? null,
    startedAt: new Date().toISOString(),
  };
  await session().set({ [AUTH_KEYS.pending]: record });
  const tab = await browser.tabs.create({ url, active: true });
  await session().set({ [AUTH_KEYS.pending]: { ...record, authTabId: tab.id ?? null } satisfies PendingRecord });
}

export async function cancelSignIn(): Promise<void> {
  const pending = await loadPending();
  if (pending?.authTabId != null) await browser.tabs.remove(pending.authTabId).catch(() => {});
  await clearPending();
}

/**
 * Called for every navigation to a 127.0.0.1 callback URL. Returns true when it
 * completed (or definitively failed) this extension's pending attempt, false
 * when the URL was none of our business.
 */
export async function handleCallbackNavigation(url: string, tabId: number | undefined): Promise<boolean> {
  if (!isCallbackUrl(url)) return false;
  const record = await loadPending();
  if (!record) return false;
  // Only the attempt's own port is ours: another local app may use the same path.
  if (new URL(url).origin !== new URL(record.pending.redirectUri).origin) return false;

  // Claim the attempt first so the fallback listener can't exchange the code twice.
  await clearPending();
  const closeTab = async () => {
    const id = tabId ?? record.authTabId ?? undefined;
    if (id != null) await browser.tabs.remove(id).catch(() => {});
  };

  try {
    const { code, clientId } = parseCallback(url, record.pending);
    const tokens = await exchangeCode({
      code,
      clientId,
      codeVerifier: record.pending.codeVerifier,
      redirectUri: record.pending.redirectUri,
    });
    const hostId = await ensureHostId();
    const credentials = credentialsFromTokenResponse(tokens, { clientId, hostId, pending: record.pending });

    const existing = await loadRegistration();
    if (existing && !record.pending.isRegistration && existing.subject !== credentials.subject) {
      throw new SiwcError(
        "This sign-in is for a different ChatGPT account than the saved one. Use “Switch account” to register it.",
        "account_mismatch",
      );
    }
    await local().set({
      [AUTH_KEYS.credentials]: credentials,
      [AUTH_KEYS.registration]: {
        clientId,
        email: credentials.email,
        subject: credentials.subject,
        idToken: credentials.idToken,
      } satisfies Registration,
    });
    await local().remove(AUTH_KEYS.lastError);
    if (!hasPlanUsage(credentials)) {
      await local().set({
        [AUTH_KEYS.lastError]:
          "Signed in, but ChatGPT plan usage was not granted. Enable it to build homepages with your subscription.",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await local().set({ [AUTH_KEYS.lastError]: message });
    console.warn("[siwc] sign-in failed", err);
  } finally {
    await closeTab();
    if (record.originTabId != null) {
      await browser.tabs.update(record.originTabId, { active: true }).catch(() => {});
    }
  }
  return true;
}

/** Revoke the renewable session when possible, then forget the tokens. The registration is kept. */
export async function signOut(): Promise<void> {
  const credentials = await loadCredentials();
  if (credentials?.refreshToken) {
    const revoked = await revokeRefreshToken({ clientId: credentials.clientId, refreshToken: credentials.refreshToken });
    if (!revoked) {
      await local().set({
        [AUTH_KEYS.lastError]:
          `Signed out locally, but ChatGPT did not confirm the revocation. You can also disconnect “${SIWC.agentName}” in ChatGPT settings.`,
      });
    } else {
      await local().remove(AUTH_KEYS.lastError);
    }
  }
  await dropTokens();
}

/** Forget everything, including the registration: the next sign-in registers a new client. */
export async function forgetAccount(): Promise<void> {
  await signOut();
  await local().remove([AUTH_KEYS.registration, AUTH_KEYS.lastError]);
}
