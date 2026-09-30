/**
 * Dot — Web half.
 *
 * Dot is a resident entity, not a conversation, so it sits where resident
 * things sit: an entry in the sidebar panel list, below "new session", that
 * opens its own page in the main column.
 *
 * Opening it lands on the home view — pick a type to create a bot, or step
 * into one that already exists — and the conversation itself is a view below
 * that. The gear in the corner holds the current bot's settings.
 *
 * Style ownership matters here: the sidebar entry renders whenever the sidebar
 * does, while the page only renders when the panel is selected. The entry
 * therefore carries every style it needs inline and never depends on a
 * stylesheet that another component might not have mounted yet.
 */

window.__ModuleLoader__.load({
  id: 'dsh-dot',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const PANEL_ID = 'dot';
    /** Each instance's sidebar entry and its panel are keyed by this prefix plus its id. */
    const PANEL_CHILD_PREFIX = 'bot:';
    const POLL_MS = 3000;
    /** A heartbeat older than this means the Host half is no longer beating. */
    const STALE_MS = 45000;

    /** Only the page renders this; the entry must stay self-contained. */
    const CSS = [
      '.dshdot{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base)}',
      '.dshdot-bar{display:flex;align-items:center;gap:12px;flex:none;padding:14px 20px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}',
      // 头像不带状态环了。一个 40px 的圆里套一圈 5px 的彩色边框，看上去像个指示灯，
      // 而这块地方要回答的是「这是谁」——状态在旁边那行字里说过了。
      '.dshdot-avatar{position:relative;flex:none;width:40px;height:40px;border-radius:50%;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}',
      '.dshdot-avatar[data-size="small"]{width:26px;height:26px}',
      '.dshdot-who{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
      '.dshdot-name{margin:0;font-size:16px;font-weight:600;line-height:1.2;color:var(--dsw-alias-label-primary)}',
      '.dshdot-state{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dshdot-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;margin-left:auto;width:30px;height:30px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dshdot-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshdot-icon:active{background:var(--dsw-alias-interactive-bg-active)}',
      '.dshdot-icon[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshdot-face{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;user-select:none}',
      '@keyframes dshdot-breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-2px) scale(1.03)}}',
      '.dshdot-avatar[data-live="true"]>img{animation:dshdot-breathe 3.6s ease-in-out infinite}',
      '.dshdot-avatar[data-tone="warn"]>img{filter:grayscale(.7)}',
      '.dshdot-avatar>img{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;user-select:none}',
      '.dshdot-code{display:inline-block;margin:0 2px;padding:1px 6px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-radius:5px}',
      '.dshdot-group{display:flex;flex-direction:column;gap:6px;margin-top:8px}',
      '.dshdot-grouptitle{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dshdot-btn[data-on="true"]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}',
      // 表单容器不是控件：用一条分隔线开头，不要拿框把它圈成一个盒子。
      '.dshdot-connform{display:flex;flex-direction:column;gap:8px;padding:12px 0;border-top:0.5px solid var(--dsw-alias-border-l2)}',
      '.dshdot-tool[data-on="true"]{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dshdot-typecard{position:relative;display:flex}',
      '.dshdot-typecard>.dshdot-option{flex:1}',
      '.dshdot-typecard-x{position:absolute;top:6px;right:6px;width:20px;height:20px;padding:0;font:inherit;font-size:14px;line-height:1;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:5px;cursor:pointer}',
      '.dshdot-typecard-x:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dshdot-option[data-add="true"]{border-style:dashed}',
      '.dshdot-numwrap{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dshdot-num{width:68px;height:28px;padding:0 6px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px}',
      '.dshdot-stream{display:flex;flex-direction:column;gap:18px;flex:1;min-height:0;padding:18px 20px;overflow-y:auto}',
      '.dshdot-chat{display:flex;flex-direction:column;gap:10px;flex:1;min-height:0;padding:18px 20px;overflow-y:auto}',
      '.dshdot-turn{max-width:min(640px,82%);padding:9px 13px;font-size:13px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:12px}',
      '.dshdot-turn[data-role="user"]{align-self:flex-end;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2)}',
      '.dshdot-turn[data-role="dot"]{align-self:flex-start;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1)}',
      '.dshdot-think{align-self:flex-start;padding:9px 13px;font-size:13px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px}',
      '.dshdot-empty{margin:auto;padding:20px;font-size:13px;text-align:center;color:var(--dsw-alias-label-secondary)}',
      '.dshdot-err{flex:none;margin:0 20px 8px;padding:8px 12px;font-size:12px;color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px}',
      '.dshdot-compose{display:flex;flex-direction:column;gap:8px;flex:none;padding:12px 20px 16px;border-top:0.5px solid var(--dsw-alias-border-l2)}',
      '.dshdot-panes{display:flex;align-items:center;gap:2px;flex:none;padding:0 20px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}',
      '.dshdot-pane{padding:8px 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer}',
      '.dshdot-pane:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshdot-pane[data-active="true"]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}',
      '.dshdot-tools{display:flex;align-items:center;gap:6px}',
      '.dshdot-tool{display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:none;min-width:28px;height:28px;padding:0 10px;font:inherit;font-size:12px;line-height:18px;white-space:nowrap;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:var(--dsw-radius-sm);cursor:pointer}',
      '.dshdot-tool:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshdot-tool:active:not([disabled]){background:var(--dsw-alias-interactive-bg-active)}',
      '.dshdot-tool[disabled]{opacity:.4;cursor:not-allowed}',
      '.dshdot-select{height:28px;max-width:220px;padding:0 6px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px}',
      '.dshdot-spacer{flex:1}',
      '.dshdot-chips{display:flex;flex-wrap:wrap;gap:6px}',
      // 芯片靠底色区分，不描边——描边的圆胶囊看起来像按钮，而它只是个标记。
      '.dshdot-chip{display:flex;align-items:center;gap:4px;padding:3px 8px;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:var(--dsw-radius-sm)}',
      '.dshdot-chip-x{padding:0 4px;font:inherit;font-size:13px;line-height:1;color:var(--dsw-alias-label-secondary);background:transparent;border:none;cursor:pointer}',
      '.dshdot-chip-x:hover{color:var(--dsw-alias-label-primary)}',
      '.dshdot-trace{display:flex;flex-direction:column;flex:1;min-height:0}',
      '.dshdot-trace-tools{display:flex;align-items:center;gap:14px;flex:none;padding:10px 20px;border-bottom:0.5px solid var(--dsw-alias-border-l2)}',
      '.dshdot-tracestat{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dshdot-trace-body{flex:1;min-height:0;padding:16px 20px;overflow-y:auto}',
      '.dshdot-node{position:relative;padding:0 0 14px 24px}',
      '.dshdot-node::before{content:"";position:absolute;left:5px;top:12px;bottom:0;width:1px;background:var(--dsw-alias-border-l1)}',
      '.dshdot-node:last-child::before{display:none}',
      '.dshdot-dot{position:absolute;left:1px;top:5px;width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-label-secondary);opacity:.55}',
      '.dshdot-node[data-role="user"] .dshdot-dot{background:var(--dsw-alias-brand-primary);opacity:1}',
      '.dshdot-node[data-role="dot"] .dshdot-dot{background:var(--dsw-alias-state-success-primary);opacity:1}',
      '.dshdot-node[data-kind="turn"] .dshdot-dot{left:2px;top:6px;width:7px;height:7px;opacity:.4}',
      '.dshdot-nodehead{display:flex;gap:8px;align-items:baseline;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dshdot-nodehead b{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshdot-nodetext{margin-top:2px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
        '.dshdot-send{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;border:none;border-radius:999px;background:var(--dsw-alias-button-info-fill);color:#fff;cursor:pointer;transition:background-color 100ms ease;transform:translateY(-2px)}',
        '.dshdot-send:hover:not([disabled]){background:var(--dsw-alias-button-info-hover)}',
        '.dshdot-send[disabled]{opacity:.4;cursor:default}',
        // 输入区照 DSH 自己的形状做：一个卡片，宽度和聊天内容列共用同一根轴。
        // 宽度不一致是真实的成本——用户会以为这是两个不同的东西。
        // DSH 的原式是 calc(clamp(680px, 列宽 × 0.64, 920px) + 32px)，这里用
        // 容器宽度代替那个列宽变量，因为本插件拿不到对方的私有变量。
        '.dshdot-composer{display:flex;flex-direction:column;align-items:center;flex:none;padding:0 16px 4px}',
        '.dshdot-card{display:flex;flex-direction:column;gap:12px;box-sizing:border-box;width:100%;max-width:calc(clamp(680px, calc(100% * 0.64), 920px) + 32px);padding-top:8px;--dsw-elevation-stroke-color:var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-panel);background:var(--dsw-specific-input-major);box-shadow:var(--dsw-elevation-soft);font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}',
        '.dshdot-input{box-sizing:border-box;min-height:36px;max-height:var(--dshdot-text-max-height,160px);padding:4px 8px 0 14px;font-family:var(--dsw-font-family);font-size:inherit;line-height:inherit;color:var(--dsw-alias-label-primary);background:transparent;border:none;outline:none;resize:none;caret-color:var(--dsw-alias-state-business-primary)}',
        '.dshdot-input::placeholder{color:var(--dsw-alias-label-caption)}',
      '.dshdot-field+.dshdot-field{border-top:0.5px solid var(--dsw-alias-border-l2)}',
      '.dshdot-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}',
      '.dshdot-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}',
      '.dshdot-option{display:flex;flex-direction:column;gap:3px;padding:11px 13px;text-align:left;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);cursor:pointer}',
      '.dshdot-option:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l4)}',
      '.dshdot-option:active{background:var(--dsw-alias-interactive-bg-active)}',
      '.dshdot-option[data-picked="true"]{border-color:var(--dsw-alias-brand-primary)}',
      '.dshdot-option[disabled]{opacity:.4;cursor:not-allowed}',
      '.dshdot-option b{font-size:13px;font-weight:600}',
      '.dshdot-option span{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.dshdot-rows{display:flex;flex-direction:column;gap:2px}',
      '.dshdot-rowitem{display:flex;flex-direction:column;border-radius:8px}',
      '.dshdot-rowtop{display:flex;align-items:center;border-radius:8px}',
      '.dshdot-rowitem:hover .dshdot-rowtop{background:var(--dsw-alias-bg-layer-2)}',
      '.dshdot-rowitem[data-active="true"] .dshdot-rowtop{background:var(--dsw-alias-bg-layer-1)}',
      '.dshdot-rowmain{display:flex;align-items:center;gap:9px;flex:1;min-width:0;padding:8px 10px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);text-align:left;background:transparent;border:none;cursor:pointer}',
      '.dshdot-rowmark{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);opacity:.45}',
      '.dshdot-rowmark[data-state="new"]{background:var(--dsw-alias-state-success-primary);opacity:1}',
      '.dshdot-rowmark[data-state="waiting"]{background:var(--dsw-alias-state-warn-primary);opacity:1}',
      '.dshdot-rowmark[data-state="error"]{background:var(--dsw-alias-state-error-primary);opacity:1}',
      '.dshdot-rowname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshdot-rowmeta{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dshdot-rowtime{flex:none;min-width:52px;font-size:12px;text-align:right;color:var(--dsw-alias-label-secondary)}',
      '.dshdot-rowmore{display:inline-flex;align-items:center;justify-content:center;flex:none;width:26px;height:26px;margin-left:auto;margin-right:6px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:var(--dsw-radius-sm);cursor:pointer;opacity:0}',
      '.dshdot-rowitem:hover .dshdot-rowmore,.dshdot-rowmore[aria-expanded="true"]{opacity:1}',
      '.dshdot-rowmore:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshdot-rowactions{display:flex;gap:4px;flex-wrap:wrap;padding:0 10px 8px}',
      '.dshdot-rowactions button{display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;font:inherit;font-size:12px;white-space:nowrap;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:var(--dsw-radius-sm);cursor:pointer}',
      '.dshdot-rowactions button:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dshdot-rowactions button[disabled]{opacity:.4;cursor:not-allowed}',
      '.dshdot-rowactions button[data-danger="true"]{color:var(--dsw-alias-state-error-primary)}',
      '.dshdot-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dshdot-text{flex:1;min-width:140px;height:34px;padding:0 12px;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md)}',
      '.dshdot-text:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
      '.dshdot-text::placeholder{color:var(--dsw-alias-label-dimmed)}',
      '.dshdot-text:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}',
      '.dshdot-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:none;height:28px;padding:0 10px;font:inherit;font-size:12px;line-height:18px;white-space:nowrap;color:var(--dsw-alias-label-primary);background:transparent;border:none;border-radius:var(--dsw-radius-sm);cursor:pointer}',
      '.dshdot-btn:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshdot-btn:active:not([disabled]){background:var(--dsw-alias-interactive-bg-active)}',
      '.dshdot-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.dshdot-btn[disabled]{opacity:.4;cursor:not-allowed}',
      '.dshdot-btn[data-danger="true"]{color:var(--dsw-alias-state-error-primary)}',
      '.dshdot-btn[data-on="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      // 说明文字不是控件：不给框，也不给圆角。一个框意味着"可以输入"或者
      // "可以点"，而这里两样都不是——那正是设置页看起来又挤又吵的原因。
      '.dshdot-note{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}',
      // 列表同理：用细横线分隔，不用外框把它包成一个盒子。
      '.dshdot-list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}',
      '.dshdot-item{display:flex;gap:10px;align-items:baseline;padding:6px 0;font-size:13px;color:var(--dsw-alias-label-primary);border-top:0.5px solid var(--dsw-alias-border-l2)}',
      '.dshdot-item:first-child{border-top:none}',
      // 标签是注记，不是按钮：只靠字号和颜色区分，不描边。
      '.dshdot-tag{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      // 状态点：绿 = 测过且通过，红 = 测过且失败，灰 = 还没测过。
      // 三态而不是两态——一个只该被扫一眼的灯，不能把「没看过」说成「没问题」。
      '.dshdot-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-dimmed);margin-right:6px}',
      '.dshdot-dot-ok{background:var(--dsw-alias-state-business-primary)}',
      '.dshdot-dot-error{background:var(--dsw-alias-state-error-primary)}',
      '.dshdot-overlay{display:flex;flex-direction:column;gap:18px;flex:1;min-height:0;padding:20px 24px;overflow-y:auto;background:var(--dsw-alias-bg-base)}',
      '.dshdot-overlay-head{display:flex;align-items:center;gap:12px}',
      '.dshdot-h1{margin:0;flex:1;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary)}',
    ].join('');

    /** Absolute age of an ISO instant, phrased for a status line. */
    function ago(iso) {
      const at = Date.parse(iso);
      if (!Number.isFinite(at)) return "未知";
      const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
      if (seconds < 60) return seconds + " 秒前";
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return minutes + " 分钟前";
      const hours = Math.round(minutes / 60);
      if (hours < 24) return hours + " 小时前";
      return Math.round(hours / 24) + " 天前";
    }

    async function call(path, body) {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      return response.json();
    }

    async function loadTypes() {
      const response = await fetch("/api/dot.types", { cache: "no-store", headers: { accept: "application/json" } });
      const value = await response.json();
      return Array.isArray(value.types) ? value.types : [];
    }

    function typeName(types, id) {
      const found = types.find((entry) => entry.id === id);
      return found === undefined ? id : found.name;
    }

    /**
     * 一个状态灯：绿只在真的测过并通过之后才亮。
     *
     * 三种状态而不是两种——「没人看过」和「它没问题」不是同一个说法，而这个灯
     * 全部的用途就是被扫一眼，所以不能把两者混起来。
     */
    function ServiceDot(props) {
      const state = props.state;
      const label = state === "ok" ? "测过，正常" : state === "error" ? "测过，失败" : "还没测过";
      const extra = state === "ok" ? " dshdot-dot-ok" : state === "error" ? " dshdot-dot-error" : "";
      return h("span", { className: "dshdot-dot" + extra, title: label });
    }

    /** 一个服务条目的健康状态，从它自己记录的两件事推出来。 */
    function serviceState(entry) {
      if (entry === undefined || entry === null) return "untested";
      if (typeof entry.lastError === "string" && entry.lastError !== "") return "error";
      if (typeof entry.lastOkAt === "string" && entry.lastOkAt !== "") return "ok";
      return "untested";
    }
    function taskStateLabel(state) {
      if (state === "queued") return "待办";
      if (state === "running") return "在做";
      if (state === "awaiting") return "等你批准";
      if (state === "succeeded") return "完成";
      if (state === "failed") return "失败";
      return "取消";
    }

    /** Compact "how long ago", as a sidebar row shows it. */
    function shortAgo(iso) {
      const at = Date.parse(iso);
      if (!Number.isFinite(at)) return "";
      const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
      if (seconds < 60) return "刚刚";
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return minutes + " 分钟";
      const hours = Math.round(minutes / 60);
      if (hours < 24) return hours + " 小时";
      return Math.round(hours / 24) + " 天";
    }

    /**
     * One poll feeds every sidebar mark and the page. The shell renders the
     * rows itself, so a mark is the only place an unread state can show up,
     * and the marks are components — they need a subscription to re-render.
     */
    const live = { snapshot: null, listeners: new Set() };

    function publish(next) {
      live.snapshot = next;
      for (const listener of [...live.listeners]) {
        try {
          listener();
        } catch {
          /* one bad subscriber must not stop the rest */
        }
      }
    }

    function useLive() {
      const [, bump] = useState(0);
      useEffect(() => {
        const listener = () => bump((value) => value + 1);
        live.listeners.add(listener);
        return () => {
          live.listeners.delete(listener);
        };
      }, []);
      return live.snapshot;
    }

    function dotIn(snapshot, id) {
      if (snapshot === null || !Array.isArray(snapshot.dots)) return undefined;
      return snapshot.dots.find((entry) => entry.id === id);
    }

    const SEEN_KEY = "dshdot.seen";

    function readSeen() {
      try {
        const raw = window.localStorage.getItem(SEEN_KEY);
        const parsed = raw === null ? null : JSON.parse(raw);
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }

    /** Mark an instance read up to what it currently holds. */
    function markSeen(dot) {
      if (dot === undefined) return;
      try {
        const seen = readSeen();
        seen[dot.id] = dot.updatedAt;
        window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
      } catch {
        /* a browser that refuses storage simply keeps showing the mark */
      }
    }

    /**
     * DSH's overflow glyph. Geometry copied from ui-primitives'
     * IconEllipsisOutline so the three dots land on the same baseline at the
     * same weight as every other menu trigger in the shell — a `…` character
     * cannot do that, because its size and spacing belong to the font.
     */
    function EllipsisIcon(props) {
      const wanted = props !== null && typeof props === "object" ? props.size : undefined;
      const size = typeof wanted === "number" && wanted > 0 ? wanted : 16;
      return h("svg", {
        viewBox: "0 0 16 16",
        width: size,
        height: size,
        fill: "none",
        "aria-hidden": true,
        style: { display: "block" },
      },
        h("path", { fill: "currentColor", d: "M3 9C3.55228 9 4 8.55228 4 8C4 7.44772 3.55228 7 3 7C2.44772 7 2 7.44772 2 8C2 8.55228 2.44772 9 3 9Z" }),
        h("path", { fill: "currentColor", d: "M8 9C8.55228 9 9 8.55228 9 8C9 7.44772 8.55228 7 8 7C7.44772 7 7 7.44772 7 8C7 8.55228 7.44772 9 8 9Z" }),
        h("path", { fill: "currentColor", d: "M13 9C13.5523 9 14 8.55228 14 8C14 7.44772 13.5523 7 13 7C12.4477 7 12 7.44772 12 8C12 8.55228 12.4477 9 13 9Z" }));
    }

    /** Something arrived since this instance was last opened. */
    function isUnread(dot) {
      if (dot === undefined || dot.messages === 0) return false;
      const seen = readSeen()[dot.id];
      if (typeof seen !== "string") return true;
      return dot.updatedAt > seen;
    }

    /**
     * The sidebar dot for one instance. A new message outranks a problem, and a
     * problem outranks a question — the reader should handle the freshest thing
     * first. `alert` comes from the host; "unread" is decided here, because only
     * this browser knows what it has already shown.
     */
    function dotState(dot, unread) {
      if (unread) return "new";
      if (dot !== undefined && dot.alert === "error") return "error";
      if (dot !== undefined && dot.alert === "waiting") return "waiting";
      return "quiet";
    }

    /** Spoken in the tooltip so the colour is never the only signal. */
    const DOT_STATE_LABEL = {
      new: "有新消息",
      waiting: "等你回答",
      error: "出错了",
      quiet: "安静",
    };

    /**
     * The instance row's own stylesheet. The shell renders the row button, but
     * `panelGlyph` imposes no size, so the row's content can live here — which
     * is the only way to get a right-aligned time and a menu into the sidebar.
     */
    /**
     * What it may do on its own time. Three modes rather than a slider: the
     * choice is about trust, and "how much" is not a meaningful axis for it.
     */
    const AUTONOMY_MODES = [
      { id: "read", label: "只读", blurb: "能看能查，不能发消息、不能改文件、不能碰任何东西" },
      { id: "review", label: "完全权限 + 自动审查", blurb: "能动手，但每一步先过一遍审查；对外或不可逆的会停下来等你" },
      { id: "full", label: "完全权限", blurb: "跟你说话时一样的权限，不做额外审查" },
    ];

    const MARK_CSS = [
      // 外壳把这一行包在两层里：一个没有盒子的 `div`（`display:contents`）和一个
      // `span`，撑开 span 才有用 —— `flex` 对 `display:contents` 的盒子无效。
      //
      // 三件事是实测出来的，不是推出来的：
      //
      // 一、**不能写成嵌套的 `:has()`**（`:has(> :has(> .dshdot-mark))`）。Chromium
      //     不支持 `:has()` 出现在另一个 `:has()` 里面，整条规则会被静默丢弃 ——
      //     规则在、看起来没问题、一点作用都没有。
      // 二、外层那个 span 的 `flex:0 0 auto` 来自外壳自己的类，把它改成 `1 1 auto`
      //     是唯一有效的做法（`min-width:96px` 是它当时只有 96px 宽的原因）。
      // 三、层数是外壳的实现细节，所以按 1/2/3 层各写一条并列规则，哪条命中都行 ——
      //     外壳改一次层级，这里不该跟着坏。
      'span:has(> .dshdot-mark),span:has(> * > .dshdot-mark),span:has(> * > * > .dshdot-mark){flex:1 1 auto;min-width:0;width:100%}',
      // 缩进一级，读起来像上一级条目的子项（下属文件夹 / 工作区下面的对话）。
      // 缩进的是整行，不是内容：行内仍然从左排起，不靠右对齐。
      //
      // `width:100%` makes this box the row's full width whatever the wrapper
      // resolved to; the flex growth above is what gives it something to be a
      // hundred percent *of*.
      // 缩进用 padding 而不是 margin：这个盒子是 width:100% 满宽的，margin 会把它推到容器外 14px，右边就短了一截。
      '.dshdot-mark{position:relative;display:flex;flex:1 1 auto;box-sizing:border-box;width:100%;align-items:center;gap:8px;min-width:96px;padding-left:14px}',
      '.dshdot-mark-face{position:relative;flex:none;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-bg-layer-2)}',
      '.dshdot-mark-ping{position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-success-primary);border:2px solid var(--dsw-alias-bg-base)}',
      // 状态点三态：绿=有新消息，橙=等你回答（规则拦下了活儿），红=出错了，灰=安静。
      '.dshdot-mark-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);opacity:.5}',
      '.dshdot-mark-dot[data-state="new"]{background:var(--dsw-alias-state-success-primary);opacity:1}',
      '.dshdot-mark-dot[data-state="waiting"]{background:var(--dsw-alias-state-warn-primary);opacity:1}',
      '.dshdot-mark-dot[data-state="error"]{background:var(--dsw-alias-state-error-primary);opacity:1}',
      // `min-width` 是刻意的保险：外层一旦塌掉，名字至少保住两个字宽，
      // 而不是被压成一条竖线（那正是这个行之前出过的故障）。
      '.dshdot-mark-name{flex:1 1 auto;min-width:2.5em;overflow:hidden;font-size:14px;text-overflow:ellipsis;white-space:nowrap}',
      '.dshdot-mark-time{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      // 「更多」钉死在行尾：margin-left:auto 把它推到最右边，与名字宽度无关。
      '.dshdot-mark-more{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;margin-left:auto;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-radius:var(--dsw-radius-sm);cursor:pointer;opacity:0}',
      '.dshdot-mark:hover .dshdot-mark-more,.dshdot-mark-more[aria-expanded="true"]{opacity:1}',
      '.dshdot-mark-more:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      // 照抄 DSH 的菜单卡片：无边框、用 elevation 阴影、从锚点右下方展开。
      // 关键是 left:0 而不是 right:0 —— 侧边栏里这一行贴着左边，菜单也该
      // 往右长；右对齐会让它探到面板外面去。
      '.dshdot-mark-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:100;box-sizing:border-box;display:flex;flex-direction:column;min-width:144px;max-width:360px;padding:4px;border:0;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-overlay);box-shadow:var(--dsw-elevation-prominent)}',
      '.dshdot-mark-menu>span{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-md);cursor:pointer}',
      '.dshdot-mark-menu>span:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshdot-mark-menu>span[data-danger="true"]{color:var(--dsw-alias-state-error-primary)}',
      '.dshdot-mark-menu>span[data-danger="true"]:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}',
      '.dshdot-mark-input{width:100%;min-width:0;padding:2px 6px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm)}',
      '.dshdot-mark-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
    ].join('');

    /**
     * The avatar is fetched once and shared: it is the same image for every
     * instance unless the user pointed the setting at their own file.
     */
    const avatarCache = { url: null, listeners: new Set(), started: false };

    function loadAvatar(force) {
      if (avatarCache.started && !force) return;
      avatarCache.started = true;
      fetch("/api/dot.avatar", { cache: "no-store", headers: { accept: "image/*" } })
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (blob === null) return;
          const previous = avatarCache.url;
          avatarCache.url = URL.createObjectURL(blob);
          if (previous !== null) URL.revokeObjectURL(previous);
          for (const listener of [...avatarCache.listeners]) listener();
        })
        .catch(() => {});
    }

    function useAvatar() {
      const [, bump] = useState(0);
      useEffect(() => {
        const listener = () => bump((value) => value + 1);
        avatarCache.listeners.add(listener);
        loadAvatar(false);
        return () => {
          avatarCache.listeners.delete(listener);
        };
      }, []);
      return avatarCache.url;
    }

    /** A row's own stylesheet is shared by every instance row it renders. */
    function DotFace(props) {
      const avatar = useAvatar();
      if (avatar === null) return null;
      return h("img", { className: props.className, src: avatar, alt: "", draggable: false });
    }

    /**
     * One instance's sidebar entry. The shell asks for a 16px glyph in the
     * expanded sidebar and 18px in the rail and passes no explicit flag, so the
     * requested edge is the only signal for which shape to draw.
     */
    function makeChildMark(dotId) {
      return function DotChildMark(props) {
        const snapshot = useLive();
        const [open, setOpen] = useState(false);
        const [renaming, setRenaming] = useState(false);
        const [value, setValue] = useState("");
        const requested = props !== null && typeof props === "object" ? props.size : undefined;
        const wide = requested === 16;
        const dot = dotIn(snapshot, dotId);
        const unread = isUnread(dot);

        if (!wide || dot === undefined) {
          // 窄侧边栏只有一个圆点可用，颜色就是全部信息量，所以三态照搬。
          const railColor = unread
            ? "var(--dsw-alias-state-success-primary)"
            : (dot !== undefined && dot.alert === "error"
              ? "var(--dsw-alias-state-error-primary)"
              : (dot !== undefined && dot.alert === "waiting"
                ? "var(--dsw-alias-state-warn-primary)"
                : "currentColor"));
          return h("svg", {
            viewBox: "0 0 24 24",
            width: 18,
            height: 18,
            "aria-hidden": true,
            style: { display: "block" },
          }, h("circle", { cx: "12", cy: "12", r: "6", fill: railColor, opacity: unread ? "1" : "0.72" }));
        }

        const stop = (event) => event.stopPropagation();
        const act = (body) => {
          setOpen(false);
          call("/api/dot.manage", body)
            .then(() => refreshLive())
            .catch(() => {});
        };
        const commit = () => {
          const name = value.trim();
          setRenaming(false);
          if (name.length === 0 || name === dot.name) return;
          act({ action: "rename", id: dotId, name });
        };

        if (renaming) {
          return h("span", { className: "dshdot-mark" },
            h("style", null, MARK_CSS),
            h("input", {
              className: "dshdot-mark-input",
              value,
              autoFocus: true,
              onClick: stop,
              onChange: (event) => setValue(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") commit();
                else if (event.key === "Escape") setRenaming(false);
              },
              onBlur: commit,
            }));
        }

        const markState = dotState(dot, unread);
        return h("span", { className: "dshdot-mark" },
          h("style", null, MARK_CSS),
          h("span", {
            className: "dshdot-mark-dot",
            "data-state": markState,
            title: DOT_STATE_LABEL[markState],
          }),
          h("span", { className: "dshdot-mark-name" }, dot.name),
          dot.messages === 0 ? null : h("span", { className: "dshdot-mark-time" }, shortAgo(dot.updatedAt)),
          h("span", {
            className: "dshdot-mark-more",
            role: "button",
            title: "更多",
            "aria-label": "更多",
            "aria-expanded": open,
            onClick: (event) => {
              event.stopPropagation();
              setOpen((current) => !current);
            },
          }, h(EllipsisIcon, { size: 16 })),
          open
            ? h("span", { className: "dshdot-mark-menu" },
                h("span", {
                  role: "menuitem",
                  onClick: (event) => {
                    stop(event);
                    act({ action: "pin", id: dotId, pinned: !dot.pinned });
                  },
                }, dot.pinned ? "取消置顶" : "置顶"),
                h("span", {
                  role: "menuitem",
                  onClick: (event) => {
                    stop(event);
                    setOpen(false);
                    setValue(dot.name);
                    setRenaming(true);
                  },
                }, "重命名"),
                h("span", {
                  role: "menuitem",
                  "data-danger": "true",
                  onClick: (event) => {
                    stop(event);
                    act({ action: "delete", id: dotId });
                  },
                }, "删除"))
            : null);
      };
    }

    /** The page re-reads through the same poll the sidebar marks subscribe to. */
    let refreshLive = async () => {};

    /** Liveness tone derived from the snapshot's heartbeat. */
    function toneOf(state) {
      if (state.kind === "error") return "error";
      if (state.kind !== "ready") return "warn";
      const beat = Date.parse(state.value.heartbeatAt);
      return Number.isFinite(beat) && Date.now() - beat < STALE_MS ? "ok" : "warn";
    }

    function GearIcon() {
      return h("svg", { viewBox: "0 0 24 24", width: 17, height: 17, "aria-hidden": true, style: { display: "block" } },
        h("circle", { cx: "12", cy: "12", r: "3", fill: "none", stroke: "currentColor", strokeWidth: "1.8" }),
        h("path", {
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.8",
          "stroke-linejoin": "round",
          d: "M12 3.6l1.2 2.1 2.4-.5.5 2.4 2.1 1.2-1.2 2.1 1.2 2.1-2.1 1.2-.5 2.4-2.4-.5L12 20.4l-1.2-2.1-2.4.5-.5-2.4L5.8 15l1.2-2.1L5.8 10.8l2.1-1.2.5-2.4 2.4.5L12 3.6Z",
        }));
    }

    function BackIcon() {
      return h("svg", { viewBox: "0 0 24 24", width: 17, height: 17, "aria-hidden": true, style: { display: "block" } },
        h("path", { fill: "none", stroke: "currentColor", strokeWidth: "1.9", "stroke-linecap": "round", "stroke-linejoin": "round", d: "M14.5 5.5 8 12l6.5 6.5" }));
    }

    /**
     * The sidebar entry. Fully self-contained: the shell asks for a square of
     * `size` pixels and this draws it, with no dependence on a stylesheet.
     */
    function DotEntry(props) {
      const requested = props !== null && typeof props === "object" ? props.size : undefined;
      const size = typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? requested : 18;
      return h("svg", {
        viewBox: "0 0 24 24",
        width: size,
        height: size,
        "aria-hidden": true,
        style: { display: "block" },
      },
        h("circle", { cx: "12", cy: "12", r: "6", fill: "currentColor" }),
        h("circle", { cx: "12", cy: "12", r: "10", fill: "none", stroke: "currentColor", strokeWidth: "2", opacity: "0.3" }));
    }

    /** Home: create a bot, or step into one that already exists. */
    function HomeView(props) {
      const { snapshot, types, state, onEnter, onChanged, onCreated, onSettings } = props;
      const [busy, setBusy] = useState(null);
      const [error, setError] = useState(null);
      const [menu, setMenu] = useState(null);
      const [renaming, setRenaming] = useState(null);
      const [renameValue, setRenameValue] = useState("");
      const [typeForm, setTypeForm] = useState(null);

      const create = async (typeId) => {
        setBusy(typeId);
        setError(null);
        try {
          const result = await call("/api/dot.manage", { action: "create", type: typeId });
          if (result.error !== undefined) setError(result.error);
          else await onCreated();
        } catch (failure) {
          setError(String(failure && failure.message ? failure.message : failure));
        } finally {
          setBusy(null);
        }
      };

      /** Row actions refresh the list in place instead of navigating away. */
      const run = async (body) => {
        setMenu(null);
        setBusy(body.id);
        setError(null);
        try {
          const result = await call("/api/dot.manage", body);
          if (result.error !== undefined) setError(result.error);
          else await onChanged();
        } catch (failure) {
          setError(String(failure && failure.message ? failure.message : failure));
        } finally {
          setBusy(null);
        }
      };

      const startRename = (dot) => {
        setMenu(null);
        setRenaming(dot.id);
        setRenameValue(dot.name);
      };

      const commitRename = async (id) => {
        const name = renameValue.trim();
        setRenaming(null);
        if (name.length === 0) return;
        await run({ action: "rename", id, name });
      };

      return h("div", { className: "dshdot" },
        h("style", null, CSS),
        h("div", { className: "dshdot-bar" },
          h("span", { className: "dshdot-avatar", "data-tone": toneOf(state) }),
          h("div", { className: "dshdot-who" },
            h("h1", { className: "dshdot-name" }, "bot"),
            h("p", { className: "dshdot-state" },
              state.kind === "error" ? "读不到 Host 端状态，插件可能已停用。" : "新建一个，或者回到已有的")),
          h("button", {
            type: "button",
            className: "dshdot-icon",
            title: "设置",
            "aria-label": "设置",
            disabled: snapshot.dots.length === 0,
            onClick: onSettings,
          }, h(GearIcon, null))),
        h("div", { className: "dshdot-stream" },
          h("div", { className: "dshdot-field" },
            h("span", { className: "dshdot-label" }, "新建"),
            h("div", { className: "dshdot-grid" },
              types.map((type) => h("div", { key: type.id, className: "dshdot-typecard" },
                h("button", {
                  type: "button",
                  className: "dshdot-option",
                  disabled: busy !== null,
                  onClick: () => create(type.id),
                },
                  h("b", null, busy === type.id ? "创建中…" : type.name),
                  h("span", null, type.blurb)),
                type.builtin === true
                  ? null
                  : h("button", {
                      type: "button",
                      className: "dshdot-typecard-x",
                      title: "删除这个类型",
                      "aria-label": "删除这个类型",
                      disabled: busy !== null,
                      onClick: () => run({ action: "typeRemove", typeId: type.id }),
                    }, "×"))),
              h("button", {
                type: "button",
                className: "dshdot-option",
                "data-add": "true",
                disabled: busy !== null,
                  onClick: () => setTypeForm(typeForm === null ? { name: "", blurb: "", persona: "", editing: null } : null),
              },
                h("b", null, typeForm === null ? "＋ 新建类型" : "收起"),
                h("span", null, "自己起名、写说明和人设")))),
          typeForm === null
            ? null
            : h("div", { className: "dshdot-field" },
                  // 同一个表单既建新类型、也改已有的：两件事要填的东西一模一样，
                  // 分两个表单只会让它们慢慢长得不一样。
                  types.length === 0 ? null : h("select", {
                    className: "dshdot-select",
                    value: typeForm.editing ?? "",
                    onChange: (event) => {
                      const picked = types.find((entry) => entry.id === event.target.value);
                      setTypeForm(picked === undefined
                        ? { name: "", blurb: "", persona: "", editing: null }
                        : { name: picked.name, blurb: picked.blurb, persona: picked.persona, editing: picked.id });
                    },
                  },
                    h("option", { value: "" }, "新建一个类型"),
                    types.map((entry) => h("option", { key: entry.id, value: entry.id }, "改：" + entry.name))),
                h("span", { className: "dshdot-label" }, "类型"),
                h("input", {
                  className: "dshdot-text",
                  value: typeForm.name,
                  autoFocus: true,
                  placeholder: "名字，比如「审稿人」",
                  onChange: (event) => setTypeForm({ ...typeForm, name: event.target.value }),
                }),
                h("input", {
                  className: "dshdot-text",
                  value: typeForm.blurb,
                  placeholder: "一句话说明，显示在卡片上",
                  onChange: (event) => setTypeForm({ ...typeForm, blurb: event.target.value }),
                }),
                h("textarea", {
                  className: "dshdot-input",
                  rows: 3,
                  value: typeForm.persona,
                  placeholder: "人设：它该怎么说话、按什么原则办事。留空会用一句默认的。",
                  onChange: (event) => setTypeForm({ ...typeForm, persona: event.target.value }),
                }),
                h("div", { className: "dshdot-row" },
                  h("button", {
                    type: "button",
                    className: "dshdot-btn",
                    disabled: busy !== null || typeForm.name.trim().length === 0,
                    onClick: () => {
                      const draft = typeForm;
                      setTypeForm(null);
                        const target = draft.editing === null || draft.editing === undefined
                          ? { action: "typeAdd", name: draft.name, blurb: draft.blurb, persona: draft.persona }
                          : { action: "typeEdit", typeId: draft.editing, name: draft.name, blurb: draft.blurb, persona: draft.persona };
                        run(target);
                    },
                  }, "保存类型"),
                  h("button", {
                    type: "button",
                    className: "dshdot-btn",
                    onClick: () => setTypeForm(null),
                  }, "取消"))),
          snapshot.dots.length === 0
            ? null
            : h("div", { className: "dshdot-field" },
                h("span", { className: "dshdot-label" }, "已有的"),
                h("div", { className: "dshdot-rows" }, snapshot.dots.map((dot) => h("div", {
                  key: dot.id,
                  className: "dshdot-rowitem",
                  "data-active": String(dot.id === snapshot.activeDotId),
                },
                  h("div", { className: "dshdot-rowtop" },
                    renaming === dot.id
                      ? h("div", { className: "dshdot-rowmain" },
                          h("input", {
                            className: "dshdot-text",
                            value: renameValue,
                            autoFocus: true,
                            onChange: (event) => setRenameValue(event.target.value),
                            onKeyDown: (event) => {
                              if (event.key === "Enter") commitRename(dot.id);
                              else if (event.key === "Escape") setRenaming(null);
                            },
                          }),
                          h("button", {
                            type: "button",
                            className: "dshdot-btn",
                            onClick: () => commitRename(dot.id),
                          }, "保存"))
                      : h("button", {
                          type: "button",
                          className: "dshdot-rowmain",
                          title: dot.name,
                          onClick: () => onEnter(dot.id),
                        },
                          h("span", {
                            className: "dshdot-rowmark",
                            "data-state": dotState(dot, isUnread(dot)),
                            title: DOT_STATE_LABEL[dotState(dot, isUnread(dot))],
                          }),
                          h("span", { className: "dshdot-rowname" }, dot.name),
                          h("span", { className: "dshdot-rowmeta" }, typeName(types, dot.type)),
                          h("span", { className: "dshdot-rowtime" }, shortAgo(dot.updatedAt))),
                    h("button", {
                      type: "button",
                      className: "dshdot-rowmore",
                      title: "更多",
                      "aria-label": "更多",
                      "aria-expanded": menu === dot.id,
                      onClick: () => setMenu((value) => (value === dot.id ? null : dot.id)),
                    }, h(EllipsisIcon, { size: 16 }))),
                  menu === dot.id
                    ? h("div", { className: "dshdot-rowactions" },
                        h("button", {
                          type: "button",
                          disabled: busy === dot.id,
                          onClick: () => run({ action: "pin", id: dot.id, pinned: !dot.pinned }),
                        }, dot.pinned ? "取消置顶" : "置顶"),
                        h("button", {
                          type: "button",
                          disabled: busy === dot.id,
                          onClick: () => startRename(dot),
                        }, "重命名"),
                        h("button", {
                          type: "button",
                          "data-danger": "true",
                          disabled: busy === dot.id || snapshot.dots.length <= 1,
                          title: snapshot.dots.length <= 1 ? "至少要留一个 bot" : "删除这个 bot",
                          onClick: () => run({ action: "delete", id: dot.id }),
                        }, "删除"))
                    : null)))),
          h("div", { className: "dshdot-note" },
            "新建的 bot 默认叫「屿」，进去之后可以在设置里改名。名字、类型和对话各自独立，记忆和队列是全体共享的。"),
          error === null ? null : h("div", { className: "dshdot-err", style: { margin: 0 } }, error)));
    }

    function ChatView(props) {
      const { snapshot, current, types, state, onHome, onNew, onSettings, refresh } = props;
      const [draft, setDraft] = useState("");
      const [sending, setSending] = useState(false);
      const [error, setError] = useState(null);
      const [pane, setPane] = useState("chat");
      const [query, setQuery] = useState("");
      const [files, setFiles] = useState([]);
      const [catalog, setCatalog] = useState(null);
      const streamRef = useRef(null);
      const fileRef = useRef(null);
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const dotId = current === null ? "" : current.id;

      useEffect(() => {
        const node = streamRef.current;
        if (node !== null) node.scrollTop = node.scrollHeight;
      }, [messages.length, sending, pane]);

      // Looking at a transcript is what clears its unread mark.
      useEffect(() => {
        markSeen(dotIn(live.snapshot, dotId));
      }, [dotId, messages.length]);

      // The model menu mirrors the deployment's own catalogue. An instance may
      // pin one; otherwise it follows whatever the default is at call time.
      useEffect(() => {
        let alive = true;
        fetch("/api/dot.models", { cache: "no-store", headers: { accept: "application/json" } })
          .then((response) => response.json())
          .then((value) => {
            if (alive) setCatalog(value);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, []);

      const pinned = current !== null && current !== undefined && current.model !== null && current.model !== undefined
        ? current.model.provider + "|" + current.model.model
        : "";
      const options = catalog !== null && Array.isArray(catalog.models) ? catalog.models : [];

      const quiet = async (path, body) => {
        setError(null);
        try {
          const result = await call(path, body);
          if (result.error !== undefined) setError(result.error);
        } catch (failure) {
          setError(String(failure && failure.message ? failure.message : failure));
        } finally {
          await refresh();
        }
      };

      const changeModel = (value) => {
        if (value === "") return quiet("/api/dot.manage", { action: "model", id: dotId, model: null });
        const cut = value.indexOf("|");
        return quiet("/api/dot.manage", {
          action: "model",
          id: dotId,
          model: { provider: value.slice(0, cut), model: value.slice(cut + 1) },
        });
      };

      const pickFiles = async (event) => {
        const picked = Array.from(event.target.files === null ? [] : event.target.files);
        event.target.value = "";
        const loaded = [];
        for (const file of picked) {
          try {
            loaded.push({ name: file.name, text: await file.text() });
          } catch {
            /* an unreadable file simply does not ride along */
          }
        }
        if (loaded.length > 0) setFiles((list) => [...list, ...loaded]);
      };

      const send = async () => {
        const text = draft.trim();
        if ((text.length === 0 && files.length === 0) || sending) return;
        const riding = files;
        setDraft("");
        setFiles([]);
        setSending(true);
        setError(null);
        try {
          const result = await call("/api/dot.chat", {
            text: text.length === 0 ? "（见附件）" : text,
            dotId,
            attachments: riding,
          });
          if (result.error !== undefined) setError(result.error);
        } catch (failure) {
          setError(String(failure && failure.message ? failure.message : failure));
        } finally {
          setSending(false);
          await refresh();
        }
      };

      // One turn = one user message plus whatever it produced here. A resident
      // has no tool calls, so a turn is the finest structure the trace has.
      const turns = [];
      for (const message of messages) {
        if (message.role === "user" || turns.length === 0) {
          turns.push({ index: turns.length + 1, items: [message] });
        } else {
          turns[turns.length - 1].items.push(message);
        }
      }
      const calls = messages.filter((message) => message.meta !== undefined).length;
      const totalMs = messages.reduce(
        (sum, message) => sum + (message.meta !== undefined && typeof message.meta.ms === "number" ? message.meta.ms : 0),
        0,
      );
      const needle = query.trim();
      const keep = (message) => needle.length === 0 || message.text.includes(needle);

      return h("div", { className: "dshdot" },
        h("style", null, CSS),
        h("div", { className: "dshdot-bar" },
          h("button", { type: "button", className: "dshdot-icon", title: "回到 bot", "aria-label": "回到 bot", onClick: onHome },
            h(BackIcon, null)),
          h("span", {
            className: "dshdot-avatar",
            "data-tone": toneOf(state),
            "data-size": "small",
            // A paused resident holds still; the breathing is the "it is alive" cue.
            "data-live": String(current !== null && current.paused !== true),
          },
            h(DotFace, { className: "dshdot-face" })),
          h("div", { className: "dshdot-who" },
            h("h1", { className: "dshdot-name" }, current === null ? "屿" : current.name),
            h("p", { className: "dshdot-state" },
              "心跳 " + ago(snapshot.heartbeatAt)
              + " · " + typeName(types, current === null ? "" : current.type)
              + " · " + messages.length + " 条消息"
              + (snapshot.stats.taskQueued > 0 ? " · " + snapshot.stats.taskQueued + " 件在排队" : "")
              + (snapshot.worker !== undefined && snapshot.worker.state === "running" ? " · 正在做活" : ""))),
          h("button", { type: "button", className: "dshdot-icon", title: "新建 bot", "aria-label": "新建 bot", onClick: onNew },
            h("span", { style: { fontSize: "17px", lineHeight: 1 } }, "＋")),
          h("button", { type: "button", className: "dshdot-icon", title: "设置", "aria-label": "设置", onClick: onSettings },
              h(GearIcon, null))),
        h("div", { className: "dshdot-panes" },
          h("button", {
            type: "button",
            className: "dshdot-pane",
            "data-active": String(pane === "chat"),
            onClick: () => setPane("chat"),
          }, "对话"),
          h("button", {
            type: "button",
            className: "dshdot-pane",
            "data-active": String(pane === "trace"),
            onClick: () => setPane("trace"),
          }, "轨迹")),
        pane === "chat"
          ? h("div", { className: "dshdot-chat", ref: streamRef },
              messages.length === 0 && !sending
                ? h("div", { className: "dshdot-empty" }, "还没有对话。说第一句话吧。")
                : messages.map((message) => h("div", {
                    key: message.id,
                    className: "dshdot-turn",
                    "data-role": message.role,
                  }, message.text)),
              sending ? h("div", { className: "dshdot-think" }, "正在想…") : null)
          : h("div", { className: "dshdot-trace" },
              h("div", { className: "dshdot-trace-tools" },
                h("span", { className: "dshdot-tracestat" }, "总耗时 " + totalMs + " ms"),
                h("span", { className: "dshdot-tracestat" }, turns.length + " 轮"),
                h("span", { className: "dshdot-tracestat" }, calls + " 次调用"),
                h("span", { className: "dshdot-spacer" }),
                h("input", {
                  className: "dshdot-text",
                  style: { maxWidth: "220px" },
                  value: query,
                  placeholder: "搜索…",
                  onChange: (event) => setQuery(event.target.value),
                })),
              h("div", { className: "dshdot-trace-body" },
                turns.length === 0
                  ? h("div", { className: "dshdot-empty" }, "还没有可看的记录；说过话之后这里会有每一轮的模型、耗时和用量。")
                  : turns.map((turn) => {
                      const items = turn.items.filter(keep);
                      if (items.length === 0) return null;
                      return h("div", { key: turn.index },
                        h("div", { className: "dshdot-node", "data-kind": "turn" },
                          h("span", { className: "dshdot-dot" }),
                          h("div", { className: "dshdot-nodehead" }, h("b", null, "第 " + turn.index + " 轮"))),
                        items.map((message) => h("div", {
                          key: message.id,
                          className: "dshdot-node",
                          "data-role": message.role,
                        },
                          h("span", { className: "dshdot-dot" }),
                          h("div", { className: "dshdot-nodehead" },
                            h("b", null, message.role === "user" ? "提问" : "回复"),
                            message.meta === undefined
                              ? null
                              : h("span", null,
                                  (message.meta.model === undefined ? "—" : message.meta.model)
                                  + (typeof message.meta.ms === "number" ? " · " + message.meta.ms + " ms" : "")
                                  + (message.meta.tokens === undefined
                                    ? ""
                                    : " · 输入 " + message.meta.tokens.input + " / 输出 " + message.meta.tokens.output)
                                  + (message.meta.attachments === undefined ? "" : " · 附件 " + message.meta.attachments.join("、"))),
                            h("span", null, new Date(message.at).toLocaleTimeString())),
                          h("div", { className: "dshdot-nodetext" },
                            message.text.length > 300 ? message.text.slice(0, 300) + "…" : message.text))));
                    }))),
        error === null ? null : h("div", { className: "dshdot-err" }, error),
          h("div", { className: "dshdot-composer" },
            h("div", { className: "dshdot-card" },
          files.length === 0
            ? null
            : h("div", { className: "dshdot-chips" }, files.map((file, index) => h("span", {
                key: file.name + index,
                className: "dshdot-chip",
              },
                file.name,
                h("button", {
                  type: "button",
                  className: "dshdot-chip-x",
                  title: "移除",
                  onClick: () => setFiles((list) => list.filter((unused, position) => position !== index)),
                }, "×")))),
          h("textarea", {
            className: "dshdot-input",
            rows: 1,
            value: draft,
            placeholder: current === null ? "说点什么…" : "跟" + current.name + "说点什么…",
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            },
          }),
              h("div", { className: "dshdot-row" },
            h("button", {
              type: "button",
              className: "dshdot-tool",
              title: "加附件（文本文件）",
              "aria-label": "加附件",
              onClick: () => {
                if (fileRef.current !== null) fileRef.current.click();
              },
            }, "＋"),
            h("input", { type: "file", ref: fileRef, multiple: true, style: { display: "none" }, onChange: pickFiles }),
            h("select", {
              className: "dshdot-select",
              title: "权限：完全权限可以让它在后台干活，仅对话则不让",
              value: current === null ? "full" : current.permission,
              onChange: (event) => quiet("/api/dot.manage", { action: "permission", id: dotId, permission: event.target.value }),
            },
              h("option", { value: "full" }, "完全权限"),
              h("option", { value: "readonly" }, "只读"),
              h("option", { value: "chat" }, "仅对话")),
            h("span", { className: "dshdot-spacer" }),
            h("button", {
              type: "button",
              className: "dshdot-tool",
              disabled: sending || messages.length === 0,
              title: "回退最后一条",
              onClick: () => quiet("/api/dot.rewind", { dotId, count: 1 }),
            }, "回退"),
            h("select", {
              className: "dshdot-select",
              title: "模型",
              value: pinned,
              onChange: (event) => changeModel(event.target.value),
            },
              h("option", { value: "" }, "默认模型"),
              options.map((entry) => h("option", {
                key: entry.provider + "|" + entry.id,
                value: entry.provider + "|" + entry.id,
              }, entry.name === undefined || entry.name === "" ? entry.id : entry.name))),
            h("button", {
              type: "button",
              className: "dshdot-send",
              disabled: sending || (draft.trim().length === 0 && files.length === 0),
              onClick: send,
            }, sending ? "…" : "发送")))));
    }

    function SettingsView(props) {
      const { snapshot, types, onClose, onChanged } = props;
      const current = snapshot.dots.find((dot) => dot.id === snapshot.activeDotId) ?? snapshot.dots[0];
      const [name, setName] = useState(current === undefined ? "" : current.name);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [newTask, setNewTask] = useState("");
      const [newRepeat, setNewRepeat] = useState("");
      const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
      // Four buckets now. A job stopped at a boundary needs its own, because it
      // is neither running nor finished — and putting it in either one hides the
      // fact that somebody has to answer before anything else happens.
      const stamp = new Date().toISOString();
      const taskGroups = [
        {
          key: "waiting",
          title: "等你批准",
          items: tasks.filter((task) => task.state === "awaiting"),
        },
        {
          key: "progress",
          title: "进行中",
          items: tasks.filter((task) => task.state === "running"
            || (task.state === "queued" && (task.dueAt === "" || task.dueAt <= stamp))),
        },
        {
          key: "scheduled",
          title: "已计划",
          items: tasks.filter((task) => task.state === "queued" && task.dueAt !== "" && task.dueAt > stamp),
        },
        {
          key: "done",
          title: "已完成",
          items: tasks.filter(
            (task) => task.state === "succeeded" || task.state === "failed" || task.state === "cancelled",
          ),
        },
      ].filter((group) => group.items.length > 0 || group.key !== "waiting");
      const settings = snapshot.settings === undefined ? {} : snapshot.settings;
      const rules = settings.rules === undefined
        ? { background: "auto", outgoing: "auto" }
        : settings.rules;
      const [pollDraft, setPollDraft] = useState(String(settings.workerPollSeconds ?? 30));
      const [concDraft, setConcDraft] = useState(String(settings.workerConcurrency ?? 3));
      // Memory lives on disk now, so the panel reads the tree rather than
      // trusting a list it happens to be holding: whatever the user edited by
      // hand is what shows up here.
      // MCP：一个地址输入框加一个检测按钮。插件不带服务，也不带凭据。
      const [mcpUrl, setMcpUrl] = useState("");
      const [mcpName, setMcpName] = useState("");
      const [memoryDir, setMemoryDir] = useState("");
      const [memoryFiles, setMemoryFiles] = useState([]);
      const loadMemoryTree = useCallback(() => {
        call("/api/dot.manage", { action: "memoryTree" })
          .then((value) => {
            if (Array.isArray(value.files)) setMemoryFiles(value.files);
            if (typeof value.dir === "string") setMemoryDir(value.dir);
          })
          .catch(() => {});
      }, []);
      useEffect(() => { loadMemoryTree(); }, [loadMemoryTree]);
      const briefing = snapshot.briefing?.config ?? {
        enabled: false, at: "08:00", connectorId: "", dotId: "", lastAt: "",
      };
      const [briefAtDraft, setBriefAtDraft] = useState(briefing.at ?? "08:00");
      const saveBriefing = (patch) => saveSettings({ briefing: { ...briefing, ...patch } });
      // Every tuning number, editable. Zero means "no limit" and is labelled as
      // such rather than looking like an off switch.
      const limits = settings.limits ?? {};
      const [limitDrafts, setLimitDrafts] = useState({});
      const limitValue = (key, fallback) => (limitDrafts[key] ?? String(limits[key] ?? fallback));
      const saveLimit = (key) => saveSettings({ limits: { ...limits, [key]: Number(limitValue(key, 0)) } });
      // The autonomy snapshot arrives with the worker one; keep a shape that is
      // safe to read before the first poll lands.
      const autonomy = snapshot.autonomy ?? {
        state: "idle",
        reason: "",
        today: 0,
        config: { enabled: false, idleMinutes: 30, cooldownMinutes: 180, pollSeconds: 60, permission: "read", model: null },
      };
      const [idleDraft, setIdleDraft] = useState(String(autonomy.config.idleMinutes ?? 30));
      const [coolDraft, setCoolDraft] = useState(String(autonomy.config.cooldownMinutes ?? 180));
      // The picker needs the advertised models and, for each, the thinking tiers
      // its adapter accepts — that is what decides the second dropdown.
      const [choices, setChoices] = useState([]);
      useEffect(() => {
        let alive = true;
        call("/api/dot.models")
          .then((value) => {
            if (alive) setChoices(Array.isArray(value.models) ? value.models : []);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, []);
      const autonomyChoice = autonomy.config.model ?? null;
      const autonomyKey = autonomyChoice === null
        ? "|"
        : `${autonomyChoice.provider}|${autonomyChoice.model}`;
      const autonomyModel = choices.find((entry) => entry.provider === (autonomyChoice === null ? "" : autonomyChoice.provider)
        && entry.id === (autonomyChoice === null ? "" : autonomyChoice.model));
      const [avatarDraft, setAvatarDraft] = useState(settings.avatarPath ?? "");
      const [connForm, setConnForm] = useState(null);
      const [workDraft, setWorkDraft] = useState(current === undefined ? "" : (current.workspace ?? ""));
      const [environments, setEnvironments] = useState([]);

      // What this machine can offer is a question for the Host; it runs the
      // probes, the panel only shows the answer.
      useEffect(() => {
        let alive = true;
        fetch("/api/dot.env", { cache: "no-store", headers: { accept: "application/json" } })
          .then((response) => response.json())
          .then((value) => {
            if (alive) setEnvironments(Array.isArray(value.environments) ? value.environments : []);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, []);
      const connectors = Array.isArray(snapshot.connectors) ? snapshot.connectors : [];
      const agenda = Array.isArray(snapshot.agenda) ? snapshot.agenda : [];
      const mcpServers = Array.isArray(snapshot.mcpServers) ? snapshot.mcpServers : [];

      useEffect(() => {
        if (current !== undefined) setName(current.name);
      }, [current === undefined ? "" : current.id, current === undefined ? "" : current.name]);

      // The drafts follow the store, so a change made elsewhere (another view,
      // or a reload) does not leave a stale number in the box.
      useEffect(() => {
        setPollDraft(String(settings.workerPollSeconds ?? 30));
        setConcDraft(String(settings.workerConcurrency ?? 3));
        setAvatarDraft(settings.avatarPath ?? "");
      }, [settings.workerPollSeconds, settings.workerConcurrency, settings.avatarPath]);

      useEffect(() => {
        setBriefAtDraft(briefing.at ?? "08:00");
      }, [briefing.at]);

      useEffect(() => {
        setIdleDraft(String(autonomy.config.idleMinutes ?? 30));
        setCoolDraft(String(autonomy.config.cooldownMinutes ?? 180));
      }, [autonomy.config.idleMinutes, autonomy.config.cooldownMinutes]);

      useEffect(() => {
        setWorkDraft(current === undefined ? "" : (current.workspace ?? ""));
      }, [current === undefined ? "" : current.id, current === undefined ? "" : current.workspace]);

      const run = async (body) => {
        setBusy(true);
        setError(null);
        try {
          const result = await call("/api/dot.manage", body);
          if (result.error !== undefined) setError(result.error);
          else await onChanged();
        } catch (failure) {
          setError(String(failure && failure.message ? failure.message : failure));
        } finally {
          setBusy(false);
        }
      };

      const addTask = async () => {
        const title = newTask.trim();
        if (title.length === 0 || busy) return;
        const repeat = newRepeat.trim();
        setNewTask("");
        setNewRepeat("");
        await run({ action: "task", op: "add", title, repeat });
      };

      const saveSettings = (patch) => run({ action: "settings", patch });

      const openConnector = (entry) => setConnForm({
        id: entry === undefined ? undefined : entry.id,
        name: entry === undefined ? "" : entry.name,
        kind: entry === undefined ? "telegram" : entry.kind,
        token: entry === undefined ? "" : entry.token,
        chatId: entry === undefined ? "" : entry.chatId,
        url: entry === undefined ? "" : entry.url,
        method: entry === undefined ? "POST" : entry.method,
        headers: entry === undefined ? "" : entry.headers,
        allowedDots: entry === undefined ? [] : [...entry.allowedDots],
        // Receiving is opt-in per connection: a send-only hook stays send-only.
        inbound: entry === undefined ? false : entry.inbound === true,
        bindDotId: entry === undefined ? "" : entry.bindDotId,
      });

      const saveConnector = () => {
        const draft = connForm;
        setConnForm(null);
        if (draft.id === undefined) {
          run({
            action: "connectorAdd",
            name: draft.name,
            kind: draft.kind,
            inbound: draft.inbound,
            bindDotId: draft.bindDotId,
            token: draft.token,
            chatId: draft.chatId,
            url: draft.url,
            method: draft.method,
            headers: draft.headers,
            allowedDots: draft.allowedDots,
          });
        } else {
          run({
            action: "connectorEdit",
            connectorId: draft.id,
            name: draft.name,
            kind: draft.kind,
            inbound: draft.inbound,
            bindDotId: draft.bindDotId,
            token: draft.token,
            chatId: draft.chatId,
            url: draft.url,
            method: draft.method,
            headers: draft.headers,
            allowedDots: draft.allowedDots,
          });
        }
      };

      /** Ask the executor to work one job now. It answers when the job settles. */
      const poke = async () => {
        setBusy(true);
        setError(null);
        try {
          const result = await call("/api/dot.worker", { action: "poke" });
          if (result.error !== undefined) setError(result.error);
          else await onChanged();
        } catch (failure) {
          setError(String(failure && failure.message ? failure.message : failure));
        } finally {
          setBusy(false);
        }
      };

      if (current === undefined) return null;
      const trimmed = name.trim();
      const worker = snapshot.worker ?? { state: "—", reason: "", runsToday: 0 };
      return h("div", { className: "dshdot" },
        h("style", null, CSS),
        // A plain view, not a floating layer: an absolutely positioned sheet
        // resolves against whatever ancestor happens to be positioned, which
        // put this one's close button on top of the shell's own header.
        h("div", { className: "dshdot-overlay" },
        h("div", { className: "dshdot-overlay-head" },
          h("button", { type: "button", className: "dshdot-icon", onClick: onClose, title: "返回", "aria-label": "返回" },
            h(BackIcon, null)),
          h("h2", { className: "dshdot-h1" }, "设置 · " + current.name)),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "运行状态"),
          h("div", { className: "dshdot-row" },
            h("button", {
              type: "button",
              className: "dshdot-btn",
              "data-on": String(current.paused !== true),
              disabled: busy,
              onClick: () => run({ action: "pause", id: current.id, paused: current.paused !== true }),
            }, current.paused === true ? "已暂停 · 点击恢复" : "运行中 · 点击暂停"),
            h("span", { className: "dshdot-note" }, "暂停后它不再自己动队列，说话照常。")),
          h("div", { className: "dshdot-row" },
            h("button", {
              type: "button",
              className: "dshdot-btn",
              "data-danger": "true",
              disabled: busy,
              onClick: () => run({ action: "reset", id: current.id }),
            }, "重置这个 bot"),
            h("span", { className: "dshdot-note" }, "清掉它的对话、模型选择和暂停状态；名字、类型和身份保留。"))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "工作区"),
          h("div", { className: "dshdot-note" },
            "它干活的地方，文件都在这里。留空用宿主当前目录；填了会帮你建出来。"),
          h("div", { className: "dshdot-row" },
            h("input", {
              className: "dshdot-text",
              value: workDraft,
              placeholder: "比如 D:\\bots\\yu",
              onChange: (event) => setWorkDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") {
                  run({ action: "workspace", id: current.id, workspace: workDraft.trim() });
                }
              },
            }),
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy || workDraft === (current.workspace ?? ""),
              onClick: () => run({ action: "workspace", id: current.id, workspace: workDraft.trim() }),
            }, "应用"))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "执行环境"),
          h("div", { className: "dshdot-note" },
            "它的命令在哪里跑。本机就是直接用这台电脑；选 WSL 等于给它一台自己的 Linux 机器。"),
          environments.length <= 1
            ? h("div", { className: "dshdot-note" },
                "这台机器目前只有本机可用。要给它一台自己的机器，用管理员权限开一个终端跑 ",
                h("code", { className: "dshdot-code" }, "wsl --install"),
                " ，装完重启，回到这里就能选。")
            : h("div", { className: "dshdot-row" },
                h("select", {
                  className: "dshdot-select",
                  value: (current.environment === undefined ? "host" : current.environment.kind)
                    + "|" + (current.environment === undefined ? "" : current.environment.target),
                  onChange: (event) => {
                    const cut = event.target.value.indexOf("|");
                    run({
                      action: "environment",
                      id: current.id,
                      kind: event.target.value.slice(0, cut),
                      target: event.target.value.slice(cut + 1),
                    });
                  },
                },
                  environments.map((entry) => h("option", {
                    key: entry.kind + "|" + entry.target,
                    value: entry.kind + "|" + entry.target,
                  }, entry.label))))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "规则"),
          h("div", { className: "dshdot-note" }, "它自己能动到什么程度。被挡住的活不会丢，会留在队列里等。"),
          h("div", { className: "dshdot-row" },
            h("span", { className: "dshdot-numwrap" }, "后台干活"),
            h("select", {
              className: "dshdot-select",
              value: rules.background,
              onChange: (event) => saveSettings({ rules: { ...rules, background: event.target.value } }),
            },
              h("option", { value: "auto" }, "直接做"),
              h("option", { value: "preapproved" }, "我派的才做"),
              h("option", { value: "ask" }, "做前问我"),
              h("option", { value: "handoff" }, "只提示我"))),
          h("div", { className: "dshdot-row" },
            h("span", { className: "dshdot-numwrap" }, "对外发送"),
            h("select", {
              className: "dshdot-select",
              value: rules.outgoing,
              onChange: (event) => saveSettings({ rules: { ...rules, outgoing: event.target.value } }),
            },
              h("option", { value: "auto" }, "直接发"),
              h("option", { value: "preapproved" }, "我派的才发"),
              h("option", { value: "ask" }, "发前问我"),
              h("option", { value: "handoff" }, "只提示我")))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "名字"),
          h("div", { className: "dshdot-row" },
            h("input", {
              className: "dshdot-text",
              value: name,
              onChange: (event) => setName(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter" && trimmed.length > 0 && trimmed !== current.name) {
                  run({ action: "rename", id: current.id, name: trimmed });
                }
              },
              placeholder: "给它起个名字",
            }),
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy || trimmed.length === 0 || trimmed === current.name,
              onClick: () => run({ action: "rename", id: current.id, name: trimmed }),
            }, "保存"))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "类型"),
          h("div", { className: "dshdot-grid" }, types.map((type) => h("button", {
            key: type.id,
            type: "button",
            className: "dshdot-option",
            "data-picked": String(type.id === current.type),
            disabled: busy,
            onClick: () => run({ action: "type", id: current.id, type: type.id }),
          },
            h("b", null, type.name),
            h("span", null, type.blurb))))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "后台执行"),
          h("div", { className: "dshdot-row" },
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy,
              onClick: () => saveSettings({ workerEnabled: settings.workerEnabled !== true }),
            }, settings.workerEnabled === true ? "已开启 · 点击关闭" : "已关闭 · 点击开启"),
            h("span", { className: "dshdot-note" }, "打开后它会自己按队列干活，每次执行都会花掉模型额度。")),
          h("div", { className: "dshdot-row" },
            h("label", { className: "dshdot-numwrap" }, "每",
              h("input", {
                className: "dshdot-num",
                type: "number",
                min: "5",
                value: pollDraft,
                disabled: busy,
                onChange: (event) => setPollDraft(event.target.value),
                onBlur: () => saveSettings({ workerPollSeconds: Number(pollDraft) }),
              }), "秒看一次队列"),
            h("label", { className: "dshdot-numwrap" }, "同时做",
              h("input", {
                className: "dshdot-num",
                type: "number",
                min: "1",
                max: "32",
                value: concDraft,
                disabled: busy,
                onChange: (event) => setConcDraft(event.target.value),
                onBlur: () => saveSettings({ workerConcurrency: Number(concDraft) }),
              }), "件")),
          h("div", { className: "dshdot-note" },
            "执行器：" + worker.state + (worker.reason === "" ? "" : "（" + worker.reason + "）")
            + "　今天跑了 " + String(worker.runsToday ?? 0) + " 次，没有上限——开和关就是唯一的总闸。")),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "晨间简报"),
          h("div", { className: "dshdot-note" },
            "每天到点，把夜里发生的事汇总一条发给你：从连接进来的消息，加上排队的活做完了什么。"
            + "没东西可说的时候它不会打扰你。"),
          h("div", { className: "dshdot-row" },
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy,
              onClick: () => saveBriefing({ enabled: briefing.enabled !== true }),
            }, briefing.enabled === true ? "已开启 · 点击关闭" : "已关闭 · 点击开启"),
            h("label", { className: "dshdot-numwrap" }, "时间",
              h("input", {
                className: "dshdot-num",
                style: { width: "78px" },
                value: briefAtDraft,
                placeholder: "08:00",
                disabled: busy,
                onChange: (event) => setBriefAtDraft(event.target.value),
                onBlur: () => saveBriefing({ at: briefAtDraft.trim() }),
              })),
            h("label", { className: "dshdot-numwrap" }, "走",
              h("select", {
                className: "dshdot-select",
                disabled: busy,
                value: briefing.connectorId ?? "",
                onChange: (event) => saveBriefing({ connectorId: event.target.value }),
              },
                h("option", { value: "" }, "任意可用的连接"),
                connectors.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.name))))),
          h("div", { className: "dshdot-row" },
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy,
              onClick: () => call("/api/dot.manage", { action: "briefingNow", dotId: current.id })
                .then((value) => {
                  if (value.error !== undefined) setError(value.error);
                  else if (value.skipped === "quiet") setError("没有值得说的事，它选择了沉默");
                  else if (value.sent !== undefined) setError("已经发出去了（" + value.sent + " 条）");
                  else setError(null);
                })
                .catch(() => {}),
            }, "现在发一条"),
            h("span", { className: "dshdot-note" },
              briefing.lastAt === "" || briefing.lastAt === undefined
                ? "还没发过"
                : "上次发出：" + shortAgo(briefing.lastAt)))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "日程"),
          h("div", { className: "dshdot-note" },
            "交给它记的日程和提醒。到点它会通过上面那条连接说出来——不受晨间简报开关影响。"),
          agenda.length === 0
            ? h("div", { className: "dshdot-note" }, "还没有安排。跟它说「周五晚上八点提醒我」就会出现在这里。")
            : h("ul", { className: "dshdot-list" }, agenda.map((entry) => h("li", {
                key: entry.id,
                className: "dshdot-item",
              },
                h("span", { className: "dshdot-tag" }, entry.done ? "已完成" : shortAgo(entry.at)),
                h("span", { style: { flex: 1, minWidth: 0 } }, entry.text),
                h("button", {
                  type: "button",
                  className: "dshdot-btn",
                  disabled: busy,
                  title: "删掉这一条",
                  onClick: () => call("/api/dot.manage", { action: "agendaRemove", id: entry.id })
                    .then(() => onChanged())
                    .catch(() => {}),
                }, "删除"))))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "限额"),
          h("div", { className: "dshdot-note" },
            "这些数字都是你的，不是我们定的。填 0 就是不限——除了并发数和轮询间隔需要有个范围，其余都不拦你。"),
          h("div", { className: "dshdot-row" },
            h("label", { className: "dshdot-numwrap" }, "单个任务最多跑",
              h("input", {
                className: "dshdot-num",
                type: "number",
                min: "0",
                value: limitValue("taskMinutes", 30),
                disabled: busy,
                onChange: (event) => setLimitDrafts({ ...limitDrafts, taskMinutes: event.target.value }),
                onBlur: () => saveLimit("taskMinutes"),
              }), "分钟"),
            h("label", { className: "dshdot-numwrap" }, "每天累计最多",
              h("input", {
                className: "dshdot-num",
                type: "number",
                min: "0",
                value: limitValue("dailyMinutes", 0),
                disabled: busy,
                onChange: (event) => setLimitDrafts({ ...limitDrafts, dailyMinutes: event.target.value }),
                onBlur: () => saveLimit("dailyMinutes"),
              }), "分钟"),
            h("label", { className: "dshdot-numwrap" }, "每个任务最多调",
              h("input", {
                className: "dshdot-num",
                type: "number",
                min: "0",
                value: limitValue("toolRounds", 8),
                disabled: busy,
                onChange: (event) => setLimitDrafts({ ...limitDrafts, toolRounds: event.target.value }),
                onBlur: () => saveLimit("toolRounds"),
              }), "次工具")),
          h("div", { className: "dshdot-row" },
            h("label", { className: "dshdot-numwrap" }, "队列保留",
              h("input", {
                className: "dshdot-num",
                type: "number",
                min: "10",
                value: limitValue("taskLimit", 300),
                disabled: busy,
                onChange: (event) => setLimitDrafts({ ...limitDrafts, taskLimit: event.target.value }),
                onBlur: () => saveLimit("taskLimit"),
              }), "条"),
            h("label", { className: "dshdot-numwrap" }, "回放",
              h("input", {
                className: "dshdot-num",
                type: "number",
                min: "0",
                value: limitValue("recallMessages", 12),
                disabled: busy,
                onChange: (event) => setLimitDrafts({ ...limitDrafts, recallMessages: event.target.value }),
                onBlur: () => saveLimit("recallMessages"),
              }), "条对话当上下文"),
            h("label", { className: "dshdot-numwrap" }, "面板加载",
              h("input", {
                className: "dshdot-num",
                type: "number",
                min: "10",
                value: limitValue("transcriptWindow", 60),
                disabled: busy,
                onChange: (event) => setLimitDrafts({ ...limitDrafts, transcriptWindow: event.target.value }),
                onBlur: () => saveLimit("transcriptWindow"),
              }), "条"))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "自主时间"),
          h("div", { className: "dshdot-note" },
            "没人跟你说话的时候，它自己找点事做：查感兴趣的东西、收拾工作区、把没想完的事想完。"
            + "产物写到它自己的工作区，不塞进对话——所以聊天记录永远是聊天记录。"),
          h("div", { className: "dshdot-row" },
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy,
              onClick: () => saveSettings({
                autonomy: { ...autonomy.config, enabled: autonomy.config.enabled !== true },
              }),
            }, autonomy.config.enabled === true ? "已开启 · 点击关闭" : "已关闭 · 点击开启"),
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy || settings.workerEnabled !== true,
              title: settings.workerEnabled === true ? "不用等空闲，现在就给它派一件" : "先打开后台执行",
              onClick: () => call("/api/dot.worker", { action: "trigger", dotId: current.id })
                .then(() => onChanged())
                .catch(() => {}),
            }, "现在就去看一眼"),
            h("span", { className: "dshdot-note" },
              "状态：" + autonomy.state + (autonomy.reason === "" ? "" : "（" + autonomy.reason + "）")
              + "　今天 " + String(autonomy.today ?? 0) + " 次")),
          h("div", { className: "dshdot-row" },
            h("label", { className: "dshdot-numwrap" }, "空闲",
              h("input", {
                className: "dshdot-num",
                type: "number",
                min: "1",
                value: idleDraft,
                disabled: busy,
                onChange: (event) => setIdleDraft(event.target.value),
                onBlur: () => saveSettings({
                  autonomy: { ...autonomy.config, idleMinutes: Number(idleDraft) },
                }),
              }), "分钟后"),
            h("label", { className: "dshdot-numwrap" }, "每隔",
              h("input", {
                className: "dshdot-num",
                type: "number",
                min: "0",
                value: coolDraft,
                disabled: busy,
                onChange: (event) => setCoolDraft(event.target.value),
                onBlur: () => saveSettings({
                  autonomy: { ...autonomy.config, cooldownMinutes: Number(coolDraft) },
                }),
              }), "分钟最多一次（0＝不设间隔）")),
          h("div", { className: "dshdot-row" },
            h("span", { className: "dshdot-note" }, "没人看着的时候它能做什么：")),
          h("div", { className: "dshdot-row" },
            ...AUTONOMY_MODES.map((entry) => h("button", {
              key: entry.id,
              type: "button",
              className: "dshdot-tool",
              "data-on": String((autonomy.config.permission ?? "read") === entry.id),
              disabled: busy,
              title: entry.blurb,
              onClick: () => saveSettings({
                autonomy: { ...autonomy.config, permission: entry.id },
              }),
            }, entry.label)),
            h("span", { className: "dshdot-note" },
              AUTONOMY_MODES.find((entry) => entry.id === (autonomy.config.permission ?? "read"))?.blurb ?? "")),
          h("div", { className: "dshdot-row" },
            h("label", { className: "dshdot-numwrap" }, "空闲时用",
              h("select", {
                className: "dshdot-select",
                disabled: busy,
                value: autonomyKey,
                onChange: (event) => {
                  const cut = event.target.value.indexOf("|");
                  const provider = event.target.value.slice(0, cut);
                  const model = event.target.value.slice(cut + 1);
                  saveSettings({
                    autonomy: {
                      ...autonomy.config,
                      model: model === "" ? null : { provider, model },
                    },
                  });
                },
              },
                h("option", { value: "|" }, "跟随它自己的模型"),
                choices.map((entry) => h("option", {
                  key: `${entry.provider}|${entry.id}`,
                  value: `${entry.provider}|${entry.id}`,
                }, entry.name === undefined ? entry.id : entry.name)))),
            autonomyModel === undefined || !Array.isArray(autonomyModel.efforts) || autonomyModel.efforts.length === 0
              ? null
              : h("label", { className: "dshdot-numwrap" }, "思考",
                  h("select", {
                    className: "dshdot-select",
                    disabled: busy,
                    value: autonomyChoice === null || autonomyChoice.reasoningEffort === undefined
                      ? ""
                      : autonomyChoice.reasoningEffort,
                    onChange: (event) => saveSettings({
                      autonomy: {
                        ...autonomy.config,
                        model: {
                          ...autonomyChoice,
                          ...(event.target.value === "" ? {} : { reasoningEffort: event.target.value }),
                        },
                      },
                    }),
                  },
                    h("option", { value: "" }, "默认"),
                    autonomyModel.efforts.map((effort) => h("option", {
                      key: effort.id,
                      value: effort.id,
                    }, effort.name === undefined ? effort.id : effort.name)))))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "头像"),
          h("div", { className: "dshdot-row" },
                h("label", { className: "dshdot-btn", title: "选一张图片存到本地，然后它是这个 bot 的形象" },
                  "上传图片",
                  h("input", {
                    type: "file",
                    accept: "image/png,image/jpeg,image/webp,image/gif",
                    style: { display: "none" },
                    onChange: (event) => {
                      const file = event.target.files === null ? undefined : event.target.files[0];
                      if (file === undefined) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        call("/api/dot.manage", {
                          action: "avatarUpload",
                          dotId: current.id,
                          dataUrl: String(reader.result),
                        })
                          .then((value) => {
                            if (value.error !== undefined) setError(value.error);
                            else {
                              setAvatarDraft(value.path ?? "");
                              loadAvatar(true);
                            }
                            return onChanged();
                          })
                          .catch(() => {});
                      };
                      reader.readAsDataURL(file);
                    },
                  })),
            h("input", {
              className: "dshdot-text",
              value: avatarDraft,
                  placeholder: "留空用内置形象；也可以填一个本地图片路径",
              onChange: (event) => setAvatarDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") {
                  const next = avatarDraft.trim();
                  loadAvatar(true);
                  saveSettings({ avatarPath: next });
                }
              },
            }),
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy || avatarDraft === (settings.avatarPath ?? ""),
              onClick: () => {
                loadAvatar(true);
                saveSettings({ avatarPath: avatarDraft.trim() });
              },
            }, "应用"))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "共享状态"),
          h("div", { className: "dshdot-row" },
            h("button", {
              type: "button",
              className: "dshdot-btn",
              "data-danger": "true",
              disabled: busy,
              onClick: () => run({ action: "clearShared" }),
            }, "清空共享记忆与任务队列")),
          h("div", { className: "dshdot-note" }, "只清这两份共享数据，各个 bot 自己的对话不动。")),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "MCP 服务"),
          h("div", { className: "dshdot-note" },
            "插件不带任何 MCP 服务，也不带凭据——你填一个地址，它就把那边的工具接过来。"
            + "工具名是 `mcp__服务名__工具名`，和别的客户端一致，复制过来就能用。"),
          mcpServers.length === 0
            ? h("div", { className: "dshdot-note" }, "还没有配置。填一个 streamable HTTP 地址就能用。")
            : h("ul", { className: "dshdot-list" }, mcpServers.map((entry) => h("li", {
                key: entry.id,
                className: "dshdot-item",
              },
                h(ServiceDot, { state: serviceState(entry) }),
                h("span", { style: { flex: 1, minWidth: 0, overflowWrap: "anywhere" } },
                  entry.name + " — " + entry.url
                  + (entry.tools.length === 0 ? "" : `（${entry.tools.length} 个工具）`)
                  + (entry.lastError === "" ? "" : `　✗ ${entry.lastError}`)),
                h("button", {
                  type: "button",
                  className: "dshdot-tool",
                  disabled: busy,
                  title: "连一次看看通不通，并把工具列表取回来",
                  onClick: () => call("/api/dot.manage", { action: "mcpProbe", serverId: entry.id })
                    .then((value) => {
                      setError(value.error === undefined
                        ? `${entry.name} 通了，${value.tools.length} 个工具`
                        : `${entry.name}：${value.error}`);
                      return onChanged();
                    })
                    .catch(() => {}),
                }, "检测"),
                h("button", {
                  type: "button",
                  className: "dshdot-tool",
                  disabled: busy,
                  onClick: () => call("/api/dot.manage", { action: "mcpRemove", serverId: entry.id })
                    .then(() => onChanged())
                    .catch(() => {}),
                }, "删除")))),
          h("div", { className: "dshdot-row" },
            h("input", {
              className: "dshdot-text",
              value: mcpUrl,
              placeholder: "https://example.com/mcp",
              onChange: (event) => setMcpUrl(event.target.value),
            }),
            h("input", {
              className: "dshdot-text",
              style: { maxWidth: "120px" },
              value: mcpName,
              placeholder: "名字",
              onChange: (event) => setMcpName(event.target.value),
            }),
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy || mcpUrl.trim() === "",
              onClick: () => call("/api/dot.manage", {
                action: "mcpAdd",
                server: { name: mcpName.trim() === "" ? "MCP" : mcpName.trim(), url: mcpUrl.trim() },
              })
                .then((value) => {
                  if (value.error === undefined) {
                    setMcpUrl("");
                    setMcpName("");
                  } else setError(value.error);
                  return onChanged();
                })
                .catch(() => {}),
            }, "＋ 添加"))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "连接"),
          h("div", { className: "dshdot-note" }, "插件不内置任何平台。填你自己的地址或 token，再决定哪个 bot 能用它。"),
          connectors.length === 0
            ? h("div", { className: "dshdot-note" }, "还没有配置任何连接。")
            : h("div", { className: "dshdot-rows" }, connectors.map((entry) => h("div", {
                key: entry.id,
                className: "dshdot-rowitem",
              },
                h("div", { className: "dshdot-rowtop" },
                  h("span", { className: "dshdot-rowmark", "data-unread": String(entry.enabled) }),
                    h(ServiceDot, { state: serviceState(entry) }),
                    h("span", { className: "dshdot-rowname" }, entry.name),
                  h("span", { className: "dshdot-rowmeta" }, entry.kind === "telegram" ? "Telegram" : "HTTP"),
                  h("span", { className: "dshdot-rowtime" }, entry.allowedDots.length === 0 ? "全部 bot" : entry.allowedDots.length + " 个")),
                  h("div", { className: "dshdot-rowactions" },
                    h("button", { type: "button", disabled: busy, onClick: () => openConnector(entry) }, "编辑"),
                    h("button", {
                      type: "button",
                      disabled: busy || !entry.inbound,
                      title: entry.inbound ? "现在收一次，看能不能通" : "这条连接只出不进，没法检测",
                      onClick: () => call("/api/dot.manage", { action: "connectorPull", connectorId: entry.id })
                        .then((value) => {
                          setError(value.error === undefined ? `${entry.name} 通了` : `${entry.name}：${value.error}`);
                          return onChanged();
                        })
                        .catch(() => {}),
                    }, "检测"),
                    h("button", {
                      type: "button",
                      disabled: busy,
                      onClick: () => run({ action: "connectorEdit", connectorId: entry.id, enabled: !entry.enabled }),
                    }, entry.enabled ? "停用" : "启用"),
                    h("button", {
                      type: "button",
                      "data-danger": "true",
                      disabled: busy,
                      onClick: () => run({ action: "connectorRemove", connectorId: entry.id }),
                    }, "删除"))))),
          connForm === null
            ? h("div", { className: "dshdot-row" },
                h("button", {
                  type: "button",
                  className: "dshdot-btn",
                  disabled: busy,
                  onClick: () => openConnector(undefined),
                }, "＋ 添加连接"))
            : h("div", { className: "dshdot-connform" },
                h("input", {
                  className: "dshdot-text",
                  value: connForm.name,
                  autoFocus: true,
                  placeholder: "名字，比如「家里的群」",
                  onChange: (event) => setConnForm({ ...connForm, name: event.target.value }),
                }),
                h("select", {
                  className: "dshdot-select",
                  value: connForm.kind,
                  onChange: (event) => setConnForm({ ...connForm, kind: event.target.value }),
                },
                  h("option", { value: "telegram" }, "Telegram"),
                  h("option", { value: "http" }, "HTTP 接口")),
                connForm.kind === "telegram"
                  ? h("input", {
                      className: "dshdot-text",
                      value: connForm.token,
                      placeholder: "Bot Token（从 @BotFather 拿）",
                      onChange: (event) => setConnForm({ ...connForm, token: event.target.value }),
                    })
                  : null,
                connForm.kind === "telegram"
                  ? h("input", {
                      className: "dshdot-text",
                      value: connForm.chatId,
                      placeholder: "Chat ID（发给谁）",
                      onChange: (event) => setConnForm({ ...connForm, chatId: event.target.value }),
                    })
                  : null,
                connForm.kind === "http"
                  ? h("input", {
                      className: "dshdot-text",
                      value: connForm.url,
                      placeholder: "https://…（可以放一个 {message} 占位）",
                      onChange: (event) => setConnForm({ ...connForm, url: event.target.value }),
                    })
                  : null,
                connForm.kind === "http"
                  ? h("select", {
                      className: "dshdot-select",
                      value: connForm.method,
                      onChange: (event) => setConnForm({ ...connForm, method: event.target.value }),
                    },
                      h("option", { value: "POST" }, "POST"),
                      h("option", { value: "PUT" }, "PUT"),
                      h("option", { value: "GET" }, "GET"))
                  : null,
                connForm.kind === "http"
                  ? h("textarea", {
                      className: "dshdot-input",
                      rows: 2,
                      value: connForm.headers,
                      placeholder: "额外请求头，一行一个：Authorization: Bearer …",
                      onChange: (event) => setConnForm({ ...connForm, headers: event.target.value }),
                    })
                  : null,
                h("div", { className: "dshdot-note" }, "允许哪些 bot 使用（一个都不勾＝全部）："),
                h("div", { className: "dshdot-chips" }, snapshot.dots.map((dot) => h("button", {
                  key: dot.id,
                  type: "button",
                  className: "dshdot-tool",
                  "data-on": String(connForm.allowedDots.includes(dot.id)),
                  onClick: () => setConnForm({
                    ...connForm,
                    allowedDots: connForm.allowedDots.includes(dot.id)
                      ? connForm.allowedDots.filter((id) => id !== dot.id)
                      : [...connForm.allowedDots, dot.id],
                  }),
                }, dot.name))),
                h("div", { className: "dshdot-row" },
                  h("button", {
                    type: "button",
                    className: "dshdot-btn",
                    "data-on": String(connForm.inbound),
                    disabled: busy,
                    onClick: () => setConnForm({ ...connForm, inbound: !connForm.inbound }),
                  }, connForm.inbound ? "也接收消息 · 点击关闭" : "只发不收 · 点击改为接收"),
                  connForm.inbound
                    ? h("label", { className: "dshdot-numwrap" }, "收进",
                        h("select", {
                          className: "dshdot-select",
                          disabled: busy,
                          value: connForm.bindDotId,
                          onChange: (event) => setConnForm({ ...connForm, bindDotId: event.target.value }),
                        },
                          h("option", { value: "" }, "当前活跃的 bot"),
                          snapshot.dots.map((dot) => h("option", { key: dot.id, value: dot.id }, dot.name))))
                    : null),
                connForm.inbound
                  ? h("div", { className: "dshdot-note" },
                      "打开后，从这条连接进来的消息会直接写进那个 bot 的对话——跟你在网页上打字是同一份记录，"
                      + "所以两边看到的一模一样，不需要同步。"
                      + (connForm.kind === "telegram" ? " Telegram 用长轮询收取，不需要公网地址或 webhook。" : ""))
                  : null,
                h("div", { className: "dshdot-row" },
                  h("button", {
                    type: "button",
                    className: "dshdot-btn",
                    disabled: busy || connForm.name.trim().length === 0,
                    onClick: saveConnector,
                  }, connForm.id === undefined ? "保存连接" : "保存修改"),
                  h("button", {
                    type: "button",
                    className: "dshdot-btn",
                    onClick: () => setConnForm(null),
                  }, "取消")))),
        error === null ? null : h("div", { className: "dshdot-err", style: { margin: 0 } }, error),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "这段对话"),
          h("div", { className: "dshdot-row" },
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy || current.messages === 0,
              onClick: () => run({ action: "clear", id: current.id }),
            }, "清空记录"),
            h("button", {
              type: "button",
              className: "dshdot-btn",
              "data-danger": "true",
              disabled: busy || snapshot.dots.length <= 1,
              title: snapshot.dots.length <= 1 ? "至少要留一个 bot" : "删除这个 bot",
              onClick: () => run({ action: "delete", id: current.id }),
            }, "删除这个 bot")),
          snapshot.dots.length <= 1 ? h("div", { className: "dshdot-note" }, "至少要留一个 bot。") : null),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "共享记忆"),
          h("div", { className: "dshdot-note" },
            "记忆现在是硬盘上的 Markdown 文件，你可以直接打开、改、删。"
            + "根目录那几个文件每轮都读；子目录里只有文件名和描述进上下文，正文按需打开。"
            + "每一层目录要有自己的 `MEMORY.md` 才算记忆目录。"),
          h("div", { className: "dshdot-row" },
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy,
              onClick: () => call("/api/dot.manage", { action: "memoryOpen" })
                .then((value) => {
                  setMemoryDir(value.dir ?? "");
                  if (value.dir !== undefined) setError("记忆在 " + value.dir);
                })
                .catch(() => {}),
            }, "打开记忆文件夹"),
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy,
              title: "按文件里的内容重建可检索的索引——你手改过的会保留，删掉的会消失",
              onClick: () => call("/api/dot.manage", { action: "memoryImport" })
                .then((value) => {
                  if (value.error !== undefined) setError(value.error);
                  else setError("从 " + value.files + " 个文件重建了 " + value.entries + " 条索引");
                  return onChanged();
                })
                .catch(() => {}),
            }, "从文件重新导入"),
            h("span", { className: "dshdot-note" }, memoryDir)),
          memoryFiles.length === 0
            ? h("div", { className: "dshdot-note" }, "还没有记忆文件。上面点一次就会创建。")
            : h("ul", { className: "dshdot-list" }, memoryFiles.map((file) => h("li", {
                key: file.path,
                className: "dshdot-item",
              },
                h("span", { className: "dshdot-tag" }, file.tier === "root" ? "常驻" : file.tier),
                h("span", { style: { flex: 1, minWidth: 0, overflowWrap: "anywhere" } },
                  file.path + (file.description === "" ? "" : " — " + file.description)))))),
          snapshot.memory.length === 0
            ? h("div", { className: "dshdot-note" }, "还没有记录。")
            : h("ul", { className: "dshdot-list" }, snapshot.memory.map((entry) => h("li", { key: entry.id, className: "dshdot-item" },
                h("span", { className: "dshdot-tag" }, entry.kind === "decision" ? "决策" : entry.kind === "fact" ? "事实" : "笔记"),
                h("span", { style: { overflowWrap: "anywhere" } }, entry.text)))),
        h("div", { className: "dshdot-field" },
          h("span", { className: "dshdot-label" }, "任务队列"),
          h("div", { className: "dshdot-row" },
            h("input", {
              className: "dshdot-text",
              value: newTask,
              placeholder: "交办一件事，它会在后台做",
              onChange: (event) => setNewTask(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") addTask();
              },
            }),
            h("input", {
              className: "dshdot-text",
              style: { maxWidth: "150px" },
              value: newRepeat,
              placeholder: "重复 day 09:00",
              title: "留空只做一次。可以填 hour、day、week，后面跟一个时间点。",
              onChange: (event) => setNewRepeat(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") addTask();
              },
            }),
            h("button", {
              type: "button",
              className: "dshdot-btn",
              disabled: busy || newTask.trim().length === 0,
              onClick: addTask,
            }, "派给它")),
          h("div", { className: "dshdot-note" },
            "执行器：" + worker.state + (worker.reason === "" ? "" : "（" + worker.reason + "）")
            + " · 今日已跑 " + worker.runsToday + " 次"),
          tasks.length === 0
            ? h("div", { className: "dshdot-note" }, "队列是空的。")
            : taskGroups.map((group) => (group.items.length === 0
                ? null
                : h("div", { key: group.key, className: "dshdot-group" },
                    h("span", { className: "dshdot-grouptitle" }, group.title + " · " + group.items.length),
                    h("ul", { className: "dshdot-list" }, group.items.map((task) => h("li", {
                      key: task.id,
                      className: "dshdot-item",
                    },
                      h("span", { className: "dshdot-tag" }, taskStateLabel(task.state)),
                      // The button appears when there is something to approve:
                      // either the job is parked at a boundary, or a rule is
                      // holding it back. "Already approved" and "the user raised
                      // it" are not the same question, which is what made a
                      // stopped job show no button at all before.
                      task.state === "awaiting" || (task.approved !== true && task.source !== "user")
                        ? h("button", {
                            type: "button",
                            className: "dshdot-tool",
                            disabled: busy,
                            title: task.state === "awaiting"
                              ? "它停在这里等你，放行后继续做"
                              : "放行这条，让执行器做它",
                            onClick: () => run({ action: "approve", taskId: task.id }),
                          }, task.state === "awaiting" ? "批准并继续" : "批准")
                        : null,
                      h("div", { style: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 } },
                        h("span", { style: { overflowWrap: "anywhere" } },
                          task.title
                          + (task.note === "" ? "" : " — " + task.note)
                          + (task.priority === 3 ? "" : "（优先级 " + task.priority + "）")
                          + (task.repeat === "" ? "" : "（每次 " + task.repeat + "）")),
                        task.dueAt === "" ? null : h("span", { style: { color: "var(--dsw-alias-label-secondary)" } },
                          "下次 " + new Date(task.dueAt).toLocaleString()),
                        task.result === "" ? null : h("span", { style: { color: "var(--dsw-alias-label-secondary)", overflowWrap: "anywhere" } }, "→ " + task.result),
                        task.error === "" ? null : h("span", { style: { color: "var(--dsw-alias-state-error-primary)", overflowWrap: "anywhere" } }, "✗ " + task.error)))))))),
          h("div", { className: "dshdot-row" },
            h("button", { type: "button", className: "dshdot-btn", disabled: busy, onClick: poke },
              busy ? "在跑…" : "让它现在做一件"))),
        h("div", { className: "dshdot-note" },
          "常驻在 Host 进程 · 数据在 DSH_HOME/dot/dot.json · 心跳 " + ago(snapshot.heartbeatAt))));
    }

    function DotPage(props) {
      // Opened from an instance's own sidebar entry, this panel speaks for that
      // instance directly; opened from the `bot` entry it lands on home.
      const fixedId = props !== null && typeof props === "object" && typeof props.fixedId === "string" ? props.fixedId : undefined;
      const liveSnapshot = useLive();
      const [view, setView] = useState(fixedId === undefined ? "home" : "chat");
      const refresh = useCallback(() => refreshLive(), []);

      const snapshot = liveSnapshot;
      // Kinds ride along in the snapshot, so one added or removed anywhere shows
      // up on the next poll without a second request.
      const types = snapshot !== null && Array.isArray(snapshot.types) ? snapshot.types : [];
      const state = snapshot === null ? { kind: "loading" } : { kind: "ready", value: snapshot };
      const dots = snapshot === null ? [] : snapshot.dots;
      const current = snapshot === null
        ? null
        : fixedId === undefined
          ? (dots.find((dot) => dot.id === snapshot.activeDotId) ?? dots[0] ?? null)
          : (dots.find((dot) => dot.id === fixedId) ?? null);

      if (snapshot === null) {
        return h("div", { className: "dshdot" },
          h("style", null, CSS),
          h("div", { className: "dshdot-empty" }, state.kind === "error" ? "读不到 Host 端状态，插件可能已停用。" : "正在连接…"));
      }

      if (view === "settings") {
        return h(SettingsView, {
          snapshot,
          types,
          onClose: () => setView(current === null ? "home" : "chat"),
          onChanged: refresh,
        });
      }

      if (view === "chat" && current !== null) {
        return h(ChatView, {
          snapshot,
          current,
          types,
          state,
          onHome: () => setView("home"),
          onNew: () => setView("home"),
          onSettings: () => setView("settings"),
          refresh,
        });
      }

      return h(HomeView, {
        snapshot,
        types,
        state,
        onEnter: async (id) => {
          const result = await call("/api/dot.manage", { action: "select", id });
          if (result.error === undefined) await refresh();
          setView("chat");
        },
        // Row actions change the list in place; creating one steps into it.
        onChanged: refresh,
        onCreated: async () => {
          await refresh();
          setView("chat");
        },
        onSettings: () => setView("settings"),
      });
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("main", () => ctx.slots.register({
          name: "main",
          key: PANEL_ID,
        }, DotPage));

        // One poll feeds the page and every sidebar mark.
        const controller = new AbortController();
        const poll = async () => {
          try {
            const response = await fetch("/api/dot.state", {
              cache: "no-store",
              headers: { accept: "application/json" },
              signal: controller.signal,
            });
            if (!response.ok) return;
            publish(await response.json());
          } catch {
            /* keep the last good snapshot rather than blanking the panel */
          }
        };
        refreshLive = poll;
        ctx.effect(() => {
          poll();
          const handle = setInterval(poll, POLL_MS);
          return () => {
            clearInterval(handle);
            controller.abort();
          };
        });

        // Every instance gets its own sidebar entry and its own panel, keyed by
        // id, so `bot` reads as a list rather than a single door. The shell owns
        // the rows, so what can be re-registered is re-registered — and the row
        // order follows the Host's ordering, which is what makes pinning visible.
        ctx.slots.inject("sidebar.panellist", () => {
          const owned = [];
          const entries = new Set();
          let orderKey = "";

          const sync = () => {
            const snapshot = live.snapshot;
            if (snapshot === null || !Array.isArray(snapshot.dots)) return;
            const dots = snapshot.dots;
            const wanted = dots.map((dot) => dot.id).join(",");

            if (wanted !== orderKey) {
              for (const dispose of owned) dispose();
              owned.length = 0;
              entries.clear();
              orderKey = wanted;
            }

            dots.forEach((dot, index) => {
              if (entries.has(dot.id)) return;
              entries.add(dot.id);
              const disposers = [
                ctx.slots.register({
                  name: "sidebar.panellist",
                  id: PANEL_CHILD_PREFIX + dot.id,
                  order: 6 + index,
                  // Empty on purpose: the shell also draws this label in its own
                  // title span beside the glyph, and the glyph draws the entire
                  // row itself. Two names collide — the squeezed one ends up as a
                  // clipped half-character.
                  label: () => "",
                }, makeChildMark(dot.id)),
                ctx.slots.register({
                  name: "main",
                  key: PANEL_CHILD_PREFIX + dot.id,
                }, () => h(DotPage, { fixedId: dot.id })),
              ];
              owned.push(...disposers);
            });
          };

          live.listeners.add(sync);
          sync();
          return () => {
            live.listeners.delete(sync);
            for (const dispose of owned) dispose();
            owned.length = 0;
            entries.clear();
          };
        });

        ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
          name: "sidebar.panellist",
          id: PANEL_ID,
          order: 5,
          label: () => "bot",
        }, DotEntry));
      },
    };
  },
});
