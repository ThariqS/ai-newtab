import { BuildManager } from "@/lib/build-manager";
import { AGENT_PORT } from "@/lib/protocol";
import { handleCallbackNavigation } from "@/lib/siwc-auth";

/**
 * The service worker is the build host. It owns the agent loop (BuildManager),
 * holds the OpenAI stream, runs the browser tools in-process, drives the
 * scheduled rebuild from an alarm, and completes the ChatGPT sign-in.
 *
 * New-tab pages are thin views that connect on AGENT_PORT. Closing every tab
 * doesn't stop a build: the worker keeps itself warm during an active turn, and
 * the alarm heartbeat resumes a checkpointed build after an unexpected kill.
 */
const HEARTBEAT_ALARM = "homepage-heartbeat";

export default defineBackground(() => {
  const manager = new BuildManager();

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === AGENT_PORT) manager.attach(port);
  });

  // ---- Sign in with ChatGPT: catch the loopback redirect -------------------
  // Both listeners are registered synchronously at the top level so they wake
  // the worker even if it was unloaded while the user was on the consent page.
  const onCallback = (url: string | undefined, tabId: number | undefined) => {
    if (!url || !url.startsWith("http://127.0.0.1")) return;
    void handleCallbackNavigation(url, tabId).then((handled) => {
      if (handled) void manager.broadcastAuth();
    });
  };
  // A client-side redirect fires onBeforeNavigate with the callback URL; a
  // server-side 302 only shows up in onCommitted / onErrorOccurred (the
  // connection to 127.0.0.1 is refused, since nothing listens). Listening to
  // all three covers both; the handler claims the attempt once.
  const callbackFilter = { url: [{ hostEquals: "127.0.0.1", pathEquals: "/auth/callback" }] };
  const onNavigation = (details: { frameId: number; url: string; tabId: number }) => {
    if (details.frameId === 0) onCallback(details.url, details.tabId);
  };
  browser.webNavigation.onBeforeNavigate.addListener(onNavigation, callbackFilter);
  browser.webNavigation.onCommitted.addListener(onNavigation, callbackFilter);
  browser.webNavigation.onErrorOccurred.addListener(onNavigation, callbackFilter);
  // Last resort: the tab's URL changes to the callback even when the load fails.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => onCallback(changeInfo.url, tabId));

  // ~1 min is the chrome.alarms floor — fine for a recovery net and the
  // scheduled rebuild check.
  browser.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEARTBEAT_ALARM) void manager.tick();
  });

  browser.runtime.onStartup.addListener(() => void manager.tick());
  browser.runtime.onInstalled.addListener(() => void manager.tick());

  // On every wake, resume an interrupted build (or consider a scheduled
  // rebuild) immediately rather than waiting for the first alarm.
  void manager.tick();
});
