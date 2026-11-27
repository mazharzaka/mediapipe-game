import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { streamText, generateText, stepCountIs } from "ai";
import { env, isAiConfigured } from "../config/env.js";
import { aiTools } from "./tools.js";
import { generateTextWithFallback } from "./llmClient.js";
import { resolveSmartUrl, normalizeTabTargetTitle } from "./tools/browserTools.js";

const SYSTEM_PROMPT = `أنت "مساعد الفرجة والاسترخاء والتحكم الذكي زاقا (ZAKA)" المدمج في نظام التحكم المساعد (Assistive System).
مهمتك الأساسية هي مساعدة المستخدم في التحكم في الكمبيوتر، تشغيل الفيديوهات والميديا، والتطبيقات بسهولة وسرعة باللغة العربية وباللهجة المصرية الودودة والعملية.

قواعد وتعليمات العمل الصارمة:
1. تحدث باللغة العربية وباللهجة المصرية الودودة والمهذبة والمختصرة جداً (مثال: "عيوني يا باشا! شغلتلك الفيديو 🍿", "تمام يا فندم! فتحتلك اللينك", "قفلتهولك خلاص").
2. استدعِ الأداة المناسبة دائماً عبر نظام استدعاء الأدوات (Tool Calling) الأصلي، وإياك أن تطبع كود JSON خام في نص الرد للمستخدم.
3. صناديق الأدوات الأساسية وإدارة النظام:
   - playYoutubeVideo: للبحث عن أي فيديو أو ملخص ماتش أو أغنية على يوتيوب وتشغيله مباشرة.
   - controlMediaPlayback: للتحكم في الصوت وتشغيل الوسائط (play_pause, mute, volume_up, volume_down, next).
   - openBrowserUrl: فتح المواقع في Google Chrome (مثل https://www.linkedin.com/in/me/ عند طلب بروفايل أو حساب لينكد إن، https://github.com لجيت هاب، https://chatgpt.com لشات جي بي تي) مع دعم incognito: true للتصفح الخفي.
   - browserTabAction: إغلاق التاب الحالي (close_current_tab) مع تمرير targetTitle (مثل YouTube أو LinkedIn) إذا حدد المستخدم اسم الموقع المراد إغلاق تابه، أو فتح تاب جديد (new_tab) أو إعادة فتح تاب مغلق (reopen_closed_tab) أو تحديث الصفحة (refresh_tab).
   - updateExcelCell: تعديل أو إنشاء خلية في ملف إكسيل (.xlsx) على الديسكتوب (مثل Book1.xlsx أو أي ملف محدد).
   - fileOperation: التعامل مع الملفات على الديسكتوب (open, list_desktop, create_folder, delete). الحذف يتطلب تأكيداً.
   - captureAndAnalyzeScreen: التقاط صورة للشاشة وتحليلها بصرياً للإجابة عن سؤال المستخدم.
   - controlMagnifier: للتحكم في عدسة ويندوز المكبرة.
   - openApplication: فتح برامج وتطبيقات ويندوز الحقيقية (VS Code, Antigravity, Chrome, Terminal, Calculator, Explorer, Notepad) مع دعم المسارات.
   - listOrKillProcess: فحص العمليات أو معرفة ما يعمل على بورت معين (action: 'find_port', port: 3000) أو إغلاق تطبيق.
   - runTerminalCommand: تنفيذ أوامر التيرمنال والـ CLI وقراءة stdout و stderr بدقة.
   - controlPower: التحكم في الطاقة (lock, sleep, shutdown, restart, cancel_shutdown).
   - getSystemStatus: قراءة تقرير استهلاك الرام RAM والمعالج CPU.
4. عند تحليل أخطاء التيرمنال، استخرج نصوص وأكواد الخطأ من stderr واعرضها بوضوح للمستخدم.
5. ردودك يجب أن تكون دقيقة وواضحة ومختصرة بدون أي إطالة.`;

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
  "gemini-3.1-flash-lite",
  "openai/gpt-oss-120b",
];

/**
 * Enforces toolChoice: 'required' on Step 0 when domain !== 'chat' and tools exist,
 * then switches to 'auto' on subsequent steps so the agent can write its final Arabic reply.
 */
export function buildPrepareStep(domain, tools) {
  const toolKeys = tools ? Object.keys(tools) : [];
  if (!domain || domain === "chat" || toolKeys.length === 0) {
    return undefined;
  }

  return ({ stepNumber, model }) => {
    const modelId = String(model?.modelId || "").toLowerCase();
    // Google's Gemma endpoints do not support forced toolChoice ('ANY'); rely on auto + Leaked JSON Fallback if Gemma runs
    if (modelId.includes("gemma")) {
      return { toolChoice: "auto" };
    }
    return {
      toolChoice: stepNumber === 0 ? "required" : "auto",
    };
  };
}

