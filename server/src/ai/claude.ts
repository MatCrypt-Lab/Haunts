import Anthropic from '@anthropic-ai/sdk';
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Config } from '../config';
import { HttpError } from '../errors';

export type BetaMessage = Anthropic.Beta.BetaMessage;
export type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
export type CreateParams = Omit<MessageCreateParamsNonStreaming, 'model' | 'betas' | 'fallbacks'>;

/** The one door to Claude. Tests inject a fake. */
export type AiModel = {
  model: string;
  create(params: CreateParams): Promise<BetaMessage>;
};

export function createAiModel(config: Config): AiModel | null {
  if (!config.anthropicApiKey) return null;
  const client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2, timeout: 120_000 });
  return {
    model: config.aiModel,
    create: (params) =>
      client.beta.messages.create({
        ...params,
        model: config.aiModel,
        output_config: { effort: config.aiEffort, ...params.output_config },
        // On a safety decline, the API reruns the request on a model chosen for that category.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Tools and the system prompt never change, so they are cached across requests.
        cache_control: { type: 'ephemeral' },
      }),
  };
}

export function aiUnavailable(): HttpError {
  return new HttpError(503, 'ai_disabled', 'The AI companion is not set up on this server.');
}

export function textOf(msg: BetaMessage): string {
  return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

/** One request whose answer must match a JSON schema. */
export async function askJson<T>(
  ai: AiModel,
  opts: { system: string; user: string; schema: Record<string, unknown>; maxTokens?: number },
): Promise<T> {
  const msg = await ai.create({
    max_tokens: opts.maxTokens ?? 4000,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    output_config: { format: { type: 'json_schema', schema: opts.schema } },
  });
  if (msg.stop_reason === 'refusal') throw new HttpError(422, 'ai_refused', 'The AI declined this request.');
  if (msg.stop_reason === 'max_tokens') throw new HttpError(502, 'ai_truncated', 'The AI answer was cut off. Try again.');
  return JSON.parse(textOf(msg)) as T;
}

/** JSON schema helper: an object whose listed properties are all required, nothing extra. */
export function obj(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
export const str = { type: 'string' };
export const int = { type: 'integer' };
export const bool = { type: 'boolean' };
export const arr = (items: unknown) => ({ type: 'array', items });
