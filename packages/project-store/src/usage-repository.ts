import { createId } from '@openmovie/movie-ir';
import type Database from 'better-sqlite3';

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  costUsdMicros?: number;
};

export type ProviderUsageSummary = {
  period: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
  unpricedRunCount: number;
};

export class UsageRepository {
  constructor(private readonly database: Database.Database) {}

  record(input: {
    taskId?: string;
    providerId: string;
    modelId: string;
    capability: string;
    requestHash: string;
    providerJobId?: string;
    usage?: ProviderUsage;
  }): void {
    const now = new Date().toISOString();
    const usage = validateUsage(input.usage ?? {});
    this.database
      .prepare(
        `INSERT INTO provider_runs(
          id, task_id, provider_id, model_id, capability, request_hash, provider_job_id,
          status, usage_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'succeeded', ?, ?, ?)`,
      )
      .run(
        createId('provider_run'),
        input.taskId ?? null,
        input.providerId,
        input.modelId,
        input.capability,
        input.requestHash,
        input.providerJobId ?? null,
        JSON.stringify(usage),
        now,
        now,
      );
  }

  summary(date = new Date()): ProviderUsageSummary {
    const period = date.toISOString().slice(0, 7);
    const rows = this.database
      .prepare(
        `SELECT usage_json FROM provider_runs
         WHERE status = 'succeeded' AND created_at >= ? AND created_at < ?`,
      )
      .all(`${period}-01T00:00:00.000Z`, nextMonth(period)) as Array<{ usage_json: string }>;
    return rows.reduce<ProviderUsageSummary>(
      (summary, row) => {
        const usage = validateUsage(JSON.parse(row.usage_json));
        summary.runCount += 1;
        summary.inputTokens += usage.inputTokens ?? 0;
        summary.outputTokens += usage.outputTokens ?? 0;
        summary.costUsdMicros += usage.costUsdMicros ?? 0;
        if (usage.costUsdMicros === undefined) summary.unpricedRunCount += 1;
        return summary;
      },
      {
        period,
        runCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: 0,
        unpricedRunCount: 0,
      },
    );
  }
}

function validateUsage(value: unknown): ProviderUsage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid Provider usage record');
  }
  const source = value as Record<string, unknown>;
  const usage: ProviderUsage = {};
  for (const key of ['inputTokens', 'outputTokens', 'costUsdMicros'] as const) {
    const item = source[key];
    if (item === undefined) continue;
    if (!Number.isSafeInteger(item) || Number(item) < 0) {
      throw new Error(`Invalid Provider usage ${key}`);
    }
    usage[key] = Number(item);
  }
  return usage;
}

function nextMonth(period: string): string {
  const [yearText, monthText] = period.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return `${next.year}-${String(next.month).padStart(2, '0')}-01T00:00:00.000Z`;
}
