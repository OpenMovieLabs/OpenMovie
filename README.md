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

Active implementation. Product, architecture, project format, protocol, security, and implementation baselines are defined; repository foundation and the first vertical slice are underway.

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

Run `pnpm smoke:desktop` for the self-closing Electron integration test. It verifies the Core handshake, secure Preload bridge, SQLite project creation, Revision commit, Fake Provider media task, Object Store import, and Harness detection.

## Repository

https://github.com/OpenMovieLabs/OpenMovie

## License

[0BSD](./LICENSE) — use, copy, modify, and distribute for any purpose, with or without fee.
