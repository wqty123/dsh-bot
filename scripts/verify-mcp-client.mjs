/**
 * 用插件自己的 MCP 客户端，去连一个真的 MCP server，看它到底能不能用。
 *
 * 这不是单元测试——那些用的是桩。这是把真客户端指向真服务端，走完整的
 * JSON-RPC 往返，看两边是不是真的按同一份规范说话。
 */

process.env.DSH_HOME ??= join(dirname(fileURLToPath(import.meta.url)), "..", ".verify-mcp-home");

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(join(ROOT, "impl.js")).href;

const server = {
  id: "demo-1",
  name: "dot-demo",
  url: "http://127.0.0.1:8787/mcp",
  headers: "",
};

const main = async () => {
  const m = await import(url);

  console.log("=== 用插件自己的客户端列工具 ===");
  const tools = await m.mcpListTools(server);
  for (const tool of tools) console.log(`  ${tool.name} — ${tool.description}`);

  console.log("");
  console.log("=== 用它调用 ===");
  console.log(`  add(17, 25)        → ${await m.mcpRunTool(server, "add", { a: 17, b: 25 })}`);
  console.log(`  reverse("点个赞")  → ${await m.mcpRunTool(server, "reverse", { text: "点个赞" })}`);
  console.log(`  clock()            → ${await m.mcpRunTool(server, "clock", {})}`);

  console.log("");
  console.log("=== 出错时会怎么样 ===");
  try {
    await m.mcpRunTool(server, "no-such-tool", {});
    console.log("  它居然返回了成功——这是错的");
  } catch (error) {
    console.log(`  抛出：${error.message}`);
  }

  console.log("");
  console.log("=== 服务不存在时 ===");
  try {
    await m.mcpListTools({ ...server, url: "http://127.0.0.1:9/mcp" });
    console.log("  它居然通了——这是错的");
  } catch (error) {
    console.log(`  抛出：${error.message}`);
  }
};

main().catch((error) => console.log(`ERROR: ${error.message}`));
