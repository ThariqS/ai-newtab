import { BuildManager } from "@/lib/build-manager";
import { AGENT_PORT } from "@/lib/protocol";

/**
 * The service worker is the build host. It owns the agent loop (BuildManager),
 * holds the Anthropic session stream, runs the browser tools in-process, and
 * drives the scheduled rebuild from an alarm.
 *
 * New-tab pages are thin views that connect on AGENT_PORT. Closing every tab
 * doesn't stop a build: the worker keeps itself warm during an active turn, and
 * the alarm heartbeat reattaches to an interrupted session after an unexpected
 * kill.
 */
const HEARTBEAT_ALARM = "homepage-heartbeat";

export default defineBackground(() => {
  const manager = new BuildManager();

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === AGENT_PORT) manager.attach(port);
  });

  // ~1 min is the chrome.alarms floor — fine for a recovery net and the
  // scheduled rebuild check.
  browser.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEARTBEAT_ALARM) void manager.tick();
  });

  browser.runtime.onStartup.addListener(() => void manager.tick());
  browser.runtime.onInstalled.addListener(() => void manager.tick());

  // On every wake, reattach to an interrupted build (or consider a scheduled
  // rebuild) immediately rather than waiting for the first alarm.
  void manager.tick();
});
