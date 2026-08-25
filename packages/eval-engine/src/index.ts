import type { Shot } from '@openmovie/movie-ir';

export type EvaluationFinding = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  pointer?: string;
  evidence?: Record<string, unknown>;
};

export type TakeEvaluationContext = {
  shot: Shot;
  take: {
    id: string;
    mimeType: string;
    provider: Record<string, unknown>;
    generation: Record<string, unknown>;
    byteSize: number;
  };
};

export type EvaluatorResult = {
  evaluator: string;
  score: number;
  findings: EvaluationFinding[];
};

export interface TakeEvaluator {
  readonly id: string;
  evaluate(context: TakeEvaluationContext): Promise<EvaluatorResult>;
}

export class EvaluationEngine {
  private readonly evaluators = new Map<string, TakeEvaluator>();

  register(evaluator: TakeEvaluator): void {
    if (this.evaluators.has(evaluator.id))
      throw new Error(`Evaluator already registered: ${evaluator.id}`);
    this.evaluators.set(evaluator.id, evaluator);
  }

  async run(context: TakeEvaluationContext): Promise<{
    status: 'passed' | 'warning' | 'failed';
    score: number;
    results: EvaluatorResult[];
  }> {
    const results = await Promise.all(
      [...this.evaluators.values()].map((evaluator) => evaluator.evaluate(context)),
    );
    const findings = results.flatMap((result) => result.findings);
    const status = findings.some((finding) => finding.severity === 'error')
      ? 'failed'
      : findings.some((finding) => finding.severity === 'warning')
        ? 'warning'
        : 'passed';
    const score =
      results.length === 0
        ? 1
        : results.reduce((total, result) => total + result.score, 0) / results.length;
    return { status, score, results };
  }
}

export class BuiltInTakeEvaluator implements TakeEvaluator {
  readonly id = 'openmovie.rules.v1';

  evaluate(context: TakeEvaluationContext): Promise<EvaluatorResult> {
    const findings: EvaluationFinding[] = [];
    if (context.take.byteSize === 0) {
      findings.push({
        code: 'MEDIA_EMPTY',
        severity: 'error',
        message: 'Generated media is empty.',
      });
    }
    const expectsVideo = context.shot.generation.preferred_mode.includes('video');
    if (expectsVideo && !context.take.mimeType.startsWith('video/')) {
      findings.push({
        code: 'MEDIA_KIND_MISMATCH',
        severity: 'warning',
        message: `Shot prefers video but Take is ${context.take.mimeType}.`,
        pointer: '/generation/preferred_mode',
      });
    }
    if (typeof context.take.generation.requestHash !== 'string') {
      findings.push({
        code: 'PROVENANCE_REQUEST_HASH_MISSING',
        severity: 'error',
        message: 'Take has no reproducible generation request hash.',
      });
    }
    if (
      typeof context.take.provider.providerId !== 'string' ||
      typeof context.take.provider.model !== 'string'
    ) {
      findings.push({
        code: 'PROVENANCE_PROVIDER_MISSING',
        severity: 'error',
        message: 'Take does not identify its Provider and model.',
      });
    }
    const penalty = findings.reduce(
      (total, finding) =>
        total + (finding.severity === 'error' ? 0.45 : finding.severity === 'warning' ? 0.15 : 0),
      0,
    );
    return Promise.resolve({ evaluator: this.id, score: Math.max(0, 1 - penalty), findings });
  }
}
