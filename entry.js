/**
 * Dot plugin entry point.
 *
 * This file is deliberately a thin, stable shell, and it should stay that way.
 * Cordis caches the entry module for the lifetime of the Host process and Node
 * caches every file URL it has already imported, so an edited entry file would
 * never take effect without restarting the Harness. Importing the
 * implementation through a URL stamped with the file's modification time gives
 * every activation the current source: an unchanged file reuses the cached
 * module, an edited one loads fresh. Change `impl.js`, then disable and enable
 * the bundle to pick the change up.
 *
 * @module @local/dsh-dot
 */

import { stat } from "node:fs/promises";

export const name = "dot";
/**
 * Declared here rather than in `impl.js` because Cordis reads the *entry*
 * module's exports: an `inject` living in the implementation would never be
 * consulted, and the services it names would simply never be resolved. That was
 * a real defect — `llm` and `agentDefaultModel` were missing from this list
 * while the implementation used both, so `ctx.llm.stream` could throw for want
 * of a service nobody had waited for.
 *
 * Keep this in step with the implementation's own `inject` export.
 */
export const inject = ["tools", "connection", "llm", "agentDefaultModel"];

const IMPLEMENTATION = new URL("./impl.js", import.meta.url);

/**
 * Load the current implementation and activate it.
 * @param ctx - Context carrying the tool registry and the client fetch fence.
 * @param config - The loader row's config, passed through unchanged.
 */
export async function apply(ctx, config) {
  const { mtimeMs } = await stat(IMPLEMENTATION);
  const url = new URL(IMPLEMENTATION);
  url.searchParams.set("v", String(Math.round(mtimeMs)));
  const implementation = await import(url.href);
  return implementation.apply(ctx, config);
}
