/**
 * The one unrecoverable failure mode, and the proof that reattach handles it.
 *
 * If the orchestrator dies while an `agent.custom_tool_use` is pending, the
 * session idles forever waiting for a result nobody is left to send. SSE has no
 * replay, so a naive reconnect never sees the pending call.
 *
 * Phase "crash": kick off a real build, answer getHistory, then hard-exit the
 * instant getPageHtml is requested — without answering. This is a tab close at
 * the worst possible moment.
 *
 * Phase "resume": reattach with runHomepageBuild({ resumeSessionId }). It must
 * replay history, notice the orphaned tool call, answer it, and finish the build.
 *
 * Run: pnpm agent:resume-test   (runs "crash" then "resume")
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  STORAGE_KEYS,
  buildHistoryDigest,
  buildKickoffMessage,
  ensureAgent,
  ensureEnvironment,
  runHomepageBuild,
} from "@homepage/agent-core";
import { FileKVStore, STATE_PATH, nodeBridge } from "./node-bridge";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const store = new FileKVStore(STATE_PATH);

async function crash(): Promise<never> {
  const [agentId, environmentId] = await Promise.all([
    ensureAgent(client, store),
    ensureEnvironment(client, store),
  ]);

  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    title: "resume-test",
  });
  await store.set(STORAGE_KEYS.activeSessionId, session.id);
  console.log(`[crash] session ${session.id}`);

  const stream = await client.beta.sessions.events.stream(session.id);
  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: buildKickoffMessage({ now: new Date() }) }],
      },
    ],
  });

  for await (const event of stream) {
    if (event.type === "event_start" || event.type === "event_delta") continue;

    if (event.type === "agent.custom_tool_use") {
      if (event.name === "getHistory") {
        console.log("[crash] answering getHistory");
        const { sites, totalSitesSeen } = await nodeBridge.getHistory({
          daysToAnalyze: 14,
          maxResults: 30,
        });
        const digest = buildHistoryDigest(sites, {
          daysToAnalyze: 14,
          maxResults: 30,
          totalSitesSeen,
        });
        await client.beta.sessions.events.send(session.id, {
          events: [
            {
              type: "user.custom_tool_result",
              custom_tool_use_id: event.id,
              content: [{ type: "text", text: JSON.stringify(digest) }],
            },
          ],
        });
      } else if (event.name === "getPageHtml") {
        console.log(`[crash] getPageHtml requested (${event.id}) — DYING WITHOUT ANSWERING`);
        console.log(`[crash] urls: ${JSON.stringify((event.input as any).urls)}`);
        process.exit(0);
      }
    }
  }
  throw new Error("[crash] stream ended before getPageHtml was requested");
}

async function resume() {
  const sessionId = await store.get<string>(STORAGE_KEYS.activeSessionId);
  if (!sessionId) throw new Error("no activeSessionId — crash phase did not run");
  console.log(`[resume] reattaching to ${sessionId}`);

  // The session should be idle, blocked on a tool call nobody answered.
  const before = await client.beta.sessions.retrieve(sessionId);
  console.log(`[resume] status before reattach: ${before.status}`);

  let reAnswered = false;
  const result = await runHomepageBuild({
    client,
    bridge: nodeBridge,
    store,
    resumeSessionId: sessionId,
    callbacks: {
      onLog: (line) => {
        if (line.includes("re-answering orphaned")) reAnswered = true;
        console.log(`  · ${line}`);
      },
      onPhase: (p, d) => console.log(`[${p}]${d ? " " + d : ""}`),
    },
  });

  console.log("\n========== RESUME RESULT ==========");
  console.log(`✅ session reattached and completed: ${result.sessionId}`);
  console.log(`${reAnswered ? "✅" : "❌"} orphaned tool call was re-answered`);
  console.log(`✅ deliverable recovered (${result.code.length}b, via ${result.source})`);

  const sameSession = result.sessionId === sessionId;
  console.log(`${sameSession ? "✅" : "❌"} resumed the same session (no restart)`);

  if (!reAnswered || !sameSession) process.exit(1);
}

const phase = process.argv[2];
if (phase === "crash") await crash();
else if (phase === "resume") await resume();
else throw new Error("usage: test-resume.ts crash|resume");
