import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateText, generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure .env is loaded
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

// Reference Quota Limits
export const QUOTA_LIMITS = {
  'gemini-3.1-flash-lite': { rpm: 15, rpd: 1000, provider: 'google' },
  'gemma-4-31b-it': { rpm: 30, rpd: 1000, provider: 'google' },
  'openai/gpt-oss-120b': { rpm: 30, rpd: 1000, provider: 'groq' },
};

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// In-Memory Quota Tracker
class QuotaTracker {
  constructor() {
    this.models = {};
    for (const [model, limits] of Object.entries(QUOTA_LIMITS)) {
      this.models[model] = {
        provider: limits.provider,
        rpmLimit: limits.rpm,
        rpdLimit: limits.rpd,
        timestamps: [],
        currentDate: getTodayString(),
        rpd: 0,
        totalRequests: 0,
        failedRequests: 0,
        lastUsed: null,
      };
    }
  }

  cleanOldTimestamps(modelState) {
    const cutoff = Date.now() - 60000;
    modelState.timestamps = modelState.timestamps.filter((t) => t > cutoff);
  }

  checkDayRollover(modelState) {
    const today = getTodayString();
    if (modelState.currentDate !== today) {
      modelState.currentDate = today;
      modelState.rpd = 0;
    }
  }

  ensureModel(modelName) {
    if (!this.models[modelName]) {
      const isGroq = modelName.includes('gpt') || modelName.includes('llama') || modelName.includes('oss');
      this.models[modelName] = {
        provider: isGroq ? 'groq' : 'google',
        rpmLimit: 30,
        rpdLimit: 1000,
        timestamps: [],
        currentDate: getTodayString(),
        rpd: 0,
        totalRequests: 0,
        failedRequests: 0,
        lastUsed: null,
      };
    }
    return this.models[modelName];
  }

  recordRequest(modelName) {
    const state = this.ensureModel(modelName);
    const now = Date.now();
    this.cleanOldTimestamps(state);
    this.checkDayRollover(state);

    state.timestamps.push(now);
    state.rpd += 1;
    state.totalRequests += 1;
    state.lastUsed = now;
  }

  recordFailure(modelName) {
    const state = this.ensureModel(modelName);
    state.failedRequests += 1;
  }

  getStats(specificModel = null) {
    const today = getTodayString();
    const stats = {};
    for (const [name, state] of Object.entries(this.models)) {
      this.cleanOldTimestamps(state);
      this.checkDayRollover(state);
      stats[name] = {
        provider: state.provider,
        rpm: state.timestamps.length,
        rpmLimit: state.rpmLimit,
        rpd: state.rpd,
        rpdLimit: state.rpdLimit,
        totalRequests: state.totalRequests,
        failedRequests: state.failedRequests,
        lastUsed: state.lastUsed,
      };
    }

    if (specificModel) {
      return (
        stats[specificModel] || {
          model: specificModel,
          rpm: 0,
          rpmLimit: 30,
          rpd: 0,
          rpdLimit: 1000,
          totalRequests: 0,
          failedRequests: 0,
          lastUsed: null,
        }
      );
    }

    return {
      timestamp: Date.now(),
      date: today,
      models: stats,
    };
  }
}

const quotaTracker = new QuotaTracker();

// Socket.io instance registry for live broadcasting
let socketIoInstance = null;

export function registerSocketIo(io) {
  socketIoInstance = io;
  console.log('[llmClient] Socket.IO instance successfully registered for live AI quota broadcasting.');
}

export function getQuotaStats(modelName = null) {
  return quotaTracker.getStats(modelName);
}

