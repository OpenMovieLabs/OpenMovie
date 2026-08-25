import type { Shot } from '@openmovie/movie-ir';

export type EvaluationFinding = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  pointer?: string;
  evidence?: Record<string, unknown>;
};

export type TechnicalMediaFacts = {
  width?: number;
  height?: number;
  durationUs?: number;
  hasAudio?: boolean;
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
  delivery?: { width: number; height: number };
  technical?: TechnicalMediaFacts;
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

export class TechnicalMediaEvaluator implements TakeEvaluator {
  readonly id = 'openmovie.media_technical.v1';

  evaluate(context: TakeEvaluationContext): Promise<EvaluatorResult> {
    const findings: EvaluationFinding[] = [];
    const technical = context.technical;
    if (!technical) {
      return Promise.resolve({ evaluator: this.id, score: 1, findings: [] });
    }
    if (technical.width && technical.height && context.delivery) {
      const sourceRatio = technical.width / technical.height;
      const deliveryRatio = context.delivery.width / context.delivery.height;
      if (Math.abs(sourceRatio - deliveryRatio) / deliveryRatio > 0.02) {
        findings.push({
          code: 'MEDIA_ASPECT_RATIO_MISMATCH',
          severity: 'warning',
          message: `Take aspect ratio ${technical.width}:${technical.height} differs from delivery ${context.delivery.width}:${context.delivery.height}.`,
          evidence: { source: technical, delivery: context.delivery },
        });
      }
      if (
        technical.width < context.delivery.width * 0.5 ||
        technical.height < context.delivery.height * 0.5
      ) {
        findings.push({
          code: 'MEDIA_RESOLUTION_LOW',
          severity: 'warning',
          message: 'Take resolution is below half of the delivery resolution.',
          evidence: { source: technical, delivery: context.delivery },
        });
      }
    }
    if (technical.durationUs) {
      const driftUs = Math.abs(technical.durationUs - context.shot.duration_us);
      if (driftUs > Math.max(100_000, context.shot.duration_us * 0.05)) {
        findings.push({
          code: 'MEDIA_DURATION_MISMATCH',
          severity: 'warning',
          message: 'Take duration differs from the authored Shot duration.',
          pointer: '/duration_us',
          evidence: {
            expectedDurationUs: context.shot.duration_us,
            actualDurationUs: technical.durationUs,
            timeRangeUs: {
              startUs: Math.min(context.shot.duration_us, technical.durationUs),
              endUs: Math.max(context.shot.duration_us, technical.durationUs),
            },
          },
        });
      }
    }
    const score = Math.max(0, 1 - findings.length * 0.15);
    return Promise.resolve({ evaluator: this.id, score, findings });
  }
}

export type CharacterSimilarityPort = {
  compare(input: {
    characterId: string;
    referenceObjectUris: string[];
    candidateObjectUri: string;
    signal?: AbortSignal;
  }): Promise<{ score: number; evidence: Array<Record<string, unknown>> }>;
};

export type EvaluationSnapshot = {
  id: string;
  status: 'passed' | 'warning' | 'failed';
  score?: number;
  findings: Array<Record<string, unknown>>;
};

export function compareEvaluationRuns(
  baseline: EvaluationSnapshot | undefined,
  candidate: EvaluationSnapshot,
): { regressed: boolean; scoreDelta?: number; newFindingCodes: string[] } {
  if (!baseline) return { regressed: false, newFindingCodes: [] };
  const rank = { passed: 0, warning: 1, failed: 2 } as const;
  const baselineCodes = new Set(
    baseline.findings.flatMap((finding) =>
      typeof finding.code === 'string' ? [finding.code] : [],
    ),
  );
  const newFindingCodes = candidate.findings.flatMap((finding) =>
    typeof finding.code === 'string' && !baselineCodes.has(finding.code) ? [finding.code] : [],
  );
  const scoreDelta =
    baseline.score === undefined || candidate.score === undefined
      ? undefined
      : candidate.score - baseline.score;
  return {
    regressed:
      rank[candidate.status] > rank[baseline.status] ||
      (scoreDelta !== undefined && scoreDelta < -0.05),
    ...(scoreDelta === undefined ? {} : { scoreDelta }),
    newFindingCodes,
  };
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
