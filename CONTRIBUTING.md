# Contributing to OpenMovie

OpenMovie is in pre-implementation. The accepted product and technical baseline is indexed in [docs/README.md](./docs/README.md), and implementation begins with [M0 Repository Foundation](./docs/IMPLEMENTATION_PLAN.md#4-m0repository-foundation).

## Before contributing

1. Read the relevant product and technical documents.
2. Search existing Issues and ADRs before proposing a new subsystem or public contract.
3. Discuss changes to project format, protocols, security boundaries, or process architecture before implementation.
4. Keep pull requests focused on one reviewable outcome.

Contributions are licensed under the repository's [0BSD license](./LICENSE). By submitting a contribution, you agree that it may be distributed under that license and that you have the right to submit it.

## Development baseline

The repository will use a pnpm TypeScript monorepo with Electron Desktop, an isolated Core process, and Windows/macOS CI. Exact tool versions and executable commands will be added and locked by the M0 scaffold; do not infer commands that are not yet present.

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