/**
 * Safety Net (Leaked JSON Tool Fallback):
 * If an LLM returns raw JSON text representing a tool call (e.g. [{"name": "...", "arguments": {...}}])
 * without invoking native tool calling, extract it, execute filteredTools[name].execute(args),
 * and strip the raw JSON from the user-facing text.
 */
export async function recoverLeakedJsonTools(rawText, filteredTools) {
  const text = String(rawText || "");
  if (!text.trim() || !filteredTools || Object.keys(filteredTools).length === 0) {
    return {
      wasRecovered: false,
      cleanedText: text,
      recoveredCalls: [],
      recoveredResults: [],
    };
  }

  // Quick check: must mention at least one available tool name and look like JSON
  const availableNames = Object.keys(filteredTools);
  const mentionsTool = availableNames.some((tName) => text.includes(tName));
  if (!mentionsTool || (!text.includes("{") && !text.includes("["))) {
    return {
      wasRecovered: false,
      cleanedText: text,
      recoveredCalls: [],
      recoveredResults: [],
    };
  }

  const candidateBlocks = [];

  // 1. Check fenced ```json ... ``` blocks first
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fMatch;
  while ((fMatch = fenceRegex.exec(text)) !== null) {
    candidateBlocks.push({ fullMatch: fMatch[0], jsonStr: fMatch[1].trim() });
  }

  // 2. Check raw JSON array [...] or object {...} blocks if no fenced block matched
  if (candidateBlocks.length === 0) {
    const arrayMatch = text.match(/\[\s*\{\s*"(?:name|tool|function)"[\s\S]*?\}\s*\]/);
    if (arrayMatch) {
      candidateBlocks.push({ fullMatch: arrayMatch[0], jsonStr: arrayMatch[0] });
    } else {
      const objMatch = text.match(/\{\s*"(?:name|tool|function)"\s*:\s*"[^"]+"[\s\S]*?\}(?=\s*$|\s*\n)/);
      if (objMatch) {
        candidateBlocks.push({ fullMatch: objMatch[0], jsonStr: objMatch[0] });
      }
    }
  }

  if (candidateBlocks.length === 0) {
    return {
      wasRecovered: false,
      cleanedText: text,
      recoveredCalls: [],
      recoveredResults: [],
    };
  }

  let cleanedText = text;
  const recoveredCalls = [];
  const recoveredResults = [];

  for (const block of candidateBlocks) {
    try {
      const parsed = JSON.parse(block.jsonStr);
      const items = Array.isArray(parsed) ? parsed : [parsed];

      let blockHadValidTool = false;
      for (const item of items) {
        const toolName = item?.name || item?.tool || item?.function;
        const rawArgs = item?.arguments ?? item?.parameters ?? item?.args ?? item?.input ?? {};
        const parsedArgs =
          typeof rawArgs === "string"
            ? (() => {
                try {
                  return JSON.parse(rawArgs);
                } catch {
                  return {};
                }
              })()
            : rawArgs || {};

        if (toolName && filteredTools[toolName]?.execute) {
          blockHadValidTool = true;
          console.warn(
            `[Agent Leaked JSON Recovery] Intercepted raw JSON tool call "${toolName}" -> executing programmatically!`
          );
          const execOut = await filteredTools[toolName].execute(parsedArgs);
          const callId = `leaked_recovery_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

          recoveredCalls.push({
            type: "tool-call",
            toolCallId: callId,
            toolName,
            args: parsedArgs,
            input: parsedArgs,
            recoveredFromJson: true,
          });

          recoveredResults.push({
            type: "tool-result",
            toolCallId: callId,
            toolName,
            args: parsedArgs,
            input: parsedArgs,
            result: execOut,
            output: execOut,
            recoveredFromJson: true,
          });
        }
      }

      if (blockHadValidTool) {
        cleanedText = cleanedText.replace(block.fullMatch, "").trim();
      }
    } catch (_) {
      // Ignore malformed non-tool JSON snippets
    }
  }

  if (recoveredCalls.length === 0) {
    return {
      wasRecovered: false,
      cleanedText: text,
      recoveredCalls: [],
      recoveredResults: [],
    };
  }

  // If stripping the raw JSON left the reply empty, synthesize a clean Arabic confirmation from tool output
  if (!cleanedText) {
    const messagesFromTools = recoveredResults
      .map((r) => r.result?.message || r.result?.analysis)
      .filter(Boolean);
    cleanedText =
      messagesFromTools.length > 0
        ? messagesFromTools.join("\n")
        : "تمام يا باشا! نفذت طلبك بنجاح.";
  }

  return {
    wasRecovered: true,
    cleanedText,
    recoveredCalls,
    recoveredResults,
  };
}

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

function resolveProviderModel(targetModel) {
  const isGroqModel =
    targetModel.startsWith("openai/") ||
    targetModel.includes("gpt") ||
    targetModel.includes("llama") ||
    targetModel.includes("oss");

  if (isGroqModel) {
    const groqKey = (process.env.GROQ_API_KEY || "").trim();
    const groq = createGroq({ apiKey: groqKey });
    return groq(targetModel);
  }

  const google = createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  return google(targetModel);
}

/**
 * Executes a one-shot generateText AI completion with automatic fallback.
 */
export async function generateAiResponse({
  prompt,
  history = [],
  model = null,
  domain = "system_cli",
}) {
  if (!isAiConfigured()) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY_MISSING");
  }

  const primaryModel = model || env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const candidateModels = [
    primaryModel,
    ...FALLBACK_MODELS.filter((m) => m !== primaryModel),
  ];
  const messages = formatMessages(history, prompt);
  const prepareStep = buildPrepareStep(domain, aiTools);

  let lastError = null;
  for (const targetModel of candidateModels) {
    try {
      return await generateText({
        model: resolveProviderModel(targetModel),
        system: SYSTEM_PROMPT,
        messages,
        tools: aiTools,
        maxSteps: 5,
        stopWhen: stepCountIs(5),
        ...(prepareStep ? { prepareStep } : {}),
        abortSignal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      lastError = err;
      if (isDemandOrQuotaError(err)) {
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * Initializes and returns a streamText execution supporting Google & Groq models + prepareStep tool guard
 */
export function streamAiResponse({
  prompt,
  history = [],
  onError = null,
  model = null,
  tools = aiTools,
  maxSteps = 5,
  domain = "system_cli",
}) {
  if (!isAiConfigured()) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY_MISSING");
  }

  const targetModel = model || env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const hasTools = Boolean(tools && Object.keys(tools).length > 0 && domain !== "chat");
  const effectiveSteps = hasTools ? Math.max(2, maxSteps) : maxSteps;
  const prepareStep = buildPrepareStep(domain, tools);

  console.log(
    `[AI Agent] Initializing streamText with model: ${targetModel} (domain: ${domain}, steps: ${effectiveSteps})`
  );

  const messages = formatMessages(history, prompt);

  return streamText({
    model: resolveProviderModel(targetModel),
    system: SYSTEM_PROMPT,
    messages,
    ...(hasTools ? { tools } : {}),
    maxSteps: effectiveSteps,
    stopWhen: stepCountIs(effectiveSteps),
    ...(prepareStep ? { prepareStep } : {}),
    abortSignal: AbortSignal.timeout(30000),
    onError: ({ error }) => {
      console.error(`[AI onError] (model: ${targetModel}):`, error);
      if (onError && typeof onError === "function") {
        onError(error);
      }
    },
  });
}

/**
 * Wrap tools for safe dryRun simulation when testing without spawning desktop windows
 */
export function buildDryRunTools(tools) {
  if (!tools) return tools;
  const effectiveTools = {};
  for (const [toolName, toolObj] of Object.entries(tools)) {
    effectiveTools[toolName] = {
      ...toolObj,
      execute: async (args) => {
        if (toolName === "openApplication") {
          return {
            success: true,
            dryRun: true,
            app: args?.app,
            path: args?.path || null,
            message: `[محاكاة آمنة dryRun]: تم التحقق واستخراج التطبيق ${args?.app} بنجاح`,
          };
        }
        if (toolName === "playYoutubeVideo") {
          return {
            success: true,
            dryRun: true,
            query: args?.query,
            url: `https://www.youtube.com/results?search_query=${encodeURIComponent(args?.query || "")}`,
            message: `[محاكاة آمنة dryRun]: تم استخراج استعلام يوتيوب "${args?.query}" بنجاح`,
          };
        }
        if (toolName === "openBrowserUrl") {
          const resolvedUrl = resolveSmartUrl(args?.url);
          return {
            success: true,
            dryRun: true,
            rawUrl: args?.url,
            url: resolvedUrl,
            incognito: Boolean(args?.incognito),
            message: `[محاكاة آمنة dryRun]: تم استخراج الرابط ${resolvedUrl} (incognito=${Boolean(args?.incognito)})`,
          };
        }
        if (toolName === "browserTabAction") {
          const normTarget = normalizeTabTargetTitle(args?.targetTitle);
          return {
            success: true,
            dryRun: true,
            action: args?.action,
            targetTitle: normTarget || null,
            message: `[محاكاة آمنة dryRun]: تم استخراج إجراء التاب ${args?.action}${normTarget ? ` للموقع ${normTarget}` : ""}`,
          };
        }
        if (toolName === "controlMediaPlayback" || toolName === "controlMagnifier") {
          const isVol = args?.action === "volume_up" || args?.action === "volume_down";
          return {
            success: true,
            dryRun: true,
            action: args?.action,
            pulses: isVol ? (args?.repeat && args.repeat > 1 ? args.repeat : 7) : 1,
            message: `[محاكاة آمنة dryRun]: تم استخراج إجراء ${args?.action}`,
          };
        }
        if (toolName === "listOrKillProcess" && args?.action === "kill" && !args?.confirmed) {
          return {
            success: false,
            status: "awaiting_confirmation",
            requiresConfirmation: true,
            action: "kill",
            dryRun: true,
            message: `[محاكاة آمنة dryRun]: تم حجب قتل العملية لحين التأكيد.`,
          };
        }
        if (toolName === "controlPower") {
          if (args?.action === "lock" || args?.action === "sleep" || args?.action === "cancel_shutdown") {
            return {
              success: true,
              dryRun: true,
              action: args?.action,
              message: `[محاكاة آمنة dryRun]: تم محاكاة أمر الطاقة الآمن (${args?.action}).`,
            };
          }
          if (!args?.confirmed) {
            return {
              success: false,
              status: "awaiting_confirmation",
              requiresConfirmation: true,
              action: args?.action,
              dryRun: true,
              message: `[محاكاة آمنة dryRun]: تم حجب أمر ${args?.action} بنجاح لحين التأكيد.`,
            };
          }
          return {
            success: true,
            dryRun: true,
            action: args?.action,
            message: `[محاكاة آمنة dryRun]: أمر ${args?.action} مؤكد.`,
          };
        }
        return await toolObj.execute(args);
      },
    };
  }
  return effectiveTools;
}

