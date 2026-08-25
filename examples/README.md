# OpenMovie examples

Generate the maintained three-shot continuity project with the same Project Store used by Desktop:

```bash
pnpm cli example /absolute/path/to/three-shot-continuity --json
```

The generated project contains:

- a Story Brief and Bible with explicit continuity rules;
- one Character, one Scene, and three ordered Shots;
- two immutable comparison Takes per Shot with deterministic provenance and evaluations;
- one selected Take per Shot;
- an assembled seven-and-a-half-second Current Cut Timeline;
- complete Revision history and a healthy deep Project Doctor report.

The media are tiny deterministic fixtures so the example is free, offline, and safe for CI. Replace or regenerate the Takes from Desktop to exercise real image and video Providers.
