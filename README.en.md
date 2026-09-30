<p align="center">
  <img src="https://img.shields.io/github/stars/wqty123/dsh-dot?style=flat&amp;label=%E2%98%85&amp;color=08C" alt="GitHub stars">
  <img src="https://img.shields.io/badge/license-MIT-2EA44F?style=flat" alt="MIT License">
  <img src="https://img.shields.io/badge/DSH-Plugin-47848F?style=flat" alt="DeepSeek Harness plugin">
  <img src="https://img.shields.io/badge/Platform-Windows-4493F8?style=flat-square" alt="Platform: Windows (verified)">
</p>

<p align="center"><sub><a href="README.md">中文</a> · English</sub></p>

<h3 align="center">A <b>resident agent entity</b> for the DeepSeek Harness ecosystem</h3>

<h4 align="center">A bot that belongs to no session: its own instances, memory you can open and edit, a task queue, and an executor that stops at the boundary and waits for you.</h4>

## Documentation

| Goal | Entry |
| --- | --- |
| Why this exists, and how it differs from "a session" | [Why a resident entity](docs/why-dot.md) |
| Install, configure, day-to-day use | [User guide](docs/user-guide.md) |
| All 7 tools: parameters, output, boundaries | [Tool reference](docs/tool-reference.md) |
| How store / executor / memory tiers / approval gate fit together | [Architecture](docs/architecture.md) |
| Against the 2026 assistant survey: what is built, what is not | [Feature matrix](docs/feature-matrix.md) |
| All docs and how they divide the work | [Docs index](docs/README.md) |

## What it is

`dsh-dot` gives [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) a kind of agent that **belongs to no session**:

- **It outlives the conversation.** Close the session, compact the context, restart the machine — it is still there. Instances, memory, and the task queue live in `$DSH_HOME/dot/`, and every session reads and writes the same entity;
- **Memory is a file you can open.** Not an invisible vector store, but a tree of `.md` files under `$DSH_HOME/dot/memory/`. Change one line and every later conversation follows it. Root files stay in context; subdirectories contribute only a name and one line of description;
- **It moves things forward on its own.** A task queue plus an optional executor. Free time is **off by default**, and even when on it only acts when a **checkable condition** holds — its own queued work, an unanswered inbound message, a due reminder;
- **It stops at the boundary.** Reaching outside the workspace parks the job in `awaiting` and **shows you the tool name and the full arguments**. You approve **one concrete action**, not a category.

In one line: **install it and you get an entity that says "I remember that" — and can actually go do it.**

## Quick start

The plugin installs into the profile you intend to use.

```sh
# From a source checkout (one plugin, one repository)
dsh plugin --profile web add <path to this repo>

# Or from npm, once published
dsh plugin --profile web add dsh-dot
```

Then: a `bot` entry appears in the left sidebar. Open it and create an instance by type (companion / assistant / researcher / scribe are built in, and you can add your own), or step into one that already exists. The gear in the corner opens settings — memory, tasks, limits, connections, MCP servers, avatar, types.

The agent then has 7 `dot_*` tools:

| Goal | Tool | Notes |
| --- | --- | --- |
| See what state it is in | `dot_status` | Instances, heartbeat, queue, the model in effect and where that choice came from |
| Have it remember something | `dot_remember` | Writes into its own memory files, with an origin label |
| Ask what it remembers | `dot_recall` | Word search; Chinese is split into bigrams |
| Have it go do something | `dot_task` | Queue it, schedule it, repeat it, continue or start fresh |
| Have it say something outward | `dot_connector` | Through a user-configured connection (Telegram / HTTP) |
| Use a credential once | `dot_secret` | The value never enters context; it goes straight to a virtual desktop |
| Remind it of a moment | `dot_agenda` | Fires through a connector when due |

