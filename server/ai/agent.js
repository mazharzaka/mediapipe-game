import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText, generateText, stepCountIs } from "ai";
import { env, isAiConfigured } from "../config/env.js";
import { aiTools } from "./tools.js";

const SYSTEM_PROMPT = `أنت "مساعد الفرجة والاسترخاء والتحكم الذكي" (AI OS Agent) المدمج في نظام التحكم المساعد (Assistive System).
مهمتك الأساسية هي مساعدة المستخدم في التحكم في الكمبيوتر، تشغيل الفيديوهات والميديا، والتطبيقات بسهولة وسرعة باللغة العربية وباللهجة المصرية الودودة والعملية.

قواعد وتعليمات العمل:
1. تحدث باللغة العربية وباللهجة المصرية الودودة والمهذبة والمختصرة جداً (مثال: "عيوني يا باشا! شغلتلك الفيديو وعليت الصوت 🍿🔊", "تمام يا فندم! فتحتلك يوتيوب", "عليتلك الصوت درجتين", "قفلتهولك خلاص").
2. افهم ونفذ الأوامر المركبة (Compound Commands) بذكاء في نفس الوقت:
   - مثلاً لو المستخدم قال: "شغلي ملخص ماتش وعلي الصوت"، استدعِ أداة playYoutubeVideo لتشغيل الملخص، ثم استدعِ controlMedia بـ action: "volume_up" (مع repeat مناسب لو طلب تعلية واضحة).
   - لو قال: "شغل فيلم أو أغنية واعمل ملء الشاشة"، شغّل الفيديو بـ playYoutubeVideo ثم استدعِ fullscreen.
3. الأدوات الأساسية (صندوق الفرجة والاسترخاء):
   - playYoutubeVideo: للبحث عن أي فيديو أو ملخص أو أغنية أو قرآن على يوتيوب وتشغيله مباشرة في المتصفح.
   - controlMedia: للتحكم الكامل في الصوت والوسائط (volume_up, volume_down, mute, play_pause, fullscreen, close_tab, lock, sleep) مع دعم معامل repeat لتكرار الإجراء (مثلاً repeat: 3 أو 5).
   - controlMagnifier: للتحكم في عدسة ويندوز المكبرة العائمة (Windows Magnifier Lens Mode) للقراءة والتكبير من مسافة بعيدة (أوامر: open لفتح العدسة، close لإغلاقها، zoom_in للتكبير، zoom_out للتصغير، pan_up / pan_down / pan_left / pan_right لتحريكها).
4. الأدوات الأخرى:
   - فتح المواقع: openWebsite
   - فتح البرامج: openApp (المتاح: vscode, chrome, notepad, calculator)
   - فحص الجهاز: getSystemStatus
   - أوامر الطاقة الحساسة: requestPowerAction (تطلب تأكيد المستخدم قبل الإغلاق أو القفل إذا لم يطلب ذلك صراحة).
5. ردودك يجب أن تكون قصيرة جداً ومبهجة وواضحة بدون أي إطالة.`;

function formatMessages(history, prompt) {
  const messages = [];
  if (Array.isArray(history)) {
    for (const msg of history) {
      if (msg && msg.role && msg.content) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: String(msg.content),
        });
      }
    }
  }
  messages.push({ role: "user", content: String(prompt) });
  return messages;
}

export const FALLBACK_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-3-flash-preview",
  "gemini-3.5-flash-lite",
  "gemini-flash-latest",
];

export function isDemandOrQuotaError(err) {
  if (!err) return false;
  const status =
    err.lastError?.statusCode ||
    err.lastError?.status ||
    err.statusCode ||
    err.status;
  if (status === 503 || status === 429) return true;
  const msg = (
    err.lastError?.message ||
    err.message ||
    JSON.stringify(err) ||
    ""
  ).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("high demand") ||
    msg.includes("overloaded") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("resource has been exhausted") ||
    msg.includes("unavailable")
  );
}

export function classifyAiError(error) {
  const errMsg = error?.message || String(error || "");
  const isKeyError =
    /key.*missing|invalid.*key|api_key|API_KEY_INVALID/i.test(errMsg);
  const isDemandError = isDemandOrQuotaError(error);

  if (isKeyError) {
    return {
      code: "API_KEY_INVALID",
      userMessage:
        "مفتاح Google Generative AI غير صالح أو غير مسجل في server/.env.",
      errMsg,
    };
  }
  if (isDemandError) {
    return {
      code: "HIGH_DEMAND",
      userMessage:
        "سيرفرات الذكاء الاصطناعي عليها ضغط مؤقت، تم تجربة البديل أو أعد المحاولة بعد ثوانٍ.",
      errMsg,
    };
  }
  return {
    code: "GENERAL_ERROR",
    userMessage: errMsg,
    errMsg,
  };
}

/**
 * Executes a one-shot generateText AI completion with Google Gemini 3.8 Flash,
 * with automatic fallback to high-availability secondary models if 503/429 occurs.
 */
export async function generateAiResponse({
  prompt,
  history = [],
  model = null,
}) {
  if (!isAiConfigured()) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY_MISSING");
  }

  const google = createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  const primaryModel = model || env.GEMINI_MODEL || "gemini-3.8-flash";
  const candidateModels = [
    primaryModel,
    ...FALLBACK_MODELS.filter((m) => m !== primaryModel),
  ];
  const messages = formatMessages(history, prompt);

  let lastError = null;
  for (const targetModel of candidateModels) {
    try {
      console.log(`[AI Agent] Attempting generateText with model: ${targetModel}`);
      return await generateText({
        model: google(targetModel),
        system: SYSTEM_PROMPT,
        messages,
        tools: aiTools,
        maxSteps: 5,
        stopWhen: stepCountIs(5),
        abortSignal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      lastError = err;
      if (isDemandOrQuotaError(err)) {
        console.warn(
          `[AI Agent] Model ${targetModel} hit high demand / rate limit (503/429). Transitioning to fallback model...`
        );
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * Initializes and returns a streamText execution with Gemini 3.8 Flash and maxSteps: 5
 */
export function streamAiResponse({
  prompt,
  history = [],
  onError = null,
  model = null,
}) {
  if (!isAiConfigured()) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY_MISSING");
  }

  const google = createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  const targetModel = model || env.GEMINI_MODEL || "gemini-3.8-flash";
  console.log(`[AI Agent] Initializing streamText with model: ${targetModel}`);

  const messages = formatMessages(history, prompt);

  return streamText({
    model: google(targetModel),
    system: SYSTEM_PROMPT,
    messages,
    tools: aiTools,
    maxSteps: 5,
    stopWhen: stepCountIs(5),
    abortSignal: AbortSignal.timeout(30000),
    onError: ({ error }) => {
      console.error(`[AI onError] (model: ${targetModel}):`, error);
      if (onError && typeof onError === "function") {
        onError(error);
      }
    },
  });
}
