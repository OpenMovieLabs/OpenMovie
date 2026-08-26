# OpenMovie

OpenMovie is an open-source desktop harness for building, testing, debugging, and iterating AI-native films.

The project treats a movie like a software project:

- Movie IR is the source.
- Images, video, audio, and cuts are build artifacts.
- Revisions are reviewable and reversible.
- Evaluations act as tests.
- Agents propose patches instead of silently overwriting work.

OpenMovie targets Windows and macOS. It can be driven by Codex, Claude Code, another compatible harness, or its built-in agent using API providers such as OpenAI-compatible Chat services, the OpenAI Responses protocol, OpenRouter, custom OpenAI-compatible multimodal endpoints, and multiple video generation providers.

## Status

Pre-release beta engineering baseline. The conversation-first desktop now uses a three-pane workspace:
project structure on the left, the creative Task thread in the center, and inspectable resources and
versions on the right. The portable Movie IR and linear Revision history, recoverable tasks, local Harnesses, API Providers, immutable Takes, local media
derivation, multimodal analysis, evaluation/regression gates, timecoded feedback, Current Cut render,
backup/repair, signed release pipeline, auto-update, bilingual accessible shell, performance gate and
Plugin development mode are implemented. Real-provider compatibility and creative quality remain
provider/model dependent and require opt-in testing.

## Documentation

- [Product definition](./PRODUCT.md)
- [Product design](./docs/PRODUCT_DESIGN.md)
- [Technical design](./docs/TECHNICAL_DESIGN.md)
- [Project format](./docs/PROJECT_FORMAT.md)
- [Protocol contracts](./docs/PROTOCOLS.md)
- [Security design](./docs/SECURITY.md)
- [Implementation plan](./docs/IMPLEMENTATION_PLAN.md)
- [用户手册（简体中文）](./docs/USER_GUIDE.zh-CN.md)
- [Development guide](./docs/DEVELOPMENT.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [Releasing](./docs/RELEASING.md)
- [Architecture decisions](./docs/adr/README.md)
- [Documentation index](./docs/README.md)
- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)

## Core architecture

```text
OpenMovie Desktop
→ OpenMovie Core
→ Task / Revision / Build / Eval
→ Agent Gateway + Provider Gateway
→ Codex / Claude Code / Direct Agent / Model APIs
```

## Development

Requires Node 22 and pnpm 11.

```bash
pnpm install
pnpm check
pnpm dev
```

Run `pnpm smoke:desktop` for the self-closing Electron integration test. It verifies the Core handshake, secure Preload bridge, SQLite project creation, Story and Movie IR commits, targeted Fake Provider generation, Object Store import, Take/evaluation/analysis persistence, Timeline assembly, and Harness detection.

Video analysis samples deterministic keyframes with FFmpeg and submits those frames through the configured vision-capable Provider. Signed Windows and macOS releases bundle pinned LGPL FFmpeg/FFprobe Sidecars with source and license notices, so end users do not install media tools separately. Development builds discover `ffmpeg` on `PATH`; `OPENMOVIE_FFMPEG_PATH` and `OPENMOVIE_FFPROBE_PATH` remain explicit overrides. Image analysis does not require FFmpeg.

Project settings include a versioned remote-Provider policy (`allow`, approval-first `confirm`, or `deny`) and an optional monthly reported-cost limit. The local usage ledger records Provider/Model/capability provenance, token usage, explicit Provider-reported cost, and unpriced calls without presenting unknown cost as free.

The Timeline renders selected image and video Takes into a normalized MP4, preferring H.264 encoders and falling back to the LGPL MPEG-4 encoder when necessary. Every render records its exact source Revision, Timeline revision, duration, object URI, and content hash. The Desktop previews the latest render without exposing arbitrary local paths.

### CLI and project integrity

The CLI uses the same Project Store and Revision engine as Desktop:

```bash
pnpm cli doctor /absolute/path/to/MyMovie --deep
pnpm cli summary /absolute/path/to/MyMovie --json
pnpm cli export /absolute/path/to/MyMovie /absolute/path/to/MyMovie-export
pnpm cli renders /absolute/path/to/MyMovie --json
pnpm cli example /absolute/path/to/three-shot-continuity --json
```

Project Doctor validates Movie IR schemas and references, selected Takes, SQLite integrity, content-addressed objects, and working changes. The same checks are available in Desktop under **Tests**.

Movie IR YAML remains the portable source of truth. If `.openmovie/state.sqlite` is missing, opening the project rebuilds a minimal runtime database and a recovery Revision from the validated YAML tree. Revision history, Take provenance, feedback, and task history require the original database, so use `openmovie export` for complete backups.

Generated image and video Takes are previewed through a restricted `openmovie-artifact` protocol. It resolves only SHA-256 objects inside the currently open project and does not expose arbitrary local file paths to the Renderer.

Version tags such as `v0.1.0` trigger Windows and macOS packaging in GitHub Actions. Public tag builds fail closed unless Windows signing plus macOS signing/notarization credentials are configured; manually dispatched development packages may remain unsigned. Tagged releases include update metadata, a CycloneDX SBOM, and `SHA256SUMS.txt` covering every published installer. Installed builds check the public GitHub Release channel, download updates in the background, and install only after the user chooses **Install and restart**.

### Agent Harnesses and MCP

OpenMovie Desktop detects local Codex and Claude Code installations. Codex runs through its App Server with project-scoped read tools; Claude Code runs in non-interactive print mode with structured JSON output, Plan permission mode, and only `Read`, `Glob`, and `Grep`. Both produce the same reviewable `OPENMOVIE_PLAN_V1` proposal, and neither planning path can commit Movie IR changes directly. Accepting a proposal creates one atomic Revision through Core.

For external Codex, Claude Code, or any MCP host, start the standalone stdio server while the project is not open in Desktop:

```bash
pnpm mcp --project /absolute/path/to/MyMovie
```

The MCP server exposes project/entity reads, Story editing, Timeline assembly and render inspection, Take/evaluation/analysis/feedback/proposal inspection, structured Revision diffs, Working Changes, Scene/Shot creation, and history restoration as a new Revision. Proposal acceptance remains an explicit Desktop action, and the server never exposes Provider API keys.

## Repository

https://github.com/OpenMovieLabs/OpenMovie

## License

[MIT](./LICENSE) — use, copy, modify, merge, publish, and distribute with attribution and the license notice preserved.
