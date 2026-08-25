import { createId } from '@openmovie/movie-ir';
import type Database from 'better-sqlite3';

import type { MovieWorkspace } from './movie-workspace.js';

export type FeedbackTargetType = 'project' | 'scene' | 'shot' | 'take' | 'revision';

export type FeedbackRecord = {
  id: string;
  targetType: FeedbackTargetType;
  targetId: string;
  body: string;
  status: 'open' | 'resolved';
  authorId: string;
  resolutionRevisionId?: string;
  createdAt: string;
  updatedAt: string;
};

export class FeedbackRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly movies: MovieWorkspace,
  ) {}

  async create(input: {
    targetType: FeedbackTargetType;
    targetId: string;
    body: string;
    authorId: string;
  }): Promise<FeedbackRecord> {
    await this.assertTarget(input.targetType, input.targetId);
    const body = input.body.trim();
    if (!body) throw new Error('Feedback body is required');
    const now = new Date().toISOString();
    const record: FeedbackRecord = {
      id: createId('feedback'),
      targetType: input.targetType,
      targetId: input.targetId,
      body,
      status: 'open',
      authorId: input.authorId,
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        `INSERT INTO feedback(
          id, target_type, target_id, body, status, author_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.targetType,
        record.targetId,
        record.body,
        record.status,
        record.authorId,
        now,
        now,
      );
    return record;
  }

  list(
    input: {
      targetType?: FeedbackTargetType | undefined;
      targetId?: string | undefined;
      status?: FeedbackRecord['status'] | undefined;
    } = {},
  ): FeedbackRecord[] {
    const clauses: string[] = [];
    const parameters: string[] = [];
    if (input.targetType) {
      clauses.push('target_type = ?');
      parameters.push(input.targetType);
    }
    if (input.targetId) {
      clauses.push('target_id = ?');
      parameters.push(input.targetId);
    }
    if (input.status) {
      clauses.push('status = ?');
      parameters.push(input.status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.database
      .prepare(
        `SELECT id, target_type, target_id, body, status, author_id,
          resolution_revision_id, created_at, updated_at
         FROM feedback ${where} ORDER BY created_at DESC`,
      )
      .all(...parameters) as Array<{
      id: string;
      target_type: FeedbackTargetType;
      target_id: string;
      body: string;
      status: FeedbackRecord['status'];
      author_id: string;
      resolution_revision_id: string | null;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      body: row.body,
      status: row.status,
      authorId: row.author_id,
      ...(row.resolution_revision_id ? { resolutionRevisionId: row.resolution_revision_id } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  resolve(feedbackId: string, revisionId?: string): FeedbackRecord {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE feedback SET status = 'resolved', resolution_revision_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(revisionId ?? null, now, feedbackId);
    if (result.changes === 0) throw new Error(`Feedback not found: ${feedbackId}`);
    const record = this.list().find((item) => item.id === feedbackId);
    if (!record) throw new Error(`Feedback not found after update: ${feedbackId}`);
    return record;
  }

  private async assertTarget(type: FeedbackTargetType, id: string): Promise<void> {
    if (type === 'project') return;
    if (type === 'scene' || type === 'shot') {
      await this.movies.read(type, id);
      return;
    }
    const table = type === 'take' ? 'takes' : 'revisions';
    const row = this.database.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new Error(`${type} not found: ${id}`);
  }
}
