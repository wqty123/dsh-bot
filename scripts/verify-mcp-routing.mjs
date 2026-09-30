/**
 * 验证 bot 执行 MCP 工具的那条路。
 *
 * 这一层不经过模型：模型只是决定「调哪个」，真正把 `mcp__服务器__工具` 翻译成
 * JSON-RPC 的是宿主。所以这里可以把它单独拎出来跑，看到确定的结果。
 */

process.env.DSH_HOME ??= join(dirname(fileURLToPath(import.meta.url)), "..", ".verify-mcp-home");

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(join(ROOT, "impl.js")).href;

const servers = [{
  id: "demo-1",
  name: "dot-demo",
  url: "http://127.0.0.1:8787/mcp",
  headers: "",
  enabled: true,
  tools: ["add", "clock", "reverse"],
}];

const main = async () => {
  const mod = await import(url);

  // apply() 没有被调用过，所以这里拿不到真正注册的工具；改从注册表里取。
  // 用一个最小 ctx 让 apply 跑起来，它只做注册和挂路由，不会启动任何东西。
  const registered = [];
  const ctx = {
    tools: { register: (tool) => registered.push(tool), execute: async () => ({}) },
    get: () => undefined,
    on: () => {},
    effect: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  try {
    await mod.apply(ctx, {});
  } catch (error) {
    console.log(`apply 抛了（可能缺服务）：${error.message}`);
  }
  console.log(`注册的工具：${registered.map((t) => t.name).join("、") || "(无)"}`);
  console.log("");

  // 直接走宿主那条路由，不经过模型。
  const path = join(ROOT, "impl.js");
  const fresh = await import(`${pathToFileURL(path).href}?t=${Date.now()}`);
  console.log("=== 通过 mcp__ 前缀调用（宿主侧路由，无需模型）===");
  const cases = [
    ["mcp__dot-demo__add", { a: 17, b: 25 }],
    ["mcp__dot-demo__reverse", { text: "点个赞" }],
    ["mcp__dot-demo__clock", {}],
    ["mcp__dot-demo__no-such-tool", {}],
    ["mcp__no-such-server__add", { a: 1, b: 2 }],
  ];
  for (const [name, args] of cases) {
    const result = await fresh.runResidentTool(ctx, name, args, undefined, undefined, servers);
    console.log(`  ${name.padEnd(30)} → ${String(result).slice(0, 70)}`);
  }
};

main().catch((error) => console.log(`ERROR: ${error.message}`));
