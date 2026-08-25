import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import type {
  GenerateTextRequest,
  GenerateTextResult,
  ModelProvider,
  ProviderCapability,
} from '@openmovie/provider-gateway';
import { z } from 'zod';

export const PLUGIN_API_VERSION = '0.1.0' as const;

export const pluginManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^plugin\.[a-z][a-z0-9_.-]{2,100}$/),
  name: z.string().trim().min(1).max(100),
  apiVersion: z.literal(PLUGIN_API_VERSION),
  entry: z.string().trim().min(1).max(500),
  capabilities: z.array(z.literal('text.generate')).min(1),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(120_000),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

const pluginResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.string(),
  result: z
    .object({
      text: z.string(),
      model: z.string(),
      finishReason: z.string(),
      usage: z
        .object({
          inputTokens: z.number().int().nonnegative().optional(),
          outputTokens: z.number().int().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export type LoadedDevelopmentPlugin = {
  manifest: PluginManifest;
  provider: ModelProvider;
};

export async function loadDevelopmentPlugin(
  manifestPath: string,
): Promise<LoadedDevelopmentPlugin> {
  const absoluteManifest = resolve(manifestPath);
  const root = dirname(absoluteManifest);
  const manifest = pluginManifestSchema.parse(JSON.parse(await readFile(absoluteManifest, 'utf8')));
  const entry = resolve(root, manifest.entry);
  const entryRelative = relative(root, entry);
  if (!entryRelative || entryRelative.startsWith('..') || /^[a-zA-Z]:/.test(entryRelative)) {
    throw new Error('Plugin entry must be a file inside its manifest directory');
  }
  if (!(await stat(entry)).isFile()) throw new Error('Plugin entry is not a file');
  return { manifest, provider: new DevelopmentProcessPluginProvider(manifest, root, entry) };
}

class DevelopmentProcessPluginProvider implements ModelProvider {
  readonly capabilities: ReadonlySet<ProviderCapability>;

  constructor(
    private readonly manifest: PluginManifest,
    private readonly root: string,
    private readonly entry: string,
  ) {
    this.capabilities = new Set(manifest.capabilities);
  }

  get id(): string {
    return this.manifest.id;
  }

  generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const { signal, ...params } = request;
    return this.call('provider.generate_text', params, signal);
  }

  private call(method: string, params: unknown, signal?: AbortSignal): Promise<GenerateTextResult> {
    return new Promise((resolveResult, reject) => {
      const id = `plugin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const child = spawn(process.execPath, [this.entry], {
        cwd: this.root,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: developmentPluginEnvironment(this.manifest.id),
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (error?: Error, result?: GenerateTextResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        child.kill();
        if (error) reject(error);
        else if (result) resolveResult(result);
      };
      const timer = setTimeout(
        () => finish(new Error(`Plugin timed out: ${this.manifest.id}`)),
        this.manifest.timeoutMs,
      );
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.length > 1024 * 1024) finish(new Error('Plugin output exceeds 1 MiB'));
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 8_000) stderr += chunk.toString();
      });
      child.once('error', (error) => finish(error));
      child.once('exit', (code, signal) => {
        if (settled) return;
        if (code !== 0) {
          finish(
            new Error(
              `Plugin exited (${code ?? signal ?? 'unknown'}): ${stderr || 'no diagnostic'}`,
            ),
          );
          return;
        }
        try {
          const line = stdout
            .split(/\r?\n/)
            .map((item) => item.trim())
            .find(Boolean);
          if (!line) throw new Error('Plugin returned no response');
          const response = pluginResponseSchema.parse(JSON.parse(line));
          if (response.id !== id) throw new Error('Plugin response ID mismatch');
          if (response.error)
            throw new Error(`Plugin ${response.error.code}: ${response.error.message}`);
          if (!response.result) throw new Error('Plugin response has no result');
          finish(undefined, {
            text: response.result.text,
            model: response.result.model,
            finishReason: response.result.finishReason,
            ...(response.result.usage
              ? {
                  usage: {
                    ...(response.result.usage.inputTokens === undefined
                      ? {}
                      : { inputTokens: response.result.usage.inputTokens }),
                    ...(response.result.usage.outputTokens === undefined
                      ? {}
                      : { outputTokens: response.result.usage.outputTokens }),
                  },
                }
              : {}),
          });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
      const onAbort = (): void => finish(new DOMException('Cancelled', 'AbortError'));
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
}

function developmentPluginEnvironment(pluginId: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { OPENMOVIE_PLUGIN_ID: pluginId };
  for (const name of ['PATH', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP'] as const) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}
