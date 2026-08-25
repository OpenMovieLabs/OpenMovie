import { createHash } from 'node:crypto';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  assetManifestSchema,
  briefSchema,
  characterSchema,
  parseYamlDocument,
  sceneSchema,
  screenplaySchema,
  shotSchema,
  storyBibleSchema,
  timelineSchema,
  type AssetManifest,
  type ProjectManifest,
  type Screenplay,
  type Timeline,
} from '@openmovie/movie-ir';
import type Database from 'better-sqlite3';

import type { ObjectStore } from './object-store.js';
import type { RevisionEngine } from './revision.js';

export type DoctorIssue = {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
};

export type DoctorReport = {
  status: 'healthy' | 'warning' | 'failed';
  projectId: string;
  checkedAt: string;
  checks: number;
  issues: DoctorIssue[];
};

type DoctorOptions = { deep?: boolean };

export class ProjectDoctor {
  constructor(
    private readonly root: string,
    private readonly manifest: ProjectManifest,
    private readonly database: Database.Database,
    private readonly objects: ObjectStore,
    private readonly revisions: RevisionEngine,
  ) {}

  async run(options: DoctorOptions = {}): Promise<DoctorReport> {
    const issues: DoctorIssue[] = [];
    let checks = 0;
    const check = (): void => {
      checks += 1;
    };
    const report = (issue: DoctorIssue): void => {
      issues.push(issue);
    };

    for (const path of Object.values(this.manifest.entrypoints)) {
      check();
      try {
        await stat(join(this.root, path));
      } catch {
        report({
          severity: 'error',
          code: 'ENTRYPOINT_MISSING',
          message: 'Entrypoint is missing',
          path,
        });
      }
    }

    const characters = await this.readEntities('characters', characterSchema, issues, check);
    const scenes = await this.readEntities('scenes', sceneSchema, issues, check);
    const shots = await this.readEntities('shots', shotSchema, issues, check);
    const characterIds = new Set(characters.map((character) => character.id));
    const sceneIds = new Set(scenes.map((scene) => scene.id));
    const shotIds = new Set(shots.map((shot) => shot.id));
    await this.validateStructuredFile(this.manifest.entrypoints.brief, briefSchema, issues, check);
    await this.validateStructuredFile(
      this.manifest.entrypoints.story_bible,
      storyBibleSchema,
      issues,
      check,
    );

    for (const scene of scenes) {
      for (const characterId of scene.characters) {
        check();
        if (!characterIds.has(characterId)) {
          report({
            severity: 'error',
            code: 'REFERENCE_MISSING',
            message: `Scene references missing character ${characterId}`,
            path: `scenes/${scene.id}.yaml`,
          });
        }
      }
      for (const shotId of scene.shots) {
        check();
        if (!shotIds.has(shotId)) {
          report({
            severity: 'error',
            code: 'REFERENCE_MISSING',
            message: `Scene references missing shot ${shotId}`,
            path: `scenes/${scene.id}.yaml`,
          });
        }
      }
    }

    for (const shot of shots) {
      check();
      if (!sceneIds.has(shot.scene)) {
        report({
          severity: 'error',
          code: 'REFERENCE_MISSING',
          message: `Shot references missing scene ${shot.scene}`,
          path: `shots/${shot.id}.yaml`,
        });
      }
      for (const characterId of shot.characters) {
        check();
        if (!characterIds.has(characterId)) {
          report({
            severity: 'error',
            code: 'REFERENCE_MISSING',
            message: `Shot references missing character ${characterId}`,
            path: `shots/${shot.id}.yaml`,
          });
        }
      }
      if (shot.selected_take) {
        check();
        const take = this.database
          .prepare('SELECT shot_id FROM takes WHERE id = ?')
          .get(shot.selected_take) as { shot_id: string } | undefined;
        if (!take || take.shot_id !== shot.id) {
          report({
            severity: 'error',
            code: 'SELECTED_TAKE_INVALID',
            message: `Selected Take ${shot.selected_take} does not belong to this shot`,
            path: `shots/${shot.id}.yaml`,
          });
        }
      }
    }

    const timeline = await this.validateStructuredFile<Timeline>(
      this.manifest.entrypoints.timeline,
      timelineSchema,
      issues,
      check,
    );
    const assetManifest = await this.validateStructuredFile<AssetManifest>(
      this.manifest.entrypoints.asset_manifest,
      assetManifestSchema,
      issues,
      check,
    );
    const screenplay = await this.validateStructuredFile<Screenplay>(
      this.manifest.entrypoints.screenplay,
      screenplaySchema,
      issues,
      check,
    );
    for (const sceneId of screenplay?.scenes ?? []) {
      check();
      if (!sceneIds.has(sceneId)) {
        report({
          severity: 'error',
          code: 'REFERENCE_MISSING',
          message: `Screenplay references missing scene ${sceneId}`,
          path: this.manifest.entrypoints.screenplay,
        });
      }
    }
    if (timeline) {
      const tracks = [
        ...timeline.video_tracks,
        ...timeline.audio_tracks,
        ...timeline.subtitle_tracks,
      ];
      for (const clip of tracks.flatMap((track) => track.clips)) {
        check();
        if (!shotIds.has(clip.shot)) {
          report({
            severity: 'error',
            code: 'REFERENCE_MISSING',
            message: `Timeline clip ${clip.id} references missing shot ${clip.shot}`,
            path: this.manifest.entrypoints.timeline,
          });
        }
        if (clip.take) {
          const take = this.database
            .prepare('SELECT shot_id FROM takes WHERE id = ?')
            .get(clip.take) as { shot_id: string } | undefined;
          if (!take || take.shot_id !== clip.shot) {
            report({
              severity: 'error',
              code: 'TIMELINE_TAKE_INVALID',
              message: `Timeline Take ${clip.take} does not belong to shot ${clip.shot}`,
              path: this.manifest.entrypoints.timeline,
            });
          }
        }
      }
    }
    if (assetManifest) {
      for (const asset of assetManifest.assets) {
        check();
        try {
          const metadata = await stat(this.objects.resolveUri(asset.object_uri));
          if (metadata.size !== asset.byte_size) {
            report({
              severity: 'error',
              code: 'ASSET_SIZE_MISMATCH',
              message: `Asset ${asset.id} declares ${asset.byte_size} bytes but stores ${metadata.size}`,
              path: this.manifest.entrypoints.asset_manifest,
            });
          }
        } catch (error) {
          report({
            severity: 'error',
            code: 'ASSET_OBJECT_MISSING',
            message: error instanceof Error ? error.message : String(error),
            path: this.manifest.entrypoints.asset_manifest,
          });
        }
      }
    }

    check();
    const integrity = this.database.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrity.some((row) => row.integrity_check !== 'ok')) {
      report({
        severity: 'error',
        code: 'DATABASE_INTEGRITY_FAILED',
        message: integrity.map((row) => row.integrity_check).join('; '),
        path: '.openmovie/state.sqlite',
      });
    }
    check();
    const foreignKeys = this.database.pragma('foreign_key_check') as unknown[];
    if (foreignKeys.length > 0) {
      report({
        severity: 'error',
        code: 'DATABASE_FOREIGN_KEY_FAILED',
        message: `${foreignKeys.length} foreign-key violations found`,
        path: '.openmovie/state.sqlite',
      });
    }

