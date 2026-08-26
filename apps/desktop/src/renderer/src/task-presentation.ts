import type { Task } from '@openmovie/contracts';

import type { UiLocale } from './i18n.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function summaryFromText(value: string): string {
  const trimmed = value.trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  const candidates = [
    trimmed,
    firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : '',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = record(JSON.parse(candidate));
      if (typeof parsed?.summary === 'string' && parsed.summary.trim()) {
        return parsed.summary.trim();
      }
    } catch {
      // A normal conversational response is not JSON.
    }
  }
  return trimmed;
}

export function taskResponseText(task: Task, locale: UiLocale): string | undefined {
  if (task.status !== 'succeeded') return undefined;

  const proposalOutput = record(
    task.steps.find((step) => step.kind === 'proposal.create_from_plan')?.output,
  );
  if (typeof proposalOutput?.summary === 'string' && proposalOutput.summary.trim()) {
    return summaryFromText(proposalOutput.summary);
  }

  const generatedText = record(
    task.steps.find((step) => step.kind === 'text.generate')?.output,
  )?.text;
  if (typeof generatedText === 'string' && generatedText.trim()) {
    return summaryFromText(generatedText);
  }

  if (task.steps.some((step) => step.kind === 'image.generate')) {
    return locale === 'zh-CN'
      ? '图片已生成，并已保存到右侧资源区。'
      : 'The image is ready and saved in Resources on the right.';
  }
  if (task.steps.some((step) => step.kind === 'video.generate')) {
    return locale === 'zh-CN'
      ? '视频已生成，并已保存到右侧资源区。'
      : 'The video is ready and saved in Resources on the right.';
  }
  if (task.steps.some((step) => step.kind === 'media.analyze')) {
    return locale === 'zh-CN' ? '媒体分析已完成。' : 'Media analysis is complete.';
  }
  if (task.steps.some((step) => step.kind === 'timeline.render')) {
    return locale === 'zh-CN' ? '成片已渲染完成。' : 'The current cut has finished rendering.';
  }
  return locale === 'zh-CN' ? '任务已完成。' : 'The task is complete.';
}

export function visibleExecutionSteps(task: Task): Task['steps'] {
  return task.steps.filter(
    (step) => step.kind !== 'text.generate' && step.kind !== 'proposal.create_from_plan',
  );
}