/**
 * Universal Agent Execution Function with prepareStep ('required' on step 0) + Leaked JSON Tool Fallback
 */
export async function runAgent({
  prompt,
  history = [],
  model = null,
  domain = "system_cli",
  tools = aiTools,
  maxSteps = 5,
  dryRun = false,
  system = SYSTEM_PROMPT,
}) {
  const effectiveTools = dryRun ? buildDryRunTools(tools) : tools;
  const hasTools = Boolean(
    effectiveTools && Object.keys(effectiveTools).length > 0 && domain !== "chat"
  );

  const primaryModel = model || "gemini-3.1-flash-lite";
  const timeoutMs = primaryModel === "gemma-4-31b-it" ? 12000 : 8500;
  const messages = formatMessages(history, prompt);
  const effectiveMaxSteps = hasTools ? Math.max(1, maxSteps) : 1;
  const prepareStep = buildPrepareStep(domain, effectiveTools);

  const { result, meta } = await generateTextWithFallback({
    messages,
    system,
    ...(hasTools ? { tools: effectiveTools } : {}),
    maxSteps: effectiveMaxSteps,
    ...(prepareStep ? { prepareStep } : {}),
    primaryModel,
    timeoutMs,
  });

  let toolCalls = (
    result.toolCalls && result.toolCalls.length > 0
      ? result.toolCalls
      : (result.steps || []).flatMap((s) => s.toolCalls || [])
  ).map((tc) => ({
    ...tc,
    args: tc.args || tc.input || {},
    input: tc.input || tc.args || {},
  }));

  let toolResults = (
    result.toolResults && result.toolResults.length > 0
      ? result.toolResults
      : (result.steps || []).flatMap((s) => s.toolResults || [])
  ).map((tr) => ({
    ...tr,
    result: tr.result !== undefined ? tr.result : tr.output,
    output: tr.output !== undefined ? tr.output : tr.result,
  }));

  let finalText = result.text || "";

  // Safety Net: If model leaked raw JSON tool call without invoking native tool calling, execute & strip JSON!
  if (toolCalls.length === 0 && hasTools && finalText) {
    const recovery = await recoverLeakedJsonTools(finalText, effectiveTools);
    if (recovery.wasRecovered) {
      finalText = recovery.cleanedText;
      toolCalls = recovery.recoveredCalls;
      toolResults = recovery.recoveredResults;
    }
  }

  // When maxSteps === 1 finishes immediately after executing the required tool on Step 0, surface the tool's Arabic message cleanly
  if (!finalText && toolResults.length > 0) {
    const summaries = toolResults
      .map((tr) => {
        const out = tr.result || tr.output;
        return out?.message || out?.analysis || "";
      })
      .filter(Boolean);
    if (summaries.length > 0) {
      finalText = summaries.join("\n");
    }
  }

  return {
    text: finalText,
    steps: result.steps || [],
    toolCalls,
    toolResults,
    meta,
  };
}
