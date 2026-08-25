# OpenMovie

OpenMovie is an open-source desktop harness for building, testing, debugging, and iterating AI-native films.

The project treats a movie like a software project:

- Movie IR is the source.
- Images, video, audio, and cuts are build artifacts.
- Revisions are reviewable and reversible.
- Evaluations act as tests.
- Agents propose patches instead of silently overwriting work.

OpenMovie targets Windows and macOS. It can be driven by Codex, Claude Code, another compatible harness, or its built-in agent using API providers such as OpenAI-compatible services, OpenRouter, custom multimodal APIs, and multiple video generation providers.

## Status

Active implementation. The desktop vertical slice now covers portable Movie IR projects, recoverable tasks, local Codex App Server and MCP integrations, OpenAI-compatible providers, asynchronous video-provider jobs, immutable image/video Takes, deterministic evaluations, Take selection, structured diffs, and creative branches.

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

Run `pnpm smoke:desktop` for the self-closing Electron integration test. It verifies the Core handshake, secure Preload bridge, SQLite project creation, Movie IR entity commits, targeted Fake Provider generation, Object Store import, Take and evaluation persistence, and Harness detection.

### CLI and project integrity

The CLI uses the same Project Store and Revision engine as Desktop:

```bash
pnpm cli doctor /absolute/path/to/MyMovie --deep
pnpm cli summary /absolute/path/to/MyMovie --json
pnpm cli export /absolute/path/to/MyMovie /absolute/path/to/MyMovie-export
```

Project Doctor validates Movie IR schemas and references, selected Takes, SQLite integrity, content-addressed objects, and working changes. The same checks are available in Desktop under **Tests**.

Generated image and video Takes are previewed through a restricted `openmovie-artifact` protocol. It resolves only SHA-256 objects inside the currently open project and does not expose arbitrary local file paths to the Renderer.

Version tags such as `v0.1.0` trigger signed-ready Windows and macOS packaging in GitHub Actions. Signing credentials are optional for development builds and can be added as repository secrets for public distribution.

### Agent Harnesses and MCP

OpenMovie Desktop detects a local Codex installation and can use its official App Server as a read-only planning harness. OpenMovie exposes typed dynamic tools for project inspection and Revision-safe Scene/Shot creation; all writes still pass through Core.

For external Codex, Claude Code, or any MCP host, start the standalone stdio server while the project is not open in Desktop:

```bash
pnpm mcp --project /absolute/path/to/MyMovie
```

The MCP server exposes project/entity reads, structured Revision diffs, Working Changes, Scene/Shot creation, and creative branches. It never exposes Provider API keys.

## Repository

https://github.com/OpenMovieLabs/OpenMovie

## License

[0BSD](./LICENSE) — use, copy, modify, and distribute for any purpose, with or without fee.
