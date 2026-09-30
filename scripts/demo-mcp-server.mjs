/**
 * 一个最小但完整的 MCP server，用来证明客户端真的能工作。
 *
 * 它故意不依赖任何 MCP SDK：如果客户端和它通了，那说明双方都按规范说话，
 * 而不是因为我们用了同一份库。协议面只实现三个方法，正好是客户端会用到的：
 * initialize / tools/list / tools/call。
 *
 * 跑法：
 *   node demo-mcp-server.mjs 8787
 * 然后在设置里把 http://127.0.0.1:8787/mcp 加进 MCP 服务。
 */

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8787);

/** 这个 server 提供的工具。故意有一个需要参数的、一个不需要的。 */
const TOOLS = {
  add: {
    description: "把两个数相加，返回结果。",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
    run: (args) => `${args.a} + ${args.b} = ${Number(args.a) + Number(args.b)}`,
  },
  clock: {
    description: "返回服务器当前的时间（ISO 8601）。",
    inputSchema: { type: "object", properties: {} },
    run: () => new Date().toISOString(),
  },
  reverse: {
    description: "把一段文字倒过来。",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    run: (args) => [...String(args.text)].reverse().join(""),
  },
};

/** 一个 JSON-RPC 应答。 */
function reply(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function error(id, message) {
  return { jsonrpc: "2.0", id, error: { code: -32000, message } };
}

function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "dot-demo", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") {
    return reply(id, {
      tools: Object.entries(TOOLS).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  }
  if (method === "tools/call") {
    const tool = TOOLS[params?.name];
    if (tool === undefined) return error(id, `没有名为 ${params?.name} 的工具`);
    try {
      return reply(id, { content: [{ type: "text", text: tool.run(params?.arguments ?? {}) }] });
    } catch (failure) {
      return reply(id, {
        isError: true,
        content: [{ type: "text", text: `执行失败：${failure.message}` }],
      });
    }
  }
  return error(id, `不认识的方法 ${method}`);
}

const server = createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify(error(null, "请求不是合法 JSON")));
      return;
    }
    console.log(`← ${message.method}${message.params?.name === undefined ? "" : ` (${message.params.name})`}`);
    const answer = handle(message);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(answer ?? { jsonrpc: "2.0", id: message.id, result: {} }));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`demo MCP server 在 http://127.0.0.1:${port}/mcp`);
  console.log(`工具：${Object.keys(TOOLS).join("、")}`);
});
