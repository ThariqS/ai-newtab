/**
 * Where the harness keeps its Sign in with ChatGPT state, and a TokenProvider
 * over it. Mirrors what lib/siwc-auth.ts does inside the extension, with a
 * 0600 JSON file standing in for chrome.storage.local.
 */
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTokenProvider,
  newHostId,
  type SiwcCredentials,
  type TokenProvider,
} from "@homepage/agent-core";
import { FileKVStore, STATE_PATH } from "./node-bridge";

export const CREDENTIALS_PATH = join(import.meta.dir, ".siwc-credentials.json");

/** Non-secret state: host ID and the issued client registration, in .agent-state.json. */
export const state = new FileKVStore(STATE_PATH);

export interface Registration {
  clientId: string;
  email: string | null;
  subject: string;
  idToken: string | null;
}

export function loadCredentials(): SiwcCredentials | undefined {
  if (!existsSync(CREDENTIALS_PATH)) return undefined;
  try {
    return JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8")) as SiwcCredentials;
  } catch {
    return undefined;
  }
}

/** Atomic write with owner-only permissions, as the docs ask. */
export function saveCredentials(credentials: SiwcCredentials): void {
  const tmp = `${CREDENTIALS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, CREDENTIALS_PATH);
}

export function clearCredentials(): void {
  if (existsSync(CREDENTIALS_PATH)) writeFileSync(CREDENTIALS_PATH, "{}", { mode: 0o600 });
}

export async function ensureHostId(): Promise<string> {
  const existing = await state.get<string>("siwcHostId");
  if (existing) return existing;
  const id = newHostId();
  await state.set("siwcHostId", id);
  return id;
}

export const loadRegistration = () => state.get<Registration>("siwcRegistration");
export const saveRegistration = (r: Registration) => state.set("siwcRegistration", r);

export function harnessTokenProvider(): TokenProvider {
  return createTokenProvider({
    load: async () => {
      const c = loadCredentials();
      return c?.accessToken ? c : undefined;
    },
    persist: async (next) => saveCredentials(next),
    onInvalid: async (err) => {
      clearCredentials();
      console.error(`[siwc] refresh token unusable (${err.code}); run: pnpm agent:login`);
    },
  });
}