function broadcastQuotaUpdate(eventData) {
  if (!socketIoInstance) return;
  try {
    socketIoInstance.emit('ai_quota_status', {
      ...eventData,
      quotaStats: quotaTracker.getStats(),
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error('[llmClient] Error broadcasting ai_quota_status:', err.message);
  }
}

function getGoogleApiKey(override) {
  return (
    override ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ''
  ).trim();
}

function getGroqApiKey(override) {
  return (
    override ||
    process.env.GROQ_API_KEY ||
    process.env.GROQ_AI_API ||
    ''
  ).trim();
}

/**
 * Translates low-level errors (429, 503, Timeout, Auth) into friendly Arabic messages
 */
export function translateFallbackReason(err) {
  if (!err) return 'فشل غير محدد في السيرفر الأساسي، تم التحويل تلقائياً إلى Groq.';

  const status =
    err.statusCode ||
    err.status ||
    err.lastError?.statusCode ||
    err.lastError?.status;
  const msg = (err.message || String(err)).toLowerCase();

  // Timeout Error
  if (
    err.name === 'TimeoutError' ||
    err.name === 'AbortError' ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('deadline')
  ) {
    return 'انتهت مهلة استجابة سيرفر جوجل (Timeout)، تم التحويل تلقائياً إلى Groq.';
  }

  // Rate Limit / Quota Exceeded (429)
  if (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('resource has been exhausted')
  ) {
    const retryAfter =
      err.responseHeaders?.get?.('retry-after') || err.headers?.['retry-after'];
    const extra = retryAfter ? ` (إعادة المحاولة بعد ${retryAfter} ثانية)` : '';
    return `تم تجاوز حد الكوتة المسموح لسيرفر جوجل (Rate Limit 429)${extra}، تم التحويل تلقائياً إلى Groq.`;
  }

  // Overloaded / Service Unavailable (503)
  if (
    status === 503 ||
    msg.includes('503') ||
    msg.includes('overloaded') ||
    msg.includes('high demand') ||
    msg.includes('unavailable')
  ) {
    return 'سيرفر جوجل مزدحم حالياً (503 Service Unavailable)، تم التحويل تلقائياً إلى Groq.';
  }

  // Auth / Key Invalid (400 / 401 / 403)
  if (
    status === 401 ||
    status === 403 ||
    status === 400 ||
    msg.includes('api_key') ||
    msg.includes('invalid') ||
    msg.includes('unauthorized') ||
    msg.includes('key not valid') ||
    msg.includes('permission')
  ) {
    return 'مفتاح Google غير صالح أو غير مصرح به، تم التحويل تلقائياً إلى Groq.';
  }

  return `حدث خطأ في خادم جوجل (${err.message || status})، تم التحويل تلقائياً إلى Groq.`;
}

function getModelInstance(modelName, provider, options = {}) {
  if (provider === 'google') {
    const apiKey = getGoogleApiKey(options.googleApiKeyOverride);
    const google = createGoogleGenerativeAI({ apiKey });
    return google(modelName);
  } else if (provider === 'groq') {
    const apiKey = getGroqApiKey(options.groqApiKeyOverride);
    const groq = createGroq({ apiKey });
    return groq(modelName);
  }
  throw new Error(`مزود غير مدعوم: ${provider}`);
}

/**
 * Universal Fault-Tolerant Execution Kernel with Instant Failover
 */
export async function executeWithFallback(operationFn, options = {}) {
  const primaryModel = options.primaryModel || 'gemini-3.1-flash-lite';
  const fallbackModel = 'openai/gpt-oss-120b';

  const candidates = [
    { modelName: primaryModel, provider: 'google' },
    ...(primaryModel !== fallbackModel ? [{ modelName: fallbackModel, provider: 'groq' }] : []),
  ];

  let fallbackTriggered = false;
  let fallbackReason = null;
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const isFallback = i > 0;
    const timeoutMs = options.timeoutMs || 6000;
    const t0 = Date.now();

    try {
      const modelInstance = getModelInstance(candidate.modelName, candidate.provider, options);
      const signal = AbortSignal.timeout(timeoutMs);

      const result = await operationFn({
        model: modelInstance,
        modelName: candidate.modelName,
        provider: candidate.provider,
        signal,
        timeoutMs,
        isFallback,
      });

      const latencyMs = Date.now() - t0;
      quotaTracker.recordRequest(candidate.modelName);

      const meta = {
        modelUsed: candidate.modelName,
        provider: candidate.provider,
        fallbackTriggered,
        fallbackReason,
        latencyMs,
        quota: quotaTracker.getStats(candidate.modelName),
      };

      broadcastQuotaUpdate({
        type: 'ai_request_success',
        meta,
      });

      return { result, meta };
    } catch (err) {
      lastError = err;
      quotaTracker.recordFailure(candidate.modelName);

      if (i < candidates.length - 1) {
        fallbackTriggered = true;
        fallbackReason = translateFallbackReason(err);
        console.warn(
          `[llmClient] ⚠️ فشل الموديل الأساسي (${candidate.modelName}): ${err.message}\n` +
          `   ↪ سبب التحويل: ${fallbackReason}\n` +
          `   ↪ الانتقال الفوري إلى الموديل الاحتياطي: ${candidates[i + 1].modelName}`
        );

        broadcastQuotaUpdate({
          type: 'ai_fallback_triggered',
          failedModel: candidate.modelName,
          nextModel: candidates[i + 1].modelName,
          reason: fallbackReason,
        });

        continue;
      }
    }
  }

  throw lastError;
}

/**
 * generateText with Fallback, Timeout and Quota tracking
 */
export async function generateTextWithFallback({
  prompt,
  messages,
  system,
  tools,
  maxSteps,
  temperature,
  primaryModel,
  timeoutMs = 6000,
  googleApiKeyOverride,
  groqApiKeyOverride,
  ...extra
}) {
  return executeWithFallback(
    async ({ model, signal }) => {
      const callParams = {
        model,
        abortSignal: signal,
        maxRetries: 0,
        ...extra,
      };

      if (prompt !== undefined) callParams.prompt = prompt;
      if (messages !== undefined) callParams.messages = messages;
      if (system !== undefined) callParams.system = system;
      if (tools !== undefined) callParams.tools = tools;
      if (maxSteps !== undefined) callParams.maxSteps = maxSteps;
      if (temperature !== undefined) callParams.temperature = temperature;

      return await generateText(callParams);
    },
    { primaryModel, timeoutMs, googleApiKeyOverride, groqApiKeyOverride }
  );
}

/**
 * generateObject with Fallback, Timeout and Quota tracking
 */
export async function generateObjectWithFallback({
  prompt,
  messages,
  system,
  schema,
  temperature,
  primaryModel,
  timeoutMs = 6000,
  googleApiKeyOverride,
  groqApiKeyOverride,
  ...extra
}) {
  return executeWithFallback(
    async ({ model, signal }) => {
      const callParams = {
        model,
        schema,
        abortSignal: signal,
        maxRetries: 0,
        ...extra,
      };

      if (prompt !== undefined) callParams.prompt = prompt;
      if (messages !== undefined) callParams.messages = messages;
      if (system !== undefined) callParams.system = system;
      if (temperature !== undefined) callParams.temperature = temperature;

      return await generateObject(callParams);
    },
    { primaryModel, timeoutMs, googleApiKeyOverride, groqApiKeyOverride }
  );
}
