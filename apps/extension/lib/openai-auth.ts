/**
 * How the OpenAI engine authenticates: a ChatGPT plan through Sign in with
 * ChatGPT (lib/siwc-auth.ts) or a plain API key. Both end up as a
 * TokenProvider the orchestrator calls before every request.
 */
import { type TokenProvider } from "@homepage/agent-core";
import type { AuthState } from "./protocol";
import { authState as siwcState, loadCredentials, tokenProvider as siwcTokenProvider } from "./siwc-auth";
import type { Settings } from "./storage";

export type OpenAIAuthMode = Settings["openaiAuthMode"];

export async function openaiAuthState(settings: Settings): Promise<AuthState["openai"]> {
  const siwc = await siwcState();
  return {
    mode: settings.openaiAuthMode,
    apiKeySaved: Boolean(settings.openaiApiKey),
    ...siwc,
  };
}

/** Whether the OpenAI engine can build right now with the chosen auth mode. */
export async function openaiReady(settings: Settings): Promise<boolean> {
  if (settings.openaiAuthMode === "apiKey") return Boolean(settings.openaiApiKey);
  const credentials = await loadCredentials();
  return Boolean(credentials && credentials.scopes.includes("chatgpt.tokens.use.direct"));
}

export function openaiTokenProvider(settings: Settings): TokenProvider {
  if (settings.openaiAuthMode === "apiKey") {
    const key = settings.openaiApiKey;
    return {
      async getAccessToken() {
        if (!key) throw new Error("No OpenAI API key saved. Add your key in Settings.");
        return key;
      },
    };
  }
  return siwcTokenProvider;
}
