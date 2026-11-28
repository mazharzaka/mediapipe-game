import crypto from "crypto";
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
import { matchZeroTokenFastPath } from "../ai/fastPath.js";

export { matchZeroTokenFastPath };

// Keep track of pending confirmation actions per socket
const pendingActionsMap = new Map();

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

        if (fastPathMatch.requiresBrowserForeground) {
          // Check if foreground window is a supported browser (chrome, msedge, brave, firefox)
          let isBrowserForeground = false;
          try {
            const { execSync } = await import("child_process");
            const procName = execSync(
              'powershell -NoProfile -Command "(Get-Process | Where-Object {$_.MainWindowHandle -eq (Add-Type -MemberDefinition \'[DllImport(\\\"user32.dll\\\")]public static extern IntPtr GetForegroundWindow();\' -Name W -Namespace N -PassThru)::GetForegroundWindow()}).ProcessName"',
              { encoding: "utf8", timeout: 1500, windowsHide: true }
            ).trim().toLowerCase();
            isBrowserForeground = ["chrome", "msedge", "brave", "firefox"].some((b) => procName.includes(b));
          } catch {
            isBrowserForeground = false;
          }
          if (!isBrowserForeground) {
            const noBrowserReply = "مفيش متصفح مفتوح قدامك دلوقتي يا باشا.";
            socket.emit("ai_stream_chunk", { chunk: noBrowserReply, fullText: noBrowserReply });
            socket.emit("ai_stream_done", {
              text: noBrowserReply,
              model: "local-fast-path",
              executedTools: [],
              debugTrace: {
                heardText: payload?.rawHeardText || prompt,
                cleanText: prompt.trim(),
                domain: "browser",
                model: "local-fast-path",
                tokens: 0,
              },
            });
            return;
          }
        }

        if (fastPathMatch.type === "scroll") {
          await nutService.scroll(fastPathMatch.direction, fastPathMatch.amount || 5);
          execResult = {
            success: true,
            direction: fastPathMatch.direction,
            amount: fastPathMatch.amount || 5,
          };
          toolNameUsed = "localScroll";
          toolArgsUsed = { direction: fastPathMatch.direction, amount: fastPathMatch.amount || 5 };
        } else if (fastPathMatch.type === "power") {
          execResult = await aiTools.controlPower.execute({ action: fastPathMatch.action });
          toolNameUsed = "controlPower";
          toolArgsUsed = { action: fastPathMatch.action };
        } else if (fastPathMatch.type === "tab") {
          execResult = await aiTools.browserTabAction.execute({ action: fastPathMatch.action });
          toolNameUsed = "browserTabAction";
          toolArgsUsed = { action: fastPathMatch.action };
        } else if (fastPathMatch.type === "port") {
          execResult = await aiTools.listOrKillProcess.execute({ action: "find_port", port: fastPathMatch.port });
          toolNameUsed = "listOrKillProcess";
          toolArgsUsed = { action: "find_port", port: fastPathMatch.port };
        } else if (fastPathMatch.type === "app") {
          execResult = await aiTools.openApplication.execute({ appName: fastPathMatch.appName });
          toolNameUsed = "openApplication";
          toolArgsUsed = { appName: fastPathMatch.appName };
        } else if (fastPathMatch.type === "url") {
          execResult = await aiTools.openBrowserUrl.execute({ url: fastPathMatch.url });
          toolNameUsed = "openBrowserUrl";
          toolArgsUsed = { url: fastPathMatch.url };
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
          debugTrace: {
            heardText: payload?.rawHeardText || prompt,
            cleanText: prompt.trim(),
            domain: fastPathMatch.type === "scroll" ? "browser" : "youtube",
            model: "local-fast-path",
            tokens: 0,
          },
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

      // Direct Call Execution (skip second LLM call for clear single-tool tasks)
      if (
        !requiresConfirmation &&
        routeInfo?.directCall?.tool &&
        aiTools[routeInfo.directCall.tool]?.execute
      ) {
        const directToolName = routeInfo.directCall.tool;
        const directArgs = routeInfo.directCall.args || {};
        console.log(`[DirectCall] Executing ${directToolName} directly without second LLM`);
        try {
          const execResult = await aiTools[directToolName].execute(directArgs, {
            messages: [],
          });
          const executedToolEntry = {
            name: directToolName,
            args: directArgs,
            result: execResult,
          };
          const replyText =
            execResult?.success === false
              ? `مقدرتش أنفذ الأمر: ${execResult?.error || "حصلت مشكلة"}`
              : "تمام يا باشا، نفذتلك الأمر فوراً.";
          socket.emit("ai_stream_chunk", {
            chunk: replyText,
            fullText: replyText,
            toolCompleted: executedToolEntry,
          });
          socket.emit("ai_stream_done", {
            text: replyText,
            model: "router-direct-call",
            executedTools: [executedToolEntry],
          });
          return;
        } catch (dcErr) {
          console.warn(`[DirectCall Error] Falling back to agent:`, dcErr.message);
        }
      }

      // Human-in-the-Loop Guard: If router determined this is a critical action (e.g. Shutdown, Restart)
      // halt immediate execution and prompt user for explicit confirmation
      if (requiresConfirmation) {
        const actionId = crypto.randomUUID();
        const inferRealAction = (txt, dom) => {
          const t = (txt || "").toLowerCase();
          if (/\brestart\b|إعادة تشغيل|اعاده تشغيل|رستر/.test(t)) return "restart";
          if (/\bshutdown\b|إيقاف تشغيل|ايقاف تشغيل|اقفل الجهاز|طفي الجهاز/.test(t)) return "shutdown";
          if (/\bkill\b|taskkill|اقفل برنامج|انهي عملية/.test(t)) return "kill";
          if (/\bdelete\b|حذف|امسح|احذف/.test(t)) return "delete";
          return dom === "power" ? "shutdown" : "sensitive_action";
        };
        const realAction = inferRealAction(effectiveText, effectiveDomain);
        const toolName =
          realAction === "restart" || realAction === "shutdown"
            ? "controlPower"
            : realAction === "kill"
              ? "listOrKillProcess"
              : realAction === "delete"
                ? "fileOperation"
                : null;

        pendingActionsMap.set(actionId, {
          socketId: socket.id,
          source: "router_guard",
          isRouterConfirmation: true,
          actionId,
          realAction,
          action: realAction,
          expiresAt: Date.now() + 30000,
          prompt: effectiveText,
          history,
          routeInfo,
          domain: effectiveDomain,
          complexity: effectiveComplexity,
          targetModel,
          maxSteps: effectiveMaxSteps,
          filteredTools,
        });

        console.log(`[Router Guard] Halted command awaiting confirmation: "${effectiveText}" (Action ID: ${actionId}, realAction: ${realAction})`);

        socket.emit("ai_confirmation_required", {
          id: actionId,
          actionId,
          action: realAction,
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
            action: realAction,
            title: `تأكيد أمر حساس: ${effectiveText}`,
            reason: routeInfo?.reasoning || "أمر حساس يتطلب موافقة صريحة قبل التنفيذ",
          },
        });
        return;
      }

      const rawCandidates = [
        targetModel,
        ...FALLBACK_MODELS.filter((m) => m !== targetModel),
      ];
      // Vision domain MUST ONLY use multimodal models (never text-only Groq/OSS models)
      const candidateModels =
        effectiveDomain === "vision"
          ? ["gemini-3.1-flash-lite", "gemma-4-31b-it", "gemini-3-flash-preview"]
          : rawCandidates;

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
                const actionId = res.pendingAction.id || crypto.randomUUID();
                pendingAction.id = actionId;
                pendingActionsMap.set(actionId, {
                  socketId: socket.id,
                  toolName: res.pendingAction.toolName || part.toolName,
                  realAction: res.pendingAction.realAction || res.pendingAction.action,
                  action: res.pendingAction.realAction || res.pendingAction.action,
                  args: res.pendingAction.args || part.args || part.input || {},
                  actionId,
                  expiresAt: Date.now() + 30000,
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

          if (streamHasError && executedTools.length > 0) {
            const lastToolMsg = executedTools[executedTools.length - 1]?.result?.message;
            console.warn(`[AI Stream] Error after executing ${executedTools.length} tool(s). Returning executed tool result without fallback re-execution.`);
            socket.emit("ai_stream_done", {
              text: fullText || lastToolMsg || "تم تنفيذ الأداة بنجاح.",
              executedTools,
              pendingAction,
            });
            break;
          }

          if (streamHasError && !receivedAnyText && executedTools.length === 0 && isDemandOrQuotaError(lastHandledError) && mIdx < candidateModels.length - 1) {
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
                    const actionId = resObj.pendingAction.id || crypto.randomUUID();
                    pendingAction.id = actionId;
                    pendingActionsMap.set(actionId, {
                      socketId: socket.id,
                      toolName: resObj.pendingAction.toolName || rec.toolName,
                      realAction: resObj.pendingAction.realAction || resObj.pendingAction.action,
                      action: resObj.pendingAction.realAction || resObj.pendingAction.action,
                      args: resObj.pendingAction.args || rec.args || {},
                      actionId,
                      expiresAt: Date.now() + 30000,
                    });
                  }
                }
                socket.emit("ai_stream_chunk", { chunk: "", fullText, pendingAction });
              }
            }

            // Anti-Hallucination Guard for YouTube domain: never allow fake text-only reply without executing playYoutubeVideo
            if (
              effectiveDomain === "youtube" &&
              executedTools.length === 0 &&
              filteredTools?.playYoutubeVideo?.execute
            ) {
              const sanitizedQuery = String(effectiveText || prompt || "")
                .replace(/^(?:افتح|شغل)(?:\s+(?:لي|لنا))?\s+(?:ال)?يوتيوب\s*(?:على|عن)?\s*/i, "")
                .trim();
              const ytArgs = { query: sanitizedQuery || "YouTube" };
              console.warn(
                `[Socket YouTube Guard] Enforcing playYoutubeVideo(${JSON.stringify(ytArgs)}) to prevent fake text reply.`
              );
              const ytOut = await filteredTools.playYoutubeVideo.execute(ytArgs);
              const ytInfo = { name: "playYoutubeVideo", args: ytArgs, result: ytOut };
              executedTools.push(ytInfo);
              fullText = ytOut?.message || fullText || "✓ تم فتح يوتيوب في المقدمة يا باشا!";
              socket.emit("ai_stream_chunk", {
                chunk: "",
                fullText,
                toolCompleted: ytInfo,
              });
            }

            // Anti-Hallucination Guard for Vision domain: never allow text-only reply without live screenshot analysis
            if (
              effectiveDomain === "vision" &&
              executedTools.length === 0 &&
              filteredTools?.captureAndAnalyzeScreen?.execute
            ) {
              const visionArgs = {
                question: String(effectiveText || prompt || "صف ما يظهر على الشاشة الحالية بإيجاز واضح."),
              };
              console.warn(
                `[Socket Vision Guard] Enforcing captureAndAnalyzeScreen to prevent text-only reply.`
              );
              const visionOut = await filteredTools.captureAndAnalyzeScreen.execute(visionArgs);
              const visionInfo = { name: "captureAndAnalyzeScreen", args: visionArgs, result: visionOut };
              executedTools.push(visionInfo);
              fullText = visionOut?.analysis || visionOut?.message || fullText || "تم التقاط الشاشة وتحليلها.";
              socket.emit("ai_stream_chunk", {
                chunk: "",
                fullText,
                toolCompleted: visionInfo,
              });
            }

            let totalTokens = null;
            try {
              const usage = await result.usage;
              if (usage && typeof usage.totalTokens === "number") {
                totalTokens = usage.totalTokens;
              }
            } catch (_) {}

            streamSucceeded = true;
            socket.emit("ai_stream_done", {
              text: fullText || "",
              model: currentModel,
              executedTools,
              pendingAction,
              debugTrace: {
                heardText: payload?.rawHeardText || prompt,
                cleanText: effectiveText,
                domain: effectiveDomain,
                model: currentModel,
                tokens: totalTokens ?? "auto",
              },
            });
            break;
          }
        } catch (err) {
          console.error(`[AI Execution Error on ${currentModel}]:`, err.message);
          if (executedTools.length > 0) {
            const lastToolMsg = executedTools[executedTools.length - 1]?.result?.message;
            console.warn(`[AI Stream Catch] Error after executing ${executedTools.length} tool(s). Returning executed tool result without fallback re-execution.`);
            socket.emit("ai_stream_done", {
              text: fullText || lastToolMsg || "تم تنفيذ الأداة بنجاح.",
              executedTools,
              pendingAction,
            });
            break;
          }
          if (!receivedAnyText && executedTools.length === 0 && isDemandOrQuotaError(err) && mIdx < candidateModels.length - 1) {
            console.warn(`[AI Stream Catch] Model ${currentModel} failed with 503/429. Trying next fallback model...`);
            continue;
          }
          handleStreamError(err);
          break;
        }
      }
    });

    // Human-in-the-Loop Confirmation for sensitive actions (server-authoritative)
    socket.on("ai_confirm_action", async (payload = {}) => {
      let { actionId, confirmed } = payload || {};
      let pending = actionId ? pendingActionsMap.get(actionId) : null;

      // Safe fallback: find the latest pending action for this socket.id if actionId was omitted
      if (!pending && !actionId) {
        for (const [id, entry] of pendingActionsMap.entries()) {
          if (entry.socketId === socket.id) {
            actionId = id;
            pending = entry;
          }
        }
      }

      console.log(
        `[AI HITL] Confirmation received: ${actionId}, confirmed: ${confirmed}, found: ${Boolean(pending)}`,
      );

      if (!pending || pending.socketId !== socket.id) {
        socket.emit("ai_action_confirmed", {
          actionId,
          success: false,
          error: "طلب التأكيد غير صالح أو لا يخص هذا الاتصال.",
        });
        return;
      }

      if (pending.expiresAt && Date.now() > pending.expiresAt) {
        pendingActionsMap.delete(actionId);
        socket.emit("ai_action_confirmed", {
          actionId,
          action: pending.realAction,
          success: false,
          error: "انتهت صلاحية طلب التأكيد (30 ثانية). يرجى إعادة الطلب.",
        });
        return;
      }

      const realAction = pending.realAction || pending.action;

      if (!confirmed) {
        pendingActionsMap.delete(actionId);
        socket.emit("ai_action_cancelled", {
          actionId,
          action: realAction,
          message: `تم إلغاء الإجراء (${realAction}) بأمان بناءً على رغبتك.`,
        });
        return;
      }

      try {
        pendingActionsMap.delete(actionId);
        socket.emit("ai_stream_chunk", {
          chunk: `\n[جاري تنفيذ الإجراء المؤكد: ${realAction}...]`,
          fullText: `تم التأكيد. جاري تنفيذ الإجراء (${realAction}) الآن.`,
        });

        // Case 1: Confirmed from Router Guard (no pre-extracted toolName/args) -> re-run agent with original prompt & serverConfirmed: true
        if (pending.source === "router_guard" || !pending.toolName) {
          const baseTools = pending.filteredTools || aiTools;
          const confirmedTools = {};
          for (const [tName, tDef] of Object.entries(baseTools)) {
            confirmedTools[tName] = {
              ...tDef,
              execute: async (args) => tDef.execute(args, { serverConfirmed: true }),
            };
          }

          let fullText = "";
          const executedTools = [];
          const result = streamAiResponse({
            prompt: pending.prompt,
            history: pending.history || [],
            model: pending.targetModel,
            tools: confirmedTools,
            maxSteps: pending.maxSteps || 5,
            domain: pending.domain || "general",
            onError: (err) => {
              console.error("[AI HITL Router Guard Stream Error]:", err);
            },
          });

          for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
              const delta = part.textDelta || part.text || "";
              if (delta) {
                fullText += delta;
                socket.emit("ai_stream_chunk", { chunk: delta, fullText });
              }
            } else if (part.type === "tool-call") {
              socket.emit("ai_stream_chunk", {
                chunk: "",
                fullText,
                activeTool: { name: part.toolName, args: part.args || part.input || {} },
              });
            } else if (part.type === "tool-result") {
              const res = part.result || part.output;
              const toolResultInfo = {
                name: part.toolName,
                args: part.args || part.input || {},
                result: res,
              };
              executedTools.push(toolResultInfo);
              socket.emit("ai_stream_chunk", {
                chunk: "",
                fullText,
                toolCompleted: toolResultInfo,
              });
            }
          }

          const lastToolResult = executedTools[executedTools.length - 1]?.result;
          const isSuccess = executedTools.length > 0
            ? lastToolResult?.success === true
            : Boolean(fullText);

          if (isSuccess) {
            socket.emit("ai_action_confirmed", {
              actionId,
              action: realAction,
              success: true,
              verified: lastToolResult?.verified === true,
              message: lastToolResult?.message || fullText || "تم التنفيذ بنجاح.",
            });
          } else {
            socket.emit("ai_action_confirmed", {
              actionId,
              action: realAction,
              success: false,
              error: lastToolResult?.error || lastToolResult?.message || "فشل تنفيذ الإجراء.",
            });
          }

          socket.emit("ai_stream_done", {
            text: fullText || lastToolResult?.message || "تمت معالجة الطلب.",
            executedTools,
          });
          return;
        }

        // Case 2: Confirmed from a specific tool call (toolName && args)
        let execResult;
        if (pending.toolName && aiTools[pending.toolName]) {
          execResult = await aiTools[pending.toolName].execute(pending.args || {}, {
            serverConfirmed: true,
          });
        } else {
          execResult = await systemService.executePowerAction(realAction);
        }

        const isVerifiedSuccess = execResult?.success === true && execResult?.verified === true;

        if (isVerifiedSuccess) {
          socket.emit("ai_action_confirmed", {
            actionId,
            action: realAction,
            success: true,
            verified: true,
            message: execResult?.message || "تم التنفيذ والتحقق بنجاح.",
          });
          socket.emit("ai_stream_done", {
            text: `تم التأكيد وتنفيذ الإجراء (${realAction}) بنجاح: ${execResult?.message || ""}`,
            executedTools: [
              {
                name: pending.toolName || "controlPower",
                args: pending.args || { action: realAction },
                result: execResult,
              },
            ],
          });
        } else {
          const failureReason =
            execResult?.error || execResult?.message || "فشل تنفيذ الإجراء أو التحقق من نتيجته على النظام.";
          socket.emit("ai_action_confirmed", {
            actionId,
            action: realAction,
            success: false,
            verified: false,
            error: failureReason,
          });
        }
      } catch (err) {
        console.error("[AI HITL Execution Error]:", err);
        socket.emit("ai_action_confirmed", {
          actionId,
          action: realAction,
          success: false,
          error: err.message,
        });
      }
    });

    // --- Isolated Loly Baby World Sync (Strictly separated under loly:* & 'loly-room') ---
    const emitLolyPhoneStatus = () => {
      const room = io.sockets.adapter.rooms.get("loly-room");
      let phoneConnected = false;
      const roomSize = room ? room.size : 0;
      if (room) {
        for (const sid of room) {
          const clientSock = io.sockets.sockets.get(sid);
          if (clientSock?.data?.lolyRole === "mobile") {
            phoneConnected = true;
            break;
          }
        }
      }
      io.to("loly-room").emit("loly:phone_status", {
        phoneConnected,
        roomSize,
        ts: Date.now(),
      });
    };

    socket.on("loly:join", (payload = {}) => {
      socket.join("loly-room");
      if (payload?.role) {
        socket.data.lolyRole = payload.role;
      }
      emitLolyPhoneStatus();
    });

    socket.on("loly:motion", (data) => {
      if (!socket.rooms.has("loly-room")) {
        socket.join("loly-room");
        socket.data.lolyRole = "mobile";
        emitLolyPhoneStatus();
      }
      socket.to("loly-room").emit("loly:motion", data);
    });

    socket.on("loly:phone_status", (data = {}) => {
      if (!socket.rooms.has("loly-room")) {
        socket.join("loly-room");
      }
      if (data?.role) {
        socket.data.lolyRole = data.role;
      }
      socket.to("loly-room").emit("loly:phone_status", {
        ...data,
        ts: Date.now(),
      });
    });

    socket.on("loly:control", (data) => {
      socket.to("loly-room").emit("loly:control", data);
    });

    socket.on("disconnecting", () => {
      if (socket.rooms.has("loly-room")) {
        socket.data.lolyRole = null;
        setTimeout(emitLolyPhoneStatus, 50);
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
