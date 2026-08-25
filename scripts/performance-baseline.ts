import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProjectStore } from '../packages/project-store/src/index.js';

const thresholdsMs = {
  createProject: 5_000,
  commitTwentyShots: 12_000,
  importEightMiB: 5_000,
  deepDoctor: 8_000,
  reopenProject: 3_000,
} as const;

async function measure<T>(work: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const started = process.hrtime.bigint();
  const value = await work();
  return { value, elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000 };
}

const root = await mkdtemp(join(tmpdir(), 'openmovie-performance-'));
let project: ProjectStore | undefined;
try {
  const created = await measure(() =>
    ProjectStore.create(join(root, 'movie'), { title: 'Performance Baseline' }),
  );
  project = created.value;
  const scene = await project.movies.createScene({
    title: 'Benchmark scene',
    expectedRevisionId: project.revisions.currentRevisionId(),
    authorId: 'performance_baseline',
  });
  let revisionId = scene.revision.id;
  const commits = await measure(async () => {
    for (let index = 0; index < 20; index += 1) {
      const result = await project!.movies.createShot({
        sceneId: scene.entity.id,
        durationUs: 2_000_000,
        framing: index % 2 === 0 ? 'wide' : 'medium',
        movement: 'static',
        expectedRevisionId: revisionId,
        authorId: 'performance_baseline',
      });
      revisionId = result.revision.id;
    }
  });
  const fixturePath = join(root, 'eight-mib.bin');
  await writeFile(fixturePath, Buffer.alloc(8 * 1024 * 1024, 0x5a));
  const imported = await measure(() => project!.objects.importFile(fixturePath));
  const doctor = await measure(() => project!.doctor.run({ deep: true }));
  if (doctor.value.status === 'failed')
    throw new Error('Performance fixture failed Project Doctor');
  await project.close();
  project = undefined;
  const reopened = await measure(() => ProjectStore.open(join(root, 'movie')));
  project = reopened.value;

  const measurements = {
    createProject: created.elapsedMs,
    commitTwentyShots: commits.elapsedMs,
    importEightMiB: imported.elapsedMs,
    deepDoctor: doctor.elapsedMs,
    reopenProject: reopened.elapsedMs,
  };
  const failures = Object.entries(measurements).flatMap(([name, elapsedMs]) => {
    const threshold = thresholdsMs[name as keyof typeof thresholdsMs];
    return elapsedMs > threshold ? [`${name}: ${elapsedMs.toFixed(1)}ms > ${threshold}ms`] : [];
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        workload: { shots: 20, importedBytes: 8 * 1024 * 1024 },
        measurementsMs: measurements,
        thresholdsMs,
        rssBytes: process.memoryUsage().rss,
        passed: failures.length === 0,
        failures,
      },
      null,
      2,
    )}\n`,
  );
  if (process.argv.includes('--enforce') && failures.length > 0) process.exitCode = 1;
} finally {
  await project?.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
