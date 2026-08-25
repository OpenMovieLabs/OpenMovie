#!/usr/bin/env node

import { cp } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ProjectStore, type DoctorReport } from '@openmovie/project-store';

export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
};

const help = `OpenMovie CLI

Usage:
  openmovie create <project> --title <title> [--locale zh-CN]
  openmovie summary <project> [--json]
  openmovie doctor <project> [--deep] [--json]
  openmovie entities <project> <character|scene|shot> [--json]
  openmovie revisions <project> [--json]
  openmovie renders <project> [--json]
  openmovie diff <project> <revision> [base-revision] [--json]
  openmovie export <project> <destination> [--deep] [--force]
`;

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const command = argv[0];
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    io.stdout(help.trimEnd());
    return 0;
  }
  try {
    if (command === 'create') {
      const path = required(argv[1], 'Project path');
      const title = required(option(argv, '--title'), '--title');
      const locale = option(argv, '--locale');
      const project = await ProjectStore.create(path, {
        title,
        ...(locale ? { locale } : {}),
      });
      try {
        print(io, await summary(project), hasFlag(argv, '--json'));
      } finally {
        await project.close();
      }
      return 0;
    }

    if (command === 'export') return exportProject(argv, io);

    const path = required(argv[1], 'Project path');
    const project = await ProjectStore.open(path, { takeoverStaleLock: false });
    try {
      if (command === 'summary') {
        print(io, await summary(project), hasFlag(argv, '--json'));
        return 0;
      }
      if (command === 'doctor') {
        const report = await project.doctor.run({ deep: hasFlag(argv, '--deep') });
        printDoctor(io, report, hasFlag(argv, '--json'));
        return report.status === 'failed' ? 2 : 0;
      }
      if (command === 'entities') {
        const kind = argv[2];
        if (kind !== 'character' && kind !== 'scene' && kind !== 'shot') {
          throw new Error('Entity kind must be character, scene, or shot');
        }
        print(io, await project.movies.list(kind), hasFlag(argv, '--json'));
        return 0;
      }
      if (command === 'revisions') {
        print(io, project.revisions.list(100), hasFlag(argv, '--json'));
        return 0;
      }
      if (command === 'renders') {
        print(io, project.media.listTimelineRenders(), hasFlag(argv, '--json'));
        return 0;
      }
      if (command === 'diff') {
        const revisionId = required(argv[2], 'Revision ID');
        const baseRevisionId = argv[3]?.startsWith('--') ? undefined : argv[3];
        print(
          io,
          baseRevisionId
            ? project.revisions.diff(revisionId, baseRevisionId)
            : project.revisions.diff(revisionId),
          true,
        );
        return 0;
      }
      throw new Error(`Unknown command: ${command}`);
    } finally {
      await project.close();
    }
  } catch (error) {
    io.stderr(`openmovie: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function exportProject(argv: string[], io: CliIo): Promise<number> {
  const source = resolve(required(argv[1], 'Project path'));
  const destination = resolve(required(argv[2], 'Destination path'));
  assertSeparatePaths(source, destination);
  const project = await ProjectStore.open(source, { takeoverStaleLock: false });
  let report: DoctorReport;
  try {
    report = await project.doctor.run({ deep: hasFlag(argv, '--deep') });
  } finally {
    await project.close();
  }
  if (report.status === 'failed' && !hasFlag(argv, '--force')) {
    printDoctor(io, report, false);
    throw new Error('Project Doctor failed; pass --force to export anyway');
  }
  await cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: (path) => shouldExport(source, path),
  });
  io.stdout(`Exported ${source} -> ${destination}`);
  return 0;
}

function shouldExport(root: string, path: string): boolean {
  const item = relative(root, path).replaceAll('\\', '/');
  if (!item) return true;
  return ![
    '.openmovie/locks',
    '.openmovie/temp',
    '.openmovie/cache',
    '.openmovie/logs',
    '.openmovie/previews',
    '.openmovie/state.sqlite-wal',
    '.openmovie/state.sqlite-shm',
  ].some((excluded) => item === excluded || item.startsWith(`${excluded}/`));
}

function assertSeparatePaths(source: string, destination: string): void {
  const fromSource = relative(source, destination);
  const fromDestination = relative(destination, source);
  if (
    !fromSource ||
    (!fromSource.startsWith('..') && fromSource !== '') ||
    (!fromDestination.startsWith('..') && fromDestination !== '')
  ) {
    throw new Error('Export source and destination must be separate directories');
  }
}

async function summary(project: ProjectStore): Promise<Record<string, unknown>> {
  const manifest = await project.readManifest();
  return {
    id: manifest.project.id,
    title: manifest.project.title,
    root: project.root,
    locale: manifest.project.default_locale,
    currentRevisionId: project.revisions.currentRevisionId(),
    currentBranch: project.revisions.currentBranch(),
    counts: {
      characters: (await project.movies.list('character')).length,
      scenes: (await project.movies.list('scene')).length,
      shots: (await project.movies.list('shot')).length,
      revisions: project.revisions.list(10_000).length,
      renders: project.media.listTimelineRenders().length,
    },
  };
}

function print(io: CliIo, value: unknown, json: boolean): void {
  if (json || typeof value !== 'object' || value === null) {
    io.stdout(JSON.stringify(value, null, 2));
    return;
  }
  io.stdout(JSON.stringify(value, null, 2));
}

function printDoctor(io: CliIo, report: DoctorReport, json: boolean): void {
  if (json) return print(io, report, true);
  io.stdout(`Project Doctor: ${report.status} (${report.checks} checks)`);
  for (const issue of report.issues) {
    io.stdout(
      `  ${issue.severity.toUpperCase()} ${issue.code}${issue.path ? ` ${issue.path}` : ''}: ${issue.message}`,
    );
  }
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

const isEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;
if (isEntrypoint) process.exitCode = await runCli(process.argv.slice(2));
