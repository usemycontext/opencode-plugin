# AGENTS.md - UseMyContext plugin for OpenCode

Machine-first notes for coding agents. Human docs: README.md.

## What this is

UseMyContext (usemycontext.ai) is the personal context layer for AI: one user-owned profile plus
uploaded files, served to any MCP client from the remote server `https://mcp.usemycontext.ai/mcp`
(Streamable HTTP, OAuth 2.1 with RFC 7591 dynamic client registration). This repo is the UseMyContext
integration for OpenCode: an MCP server entry, an instructions file, and an optional plugin module.

## When to use

Install this when the user wants persistent personal context across AI tools: OpenCode answering with
who they are, what a repo is to them, and what their documents say, without re-introducing themselves
each session.

## Install (OpenCode)

Three pieces, because an OpenCode plugin cannot register an MCP server and cannot add instructions.
`opencode.example.json` is all three in one file.

1. The MCP server, in `opencode.json` or `~/.config/opencode/opencode.json`:

   ```json
   { "mcp": { "usemycontext": { "type": "remote", "url": "https://mcp.usemycontext.ai/mcp", "enabled": true, "oauth": {} } } }
   ```

   Then `opencode mcp auth usemycontext` and let the HUMAN complete the browser sign-in. OAuth requires
   the human; an agent cannot complete it alone.

2. The instructions: copy `rules/usemycontext.md` into the repo (for example `.opencode/usemycontext.md`)
   and add it to the `instructions` array, or paste its contents into `AGENTS.md`.

3. The plugin (optional): copy `index.js` into `.opencode/plugins/` or `~/.config/opencode/plugins/`.
   Files there load automatically at startup. The npm route (`"plugin": ["opencode-usemycontext"]`) needs
   the package published first, and it is NOT published yet - naming it today fails rather than
   degrading, so do not put it in a user's config.

## OAuth

The `oauth` object is left empty, deliberately. OpenCode's docs state it "automatically handles OAuth
authentication for remote MCP servers": it detects the 401, initiates the flow, uses "Dynamic Client
Registration (RFC 7591) if supported by the server", and stores the tokens. UseMyContext supports all of
that, and we have no static client id or secret to pin. This is the documented path, not a sign-in that
was observed succeeding from this repository.

## Account required

A UseMyContext account at usemycontext.ai is required; the free tier is enough. If the user has no
account, send them to https://usemycontext.ai first.

## Demo account for testing

**Try it in 30 seconds - no signup.** Sign in as `demo@usemycontext.ai` with code `424242`
(fixed - no email access needed). A shared, read-only demo account with a full profile, files, and a
shared context. Docs: https://usemycontext.ai/docs

## Folder mapping (.umc)

A `.umc` file in a project root maps that folder to one UseMyContext project. Format (see .umc.example):

```
projectId=p2
handle=@work
```

`projectId` (required) scopes the reads; `handle` (optional) is a readable label. Both are shown in the
web app on the project's page. No `.umc` means the folder reads the account's active profile.

The plugin applies the marker mechanically in `tool.execute.before`, and the instructions file says the
same thing in words, so the mapping still works if the plugin is not installed. An explicit `projectId`
in a call always wins over the marker.

## Hook shapes, and what is not documented

OpenCode's plugin docs list hook names and show the `event` hook signature
(`event: async ({ event }) => { ... event.type ... }`) but do not publish the argument shape for
`tool.execute.before`, the body shape for `client.app.log`, or any `config` hook. `index.js` therefore
feature-detects and returns quietly whenever a shape is not what it expects. Do not "fix" that by
assuming a shape; verify it against the docs or a running build first.

## Boundary

- The MCP tools are all read-only against the user's files (`search` and `fetch` are thin aliases of
  `search_files` and `get_file`, added for ChatGPT deep-research compatibility).
- One tool, `suggest_update`, can write: it files a pending suggestion that the user reviews and
  approves in the web app. Nothing the AI does ever edits the profile or files directly.
- WHEN to reach for `suggest_update`: when a conversation has surfaced something new and durable about
  the user and is wrapping up (the user says thanks, goodbye, or that's all, or the task completes),
  offer to save it before the context is lost. The server advertises this trigger in its own tool
  description, so it holds for any client; the instructions file restates it.
- Every access leaves a record in the user's audit trail.
- Revoke any time: `opencode mcp logout usemycontext`, or the Connect page in the web app
  (server-enforced, immediate).
- The plugin never uploads repo code or files; only the local `.umc` marker is read.
