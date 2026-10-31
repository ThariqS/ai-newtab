import { describe, expect, test } from "bun:test";
import { shouldAutoRebuild, type AutoRebuildInput } from "../apps/extension/lib/auto-rebuild";

/** A local-time Date on 16 Oct 2026 (or another day) at the given hour. */
const at = (hour: number, minute = 0, day = 16) => new Date(2026, 9, day, hour, minute);

const input = (overrides: Partial<AutoRebuildInput>): AutoRebuildInput => ({
  enabled: true,
  hasApiKey: true,
  isRunning: false,
  lastBuildTimestamp: at(7, 0, 15).toISOString(),
  lastAutoAttemptTimestamp: at(7, 0, 15).toISOString(),
  now: at(7),
  ...overrides,
});

describe("shouldAutoRebuild", () => {
  test("builds the morning edition when the last build was yesterday", () => {
    expect(shouldAutoRebuild(input({}))).toBe(true);
  });

  test("never builds outside the morning window", () => {
    for (const hour of [0, 4, 12, 15, 18, 21, 23]) {
      expect(shouldAutoRebuild(input({ now: at(hour) }))).toBe(false);
    }
    expect(shouldAutoRebuild(input({ now: at(5) }))).toBe(true);
    expect(shouldAutoRebuild(input({ now: at(11, 59) }))).toBe(true);
  });

  test("builds only once per morning", () => {
    const builtAt6 = at(6).toISOString();
    expect(shouldAutoRebuild(input({ lastBuildTimestamp: builtAt6, lastAutoAttemptTimestamp: builtAt6, now: at(9) }))).toBe(false);
  });

  test("a failed attempt this morning is not retried until tomorrow", () => {
    const failedAt6 = at(6).toISOString();
    expect(shouldAutoRebuild(input({ lastAutoAttemptTimestamp: failedAt6, now: at(9) }))).toBe(false);
    expect(shouldAutoRebuild(input({ lastAutoAttemptTimestamp: failedAt6, now: at(6, 0, 17) }))).toBe(true);
  });

  test("a manual build late last night doesn't count as this morning's edition", () => {
    const builtAt1am = at(1).toISOString();
    expect(shouldAutoRebuild(input({ lastBuildTimestamp: builtAt1am, now: at(7) }))).toBe(true);
  });

  test("never fires before a first manual build, when off, without a key, or mid-build", () => {
    expect(shouldAutoRebuild(input({ lastBuildTimestamp: null }))).toBe(false);
    expect(shouldAutoRebuild(input({ enabled: false }))).toBe(false);
    expect(shouldAutoRebuild(input({ hasApiKey: false }))).toBe(false);
    expect(shouldAutoRebuild(input({ isRunning: true }))).toBe(false);
  });
});
