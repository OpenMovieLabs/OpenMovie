import { createId, shotSchema, type Shot } from '@openmovie/movie-ir';
import type Database from 'better-sqlite3';

import type { StoredObject } from './object-store.js';
import type { MovieWorkspace } from './movie-workspace.js';

export type ArtifactRecord = {
  id: string;
  objectUri: string;
  mimeType: string;
  byteSize: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type TakeRecord = {
  id: string;
  shotId: string;
  artifactId: string;
  artifact: ArtifactRecord;
  runId?: string;
  provider: Record<string, unknown>;
  generation: Record<string, unknown>;
  createdAt: string;
};

export type EvaluationRecord = {
  id: string;
  takeId: string;
  evaluator: string;
  status: 'passed' | 'warning' | 'failed';
  score?: number;
  findings: Array<Record<string, unknown>>;
  provenance: Record<string, unknown>;
  createdAt: string;
};

export type AnalysisRecord = {
  id: string;
  takeId: string;
  kind: 'image' | 'video';
  providerId: string;
  modelId: string;
  summary: string;
  evidence: Array<Record<string, unknown>>;
  provenance: Record<string, unknown>;
  createdAt: string;
};

export type TimelineRenderRecord = {
  id: string;
  sourceRevisionId: string;
  timelineRevision: number;
  objectUri: string;
  mimeType: string;
  byteSize: number;
  durationUs: number;
  createdAt: string;
};

export class MediaRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly movies: MovieWorkspace,
  ) {}

  async createTake(input: {
    shotId: string;
    object: StoredObject;
    runId?: string;
    provider: Record<string, unknown>;
    generation: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<TakeRecord> {
    await this.movies.read('shot', input.shotId);
    const now = new Date().toISOString();
    const artifact: ArtifactRecord = {
      id: createId('artifact'),
      objectUri: input.object.uri,
      mimeType: input.object.mimeType,
      byteSize: input.object.byteSize,
      metadata: input.metadata ?? {},
      createdAt: now,
    };
    const take: TakeRecord = {
      id: createId('take'),
      shotId: input.shotId,
      artifactId: artifact.id,
      artifact,
      ...(input.runId ? { runId: input.runId } : {}),
      provider: input.provider,
      generation: input.generation,
      createdAt: now,
    };
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO artifacts(id, object_uri, mime_type, byte_size, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          artifact.id,
          artifact.objectUri,
          artifact.mimeType,
          artifact.byteSize,
          JSON.stringify(artifact.metadata),
          now,
        );
      this.database
        .prepare(
          `INSERT INTO takes(id, shot_id, artifact_id, run_id, provider_json, generation_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          take.id,
          take.shotId,
          take.artifactId,
          take.runId ?? null,
          JSON.stringify(take.provider),
          JSON.stringify(take.generation),
          now,
        );
    })();
    return take;
  }

  listTakes(shotId: string): TakeRecord[] {
    return (
      this.database
        .prepare(
          `SELECT
             takes.id, takes.shot_id, takes.artifact_id, takes.run_id,
             takes.provider_json, takes.generation_json, takes.created_at,
             artifacts.object_uri, artifacts.mime_type, artifacts.byte_size,
             artifacts.metadata_json, artifacts.created_at AS artifact_created_at
           FROM takes
           INNER JOIN artifacts ON artifacts.id = takes.artifact_id
           WHERE takes.shot_id = ? ORDER BY takes.created_at DESC`,
        )
        .all(shotId) as Array<{
        id: string;
        shot_id: string;
        artifact_id: string;
        run_id: string | null;
        provider_json: string;
        generation_json: string;
        created_at: string;
        object_uri: string;
        mime_type: string;
        byte_size: number;
        metadata_json: string;
        artifact_created_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      shotId: row.shot_id,
      artifactId: row.artifact_id,
      artifact: {
        id: row.artifact_id,
        objectUri: row.object_uri,
        mimeType: row.mime_type,
        byteSize: row.byte_size,
        metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
        createdAt: row.artifact_created_at,
      },
      ...(row.run_id ? { runId: row.run_id } : {}),
      provider: JSON.parse(row.provider_json) as Record<string, unknown>,
      generation: JSON.parse(row.generation_json) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  getTake(takeId: string): TakeRecord {
    const row = this.database.prepare('SELECT shot_id FROM takes WHERE id = ?').get(takeId) as
      { shot_id: string } | undefined;
    if (!row) throw new Error(`Take not found: ${takeId}`);
    const take = this.listTakes(row.shot_id).find((item) => item.id === takeId);
    if (!take) throw new Error(`Take not found: ${takeId}`);
    return take;
  }

  async selectTake(input: {
    takeId: string;
    expectedRevisionId: string | null;
    authorId: string;
  }): Promise<{ shot: Shot; revisionId: string }> {
    const row = this.database
      .prepare('SELECT shot_id FROM takes WHERE id = ?')
      .get(input.takeId) as { shot_id: string } | undefined;
    if (!row) throw new Error(`Take not found: ${input.takeId}`);
    const current = shotSchema.parse(await this.movies.read('shot', row.shot_id));
    const committed = await this.movies.update({
      entity: { ...current, selected_take: input.takeId },
      expectedEntityRevision: current.revision,
      expectedRevisionId: input.expectedRevisionId,
      authorType: 'user',
      authorId: input.authorId,
      message: `Select take ${input.takeId}`,
    });
    return { shot: committed.entity, revisionId: committed.revision.id };
  }

  recordEvaluation(input: Omit<EvaluationRecord, 'id' | 'createdAt'>): EvaluationRecord {
    const record: EvaluationRecord = {
      ...input,
      id: createId('eval'),
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare(
        `INSERT INTO evaluations(
          id, take_id, evaluator, status, score, findings_json, provenance_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.takeId,
        record.evaluator,
        record.status,
        record.score ?? null,
        JSON.stringify(record.findings),
        JSON.stringify(record.provenance),
        record.createdAt,
      );
    return record;
  }

  listEvaluations(takeId: string): EvaluationRecord[] {
    return (
      this.database
        .prepare(
          `SELECT id, take_id, evaluator, status, score, findings_json, provenance_json, created_at
           FROM evaluations WHERE take_id = ? ORDER BY created_at DESC`,
        )
        .all(takeId) as Array<{
        id: string;
        take_id: string;
        evaluator: string;
        status: EvaluationRecord['status'];
        score: number | null;
        findings_json: string;
        provenance_json: string;
        created_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      takeId: row.take_id,
      evaluator: row.evaluator,
      status: row.status,
      ...(row.score === null ? {} : { score: row.score }),
      findings: JSON.parse(row.findings_json) as Array<Record<string, unknown>>,
      provenance: JSON.parse(row.provenance_json) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  recordAnalysis(input: Omit<AnalysisRecord, 'id' | 'createdAt'>): AnalysisRecord {
    this.getTake(input.takeId);
    const record: AnalysisRecord = {
      ...input,
      id: createId('analysis'),
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare(
        `INSERT INTO analyses(
          id, take_id, kind, provider_id, model_id, summary,
          evidence_json, provenance_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.takeId,
        record.kind,
        record.providerId,
        record.modelId,
        record.summary,
        JSON.stringify(record.evidence),
        JSON.stringify(record.provenance),
        record.createdAt,
      );
    return record;
  }

  listAnalyses(takeId: string): AnalysisRecord[] {
    return (
      this.database
        .prepare(
          `SELECT id, take_id, kind, provider_id, model_id, summary,
             evidence_json, provenance_json, created_at
           FROM analyses WHERE take_id = ? ORDER BY created_at DESC`,
        )
        .all(takeId) as Array<{
        id: string;
        take_id: string;
        kind: AnalysisRecord['kind'];
        provider_id: string;
        model_id: string;
        summary: string;
        evidence_json: string;
        provenance_json: string;
        created_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      takeId: row.take_id,
      kind: row.kind,
      providerId: row.provider_id,
      modelId: row.model_id,
      summary: row.summary,
      evidence: JSON.parse(row.evidence_json) as Array<Record<string, unknown>>,
      provenance: JSON.parse(row.provenance_json) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  recordTimelineRender(input: {
    sourceRevisionId: string;
    timelineRevision: number;
    object: StoredObject;
    durationUs: number;
  }): TimelineRenderRecord {
    const record: TimelineRenderRecord = {
      id: createId('render'),
      sourceRevisionId: input.sourceRevisionId,
      timelineRevision: input.timelineRevision,
      objectUri: input.object.uri,
      mimeType: input.object.mimeType,
      byteSize: input.object.byteSize,
      durationUs: input.durationUs,
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare(
        `INSERT INTO timeline_renders(
          id, source_revision_id, timeline_revision, object_uri, mime_type,
          byte_size, duration_us, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sourceRevisionId,
        record.timelineRevision,
        record.objectUri,
        record.mimeType,
        record.byteSize,
        record.durationUs,
        record.createdAt,
      );
    return record;
  }

  listTimelineRenders(): TimelineRenderRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, source_revision_id, timeline_revision, object_uri, mime_type,
          byte_size, duration_us, created_at
         FROM timeline_renders ORDER BY created_at DESC`,
      )
      .all() as Array<{
      id: string;
      source_revision_id: string;
      timeline_revision: number;
      object_uri: string;
      mime_type: string;
      byte_size: number;
      duration_us: number;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      sourceRevisionId: row.source_revision_id,
      timelineRevision: row.timeline_revision,
      objectUri: row.object_uri,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      durationUs: row.duration_us,
      createdAt: row.created_at,
    }));
  }
}
