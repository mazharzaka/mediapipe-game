import * as nutService from "../services/nutService.js";
import * as systemService from "../services/systemService.js";
import {
  streamAiResponse,
  classifyAiError,
  isDemandOrQuotaError,
  FALLBACK_MODELS,
  recoverLeakedJsonTools,
} from "../ai/agent.js";
import { isAiConfigured, env } from "../config/env.js";
import { getQuotaStats } from "../ai/llmClient.js";
import { routeCommand, filterToolsByDomain } from "../ai/router.js";
import { aiTools } from "../ai/tools.js";
import { controlMediaPlayback } from "../ai/tools/youtubeTools.js";

// Keep track of pending confirmation actions per socket
const pendingActionsMap = new Map();

/**
 * Zero-Token Local Fast Path Matcher:
 * Matches direct single-intent media & volume commands in Egyptian Arabic / English
 * without consuming any Gemini or Groq API quota.
 */
export function matchZeroTokenFastPath(rawPrompt) {
  if (!rawPrompt || typeof rawPrompt !== "string") return null;

  // Normalize diacritics, alef forms, punctuation, and strip optional ZAKA wake-word prefix or polite fillers
  let cleaned = rawPrompt
    .trim()
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[؟?!.,،]+/g, " ")
    .replace(/^(?:يا\s*)?(?:زاقا|زاكا|زكا|زقه|ذكا|زكاء|ذاكره|ذاكرة|zaka|zaqa)\s*/i, "")
    .replace(/\b(?:لو\s*سمحت|بعد\s*اذنك|من\s*فضلك|يا\s*باشا|دلوقتي|حالا)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  // Do NOT hijack compound multi-step commands (e.g. "شغل ملخص ماتش وعلي الصوت")
  if (/\s+و(?:شغل|افتح|اقفل|اعمل|جيب|هات|بص)\b/i.test(cleaned)) {
    return null;
  }

  // 1. Volume Up: علي الصوت / زود الصوت / ارفع الصوت (7 consecutive pulses = ~14%)
  if (/^(?:علي|زود|ارفع)\s+الصوت(?:\s+(?:شويه|كمان|اكتر|سنه|قوي))?$/i.test(cleaned)) {
    const isStrong = /كمان|اكتر|قوي/.test(cleaned);
    return {
      action: "volume_up",
      repeat: isStrong ? 10 : 7,
      reply: "🔊 علّيت الصوت فوراً (+14% مسار محلي مجاني).",
    };
  }

  // 2. Volume Down: وطي الصوت / قلل الصوت / نزل الصوت / اخفض الصوت (7 consecutive pulses = ~14%)
  if (/^(?:وطي|قلل|نزل|اخفض|هدي)\s+الصوت(?:\s+(?:شويه|كمان|سنه|خالص))?$/i.test(cleaned)) {
    const isStrong = /كمان|خالص/.test(cleaned);
    return {
      action: "volume_down",
      repeat: isStrong ? 10 : 7,
      reply: "🔉 وطّيت الصوت فوراً (-14% مسار محلي مجاني).",
    };
  }

  // 3. Mute / Unmute: اعمل ميوت / اكتم الصوت / ميوت
  if (/^(?:(?:اعمل\s+)?ميوت|اكتم(?:\s+الصوت)?|كتم\s+الصوت|mute)$/i.test(cleaned)) {
    return {
      action: "mute",
      repeat: 1,
      reply: "🔇 تم كتم/إلغاء كتم الصوت فوراً (مسار محلي مجاني).",
    };
  }

  // 4. Play / Pause: وقف الفيديو / شغل الفيديو / بوز / كمل الفيديو
  if (
    /^(?:وقف(?:\s+(?:الفيديو|الميديا|التشغيل|الصوت))?|شغل\s+الفيديو|كمل(?:\s+(?:الفيديو|التشغيل))?|استمر|بوز|ستوب|pause|resume)$/i.test(
      cleaned,
    )
  ) {
    return {
      type: "media",
      action: "play_pause",
      repeat: 1,
      reply: "⏯️ تم إيقاف/تشغيل الفيديو فوراً (مسار محلي مجاني).",
    };
  }

  // 5. Scroll Down: انزل تحت / انزل تحت شوية / سكرول لتحت / نزل الصفحة / scroll down
  if (
    /^(?:انزل(?:\s+(?:تحت|لتحت))?|سكرول\s+(?:تحت|لتحت)|نزل\s+الصفحه|scroll\s+down)(?:\s+(?:شويه|كمان|اكتر|سنه))*$/i.test(
      cleaned,
    )
  ) {
    return {
      type: "scroll",
      action: "scroll_down",
      direction: "down",
      amount: 5,
      reply: "⬇️ تم التمرير لأسفل فوراً (مسار محلي مجاني).",
    };
  }

  // 6. Scroll Up: اطلع فوق / اطلع فوق شوية / سكرول لفوق / طلع الصفحة / scroll up
  if (
    /^(?:اطلع(?:\s+(?:فوق|لفوق))?|سكرول\s+(?:فوق|لفوق)|طلع\s+الصفحه|scroll\s+up)(?:\s+(?:شويه|كمان|اكتر|سنه))*$/i.test(
      cleaned,
    )
  ) {
    return {
      type: "scroll",
      action: "scroll_up",
      direction: "up",
      amount: 5,
      reply: "⬆️ تم التمرير لأعلى فوراً (مسار محلي مجاني).",
    };
  }

  return null;
}

