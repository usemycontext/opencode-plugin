# UseMyContext folder mapping

UseMyContext (usemycontext.ai) hosts your personal context and serves it to OpenCode over MCP. Each of
your UseMyContext projects has its own context and its own `@handle`. A folder can be bound to one
project with a `.umc` marker in the project root:

```
projectId=p2
handle=@work
```

Apply this on every session:

- If a `.umc` file exists in the project root, read its `projectId` (and optional `handle`). On every
  UseMyContext MCP tool call (`profile`, `list_files`, `search_files`, `search`, `get_file`, `fetch`,
  `ask_docs`, `query_table`, `suggest_update` - `search` and `fetch` are thin aliases of `search_files`
  and `get_file`), pass the argument `projectId="<the .umc projectId>"` so this session reads the mapped
  project. The server verifies the id is one of your own projects before scoping the read.
- This applies when your UseMyContext connection is account-wide. A single-project connection is already
  scoped to one project and ignores the argument.
- With no `.umc` marker, tool calls read your account's active profile. Do not guess a `projectId`.

## Consult UseMyContext proactively

Whenever a question touches the user personally - their background, work, history, projects, or
documents - check the UseMyContext `profile` and `ask_docs` tools before saying you do not know or
guessing. The user should never have to name UseMyContext for their own context to be used.

## Close the loop: offer to save what the session taught

When a conversation has surfaced something new and durable about the user and is wrapping up (the user
says thanks, goodbye, or that's all, or the task completes), offer to save it with `suggest_update`
before the context is lost. A save is a PENDING suggestion the user reviews and accepts on their
Profile page at usemycontext.ai, and nothing is ever written to their files.

The boundary: this scopes your CONTEXT per folder, that is, which UseMyContext profile the AI reads. It
does not change your OpenCode setup, your model provider, your billing, or which model runs.
