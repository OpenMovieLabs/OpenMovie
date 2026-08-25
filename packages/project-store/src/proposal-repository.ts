import { agentPlanSchema, createId, type AgentPlan } from '@openmovie/movie-ir';
import type Database from 'better-sqlite3';

import type { FeedbackRepository } from './feedback-repository.js';
import type { MovieWorkspace } from './movie-workspace.js';
import type { RevisionEngine } from './revision.js';

export type RevisionProposalRecord = {
  id: string;
  baseRevisionId: string;
  status: 'pending' | 'accepted' | 'rejected';
  summary: string;
  plan: AgentPlan;
  authorId: string;
  feedbackId?: string;
  acceptedRevisionId?: string;
  createdAt: string;
  updatedAt: string;
};

export class ProposalRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly movies: MovieWorkspace,
    private readonly revisions: RevisionEngine,
    private readonly feedback: FeedbackRepository,
  ) {}

  create(input: {
    baseRevisionId: string;
    plan: AgentPlan;
    authorId: string;
    feedbackId?: string;
  }): RevisionProposalRecord {
    if (this.revisions.currentRevisionId() !== input.baseRevisionId) {
      throw new Error('Proposal base Revision is no longer current');
    }
    const plan = agentPlanSchema.parse(input.plan);
    if (plan.actions.length === 0) throw new Error('Proposal requires at least one action');
    if (
      input.feedbackId &&
      !this.feedback.list().some((feedback) => feedback.id === input.feedbackId)
    ) {
      throw new Error(`Feedback not found: ${input.feedbackId}`);
    }
    const now = new Date().toISOString();
    const record: RevisionProposalRecord = {
      id: createId('proposal'),
      baseRevisionId: input.baseRevisionId,
      status: 'pending',
      summary: plan.summary,
      plan,
      authorId: input.authorId,
      ...(input.feedbackId ? { feedbackId: input.feedbackId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        `INSERT INTO revision_proposals(
          id, base_revision_id, status, summary, plan_json, author_id,
          feedback_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.baseRevisionId,
        record.status,
        record.summary,
        JSON.stringify(record.plan),
        record.authorId,
        record.feedbackId ?? null,
        now,
        now,
      );
    return record;
  }

  list(status?: RevisionProposalRecord['status']): RevisionProposalRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, base_revision_id, status, summary, plan_json, author_id,
          feedback_id, accepted_revision_id, created_at, updated_at
         FROM revision_proposals ${status ? 'WHERE status = ?' : ''}
         ORDER BY created_at DESC`,
      )
      .all(...(status ? [status] : [])) as Array<{
      id: string;
      base_revision_id: string;
      status: RevisionProposalRecord['status'];
      summary: string;
      plan_json: string;
      author_id: string;
      feedback_id: string | null;
      accepted_revision_id: string | null;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      baseRevisionId: row.base_revision_id,
      status: row.status,
      summary: row.summary,
      plan: agentPlanSchema.parse(JSON.parse(row.plan_json)),
      authorId: row.author_id,
      ...(row.feedback_id ? { feedbackId: row.feedback_id } : {}),
      ...(row.accepted_revision_id ? { acceptedRevisionId: row.accepted_revision_id } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async accept(proposalId: string, expectedRevisionId: string): Promise<RevisionProposalRecord> {
    const proposal = this.requirePending(proposalId);
    if (proposal.baseRevisionId !== expectedRevisionId) {
      throw new Error('Proposal does not target the expected Revision');
    }
    const applied = await this.movies.applyAgentPlan({
      plan: proposal.plan,
      expectedRevisionId,
      authorId: proposal.authorId,
    });
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE revision_proposals
         SET status = 'accepted', accepted_revision_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(applied.revision.id, now, proposal.id);
    if (proposal.feedbackId) this.feedback.resolve(proposal.feedbackId, applied.revision.id);
    return this.require(proposal.id);
  }

  reject(proposalId: string): RevisionProposalRecord {
    const proposal = this.requirePending(proposalId);
    this.database
      .prepare(`UPDATE revision_proposals SET status = 'rejected', updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), proposal.id);
    return this.require(proposal.id);
  }

  private requirePending(id: string): RevisionProposalRecord {
    const proposal = this.require(id);
    if (proposal.status !== 'pending') throw new Error(`Proposal is already ${proposal.status}`);
    return proposal;
  }

  private require(id: string): RevisionProposalRecord {
    const proposal = this.list().find((item) => item.id === id);
    if (!proposal) throw new Error(`Proposal not found: ${id}`);
    return proposal;
  }
}