Full list: [tool reference](#tool-reference).

## Main features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Memory is files, not a vector store</h3>
      <p>Memory lives as a tree of <code>.md</code> files under <code>$DSH_HOME/dot/memory/</code> — visible, editable, and re-importable from disk in the settings page. <b>Root files (<code>MEMORY.md</code> / <code>SOUL.md</code> / <code>USER.md</code> / <code>MEMORY-CORE.md</code>) stay in context</b>; subdirectories contribute only a name and one line of description. The layering <i>is</i> the policy: moving a file between tiers is a file operation.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Every entry carries its origin</h3>
      <p>Entries record whether they came from <code>user</code> (they said it outright), <code>agent</code> (its own conclusion), or <code>tool</code> (read out of a file or a page). <b>A claim that keeps its label is useful; the same claim wearing a fact's clothes is a hazard.</b> Old data is read as <code>agent</code> — the more cautious reading.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Two gates for sensitive information</h3>
      <p><b>Hard gate</b>: identity numbers, social security numbers, bank cards, passwords and keys, session tokens — <b>refused at every setting</b>, and it tells you the way around (use <code>dot_secret</code> rather than writing it down). <b>Soft gate</b>: health, finances, legal matters, family matters — excluded by default, one setting to allow, and anything kept <b>carries the label forever after</b>.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Memory has an age</h3>
      <p>Every entry can say how many days old it is. Past the threshold (90 by default) it is marked stale and labelled in the prompt. <b>When the age cannot be computed it is <code>-1</code>, not a guess</b> — unknown does not take part in a comparison, and that is deliberate.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Approval is a first-class state</h3>
      <p>Reaching outside the workspace parks the job in <code>awaiting</code> — <b>a legitimate intermediate state, not an error branch</b>. It stops with the <b>tool name and the full arguments</b>, so you approve a concrete action rather than "it wants to do something". <b>Approving keeps it from stopping again</b>: that was "yes, this time", not "you asked once".</p>
    </td>
    <td width="50%" valign="top">
      <h3>One-step waiver, always expiring</h3>
      <p>Being asked the same thing repeatedly dulls a person, so a pass can be granted. <b>A waiver matches the exact tool name only, and always carries an expiry</b> — there is no "allow forever", because nobody can sign for their future self. Editing a job's title or note revokes approval: you approved the job you read at that moment.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Free time is reason-driven</h3>
      <p><b>Off by default.</b> When on, idleness is only a <b>precondition</b>, never the reason itself. A checkable condition has to hold: its own queued work (the default), an unanswered inbound message, a due reminder, a file changed since it last looked. When nothing holds it says so plainly instead of quietly filling the time with activity.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Its own permission, three levels</h3>
      <p><code>read-only</code> / <code>full</code> / <code>chat</code>, per instance. <b>Free time defaults to read-only</b> — acting on its own does not come with the ability to write unless you give it. The tool set follows the permission: a read-only instance never even sees the writing half.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>MCP as a client, not hard-coded integrations</h3>
      <p>The plugin <b>ships no MCP server, no address, no credential</b> — it ships a client and an input box. Give it a streamable HTTP address and that server's tools appear in the ones it can call. Names follow the ecosystem's <code>mcp__server__tool</code> convention, so <b>a name copied from any other client works unchanged</b>. The test is a button, and its result stays on the status light.</p>
    </td>
    <td width="50%" valign="top">
      <h3>A status light that does not lie</h3>
      <p>Next to each service: <b>green</b> only after a test that actually passed, <b>red</b> only after one that actually failed, <b>grey</b> before either. <b>"Nobody looked" and "it is fine" are not the same claim</b>, so the light does not merge them. Green keeps both timestamps underneath — "it worked at 14:02 and stopped at 14:31" is a different situation from "it never worked".</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Two ways to repeat work</h3>
      <p>A recurring job can <b>continue in its own context</b> (carrying its last conclusion in — what a routine wants) or <b>start a fresh one</b> (from zero — what an audit wants). The reason: <b>read your own previous conclusion first and a check quietly becomes a rubber stamp.</b></p>
    </td>
    <td width="50%" valign="top">
      <h3>More than one way in</h3>
      <p>Inbound connections bring outside messages in: Telegram long polling, or a token-guarded HTTP endpoint. External messages are <b>labelled with their origin and bounded in length</b> (4000 characters by default, adjustable), because <b>who said it and how long they went on are both part of judging it</b>.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Every limit belongs to the user</h3>
      <p><b>No quota is hard-coded.</b> How many messages are replayed, how many memory rows are searchable, how long one job may run, how much per day, how long an inbound message may be, concurrency and poll cadence — all in the settings page, defaults listed in one place. <code>0</code> means unlimited throughout.</p>
    </td>
    <td width="50%" valign="top">
      <h3>Your own avatar and your own types</h3>
      <p>Four types are built in (companion / assistant / researcher / scribe) and <b>their names, blurbs and personas are all editable — and you can add your own</b>. The avatar accepts an uploaded image (PNG / JPEG / WebP / GIF up to 4 MB), validated by content type rather than by file name.</p>
    </td>
  </tr>
</table>

## Why this one

- **It is not a longer session.** The usual move is to make the context bigger; this moves the state outside it. A session is temporary, an entity is persistent — confusing the two gets you the drawbacks of both.
- **Governable beats clever.** Memory is files, origin is a label, limits are settings, approval is a state. Each one gives "why is it like this" an answer you can look up instead of a conclusion you have to trust.
- **The dangerous parts are made visible.** Every screen shows what it is asking for, when it last worked, and who said this. **The dangerous failure is not doing the wrong thing — it is doing the wrong thing quietly.**

## Tool reference

| Tool | Purpose | Reaches out |
| --- | --- | --- |
| `dot_status` | Instance list, heartbeat, queue, the model in effect and where it came from | – |
| `dot_remember` | Record a durable entry (`text`, optional `kind` / `source`) | – |
| `dot_recall` | Search memory by word (Chinese split into bigrams; filterable by kind) | – |
| `dot_task` | Queue: add / schedule / repeat / continue-or-fresh / cancel | – |
| `dot_connector` | Have the instance speak outward through a user connection | ✅ |
| `dot_secret` | Deliver a credential into a virtual desktop (value never enters context) | ✅ |
| `dot_agenda` | Note what should happen at a moment; fires through a connector | ✅ |

> "Reaches out" means data leaves the machine — the other four only read and write `$DSH_HOME/dot/`.

### Where a memory lands

`dot_remember` routes by kind: `focus` to `USER.md` (what the user cares about), `decision` and `fact` to `MEMORY-CORE.md`, everything else to `notes/YYYY-MM.md`. **That is policy, not implementation detail**: the files that stay in context hold only what can change behaviour.

### How it reads its own memory

Root files enter the system prompt in full; every file in a subdirectory contributes only the `name` and `description` of its frontmatter. So **a good description on a note is worth more than a long body** — it decides whether the note is ever thought of.

## Configuration

The plugin mounts through `cordis.patch.yml` as **a single row** (registered under the bare package name). Almost everything a user changes lives in the settings page rather than in that file:

| Location | Contents |
| --- | --- |
| `$DSH_HOME/dot/dot.json` | Instances, types, memory index, tasks, connections, MCP servers, limits, rules |
| `$DSH_HOME/dot/memory/` | The memory itself (a tree of `.md` files, editable directly) |
| `$DSH_HOME/dot/avatars/` | Uploaded avatar images |

Settings sections: instances and types · memory · tasks and queue · free time · limits · rules · connections · MCP servers · avatar · agenda.

**Limits** (all defaulted, all editable, `0` means unlimited throughout):

| Setting | Default | Meaning |
| --- | --- | --- |
| Job time limit | 30 min | How long one background job may run |
| Daily total | unlimited | Background minutes per day |
| Tool rounds per job | 8 | How many tool calls one job may make |
| Queue entries | 300 | Rows kept; oldest fall off |
| Messages replayed | 12 | Transcript messages in the system prompt |
| Panel window | 60 | Messages the panel loads at once |
| Searchable memory rows | 200 | Index bound; **the files themselves are never trimmed** |
| Inbound length | 4000 chars | Truncated and labelled beyond |
| Stale threshold | 90 days | Past this, marked stale |
| Sensitive mode | exclude | `exclude` / `keep` (the hard gate is unaffected) |

**Only two settings have bounds** — free-time concurrency and poll cadence — because they are mechanism parameters rather than quotas.

## How it works

```
Session side (model)   Host side (plugin)                  Disk
  dot_* tools  ──→  handlers registered on ctx.tools  ──→  $DSH_HOME/dot/dot.json
                        │                                     └─ memory/*.md
                        ├─→ executor (optional, off)           └─ avatars/
                        │     └─ queue → one model session → tool calls
                        ├─→ approval gate (workspace verdict)
                        └─→ inbound connections (Telegram poll / HTTP endpoint)

Web side (browser)     The same HTTP routes
  sidebar entry  ──→  /api/dot.state (read-only poll, 3s)
  bot page       ──→  /api/dot.manage (writes)
  settings page  ──→  the same routes
```

- **Both halves ship together**: `impl.js` is the host (store, executor, tools, routes), `client.js` is the web half (sidebar, page, settings). The client half registers through `window.__ModuleLoader__.load()` and imports no `@deepseek-ai/dsh-client-*` package;
- **One poll feeds every surface**: every sidebar entry and the page subscribe to the same `/api/dot.state`, so they cannot contradict each other;
- **The workspace boundary is decidable**: `workspaceVerdict(toolName, args, workspace)` is a pure function returning `inside` / `guarded` / `refused` / `unchecked`. **`unchecked` is the important one** — "we checked and it was fine" and "there was nothing here to check" have to stay distinguishable in the code, or the former will impersonate the latter.

## Requirements

- DeepSeek Harness (dsh) with a `web` profile installed
- Node.js ≥ 22.19
- A working model (the plugin follows DSH's default model; nothing separate to configure)

### Verified versions

| Component | Version |
| --- | --- |
| DeepSeek Harness (dsh) | `0.2.0-rc.2` (peer range `>=0.2.0-rc.1 <0.3.0`) |
| Node.js | `22.20.0` |
| Operating system | Windows (10.0.26200) |
| dsh-dot | `1.0.0` |

> **Verified on Windows only** (macOS / Linux untested, not claimed). The host half has no platform-specific branches, but untested is untested.

## Known limitations

- **No remote execution.** The executor runs inside the host process; the machine goes down, it stops. That is structural for a local plugin, not a to-do — "keeps running while the machine sleeps" needs a cloud, and this version does not have one.
- **No vector retrieval.** Memory enters context by file tier; there is no automatic switch to search past a threshold. At the current scale, adding retrieval would only add a less explainable layer — the cost is a size ceiling.
- **No browser integration.** The browser plugin that ships with DSH is session-scoped, not part of this resident entity.
- **No voice, no cross-device.** Single machine.
- **No dedicated email entry point.** Telegram and HTTP inbound exist; "forward an email to dispatch work" does not.
- **The sensitive-memory prompt is only half done.** Sensitive entries are **refused** rather than **asked about**; "no retroactivity" holds in the implementation (changing the setting never alters existing entries) but the UI does not say so.
- **MCP is client-only and minimal**: `initialize` / `tools/list` / `tools/call`. No `resources`, no `prompts`, no subscriptions, no OAuth flow (put a token in the request-header field). Long-running work does not use the official `tasks` extension.
- **Streamable HTTP only** for MCP transport; a stdio server needs a wrapper.
- **Inbound defence is bounding and labelling, not content filtering.** The public record is unkind to detection-based defences (most were bypassed >90% under adaptive attack). So this picks the two that keep working: **bound the size, label the source**.
- **Waivers match the exact tool name.** Changing one argument misses. That is the conservative side; the cost is being asked again for the same kind of operation with different arguments.
- **`dot_secret` needs the virtual-desktop plugin** (`dsh-vdesktop`). Without it the tool says so plainly rather than failing silently.

## Development

Plain JavaScript, no build step — `impl.js` / `client.js` / `entry.js` are what runs.

```sh
# Offline verification suite (does not need dsh running)
node tests/verify-dot-plugin.mjs

# Client wiring — run after touching the UI
node scripts/check-client-wiring.mjs

# Audit against the research report
node scripts/audit-against-research.mjs
```

Code layout:

| File | Responsibility |
| --- | --- |
| `entry.js` | Thin shell. `stat()`s the implementation and stamps its mtime into the import URL, so editing `impl.js` does not need a host restart. **Its exported `inject` is the one the host reads** (see below) |
| `impl.js` | All host logic: store, memory file layer, workspace verdict, executor, approval, connections, MCP client, routes, the 7 tools |
| `client.js` | All web: sidebar entry, bot page, settings page. Carries its own styles and depends on no client package's internal class names |
| `scripts/` | Two checks, a runnable MCP demo server, desktop probes |
| `tests/` | End-to-end verification (HTTP routes + store semantics + tool behaviour) |

> **A trap worth repeating**: Cordis reads the `inject` exported by the **entry module**, not the one in the implementation file. When they disagree the plugin starts without a service it needs and fails on first use with `cannot get property ... without inject`. The two must match word for word, and the verification suite asserts it.

## Changelog

See [CHANGELOG.md](CHANGELOG.md). This plugin has no versioned release yet; that file records development rounds.

## Credits

Thanks to the [DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness) and the DeepSeek AI team: this plugin's plugin system, tool runtime, and model interface are all built on that project.

Thanks also to [Cordis](https://github.com/cordiverse/cordis) for the plugin foundation.

The **research behind this plugin** drew on public documentation from the 2026 generation of personal assistants and agents; the item-by-item comparison is in the [feature matrix](docs/feature-matrix.md).

## License

[MIT License](LICENSE).

> A community plugin for DeepSeek Harness, not an official DeepSeek product.
