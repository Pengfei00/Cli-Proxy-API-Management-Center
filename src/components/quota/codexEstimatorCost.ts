import type {
  CodexEstimatorCostModelLine,
  CodexEstimatorCostWindow,
  CodexQuotaEstimatorWindow,
} from '@/types';
import { normalizeAuthIndex, type ModelPrice, type UsageDetail } from '@/utils/usage';

const TOKENS_PER_PRICE_UNIT = 1_000_000;

export interface BuildCodexEstimatorCostWindowOptions {
  authIndex: string | number | null | undefined;
  window: CodexQuotaEstimatorWindow;
  usageDetails: UsageDetail[];
  modelPrices: Record<string, ModelPrice>;
  nowMs?: number;
}

const toNonNegativeNumber = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(num, 0) : 0;
};

const resolveDetailTimestamp = (detail: UsageDetail): number => {
  if (typeof detail.__timestampMs === 'number' && Number.isFinite(detail.__timestampMs)) {
    return detail.__timestampMs;
  }

  const parsed = Date.parse(detail.timestamp);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const resolvePromptTokens = (detail: UsageDetail): number => {
  const inputTokens = toNonNegativeNumber(detail.tokens.input_tokens);
  const cachedTokens = resolveCachedTokens(detail);
  return Math.max(inputTokens - cachedTokens, 0);
};

const resolveCachedTokens = (detail: UsageDetail): number =>
  Math.max(
    toNonNegativeNumber(detail.tokens.cached_tokens),
    toNonNegativeNumber(detail.tokens.cache_tokens)
  );

const resolveCompletionTokens = (detail: UsageDetail): number =>
  toNonNegativeNumber(detail.tokens.output_tokens);

const buildModelLine = (
  model: string,
  promptTokens: number,
  cachedTokens: number,
  completionTokens: number,
  price: ModelPrice
): CodexEstimatorCostModelLine => {
  const promptPrice = toNonNegativeNumber(price.prompt);
  const cachePrice = toNonNegativeNumber(price.cache);
  const completionPrice = toNonNegativeNumber(price.completion);
  const promptCost = (promptTokens / TOKENS_PER_PRICE_UNIT) * promptPrice;
  const cacheCost = (cachedTokens / TOKENS_PER_PRICE_UNIT) * cachePrice;
  const completionCost = (completionTokens / TOKENS_PER_PRICE_UNIT) * completionPrice;

  return {
    model,
    promptTokens,
    cachedTokens,
    completionTokens,
    promptPrice,
    cachePrice,
    completionPrice,
    promptCost,
    cacheCost,
    completionCost,
    totalCost: promptCost + cacheCost + completionCost,
  };
};

export function buildCodexEstimatorCostWindow({
  authIndex,
  window,
  usageDetails,
  modelPrices,
  nowMs = Date.now(),
}: BuildCodexEstimatorCostWindowOptions): CodexEstimatorCostWindow | null {
  const normalizedAuthIndex = normalizeAuthIndex(authIndex);
  if (!normalizedAuthIndex || !window.currentCycleStartedAt) {
    return null;
  }

  const cycleStartedAtMs = Date.parse(window.currentCycleStartedAt);
  if (!Number.isFinite(cycleStartedAtMs)) {
    return null;
  }

  const modelTokenMap = new Map<
    string,
    { promptTokens: number; cachedTokens: number; completionTokens: number; price: ModelPrice }
  >();
  const missingPriceModels = new Set<string>();

  usageDetails.forEach((detail) => {
    if (normalizeAuthIndex(detail.auth_index) !== normalizedAuthIndex) {
      return;
    }

    const timestampMs = resolveDetailTimestamp(detail);
    if (!Number.isFinite(timestampMs) || timestampMs < cycleStartedAtMs || timestampMs > nowMs) {
      return;
    }

    const modelName = detail.__modelName?.trim();
    if (!modelName) {
      return;
    }

    const price = modelPrices[modelName];
    if (!price) {
      missingPriceModels.add(modelName);
      return;
    }

    const promptTokens = resolvePromptTokens(detail);
    const cachedTokens = resolveCachedTokens(detail);
    const completionTokens = resolveCompletionTokens(detail);
    const current = modelTokenMap.get(modelName);

    if (current) {
      current.promptTokens += promptTokens;
      current.cachedTokens += cachedTokens;
      current.completionTokens += completionTokens;
      return;
    }

    modelTokenMap.set(modelName, {
      promptTokens,
      cachedTokens,
      completionTokens,
      price,
    });
  });

  const modelLines = Array.from(modelTokenMap.entries())
    .map(([model, value]) =>
      buildModelLine(
        model,
        value.promptTokens,
        value.cachedTokens,
        value.completionTokens,
        value.price
      )
    )
    .sort((left, right) => left.model.localeCompare(right.model));

  const usedAmountUsd = modelLines.reduce((sum, line) => sum + line.totalCost, 0);
  const usedPercent = window.usedPercent;
  const estimatedFullAmountUsd =
    usedPercent !== null && usedPercent > 0 ? usedAmountUsd / (usedPercent / 100) : null;

  return {
    windowId: window.id,
    modelLines,
    missingPriceModels: Array.from(missingPriceModels).sort((left, right) =>
      left.localeCompare(right)
    ),
    usedAmountUsd,
    usedPercent,
    estimatedFullAmountUsd,
    hasBillableData: modelLines.length > 0,
  };
}
