import * as nutService from "../services/nutService.js";
import * as systemService from "../services/systemService.js";
import { streamAiResponse } from "../ai/agent.js";
import { isAiConfigured, env } from "../config/env.js";

// Keep track of pending confirmation actions per socket
const pendingActionsMap = new Map();

export function setupSocketHandler(io) {
  io.on("connection", (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

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
      let streamHasError = false;

      const handleStreamError = (error) => {
        streamHasError = true;
        const errMsg = error?.message || String(error);
        console.error("[AI Stream Runtime Error]:", errMsg);
        socket.emit("ai_error", {
          error: errMsg,
          details: String(error),
        });
        socket.emit("ai_stream_chunk", {
          chunk: `\n[خطأ]: ${errMsg}`,
          fullText: fullText
            ? `${fullText}\n[خطأ]: ${errMsg}`
            : `[خطأ]: ${errMsg}`,
        });
      };

      try {
        const result = streamAiResponse({
          prompt,
          history,
          onError: handleStreamError,
        });

        // Iterate through fullStream to receive text deltas and tool results in real time
        for await (const part of result.fullStream) {
          console.log("[AI Stream Part]:", part.type, part);

          if (part.type === "text-delta") {
            const chunk = part.text || part.textDelta || part.delta || "";
            if (chunk) {
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

            // Check if human-in-the-loop power confirmation is requested
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
          }
        }

        socket.emit("ai_stream_done", {
          text:
            fullText || (streamHasError ? "حدث خطأ أثناء معالجة الطلب." : ""),
          executedTools,
          pendingAction,
        });
      } catch (err) {
        console.error("====================================================");
        console.error("[AI AGENT EXECUTION ERROR DETECTED]:");
        console.error("Error Message:", err.message);
        console.error("Stack:", err.stack);
        console.error("====================================================");

        const errMsg = err.message || "خطأ غير معروف في خادم الذكاء الاصطناعي";
        socket.emit("ai_error", {
          error: errMsg,
          details: String(err),
        });

        socket.emit("ai_stream_chunk", {
          chunk: `\n[خطأ]: ${errMsg}`,
          fullText: fullText
            ? `${fullText}\n[خطأ]: ${errMsg}`
            : `[خطأ]: ${errMsg}`,
        });

        socket.emit("ai_stream_done", {
          text: fullText ? `${fullText}\n[خطأ]: ${errMsg}` : `[خطأ]: ${errMsg}`,
          executedTools,
          error: errMsg,
        });
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
