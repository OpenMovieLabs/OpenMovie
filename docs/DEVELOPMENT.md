# Development Guide

## Prerequisites

- Node version from `.node-version` (22.x);
- pnpm version pinned by `packageManager` (11.23.0);
- macOS or Windows for Desktop packaging;
- FFmpeg/FFprobe on `PATH` for media development, or explicit `OPENMOVIE_FFMPEG_PATH` and
  `OPENMOVIE_FFPROBE_PATH` overrides.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm smoke:desktop
pnpm perf:baseline -- --enforce
pnpm dev
```

Default tests are offline and use deterministic fixtures. Never put real paid-provider calls,
credentials or private media in the default suite.

## Workspace map

| Path                        | Responsibility                                     |
| --------------------------- | -------------------------------------------------- |
| `apps/desktop`              | Electron Main, secure Preload and React Renderer   |
| `apps/core`                 | isolated command server and orchestration          |
| `apps/cli`                  | project creation, inspection, Doctor and export    |
| `apps/mcp-server`           | project-scoped stdio tools                         |
| `packages/movie-ir`         | runtime schemas and stable YAML serialization      |
| `packages/project-store`    | SQLite, Object Store, Revision and repositories    |
| `packages/task-engine`      | recoverable state machine and events               |
| `packages/provider-gateway` | model/media adapters and normalized jobs           |
| `packages/agent-gateway`    | Codex and Claude Code process adapters             |
| `packages/media-engine`     | FFmpeg analysis and deterministic timeline render  |
| `packages/eval-engine`      | rule, technical and regression evaluation          |
| `packages/plugin-sdk`       | development Manifest and isolated process protocol |
| `packages/contracts`        | Core command and response runtime validation       |

Core packages must not import Electron. Renderer must not import Node APIs. Renderer inputs pass
through narrow Main IPC handlers and Core runtime schemas. Agent changes are Proposals, never direct
file writes.

## Changing formats and contracts

Durable format changes need a schema migration, fixture, compatibility behavior and documentation.
Public command changes belong in `packages/contracts`; IPC validates again in Main. Architecture or
trust-boundary changes require an ADR. Use microseconds for authored media time and relative POSIX
paths inside portable projects.

## Tests and fixtures

`pnpm check` runs Prettier, ESLint with type information, all workspace typechecks and Vitest. Media
tests skip real FFmpeg work only when no executable is available. `pnpm smoke:desktop` runs the full
Electron/Core/SQLite/Fake Provider/Timeline path and exits itself. `openmovie example` creates the
maintained three-shot continuity fixture. The executable async video and Plugin fixtures live under
`examples/`.

See [Plugin Development](./PLUGIN_DEVELOPMENT.md), [Performance](./PERFORMANCE.md),
[Accessibility](./ACCESSIBILITY.md), and [Releasing](./RELEASING.md).
