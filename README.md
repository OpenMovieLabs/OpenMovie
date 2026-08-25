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

Active implementation. The desktop vertical slice now covers portable Movie IR projects, Brief/Story Bible editing, Scene/Shot authoring, deterministic Timeline assembly and MP4 Current Cut rendering, recoverable tasks, local Codex App Server and MCP integrations, OpenAI-compatible providers with credential-safe connection tests, asynchronous video-provider jobs, immutable image/video Takes, multimodal Take analysis, deterministic evaluations, structured feedback, reviewable Direct Agent proposals, Take selection, structured diffs, and creative branches.

## Documentation

- [Product definition](./PRODUCT.md)
- [Product design](./docs/PRODUCT_DESIGN.md)
- [Technical design](./docs/TECHNICAL_DESIGN.md)
- [Project format](./docs/PROJECT_FORMAT.md)
- [Protocol contracts](./docs/PROTOCOLS.md)
- [Security design](./docs/SECURITY.md)
- [Implementation plan](./docs/IMPLEMENTATION_PLAN.md)
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

Video analysis samples deterministic keyframes with FFmpeg and submits those frames through the configured vision-capable Provider. Development builds discover `ffmpeg` on `PATH`; set `OPENMOVIE_FFMPEG_PATH` to an explicit executable when necessary. Image analysis does not require FFmpeg.

The Timeline can render selected image and video Takes into a normalized H.264 MP4. Every render records its exact source Revision, Timeline revision, duration, object URI, and content hash. The Desktop previews the latest render without exposing arbitrary local paths.

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

Version tags such as `v0.1.0` trigger signed-ready Windows and macOS packaging in GitHub Actions. Signing credentials are optional for development builds and can be added as repository secrets for public distribution.

### Agent Harnesses and MCP

OpenMovie Desktop detects a local Codex installation and can use its official App Server as a read-only planning harness. OpenMovie exposes typed dynamic tools for project inspection and Revision-safe Scene/Shot creation; all writes still pass through Core.

For external Codex, Claude Code, or any MCP host, start the standalone stdio server while the project is not open in Desktop:

```bash
pnpm mcp --project /absolute/path/to/MyMovie
```

The MCP server exposes project/entity reads, Story editing, Timeline assembly and render inspection, Take/evaluation/analysis/feedback/proposal inspection, structured Revision diffs, Working Changes, Scene/Shot creation, and creative branches. Proposal acceptance remains an explicit Desktop action, and the server never exposes Provider API keys.

## Repository

https://github.com/OpenMovieLabs/OpenMovie

## License

[0BSD](./LICENSE) — use, copy, modify, and distribute for any purpose, with or without fee.
