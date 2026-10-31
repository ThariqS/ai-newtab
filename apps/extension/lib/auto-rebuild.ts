/**
 * Auto-rebuild policy, evaluated by the worker's alarm heartbeat: one morning
 * edition a day. The first heartbeat inside the morning window rebuilds
 * headlessly, so the next new tab already shows today's homepage.
 */

/** Local hours (inclusive start, exclusive end) when the morning edition may build. */
export const MORNING_START_HOUR = 5;
export const MORNING_END_HOUR = 12;

export interface AutoRebuildInput {
  enabled: boolean;
  hasApiKey: boolean;
  isRunning: boolean;
  /** ISO timestamp of the last successful build, if any. */
  lastBuildTimestamp?: string | null;
  /** ISO timestamp of the last auto-build attempt, if any. */
  lastAutoAttemptTimestamp?: string | null;
  now: Date;
}

/**
 * Conservative by design:
 * - Never fires before the first manual build, so nothing spends on the API
 *   before the user has engaged.
 * - Only fires in the morning window. A missed morning is skipped, not caught
 *   up later in the day; the user can always rebuild by hand.
 * - At most one attempt per morning: a build (manual or automatic) or a failed
 *   or cancelled attempt since this morning's window opened counts as today's.
 */
export function shouldAutoRebuild(input: AutoRebuildInput): boolean {
  const { enabled, hasApiKey, isRunning, lastBuildTimestamp, lastAutoAttemptTimestamp, now } = input;

  if (!enabled || !hasApiKey || isRunning || !lastBuildTimestamp) return false;

  const hour = now.getHours();
  if (hour < MORNING_START_HOUR || hour >= MORNING_END_HOUR) return false;

  const morningStart = new Date(now);
  morningStart.setHours(MORNING_START_HOUR, 0, 0, 0);
  const sinceMorningStart = (iso: string) => new Date(iso).getTime() >= morningStart.getTime();

  if (sinceMorningStart(lastBuildTimestamp)) return false;
  if (lastAutoAttemptTimestamp && sinceMorningStart(lastAutoAttemptTimestamp)) return false;
  return true;
}
