# Plugin Development Mode

OpenMovie's first Plugin API is an explicit local development mode for text Provider processes. It
is disabled unless `OPENMOVIE_PLUGIN_DEV_MANIFESTS` names one or more manifests. Multiple paths use
the operating-system path delimiter (`:` on macOS, `;` on Windows).

macOS:

```bash
OPENMOVIE_PLUGIN_DEV_MANIFESTS="$PWD/examples/plugins/text-echo/openmovie.plugin.json" pnpm dev
```

Windows PowerShell:

```powershell
$env:OPENMOVIE_PLUGIN_DEV_MANIFESTS="$PWD\examples\plugins\text-echo\openmovie.plugin.json"
pnpm dev
```

The example then appears as `plugin.text_echo` in the Planning model selector.

## Manifest v1

The checked-in `@openmovie/plugin-sdk` validates:

- `schemaVersion: 1` and `apiVersion: "0.1.0"`;
- an ID beginning with `plugin.`;
- a Node entry file inside the manifest directory;
- declared capabilities (currently only `text.generate`);
- a bounded 1–300 second request timeout.

OpenMovie starts a fresh Node subprocess for each request, sends one JSON-RPC line on stdin, accepts
one bounded response on stdout, captures only bounded diagnostics, and terminates the process after
completion, timeout or cancellation. The child receives a minimal environment and no Provider API
keys, project path, Electron API, Secret Store handle, or inherited application environment.

## Request and response

Request:

```json
{
  "jsonrpc": "2.0",
  "id": "...",
  "method": "provider.generate_text",
  "params": { "model": "...", "messages": [] }
}
```

Successful response:

```json
{
  "jsonrpc": "2.0",
  "id": "...",
  "result": { "text": "...", "model": "...", "finishReason": "stop" }
}
```

This process boundary is not an operating-system security sandbox. Development Plugins are arbitrary
local code with the user's OS permissions and must only be enabled from trusted source trees. The
API deliberately excludes Plugin-supplied project writes: output still passes through OpenMovie's
structured plan validation, Proposal review, optimistic Revision base and user accept/reject gate.
