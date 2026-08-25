# OpenMovie Security Policy

## Project status

OpenMovie is pre-release and has no supported production version yet. Security boundaries for the first implementation are defined in [docs/SECURITY.md](./docs/SECURITY.md).

## Reporting a vulnerability

Do not open a public GitHub Issue for a suspected vulnerability or include real API keys, credentials, private media, or exploit details in public discussion.

Use GitHub Private Vulnerability Reporting for `OpenMovieLabs/OpenMovie` when it is enabled. If that channel is not available, contact an organization owner privately and share only the minimum reproduction data required. A dedicated security email can be added after the organization establishes and monitors one.

A useful report includes:

- affected commit or build;
- operating system and architecture;
- impact and preconditions;
- minimal reproduction steps;
- whether secrets or private media may have been exposed;
- a proposed mitigation, if known.

Do not test against systems, accounts, projects, providers, or media you do not own or have permission to use.

## Disclosure

The maintainers should acknowledge a report, reproduce it privately, agree on a remediation and disclosure timeline, and credit the reporter if requested. Exact response-time commitments will be published when a maintained release exists.

## Security-sensitive areas

The highest-risk surfaces are credential storage, Renderer/Main IPC, local file access, custom Provider endpoints, Harness/plugin execution, remote media ingestion, update signing, and untrusted Project files. Changes in these areas require security tests and review against [docs/SECURITY.md](./docs/SECURITY.md).
