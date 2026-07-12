/**
 * Static model catalog — the single source of truth for which models exist,
 * which provider they belong to, and which harness can run them.
 *
 * Read-only at runtime; updates are code changes. This keeps the catalog
 * simple, auditable, and always in sync with the code that consumes it.
 *
 * Model identities are compound strings: `provider:model` (2-part) or
 * `harness:provider:model` (3-part, for per-harness dispatch).
 */
import type { HarnessDef, IntelligenceLevel, ModelEntry, ModelProvider, ModelTier, ProviderGroup } from './schema.js';

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/** Well-known harness ids — used to strip the harness prefix from 3-part model strings. */
const HARNESS_IDS = new Set(['claude-code', 'claude-cli', 'codex', 'codex-cli']);
const AI_SERVICES = new Set([
  'anthropic',
  'deepseek',
  'moonshot',
  'zai',
  'qwen',
  'xiaomi',
  'ollama',
  'openai',
  'xai',
]);

/**
 * Parse a model identity string.
 * Accepts 2-part `provider:model` or 3-part `harness:provider:model`.
 * Returns `{ provider, model }` — provider defaults to `'anthropic'` for raw strings.
 */
export const parseModelId = (value: string): { provider: ModelProvider; model: string } => {
  const parts = value.split(':');

  // 3-part: harness:provider:model — strip the harness
  if (parts.length >= 3) {
    const [maybeHarness, maybeProvider, ...rest] = parts;
    if (
      HARNESS_IDS.has(maybeHarness!) &&
      AI_SERVICES.has(maybeProvider!)
    ) {
      return { provider: maybeProvider as ModelProvider, model: rest.join(':') };
    }
  }

  // 2-part: provider:model
  if (parts.length >= 2) {
    const idx = value.indexOf(':');
    const prefix = value.slice(0, idx);
    const model = value.slice(idx + 1);
    if (AI_SERVICES.has(prefix)) {
      return { provider: prefix as ModelProvider, model };
    }
  }

  // Raw model string (backward compatible) — default to anthropic
  return { provider: 'anthropic', model: value };
};

/**
 * Parse a full model selection including the harness prefix.
 * 3-part: `harness:provider:model`, 2-part: `provider:model` (defaults harness to `claude-cli`).
 */
export const parseModelSelection = (
  value: string,
): { harness: string; provider: ModelProvider; model: string } => {
  const parts = value.split(':');
  const harness = parts.length >= 3 && HARNESS_IDS.has(parts[0]!) ? parts[0]! : 'claude-cli';
  const { provider, model } = parseModelId(value);
  return { harness, provider, model };
};

// ---------------------------------------------------------------------------
// Harness definitions — which harness supports which providers
// ---------------------------------------------------------------------------

export const HARNESSES: readonly HarnessDef[] = [
  {
    id: 'claude-code',
    supportedProviders: [
      'anthropic',
      'deepseek',
      'moonshot',
      'zai',
      'qwen',
      'xiaomi',
      'ollama',
    ],
  },
  { id: 'codex', supportedProviders: ['openai', 'xai'] },
];

export const DEFAULT_HARNESS_ID = 'claude-cli';

/** Find the harness definition by id. */
export const getHarnessDef = (id: string): HarnessDef | undefined =>
  HARNESSES.find((h) => h.id === id || `${h.id}-cli` === id);

/** Map a provider to its default harness id. */
export const getHarnessForProvider = (provider: ModelProvider): string => {
  for (const harness of HARNESSES) {
    if ((harness.supportedProviders as readonly string[]).includes(provider)) {
      return harness.id === 'claude-code' ? 'claude-cli' : 'codex-cli';
    }
  }
  return DEFAULT_HARNESS_ID;
};

/** Map a harness id to a best-guess provider for status checks. */
export const getProviderForHarness = (harness: string): ModelProvider | undefined => {
  if (harness === 'claude-cli' || harness.startsWith('claude-code')) return 'anthropic';
  if (harness === 'codex-cli' || harness.startsWith('codex')) return 'openai';
  return undefined;
};

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

/** Minimum intelligence level required for each tier. */
export const TIER_MIN_INTELLIGENCE: Record<ModelTier, IntelligenceLevel> = {
  reasoning: 4,
  standard: 3,
  fast: 2,
  micro: 1,
};

/** 2-part fallback model IDs per tier. */
export const TIER_FALLBACK_MODEL_ID: Record<ModelTier, string> = {
  reasoning: 'anthropic:claude-opus-4-8',
  standard: 'anthropic:claude-sonnet-5',
  fast: 'anthropic:claude-sonnet-5',
  micro: 'anthropic:claude-haiku-4-5-20251001',
};

