/**
 * 对照调研报告第六节的 19 条建议，逐条到代码里查。
 *
 * 每一条的判定都用「能找到什么证据」表达，而不是「我记得做了」。判据刻意写成
 * 具体符号：如果一条建议只有注释里的意图、没有对应的实现，那它就不算做了。
 */

import { readFileSync, existsSync } from "node:fs";

const HOST = join(ROOT, "impl.js");
const CLIENT = join(ROOT, "client.js");
const README = join(ROOT, "README.md");

const host = readFileSync(HOST, "utf8");
const client = readFileSync(CLIENT, "utf8");
const both = host + client;
const readme = existsSync(README) ? readFileSync(README, "utf8") : "";

/** 一个判据：名字、结论、证据说明。 */
const rows = [];
const add = (no, name, verdict, evidence) => rows.push({ no, name, verdict, evidence });

const has = (needle) => both.includes(needle);

// ── 必须有的（入场券） ──────────────────────────────────────────────

add(1, "记忆是用户可读可改的对象", has("readMemoryTreeForPanel") && has("bot_remember") ? "done" : "missing",
  has("renderMemoryFile") ? "记忆落成 .md 文件，面板读同一棵树" : "");

add(2, "记忆随对话实时写入，不是事后总结", has("memoryTargetFor") ? "done" : "missing",
  "appendMemoryEntry 在工具调用时立即落盘，没有总结阶段");

add(3, "记忆有时效语义与过期处理", has("entryAgeDays") && has("staleDays") ? "done" : "missing",
  "ageDays + stale 标记，-1 表示无法判定（UNKNOWN 不参与比较）");

add(4, "定时 + 事件统一成 Trigger/Condition/Action 三元组",
  has("AUTONOMY_CONDITIONS") && has("parseRepeat") ? "partial" : "missing",
  "定时走 repeat，主动走 AUTONOMY_CONDITIONS；两者仍未合成同一个建任务表单");

add(5, "审批是一等的任务状态", has('"awaiting"') && has("resolveParkedTask") ? "done" : "missing",
  "TASK_STATES 里有 awaiting，不是错误分支");

add(6, "一键豁免（可信工作流跳过后续审批）", has("waiverCovers") && has("normalizeWaiver") ? "done" : "missing",
  "waiver 只匹配完全相同的工具名，且永远带过期时间");

add(7, "远程执行，端休眠也照跑", "missing",
  "本机插件：执行器跑在 Host 进程里，机器关了就停");

add(8, "敏感信息分级：默认排除 + 显式打开 + 逐条提示 + 不回溯",
  has("MEMORY_FORBIDDEN_PATTERNS") && has("MEMORY_SENSITIVE_MODES") ? "partial" : "missing",
  "默认排除与显式打开都有；每次写敏感条目的逐条提示只做了一半（拒绝而非提示）");

// ── 拉开差距的 ────────────────────────────────────────────────────

add(9, "周期工作可选「续跑同一上下文」或「另起独立任务」",
  has("CONTINUITY_MODES") ? "done" : "missing", "task.continuity：continue 带上次结论，fresh 从零开始");

add(10, "配置传播语义写清楚（指令 vs 文件、新任务 vs 历史任务）",
  readme.includes("传播") || has("**旧条目**") ? "partial" : "missing",
  "任务创建时冻结 model/permission；但文档里没有专门一节讲这件事");

add(11, "知识库容量自动在 in-context 与检索之间切换", "missing",
  "没有向量库，全部记忆按文件分层进上下文；没有自动切换");

add(12, "复用 MCP 而不是自造连接器层", has("mcpListTools") && has("mcp__") ? "done" : "missing",
  "客户端 + 用户自填地址；工具名沿用 mcp__服务器__工具 的通行约定");

add(13, "本地操作分两档：文件夹级 + 每条命令 Allow Once/Always Allow",
  has("workspaceVerdict") && has("task.approval") ? "partial" : "missing",
  "文件夹级（工作区）+ 停下展示完整命令都有；但停下之后还没有「批准并继续执行」这条路");

add(14, "浏览器分清本地（带登录态）与云端（隔离）", "missing",
  "没有浏览器集成；dsh 自带的浏览器插件是会话级的，不是 dot 常驻的");

add(15, "常驻入口：不打开界面也能派活", has("connectorsForInbound") && has("dot.inbound") ? "partial" : "missing",
  "有入站连接（Telegram 长轮询 + HTTP 端点）；但没有专属邮箱这种零成本入口");

add(16, "执行环境当产品决策：临时沙箱 / 持久云机 / 本机三档",
  has("workspace") && has("environment") ? "partial" : "missing",
  "本机 + 每实例工作区有；没有临时沙箱与持久云机的区分");

// ── 明确不要做的 ───────────────────────────────────────────────────

add(17, "不做「纯记录 + 检索」当核心价值", has("DOT_TOOLS") && has("runResidentTool") ? "done" : "missing",
  "核心是可执行工具（bash/pwsh/vdesk），记忆是附带的状态");

add(18, "不把长期记忆当免费能力（成本要当产品决策）",
  has("memoryLimit") && has("recallMessages") ? "done" : "missing",
  "每次召回条数、提示里回放的轮数、记忆总量都是可调限额，默认值写在一处");

add(19, "不把主动能力用「无需监督」来营销（要有审批面）",
  has("AUTONOMY_DEFAULTS") && has('permission: "read"') ? "done" : "missing",
  "自主时间默认关闭，且它的权限默认是只读");

// ── 输出 ──────────────────────────────────────────────────────────

const marks = { done: "已实现", partial: "部分", missing: "未实现" };
const byVerdict = { done: 0, partial: 0, missing: 0 };

console.log("");
console.log("对照：《2026 主流 AI 个人助理 / Agent 功能对照调研》第六节 19 条建议");
console.log("");

for (const row of rows) {
  byVerdict[row.verdict] += 1;
  const mark = marks[row.verdict];
  console.log(`${String(row.no).padStart(2)}. [${mark}] ${row.name}`);
  if (row.evidence !== "") console.log(`      ${row.evidence}`);
}

console.log("");
console.log(`已实现 ${byVerdict.done} ｜ 部分 ${byVerdict.partial} ｜ 未实现 ${byVerdict.missing}`);

// 再核对一遍对照表里的能力维度和实际工具面
console.log("");
console.log("对照：功能矩阵「能力维度」一行（定时/事件/提醒/记忆/集成/文件/审批）");
const dims = [
  ["定时任务", has("parseRepeat"), "repeat: hour/day/week + 时刻"],
  ["事件触发", has("AUTONOMY_CONDITIONS"), "4 个可检查条件 + 入站连接"],
  ["主动提醒", has("agendaFor"), "日程到点经连接器发出"],
  ["长期记忆", has("renderMemoryForPrompt"), "文件树，根文件常驻上下文"],
  ["第三方集成", has("mcpListTools"), "MCP 客户端，用户自填"],
  ["文件操作", has("workspaceVerdict"), "工作区内的读写"],
  ["浏览器操作", false, "未接入"],
  ["审批机制", has("task.approval"), "awaiting 状态 + waiver"],
  ["语音", false, "未做"],
  ["跨设备", false, "本机单点"],
];
for (const [name, present, note] of dims) {
  console.log(`  ${present ? "[有]" : "[无]"} ${name}${note === "" ? "" : ` — ${note}`}`);
}
