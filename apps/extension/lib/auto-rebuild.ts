/**
 * Auto-rebuild policy, evaluated by the worker's alarm heartbeat: once the
 * current homepage is older than the chosen interval, rebuild headlessly so the
 * next new tab already shows a fresh one.
 */

/** Interval choices offered in Settings, in hours. */
export const REBUILD_INTERVAL_CHOICES = [6, 12, 24, 48] as const;

export const DEFAULT_REBUILD_INTERVAL_HOURS = 12;

/** A stored/user value as ms, falling back to the default when unset or invalid. */
export function rebuildIntervalMs(hours?: number | null): number {
  const h = typeof hours === "number" && hours > 0 ? hours : DEFAULT_REBUILD_INTERVAL_HOURS;
  return h * 60 * 60 * 1000;
}

export interface AutoRebuildInput {
  enabled: boolean;
  hasApiKey: boolean;
  isRunning: boolean;
  /** ISO timestamp of the last successful build, if any. */
  lastBuildTimestamp?: string | null;
  /** ISO timestamp of the last auto-build attempt, if any. */
  lastAutoAttemptTimestamp?: string | null;
  intervalMs: number;
  now: Date;
}

/**
 * Conservative by design:
 * - Never fires before the first manual build, so nothing spends on the API
 *   before the user has engaged.
 * - Won't retry a failed or cancelled auto-build until another full interval
 *   has passed, so it can't loop. The user can always rebuild by hand.
 */
export function shouldAutoRebuild(input: AutoRebuildInput): boolean {
  const { enabled, hasApiKey, isRunning, lastBuildTimestamp, lastAutoAttemptTimestamp, intervalMs, now } =
    input;

  if (!enabled || !hasApiKey || isRunning || !lastBuildTimestamp) return false;

  const age = (iso: string) => now.getTime() - new Date(iso).getTime();
  if (age(lastBuildTimestamp) < intervalMs) return false;
  if (lastAutoAttemptTimestamp && age(lastAutoAttemptTimestamp) < intervalMs) return false;
  return true;
}
