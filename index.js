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
// and this plugin then does nothing at all. A marker whose values are not a
// plain project id and @handle is REFUSED WHOLE, and reads the same as no
// marker (see validatedMarker below).
//
// Honest note on hook signatures: OpenCode's plugin docs list the hook NAMES
// ("event", "tool.execute.before", "tool.execute.after") and show the `event`
// hook's signature in a worked example, but they do not publish the argument
// shape for "tool.execute.before". Everything below therefore feature-detects
// and returns quietly when the shape is not what it expects. A mapping that
// silently does not apply is recoverable (the instruction file still tells the
// model to pass projectId); a plugin that throws inside a tool call is not.

import { closeSync, constants as fsConstants, lstatSync, openSync, readSync } from "node:fs";
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

// ---------------------------------------------------------------------------
// THE SHARED .umc MARKER VALIDATOR
//
// This is the JS half of one rule with two spellings. The sh half is the
// `umc_marker_load` block, byte-identical, in all three shell plugin trees:
//   antigravity-plugin/usemycontext/scripts/umc-session.sh
//   claude-code-plugin/usemycontext/scripts/umc-session.sh
//   cursor-plugin/plugins/usemycontext/scripts/umc-session.sh
// The trees ship as separate public repositories and cannot import a shared
// file, so a shared regression suite pins the rules on BOTH sides, drives ONE
// corpus through both, and fails the moment either spelling drifts.
//
// Why it exists: a ".umc" marker is attacker-controlled the moment you clone
// somebody else's repository, and our own docs suggest committing one. Its
// values used to be stamped onto tool arguments and interpolated into the text
// the model reads with no validation at all.
//
// THE RULE, in the order it is applied. Both spellings do exactly this:
//   1. read at most 4096 bytes of a REGULAR, NON-SYMLINK file at <dir>/.umc
//   2. refuse the whole file if any of those bytes is NUL
//   3. drop a UTF-8 BOM, which is what a Windows editor writes ahead of the
//      first key
//   4. split on newlines; trim ASCII whitespace only; skip blank and "#" lines;
//      split each line on its FIRST "="; first occurrence of a key wins
//   5. projectId must match ^[A-Za-z0-9_-]{1,32}$
//      handle    must match ^@[A-Za-z0-9-]{1,40}$
//   6. on ANY miss refuse the WHOLE mapping
// Nothing is half-read, and no value is ever sanitised into something that
// still speaks.
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const HANDLE_RE = /^@[A-Za-z0-9-]{1,40}$/;

// 4KB is far more than a two-line key=value file needs, and it is the bound
// that turns a 944MB marker into a non-event. Before this bound a .umc FIFO
// and a .umc symlink to /dev/stdin each made the plugin factory never return,
// and a 944MB marker cost 1150MB RSS and a 1.5s synchronous event-loop block.
const MARKER_READ_BYTES = 4096;

// ASCII whitespace ONLY - exactly the set POSIX [[:space:]] matches in the C
// locale the sh twin pins. String.prototype.trim would ALSO strip NBSP and
// U+FEFF, which the sh twin does not, and the two spellings would then disagree
// on the same file depending on the host's locale.
const ASCII_SPACE = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;
const trimAscii = (s) => s.replace(ASCII_SPACE, "");

/**
 * Parse "<dir>/.umc" into { projectId, handle }, or return null - which is the
 * same thing as "this folder is not mapped".
 */
