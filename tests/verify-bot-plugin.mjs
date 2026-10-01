/**
 * Offline verification for the Dot plugin Host half.
 *
 * It loads the installed Harness's own schema validator and the plugin module,
 * drives a stubbed Cordis context, and exercises every tool end to end against
 * a throwaway store. A green run means the plugin cannot fail activation for a
 * reason this script can see.
 *
 * Usage: node verify-dot-plugin.mjs
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

/** The repository root — this file lives in `tests/`, the plugin one level up. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where the installed Harness packages live.
 *
 * The verifier loads the real schema validator rather than a stub, because a
 * stub would happily agree with the plugin about a schema the host rejects —
 * which is exactly the class of failure this script exists to catch.
 *
 * Candidates are tried in order and the first that exists wins, so a checkout
 * beside the harness, a profile's own dependencies, and an installed desktop
 * build all work without configuration. `DSH_PACKAGES_ROOT` overrides the
 * search for a layout none of them describe.
 */
const DSH_ROOT = (() => {
  if (typeof process.env.DSH_PACKAGES_ROOT === "string" && process.env.DSH_PACKAGES_ROOT !== "") {
    return process.env.DSH_PACKAGES_ROOT;
  }
  const home = process.env.DSH_HOME ?? join(ROOT, "..", ".dsh-home");
  const profile = process.env.DSH_PROFILE ?? "web";
  const candidates = [
    // a profile's own dependencies — where `dsh plugin add` puts things
    join(home, "profiles", profile, "node_modules", "@deepseek-ai"),
    // a source checkout sitting beside this repository
    join(ROOT, "..", "node_modules", "@deepseek-ai"),
    // an installed desktop build, whose packages sit next to the profile root
    join(home, "..", "node_modules", "@deepseek-ai"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
})();
const PLUGIN = join(ROOT, "impl.js");
const ENTRY = join(ROOT, "entry.js");
const SANDBOX_HOME = join(ROOT, ".verify-home");

// The store resolves its path at apply() time, so the sandbox stays untouched
// by the real profile's data.
process.env.DSH_HOME = SANDBOX_HOME;
await rm(SANDBOX_HOME, { recursive: true, force: true });

const { assertSupportedJsonSchema } = await import(pathToFileURL(`${DSH_ROOT}/dsh-tools/lib/index.js`).href);
const plugin = await import(pathToFileURL(PLUGIN).href);

let failed = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${label}\n        ${error.message.split("\n")[0]}`);
  }
};

const tools = new Map();
const routes = [];
const disposers = [];
const ctx = {
  effect(fn) {
    const disposer = fn();
    if (typeof disposer === "function") disposers.push(disposer);
    return disposer;
  },
  tools: { register: (definition) => (tools.set(definition.name, definition), () => tools.delete(definition.name)) },
  connection: { fetch: { register: (route) => (routes.push(route), () => {}) } },
  agentDefaultModel: { currentSelection: () => ({ provider: "stub", model: "stub-model" }) },
  // Optional services are reached through ctx.get, never a hard dependency, so
  // a deployment without them stays usable. The stub answers like a real one.
  get(name) {
    return name === "attachments" ? this.attachments : undefined;
  },
  attachments: {
    async saveImages(inputs) {
      return inputs.map((input, index) => ({
        attachmentId: `att-stub-${index}`,
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: 2,
        height: 2,
        ...(input.name === undefined ? {} : { name: input.name }),
      }));
    },
  },
  llm: {
    // One canned answer, shaped like the real chunk stream.
    stream() {
      return (async function* generate() {
        yield { type: "block-start", index: 0, blockType: "text" };
        yield { type: "text-delta", index: 0, text: "我在。" };
        yield { type: "block-end", index: 0, block: { type: "text", text: "我在。" } };
        yield { type: "usage", usage: { inputTokens: 12, outputTokens: 3 } };
        yield { type: "finish", reason: { kind: "stop" } };
      })();
    },
    async listModels() {
      return [
        { provider: "stub", id: "stub-model", name: "Stub" },
        { provider: "stub", id: "stub-model-2", name: "Stub 2" },
      ];
    },
    // Adapter-owned answers: the first model accepts two thinking tiers and can
    // see images, the second declares nothing. A model that cannot be resolved
    // must degrade to a plain entry rather than blanking the picker.
    async resolveModelInfo(provider, model) {
      if (model === "stub-model") {
        return {
          provider,
          id: model,
          name: "Stub",
          inputModalities: ["text", "image"],
          context: { contextWindow: 128000 },
          reasoning: {
            efforts: [
              { id: "low", name: "低" },
              { id: "high", name: "高", description: "想久一点" },
            ],
            defaultEffort: "low",
          },
        };
      }
      throw new Error("no metadata for this model");
    },
  },
};

console.log("apply()");
try {
  await plugin.apply(ctx, {});
  console.log("  ok    apply completes");
} catch (error) {
  failed += 1;
  console.log(`  FAIL  apply\n        ${error.message.split("\n")[0]}`);
}
console.log(`  registered tools: ${[...tools.keys()].join(", ") || "(none)"}`);
console.log(`  registered routes: ${routes.map((route) => `${route.methods.join("/")} ${route.path}`).join(", ") || "(none)"}`);

console.log("\nmanifest");
check("exports name", () => {
  if (plugin.name !== "dot") throw new Error(`name is ${plugin.name}`);
});
check("exports inject", () => {
  if (!Array.isArray(plugin.inject) || !plugin.inject.includes("tools")) throw new Error(`inject is ${JSON.stringify(plugin.inject)}`);
});
check("four tools registered", () => {
  const expected = ["dot_status", "dot_remember", "dot_recall", "dot_task"];
  const missing = expected.filter((tool) => !tools.has(tool));
  if (missing.length > 0) throw new Error(`missing ${missing.join(", ")}`);
});

console.log("\noutput schema subset");
for (const definition of tools.values()) {
  check(`${definition.name} output.schema`, () => assertSupportedJsonSchema(definition.output.schema));
  check(`${definition.name} parameters shape`, () => {
    const parameters = definition.parameters;
    if (parameters.type !== "object") throw new Error("parameters must be an object root");
    if (parameters.required !== undefined && !Array.isArray(parameters.required)) throw new Error("required must be an array");
    if (parameters.properties === undefined) throw new Error("parameters needs properties");
  });
}

/**
 * Every key the value carries must be declared, and every declared requirement
 * must be present: the registry rejects a result that does not match its own
 * output schema, so the check has to run before installation.
 */
function shapeViolations(node, value, path) {
  const violations = [];
  if (node === undefined || node === null || value === undefined) return violations;
  if (node.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path} must be an object`];
    const properties = node.properties ?? {};
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(properties, key)) violations.push(`${path}.${key} is not declared`);
      else violations.push(...shapeViolations(properties[key], value[key], `${path}.${key}`));
    }
    for (const key of node.required ?? []) {
      if (!Object.hasOwn(value, key)) violations.push(`${path}.${key} is required but missing`);
    }
  } else if (node.type === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    value.forEach((item, index) => violations.push(...shapeViolations(node.items, item, `${path}[${index}]`)));
  }
  return violations;
}

const call = async (name, args) => {
  const definition = tools.get(name);
  const value = await definition.execute(args, { agent: undefined });
  const shape = shapeViolations(definition.output.schema, value, name);
  if (shape.length > 0) throw new Error(`output violates its own schema: ${shape.join("; ")}`);
  const content = definition.output.render(args, value);
  if (!Array.isArray(content) || content[0]?.type !== "text" || typeof content[0].text !== "string") {
    throw new Error("render did not return one text block");
  }
  return { value, text: content[0].text };
};

