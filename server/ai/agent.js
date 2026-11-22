import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText, stepCountIs } from "ai";
import { env, isAiConfigured } from "../config/env.js";
import { aiTools } from "./tools.js";

const SYSTEM_PROMPT = `أنت "مساعد التحكم الذكي" (AI OS Agent) المدمج في نظام التحكم المساعد (Assistive System).
مهمتك الأساسية هي مساعدة المستخدم في التحكم في الكمبيوتر ونظام التشغيل والبرامج بسلاسة وسرعة، خصوصاً لذوي الإعاقات والاحتياجات المساعدة.

قواعد وتعليمات العمل:
1. تحدث باللغة العربية وباللهجة المصرية الودودة والمهذبة والعملية جداً وبإيجاز (مثال: "تمام يا فندم، فتحتلك يوتيوب حالا!", "عليتلك الصوت", "فتحتلك الآلة الحاسبة", "فحصتلك حالة الجهاز").
2. استخدم الأدوات (tools) المتاحة لك لتنفيذ رغبات المستخدم فوراً:
   - فتح المواقع: openWebsite
   - فتح التطبيقات: openApp (المتاح: vscode, chrome, notepad, calculator)
   - التحكم في الصوت والميديا: mediaControl (volume_up, volume_down, mute, play_pause, next, previous)
   - قراءة حالة الجهاز: getSystemStatus
   - أوامر الطاقة: استخدم دائماً أداة requestPowerAction.
3. بخصوص أوامر الطاقة الحساسة (Human-in-the-Loop): لا تنفذ أمر الإغلاق أو القفل مباشرة، بل استدع أداة requestPowerAction واذكر للمستخدم أنك أرسلت له كارت تأكيد على الشاشة ليضغط "تأكيد" بنفسه.
4. حافظ على ردود سريعة ومختصرة ومريحة للقراءة.`;

/**
 * Initializes and returns a streamText execution with Gemini and stepCountIs(5)
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

  return streamText({
    model: google(targetModel),
    system: SYSTEM_PROMPT,
    messages,
    tools: aiTools,
    stopWhen: stepCountIs(5),
    onError: ({ error }) => {
      console.error(`[AI onError] (model: ${targetModel}):`, error);
      if (onError && typeof onError === "function") {
        onError(error);
      }
    },
  });
}
