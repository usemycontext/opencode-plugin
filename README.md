# UseMyContext for OpenCode

[MIT license](./LICENSE) | [usemycontext.ai](https://usemycontext.ai) | [Docs](https://usemycontext.ai/docs) | [`usemycontext` SDK on npm](https://www.npmjs.com/package/usemycontext)

UseMyContext is the personal context layer for AI. You keep one profile of who you are and what you are
working on, and any AI client reads it over MCP. This brings that into OpenCode: sign in once and
OpenCode answers with your context already in the room - who you are, what this project is to you, what
your documents say. And it does not wait to be asked: when a question touches you personally, OpenCode is
guided to check your profile and documents before saying it does not know about you, and when a
conversation wraps up having learned something durable about you, it is guided to offer to save that
before the context is lost.

## Install

OpenCode splits this across three pieces, because an OpenCode plugin cannot register an MCP server or add
standing instructions on its own. The first two go in your `opencode.json` (project-level) or
`~/.config/opencode/opencode.json` (global); [`opencode.example.json`](./opencode.example.json) is both
of them in one file, written for a PROJECT config (see step 2 for the one line a global config must
change). The third is a file you copy into place, with no config entry at all.

**1. The MCP server.** This is the part that actually connects you.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "usemycontext": {
      "type": "remote",
      "url": "https://mcp.usemycontext.ai/mcp",
      "enabled": true,
      "oauth": {}
    }
  }
}
```

Then run `opencode mcp auth usemycontext` and complete the browser sign-in, or just use a UseMyContext
tool and let OpenCode start the flow when the server answers 401.

**2. The instructions.** Copy [`rules/usemycontext.md`](./rules/usemycontext.md) into your repo (for
example to `.opencode/usemycontext.md`) and point the `instructions` array at it. In a **project**
`opencode.json`, a repo-relative path is right:

```json
{ "instructions": [".opencode/usemycontext.md"] }
```

In a **global** `~/.config/opencode/opencode.json`, use an ABSOLUTE path to your own copy instead:

```json
{ "instructions": ["/Users/you/.config/opencode/usemycontext.md"] }
```

A relative path in the global config resolves per repository, so every repo you clone that happens to
carry a file at `.opencode/usemycontext.md` would load ITS copy as your standing agent instructions. An
absolute path always loads the file you wrote.

If you would rather not add a file, paste its contents into your `AGENTS.md` instead. OpenCode reads
`AGENTS.md` from the project root, and `~/.config/opencode/AGENTS.md` globally.

**3. The plugin (optional).** It reads a folder's `.umc` marker and puts the mapped `projectId` on
UseMyContext tool calls for you. Copy [`index.js`](./index.js) into `.opencode/plugins/` (project) or
`~/.config/opencode/plugins/` (global). Files there load automatically at startup.

Once `opencode-usemycontext` is on npm you will be able to name it in the `plugin` array instead
(`{ "plugin": ["opencode-usemycontext"] }`). **It is not published yet**, and OpenCode resolves plugin
packages through Bun, so putting that name in your config today fails rather than degrading. Use the copy
route until this line says otherwise.

The plugin is a convenience either way. Step 2's instructions tell the model to pass `projectId` anyway,
so a folder mapping works without it.

You will need a UseMyContext account. The free tier is enough to try this. No account yet? Create a free
one at [usemycontext.ai](https://usemycontext.ai) first.

## Try it in 30 seconds

**No signup needed.** At the browser sign-in, use `demo@usemycontext.ai` with code `424242`
(fixed - no email access needed). A shared, read-only demo account with a full profile, files, and a
shared context. Then ask OpenCode "what do you know about me?". Docs:
[usemycontext.ai/docs](https://usemycontext.ai/docs)

## How sign-in works

UseMyContext does not hand out a static client id and secret. It runs an OAuth 2.1 authorization server
with **dynamic client registration** (RFC 7591): the client registers itself at first contact.

**How OpenCode handles it**
([MCP servers](https://opencode.ai/docs/mcp-servers/), [plugins](https://opencode.ai/docs/plugins/),
[rules](https://opencode.ai/docs/rules/)):

- A remote server is `{ "type": "remote", "url": "...", "enabled": true, "oauth": {} }`. Unlike
  Antigravity and the Gemini CLI, OpenCode's remote field really is `url`.
- The docs state: "OpenCode automatically handles OAuth authentication for remote MCP servers", and that
  when a server requires authentication OpenCode will "Detect the 401 response and initiate the OAuth
  flow", "Use Dynamic Client Registration (RFC 7591) if supported by the server", and "Store tokens
  securely for future requests". That is exactly our server's flow, so the `oauth` object is left empty:
  it opts in without pinning credentials we do not have.
- `opencode mcp auth <server-name>`, `opencode mcp list` and `opencode mcp logout <server-name>` manage
  that connection.
- Plugins are JS/TS modules in `.opencode/plugins/` (project) or `~/.config/opencode/plugins/` (global),
  or npm packages named in the `plugin` array.
- The `instructions` array accepts file paths or globs, and `AGENTS.md` is read from the project root.

**Why the plugin feature-detects.** OpenCode's plugin docs list the hook NAMES and show the `event`
hook's signature in a worked example, but do not publish the argument shape for `tool.execute.before` or
the body shape for `client.app.log`. The plugin therefore checks the shape it gets and returns quietly
when it is not what it expects, so the worst case is that the folder mapping is not applied
mechanically, never a session that breaks. There is no documented `config` hook, which is why the MCP
server and the instructions are wired in steps 1 and 2 rather than by the plugin.

## One folder, one context

A work repo reads your @work profile. A side project reads your @personal one. Same editor, different
context, chosen by the folder you are in.

To bind a folder to a project, drop a `.umc` file in the project root
([`.umc.example`](./.umc.example) is a ready-made template):

```
projectId=p2
handle=@work
```

A `projectId` may only be letters, digits, `_` and `-`, up to 32 characters, and a `handle` only `@`
followed by letters, digits and `-`, up to 40. Anything else and the whole marker is ignored, so a
repository you did not write cannot use one to talk to your assistant.

`projectId` is what scopes the reads. `handle` is an optional readable label. Find both in the web app on
the project's page. With no `.umc`, the folder reads your account's active profile.

An explicit `projectId` in a tool call always wins over the marker, so a deliberate cross-project read is
never silently rewritten. The UseMyContext server verifies the id belongs to you before scoping the read,
so the marker is a convenience, never a permission.

## What you get

The UseMyContext MCP server at `https://mcp.usemycontext.ai/mcp` (Streamable HTTP, OAuth 2.1), with the
tools `profile`, `list_profiles`, `info`, `account`, `list_files`, `search_files`, `get_file`, `search`,
`fetch` (thin aliases of `search_files`/`get_file` for ChatGPT deep-research compatibility), `ask_docs`,
`query_table`, `suggest_update`, `shared_context` - all read-only against your files. One tool,
`suggest_update`, can write: it files a pending suggestion that you review and approve in the web app.
Nothing the AI does ever edits your profile or your files directly, and every access leaves a record in
your audit trail. When a conversation is wrapping up having surfaced something new and durable about you,
OpenCode is guided to offer that save before the context is lost - so the loop closes at both ends: your
context is read at the start of a session, and what the session taught is offered back at the end.

