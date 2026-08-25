import { describe, expect, it } from 'vitest';

import {
  ClaudeCodeDetector,
  claudePlanningArguments,
  parseClaudeJsonOutput,
} from './codex-adapter.js';

describe('Claude Code planning adapter', () => {
  it('normalizes validated structured output without exposing the raw envelope', () => {
    expect(
      parseClaudeJsonOutput(
        JSON.stringify({
          type: 'result',
          session_id: 'session_test',
          total_cost_usd: 0.004,
          structured_output: {
            summary: 'Tighten the shot',
            actions: [{ type: 'shot.update', shot_id: 'shot_test', framing: 'close-up' }],
          },
        }),
      ),
    ).toEqual({
      text: JSON.stringify({
        summary: 'Tighten the shot',
        actions: [{ type: 'shot.update', shot_id: 'shot_test', framing: 'close-up' }],
      }),
      sessionId: 'session_test',
      costUsd: 0.004,
    });
  });

  it('starts a non-persistent, read-only, structured print-mode turn', () => {
    const argumentsValue = claudePlanningArguments();
    expect(argumentsValue).toEqual(
      expect.arrayContaining([
        '-p',
        '--bare',
        '--permission-mode',
        'plan',
        '--tools',
        'Read,Glob,Grep',
        '--no-session-persistence',
        '--json-schema',
      ]),
    );
    expect(argumentsValue).not.toContain('--dangerously-skip-permissions');
  });

  it('rejects malformed or unsuccessful CLI output', () => {
    expect(() => parseClaudeJsonOutput('not json')).toThrow(/invalid JSON/);
    expect(() => parseClaudeJsonOutput(JSON.stringify({ is_error: true }))).toThrow(/unsuccessful/);
  });

  it('passes the goal through stdin and normalizes a real child-process result', async () => {
    const adapter = new ClaudeCodeDetector(process.execPath, [
      '-e',
      [
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { input += chunk; });",
        "process.stdin.on('end', () => process.stdout.write(JSON.stringify({",
        'structured_output: { summary: input, actions: [] },',
        "session_id: 'session_fixture'",
        '})));',
      ].join(''),
      '--',
    ]);

    await expect(
      adapter.runTurn({ cwd: process.cwd(), text: 'Create a quiet opening scene' }),
    ).resolves.toEqual({
      text: JSON.stringify({ summary: 'Create a quiet opening scene', actions: [] }),
      sessionId: 'session_fixture',
    });
  });
});