    const artifacts = this.database
      .prepare('SELECT object_uri, byte_size FROM artifacts ORDER BY object_uri')
      .all() as Array<{ object_uri: string; byte_size: number }>;
    for (const artifact of artifacts) {
      check();
      try {
        const objectPath = this.objects.resolveUri(artifact.object_uri);
        const metadata = await stat(objectPath);
        if (metadata.size !== artifact.byte_size) {
          report({
            severity: 'error',
            code: 'OBJECT_SIZE_MISMATCH',
            message: `Expected ${artifact.byte_size} bytes but found ${metadata.size}`,
            path: relative(this.root, objectPath),
          });
        }
        if (options.deep) {
          const expected = artifact.object_uri.split('/').at(-1);
          const actual = await hashFile(objectPath);
          if (expected !== actual) {
            report({
              severity: 'error',
              code: 'OBJECT_HASH_MISMATCH',
              message: `Expected SHA-256 ${expected}, found ${actual}`,
              path: relative(this.root, objectPath),
            });
          }
        }
      } catch (error) {
        report({
          severity: 'error',
          code: 'OBJECT_MISSING',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const working = await this.revisions.workingChanges();
    check();
    if (working.length > 0) {
      report({
        severity: 'warning',
        code: 'WORKING_CHANGES',
        message: `${working.length} Movie IR files differ from the current Revision`,
      });
    }

    return {
      status: issues.some((issue) => issue.severity === 'error')
        ? 'failed'
        : issues.length > 0
          ? 'warning'
          : 'healthy',
      projectId: this.manifest.project.id,
      checkedAt: new Date().toISOString(),
      checks,
      issues,
    };
  }

  private async readEntities<T>(
    directory: string,
    schema: { parse(value: unknown): T },
    issues: DoctorIssue[],
    check: () => void,
  ): Promise<T[]> {
    const values: T[] = [];
    const names = (await readdir(join(this.root, directory))).filter((name) =>
      name.endsWith('.yaml'),
    );
    for (const name of names) {
      check();
      try {
        const source = await readFile(join(this.root, directory, name), 'utf8');
        values.push(schema.parse(parseYamlDocument(source)));
      } catch (error) {
        issues.push({
          severity: 'error',
          code: 'SCHEMA_INVALID',
          message: error instanceof Error ? error.message : String(error),
          path: `${directory}/${name}`,
        });
      }
    }
    return values;
  }

  private async validateStructuredFile<T>(
    path: string,
    schema: { parse(value: unknown): T },
    issues: DoctorIssue[],
    check: () => void,
  ): Promise<T | undefined> {
    check();
    try {
      return schema.parse(parseYamlDocument(await readFile(join(this.root, path), 'utf8')));
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'SCHEMA_INVALID',
        message: error instanceof Error ? error.message : String(error),
        path,
      });
      return undefined;
    }
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  const file = await open(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } finally {
    await file.close();
  }
}