export function setupSocketHandler(io) {
  io.on("connection", (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Broadcast current AI quota status to newly connected client
    socket.emit("ai_quota_status", {
      type: "ai_quota_init",
      quotaStats: getQuotaStats(),
      timestamp: Date.now(),
    });

    // --- 1. Face Tracking Events ---
    socket.on("assistiveMove", async ({ x, y }) => {
      await nutService.moveToNormalized(x, y);
    });

    socket.on("mouse_click", async ({ button }) => {
      if (button === "right") {
        await nutService.rightClick();
      } else {
        await nutService.leftClick();
      }
    });

    socket.on("mouse_double_click", async () => {
      await nutService.doubleClick();
    });

    socket.on("mouse_scroll", async ({ direction, amount, dy }) => {
      if (typeof dy === "number") {
        await nutService.scrollDelta(dy);
      } else if (direction) {
        await nutService.scroll(direction, amount || 2);
      }
    });

    // --- 2. Touchpad Events (Multi-Monitor Unbounded & Coalesced) ---
    socket.on("touchpad_start", async () => {
      await nutService.syncTouchpadStart();
    });

    socket.on("touchpad_move", async ({ dx, dy }) => {
      await nutService.moveDelta(dx, dy);
    });

    socket.on("touchpad_scroll", async ({ dy, speedMultiplier }) => {
      await nutService.scrollDelta(dy, speedMultiplier);
    });

    socket.on("close_tab", async () => {
      try {
        const result = await nutService.closeTab();
        socket.emit("remote_feedback", { success: true, message: result.message });
      } catch (err) {
        socket.emit("remote_feedback", { success: false, error: err.message });
      }
    });

    socket.on("touchpad_click", async ({ button }) => {
      if (button === "right") {
        await nutService.rightClick();
      } else {
        await nutService.leftClick();
      }
    });

    socket.on("toggle_big_cursor", async ({ enable }) => {
      try {
        const result = await systemService.toggleBigCursor(enable);
        io.emit("big_cursor_status", { enabled: result.enabled, size: result.size, success: true });
        socket.emit("remote_feedback", { success: true, message: result.message });
      } catch (err) {
        socket.emit("remote_feedback", { success: false, error: err.message });
      }
    });

    // --- 3. Remote & YouTube & Boxing Game Events ---
    socket.on("handMove", ({ x, y, isPunching }) => {
      socket.broadcast.emit("updateGloves", { x, y, isPunching: !!isPunching });
    });

    socket.on("remote_media", async ({ action }) => {
      try {
        const result = await nutService.mediaControl(action);
        socket.emit("remote_feedback", { success: true, action, result });
      } catch (err) {
        socket.emit("remote_feedback", { success: false, error: err.message });
      }
    });

    socket.on("youtube_control", async ({ action }) => {
      try {
        const result = await nutService.youtubeControl(action);
        socket.emit("remote_feedback", { success: true, action, result });
      } catch (err) {
        socket.emit("remote_feedback", { success: false, error: err.message });
      }
    });

    socket.on("system_control", async ({ action }) => {
      try {
        let result;
        if (action === "zoom_in") {
          result = await nutService.zoomIn();
        } else if (action === "zoom_out") {
          result = await nutService.zoomOut();
        } else if (action === "zoom_reset") {
          result = await nutService.zoomReset();
        } else if (action === "switch_window" || action === "alt_tab") {
          result = await nutService.switchWindow();
        } else if (action === "backspace") {
          result = await nutService.backspace();
        } else if (action === "enter") {
          result = await nutService.pressEnterKey();
        } else if (action === "browser_back") {
          result = await nutService.browserBack();
        } else if (action === "browser_forward") {
          result = await nutService.browserForward();
        } else if (action === "lock" || action === "sleep") {
          result = await systemService.executePowerAction(action);
        } else {
          throw new Error(`أمر نظام غير معروف: ${action}`);
        }
        socket.emit("remote_feedback", { success: true, action, message: result.message });
      } catch (err) {
        socket.emit("remote_feedback", { success: false, error: err.message });
      }
    });

    socket.on("type_text", async ({ text, pressEnter }) => {
      try {
        const result = await nutService.typeText(text, pressEnter);
        socket.emit("remote_feedback", { success: true, message: result.message });
      } catch (err) {
        socket.emit("remote_feedback", { success: false, error: err.message });
      }
    });

    // Real-time Live Typing per-keystroke event
    socket.on("live_type", async (payload) => {
      try {
        await nutService.queueLiveType(payload);
      } catch (err) {
        console.error("[socketHandler] live_type error:", err.message);
      }
    });

    // --- Clipboard Synchronization (UTF-8 Arabic / English) ---
    socket.on("clipboard_get", async (ack) => {
      try {
        const result = await nutService.getClipboard();
        if (typeof ack === "function") ack(result);
        socket.emit("clipboard_content", result);
      } catch (err) {
        if (typeof ack === "function") ack({ success: false, error: err.message });
        socket.emit("clipboard_content", { success: false, error: err.message });
      }
    });

    socket.on("clipboard_set", async ({ text }, ack) => {
      try {
        const result = await nutService.setClipboard(text);
        if (typeof ack === "function") ack(result);
        socket.emit("remote_feedback", { success: true, message: '✓ تم نسخ النص إلى كليبورد الكمبيوتر' });
      } catch (err) {
        if (typeof ack === "function") ack({ success: false, error: err.message });
        socket.emit("remote_feedback", { success: false, error: err.message });
      }
    });

    // --- Power Actions (Lock & Sleep) ---
    socket.on("power_action", async ({ action }, ack) => {
      try {
        const result = await systemService.executePowerAction(action);
        if (typeof ack === "function") ack(result);
        socket.emit("remote_feedback", { success: true, message: result.message });
      } catch (err) {
        if (typeof ack === "function") ack({ success: false, error: err.message });
        socket.emit("remote_feedback", { success: false, error: err.message });
      }
    });

    // --- Windows Magnifier Lens Mode (0ms latency direct controls) ---
    socket.on("magnifier_action", async ({ action }) => {
      try {
        let result;
        if (action === "open") {
          result = await nutService.openLens();
        } else if (action === "close") {
          result = await nutService.closeLens();
        } else if (action === "zoom_in") {
          result = await nutService.zoomInLens();
        } else if (action === "zoom_out") {
          result = await nutService.zoomOutLens();
        } else {
          throw new Error(`إجراء عدسة غير معروف: ${action}`);
        }
        socket.emit("remote_feedback", { success: true, action, message: result.message });
      } catch (err) {
        socket.emit("remote_feedback", { success: false, action, error: err.message });
      }
    });

    socket.on("magnifier_pan", async ({ dx, dy }) => {
      try {
        if (typeof dx === "number" && typeof dy === "number") {
          await nutService.panLens(dx, dy);
        }
      } catch (err) {
        console.error("[Socket] magnifier_pan error:", err.message);
      }
    });

    // --- 4. AI Agent OS Assistant Events ---
    socket.on("ai_command", async (payload) => {
      const prompt =
        typeof payload === "string"
          ? payload
          : payload?.text || payload?.prompt || "";
      const history = payload?.history || [];

      console.log(`[AI Command Received from ${socket.id}]:`, prompt);

      if (!prompt || !prompt.trim()) {
        socket.emit("ai_stream_done", {
          text: "لم يتم إرسال أي نص.",
          executedTools: [],
        });
        return;
      }

      // 0. Zero-Token Fast Path for instant media/volume/scroll commands (0 API quota consumed)
      const fastPathMatch = matchZeroTokenFastPath(prompt);
      if (fastPathMatch) {
        console.log(
          `[Zero-Token Fast Path] Matched "${prompt}" -> ${fastPathMatch.action}`,
        );

        socket.emit("ai_route_info", {
          rawText: prompt,
          cleanText: prompt.trim(),
          domain: fastPathMatch.type === "scroll" ? "browser" : "youtube",
          complexity: "simple",
          targetModel: "local-fast-path",
          model: "local-fast-path",
          maxSteps: 0,
          requiresConfirmation: false,
          reasoning: "مسار سريع محلي بدون استهلاك كوتة الذكاء الاصطناعي",
        });

        let execResult;
        let toolNameUsed;
        let toolArgsUsed;

        if (fastPathMatch.type === "scroll") {
          await nutService.scroll(fastPathMatch.direction, fastPathMatch.amount || 5);
          execResult = {
            success: true,
            direction: fastPathMatch.direction,
            amount: fastPathMatch.amount || 5,
          };
          toolNameUsed = "localScroll";
          toolArgsUsed = { direction: fastPathMatch.direction, amount: fastPathMatch.amount || 5 };
        } else {
          execResult = await controlMediaPlayback.execute({
            action: fastPathMatch.action,
            repeat: fastPathMatch.repeat,
          });
          toolNameUsed = "controlMediaPlayback";
          toolArgsUsed = { action: fastPathMatch.action, repeat: fastPathMatch.repeat };
        }

        const executedToolEntry = {
          name: toolNameUsed,
          args: toolArgsUsed,
          result: execResult,
        };

        const replyText = execResult?.success
          ? fastPathMatch.reply
          : `⚠️ تعذر تنفيذ الأمر محلياً: ${execResult?.error || "خطأ غير معروف"}`;

        socket.emit("ai_stream_chunk", {
          chunk: replyText,
          fullText: replyText,
          toolCompleted: executedToolEntry,
        });

        socket.emit("ai_stream_done", {
          text: replyText,
          model: "local-fast-path",
          executedTools: [executedToolEntry],
        });
        return;
      }

      if (!isAiConfigured()) {
        const warning =
          "⚠️ تنبيه: مفتاح Google Generative AI (GOOGLE_GENERATIVE_AI_API_KEY) غير مسجل في ملف .env بالسيرفر.\nيرجى إضافة المفتاح في server/.env لتفعيل المساعد الذكي، مع العلم أن باقي وظائف التتبع والريموت والتاتش باد تعمل بشكل طبيعي.";
        console.warn(
          "[AI Agent Warning]: GOOGLE_GENERATIVE_AI_API_KEY is missing",
        );
        socket.emit("ai_error", {
          error: "مفتاح Google Generative AI غير مسجل بالسيرفر (.env).",
          code: "KEY_MISSING",
        });
        socket.emit("ai_stream_chunk", { chunk: warning, fullText: warning });
        socket.emit("ai_stream_done", {
          text: warning,
          executedTools: [],
          isConfigMissing: true,
        });
        return;
      }

      let fullText = "";
      const executedTools = [];
      let pendingAction = null;

      // 1. Semantic Router & Normalizer (Phase 4)
      let routeInfo = null;
      try {
        routeInfo = await routeCommand(prompt);
      } catch (rErr) {
        console.error("[Router Error in socketHandler]:", rErr.message);
      }

      const effectiveText = routeInfo?.cleanText || prompt;
      const effectiveDomain = routeInfo?.domain || "chat";
      const effectiveComplexity = routeInfo?.complexity || "simple";
      const targetModel = routeInfo?.targetModel || "gemini-3.1-flash-lite";
      const effectiveMaxSteps = routeInfo?.maxSteps || (effectiveComplexity === "complex" ? 5 : 1);
      const requiresConfirmation = !!routeInfo?.requiresConfirmation;
      const filteredTools = filterToolsByDomain(aiTools, effectiveDomain, effectiveComplexity);

      console.log(`[Router Output] Domain: ${effectiveDomain} | Complexity: ${effectiveComplexity} | Target: ${targetModel} (${effectiveMaxSteps} steps) | Confirm: ${requiresConfirmation}`);

      // Broadcast route info immediately to client for UI badge display
      socket.emit("ai_route_info", {
        rawText: prompt,
        cleanText: effectiveText,
        domain: effectiveDomain,
        complexity: effectiveComplexity,
        targetModel,
        maxSteps: effectiveMaxSteps,
        requiresConfirmation,
        reasoning: routeInfo?.reasoning || "",
      });

      // Human-in-the-Loop Guard: If router determined this is a critical action (e.g. Shutdown, Restart)
      // halt immediate execution and prompt user for explicit confirmation
      if (requiresConfirmation && !payload?.confirmed) {
        const actionId = `req_confirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        pendingActionsMap.set(actionId, {
          socketId: socket.id,
          isRouterConfirmation: true,
          actionId,
          action: effectiveDomain === 'power' ? 'shutdown' : 'sensitive_action',
          prompt: effectiveText,
          history,
          routeInfo,
          domain: effectiveDomain,
          complexity: effectiveComplexity,
          targetModel,
          maxSteps: effectiveMaxSteps,
          filteredTools,
        });

        console.log(`[Router Guard] Halted command awaiting confirmation: "${effectiveText}" (Action ID: ${actionId})`);

        socket.emit("ai_confirmation_required", {
          id: actionId,
          actionId,
          action: effectiveDomain === 'power' ? 'shutdown' : 'sensitive_action',
          title: `تأكيد أمر حساس: ${effectiveText}`,
          cleanText: effectiveText,
          domain: effectiveDomain,
          reasoning: routeInfo?.reasoning || "أمر حساس يتطلب موافقة صريحة قبل التنفيذ",
        });

        socket.emit("ai_stream_done", {
          text: `⚠️ الأمر المطلوب ("${effectiveText}") حساس وقد يؤثر على تشغيل النظام. يرجى الضغط على زر التأكيد أدناه للمتابعة.`,
          executedTools: [],
          requiresConfirmation: true,
          pendingAction: {
            id: actionId,
            action: effectiveDomain === 'power' ? 'shutdown' : 'sensitive_action',
            title: `تأكيد أمر حساس: ${effectiveText}`,
            reason: routeInfo?.reasoning || "أمر حساس يتطلب موافقة صريحة قبل التنفيذ",
          },
        });
        return;
      }

      const candidateModels = [
        targetModel,
        ...FALLBACK_MODELS.filter((m) => m !== targetModel),
      ];

      let streamSucceeded = false;
      let lastHandledError = null;

      for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
        const currentModel = candidateModels[mIdx];
        let streamHasError = false;
        let receivedAnyText = false;

        const handleStreamError = (error) => {
          if (streamHasError) return;
          streamHasError = true;
          lastHandledError = error;
          const classified = classifyAiError(error);
          console.error(`[AI Stream Runtime Error] (model: ${currentModel}):`, classified.errMsg);

          // If no tokens were streamed yet and it's a demand/quota error, try the next model
          if (!receivedAnyText && isDemandOrQuotaError(error) && mIdx < candidateModels.length - 1) {
            console.warn(`[AI Stream] Model ${currentModel} returned 503/429 with no output. Trying next model...`);
            return;
          }

          socket.emit("ai_error", {
            error: classified.userMessage,
            code: classified.code,
            details: classified.errMsg,
          });
          socket.emit("ai_stream_chunk", {
            chunk: `\n[تنبيه]: ${classified.userMessage}`,
            fullText: fullText
              ? `${fullText}\n[تنبيه]: ${classified.userMessage}`
              : `[تنبيه]: ${classified.userMessage}`,
          });
          socket.emit("ai_stream_done", {
            text: fullText ? `${fullText}\n[تنبيه]: ${classified.userMessage}` : `[تنبيه]: ${classified.userMessage}`,
            executedTools,
            error: classified.userMessage,
          });
        };

        try {
          const result = streamAiResponse({
            prompt: effectiveText,
            history,
            onError: handleStreamError,
            model: currentModel,
            tools: filteredTools,
            maxSteps: effectiveMaxSteps,
            domain: effectiveDomain,
          });

          for await (const part of result.fullStream) {
            console.log("[AI Stream Part]:", part.type, part);

            if (part.type === "text-delta") {
              const chunk = part.text || part.textDelta || part.delta || "";
              if (chunk) {
                receivedAnyText = true;
                fullText += chunk;
                socket.emit("ai_stream_chunk", { chunk, fullText });
              }
            } else if (part.type === "tool-call") {
              const toolCallInfo = {
                name: part.toolName,
                args: part.args || part.input || {},
              };
              socket.emit("ai_stream_chunk", {
                chunk: "",
                fullText,
                activeTool: toolCallInfo,
              });
            } else if (part.type === "tool-result") {
              const res = part.result || part.output;
              const toolResultInfo = {
                name: part.toolName,
                args: part.args || part.input || {},
                result: res,
              };
              executedTools.push(toolResultInfo);

              if (res && res.requiresConfirmation && res.pendingAction) {
                pendingAction = res.pendingAction;
                pendingActionsMap.set(res.pendingAction.id, {
                  socketId: socket.id,
                  action: res.pendingAction.action,
                  actionId: res.pendingAction.id,
                });
              }

              socket.emit("ai_stream_chunk", {
                chunk: "",
                fullText,
                toolCompleted: toolResultInfo,
                pendingAction,
              });
            } else if (part.type === "error") {
              console.error("[AI Stream Part Error]:", part.error);
              handleStreamError(part.error);
              break;
            }
          }

          if (streamHasError && !receivedAnyText && isDemandOrQuotaError(lastHandledError) && mIdx < candidateModels.length - 1) {
            console.warn(`[AI Stream] Switching from ${currentModel} to next candidate model...`);
            continue;
          }

          if (!streamHasError) {
            // Safety Net: If model printed raw JSON tool call without invoking native tool calling, execute & strip JSON!
            if (executedTools.length === 0 && effectiveDomain !== "chat" && fullText) {
              const recovery = await recoverLeakedJsonTools(fullText, filteredTools);
              if (recovery.wasRecovered) {
                fullText = recovery.cleanedText;
                for (let idx = 0; idx < recovery.recoveredResults.length; idx++) {
                  const rec = recovery.recoveredResults[idx];
                  const resObj = rec.result;
                  const tInfo = {
                    name: rec.toolName,
                    args: rec.args,
                    result: resObj,
                  };
                  executedTools.push(tInfo);
                  if (resObj && resObj.requiresConfirmation && resObj.pendingAction) {
                    pendingAction = resObj.pendingAction;
                    pendingActionsMap.set(resObj.pendingAction.id, {
                      socketId: socket.id,
                      action: resObj.pendingAction.action,
                      actionId: resObj.pendingAction.id,
                    });
                  }
                }
                socket.emit("ai_stream_chunk", { chunk: "", fullText, pendingAction });
              }
            }

            streamSucceeded = true;
            socket.emit("ai_stream_done", {
              text: fullText || "",
              executedTools,
              pendingAction,
            });
            break;
          }
        } catch (err) {
          console.error(`[AI Execution Error on ${currentModel}]:`, err.message);
          if (!receivedAnyText && isDemandOrQuotaError(err) && mIdx < candidateModels.length - 1) {
            console.warn(`[AI Stream Catch] Model ${currentModel} failed with 503/429. Trying next fallback model...`);
            continue;
          }
          handleStreamError(err);
          break;
        }
      }
    });

    // Human-in-the-Loop Confirmation for sensitive actions (shutdown, lock, sleep)
    socket.on("ai_confirm_action", async ({ actionId, action, confirmed }) => {
      console.log(
        `[AI HITL] Confirmation received: ${actionId}, action: ${action}, confirmed: ${confirmed}`,
      );

      if (!confirmed) {
        pendingActionsMap.delete(actionId);
        socket.emit("ai_action_cancelled", {
          actionId,
          action,
          message: `تم إلغاء أمر الطاقة (${action}) بأمان بناءً على رغبتك.`,
        });
        return;
      }

      try {
        pendingActionsMap.delete(actionId);
        socket.emit("ai_stream_chunk", {
          chunk: `\n[جاري تنفيذ أمر الطاقة: ${action}...]`,
          fullText: `تم التأكيد. جاري تنفيذ أمر الطاقة (${action}) الآن.`,
        });

        const execResult = await systemService.executePowerAction(action);
        socket.emit("ai_action_confirmed", {
          actionId,
          action,
          success: true,
          message: execResult.message,
        });
        socket.emit("ai_stream_done", {
          text: `تم التأكيد وتنفيذ أمر الطاقة (${action}) بنجاح: ${execResult.message}`,
          executedTools: [{ name: "controlPower", args: { action, confirmed: true }, result: execResult }],
        });
      } catch (err) {
        console.error("[AI HITL Execution Error]:", err);
        socket.emit("ai_action_confirmed", {
          actionId,
          action,
          success: false,
          error: err.message,
        });
      }
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
      for (const [id, data] of pendingActionsMap.entries()) {
        if (data.socketId === socket.id) {
          pendingActionsMap.delete(id);
        }
      }
    });
  });
}
