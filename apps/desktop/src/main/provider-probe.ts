import type { ProviderProfile } from './secret-store.js';

export type ProviderProbe = {
  profileId: string;
  status: 'ready' | 'error';
  latencyMs: number;
  checkedAt: string;
  message: string;
  capabilities: string[];
  modelVisible?: boolean;
};

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export async function probeProvider(
  profile: ProviderProfile,
  apiKey: string,
  fetcher: Fetcher,
): Promise<ProviderProbe> {
  const startedAt = Date.now();
  const capabilities =
    profile.protocol === 'openai_chat'
      ? ['text.generate', 'image.understand']
      : profile.protocol === 'openai_responses'
        ? ['text.generate', 'image.understand']
        : profile.protocol === 'openai_images'
          ? ['image.generate']
          : profile.protocol === 'http_video_jobs'
            ? ['video.generate']
            : [];
  try {
    const base = profile.baseUrl.endsWith('/') ? profile.baseUrl : `${profile.baseUrl}/`;
    const isOpenAICompatible =
      profile.protocol === 'openai_chat' ||
      profile.protocol === 'openai_responses' ||
      profile.protocol === 'openai_images';
    const endpoint = isOpenAICompatible ? new URL('models', base) : new URL(base);
    const response = await fetcher(endpoint.toString(), {
      method: profile.protocol === 'http_video_jobs' ? 'HEAD' : 'GET',
      redirect: 'manual',
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    let modelVisible: boolean | undefined;
    if (isOpenAICompatible) {
      const body = (await response.json()) as { data?: Array<{ id?: string }> };
      modelVisible = body.data?.some((item) => item.id === profile.model) ?? false;
    }
    return {
      profileId: profile.id,
      status: 'ready',
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      message:
        modelVisible === false
          ? 'Connected, but the configured model was not listed by the Provider.'
          : 'Connection and credential check passed.',
      capabilities,
      ...(modelVisible === undefined ? {} : { modelVisible }),
    };
  } catch (error) {
    const message =
      error instanceof Error && /^Provider returned HTTP \d{3}$/.test(error.message)
        ? error.message
        : 'Connection failed or timed out.';
    return {
      profileId: profile.id,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      message,
      capabilities,
    };
  }
}