## Disconnecting and revoking

- Run `opencode mcp logout usemycontext`, or remove the server from your `opencode.json`.
- Or revoke from the UseMyContext web app: the Connect page lists every AI connected right now, each with
  its own Disconnect button, plus a "Disconnect all".

Revoking is enforced on the server: the token dies immediately, everywhere. Nothing needs cleaning up
locally.

## What it can and cannot do

- Reads: your profile and the files you uploaded to UseMyContext, scoped to the connected or mapped
  project.
- Writes: nothing to your files. The one write tool, `suggest_update`, files a pending suggestion that
  you review and approve in the web app.
- Every access leaves a record in your audit trail.
- You can revoke access at any time, with `opencode mcp logout` or from the web app's Connect page.
- The plugin never uploads your repo code or files. The only local thing it reads is the `.umc` marker.
- It does not change your OpenCode setup, your model provider, your billing, or which model runs.

## Repo layout (for contributors)

```
.
|-- index.js                  # the plugin module (npm main, and the .opencode/plugins/ drop-in)
|-- package.json              # npm package metadata (opencode-usemycontext)
|-- opencode.example.json     # the opencode.json wiring (MCP server + instructions)
|-- rules/usemycontext.md     # the instructions file, referenced from `instructions`
`-- .umc.example              # example folder mapping
```

## Links

- Docs: [usemycontext.ai/docs](https://usemycontext.ai/docs)
- Web app: [usemycontext.ai](https://usemycontext.ai)
- MCP endpoint: `https://mcp.usemycontext.ai/mcp`