// ---------------------------------------------------------------------------
// Effort support — which models accept reasoning effort, and the ladder
// to walk down when the requested level isn't supported.
// ---------------------------------------------------------------------------

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Ascending intensity ladder — used to walk a requested effort down to a supported one. */
export const EFFORT_ORDER: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Per-model effort support, keyed by `provider:model` (2-part). Missing or empty → model doesn't accept effort. */
export const MODEL_EFFORT_SUPPORT: Record<string, readonly EffortLevel[]> = {
  'anthropic:claude-fable-5': ['low', 'medium', 'high', 'xhigh', 'max'],
  'anthropic:claude-opus-4-8': ['low', 'medium', 'high', 'xhigh', 'max'],
  'anthropic:claude-opus-4-7': ['low', 'medium', 'high', 'xhigh', 'max'],
  'anthropic:claude-sonnet-5': ['low', 'medium', 'high', 'max'],
  'anthropic:claude-haiku-4-5-20251001': [],
  'openai:gpt-5.6-sol': ['low', 'medium', 'high', 'xhigh', 'max'],
  'openai:gpt-5.6-terra': ['low', 'medium', 'high', 'xhigh', 'max'],
  'openai:gpt-5.6-luna': ['low', 'medium', 'high', 'xhigh', 'max'],
  'openai:gpt-5.5': ['low', 'medium', 'high', 'xhigh'],
  'openai:gpt-5.4': ['low', 'medium', 'high', 'xhigh'],
  'openai:gpt-5.4-mini': ['low', 'medium', 'high', 'xhigh'],
  'xai:grok-4.5': ['low', 'medium', 'high'],
};

/**
 * Clamp a requested effort level to what the resolved model actually supports.
 * Walks down from the requested level to the highest supported. Returns
 * undefined when the model accepts no effort at all.
 */
export const clampEffortForModel = (
  requested: EffortLevel,
  resolvedModel: string,
): EffortLevel | undefined => {
  const { provider, model } = parseModelId(resolvedModel);
  const supported = MODEL_EFFORT_SUPPORT[`${provider}:${model}`];
  if (!supported || supported.length === 0) return undefined;
  if ((supported as readonly string[]).includes(requested)) return requested;
  const idx = EFFORT_ORDER.indexOf(requested);
  for (let i = idx - 1; i >= 0; i--) {
    if ((supported as readonly string[]).includes(EFFORT_ORDER[i]!)) return EFFORT_ORDER[i];
  }
  return undefined;
};

/** Get the supported effort levels for a model. Empty array = no effort support. */
export const getModelEffortLevels = (modelValue: string): readonly EffortLevel[] => {
  const { provider, model } = parseModelId(modelValue);
  return MODEL_EFFORT_SUPPORT[`${provider}:${model}`] ?? [];
};

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