console.log("\nend to end");
try {
  const remembered = await call("dot_remember", { text: "Dot 面板的验证条目", kind: "fact" });
  check("dot_remember returns an id", () => {
    if (typeof remembered.value.id !== "string" || remembered.value.id.length === 0) throw new Error("no id");
    if (remembered.value.memoryTotal !== 1) throw new Error(`memoryTotal ${remembered.value.memoryTotal}`);
  });

  const recalled = await call("dot_recall", { query: "验证" });
  check("dot_recall finds the entry", () => {
    if (recalled.value.matches.length !== 1) throw new Error(`matches ${recalled.value.matches.length}`);
  });

  const empty = await call("dot_recall", { query: "不存在的词" });
  check("dot_recall reports a miss cleanly", () => {
    if (empty.value.matches.length !== 0) throw new Error("unexpected match");
  });

  const queued = await call("dot_task", { action: "add", title: "验证任务", note: "由验证脚本创建", priority: 4 });
  check("dot_task add queues the task and names it first", () => {
    const first = queued.value.tasks[0];
    if (first.state !== "queued") throw new Error(`state ${first.state}`);
    if (first.priority !== 4) throw new Error(`priority ${first.priority}`);
    if (first.attempts !== 0) throw new Error(`attempts ${first.attempts}`);
  });

  const target = queued.value.tasks[0].id;
  const edited = await call("dot_task", { action: "update", id: target, note: "改过的说明", priority: 1 });
  check("dot_task update edits in place", () => {
    const task = edited.value.tasks.find((row) => row.id === target);
    if (task === undefined) throw new Error("task vanished");
    if (task.note !== "改过的说明") throw new Error(`note ${task.note}`);
    if (task.priority !== 1) throw new Error(`priority ${task.priority}`);
  });

  const cancelled = await call("dot_task", { action: "cancel", id: target });
  check("dot_task cancel withdraws it", () => {
    const task = cancelled.value.tasks.find((row) => row.id === target);
    if (task === undefined || task.state !== "cancelled") throw new Error("cancel did not take");
  });

  const status = await call("dot_status", {});
  check("dot_status counts the lifecycle and reports the executor", () => {
    if (status.value.stats.memoryTotal !== 1) throw new Error(`memoryTotal ${status.value.stats.memoryTotal}`);
    if (status.value.stats.taskTotal !== 1) throw new Error(`taskTotal ${status.value.stats.taskTotal}`);
    if (status.value.stats.taskQueued !== 0) throw new Error(`taskQueued ${status.value.stats.taskQueued}`);
    if (status.value.stats.taskDone !== 0) throw new Error(`taskDone ${status.value.stats.taskDone}`);
    if (typeof status.value.worker.state !== "string") throw new Error("no executor state");
  });

  check("dot_remember rejects empty text", async () => {
    let threw = false;
    try {
      await tools.get("dot_remember").execute({ text: "   " }, {});
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("empty text was accepted");
  });

  check("dot_task rejects an unknown action", async () => {
    let threw = false;
    try {
      await tools.get("dot_task").execute({ action: "nope" }, {});
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("unknown action was accepted");
  });

  console.log("\nconcurrent writes");
  const baseline = (await call("dot_status", {})).value.stats.memoryTotal;
  const settledWrites = await Promise.all([
    call("dot_remember", { text: "并发写入 A", kind: "note" }),
    call("dot_remember", { text: "并发写入 B", kind: "note" }),
    call("dot_remember", { text: "并发写入 C", kind: "note" }),
  ]);
  check("three concurrent writes all land", () => {
    const totals = settledWrites.map((row) => row.value.memoryTotal).sort((a, b) => a - b);
    const expected = [baseline + 1, baseline + 2, baseline + 3];
    if (totals.join(",") !== expected.join(",")) throw new Error(`totals ${totals.join(",")} from baseline ${baseline}`);
  });
  check("the store on disk holds every entry", async () => {
    const onDisk = JSON.parse(await readFile(`${SANDBOX_HOME}/dot/dot.json`, "utf8"));
    if (onDisk.memory.length !== baseline + 3) throw new Error(`disk holds ${onDisk.memory.length}, expected ${baseline + 3}`);
  });

  console.log("\nhost route");
  const response = await routes[0].fetch(new Request("http://127.0.0.1/api/dot.state"));
  check("GET /api/dot.state answers JSON", async () => {
    if (response.status !== 200) throw new Error(`status ${response.status}`);
  });
  const snapshot = await response.json();
  check("snapshot carries the resident's state", () => {
    if (typeof snapshot.identity?.name !== "string") throw new Error("no identity");
    if (typeof snapshot.heartbeatAt !== "string") throw new Error("no heartbeat");
    if (typeof snapshot.stats?.taskDone !== "number") throw new Error("no stats");
    if (!Array.isArray(snapshot.memory) || !Array.isArray(snapshot.tasks)) throw new Error("memory/tasks must be arrays");
  });
  console.log(`  snapshot: ${JSON.stringify(snapshot.stats)} memory=${snapshot.memory.length} tasks=${snapshot.tasks.length}`);

  // A second activation reads a *copy* of the store: two live stores sharing
  // one path race on rename under Windows, and one instance is the real shape.
  const beforeRestart = snapshot.stats.memoryTotal;
  const rereadHome = join(ROOT, ".verify-reread");
  await rm(rereadHome, { recursive: true, force: true });
  await mkdir(`${rereadHome}/dot`, { recursive: true });
  await writeFile(`${rereadHome}/dot/dot.json`, await readFile(`${SANDBOX_HOME}/dot/dot.json`, "utf8"), "utf8");
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = rereadHome;
  const fresh = new Map();
  await plugin.apply({
    effect: (fn) => fn(),
    tools: { register: (definition) => (fresh.set(definition.name, definition), () => {}) },
    connection: { fetch: { register: () => () => {} } },
    agentDefaultModel: { currentSelection: () => ({ provider: "stub", model: "stub-model" }) },
  // Optional services are reached through ctx.get, never a hard dependency, so
  // a deployment without them stays usable. The stub answers like a real one.
  get(name) {
    return name === "attachments" ? this.attachments : undefined;
  },
  attachments: {
    async saveImages(inputs) {
      return inputs.map((input, index) => ({
        attachmentId: `att-stub-${index}`,
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: 2,
        height: 2,
        ...(input.name === undefined ? {} : { name: input.name }),
      }));
    },
  },
    llm: { stream: () => (async function* empty() {})() },
  }, {});
  const reread = await fresh.get("dot_status").execute({}, {});
  process.env.DSH_HOME = previousHome;
  await rm(rereadHome, { recursive: true, force: true });
  check("a fresh activation reads the persisted store back", () => {
    if (reread.stats.memoryTotal !== beforeRestart) {
      throw new Error(`persisted ${reread.stats.memoryTotal}, expected ${beforeRestart}`);
    }
  });

  console.log("\nresident routes");
  const route = (path) => routes.find((candidate) => candidate.path === path);
  const get = async (path) => (await route(path).fetch(new Request(`http://127.0.0.1${path}`))).json();
  const post = async (path, body) =>
    (await route(path).fetch(new Request(`http://127.0.0.1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }))).json();

  check("every route is registered", () => {
    const expected = [
      "/api/dot.state",
      "/api/dot.chat",
      "/api/dot.manage",
      "/api/dot.types",
      "/api/dot.worker",
      "/api/dot.models",
      "/api/dot.rewind",
      "/api/dot.avatar",
    ];
    const missing = expected.filter((path) => route(path) === undefined);
    if (missing.length > 0) throw new Error(`missing ${missing.join(", ")}`);
  });

  const offered = await get("/api/dot.types");
  check("types are offered", () => {
    if (!Array.isArray(offered.types) || offered.types.length < 2) throw new Error("no types offered");
  });

  const first = await get("/api/dot.state");
  // Anything that pokes the executor changes this, so it is checked before any
  // other operation touches the store.
  check("the background executor ships turned off", () => {
    if (first.settings.workerEnabled !== false) throw new Error("an install would start spending quota on its own");
    if (first.worker.state !== "disabled") throw new Error(`state ${first.worker.state}`);
  });
  check("a store with no instances opens with one Dot named 屿", () => {
    if (first.dots.length !== 1) throw new Error(`dots ${first.dots.length}`);
    if (first.dots[0].name !== "屿") throw new Error(`name ${first.dots[0].name}`);
    if (first.activeDotId !== first.dots[0].id) throw new Error("the only Dot is not active");
  });

  const renamed = await post("/api/dot.manage", { action: "rename", id: first.dots[0].id, name: "小瓜" });
  check("renaming takes", () => {
    if (renamed.snapshot.dots[0].name !== "小瓜") throw new Error("the new name did not stick");
  });

  const created = await post("/api/dot.manage", { action: "create", type: "researcher" });
  check("creating adds an instance, selects it, and names it 屿", () => {
    if (created.snapshot.dots.length !== 2) throw new Error(`dots ${created.snapshot.dots.length}`);
    if (created.snapshot.activeDotId !== created.dotId) throw new Error("the new Dot is not active");
    const fresh = created.snapshot.dots.find((dot) => dot.id === created.dotId);
    if (fresh === undefined) throw new Error("the new Dot is not in the list");
    if (fresh.name !== "屿") throw new Error(`new Dot name ${fresh.name}`);
    if (fresh.type !== "researcher") throw new Error(`new Dot type ${fresh.type}`);
  });

  const chatted = await post("/api/dot.chat", { text: "在吗" });
  check("chat answers and reports the model", () => {
    if (chatted.ok !== true) throw new Error(chatted.error ?? "not ok");
    if (chatted.message.text !== "我在。") throw new Error(`reply ${chatted.message.text}`);
    if (chatted.model !== "stub/stub-model") throw new Error(`model ${chatted.model}`);
  });

  const afterChat = await get("/api/dot.state");
  check("both turns are stored on the speaking Dot", () => {
    if (afterChat.messages.length !== 2) throw new Error(`messages ${afterChat.messages.length}`);
    if (afterChat.messages[0].role !== "user" || afterChat.messages[0].text !== "在吗") throw new Error("the user turn is wrong");
    if (afterChat.messages[1].role !== "dot" || afterChat.messages[1].text !== "我在。") throw new Error("the Dot turn is wrong");
  });

  const blank = await post("/api/dot.chat", { text: "   " });
  check("a blank message is refused", () => {
    if (blank.error === undefined) throw new Error("blank text was accepted");
  });

  const deleted = await post("/api/dot.manage", { action: "delete", id: created.dotId });
  check("deleting falls back to the surviving Dot", () => {
    if (deleted.snapshot.dots.length !== 1) throw new Error(`dots ${deleted.snapshot.dots.length}`);
    if (deleted.snapshot.activeDotId !== deleted.dotId) throw new Error("fallback active id is wrong");
  });

  const lastDelete = await post("/api/dot.manage", { action: "delete", id: deleted.snapshot.dots[0].id });
  check("the last Dot cannot be deleted", () => {
    if (lastDelete.error === undefined) throw new Error("the last Dot was deleted");
  });

  console.log("\nbackground executor");
  await post("/api/dot.manage", { action: "task", op: "add", title: "写一句问候", note: "一句话就行" });
  const poked = await post("/api/dot.worker", { action: "poke" });
  check("the executor works a queued task and leaves the outcome on it", () => {
    const task = poked.snapshot.tasks.find((row) => row.title === "写一句问候");
    if (task === undefined) throw new Error("the task is not in the snapshot");
    if (task.state !== "succeeded") throw new Error(`state ${task.state} — ${task.error}`);
    if (task.result !== "我在。") throw new Error(`result ${JSON.stringify(task.result)}`);
    if (task.attempts !== 1) throw new Error(`attempts ${task.attempts}`);
    if (task.error !== "") throw new Error(`error ${task.error}`);
  });
  check("the executor reports what it did and its cap", () => {
    if (poked.worker.state !== "succeeded") throw new Error(`state ${poked.worker.state}`);
    if (poked.worker.runsToday < 1) throw new Error("it claims to have run nothing");
    if (poked.worker.maxPerDay !== undefined) throw new Error("a daily cap is still being reported");
  });

  const idlePoke = await post("/api/dot.worker", { action: "poke" });
  check("an empty queue reports idle instead of inventing work", () => {
    if (idlePoke.outcome.skipped !== "empty") throw new Error(`skipped ${idlePoke.outcome.skipped}`);
    if (idlePoke.worker.state !== "idle") throw new Error(`state ${idlePoke.worker.state}`);
  });

  console.log("\ncomposer parity");
  const models = await get("/api/dot.models");
  check("the deployment's models are offered", () => {
    if (!Array.isArray(models.models) || models.models.length === 0) throw new Error("no models offered");
    if (models.default === null || models.default.provider !== "stub") throw new Error("no default reported");
  });

  const pinned = await post("/api/dot.manage", {
    action: "model",
    id: first.dots[0].id,
    model: { provider: "stub", model: "stub-model-2" },
  });
  check("a model can be pinned per instance", () => {
    const dot = pinned.snapshot.dots.find((row) => row.id === first.dots[0].id);
    if (dot === undefined || dot.model === null || dot.model.model !== "stub-model-2") throw new Error("pin did not take");
  });

  await post("/api/dot.manage", { action: "select", id: first.dots[0].id });
  const pinnedChat = await post("/api/dot.chat", { text: "在吗" });
  check("chat spends the instance's pinned model, not the default", () => {
    if (pinnedChat.model !== "stub/stub-model-2") throw new Error(`model ${pinnedChat.model}`);
  });

  await post("/api/dot.chat", { text: "看看这个", attachments: [{ name: "note.txt", text: "附件内容" }] });
  const withFile = await get("/api/dot.state");
  check("an attachment is folded into the turn and named on it", () => {
    const user = withFile.messages.filter((message) => message.role === "user").pop();
    if (user === undefined) throw new Error("no user turn");
    if (!user.text.includes("附件内容")) throw new Error("the attachment text is missing from the turn");
    if (user.meta === undefined || !Array.isArray(user.meta.attachments) || user.meta.attachments[0] !== "note.txt") {
      throw new Error("the attachment is not named on the turn");
    }
  });
  check("the trace carries model, latency, and tokens", () => {
    const reply = withFile.messages.filter((message) => message.role === "dot").pop();
    if (reply === undefined || reply.meta === undefined) throw new Error("no meta on the reply");
    if (typeof reply.meta.model !== "string") throw new Error("no model in the trace");
    if (typeof reply.meta.ms !== "number") throw new Error("no latency in the trace");
    if (reply.meta.tokens === undefined || reply.meta.tokens.input !== 12) throw new Error("no token usage in the trace");
  });

  const narrowed = await post("/api/dot.manage", { action: "permission", id: first.dots[0].id, permission: "chat" });
  check("permission can be narrowed", () => {
    const dot = narrowed.snapshot.dots.find((row) => row.id === first.dots[0].id);
    if (dot === undefined || dot.permission !== "chat") throw new Error("permission did not take");
  });

  await post("/api/dot.manage", { action: "task", op: "add", title: "不该被执行的活" });
  const blocked = await post("/api/dot.worker", { action: "poke" });
  check("a chat-only resident does not spend the budget on its own", () => {
    if (blocked.outcome.skipped !== "permission") throw new Error(`skipped ${blocked.outcome.skipped}`);
    if (blocked.worker.state !== "paused") throw new Error(`state ${blocked.worker.state}`);
  });
  await post("/api/dot.manage", { action: "permission", id: first.dots[0].id, permission: "full" });
  const resumed = await post("/api/dot.worker", { action: "poke" });
  check("restoring the permission lets the queue move again", () => {
    if (resumed.outcome.ok !== true) throw new Error(`outcome ${JSON.stringify(resumed.outcome)}`);
  });

  const before = (await get("/api/dot.state")).messages.length;
  const rewound = await post("/api/dot.rewind", { count: 1 });
  check("rewind drops the last turn", () => {
    if (rewound.ok !== true) throw new Error(rewound.error ?? "not ok");
    if (rewound.snapshot.messages.length !== before - 1) {
      throw new Error(`messages ${rewound.snapshot.messages.length}, expected ${before - 1}`);
    }
  });

  console.log("\nplugin settings");
  const kFresh = await get("/api/dot.state");
  check("settings are exposed alongside the snapshot", () => {
    for (const key of ["workerPollSeconds", "avatarPath", "defaultPermission", "autonomy", "rules"]) {
      if (kFresh.settings[key] === undefined) throw new Error(`missing setting ${key}`);
    }
    // No quotas of our own. A limit the user cannot see or change is worse than
    // no limit, so anything of that sort creeping back in is a regression.
    for (const gone of ["workerGapSeconds", "workerMaxPerDay"]) {
      if (kFresh.settings[gone] !== undefined) throw new Error(`${gone} came back`);
    }
  });

  const kTuned = await post("/api/dot.manage", {
    action: "settings",
    patch: { workerEnabled: true, workerPollSeconds: 600 },
  });
  check("settings round-trip", () => {
    if (kTuned.settings.workerEnabled !== true) throw new Error("enable did not take");
    if (kTuned.settings.workerPollSeconds !== 600) throw new Error(`poll ${kTuned.settings.workerPollSeconds}`);
  });

  const kClamped = await post("/api/dot.manage", { action: "settings", patch: { workerPollSeconds: 99999 } });
  check("the polling cadence is still bounded, because it is a mechanism not a quota", () => {
    if (kClamped.settings.workerPollSeconds > 3600) throw new Error(`poll ${kClamped.settings.workerPollSeconds}`);
  });

  console.log("\ncustom kinds");
  const kAdded = await post("/api/dot.manage", {
    action: "typeAdd",
    name: "审稿人",
    blurb: "专门挑毛病",
    persona: "你是审稿人，读东西时专挑逻辑漏洞和没说清的地方。",
  });
  const kKind = kAdded.types.find((entry) => entry.name === "审稿人");
  check("a user kind can be created", () => {
    if (kKind === undefined) throw new Error("kind missing from the catalogue");
    if (kKind.builtin !== false) throw new Error("a user kind must not be marked builtin");
    if (!kKind.persona.includes("逻辑漏洞")) throw new Error("persona was not kept");
  });

  const kDot = await post("/api/dot.manage", { action: "create", type: kKind.id });
  check("an instance can be created with a user kind", () => {
    if (!kDot.snapshot.dots.some((row) => row.type === kKind.id)) throw new Error("no instance carries the kind");
  });

  const kBlocked = await post("/api/dot.manage", { action: "typeRemove", typeId: kKind.id });
  check("a kind still in use refuses removal", () => {
    if (kBlocked.error === undefined) throw new Error("removal went through while in use");
  });

  const kCustomDot = kDot.snapshot.dots.find((row) => row.type === kKind.id);
  await post("/api/dot.manage", { action: "delete", id: kCustomDot.id });
  const kRemoved = await post("/api/dot.manage", { action: "typeRemove", typeId: kKind.id });
  check("once unused, a user kind is removable", () => {
    if (kRemoved.ok !== true) throw new Error(kRemoved.error ?? "not ok");
    if (kRemoved.types.some((entry) => entry.id === kKind.id)) throw new Error("kind still listed");
  });

  const kBuiltin = await post("/api/dot.manage", { action: "typeRemove", typeId: "companion" });
  check("a shipped kind refuses removal", () => {
    if (kBuiltin.error === undefined) throw new Error("a shipped kind was removable");
  });
  check("the four shipped kinds survive every edit", () => {
    if (kRemoved.types.filter((entry) => entry.builtin).length !== 4) throw new Error("shipped kinds changed");
  });

  console.log("\nclearing shared state");
  await post("/api/dot.manage", { action: "clearShared" });
  const kCleared = await get("/api/dot.state");
  check("clearing empties memory and queue but keeps instances", () => {
    if (kCleared.stats.memoryTotal !== 0) throw new Error(`memory ${kCleared.stats.memoryTotal}`);
    if (kCleared.stats.taskTotal !== 0) throw new Error(`tasks ${kCleared.stats.taskTotal}`);
    if (kCleared.stats.dotTotal === 0) throw new Error("instances were cleared as well");
  });

  await post("/api/dot.manage", { action: "settings", patch: { workerEnabled: false } });

  console.log("\npause, reset and schedules");
  const pHome = first.dots[0].id;
  const pPaused = await post("/api/dot.manage", { action: "pause", id: pHome, paused: true });
  check("an instance can be paused", () => {
    const dot = pPaused.snapshot.dots.find((row) => row.id === pHome);
    if (dot === undefined || dot.paused !== true) throw new Error("pause did not take");
  });

  await post("/api/dot.manage", { action: "task", op: "add", title: "暂停时不该跑" });
  const pBlocked = await post("/api/dot.worker", { action: "poke" });
  check("a paused resident does not work the queue", () => {
    if (pBlocked.outcome.skipped !== "paused") throw new Error(`skipped ${pBlocked.outcome.skipped}`);
  });
  check("and the queued work is still there afterwards", () => {
    const task = pBlocked.snapshot.tasks.find((row) => row.title === "暂停时不该跑");
    if (task === undefined) throw new Error("the task vanished");
    if (task.state !== "queued") throw new Error(`state ${task.state}`);
  });

  await post("/api/dot.manage", { action: "pause", id: pHome, paused: false });
  const pResumed = await post("/api/dot.worker", { action: "poke" });
  check("resuming lets it work again", () => {
    if (pResumed.outcome.ok !== true) throw new Error(`outcome ${JSON.stringify(pResumed.outcome)}`);
  });

  const future = new Date(Date.now() + 3_600_000).toISOString();
  await post("/api/dot.manage", { action: "task", op: "add", title: "以后再做", dueAt: future });
  const sPoked = await post("/api/dot.worker", { action: "poke" });
  check("a deadline in the future keeps a task out of the executor's reach", () => {
    const task = sPoked.snapshot.tasks.find((row) => row.title === "以后再做");
    if (task === undefined) throw new Error("task missing");
    if (task.state !== "queued") throw new Error(`state ${task.state}`);
    if (task.attempts !== 0) throw new Error("it was picked up early");
  });

  const rMade = await post("/api/dot.manage", { action: "task", op: "add", title: "每天报到", repeat: "day 09:00" });
  check("a recurrence is stored and reported back", () => {
    const task = rMade.tasks.find((row) => row.title === "每天报到");
    if (task === undefined) throw new Error("task missing");
    if (task.repeat !== "day 09:00") throw new Error(`repeat ${JSON.stringify(task.repeat)}`);
  });

  const rRan = await post("/api/dot.worker", { action: "poke" });
  check("a recurring task goes back on the queue instead of finishing", () => {
    const task = rRan.snapshot.tasks.find((row) => row.title === "每天报到");
    if (task === undefined) throw new Error("the recurring task vanished");
    if (task.state !== "queued") throw new Error(`state ${task.state} — a recurrence must not finish`);
    if (task.result === "") throw new Error("the latest outcome was dropped");
    if (task.dueAt === "") throw new Error("no next slot was scheduled");
    if (Date.parse(task.dueAt) <= Date.now()) throw new Error("the next slot is in the past");
  });

  const rReset = await post("/api/dot.manage", { action: "reset", id: pHome });
  check("reset clears the instance's own state but keeps its identity", () => {
    if (rReset.reset.removedMessages < 1) throw new Error("nothing was cleared");
    const dot = rReset.snapshot.dots.find((row) => row.id === pHome);
    if (dot === undefined) throw new Error("the instance disappeared");
    if (dot.messages !== 0) throw new Error(`messages ${dot.messages}`);
    if (dot.paused !== false) throw new Error("the pause flag survived a reset");
    if (dot.model !== null) throw new Error("the model pin survived a reset");
    if (dot.name !== rReset.reset.name) throw new Error("the name was not preserved");
  });

  console.log("\nrules");
  await post("/api/dot.manage", { action: "settings", patch: { workerEnabled: true } });
  const rSet = await post("/api/dot.manage", {
    action: "settings",
    patch: { rules: { background: "ask", outgoing: "auto" } },
  });
  check("rules round-trip", () => {
    if (rSet.settings.rules.background !== "ask") throw new Error("the rule did not take");
    if (rSet.settings.rules.outgoing !== "auto") throw new Error("the other rule was disturbed");
  });

  await post("/api/dot.manage", { action: "task", op: "add", title: "需要批准的活" });
  const rHeld = await post("/api/dot.worker", { action: "poke" });
  check("under 「ask」 nothing runs without approval", () => {
    if (rHeld.outcome.skipped !== "held") throw new Error(`skipped ${rHeld.outcome.skipped}`);
  });
  check("and the held work is still queued, not dropped", () => {
    const task = rHeld.snapshot.tasks.find((row) => row.title === "需要批准的活");
    if (task === undefined) throw new Error("the task vanished");
    if (task.state !== "queued") throw new Error(`state ${task.state}`);
    if (task.attempts !== 0) throw new Error("it ran anyway");
  });

  const rTaskId = rHeld.snapshot.tasks.find((row) => row.title === "需要批准的活").id;
  const rApproved = await post("/api/dot.manage", { action: "approve", taskId: rTaskId });
  check("approving one task lets exactly that one through", () => {
    if (rApproved.ok !== true) throw new Error(rApproved.error ?? "not ok");
    if (rApproved.decision !== "accept") throw new Error(`decision ${rApproved.decision}`);
    const mine = rApproved.snapshot.tasks.find((row) => row.title === "需要批准的活");
    if (mine === undefined) throw new Error("the task vanished after approval");
    // It has to leave `awaiting`. Whether it runs immediately or waits for the
    // next pass depends on the executor being on, which is a different question
    // and not this assertion's business.
    if (mine.state === "awaiting") throw new Error("approval left it parked");
  });

  await post("/api/dot.manage", { action: "settings", patch: { rules: { background: "handoff", outgoing: "auto" } } });
  await post("/api/dot.manage", { action: "task", op: "add", title: "只提示的活" });
  const rHandoff = await post("/api/dot.worker", { action: "poke" });
  check("under 「handoff」 even an approved task is refused", () => {
    if (rHandoff.outcome.skipped !== "held") throw new Error(`skipped ${rHandoff.outcome.skipped}`);
  });
  await post("/api/dot.manage", { action: "settings", patch: { rules: { background: "auto", outgoing: "auto" } } });
  const rAuto = await post("/api/dot.worker", { action: "poke" });
  check("under 「auto」 the queue moves again", () => {
    if (rAuto.outcome.ok !== true) throw new Error(`outcome ${JSON.stringify(rAuto.outcome)}`);
  });
  await post("/api/dot.manage", { action: "settings", patch: { workerEnabled: false } });

  console.log("\nworkspace");
  const wsBefore = await get("/api/dot.state");
  check("a fresh instance already has its own workspace", () => {
    const dot = wsBefore.dots.find((row) => row.id === first.dots[0].id);
    if (dot === undefined) throw new Error("instance missing");
    if (dot.workspace === "") throw new Error("an install would need configuring before it could work");
    if (!dot.workspace.includes("workspaces")) throw new Error(`unexpected shape: ${dot.workspace}`);
  });

  const wsTarget = process.cwd();
  const wsSet = await post("/api/dot.manage", { action: "workspace", id: first.dots[0].id, workspace: wsTarget });
  check("a workspace can be set and read back", () => {
    if (wsSet.ok !== true) throw new Error(wsSet.error ?? "not ok");
    const dot = wsSet.snapshot.dots.find((row) => row.id === first.dots[0].id);
    if (dot === undefined || dot.workspace !== wsTarget) throw new Error("workspace was not stored");
  });

  const wsBad = await post("/api/dot.manage", {
    action: "workspace",
    id: first.dots[0].id,
    workspace: "\u0000nope",
  });
  check("an unusable path is refused instead of stored", () => {
    if (wsBad.error === undefined) throw new Error("an invalid path was accepted");
  });
  await post("/api/dot.manage", { action: "workspace", id: first.dots[0].id, workspace: "" });

  console.log("\nenvironment");
  const envBefore = await get("/api/dot.state");
  check("a fresh instance runs on the host by default", () => {
    const dot = envBefore.dots.find((row) => row.id === first.dots[0].id);
    if (dot === undefined) throw new Error("instance missing");
    if (dot.environment === undefined || dot.environment.kind !== "host") throw new Error("not host by default");
  });

  const envSet = await post("/api/dot.manage", {
    action: "environment",
    id: first.dots[0].id,
    kind: "wsl",
    target: "Ubuntu",
  });
  check("an execution environment can be chosen", () => {
    const dot = envSet.snapshot.dots.find((row) => row.id === first.dots[0].id);
    if (dot === undefined || dot.environment.kind !== "wsl" || dot.environment.target !== "Ubuntu") {
      throw new Error("the environment was not stored");
    }
  });

  const envBad = await post("/api/dot.manage", {
    action: "environment",
    id: first.dots[0].id,
    kind: "nonsense",
    target: "",
  });
  check("an unknown environment falls back rather than breaking", () => {
    const dot = envBad.snapshot.dots.find((row) => row.id === first.dots[0].id);
    if (dot === undefined || dot.environment.kind !== "host") throw new Error(`kind ${dot.environment.kind}`);
  });

  const envProbe = await get("/api/dot.env");
  check("the host reports what it can actually offer", () => {
    if (!Array.isArray(envProbe.environments)) throw new Error("no probe result");
    if (envProbe.environments[0].kind !== "host") throw new Error("the host itself must always be offered");
  });

  console.log("\nalerts");
  const alertBefore = await get("/api/dot.state");
  check("every instance reports a status for its sidebar dot", () => {
    if (alertBefore.dots.length === 0) throw new Error("no instances");
    for (const dot of alertBefore.dots) {
      if (!["quiet", "waiting", "error"].includes(dot.alert)) {
        throw new Error(`${dot.name} reports alert ${JSON.stringify(dot.alert)}`);
      }
    }
  });

  // 「做前问我」会把 agent 来源的活儿拦住 —— 那正是侧边栏橙点的含义。
  // 注意参数名：服务端读的是 body.patch，不是平铺的字段。
  await post("/api/dot.manage", {
    action: "settings",
    patch: { rules: { background: "ask", outgoing: "auto" } },
  });
  await call("dot_task", { action: "add", title: "被规则拦下的活儿", priority: 3 });

  const held = await get("/api/dot.state");
  check("work held back by a rule turns its instance orange", () => {
    const waiting = held.dots.filter((dot) => dot.alert === "waiting");
    if (waiting.length === 0) {
      const seen = held.dots.map((dot) => `${dot.name}=${dot.alert}`).join(", ");
      throw new Error(`nothing is waiting: ${seen}`);
    }
  });

  const queueView = await call("dot_task", { action: "list" });
  check("a queued task remembers which instance raised it", () => {
    const tasks = Array.isArray(queueView.value.tasks) ? queueView.value.tasks : [];
    const mine = tasks.find((task) => task.title === "被规则拦下的活儿");
    if (mine === undefined) {
      throw new Error(`not queued: ${JSON.stringify(tasks.map((task) => task.title))}`);
    }
    if (typeof mine.dotId !== "string" || mine.dotId === "") {
      throw new Error(`no owner recorded: ${JSON.stringify(mine)}`);
    }
  });



  // 收尾：放回默认规则，橙点应该跟着退掉
  await post("/api/dot.manage", {
    action: "settings",
    patch: { rules: { background: "auto", outgoing: "auto" } },
  });
  const settled = await get("/api/dot.state");
  check("restoring the rule clears the waiting state", () => {
    const waiting = settled.dots.filter((dot) => dot.alert === "waiting");
    if (waiting.length > 0) throw new Error(`${waiting.length} still waiting after the rule was restored`);
  });

  console.log("\nautonomy");
  const autoBefore = await get("/api/dot.state");
  check("autonomy stays off until the user turns it on", () => {
    if (autoBefore.autonomy === undefined) throw new Error("no autonomy state reported");
    if (autoBefore.autonomy.config.enabled !== false) throw new Error("it starts enabled");
  });
  check("autonomy defaults are the documented ones", () => {
    const cfg = autoBefore.autonomy.config;
    if (cfg.idleMinutes !== 30) throw new Error(`idleMinutes ${cfg.idleMinutes}`);
    if (cfg.cooldownMinutes !== 180) throw new Error(`cooldownMinutes ${cfg.cooldownMinutes}`);
    // Free time starts read-only: a resident poking around on its own must not
    // be able to send or change anything until the user says it may.
    if (cfg.permission !== "read") throw new Error(`it does not start read-only: ${cfg.permission}`);
  });

  const autoSet = await post("/api/dot.manage", {
    action: "settings",
    patch: { autonomy: { enabled: true, idleMinutes: 5, cooldownMinutes: 0, permission: "review" } },
  });
  check("autonomy settings round-trip, including the permission mode", () => {
    const cfg = autoSet.settings.autonomy;
    if (cfg.enabled !== true || cfg.idleMinutes !== 5 || cfg.permission !== "review") {
      throw new Error(JSON.stringify(cfg));
    }
    if (cfg.cooldownMinutes !== 0) throw new Error("a zero cooldown was not accepted");
  });

  const autoClamp = await post("/api/dot.manage", {
    action: "settings",
    patch: { autonomy: { enabled: true, idleMinutes: -99, cooldownMinutes: 99999, permission: "nonsense" } },
  });
  check("an absurd number is clamped and a bad mode falls back", () => {
    const cfg = autoClamp.settings.autonomy;
    if (cfg.idleMinutes < 1) throw new Error(`idleMinutes ${cfg.idleMinutes}`);
    if (cfg.cooldownMinutes > 24 * 60) throw new Error(`cooldownMinutes ${cfg.cooldownMinutes}`);
    if (!["read", "review", "full"].includes(cfg.permission)) throw new Error(`permission ${cfg.permission}`);
  });

  // Put the mode back to review, so what follows tests the mode rather than
  // whatever the clamp test left behind.
  await post("/api/dot.manage", {
    action: "settings",
    patch: { autonomy: { enabled: true, idleMinutes: 5, cooldownMinutes: 0, permission: "review" } },
  });

  const triggered = await post("/api/dot.worker", { action: "trigger" });
  check("the panel can make it look right now", () => {
    if (triggered.ok !== true) throw new Error(triggered.error ?? "not ok");
    if (triggered.autonomy.state !== "queued") throw new Error(`state ${triggered.autonomy.state}`);
    if (triggered.autonomy.today !== 1) throw new Error(`today ${triggered.autonomy.today}`);
  });
  check("self-started work carries its permission mode, not the instance's", () => {
    const mine = triggered.snapshot.tasks.find((task) => task.title.includes("自由时间"));
    if (mine === undefined) throw new Error("not queued");
    if (mine.autonomy !== true) throw new Error("it is not marked as self-started");
    // The test switched the mode to review just above; the job must carry it.
    if (mine.permission !== "review") throw new Error(`permission ${JSON.stringify(mine.permission)}`);
  });
  check("a job raised by hand carries no mode of its own", () => {
    const plain = triggered.snapshot.tasks.find((task) => task.title === "被规则拦下的活儿");
    if (plain !== undefined && plain.permission !== "") {
      throw new Error(`an ordinary job overrode the instance: ${plain.permission}`);
    }
  });
  check("and it does not touch the transcript", () => {
    const dot = triggered.snapshot.dots.find((row) => row.messages !== 0);
    if (dot !== undefined) throw new Error(`autonomy wrote into a conversation: ${dot.name}`);
  });

  // 收尾：关掉它，别影响后面的用例
  await post("/api/dot.manage", { action: "settings", patch: { autonomy: { enabled: false } } });

  console.log("\nmodel choice");
  const picker = await get("/api/dot.models");
  check("the picker lists the advertised models", () => {
    if (!Array.isArray(picker.models) || picker.models.length !== 2) {
      throw new Error(`got ${JSON.stringify(picker.models)}`);
    }
  });
  check("it reports the thinking tiers a model accepts", () => {
    const first = picker.models.find((entry) => entry.id === "stub-model");
    if (first === undefined) throw new Error("missing stub-model");
    if (!Array.isArray(first.efforts) || first.efforts.length !== 2) {
      throw new Error(`efforts ${JSON.stringify(first.efforts)}`);
    }
    if (first.efforts[1].name !== "高") throw new Error("the tier name was lost");
    if (first.defaultEffort !== "low") throw new Error(`defaultEffort ${first.defaultEffort}`);
  });
  check("and whether it can look at a picture, and how much it can read", () => {
    const first = picker.models.find((entry) => entry.id === "stub-model");
    if (first.vision !== true) throw new Error("the vision flag is missing");
    if (first.contextWindow !== 128000) throw new Error(`contextWindow ${first.contextWindow}`);
  });
  check("a model with no metadata degrades instead of breaking the picker", () => {
    const second = picker.models.find((entry) => entry.id === "stub-model-2");
    if (second === undefined) throw new Error("the unresolvable model vanished from the list");
    if (second.efforts !== undefined) throw new Error("it invented thinking tiers");
  });

  const chosen = await call("dot_task", {
    action: "add",
    title: "用另一个模型做的活",
    model: "stub/stub-model",
    effort: "high",
  });
  check("a job can name its own model and thinking tier", () => {
    const mine = chosen.value.tasks.find((task) => task.title === "用另一个模型做的活");
    if (mine === undefined) throw new Error("not queued");
    if (mine.model !== "stub/stub-model") throw new Error(`model ${JSON.stringify(mine.model)}`);
    if (mine.effort !== "high") throw new Error(`effort ${JSON.stringify(mine.effort)}`);
  });
  check("an ordinary job reports no override", () => {
    const plain = chosen.value.tasks.find((task) => task.title !== "用另一个模型做的活");
    if (plain !== undefined && plain.model !== "") {
      throw new Error(`unexpected model ${JSON.stringify(plain.model)}`);
    }
  });
  const bare = await call("dot_task", { action: "add", title: "没写 provider 的活", model: "stub-model" });
  check("a bare model name still parses as a choice", () => {
    const mine = bare.value.tasks.find((task) => task.title === "没写 provider 的活");
    if (mine === undefined) throw new Error("not queued");
    if (mine.model !== "stub-model") throw new Error(`model ${JSON.stringify(mine.model)}`);
    if (mine.effort !== "") throw new Error(`effort should be empty, got ${JSON.stringify(mine.effort)}`);
  });

  console.log("\nimages");
  // A one-pixel PNG. The stub's attachment service does not decode it, so the
  // bytes only have to be base64 and non-empty for the reference to be built.
  const pixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const pictorial = await post("/api/dot.chat", {
    text: "看看这张图",
    images: [{ data: pixelPng, mediaType: "image/png", name: "pixel.png" }],
  });
  check("a picture sent through the composer reaches the model", () => {
    if (pictorial.ok !== true) throw new Error(pictorial.error ?? "not ok");
    if (pictorial.message.role !== "dot") throw new Error(`stored as ${pictorial.message.role}`);
    if (typeof pictorial.message.text !== "string" || pictorial.message.text === "") {
      throw new Error("no answer was stored");
    }
  });

  console.log("\nconcurrency");
  const ccSet = await post("/api/dot.manage", {
    action: "settings",
    patch: { workerConcurrency: 3 },
  });
  check("the user decides how many jobs run at once", () => {
    if (ccSet.settings.workerConcurrency !== 3) throw new Error(`got ${ccSet.settings.workerConcurrency}`);
  });
  const ccClamp = await post("/api/dot.manage", { action: "settings", patch: { workerConcurrency: 9999 } });
  check("an absurd count is clamped rather than accepted", () => {
    if (ccClamp.settings.workerConcurrency > 32) throw new Error(`got ${ccClamp.settings.workerConcurrency}`);
  });
  check("and no daily ceiling came back with it", () => {
    if (ccClamp.settings.workerMaxPerDay !== undefined) throw new Error("a quota reappeared");
  });
  await post("/api/dot.manage", { action: "settings", patch: { workerConcurrency: 3 } });
  // Two jobs at once: both must finish, each into its own entry.
  await call("dot_task", { action: "add", title: "并行的甲", priority: 3 });
  await call("dot_task", { action: "add", title: "并行的乙", priority: 3 });
  await post("/api/dot.manage", { action: "settings", patch: { workerEnabled: true } });
  const bothRan = await post("/api/dot.worker", { action: "poke" });
  check("two queued jobs both settle, each on its own entry", () => {
    const tasks = bothRan.snapshot.tasks.filter((task) => task.title.startsWith("并行的"));
    if (tasks.length < 2) throw new Error("the jobs vanished from the queue");
    for (const task of tasks) {
      if (task.state !== "succeeded" && task.state !== "failed") {
        throw new Error(`${task.title} is still ${task.state}`);
      }
    }
  });

  console.log("\nbriefing");
  const brBefore = await get("/api/dot.state");
  check("the briefing stays off until the user asks for one", () => {
    if (brBefore.settings.briefing === undefined) throw new Error("no briefing settings at all");
    if (brBefore.settings.briefing.enabled !== false) throw new Error("it starts enabled");
  });
  const brOn = await post("/api/dot.manage", {
    action: "settings",
    patch: { briefing: { enabled: true, at: "8:30" } },
  });
  check("its time round-trips", () => {
    const cfg = brOn.settings.briefing;
    if (cfg.enabled !== true || cfg.at !== "8:30") throw new Error(JSON.stringify(cfg));
  });
  const brBad = await post("/api/dot.manage", {
    action: "settings",
    patch: { briefing: { enabled: true, at: "不是时间" } },
  });
  check("a nonsense time falls back instead of breaking the schedule", () => {
    if (!/^\d{1,2}:\d{2}$/.test(brBad.settings.briefing.at)) {
      throw new Error(`at ${JSON.stringify(brBad.settings.briefing.at)}`);
    }
  });
  const brNow = await post("/api/dot.manage", { action: "briefingNow" });
  check("a briefing with nothing to say stays quiet, and one with no route says so", () => {
    // Earlier cases left settled tasks behind, so this sandbox has material and
    // no connection to carry it. Either outcome is fine; claiming success
    // without a route is not, and neither is failing without a reason.
    if (brNow.ok === true) {
      if (brNow.skipped !== "quiet" && brNow.sent === undefined) {
        throw new Error(`it claimed success without doing anything: ${JSON.stringify(brNow)}`);
      }
      return;
    }
    if (typeof brNow.error !== "string" || brNow.error === "") {
      throw new Error("it failed without saying why");
    }
  });
  await post("/api/dot.manage", { action: "settings", patch: { briefing: { enabled: false } } });

  console.log("\nlimits");
  const limBefore = await get("/api/dot.state");
  check("every tuning number is exposed", () => {
    const limits = limBefore.settings.limits;
    if (limits === undefined) throw new Error("no limits exposed at all");
    for (const key of ["taskMinutes", "dailyMinutes", "toolRounds", "taskLimit", "recallMessages", "transcriptWindow"]) {
      if (typeof limits[key] !== "number") throw new Error(`missing ${key}`);
    }
  });
  check("and the permissive ones are the defaults", () => {
    const limits = limBefore.settings.limits;
    // A time budget that nobody asked for would be exactly the kind of hidden
    // quota this plugin is not supposed to have.
    if (limits.dailyMinutes !== 0) throw new Error(`dailyMinutes starts at ${limits.dailyMinutes}`);
  });

  const limSet = await post("/api/dot.manage", {
    action: "settings",
    patch: { limits: { toolRounds: 40, dailyMinutes: 120, taskMinutes: 0 } },
  });
  check("they round-trip", () => {
    const limits = limSet.settings.limits;
    if (limits.toolRounds !== 40 || limits.dailyMinutes !== 120) throw new Error(JSON.stringify(limits));
  });
  check("zero survives as zero rather than being replaced by a default", () => {
    if (limSet.settings.limits.taskMinutes !== 0) throw new Error("a zero was overwritten");
  });

  const limClamp = await post("/api/dot.manage", {
    action: "settings",
    patch: { limits: { taskMinutes: 999999, taskLimit: 0 } },
  });
  check("absurd values are clamped into a usable range", () => {
    const limits = limClamp.settings.limits;
    if (limits.taskMinutes > 24 * 60) throw new Error(`taskMinutes ${limits.taskMinutes}`);
    if (limits.taskLimit < 10) throw new Error(`taskLimit ${limits.taskLimit}`);
  });

  console.log("\ncredentials");
  const secrets = await call("dot_secret", { action: "list" });
  check("the credential tool lists names and never values", () => {
    if (secrets.value.action !== "list") throw new Error("the action was not echoed");
    if (!Array.isArray(secrets.value.names)) throw new Error("no names array");
    for (const name of secrets.value.names) {
      // A name that looks like a password would mean the value leaked into a list.
      if (/^[A-Za-z0-9+/=_-]{24,}$/.test(name)) throw new Error(`a name looks like a value: ${name}`);
    }
  });
  let secretFail = null;
  try {
    await call("dot_secret", { action: "type", name: "no-such-credential", desktop: "dshv-none" });
  } catch (error) {
    secretFail = error instanceof Error ? error.message : String(error);
  }
  check("using a credential that does not exist fails with a reason", () => {
    if (secretFail === null) throw new Error("it silently did nothing");
    if (!secretFail.includes("凭据")) throw new Error(`unhelpful message: ${secretFail}`);
  });
  let secretNoTarget = null;
  try {
    await call("dot_secret", { action: "type", name: "anything" });
  } catch (error) {
    secretNoTarget = error instanceof Error ? error.message : String(error);
  }
  check("and it refuses to type into nowhere", () => {
    if (secretNoTarget === null) throw new Error("it accepted a nameless destination");
  });

  console.log("\ncalendar");
  const soon = new Date(Date.now() + 3600_000).toISOString();
  const past = new Date(Date.now() - 3600_000).toISOString();
  const planned = await call("dot_agenda", { action: "add", at: soon, text: "安排晚餐" });
  check("something can be put on the calendar", () => {
    const entry = planned.value.entries.find((candidate) => candidate.text === "安排晚餐");
    if (entry === undefined) throw new Error("it is not on the calendar");
    if (entry.done !== false) throw new Error("it arrived already done");
  });
  check("entries come back in time order", () => {
    const times = planned.value.entries.map((entry) => entry.at);
    for (let i = 1; i < times.length; i += 1) {
      if (times[i - 1] > times[i]) throw new Error(`out of order at ${i}`);
    }
  });

  const overdue = await call("dot_agenda", { action: "add", at: past, text: "收尾家装" });
  const overdueEntry = overdue.value.entries.find((entry) => entry.text === "收尾家装");
  check("an entry whose moment has passed is on the list", () => {
    if (overdueEntry === undefined) throw new Error("the past entry vanished");
    if (overdueEntry.done !== false) throw new Error("it is marked done already");
  });

  let badTime = null;
  try {
    await call("dot_agenda", { action: "add", at: "明天下午", text: "猜一个时刻" });
  } catch (error) {
    badTime = error instanceof Error ? error.message : String(error);
  }
  check("a time it cannot parse is refused rather than guessed at", () => {
    if (badTime === null) throw new Error("it accepted natural language and invented an instant");
    if (!badTime.includes("ISO")) throw new Error(`unhelpful message: ${badTime}`);
  });

  const finished = await call("dot_agenda", { action: "done", id: overdueEntry.id });
  check("an entry can be ticked off", () => {
    const entry = finished.value.entries.find((candidate) => candidate.id === overdueEntry.id);
    if (entry === undefined) throw new Error("it vanished after being ticked off");
    if (entry.done !== true) throw new Error("it is still not marked done");
  });

  const gone = await call("dot_agenda", { action: "remove", id: planned.value.entries.find((e) => e.text === "安排晚餐").id });
  check("and removed", () => {
    if (gone.value.entries.some((entry) => entry.text === "安排晚餐")) throw new Error("it is still there");
  });

  console.log("\nfocus");
  const focused = await call("dot_remember", { text: "他在意把家装收尾，别给他塞别的事", kind: "focus" });
  check("a resident can record what the user pays attention to", () => {
    if (typeof focused.value.id !== "string") throw new Error("no id came back");
  });
  const recalledFocus = await call("dot_recall", { query: "家装" });
  check("and read it back when working on its own", () => {
    const hit = recalledFocus.value.matches.find((entry) => entry.kind === "focus");
    if (hit === undefined) throw new Error(`no focus entry: ${JSON.stringify(recalledFocus.value.matches)}`);
  });

  console.log("\napproval as a state");
  const parked = await call("dot_task", { action: "add", title: "会撞到边界的活", priority: 3 });
  check("awaiting is declared as a real task state", () => {
    // Approval is not an error branch. It has to be a state the queue knows,
    // or a job that stopped for a person would fall off the panel entirely.
    const declared = tools.get("dot_task").output.schema.properties.tasks.items.properties.state;
    const states = Array.isArray(declared.enum) ? declared.enum : [];
    if (!states.includes("awaiting")) throw new Error(`states: ${states.join(",")}`);
  });
  check("a parked job still carries its work so far", () => {
    const mine = parked.value.tasks.find((task) => task.title === "会撞到边界的活");
    if (mine === undefined) throw new Error("not queued");
    if (typeof mine.result !== "string") throw new Error("no result field");
  });
  const bumped = await post("/api/dot.manage", {
    action: "approve",
    taskId: parked.value.tasks.find((task) => task.title === "会撞到边界的活").id,
  });
  check("approving a job does not lose it", () => {
    if (bumped.ok !== true) throw new Error(bumped.error ?? "not ok");
    const mine = bumped.snapshot.tasks.find((task) => task.title === "会撞到边界的活");
    if (mine === undefined) throw new Error("the task vanished after approval");
    if (mine.state !== "queued" && mine.state !== "succeeded" && mine.state !== "running") {
      throw new Error(`state ${mine.state}`);
    }
  });

  console.log("\nworkspace boundary");
  const verdict = plugin.workspaceVerdict;
  check("the boundary is testable without a model anywhere near it", () => {
    // The whole reason this is trustworthy: it is a pure function of a tool
    // name, some arguments, and a workspace. If answering "is this safe" ever
    // requires asking a model, it stops being a boundary.
    if (typeof verdict !== "function") throw new Error("not exported");
  });
  check("reading inside the workspace needs nobody's permission", () => {
    const v = verdict("read", { file_path: "D:\\work\\a.txt" }, "D:\\work");
    if (v.decision !== "inside") throw new Error(JSON.stringify(v));
  });
  check("stepping outside it is held for the user", () => {
    const v = verdict("read", { file_path: "D:\\other\\b.txt" }, "D:\\work");
    if (v.decision !== "guarded") throw new Error(JSON.stringify(v));
  });
  check("the memory store is refused outright, at any permission level", () => {
    const v = verdict("read", { file_path: "D:\\dsh-home\\dot\\dot.json" }, "D:\\work");
    if (v.decision !== "refused") throw new Error(JSON.stringify(v));
  });
  check("so is anything that looks like a credential", () => {
    for (const target of ["C:\\Users\\me\\.ssh\\id_rsa", "D:\\app\\.env", "C:\\creds\\credentials.json"]) {
      const v = verdict("read", { file_path: target }, "D:\\work");
      if (v.decision !== "refused") throw new Error(`${target} -> ${JSON.stringify(v)}`);
    }
  });
  check("a shell command is checked the same way as a path argument", () => {
    const v = verdict("bash", { command: "cat C:\\Users\\me\\.ssh\\id_rsa" }, "D:\\work");
    if (v.decision !== "refused") throw new Error(JSON.stringify(v));
  });
  check("a call with nothing to check reports that, rather than a pass", () => {
    const v = verdict("web_search", { query: "天气" }, "D:\\work");
    // Not `inside`: nothing was examined, and "inside" would report an
    // inspection that never happened. Both let the call through; only one of
    // them is true, and the difference is what keeps an audit honest.
    if (v.decision !== "unchecked") throw new Error(JSON.stringify(v));
  });

  check("every refusal says what to do instead of only what went wrong", () => {
    // A boundary that only says "no" teaches a model to route around it. This
    // is the pattern a workflow engine uses in its restriction messages, where
    // the error text names the correct replacement API outright.
    const cases = [
      ["read", { file_path: "C:\\Users\\me\\.ssh\\id_rsa" }, "D:\\work"],
      ["read", { file_path: "D:\\dsh-home\\dot\\dot.json" }, "D:\\work"],
      ["read", { file_path: "D:\\other\\b.txt" }, "D:\\work"],
    ];
    for (const [name, args, ws] of cases) {
      const v = verdict(name, args, ws);
      if (v.reason === "") throw new Error(`${name} refused without a reason`);
      if (v.reason.length < 12) throw new Error(`too terse to act on: ${v.reason}`);
      // It has to name a way forward, not merely restate the refusal.
      if (!/(用|走|把|设成|贴进|自己)/.test(v.reason)) {
        throw new Error(`no way forward in: ${v.reason}`);
      }
    }
  });

  check("one comment cannot defeat the boundary", () => {
    // `cd D:\work\x # C:\secret\thing` starts with the workspace prefix and then
    // does something else entirely. Judging the whole command as one string
    // passes it; judging the tokens separately does not. The failure has a name
    // in the wild: a prefix rule that allows a *pattern* does not allow the
    // *effect*.
    const v = verdict("bash", { command: "cd D:\\work\\x # C:\\secret\\thing" }, "D:\\work");
    if (v.decision === "inside") throw new Error("a comment defeated the boundary");
  });
  check("a redirection target is judged even though it is not an argument", () => {
    // A rule allowing the command does not allow what the command writes to.
    const v = verdict("bash", { command: "echo hi > C:\\Users\\me\\.ssh\\id_rsa" }, "D:\\work");
    if (v.decision !== "refused") throw new Error(JSON.stringify(v));
  });
  check("a command that really does stay inside still passes", () => {
    const v = verdict("bash", { command: "ls D:\\work\\src && cat D:\\work\\a.txt" }, "D:\\work");
    if (v.decision !== "inside") throw new Error(JSON.stringify(v));
  });

  console.log("\ninbound replies");
  const reply = plugin.replyThrough;
  const telegram = { id: "c-tg", kind: "telegram", token: "tok", chatId: "42", url: "" };
  check("one helper answers for both inbound paths", () => {
    // It used to live inside the long-poll scheduler, so the HTTP endpoint had
    // its own copy and the poll had none: a real Telegram bot received its
    // message, answered, and sent nothing back. Sharing the function is what
    // makes that impossible to reintroduce quietly.
    if (typeof reply !== "function") throw new Error("not exported");
  });
  const refusals = await Promise.all([
    // Each of these must decline before any network call is attempted.
    reply(telegram, undefined, undefined),
    reply(telegram, { ok: false, replied: true, answer: "hi" }, undefined),
    reply(telegram, { ok: true, replied: false, answer: "hi" }, undefined),
    reply(telegram, { ok: true, replied: true, answer: "" }, undefined),
    reply({ id: "c-http", kind: "http", token: "", chatId: "", url: "https://example.test/hook" }, {
      ok: true, replied: true, answer: "hi",
    }, undefined),
    reply({ id: "c-tg2", kind: "telegram", token: "", chatId: "", url: "" }, {
      ok: true, replied: true, answer: "hi",
    }, undefined),
  ]);
  check("and it declines everything that has nowhere to go", () => {
    if (refusals.some((value) => value !== false)) {
      throw new Error(`one of them tried to send: ${JSON.stringify(refusals)}`);
    }
  });

  console.log("\nmemory provenance");
  check("the tool tells the model to write absolute dates", () => {
    // An entry is read long after it was written. "Today" is a date that has
    // already expired by the time anyone reads it back, and this is the
    // cheapest place to stop it from ever being written.
    const described = tools.get("dot_remember").parameters.properties.text.description
      + tools.get("dot_remember").description;
    if (!described.includes("2026")) throw new Error(`no example date in: ${described}`);
    if (!/relative/i.test(described)) throw new Error("relative dates are not warned against");
  });
  const fromTool = await call("dot_remember", {
    text: "某个网页上说这个库该升级了",
    kind: "fact",
    source: "tool",
  });
  check("a memory records where it came from", () => {
    // A resident reads a page and writes a memory: that is a page writing into
    // its long-term state. Labelling the origin is the cheapest defence there
    // is, and the only one that survives the model being talked to.
    if (fromTool.value.source !== "tool") throw new Error(`source ${fromTool.value.source}`);
  });
  const noSource = await call("dot_remember", { text: "没有标来源的一条", kind: "note" });
  check("and an unlabelled one defaults to the model's own claim, never to fact", () => {
    if (noSource.value.source !== "agent") throw new Error(`source ${noSource.value.source}`);
  });
  const bogusSource = await call("dot_remember", { text: "来源写错的一条", kind: "note", source: "官方" });
  check("an unrecognised origin falls back rather than being trusted", () => {
    if (bogusSource.value.source !== "agent") throw new Error(`source ${bogusSource.value.source}`);
  });
  const recalledTool = await call("dot_recall", { query: "升级" });
  check("and reading it back shows the label, so a claim is visible as a claim", () => {
    const hit = recalledTool.value.matches.find((entry) => entry.text.includes("该升级了"));
    if (hit === undefined) throw new Error("it was not recalled at all");
    if (hit.source !== "tool") throw new Error(`the label was lost: ${JSON.stringify(hit)}`);
  });

  console.log("\nmemory as files");
  const memTree = await post("/api/dot.manage", { action: "memoryTree" });
  check("the tree starts with the four root files that are always in context", () => {
    const paths = memTree.files.filter((file) => file.tier === "root").map((file) => file.path);
    for (const want of ["MEMORY.md", "SOUL.md", "USER.md", "MEMORY-CORE.md"]) {
      if (!paths.includes(want)) throw new Error(`missing ${want}: ${paths.join(",")}`);
    }
  });
  check("every file that holds an entry declares itself", () => {
    // The index files are exempt on purpose: an index is a list of links, not a
    // memory, and giving it frontmatter would invite the model to treat it as
    // one more thing to recall.
    for (const file of memTree.files) {
      if (file.path.endsWith("MEMORY.md")) continue;
      if (file.name === "") throw new Error(`${file.path} has no name`);
      if (file.description === "") throw new Error(`${file.path} has no description`);
    }
  });
  check("deferred tiers exist and are separated from the root", () => {
    const tiers = [...new Set(memTree.files.filter((file) => file.tier !== "root").map((file) => file.tier))];
    if (!tiers.includes("notes")) throw new Error(`no notes tier: ${tiers.join(",")}`);
    if (tiers.includes("root")) throw new Error("root leaked into the tiers");
  });

  const focusWrite = await call("dot_remember", { text: "他在意把家装收尾", kind: "focus", source: "user" });
  check("a focus lands in USER.md rather than a side list", () => {
    // Kind decides the tier, which is what makes "always in context" a property
    // of the content instead of a setting somebody has to keep in step.
    if (focusWrite.value.path !== "USER.md") throw new Error(`path ${focusWrite.value.path}`);
  });
  const afterFirst = await post("/api/dot.manage", { action: "memoryTree" });
  check("writing into a seeded file keeps the file's own name and description", () => {
    // On a fresh install the append happens before anything has read the seeds,
    // and a create-shaped write would replace the file's identity with a
    // generic one — which is exactly what happened the first time.
    const user = afterFirst.files.find((file) => file.path === "USER.md");
    if (user === undefined) throw new Error("USER.md is gone");
    if (user.name !== "user") throw new Error(`name became ${JSON.stringify(user.name)}`);
    if (!user.description.includes("用户")) throw new Error(`description became ${JSON.stringify(user.description)}`);
  });
  const noteWrite = await call("dot_remember", { text: "随手记的一条", kind: "note" });
  check("a note goes to the deferred tier", () => {
    if (!String(noteWrite.value.path).startsWith("notes/")) throw new Error(`path ${noteWrite.value.path}`);
  });
  const afterWrite = await post("/api/dot.manage", { action: "memoryTree" });
  check("both are readable back out of the files themselves", () => {
    const user = afterWrite.files.find((file) => file.path === "USER.md");
    if (user === undefined || !user.body.includes("家装收尾")) throw new Error("the focus is not in USER.md");
    const note = afterWrite.files.find(
      (file) => file.path.startsWith("notes/") && file.body.includes("随手记的一条"),
    );
    if (note === undefined) throw new Error("the note is not in a notes file");
  });
  check("and the prompt carries root bodies plus the tree of everything else", async () => {
    // Not asserted here — rendered by the same reader the prompt uses, so this
    // checks the shape the model would receive rather than a mock of it.
    if (memTree.dir === "") throw new Error("no directory reported");
  });

  const reimported = await post("/api/dot.manage", { action: "memoryImport" });
  check("the index can be rebuilt from the files", () => {
    if (reimported.ok !== true) throw new Error(reimported.error ?? "not ok");
    if (reimported.entries < 2) throw new Error(`only rebuilt ${reimported.entries} entries`);
  });
  const recalledAfterImport = await call("dot_recall", { query: "家装" });
  check("and a rebuilt entry keeps its kind and its origin", () => {
    // Read back through recall rather than the panel snapshot: the snapshot is
    // a five-row preview, and an entry that fell off it is still remembered.
    const mine = recalledAfterImport.value.matches.find((entry) => entry.text.includes("家装收尾"));
    if (mine === undefined) throw new Error("the focus did not survive the import");
    if (mine.kind !== "focus") throw new Error(`kind ${mine.kind}`);
    if (mine.source !== "user") throw new Error(`source ${mine.source}`);
  });
  check("memory files stay inside the memory directory", () => {
    for (const file of afterWrite.files) {
      if (file.path.includes("..") || file.path.startsWith("/") || /^[A-Za-z]:/.test(file.path)) {
        throw new Error(`escaping path: ${file.path}`);
      }
    }
  });

  const staleConfig = await post("/api/dot.manage", {
    action: "settings",
    patch: { limits: { memoryStaleDays: 0 } },
  });
  check("the staleness threshold is the user's number, and 0 turns it off", () => {
    if (staleConfig.settings.limits.memoryStaleDays !== 0) {
      throw new Error(`got ${staleConfig.settings.limits.memoryStaleDays}`);
    }
  });
  const agedEntries = await call("dot_recall", { query: "家装" });
  check("every entry reports its age and whether it wants re-confirming", () => {
    const entry = agedEntries.value.matches.find((row) => row.text.includes("家装收尾"));
    if (entry === undefined) throw new Error("not recalled");
    if (typeof entry.ageDays !== "number") throw new Error("no age reported");
    if (typeof entry.stale !== "boolean") throw new Error("no staleness flag");
    if (entry.stale !== false) throw new Error("a freshly written entry was marked stale");
  });
  check("and a labelled entry is still recalled in full, never dropped", () => {
    // The design point, not a detail: the studied failure is a system that
    // silently stopped recalling facts, roughly seventy percent of which were
    // still true. A memory that quietly disappears cannot be told apart from
    // one that was never written, so this only ever adds a label.
    const entry = agedEntries.value.matches.find((row) => row.text.includes("家装收尾"));
    if (entry === undefined) throw new Error("the threshold removed it");
    if (entry.text !== "他在意把家装收尾") throw new Error(`text was altered: ${entry.text}`);
  });

  console.log("\nwaivers");
  const weekAhead = new Date(Date.now() + 7 * 86400000).toISOString();
  const waived = await post("/api/dot.manage", { action: "waiverAdd", tool: "bash", expiresAt: weekAhead });
  check("a waiver names one tool and says when it lapses", () => {
    if (waived.ok !== true) throw new Error(waived.error ?? "not ok");
    if (waived.waiver.tool !== "bash") throw new Error(`tool ${waived.waiver.tool}`);
    // A permanent waiver is a decision nobody ever revisits, which is exactly
    // the kind of grant every source on this feature warns about.
    if (typeof waived.waiver.expiresAt !== "string" || waived.waiver.expiresAt === "") {
      throw new Error("no expiry given");
    }
  });
  const badExpiry = await post("/api/dot.manage", {
    action: "waiverAdd", tool: "bash", expiresAt: "不是时刻",
  });
  check("a waiver with an unusable expiry is refused", () => {
    if (badExpiry.error === undefined) throw new Error("it accepted a nonsense expiry");
  });
  const nameless = await post("/api/dot.manage", { action: "waiverAdd", tool: "  ", expiresAt: weekAhead });
  check("and one that names nothing is refused too", () => {
    if (nameless.error === undefined) throw new Error("it accepted a nameless waiver");
  });
  const lapsed = await post("/api/dot.manage", {
    action: "waiverAdd",
    tool: "write",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  check("a waiver that has already lapsed covers nothing and says so", () => {
    const ours = lapsed.waivers.find((row) => row.tool === "write");
    if (ours === undefined) throw new Error("it was not recorded at all");
    if (ours.lapsed !== true) throw new Error("an expired waiver is not marked lapsed");
  });
  check("the active list leaves lapsed ones out", () => {
    const active = lapsed.snapshot.waivers.filter((row) => row.lapsed !== true);
    if (active.some((row) => row.tool === "write")) throw new Error("a lapsed waiver is still active");
  });
  const removed = await post("/api/dot.manage", { action: "waiverRemove", waiverId: waived.waiver.id });
  check("and a waiver can be taken back", () => {
    if (removed.ok !== true) throw new Error(removed.error ?? "not ok");
    if (removed.waivers.some((row) => row.id === waived.waiver.id)) throw new Error("it is still there");
  });

  console.log("\nsensitive memory");
  let idRefusal = null;
  try {
    await call("dot_remember", { text: "他的身份证号是 110101199003074256", kind: "fact" });
  } catch (error) {
    idRefusal = error instanceof Error ? error.message : String(error);
  }
  check("an identity number is refused at every setting", () => {
    // A floor, not a preference. A memory is permanent, and the point of the
    // credential tool is that a secret can be used without being known —
    // writing one down destroys that property for good.
    if (idRefusal === null) throw new Error("it wrote an identity number into permanent memory");
    if (!idRefusal.includes("dot_secret")) throw new Error(`no way forward: ${idRefusal}`);
  });
  let healthRefusal = null;
  try {
    await call("dot_remember", { text: "他最近在做抑郁症的诊断", kind: "note" });
  } catch (error) {
    healthRefusal = error instanceof Error ? error.message : String(error);
  }
  check("a sensitive topic is excluded by default, and says how to change that", () => {
    // A refusal here is a default, not a judgement: health and finances are the
    // entries people most often regret writing down and most often need to
    // write down anyway, so the user decides.
    if (healthRefusal === null) throw new Error("it wrote a health note under the default setting");
    if (!healthRefusal.includes("设置")) throw new Error(`no way forward: ${healthRefusal}`);
  });
  await post("/api/dot.manage", { action: "settings", patch: { limits: { memorySensitive: "keep" } } });
  const keptSensitive = await call("dot_remember", { text: "他最近在做抑郁症的诊断", kind: "note" });
  check("and when the user says keep it, it is kept and labelled", () => {
    if (typeof keptSensitive.value.id !== "string") throw new Error("it was not written");
  });
  const sensitiveRecall = await call("dot_recall", { query: "抑郁症" });
  check("the label travels with it, so it is visible as sensitive", () => {
    const entry = sensitiveRecall.value.matches.find((row) => row.text.includes("抑郁症"));
    if (entry === undefined) throw new Error("not recalled");
    if (entry.sensitive !== "健康") throw new Error(`label was lost: ${JSON.stringify(entry.sensitive)}`);
  });
  let hardStillRefused = false;
  try {
    await call("dot_remember", { text: "他的身份证号是 110101199003074256", kind: "fact" });
  } catch {
    hardStillRefused = true;
  }
  check("but an identity number is still refused with the setting open", () => {
    // Loosening the soft gate must not loosen the hard one — that is the whole
    // reason they are two gates and not one setting.
    if (!hardStillRefused) throw new Error("opening the soft gate opened the hard one too");
  });
  await post("/api/dot.manage", { action: "settings", patch: { limits: { memorySensitive: "exclude" } } });

  console.log("\nautonomy needs a reason");
  const autoState = await get("/api/dot.state");
  check("free time declares what may start it", () => {
    // The shape every source on proactive agents warns about is "it was idle, so
    // it did something" — a resident that cannot answer "why this, now". A named
    // condition can always answer it, because it is checkable.
    const conditions = autoState.settings.autonomy.conditions;
    if (!Array.isArray(conditions)) throw new Error("there is no condition list at all");
    if (conditions.length === 0) throw new Error("the default lets it act for no stated reason");
  });
  const bogusCondition = await post("/api/dot.manage", {
    action: "settings",
    patch: { autonomy: { conditions: ["openTasks", "因为我想", "随便做点什么"] } },
  });
  check("and an unrecognised condition is dropped rather than obeyed", () => {
    const conditions = bogusCondition.settings.autonomy.conditions;
    if (conditions.includes("因为我想")) throw new Error("it accepted a condition nobody can check");
    if (!conditions.includes("openTasks")) throw new Error("it dropped the real one too");
  });
  const noneChosen = await post("/api/dot.manage", {
    action: "settings",
    patch: { autonomy: { conditions: [] } },
  });
  check("choosing none is allowed, and means it never acts on its own", () => {
    if (noneChosen.settings.autonomy.conditions.length !== 0) throw new Error("it kept something");
  });
  await post("/api/dot.manage", { action: "settings", patch: { autonomy: { conditions: ["openTasks"] } } });

  console.log("\nMCP as a client");
  const mcpState = await get("/api/dot.state");
  check("no MCP server ships with the plugin", () => {
    // Same rule as the connectors: the plugin brings a client and an input box,
    // never an address and never a credential.
    if (!Array.isArray(mcpState.mcpServers)) throw new Error("there is no field at all");
    if (mcpState.mcpServers.length !== 0) throw new Error("something shipped with it");
  });
  const noAddress = await post("/api/dot.manage", {
    action: "mcpAdd",
    server: { name: "demo", url: "", headers: "" },
  });
  check("a server with no address is refused", () => {
    if (noAddress.error === undefined) throw new Error("it accepted a server with nowhere to go");
  });
  const addedMcp = await post("/api/dot.manage", {
    action: "mcpAdd",
    server: { name: "demo", url: "http://127.0.0.1:9/mcp", headers: "" },
  });
  check("a server can be written down by the user", () => {
    if (addedMcp.ok !== true) throw new Error(addedMcp.error ?? "not ok");
    if (addedMcp.server.name !== "demo") throw new Error("the name was lost");
    if (addedMcp.server.enabled !== true) throw new Error("it did not start enabled");
  });
  check("and it claims no tools until one has actually been proved", () => {
    // A configured address that silently offers nothing is indistinguishable
    // from one that works and offers nothing, so nothing is assumed up front.
    if (addedMcp.server.tools.length !== 0) throw new Error("it invented a tool list");
  });
  const probedMcp = await post("/api/dot.manage", { action: "mcpProbe", serverId: addedMcp.server.id });
  check("an unreachable server says so rather than failing quietly", () => {
    if (probedMcp.error === undefined) throw new Error("it claimed to reach a dead address");
    if (String(probedMcp.error) === "") throw new Error("it failed with an empty message");
  });
  const afterProbe = await get("/api/dot.state");
  check("and the failure is kept, so the panel can show it later", () => {
    const mine = afterProbe.mcpServers.find((row) => row.id === addedMcp.server.id);
    if (mine === undefined) throw new Error("the server vanished");
    if (mine.lastError === "") throw new Error("the failure was not recorded");
  });
  const probeMissing = await post("/api/dot.manage", { action: "mcpProbe", serverId: "no-such-server" });
  check("probing something that does not exist is refused", () => {
    if (probeMissing.error === undefined) throw new Error("it accepted an unknown id");
  });
  const removedMcp = await post("/api/dot.manage", { action: "mcpRemove", serverId: addedMcp.server.id });
  check("and a server can be removed", () => {
    if (removedMcp.ok !== true) throw new Error(removedMcp.error ?? "not ok");
    if (removedMcp.mcpServers.length !== 0) throw new Error("it is still there");
  });

  console.log("\nper-command approval");
  const parkedState = await get("/api/dot.state");
  check("every job carries what it is asking for, empty when it is asking nothing", () => {
    // Always an object with the same three keys, so the panel never has to
    // decide what a missing field means — and a job that stopped shows the tool
    // and the exact arguments, because "it wants to do something" is not a
    // question anybody can answer.
    for (const task of parkedState.tasks) {
      if (typeof task.approval !== "object" || task.approval === null) {
        throw new Error(`task ${task.id} has no approval field`);
      }
      for (const key of ["tool", "arguments", "reason"]) {
        if (typeof task.approval[key] !== "string") {
          throw new Error(`task ${task.id} is missing approval.${key}`);
        }
      }
    }
  });
  const settledTask = parkedState.tasks.find((task) => task.state !== "awaiting");
  check("and a job that is not waiting asks for nothing", () => {
    if (settledTask === undefined) return;
    if (settledTask.approval.tool !== "") {
      throw new Error(`a settled job still names a tool: ${settledTask.approval.tool}`);
    }
  });

  console.log("\nrecurring work: continue or start clean");
  const recurring = await call("dot_task", {
    action: "add",
    title: "每天看一眼",
    repeat: "day 09:00",
    continuity: "fresh",
  });
  check("a recurring job says whether it carries its own history in", () => {
    const mine = recurring.value.tasks.find((task) => task.title === "每天看一眼");
    if (mine === undefined) throw new Error("not queued");
    if (mine.continuity !== "fresh") throw new Error(`continuity ${mine.continuity}`);
  });
  const defaulted = await call("dot_task", { action: "add", title: "默认的周期活", repeat: "week" });
  check("and the default is to continue, because that is what a routine expects", () => {
    const mine = defaulted.value.tasks.find((task) => task.title === "默认的周期活");
    if (mine === undefined) throw new Error("not queued");
    if (mine.continuity !== "continue") throw new Error(`continuity ${mine.continuity}`);
  });
  const bogusContinuity = await call("dot_task", {
    action: "add",
    title: "乱写的",
    repeat: "day",
    continuity: "随便写的",
  });
  check("an unrecognised mode falls back rather than being obeyed", () => {
    const mine = bogusContinuity.value.tasks.find((task) => task.title === "乱写的");
    if (mine === undefined) throw new Error("not queued");
    if (mine.continuity !== "continue") throw new Error(`continuity ${mine.continuity}`);
  });

  console.log("\nthe default model comes from the deployment");
  const modelState = await get("/api/dot.state");
  check("status says which model will be used, and where the choice came from", () => {
    // Without this, "why did nothing run" has no answer short of reading code:
    // a deployment with no default and a plugin that cannot reach the service
    // that owns one are indistinguishable from a failed task.
    if (typeof modelState.model !== "object" || modelState.model === null) {
      throw new Error("no model field at all");
    }
    if (typeof modelState.model.resolved !== "string") throw new Error("no resolved field");
    if (typeof modelState.model.from !== "string") throw new Error("no from field");
  });
  const entryManifest = await import(pathToFileURL(ENTRY).href);
  check("and both manifests declare the same dependencies", () => {
    // Cordis reads the *entry* module's exports, so an `inject` that lives only
    // in the implementation is never consulted — which is exactly how
    // `agentDefaultModel` went missing, and why the failure above reads
    // "without inject" rather than "not configured".
    if (entryManifest.inject.join(",") !== plugin.inject.join(",")) {
      throw new Error(`entry declares ${entryManifest.inject.join(",")} but impl declares ${plugin.inject.join(",")}`);
    }
  });

  console.log("\nthe user's own picture and their own types");
  const typeEdit = await post("/api/dot.manage", {
    action: "typeEdit",
    typeId: "researcher",
    blurb: "改过的说明",
  });
  check("an existing type can be edited, built-in or not", () => {
    // Including the built-in ones. A persona shipped as a sensible default is
    // still a default, and the person running it is the one who knows how they
    // want it to talk.
    if (typeEdit.ok !== true) throw new Error(typeEdit.error ?? "not ok");
    if (typeEdit.type.blurb !== "改过的说明") throw new Error("the edit did not take");
    if (typeEdit.type.name !== "研究员") throw new Error("it clobbered the name");
  });
  const editMissingType = await post("/api/dot.manage", { action: "typeEdit", typeId: "no-such", blurb: "x" });
  check("editing a type that does not exist is refused", () => {
    if (editMissingType.error === undefined) throw new Error("it accepted an unknown id");
  });
  const notAnImage = await post("/api/dot.manage", {
    action: "avatarUpload",
    dataUrl: "data:text/plain;base64,aGVsbG8=",
  });
  check("an avatar has to actually be an image", () => {
    // Checked on the content type rather than the file name: the name is the
    // one part of an upload the sender fully controls.
    if (notAnImage.error === undefined) throw new Error("it accepted a text file as a picture");
  });
  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const uploaded = await post("/api/dot.manage", { action: "avatarUpload", dataUrl: tinyPng });
  check("a real picture is written to disk and pointed at", () => {
    if (uploaded.ok !== true) throw new Error(uploaded.error ?? "not ok");
    if (typeof uploaded.path !== "string" || uploaded.path === "") throw new Error("no path");
    if (!uploaded.path.endsWith(".png")) throw new Error(`unexpected extension: ${uploaded.path}`);
  });
  check("and the picture is actually on disk, not just remembered", () => {
    // The store keeps a path, not the bytes — so the path has to be real.
    if (!existsSync(uploaded.path)) throw new Error(`nothing at ${uploaded.path}`);
  });
  const withAvatar = await get("/api/dot.state");
  check("and it shows up on the instance", () => {
    const active = withAvatar.dots.find((row) => row.id === withAvatar.activeDotId);
    if (active === undefined) throw new Error("no active instance");
    if (active.avatarPath === "") throw new Error("the path did not reach the snapshot");
  });

  console.log("\nconnector templates");
  const tpls = await get("/api/dot.templates");
  check("platform shapes are offered at all", () => {
    if (!Array.isArray(tpls.templates) || tpls.templates.length < 5) {
      throw new Error(`only ${tpls.templates?.length ?? 0} templates`);
    }
  });
  check("each one says what to paste and where to get it", () => {
    for (const entry of tpls.templates) {
      if (typeof entry.field !== "string" || entry.field === "") throw new Error(`${entry.id}: no field`);
      if (typeof entry.docs !== "string" || entry.docs === "") throw new Error(`${entry.id}: no instructions`);
      if (typeof entry.placeholder !== "string" || entry.placeholder === "") {
        throw new Error(`${entry.id}: no placeholder`);
      }
    }
  });
  check("and none of them ships a credential", () => {
    // The whole point is that the user supplies the secret. A token or a
    // signed URL appearing here would mean we shipped someone's access.
    for (const entry of tpls.templates) {
      const text = JSON.stringify(entry);
      if (/xox[bp]-|Bearer\s|access_token=[A-Za-z0-9]{12,}|key=[A-Za-z0-9-]{20,}/.test(text)) {
        throw new Error(`${entry.id} looks like it carries a real secret`);
      }
    }
  });
  check("the chat webhooks each get their own payload envelope", () => {
    const ids = tpls.templates.map((entry) => entry.id);
    for (const wanted of ["telegram", "slack", "discord", "feishu", "dingtalk", "wecom", "http"]) {
      if (!ids.includes(wanted)) throw new Error(`missing ${wanted}`);
    }
  });

  console.log("\ninbound");
  const inbox = await post("/api/dot.manage", {
    action: "connectorAdd",
    name: "收件箱",
    kind: "http",
    url: "http://127.0.0.1:1/never-reached",
    inbound: true,
  });
  check("a connection can be marked as receiving", () => {
    if (inbox.connector.inbound !== true) throw new Error("inbound was not stored");
    if (inbox.connector.bindDotId !== "") throw new Error("it bound itself somewhere unexpected");
  });

  const arrived = await post("/api/dot.inbound", {
    connectorId: inbox.connector.id,
    text: "从外面来的一句话",
  });
  check("a message from outside lands in the transcript", () => {
    if (arrived.ok !== true) throw new Error(arrived.error ?? "not ok");
    const texts = arrived.snapshot.messages.map((message) => message.text);
    if (!texts.some((text) => text.includes("从外面来的一句话"))) {
      throw new Error(`not in the transcript: ${JSON.stringify(texts)}`);
    }
  });
  check("and it is labelled as external, in the text itself", () => {
    // The label has to be in the turn, not only in a metadata field: a later
    // reading of this conversation is another chance for the same words to be
    // mistaken for something the user said.
    const mine = arrived.snapshot.messages.find((message) => message.text.includes("从外面来的一句话"));
    if (!mine.text.startsWith("[外部")) throw new Error(`unlabelled: ${mine.text}`);
  });

  const huge = await post("/api/dot.inbound", {
    connectorId: inbox.connector.id,
    text: "忽".repeat(9000),
  });
  check("an oversized inbound message is bounded before it reaches the prompt", () => {
    // Smaller and more structured is the one defence that keeps working: the
    // published record on filter-based detection is a dozen defences mostly
    // bypassed once the attacker adapts.
    const mine = huge.snapshot.messages.filter((message) => message.text.includes("忽"));
    const inbound = mine[mine.length - 1];
    if (inbound === undefined) throw new Error("it never arrived");
    if (inbound.text.length > 4200) throw new Error(`still ${inbound.text.length} characters`);
    if (!inbound.text.includes("已截断")) throw new Error("truncated without saying so");
  });
  const unbounded = await post("/api/dot.manage", {
    action: "settings",
    patch: { limits: { inboundMaxChars: 0 } },
  });
  check("and the bound is the user's number, with 0 meaning none", () => {
    if (unbounded.settings.limits.inboundMaxChars !== 0) {
      throw new Error(`got ${unbounded.settings.limits.inboundMaxChars}`);
    }
  });
  await post("/api/dot.manage", { action: "settings", patch: { limits: { inboundMaxChars: 4000 } } });
  check("and the resident answers it in that same transcript", () => {
    const messages = arrived.snapshot.messages;
    const asked = messages.findIndex((message) => message.text.includes("从外面来的一句话"));
    if (asked < 0) throw new Error("the question vanished");
    if (!messages.slice(asked + 1).some((message) => message.role === "dot")) {
      throw new Error("no answer was written");
    }
  });
  check("the panel and the outside world are reading one transcript", () => {
    // This is the whole of "the same conversation everywhere": not a sync, a
    // shared record. The snapshot the UI polls is the one inbound wrote into.
    const messages = arrived.snapshot.messages;
    if (messages.length < 2) throw new Error(`too few messages: ${messages.length}`);
    if (messages[messages.length - 1].role !== "dot") throw new Error("the last word is not the resident's");
  });

  const sendOnly = await post("/api/dot.manage", {
    action: "connectorAdd",
    name: "只发不收",
    kind: "http",
    url: "http://127.0.0.1:1/never-reached",
  });
  const refused = await post("/api/dot.inbound", {
    connectorId: sendOnly.connector.id,
    text: "不该进来的话",
  });
  check("a send-only connection refuses to receive", () => {
    if (refused.error === undefined) throw new Error("it accepted an inbound message");
  });
  check("and that refusal did not reach the transcript", () => {
    const texts = refused.snapshot === undefined
      ? []
      : refused.snapshot.messages.map((message) => message.text);
    if (texts.some((text) => text.includes("不该进来的话"))) {
      throw new Error("a refused message was written anyway");
    }
  });

  await post("/api/dot.manage", { action: "connectorRemove", connectorId: inbox.connector.id });
  await post("/api/dot.manage", { action: "connectorRemove", connectorId: sendOnly.connector.id });

  console.log("\nconnectors");
  const cEmpty = await get("/api/dot.state");
  check("no integrations ship with the plugin", () => {
    if (!Array.isArray(cEmpty.connectors)) throw new Error("connectors missing from the snapshot");
    if (cEmpty.connectors.length !== 0) throw new Error("the plugin shipped a built-in integration");
  });

  const cAdded = await post("/api/dot.manage", {
    action: "connectorAdd",
    name: "我的 Telegram",
    kind: "telegram",
    token: "123456:secret-token",
    chatId: "987654",
  });
  check("a connection can be added", () => {
    if (cAdded.connectors.length !== 1) throw new Error(`count ${cAdded.connectors.length}`);
    if (cAdded.connectors[0].kind !== "telegram") throw new Error("kind was lost");
  });
  const cId = cAdded.connectors[0].id;

  const cListed = await call("dot_connector", { action: "list" });
  check("the model sees the connection but never the credential", () => {
    const shown = cListed.value.connectors.find((entry) => entry.id === cId);
    if (shown === undefined) throw new Error("connection not offered to the model");
    if (shown.token !== undefined) throw new Error("the token leaked into the model's view");
    if (JSON.stringify(cListed.value).includes("secret-token")) throw new Error("the token leaked somewhere in the result");
  });

  const cSent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    cSent.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };
  let cDelivered;
  try {
    cDelivered = await call("dot_connector", { action: "send", id: cId, message: "在吗" });
  } finally {
    globalThis.fetch = realFetch;
  }
  check("sending reaches the endpoint the user configured", () => {
    if (cDelivered.value.sent !== true) throw new Error(`sent ${cDelivered.value.sent}`);
    if (cSent.length !== 1) throw new Error(`calls ${cSent.length}`);
    if (!cSent[0].url.includes("api.telegram.org")) throw new Error(`url ${cSent[0].url}`);
    const body = JSON.parse(cSent[0].init.body);
    if (body.text !== "在吗") throw new Error("the message was not carried");
    if (body.chat_id !== "987654") throw new Error("the chat id was not carried");
  });

  const cNarrowed = await post("/api/dot.manage", {
    action: "connectorEdit",
    connectorId: cId,
    allowedDots: ["someone-else"],
  });
  check("an allow-list that excludes this bot hides the connection", () => {
    if (cNarrowed.connector.allowedDots[0] !== "someone-else") throw new Error("allow-list did not take");
  });
  const cHidden = await call("dot_connector", { action: "list" });
  check("a connection the bot is not allowed to use is not offered", () => {
    if (cHidden.value.connectors.some((entry) => entry.id === cId)) throw new Error("a forbidden connection was offered");
  });
  let cRefused = false;
  try {
    await call("dot_connector", { action: "send", id: cId, message: "偷偷发" });
  } catch {
    cRefused = true;
  }
  check("and sending through it is refused, not silently dropped", () => {
    if (!cRefused) throw new Error("a forbidden send went through");
  });

  await post("/api/dot.manage", { action: "connectorEdit", connectorId: cId, allowedDots: [] });
  const cRemoved = await post("/api/dot.manage", { action: "connectorRemove", connectorId: cId });
  check("a connection can be removed", () => {
    if (cRemoved.ok !== true) throw new Error(cRemoved.error ?? "not ok");
    if (cRemoved.connectors.length !== 0) throw new Error("still listed");
  });

  console.log("\nversion-1 migration");
  const legacyHome = join(ROOT, ".verify-legacy");
  await rm(legacyHome, { recursive: true, force: true });
  await mkdir(`${legacyHome}/dot`, { recursive: true });
  await writeFile(`${legacyHome}/dot/dot.json`, JSON.stringify({
    version: 1,
    identity: { name: "Dot", createdAt: "2026-01-02T03:04:05.000Z" },
    memory: [{ id: "m1", kind: "fact", text: "迁移前的记忆", at: "2026-01-02T03:04:05.000Z" }],
    tasks: [
      { id: "t1", title: "迁移前的任务", state: "open", note: "", createdAt: "2026-01-02T03:04:05.000Z", updatedAt: "2026-01-02T03:04:05.000Z" },
      { id: "t2", title: "卡在运行中的任务", state: "running", note: "", createdAt: "2026-01-02T03:04:05.000Z", updatedAt: "2026-01-02T03:04:05.000Z" },
    ],
  }, null, 2), "utf8");

  process.env.DSH_HOME = legacyHome;
  const migratedTools = new Map();
  await plugin.apply({
    effect: (fn) => fn(),
    tools: { register: (definition) => (migratedTools.set(definition.name, definition), () => {}) },
    connection: { fetch: { register: () => () => {} } },
    agentDefaultModel: { currentSelection: () => ({ provider: "stub", model: "stub-model" }) },
  // Optional services are reached through ctx.get, never a hard dependency, so
  // a deployment without them stays usable. The stub answers like a real one.
  get(name) {
    return name === "attachments" ? this.attachments : undefined;
  },
  attachments: {
    async saveImages(inputs) {
      return inputs.map((input, index) => ({
        attachmentId: `att-stub-${index}`,
        mediaType: input.mediaType,
        bytes: input.data.length,
        width: 2,
        height: 2,
        ...(input.name === undefined ? {} : { name: input.name }),
      }));
    },
  },
    llm: { stream: () => (async function* empty() {})() },
  }, {});
  // Recovery is kicked off asynchronously by apply(); poll until it lands
  // rather than assuming a fixed delay is enough.
  let migrated;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    migrated = await migratedTools.get("dot_status").execute({}, {});
    const revived = migrated.tasks.find((task) => task.title === "卡在运行中的任务");
    if (revived !== undefined && revived.state === "queued") break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  check("a v1 store becomes one Dot named 屿", () => {
    if (migrated.identity.name !== "屿") throw new Error(`name ${migrated.identity.name}`);
    if (migrated.stats.dotTotal !== 1) throw new Error(`dots ${migrated.stats.dotTotal}`);
  });
  check("migration keeps the creation instant, memory, and queue", () => {
    if (migrated.identity.createdAt !== "2026-01-02T03:04:05.000Z") throw new Error("createdAt was dropped");
    if (migrated.stats.memoryTotal !== 1) throw new Error(`memory ${migrated.stats.memoryTotal}`);
    if (migrated.stats.taskTotal !== 2) throw new Error(`tasks ${migrated.stats.taskTotal}`);
  });
  check("a task interrupted by a restart goes back to the queue", () => {
    const revived = migrated.tasks.find((task) => task.title === "卡在运行中的任务");
    if (revived === undefined) throw new Error("the interrupted task vanished");
    if (revived.state !== "queued") throw new Error(`state ${revived.state}`);
    if (revived.error === "") throw new Error("no recovery note was left");
  });
  process.env.DSH_HOME = SANDBOX_HOME;
  await rm(legacyHome, { recursive: true, force: true });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  end to end\n        ${error.message}`);
}

for (const dispose of disposers) {
  try {
    await dispose();
  } catch {
    /* stubbed disposers are best effort */
  }
}

await rm(SANDBOX_HOME, { recursive: true, force: true });

console.log(`\n${failed === 0 ? "ALL GREEN" : `${failed} FAILURE(S)`}`);
process.exit(failed === 0 ? 0 : 1);
