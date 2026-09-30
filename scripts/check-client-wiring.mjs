/**
 * 静态检查客户端那一半，确认四项改动真的接到了渲染路径上。
 *
 * 这不是替代看截图——是替代「改了但没接上」这种看不见的失败。语法通过只说明
 * 文件能被解析，不说明那个元素真的出现在返回的树里。
 */

import { readFileSync } from "node:fs";

const source = readFileSync("D:/dsh-workspace/dot-plugin/client.js", "utf8");
const lines = source.split(/\r?\n/);

let failures = 0;
const check = (name, condition, detail) => {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? "" : `\n        ${detail}`}`);
  }
};

/** 某个标识符在文件中出现几次。 */
const count = (needle) => lines.filter((line) => line.includes(needle)).length;

console.log("头像不再带状态环");
check(
  "没有 data-tone 的边框规则了",
  !source.includes('.dshdot-avatar[data-tone="ok"]{border-color'),
  "旧的绿色圆框规则还在",
);
check(
  "头像本身也不再画边框",
  (() => {
    const rule = lines.find((line) => line.includes(".dshdot-avatar{"));
    return rule !== undefined && !rule.includes("border:");
  })(),
  "avatar 的规则里还有 border",
);
check(
  "但「这是谁」还是要显示的：overflow 收住圆角",
  source.includes(".dshdot-avatar{position:relative") && source.includes("overflow:hidden"),
);

console.log("\n三个点在最右边");
// 分工：侧边栏的「更多」用三个点（和 DSH 会话行一致），页面内的设置用齿轮。
// 把两者混起来是最容易犯的错——一眼看上去都像「那个按钮」。
const ellipsisLines = lines.filter((line) => line.includes("EllipsisIcon, { size: 16 }"));
const gearLines = lines.filter((line) => line.includes("h(GearIcon"));
check(
  "侧边栏的两处更多菜单用三个点",
  ellipsisLines.length === 2,
  `期望 2 处，实际 ${ellipsisLines.length} 处`,
);
check(
  "页面内的两处设置用齿轮",
  gearLines.length === 2,
  `期望 2 处，实际 ${gearLines.length} 处`,
);
check(
  "侧边栏那两处确实在 mark 上下文里",
  ellipsisLines.every((line) => {
    const at = lines.indexOf(line);
    // 往回看它属于哪个 render：mark 的两个都有 setOpen / setMenu
    return lines.slice(Math.max(0, at - 8), at).some((near) => near.includes("setOpen") || near.includes("setMenu"));
  }),
  "有一处三个点不在侧边栏的菜单里",
);
check(
  "而且被推到最右",
  (() => {
    const rule = lines.find((line) => line.includes(".dshdot-mark-more{"));
    return rule !== undefined && rule.includes("margin-left:auto");
  })(),
  ".dshdot-mark-more 没有 margin-left:auto",
);
// 光有 margin-left:auto 不够：它把按钮推到「这一行的右端」，而如果这一行本身
// 没有占满外壳给的位置，按钮就停在行中间——那正是它之前的样子。
check(
  "但推得动的前提是这一行真的占满了外壳给的位置",
  (() => {
    const rule = lines.find((line) => line.includes(".dshdot-mark{position:relative"));
    return rule !== undefined && rule.includes("width:100%") && rule.includes("box-sizing:border-box");
  })(),
  "mark 没有 width:100%；margin-left:auto 会推到一个不含整行的盒子里",
);
check(
  "缩进用的是 padding 而不是 margin，否则那一百个百分比会把行推出容器",
  (() => {
    const rule = lines.find((line) => line.includes(".dshdot-mark{position:relative"));
    return rule !== undefined && rule.includes("padding-left:14px") && !rule.includes("margin-left:14px");
  })(),
  "缩进还是 margin-left",
);
check(
  "祖先链上撑开了外壳的 glyph 容器",
  source.includes("span:has(> * > .dshdot-mark)"),
  "没有撑开外壳那一层，flex 就只到中间的无盒子 div 为止",
);
// 这条是实测出来的：Chromium 不支持 `:has()` 套在另一个 `:has()` 里面，整条规则
// 会被**静默丢弃** —— 规则在文件里、看起来没问题、一点作用都没有。上一版就是
// 这么写的，于是 glyph 一直停在 96px，`⋯` 停在行中间。
//
// 只看代码行：注释里为了说明这个坑，本身就要写出那个错误写法。
const codeLines = lines.filter((line) => {
  const trimmed = line.trim();
  return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
});
check(
  "而且没有用嵌套的 :has()，那个写法不生效",
  !codeLines.some((line) => /:has\([^()]*:has\(/.test(line)),
  "有一处嵌套 :has()，浏览器会丢掉整条规则",
);
check(
  "页面内的设置按钮也靠右，但不是靠那三个点",
  (() => {
    const rule = lines.find((line) => line.includes(".dshdot-icon{"));
    return rule !== undefined && rule.includes("margin-left:auto");
  })(),
  ".dshdot-icon 没有 margin-left:auto",
);

console.log("\n头像可以由用户上传");
check("有一个真正选文件的控件", source.includes('type: "file"') && source.includes("readAsDataURL"));
check("它把结果发给后端并刷新面板", source.includes('action: "avatarUpload"') && source.includes("loadAvatar(true)"));
check("而且接受常见的图片格式", source.includes("image/png,image/jpeg,image/webp,image/gif"));

console.log("\n类型可以由用户自己设置");
check("有一个挑选「新建还是改哪个」的下拉", source.includes('h("option", { value: "" }, "新建一个类型")'));
check(
  "选了已有的会把内容填进同一个表单",
  source.includes("setTypeForm(picked === undefined"),
);
check(
  "保存时按编辑的对象分流",
  source.includes('action: "typeAdd"') && source.includes('action: "typeEdit"') && source.includes("draft.editing"),
);
check(
  "新建时也带上 editing 字段，两条路走同一个形状",
  count('persona: "", editing: null') >= 1,
);

console.log("\n输入框和 DSH 自己的形状一致");
check(
  "是个卡片，不是一条横排的输入行",
  source.includes('.dshdot-card{') && source.includes('.dshdot-composer{'),
  "缺 composer 或 card",
);
check(
  "宽度和聊天内容列共用一根轴，而不是撑满",
  (() => {
    const rule = lines.find((line) => line.includes(".dshdot-card{"));
    if (rule === undefined) return false;
    // DSH 原式是 calc(clamp(680px, 列宽 * 0.64, 920px) + 32px)。
    return rule.includes("clamp(680px") && rule.includes("* 0.64") && rule.includes("+ 32px");
  })(),
  "卡片没有用 clamp(680px, 宽*0.64, 920px)+32px 这根轴",
);
check(
  "文字区在上、按钮行在下（两个子元素，不是一个 flex 行）",
  source.includes('.dshdot-input{box-sizing:border-box') && source.includes('.dshdot-row{'),
);
check(
  "字号跟随 DSH 的内容字号 token，不是写死的",
  (() => {
    const rule = lines.find((line) => line.includes(".dshdot-card{"));
    return rule !== undefined && rule.includes("--dsh-content-font-size");
  })(),
  "卡片没有继承 --dsh-content-font-size",
);
check(
  "发送是圆形，而且用了和 DSH 同一个填充 token",
  (() => {
    const rule = lines.find((line) => line.includes(".dshdot-send{"));
    return rule !== undefined && rule.includes("999px") && rule.includes("--dsw-alias-button-info-fill");
  })(),
  "发送按钮不是圆形，或者没用 info-fill 那对颜色",
);
check(
  "输入框本体不再自己画边框和底色，那些属于卡片",
  (() => {
    const rule = lines.find((line) => line.includes(".dshdot-input{box-sizing"));
    return rule !== undefined && rule.includes("background:transparent") && rule.includes("border:none");
  })(),
  "input 还在画自己的边框或底色",
);
check(
  "而卡片自己带上了 DSH 的表面 token 与高度",
  (() => {
    const rule = lines.find((line) => line.includes(".dshdot-card{"));
    return rule !== undefined
      && rule.includes("--dsw-specific-input-major")
      && rule.includes("--dsw-elevation-soft")
      && rule.includes("--dsw-radius-panel");
  })(),
  "卡片缺 surface / elevation / radius 之一",
);

console.log("\n服务状态灯（上一步做的，确认没有被这些改动碰坏）");
check("绿点组件还在", source.includes("function ServiceDot"));
check("它仍然分三态", source.includes('state === "ok"') && source.includes('state === "error"') && source.includes('"untested"'));
check("MCP 和连接都挂上了它", count("h(ServiceDot") >= 2);

console.log("");
if (failures === 0) {
  console.log("全部通过");
} else {
  console.log(`${failures} 项失败`);
  process.exitCode = 1;
}