export const MODEL_PROVIDERS: readonly ProviderGroup[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic',
    models: [
      { label: 'Claude Fable 5', value: 'anthropic:claude-fable-5', intelligence: 4 },
      { label: 'Claude Opus 4.8', value: 'anthropic:claude-opus-4-8', intelligence: 4 },
      { label: 'Claude Opus 4.7', value: 'anthropic:claude-opus-4-7', intelligence: 4 },
      { label: 'Claude Sonnet 5', value: 'anthropic:claude-sonnet-5', intelligence: 3 },
      { label: 'Claude Haiku 4.5', value: 'anthropic:claude-haiku-4-5-20251001', intelligence: 2 },
    ],
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    models: [
      { label: 'DeepSeek V4 Pro', value: 'deepseek:deepseek-v4-pro', intelligence: 4 },
      { label: 'DeepSeek V4 Flash', value: 'deepseek:deepseek-v4-flash', intelligence: 3 },
    ],
  },
  {
    provider: 'moonshot',
    label: 'Moonshot (Kimi)',
    models: [
      { label: 'Kimi K2.6', value: 'moonshot:kimi-k2.6', intelligence: 4 },
      { label: 'Kimi K2.5', value: 'moonshot:kimi-k2.5', intelligence: 4 },
    ],
  },
  {
    provider: 'zai',
    label: 'Z.ai (GLM)',
    models: [
      { label: 'GLM 5.2', value: 'zai:glm-5.2', intelligence: 4 },
      { label: 'GLM 5.1', value: 'zai:glm-5.1', intelligence: 4 },
      { label: 'GLM 5', value: 'zai:glm-5', intelligence: 4 },
      { label: 'GLM 5 Turbo', value: 'zai:glm-5-turbo', intelligence: 3 },
      { label: 'GLM 4.7', value: 'zai:glm-4.7', intelligence: 4 },
      { label: 'GLM 4.6', value: 'zai:glm-4.6', intelligence: 4 },
      { label: 'GLM 4.6V', value: 'zai:glm-4.6v', intelligence: 3 },
      { label: 'GLM 4.5 Air', value: 'zai:glm-4.5-air', intelligence: 2 },
    ],
  },
  {
    provider: 'qwen',
    label: 'Qwen (Alibaba Cloud)',
    models: [
      { label: 'Qwen3.7 Max', value: 'qwen:qwen3.7-max', intelligence: 4 },
      { label: 'Qwen3.7 Plus', value: 'qwen:qwen3.7-plus', intelligence: 4 },
      { label: 'Qwen3 Coder Plus', value: 'qwen:qwen3-coder-plus', intelligence: 4 },
      { label: 'Qwen3 Coder Next', value: 'qwen:qwen3-coder-next', intelligence: 3 },
      { label: 'Qwen3 Coder Flash', value: 'qwen:qwen3-coder-flash', intelligence: 2 },
    ],
  },
  {
    provider: 'xiaomi',
    label: 'Xiaomi (MiMo)',
    models: [
      { label: 'MiMo V2.5 Pro', value: 'xiaomi:mimo-v2.5-pro', intelligence: 4 },
      { label: 'MiMo V2 Flash', value: 'xiaomi:mimo-v2-flash', intelligence: 3 },
    ],
  },
  {
    provider: 'ollama',
    label: 'Ollama (Local)',
    models: [
      { label: 'Qwen3 Coder Next', value: 'ollama:qwen3-coder-next', intelligence: 3 },
      { label: 'Qwen3.6 27B', value: 'ollama:qwen3.6:27b', intelligence: 2 },
      { label: 'Qwen3 Coder', value: 'ollama:qwen3-coder', intelligence: 2 },
      { label: 'GLM 4.7', value: 'ollama:glm-4.7', intelligence: 2 },
      { label: 'DeepSeek Coder', value: 'ollama:deepseek-coder', intelligence: 1 },
      { label: 'Qwen 3.5 9B', value: 'ollama:qwen3.5:9b', intelligence: 1 },
    ],
  },
  {
    provider: 'openai',
    label: 'OpenAI (via Codex)',
    models: [
      { label: 'GPT-5.6 Sol', value: 'openai:gpt-5.6-sol', intelligence: 4 },
      { label: 'GPT-5.6 Terra', value: 'openai:gpt-5.6-terra', intelligence: 3 },
      { label: 'GPT-5.6 Luna', value: 'openai:gpt-5.6-luna', intelligence: 2 },
      { label: 'GPT-5.5', value: 'openai:gpt-5.5', intelligence: 4 },
      { label: 'GPT-5.4', value: 'openai:gpt-5.4', intelligence: 3 },
      { label: 'GPT-5.4 Mini', value: 'openai:gpt-5.4-mini', intelligence: 2 },
    ],
  },
  {
    provider: 'xai',
    label: 'xAI',
    models: [{ label: 'Grok 4.5', value: 'xai:grok-4.5', intelligence: 4 }],
  },
];

/** Look up a model's catalog intelligence level. Returns undefined for uncatalogued models. */
export const getModelIntelligence = (modelValue: string): IntelligenceLevel | undefined => {
  const { provider, model } = parseModelId(modelValue);
  const group = MODEL_PROVIDERS.find((g) => g.provider === provider);
  return group?.models.find((m) => parseModelId(m.value).model === model)?.intelligence;
};

/** Check whether a model meets a tier's minimum intelligence floor. Uncatalogued models fail closed. */
export const modelMeetsTierFloor = (modelValue: string, tier: ModelTier): boolean => {
  const intelligence = getModelIntelligence(modelValue);
  if (intelligence === undefined) return false;
  return intelligence >= TIER_MIN_INTELLIGENCE[tier];
};

/** Precomputed map from canonical `provider:model` → label for O(1) lookup. */
const MODEL_LABEL_MAP = new Map(
  MODEL_PROVIDERS.flatMap((g) => g.models).map((m) => {
    const { provider, model } = parseModelId(m.value);
    return [`${provider}:${model}`, m.label];
  }),
);

/** Look up the human-readable label for a compound model value. Returns the raw value if uncatalogued. */
export const getModelLabel = (value: string): string => {
  const { provider, model } = parseModelId(value);
  return MODEL_LABEL_MAP.get(`${provider}:${model}`) ?? value;
};
