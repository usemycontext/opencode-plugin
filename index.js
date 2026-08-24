// UseMyContext plugin for OpenCode.
//
// What OpenCode documents, and what this plugin therefore does:
//
//   - A plugin is a JS/TS module exporting an async function that receives
//     { project, client, $, directory, worktree } and returns an object of
//     hooks. That is the shape below.
//   - A plugin CANNOT register an MCP server. There is no documented config
//     hook, so the UseMyContext server is added by the user to opencode.json
//     (see opencode.example.json). OpenCode itself handles the OAuth: it
//     detects the 401, discovers the endpoints, and performs RFC 7591 dynamic
//     client registration.
//   - A plugin CANNOT add standing instructions either. Those come from
//     AGENTS.md or the `instructions` array in opencode.json, which is why this
//     package ships rules/usemycontext.md for the user to reference there.
//
// So the one job left for the plugin is the per-folder mapping: read the ".umc"
// marker and put its projectId on every UseMyContext tool call, so the session
// reads the mapped project instead of the account's active one. The instruction
// file says the same thing in words; this does it mechanically, and the two
// agree.
//
// The ".umc" marker is a tiny key=value file, for example:
//   projectId=p2
//   handle=@work
//
// No marker means this folder uses the account's active UseMyContext profile,
// and this plugin then does nothing at all.
//
// Honest note on hook signatures: OpenCode's plugin docs list the hook NAMES
// ("event", "tool.execute.before", "tool.execute.after") and show the `event`
// hook's signature in a worked example, but they do not publish the argument
// shape for "tool.execute.before". Everything below therefore feature-detects
// and returns quietly when the shape is not what it expects. A mapping that
// silently does not apply is recoverable (the instruction file still tells the
// model to pass projectId); a plugin that throws inside a tool call is not.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The UseMyContext tools that take a projectId. The metadata-only tools
// (list_profiles, info, account) and shared_context are deliberately absent:
// they are not project-scoped, and passing an unexpected argument to them is
// not an improvement.
const PROJECT_SCOPED_TOOLS = [
  "profile",
  "list_files",
  "search_files",
  "search",
  "get_file",
  "fetch",
  "ask_docs",
  "query_table",
  "suggest_update",
];

/**
 * Parse a ".umc" marker into { projectId, handle }. Blank lines and lines
 * starting with "#" are comments. Returns null when the file is absent or
 * carries neither key, which is the same thing as "this folder is not mapped".
 */
function readMarker(dir) {
  if (!dir) return null;
  const file = join(dir, ".umc");
  if (!existsSync(file)) return null;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  const projectId = values.projectId || "";
  const handle = values.handle || "";
  if (!projectId && !handle) return null;
  return { projectId, handle };
}

/** The first candidate directory that actually carries a marker wins. */
function findMapping(candidates) {
  for (const dir of candidates) {
    const mapping = readMarker(dir);
    if (mapping) return { ...mapping, dir };
  }
  return null;
}

/**
 * True only for a UseMyContext tool that takes a projectId. OpenCode namespaces
 * MCP tools by the server name from opencode.json, and the exact separator is
 * not documented, so this matches on the server name being present AND the name
 * ending in one of the project-scoped tools. Requiring the server name is the
 * guard that matters: this must never put a projectId on somebody else's tool.
 */
function isUseMyContextTool(name) {
  if (typeof name !== "string") return false;
  const lower = name.toLowerCase();
  if (!lower.includes("usemycontext")) return false;
  return PROJECT_SCOPED_TOOLS.some((tool) => lower.endsWith(tool));
}

function describe(mapping) {
  if (!mapping) return "";
  if (mapping.handle && mapping.projectId) return `${mapping.handle} (${mapping.projectId})`;
  return mapping.handle || mapping.projectId;
}

export const UseMyContextPlugin = async ({ client, directory, worktree }) => {
  const mapping = findMapping([directory, worktree, process.cwd()]);

  return {
    // Documented signature: event: async ({ event }) => { ... event.type ... }
    // One line in the OpenCode log so the user can confirm the marker was seen.
    // client.app.log is documented only as "log with levels debug, info, warn,
    // error", so the call is wrapped: a logging convenience must never break a
    // session.
    event: async ({ event }) => {
      if (!mapping) return;
      if (!event || event.type !== "session.created") return;
      try {
        await client.app.log({
          body: {
            service: "usemycontext",
            level: "info",
            message: `UseMyContext: this folder is mapped to your "${describe(mapping)}" context.`,
          },
        });
      } catch {
        // Nothing to do. The mapping still applies below.
      }
    },

    // Put the mapped projectId on UseMyContext tool calls that did not already
    // carry one. An explicit projectId in the call always wins, so a deliberate
    // cross-project read is never silently rewritten. The UseMyContext server
    // verifies the id belongs to the caller before scoping the read, so this is
    // a convenience, not a permission.
    "tool.execute.before": async (input, output) => {
      if (!mapping || !mapping.projectId) return;
      if (!input || !isUseMyContextTool(input.tool)) return;
      const args = output && output.args;
      if (!args || typeof args !== "object") return;
      if (args.projectId === undefined || args.projectId === null || args.projectId === "") {
        args.projectId = mapping.projectId;
      }
    },
  };
};
