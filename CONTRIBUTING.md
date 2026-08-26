# Contributing to OpenMovie

OpenMovie is a pre-release implementation with a working Windows/macOS desktop baseline. Product,
architecture and operating guides are indexed in [docs/README.md](./docs/README.md). Start with the
[Development Guide](./docs/DEVELOPMENT.md) and the relevant package contracts.

## Before contributing

1. Read the relevant product and technical documents.
2. Search existing Issues and ADRs before proposing a new subsystem or public contract.
3. Discuss changes to project format, protocols, security boundaries, or process architecture before implementation.
4. Keep pull requests focused on one reviewable outcome.

Contributions are licensed under the repository's [MIT License](./LICENSE). By submitting a contribution, you agree that it may be distributed under that license and that you have the right to submit it.

## Development baseline

The repository uses a pnpm TypeScript monorepo with Electron Desktop, an isolated Core process, and
Windows/macOS CI. Node and pnpm versions are pinned in the repository; the lockfile is authoritative.

Before opening a PR, run:

```bash
pnpm check
pnpm test:coverage
pnpm build
pnpm perf:baseline -- --enforce
```

Run `pnpm smoke:desktop` for changes that affect Desktop, Core, SQLite, providers, media or IPC.

The implementation must preserve these boundaries:

- Core packages do not depend on Electron.
- Renderer code does not access Node.js APIs directly.
- Public contracts have runtime validation and compatibility fixtures.
- Agent writes go through typed tools, policy checks, and Revisions.
- Project files never contain plaintext credentials.
- Real paid providers do not run in default CI.

## Architecture changes

An ADR is required when a change alters one or more of:

- desktop or process architecture;
- durable project storage;
- a public IPC, Tool, Agent, or Provider contract;
- the Revision consistency model;
- security or trust boundaries;
- supported platform policy.

Accepted ADRs are not rewritten to reverse a decision. Add a new ADR that supersedes the old one. Use [docs/adr/README.md](./docs/adr/README.md) as the index.

## Pull request checklist

- The change has one clear user or engineering outcome.
- Tests cover normal, failure, cancellation, and recovery paths as applicable.
- Windows and macOS behavior is considered.
- Schema or contract changes include versioning, fixtures, and migration behavior.
- Logs and errors contain no secrets or raw private media.
- User-visible behavior and relevant documents are updated.
- No generated media, credentials, local database, or build artifacts are committed.
- The definition of done in the implementation plan is satisfied.

## Reporting security issues

Do not disclose a suspected vulnerability in a public Issue. Follow [SECURITY.md](./SECURITY.md).