function validatedMarker(dir) {
  try {
    // A non-string dir made join() throw, uncaught, in the plugin factory.
    if (typeof dir !== "string" || dir === "") return null;
    const file = join(dir, ".umc");
    // lstat, never stat: a symlink is REFUSED, not followed, even one pointing
    // at a perfectly ordinary file. git stores such a symlink as mode 120000,
    // so it ships in a clone. isFile() also refuses a FIFO, a device, a socket
    // and a directory in one predicate.
    const st = lstatSync(file, { throwIfNoEntry: false });
    if (!st || !st.isFile()) return null;
    // O_NOFOLLOW closes the window between that lstat and this open, and
    // O_NONBLOCK means that if the file were swapped for a FIFO inside that
    // window the open returns instead of blocking forever. Neither flag is
    // defined on every platform, hence the 0 fallbacks.
    const fd = openSync(
      file,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0) | (fsConstants.O_NONBLOCK || 0),
    );
    let bytes;
    try {
      const buf = Buffer.alloc(MARKER_READ_BYTES);
      const read = readSync(fd, buf, 0, MARKER_READ_BYTES, 0);
      bytes = buf.subarray(0, read);
    } finally {
      closeSync(fd);
    }
    // Step 2. The sh twin cannot carry a NUL through a command substitution at
    // all and so refuses the file on the byte count; this refuses it on the
    // bytes, so both reach the same answer rather than one relying on the value
    // pattern to catch it.
    if (bytes.includes(0)) return null;
    let text = bytes.toString("utf8");
    // Step 3.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const values = Object.create(null);
    // Step 4. Split on newlines only; trimAscii removes the CR of a CRLF file,
    // which is exactly what the sh twin's trailing-[[:space:]] strip does.
    for (const line of text.split("\n")) {
      const trimmed = trimAscii(line);
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimAscii(trimmed.slice(0, eq));
      if (key !== "projectId" && key !== "handle") continue;
      if (values[key] === undefined) values[key] = trimAscii(trimmed.slice(eq + 1));
    }
    const projectId = values.projectId || "";
    const handle = values.handle || "";
    if (!projectId && !handle) return null;
    // Steps 5 and 6. Refuse the WHOLE mapping on any miss: a marker carrying
    // one good value and one hostile one is a hostile marker.
    if (projectId && !PROJECT_ID_RE.test(projectId)) return null;
    if (handle && !HANDLE_RE.test(handle)) return null;
    return { projectId, handle };
  } catch {
    return null;
  }
}

/**
 * The first candidate directory that actually carries a valid marker wins.
 * process.cwd() is deliberately NOT a candidate: with a global install it let a
 * project with no marker of its own silently inherit the .umc from wherever
 * OpenCode happened to be launched. The regression suite pins that by
 * BEHAVIOUR - it launches this module in a child process whose working
 * directory carries a marker and asserts nothing is stamped - rather than by
 * grepping for the name, so this comment is free to say what it means.
 */
function findMapping(candidates) {
  for (const dir of candidates) {
    const mapping = validatedMarker(dir);
    if (mapping) return { ...mapping, dir };
  }
  return null;
}

// The MCP server name our config files register (opencode.example.json). Both
// halves of a namespaced tool name have to match EXACTLY: the server name here
// and one entry of PROJECT_SCOPED_TOOLS. OpenCode does not document the
// separator it uses, so every plausible one is tried - but a substring or
// suffix rule is what let `evil-usemycontext-mirror_search` and
// `github_usemycontext_search` collect the victim's real projectId, and it
// would also have silently caught a FUTURE genuine tool we never reviewed.
const SERVER_NAME = "usemycontext";
const NAMESPACE_SEPARATORS = ["_", "-", ".", ":", "/"];

/** True only for a UseMyContext tool of ours that takes a projectId. */
function isUseMyContextTool(name) {
  if (typeof name !== "string") return false;
  const lower = name.toLowerCase();
  for (const separator of NAMESPACE_SEPARATORS) {
    const prefix = SERVER_NAME + separator;
    if (!lower.startsWith(prefix)) continue;
    if (PROJECT_SCOPED_TOOLS.includes(lower.slice(prefix.length))) return true;
  }
  return false;
}

function describe(mapping) {
  if (!mapping) return "";
  if (mapping.handle && mapping.projectId) return `${mapping.handle} (${mapping.projectId})`;
  return mapping.handle || mapping.projectId;
}

export const UseMyContextPlugin = async ({ client, directory, worktree }) => {
  let mapping = null;
  try {
    mapping = findMapping([directory, worktree]);
  } catch {
    // The factory must return. An unreadable marker is "not mapped", never a
    // failed plugin load.
    mapping = null;
  }

  return {
    // Documented signature: event: async ({ event }) => { ... event.type ... }
    // One line in the OpenCode log so the user can confirm the marker was seen.
    // client.app.log is documented only as "log with levels debug, info, warn,
    // error", so the call is wrapped: a logging convenience must never break a
    // session. The interpolated values passed the validator above, so this line
    // cannot carry ANSI escapes or forge a second log record.
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
      try {
        if (!mapping || !mapping.projectId) return;
        if (!input || !isUseMyContextTool(input.tool)) return;
        const args = output && output.args;
        if (!args || typeof args !== "object") return;
        if (args.projectId === undefined || args.projectId === null || args.projectId === "") {
          args.projectId = mapping.projectId;
        }
      } catch {
        // A frozen or sealed args object throws on assignment. The mapping not
        // being applied is recoverable; throwing inside a tool call is not, and
        // this file's whole contract is that it never does.
      }
    },
  };
};
