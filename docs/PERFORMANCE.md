# Performance Baseline

`pnpm perf:baseline` runs a deterministic, offline workload against the real portable project store:

- create and migrate a project;
- commit one Scene and twenty Shot Revisions;
- stream and hash an 8 MiB Object Store import;
- run deep Project Doctor including object re-hashing;
- close and reopen the project.

The command prints versioned JSON with platform, architecture, Node version, elapsed milliseconds,
RSS, thresholds and failures. `pnpm perf:baseline -- --enforce` returns non-zero when a threshold is
exceeded. CI enforces the same deliberately conservative thresholds on Windows and macOS so that
large regressions fail while normal shared-runner variance does not.

This baseline measures Core storage responsiveness, not Provider latency, model quality, FFmpeg
throughput or UI frame rate. Those depend on network, model, media and hardware and must be reported
as separate scenario benchmarks.
