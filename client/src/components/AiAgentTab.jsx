import { useState, useEffect, useRef, useCallback } from "react";
import { socket } from "../socket";

// Wake Word Variations & Regexes matching all Egyptian Arabic & English phonetic forms of "ZAZA — ظاظا"
const WAKE_WORD_VARIANTS = [
  "ظاظا", "ظاظه", "ظاظة", "زازا", "زازه", "زازة",
  "زوزو", "زوزه", "زوزة", "ذاذا", "سازه", "زاقا",
  "زاكا", "زكا", "زكى", "زكي", "زادكا",
  "ZAZA", "zaza", "Zozo", "zozo", "Zaka", "zaka", "Zaqa",
];

const WAKE_WORD_DETECT_REGEX =
  /(?:^|\s)(?:(?:إيه|ايه|ألو|الو|يا|ازيك|إزيك|هاي|هالو|hey|hi|ok|okay|yo)\s+)*(?:ظاظا|ظاظه|ظاظة|زازا|زازه|زازة|زوزو|زوزه|زوزة|ذاذا|سازه|زاقا|زاكا|زكا|زكى|زكي|زادكا|zaza|zozo|zaka|zaqa)(?=$|\s|[،,!\.\?])/i;
const WAKE_WORD_STRIP_REGEX =
  /^(?:(?:إيه|ايه|ألو|الو|يا|ازيك|إزيك|هاي|هالو|hey|hi|ok|okay|yo)\s+)*(?:ظاظا|ظاظه|ظاظة|زازا|زازه|زازة|زوزو|زوزه|زوزة|ذاذا|سازه|زاقا|زاكا|زكا|زكى|زكي|زادكا|zaza|zozo|zaka|zaqa)[،,!\.\?\s]*/i;

const ZAZA_GREETINGS = [
  "إيه يا برنس، إيه الأخبار؟",
  "إيه يا كبير، عامل إيه، إيه أخبارك؟",
  "أؤمر يا صاحبي، ظاظا معاك!",
  "عيوني ليك يا هندسة، قول عايز إيه؟",
];

function extractAfterWakeWord(rawPiece) {
  const trimmed = String(rawPiece || "").trim();
  if (!trimmed) return "";
  if (WAKE_WORD_STRIP_REGEX.test(trimmed)) {
    return trimmed.replace(WAKE_WORD_STRIP_REGEX, "").trim();
  }
  const match = trimmed.match(WAKE_WORD_DETECT_REGEX);
  if (match && typeof match.index === "number") {
    const fromWake = trimmed.slice(match.index).trim();
    return fromWake.replace(WAKE_WORD_STRIP_REGEX, "").trim();
  }
  return trimmed;
}

/**
 * ASR Normalizer for Egyptian Arabic Web Speech API transcripts:
 * Fixes hamzas, split words ("افتح ال يوتيوب" -> "افتح اليوتيوب"), misheard platforms ("اليوتوب" -> "اليوتيوب"),
 * tech terms ("فلاش لايت" -> "flash-lite"), and fused colloquial verbs ("هاتلي" -> "هات لي").
 */
function normalizeArabicSpeech(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .trim()
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/(?:^|\s)ال\s+(يوتيوب|يوتوب|شاش[ةه]|صوت|فيديو|تاب|يمين|شمال|يسار)/gi, " ال$1")
    .replace(/\b(?:ال)?يوتوب\b/gi, "اليوتيوب")
    .replace(/\bيوتيوب\b/gi, "اليوتيوب")
    .replace(/\bفلاش\s*لايت\b/gi, "flash-lite")
    .replace(/\bفي\s+اس\s+كود\b/gi, "VS Code")
    .replace(/\bهاتلي\b/gi, "هات لي")
    .replace(/\bافتحلي\b/gi, "افتح لي")
    .replace(/\bشغلي\b/gi, "شغل لي")
    .replace(/\bعلي\s+شويه\b/gi, "علي شوية")
    .replace(/\bوطي\s+شويه\b/gi, "وطي شوية")
    .replace(/\s+/g, " ")
    .trim();
}

// 10-minute Anti-Prank Auto-Disarm timeout (600,000 ms)
const ZAKA_AUTO_DISARM_MS = 10 * 60 * 1000;
// 6-second awake window after saying "ظاظا" alone before returning to standby
const ZAKA_AWAKE_WINDOW_MS = 6000;
// 2.2-second Breath-Safe Silence Debounce while speaking a command
const SILENCE_DEBOUNCE_MS = 2200;
// 250ms safe cooldown after abort()/TTS end before starting a fresh SpeechRecognition session
const RECOGNITION_RESTART_DELAY_MS = 250;

export default function AiAgentTab() {
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        'أهلاً بيك يا باشا! أنا مساعدك الذكي "ZAZA — ظاظا". اضغط المايك في وضع العمل الصامت، أو فعّل "🌙 وضع السهرة (ZAZA - ظاظا)" وقول: "يا ظاظا علي شوية" أو "يا ظاظا افتح لي اليوتيوب".',
      tools: [],
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStreamText, setCurrentStreamText] = useState("");
  const [currentTools, setCurrentTools] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);

  // Voice Recognition & ZAKA Lounge Mode States
  const [isListening, setIsListening] = useState(false);
  const [isZakaMode, setIsZakaMode] = useState(false);
  // zakaPhase: 'off' | 'standby' | 'capturing' | 'disarmed' | 'mic_error'
  const [zakaPhase, setZakaPhase] = useState("off");
  const [liveHeardText, setLiveHeardText] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [speechSupported, setSpeechSupported] = useState(true);

  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const isZakaModeRef = useRef(false);
  const zakaPhaseRef = useRef("off");
  const committedTextRef = useRef("");
  const finalTranscriptRef = committedTextRef;
  const latestInterimRef = useRef("");
  const silenceTimerRef = useRef(null);
  const zakaAwakeTimerRef = useRef(null);
  const autoDisarmTimerRef = useRef(null);
  const modeSwitchTimerRef = useRef(null);
  const isUserStoppedRef = useRef(true);
  const isSilenceCompletedRef = useRef(false);
  const sendMessageRef = useRef(null);
  const wakeLockRef = useRef(null);
  const audioCtxRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const ttsResumeTimerRef = useRef(null);
  const wakeGreetingTimerRef = useRef(null);
  const micConstraintStreamRef = useRef(null);
  const speakReplyRef = useRef(null);

  const [socketStatus, setSocketStatus] = useState(socket.connected);
  const [showMagnifier, setShowMagnifier] = useState(false);
  const [showQuickChips, setShowQuickChips] = useState(false);

  // AI Quota Tracking State (RPM vs Daily)
  const [quotaStatus, setQuotaStatus] = useState(null);
  const [quotaAlert, setQuotaAlert] = useState(null);
  const [currentRouteInfo, setCurrentRouteInfo] = useState(null);

  const chatBottomRef = useRef(null);
  const inputRef = useRef(null);
  const touchStartRef = useRef(null);

  // Gentle 2-tone confirmation chime using Web Audio API when "زاقا" wake word is detected
  const playZakaChime = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(783.99, now + 0.08); // G5

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch (_) {}
  }, []);

  // Acquire or release Screen Wake Lock for ZAKA Lounge Mode
  const requestScreenWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release().catch(() => {});
      }
      wakeLockRef.current = await navigator.wakeLock.request("screen");
    } catch (_) {}
  }, []);

  const releaseScreenWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch (_) {}
      wakeLockRef.current = null;
    }
  }, []);

  // Clear timers helpers
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearZakaAwakeTimer = useCallback(() => {
    if (zakaAwakeTimerRef.current) {
      clearTimeout(zakaAwakeTimerRef.current);
      zakaAwakeTimerRef.current = null;
    }
  }, []);

  const clearAutoDisarmTimer = useCallback(() => {
    if (autoDisarmTimerRef.current) {
      clearTimeout(autoDisarmTimerRef.current);
      autoDisarmTimerRef.current = null;
    }
  }, []);

  // Disarm ZAKA mode automatically after 10 minutes of zero commands & zero touches
  const disarmZakaForSafety = useCallback(() => {
    clearSilenceTimer();
    clearZakaAwakeTimer();
    clearAutoDisarmTimer();
    isUserStoppedRef.current = true;
    isListeningRef.current = false;
    setIsListening(false);
    zakaPhaseRef.current = "disarmed";
    setZakaPhase("disarmed");
    finalTranscriptRef.current = "";
    latestInterimRef.current = "";
    releaseScreenWakeLock();

    try {
      recognitionRef.current?.stop();
    } catch (_) {}

    setSpeechError(
      "🛡️ تم إيقاف الاستماع التلقائي لـ (ZAZA — ظاظا) بعد 10 دقائق من عدم النشاط لحماية خصوصيتك.",
    );
  }, [
    clearSilenceTimer,
    clearZakaAwakeTimer,
    clearAutoDisarmTimer,
    releaseScreenWakeLock,
  ]);

  // Reset the 10-minute Anti-Prank Auto-Disarm timer on valid wake word or user touch
  const resetZakaAutoDisarmTimer = useCallback(() => {
    if (!isZakaModeRef.current || zakaPhaseRef.current === "disarmed") return;
    clearAutoDisarmTimer();
    autoDisarmTimerRef.current = setTimeout(() => {
      disarmZakaForSafety();
    }, ZAKA_AUTO_DISARM_MS);
  }, [clearAutoDisarmTimer, disarmZakaForSafety]);

  // Auto-resize textarea from 1 row up to max 3 rows (~84px)
  const syncTextareaHeight = useCallback((el) => {
    const target = el || inputRef.current;
    if (!target) return;
    target.style.height = "auto";
    const clamped = Math.min(Math.max(target.scrollHeight, 42), 88);
    target.style.height = `${clamped}px`;
  }, []);

  useEffect(() => {
    syncTextareaHeight();
  }, [inputText, syncTextareaHeight]);

  // Re-acquire screen wake lock if phone tab returns to foreground while ZAKA mode is armed
  useEffect(() => {
    const handleVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        isZakaModeRef.current &&
        zakaPhaseRef.current !== "disarmed"
      ) {
        requestScreenWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [requestScreenWakeLock]);

  // Monitor socket connection
  useEffect(() => {
    const handleConnect = () => setSocketStatus(true);
    const handleDisconnect = () => setSocketStatus(false);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

  // Auto-scroll chat to latest message
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentStreamText, isStreaming, pendingAction]);

  // Socket listeners for streaming AI responses & errors
  useEffect(() => {
    const handleChunk = (data) => {
      setIsStreaming(true);
      if (data?.chunk) {
        setCurrentStreamText((prev) => prev + data.chunk);
      }
      if (data?.toolCompleted) {
        setCurrentTools((prev) => [...prev, data.toolCompleted]);
      }
      if (data?.pendingAction) {
        setPendingAction(data.pendingAction);
      }
    };

    const handleDone = (data) => {
      setIsStreaming(false);
      const finalText = data?.text || currentStreamText;
      const finalTools = data?.executedTools || currentTools;

      if (finalText || finalTools.length > 0) {
        const trace = data?.debugTrace || {
          heardText: currentRouteInfo?.rawText || "",
          cleanText: currentRouteInfo?.cleanText || "",
          domain: currentRouteInfo?.domain || "chat",
          model: data?.model || currentRouteInfo?.targetModel || "gemini-3.1-flash-lite",
          tokens: currentRouteInfo?.targetModel === "local-fast-path" ? 0 : "auto",
        };
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: finalText,
            tools: finalTools,
            routeInfo: currentRouteInfo,
            debugTrace: trace,
          },
        ]);
      }

      if (finalText && isZakaModeRef.current && !data?.error && !data?.requiresConfirmation) {
        speakReplyRef.current?.(finalText, { resumePhase: "standby" });
      }

      if (data?.pendingAction) {
        setPendingAction(data.pendingAction);
      }

      setCurrentStreamText("");
      setCurrentTools([]);
    };

    const handleRouteInfo = (data) => {
      if (data) {
        setCurrentRouteInfo(data);
      }
    };

    const handleAiError = (data) => {
      setIsStreaming(false);
      const errText = data?.error || "خطأ غير معروف في خادم الذكاء الاصطناعي";
      const code = data?.code || "";
      const isKeyError =
        code === "KEY_MISSING" ||
        code === "API_KEY_INVALID" ||
        /key.*missing|invalid.*key|api_key/i.test(errText);
      const isDemandError =
        code === "HIGH_DEMAND" ||
        code === "OVERLOADED" ||
        /503|high demand|overloaded|quota/i.test(errText);

      let userFacingContent = `⚠️ ${errText}`;
      if (isKeyError) {
        userFacingContent = `⚠️ خطأ في مفتاح الذكاء الاصطناعي:\n${errText}\n\nيرجى التأكد من إضافة GOOGLE_GENERATIVE_AI_API_KEY صحيح في ملف server/.env.`;
      } else if (isDemandError) {
        userFacingContent = `⚠️ سيرفرات الذكاء الاصطناعي عليها ضغط مؤقت، تم تجربة البديل أو أعد المحاولة بعد ثوانٍ.`;
      }

      setSpeechError(
        `[تنبيه]: ${isDemandError ? "سيرفرات الذكاء الاصطناعي عليها ضغط مؤقت" : errText}`,
      );

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: userFacingContent,
          tools: [],
          isError: true,
        },
      ]);
    };

    const handleActionConfirmed = (data) => {
      setPendingAction(null);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data?.success
            ? `✓ ${data.message || "تم تأكيد وتنفيذ الأمر بنجاح."}`
            : `✕ فشل تنفيذ الأمر: ${data?.error || "خطأ غير معروف"}`,
          tools: [],
        },
      ]);
    };

    const handleActionCancelled = (data) => {
      setPendingAction(null);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `ℹ️ ${data?.message || "تم إلغاء الأمر بأمان بناءً على رغبتك."}`,
          tools: [],
        },
      ]);
    };

    const handleConfirmationRequired = (data) => {
      if (data) {
        setPendingAction(data);
      }
    };

    socket.on("ai_stream_chunk", handleChunk);
    socket.on("ai_stream_done", handleDone);
    socket.on("ai_error", handleAiError);
    socket.on("ai_action_confirmed", handleActionConfirmed);
    socket.on("ai_action_cancelled", handleActionCancelled);
    socket.on("ai_confirmation_required", handleConfirmationRequired);
    socket.on("ai_route_info", handleRouteInfo);

    return () => {
      socket.off("ai_stream_chunk", handleChunk);
      socket.off("ai_stream_done", handleDone);
      socket.off("ai_error", handleAiError);
      socket.off("ai_action_confirmed", handleActionConfirmed);
      socket.off("ai_action_cancelled", handleActionCancelled);
      socket.off("ai_confirmation_required", handleConfirmationRequired);
      socket.off("ai_route_info", handleRouteInfo);
    };
  }, [currentStreamText, currentTools, currentRouteInfo]);

  // Listen to live AI quota updates and fallback alerts from server
  useEffect(() => {
    const handleQuotaStatus = (data) => {
      if (data?.quotaStats) {
        setQuotaStatus(data.quotaStats);
      }
      if (data?.type === "ai_fallback_triggered" && data.reason) {
        setQuotaAlert(`⚠️ تم التحويل إلى ${data.nextModel}: ${data.reason}`);
        setTimeout(() => setQuotaAlert(null), 6000);
      }
    };

    socket.on("ai_quota_status", handleQuotaStatus);
    return () => {
      socket.off("ai_quota_status", handleQuotaStatus);
    };
  }, []);

  const clearModeSwitchTimer = useCallback(() => {
    if (modeSwitchTimerRef.current) {
      clearTimeout(modeSwitchTimerRef.current);
      modeSwitchTimerRef.current = null;
    }
  }, []);

  const clearTtsResumeTimer = useCallback(() => {
    if (ttsResumeTimerRef.current) {
      clearTimeout(ttsResumeTimerRef.current);
      ttsResumeTimerRef.current = null;
    }
  }, []);

  const clearWakeGreetingTimer = useCallback(() => {
    if (wakeGreetingTimerRef.current) {
      clearTimeout(wakeGreetingTimerRef.current);
      wakeGreetingTimerRef.current = null;
    }
  }, []);

  // Enable WebRTC echoCancellation + noiseSuppression for hands-free wireless headset / distant mic
  const enableHandsFreeAudioConstraints = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) return;
    try {
      if (micConstraintStreamRef.current) {
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micConstraintStreamRef.current = stream;
    } catch (_) {
      // Non-fatal: SpeechRecognition can still operate with browser defaults
    }
  }, []);

  const releaseHandsFreeAudioConstraints = useCallback(() => {
    if (micConstraintStreamRef.current) {
      try {
        micConstraintStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      micConstraintStreamRef.current = null;
    }
  }, []);

  // Egyptian Male TTS (POST /api/zaza/tts -> ar-EG-ShakirNeural, fallback to Web Speech) + Headset Anti-Echo + 6s Watchdog
  const speakReply = useCallback(
    async (rawText, options = {}) => {
      if (typeof window === "undefined") return;
      const cleanSpeech = String(rawText || "")
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
        .replace(/[✓✕⚠️⚡🛡️🎙️🔊🔉🔇⏯️⬇️⬆️🍿🌙🤖🎯]/g, " ")
        .replace(/\(\+?-?\d+%?[^)]*\)/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!cleanSpeech) return;

      clearTtsResumeTimer();

      // Pre-emptively pause recognition before speaking to guarantee zero echo capture (Anti-Echo)
      isSpeakingRef.current = true;
      isUserStoppedRef.current = true;
      isListeningRef.current = false;
      setIsListening(false);
      clearModeSwitchTimer();
      try {
        recognitionRef.current?.abort();
      } catch (_) {}

      let resumed = false;
      let watchdogTimer = null;

      const resumeAfterSpeech = () => {
        if (resumed) return;
        resumed = true;
        if (watchdogTimer) {
          clearTimeout(watchdogTimer);
          watchdogTimer = null;
        }
        isSpeakingRef.current = false;
        clearTtsResumeTimer();
        ttsResumeTimerRef.current = setTimeout(() => {
          ttsResumeTimerRef.current = null;
          if (
            isZakaModeRef.current &&
            zakaPhaseRef.current !== "disarmed" &&
            zakaPhaseRef.current !== "mic_error"
          ) {
            const targetPhase = options.resumePhase || zakaPhaseRef.current || "standby";
            zakaPhaseRef.current = targetPhase;
            setZakaPhase(targetPhase);
            isUserStoppedRef.current = false;
            isSilenceCompletedRef.current = false;
            try {
              recognitionRef.current?.start();
            } catch (_) {}

            if (targetPhase === "capturing") {
              clearZakaAwakeTimer();
              zakaAwakeTimerRef.current = setTimeout(() => {
                if (
                  isZakaModeRef.current &&
                  zakaPhaseRef.current === "capturing" &&
                  !finalTranscriptRef.current &&
                  !latestInterimRef.current
                ) {
                  zakaPhaseRef.current = "standby";
                  setZakaPhase("standby");
                }
              }, ZAKA_AWAKE_WINDOW_MS);
            }
          }
        }, 250);
      };

      // 6s safety Watchdog timer
      watchdogTimer = setTimeout(() => {
        resumeAfterSpeech();
      }, 6000);

      try {
        const res = await fetch("/api/zaza/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: cleanSpeech }),
          signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          resumeAfterSpeech();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          resumeAfterSpeech();
        };
        await audio.play();
        return;
      } catch (err) {
        console.warn("[ZAZA TTS Fetch Fallback]:", err?.message || err);
      }

      // Fallback to browser Web Speech API
      if (!("speechSynthesis" in window)) {
        resumeAfterSpeech();
        return;
      }

      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(cleanSpeech);
        utterance.lang = "ar-EG";
        utterance.pitch = 0.92;
        utterance.rate = 1.05;

        const voices = window.speechSynthesis.getVoices() || [];
        const arVoices = voices.filter((v) => /^ar\b/i.test(v.lang || ""));
        const selectedVoice =
          voices.find((v) => /shakir/i.test(v.name)) ||
          voices.find((v) => /hamed/i.test(v.name)) ||
          arVoices.find(
            (v) =>
              /ar-EG/i.test(v.lang) &&
              !/salma|hoda|zariyah|fatima|amira|laila|female/i.test(v.name),
          ) ||
          arVoices[0] ||
          null;

        if (selectedVoice) {
          utterance.voice = selectedVoice;
          utterance.lang = selectedVoice.lang || "ar-EG";
        }

        utterance.onend = resumeAfterSpeech;
        utterance.onerror = resumeAfterSpeech;
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("[ZAZA WebSpeech Fallback Error]:", err);
        resumeAfterSpeech();
      }
    },
    [clearModeSwitchTimer, clearTtsResumeTimer, clearZakaAwakeTimer],
  );

  speakReplyRef.current = speakReply;

  // Detect insecure HTTP origin on mobile LAN (where Chrome blocks Web Speech / Microphone)
  const getInsecureOriginWarning = useCallback(() => {
    if (typeof window === "undefined") return "";
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (!window.isSecureContext && !isLocal) {
      return `❌ المتصفح يمنع المايكروفون لأن الصفحة مفتوحة عبر رابط غير آمن (http://${host}). افتح الرابط عبر HTTPS (مثل Dev Tunnels) لتشغيل المايك على الموبايل.`;
    }
    return "";
  }, []);

  // Abort any active SpeechRecognition session cleanly via single recognitionRef
  const abortVoiceSession = useCallback(() => {
    clearModeSwitchTimer();
    clearSilenceTimer();
    clearZakaAwakeTimer();
    isUserStoppedRef.current = true;
    isListeningRef.current = false;
    setIsListening(false);
    try {
      recognitionRef.current?.abort();
    } catch (_) {}
  }, [clearModeSwitchTimer, clearSilenceTimer, clearZakaAwakeTimer]);

  // Stop voice recognition intentionally (manual mode stop)
  const stopVoiceSession = useCallback(() => {
    abortVoiceSession();
  }, [abortVoiceSession]);

  // Safely abort any previous session, wait 250ms, then start recognitionRef
  const restartRecognitionSafely = useCallback(
    (onStartedPhase = null) => {
      const insecureMsg = getInsecureOriginWarning();
      if (insecureMsg) {
        abortVoiceSession();
        if (isZakaModeRef.current) {
          zakaPhaseRef.current = "mic_error";
          setZakaPhase("mic_error");
        }
        setSpeechError(insecureMsg);
        return;
      }

      clearModeSwitchTimer();
      isUserStoppedRef.current = true;
      isListeningRef.current = false;
      setIsListening(false);
      try {
        recognitionRef.current?.abort();
      } catch (_) {}

      modeSwitchTimerRef.current = setTimeout(() => {
        modeSwitchTimerRef.current = null;
        isUserStoppedRef.current = false;
        isSilenceCompletedRef.current = false;
        if (onStartedPhase && isZakaModeRef.current) {
          zakaPhaseRef.current = onStartedPhase;
          setZakaPhase(onStartedPhase);
        }
        try {
          recognitionRef.current?.start();
        } catch (err) {
          console.error("[SpeechRecognition start error]:", err);
          isUserStoppedRef.current = true;
          isListeningRef.current = false;
          setIsListening(false);
          if (isZakaModeRef.current) {
            zakaPhaseRef.current = "mic_error";
            setZakaPhase("mic_error");
          }
          setSpeechError(`⚠️ تعذر بدء المايكروفون (${err?.name || "خطأ"}): اضغط إعادة تنشيط المايك.`);
        }
      }, RECOGNITION_RESTART_DELAY_MS);
    },
    [abortVoiceSession, clearModeSwitchTimer, getInsecureOriginWarning],
  );

  // Web Speech API Voice Recognition (ar-EG, Continuous + 2000ms Smart Silence + ZAKA Wake Word)
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    let resumeTimeoutId = null;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "ar-EG";

      recognition.onstart = () => {
        setIsListening(true);
        isListeningRef.current = true;
        setSpeechError("");
      };

      recognition.onresult = (event) => {
        // --- MODE A: ZAKA LOUNGE MODE (Wake-Word Guarded: 1-stage or 2-stage) ---
        if (isZakaModeRef.current) {
          if (
            zakaPhaseRef.current === "disarmed" ||
            zakaPhaseRef.current === "mic_error"
          ) {
            return;
          }

          let newlyFinalized = "";
          let interimTranscript = "";
          let rawMonitorSnippet = "";
          let wakeTriggeredNow = false;

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const rawPiece = event.results[i][0].transcript || "";
            const isFinal = event.results[i].isFinal;
            rawMonitorSnippet += rawPiece + " ";

            if (zakaPhaseRef.current === "standby") {
              if (WAKE_WORD_DETECT_REGEX.test(rawPiece)) {
                // Wake word detected! Supports One-Breath Command OR Wake-Only Egyptian Male Greeting
                wakeTriggeredNow = true;
                zakaPhaseRef.current = "capturing";
                setZakaPhase("capturing");
                finalTranscriptRef.current = "";
                latestInterimRef.current = "";
                playZakaChime();
                resetZakaAutoDisarmTimer();

                const afterWake = extractAfterWakeWord(rawPiece);
                if (afterWake) {
                  clearWakeGreetingTimer();
                  if (isFinal) {
                    newlyFinalized += afterWake + " ";
                  } else {
                    interimTranscript += afterWake;
                  }
                }
              }
            } else if (zakaPhaseRef.current === "capturing") {
              // Strip leading wake-word if browser re-emitted the same interim segment containing wake word
              const cleanedPiece = WAKE_WORD_DETECT_REGEX.test(rawPiece)
                ? extractAfterWakeWord(rawPiece)
                : rawPiece;

              if (cleanedPiece) {
                clearWakeGreetingTimer();
              }

              if (isFinal) {
                newlyFinalized += cleanedPiece + " ";
              } else {
                interimTranscript += cleanedPiece;
              }
            }
          }

          // Always update liveHeardText in ZAKA OLED screen so user sees real-time proof the mic hears them
          const trimmedMonitor = rawMonitorSnippet.replace(/\s+/g, " ").trim();
          if (trimmedMonitor) {
            setLiveHeardText(trimmedMonitor);
          }

          if (zakaPhaseRef.current !== "capturing") {
            return;
          }

          const cleanNewFinal = newlyFinalized.replace(/\s+/g, " ").trim();
          if (cleanNewFinal) {
            if (
              finalTranscriptRef.current &&
              cleanNewFinal.startsWith(finalTranscriptRef.current)
            ) {
              finalTranscriptRef.current = cleanNewFinal;
            } else {
              finalTranscriptRef.current = [
                finalTranscriptRef.current,
                cleanNewFinal,
              ]
                .filter(Boolean)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
            }
          }

          latestInterimRef.current = interimTranscript
            .replace(/\s+/g, " ")
            .trim();

          const liveCommand = [
            finalTranscriptRef.current,
            latestInterimRef.current,
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

          if (liveCommand) {
            clearZakaAwakeTimer();
            clearWakeGreetingTimer();
            setInputText(liveCommand);

            // Reset 2000ms Smart Silence Debounce for ZAZA One-Breath / Captured command
            clearSilenceTimer();
            silenceTimerRef.current = setTimeout(() => {
              silenceTimerRef.current = null;
              const finalCmd = [
                finalTranscriptRef.current,
                latestInterimRef.current,
              ]
                .filter(Boolean)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();

              finalTranscriptRef.current = "";
              latestInterimRef.current = "";
              zakaPhaseRef.current = "standby";
              setZakaPhase("standby");
              setInputText("");

              if (finalCmd) {
                resetZakaAutoDisarmTimer();
                sendMessageRef.current?.(finalCmd, { keepZakaAlive: true });
              }
            }, SILENCE_DEBOUNCE_MS);
          } else if (wakeTriggeredNow) {
            // User called ZAZA alone without an immediate trailing command -> respond with friendly Egyptian male greeting
            clearWakeGreetingTimer();
            wakeGreetingTimerRef.current = setTimeout(() => {
              wakeGreetingTimerRef.current = null;
              if (
                isZakaModeRef.current &&
                zakaPhaseRef.current === "capturing" &&
                !finalTranscriptRef.current &&
                !latestInterimRef.current
              ) {
                const greeting =
                  ZAZA_GREETINGS[Math.floor(Math.random() * ZAZA_GREETINGS.length)];
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: greeting, tools: [] },
                ]);
                speakReplyRef.current?.(greeting, { resumePhase: "capturing" });
              }
            }, 650);

            clearZakaAwakeTimer();
            zakaAwakeTimerRef.current = setTimeout(() => {
              if (
                isZakaModeRef.current &&
                zakaPhaseRef.current === "capturing" &&
                !finalTranscriptRef.current &&
                !latestInterimRef.current &&
                !isSpeakingRef.current
              ) {
                zakaPhaseRef.current = "standby";
                setZakaPhase("standby");
              }
            }, ZAKA_AWAKE_WINDOW_MS);
          }
          return;
        }

        // --- MODE B: MANUAL DISCREET MIC MODE (Work / Normal Mode) ---
        let interimTranscript = "";
        let newlyFinalized = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcriptPiece = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            newlyFinalized += transcriptPiece + " ";
          } else {
            interimTranscript += transcriptPiece;
          }
        }

        const cleanNewFinal = newlyFinalized.replace(/\s+/g, " ").trim();
        if (cleanNewFinal) {
          if (
            finalTranscriptRef.current &&
            cleanNewFinal.startsWith(finalTranscriptRef.current)
          ) {
            finalTranscriptRef.current = cleanNewFinal;
          } else {
            finalTranscriptRef.current = [
              finalTranscriptRef.current,
              cleanNewFinal,
            ]
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
          }
        }

        latestInterimRef.current = interimTranscript.replace(/\s+/g, " ").trim();

        const liveCombinedText = [
          finalTranscriptRef.current,
          latestInterimRef.current,
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (liveCombinedText) {
          setInputText(liveCombinedText);
        }

        // Reset Smart Silence Debounce (2000ms)
        clearSilenceTimer();
        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;
          const completeSentence = [
            finalTranscriptRef.current,
            latestInterimRef.current,
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

          if (completeSentence) {
            isSilenceCompletedRef.current = true;
            isUserStoppedRef.current = true;
            isListeningRef.current = false;
            setIsListening(false);

            try {
              recognition.stop();
            } catch (_) {}

            finalTranscriptRef.current = "";
            latestInterimRef.current = "";
            sendMessageRef.current?.(completeSentence);
          }
        }, SILENCE_DEBOUNCE_MS);
      };

      recognition.onerror = (event) => {
        if (event.error === "aborted" && isUserStoppedRef.current) {
          return;
        }
        if (event.error === "no-speech" && !isUserStoppedRef.current) {
          return;
        }

        console.error("[Web Speech API Error]:", event.error);

        clearSilenceTimer();
        clearZakaAwakeTimer();
        isUserStoppedRef.current = true;
        setIsListening(false);
        isListeningRef.current = false;

        const insecureMsg = getInsecureOriginWarning();
        if (insecureMsg) {
          if (isZakaModeRef.current) {
            zakaPhaseRef.current = "mic_error";
            setZakaPhase("mic_error");
          }
          setSpeechError(insecureMsg);
          return;
        }

        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          clearAutoDisarmTimer();
          if (isZakaModeRef.current) {
            zakaPhaseRef.current = "mic_error";
            setZakaPhase("mic_error");
          }
          setSpeechError(
            "❌ تم رفض صلاحية الميكروفون في المتصفح (أو الرابط غير آمن HTTP). اسمح بالمايك من إعدادات المتصفح أو استخدم HTTPS.",
          );
          return;
        }

        if (event.error === "audio-capture") {
          if (isZakaModeRef.current) {
            zakaPhaseRef.current = "mic_error";
            setZakaPhase("mic_error");
          }
          setSpeechError("❌ تعذر الوصول إلى المايكروفون (قد يكون مستخدماً في تطبيق آخر).");
          return;
        }

        if (event.error !== "no-speech") {
          if (isZakaModeRef.current) {
            zakaPhaseRef.current = "mic_error";
            setZakaPhase("mic_error");
          }
          setSpeechError(`⚠️ توقف المايكروفون بسبب خطأ (${event.error}). اضغط إعادة تشغيل المايك.`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        isListeningRef.current = false;

        // Auto-Resume during breath pause (in manual mode) or continuous standby (in ZAZA mode), but NEVER while TTS is speaking
        if (!isUserStoppedRef.current && !isSilenceCompletedRef.current && !isSpeakingRef.current) {
          if (latestInterimRef.current) {
            finalTranscriptRef.current = [
              finalTranscriptRef.current,
              latestInterimRef.current,
            ]
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            latestInterimRef.current = "";
          }

          resumeTimeoutId = setTimeout(() => {
            if (!isUserStoppedRef.current && !isSilenceCompletedRef.current) {
              try {
                recognition.start();
              } catch (_) {
                setIsListening(false);
                isListeningRef.current = false;
              }
            }
          }, RECOGNITION_RESTART_DELAY_MS);
        }
      };

      recognitionRef.current = recognition;
    } catch (err) {
      console.error("SpeechRecognition initialization failed:", err);
      setSpeechSupported(false);
    }

    return () => {
      clearModeSwitchTimer();
      clearTtsResumeTimer();
      clearWakeGreetingTimer();
      clearSilenceTimer();
      clearZakaAwakeTimer();
      clearAutoDisarmTimer();
      releaseScreenWakeLock();
      releaseHandsFreeAudioConstraints();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch (_) {}
      }
      if (resumeTimeoutId) {
        clearTimeout(resumeTimeoutId);
      }
      isUserStoppedRef.current = true;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
      }
    };
  }, [
    clearModeSwitchTimer,
    clearTtsResumeTimer,
    clearWakeGreetingTimer,
    clearSilenceTimer,
    clearZakaAwakeTimer,
    clearAutoDisarmTimer,
    getInsecureOriginWarning,
    playZakaChime,
    releaseScreenWakeLock,
    releaseHandsFreeAudioConstraints,
    resetZakaAutoDisarmTimer,
  ]);

  // Toggle "🌙 وضع السهرة (ZAZA - ظاظا)" (Unified recognitionRef + Anti-Echo Audio Constraints)
  const toggleZakaMode = async () => {
    if (!speechSupported) {
      setSpeechError(
        "المتصفح لا يدعم Web Speech API. يُرجى استخدام متصفح Google Chrome.",
      );
      return;
    }

    if (isZakaModeRef.current) {
      // Turn OFF ZAZA Lounge Mode -> abort() cleanly & return to discreet manual mode
      clearAutoDisarmTimer();
      clearTtsResumeTimer();
      clearWakeGreetingTimer();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch (_) {}
      }
      isSpeakingRef.current = false;
      isZakaModeRef.current = false;
      setIsZakaMode(false);
      zakaPhaseRef.current = "off";
      setZakaPhase("off");
      setLiveHeardText("");
      finalTranscriptRef.current = "";
      latestInterimRef.current = "";
      abortVoiceSession();
      releaseHandsFreeAudioConstraints();
      await releaseScreenWakeLock();
      return;
    }

    // Turn ON ZAZA Lounge Mode: enable echoCancellation + noiseSuppression, abort previous, start night session
    finalTranscriptRef.current = "";
    latestInterimRef.current = "";
    setLiveHeardText("");
    setSpeechError("");

    isZakaModeRef.current = true;
    setIsZakaMode(true);
    zakaPhaseRef.current = "standby";
    setZakaPhase("standby");

    playZakaChime();
    await enableHandsFreeAudioConstraints();
    await requestScreenWakeLock();
    resetZakaAutoDisarmTimer();
    restartRecognitionSafely("standby");
  };

  // Re-arm ZAKA mode after 10-minute auto-disarm or mic error
  const handleRearmZaka = async () => {
    if (!isZakaModeRef.current) return;
    setSpeechError("");
    setLiveHeardText("");
    finalTranscriptRef.current = "";
    latestInterimRef.current = "";
    playZakaChime();
    await requestScreenWakeLock();
    resetZakaAutoDisarmTimer();
    restartRecognitionSafely("standby");
  };

  // Manual Mic button toggle (works discreetly outside ZAKA mode, or triggers immediate capture inside ZAKA mode)
  const toggleListening = () => {
    if (!speechSupported) {
      setSpeechError(
        "المتصفح لا يدعم Web Speech API. يُرجى استخدام متصفح Google Chrome.",
      );
      return;
    }

    if (isZakaModeRef.current) {
      if (
        zakaPhaseRef.current === "disarmed" ||
        zakaPhaseRef.current === "mic_error" ||
        !isListeningRef.current
      ) {
        handleRearmZaka();
        return;
      }
      if (zakaPhaseRef.current === "capturing") {
        clearSilenceTimer();
        clearZakaAwakeTimer();
        finalTranscriptRef.current = "";
        latestInterimRef.current = "";
        zakaPhaseRef.current = "standby";
        setZakaPhase("standby");
        setInputText("");
      } else {
        zakaPhaseRef.current = "capturing";
        setZakaPhase("capturing");
        playZakaChime();
        resetZakaAutoDisarmTimer();
        clearZakaAwakeTimer();
        zakaAwakeTimerRef.current = setTimeout(() => {
          if (
            isZakaModeRef.current &&
            zakaPhaseRef.current === "capturing" &&
            !finalTranscriptRef.current &&
            !latestInterimRef.current
          ) {
            zakaPhaseRef.current = "standby";
            setZakaPhase("standby");
          }
        }, ZAKA_AWAKE_WINDOW_MS);
      }
      return;
    }

    // Normal Manual Mode (Discreet Work Mode)
    if (isListeningRef.current) {
      abortVoiceSession();
      finalTranscriptRef.current = "";
      latestInterimRef.current = "";
    } else {
      finalTranscriptRef.current = "";
      latestInterimRef.current = "";
      setInputText("");
      setSpeechError("");
      restartRecognitionSafely(null);
    }
  };

  const handleInstantVoiceSend = () => {
    const assembledText = (
      [finalTranscriptRef.current, latestInterimRef.current]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim() || inputText.trim()
    );

    clearSilenceTimer();
    clearZakaAwakeTimer();
    finalTranscriptRef.current = "";
    latestInterimRef.current = "";

    if (isZakaModeRef.current) {
      zakaPhaseRef.current = "standby";
      setZakaPhase("standby");
      resetZakaAutoDisarmTimer();
      if (assembledText) {
        handleSendMessage(assembledText, { keepZakaAlive: true });
      }
      return;
    }

    stopVoiceSession();
    if (assembledText) {
      handleSendMessage(assembledText);
    }
  };

  const handleSendMessage = (textToSend, options = {}) => {
    if (!options.keepZakaAlive && isListeningRef.current && !isZakaModeRef.current) {
      stopVoiceSession();
      finalTranscriptRef.current = "";
      latestInterimRef.current = "";
    }

    const rawPrompt = (textToSend ?? inputText).trim();
    // Strip optional wake word prefix if user typed or spoke it manually
    const strippedPrompt = rawPrompt.replace(WAKE_WORD_STRIP_REGEX, "").trim();
    const isWakeWordOnly = WAKE_WORD_DETECT_REGEX.test(rawPrompt) && !strippedPrompt;
    if (isWakeWordOnly) {
      const greeting =
        ZAZA_GREETINGS[Math.floor(Math.random() * ZAZA_GREETINGS.length)];
      setMessages((prev) => [
        ...prev,
        { role: "user", content: rawPrompt, tools: [] },
        { role: "assistant", content: greeting, tools: [] },
      ]);
      setInputText("");
      speakReplyRef.current?.(greeting, { resumePhase: "capturing" });
      return;
    }

    const prompt = normalizeArabicSpeech(strippedPrompt || rawPrompt);
    if (!prompt || isStreaming) return;

    if (!socket.connected) {
      setSpeechError(
        "⚠️ السيرفر غير متصل حالياً! جاري محاولة إعادة الاتصال...",
      );
      socket.connect();
      return;
    }

    setMessages((prev) => [
      ...prev,
      { role: "user", content: prompt, tools: [] },
    ]);
    setInputText("");
    setSpeechError("");
    if (inputRef.current) {
      inputRef.current.style.height = "42px";
    }

    const historyPayload = messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    socket.emit("ai_command", {
      text: prompt,
      prompt,
      rawHeardText: rawPrompt,
      history: historyPayload,
    });
  };

  sendMessageRef.current = handleSendMessage;

  const handleConfirmAction = (confirmed) => {
    if (!pendingAction) return;
    socket.emit("ai_confirm_action", {
      actionId: pendingAction.id,
      confirmed,
    });
    if (!confirmed) {
      setPendingAction(null);
    }
  };

  // Magnifier Lens Mode Handlers (0ms latency direct socket controls)
  const handleTouchpadStart = (e) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchpadMove = (e) => {
    if (e.cancelable) e.preventDefault();
    if (!touchStartRef.current) {
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      return;
    }
    const touch = e.touches[0];
    const dx = Math.round((touch.clientX - touchStartRef.current.x) * 1.5);
    const dy = Math.round((touch.clientY - touchStartRef.current.y) * 1.5);

    touchStartRef.current = { x: touch.clientX, y: touch.clientY };

    if (dx !== 0 || dy !== 0) {
      socket.emit("magnifier_pan", { dx, dy });
    }
  };

  const handleTouchpadEnd = () => {
    touchStartRef.current = null;
  };

  const handleMagnifierAction = (action) => {
    socket.emit("magnifier_action", { action });
  };

  const handleStepPan = (dx, dy) => {
    socket.emit("magnifier_pan", { dx, dy });
  };

  // Compute Quota Metrics clearly distinguishing RPM (per-minute speed limit) vs Daily total
  const flashModelStats = quotaStatus?.models?.["gemini-3.1-flash-lite"];
  const groqModelStats = quotaStatus?.models?.["openai/gpt-oss-120b"];
  const gemmaModelStats = quotaStatus?.models?.["gemma-4-31b-it"];

  const flashRpmUsed = flashModelStats?.rpmUsed ?? flashModelStats?.rpm ?? 0;
  const flashRpmLimit = flashModelStats?.rpmLimit ?? 15;
  const groqRpmUsed = groqModelStats?.rpmUsed ?? groqModelStats?.rpm ?? 0;
  const groqRpmLimit = groqModelStats?.rpmLimit ?? 30;

  const dailyUsedTotal =
    quotaStatus?.totalDailyUsed ??
    (flashModelStats?.dailyUsed ?? flashModelStats?.rpd ?? 0) +
      (gemmaModelStats?.dailyUsed ?? gemmaModelStats?.rpd ?? 0) +
      (groqModelStats?.dailyUsed ?? groqModelStats?.rpd ?? 0);

  const quickChips = [
    { label: "🔊 علّي الصوت", text: "علي الصوت" },
    { label: "🔉 وطّي الصوت", text: "وطي الصوت" },
    { label: "⏯️ وقف/شغل", text: "وقف الفيديو" },
    { label: "🔇 ميوت", text: "اعمل ميوت" },
    { label: "🍿 ملخص ماتش", text: "شغلي ملخص ماتش وعلي الصوت" },
    { label: "🔍 عدسة مكبرة", text: "افتح العدسة المكبرة لويندوز" },
    { label: "❌ اقفل التاب", text: "اقفل التاب الحالي" },
    { label: "🔒 قفل الشاشة", text: "اقفل شاشة الجهاز" },
  ];

  const isActivelyCapturingVoice =
    (!isZakaMode && isListening) || (isZakaMode && zakaPhase === "capturing");

  return (
    <div
      onPointerDown={resetZakaAutoDisarmTimer}
      onKeyDown={resetZakaAutoDisarmTimer}
      className={
        isZakaMode
          ? "fixed inset-0 z-50 h-[100dvh] max-h-[100dvh] w-full flex flex-col overflow-hidden bg-[#000000] text-zinc-50"
          : "h-[100dvh] max-h-[100dvh] sm:h-[calc(100dvh-165px)] sm:max-h-[calc(100dvh-165px)] flex-1 min-h-0 w-full flex flex-col overflow-hidden bg-zinc-950 sm:rounded-2xl border-0 sm:border-2 border-zinc-700"
      }
      aria-label="AI OS Assistant Section"
    >
      {/* 1. SINGLE-LINE COMPACT HEADER (Status + RPM & Daily Quota + ZAKA Lounge Toggle) */}
      <header
        className={`px-2.5 py-2 sm:px-4 sm:py-2.5 border-b flex items-center justify-between gap-1.5 sm:gap-3 shrink-0 select-none ${
          isZakaMode
            ? "bg-[#000000] border-zinc-800"
            : "bg-zinc-900 border-zinc-800"
        }`}
      >
        {/* Left: Live Connection Status + Clear Quota Badge (RPM + Daily) */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 overflow-hidden">
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-950 border border-zinc-800 shrink-0"
            title={
              isStreaming
                ? "جاري تنفيذ الأمر..."
                : socketStatus
                  ? "متصل بالسيرفر وجاهز"
                  : "غير متصل بالسيرفر"
            }
          >
            <span
              className={`w-2.5 h-2.5 rounded-sm shrink-0 ${
                isStreaming
                  ? "bg-amber-400"
                  : socketStatus
                    ? "bg-green-500"
                    : "bg-red-600"
              }`}
              aria-hidden="true"
            />
            <span className="text-[11px] sm:text-xs font-bold text-zinc-200">
              {isStreaming ? "ينفّذ" : socketStatus ? "متصل" : "مفصول"}
            </span>
          </div>

          {/* Clear Quota Pill: Per-Minute Speed Limit (RPM) + Cumulative Daily Used */}
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px] sm:text-xs font-mono text-zinc-200 truncate"
            title={`حد السرعة في الدقيقة (Flash-Lite: ${flashRpmUsed}/${flashRpmLimit} RPM | Groq: ${groqRpmUsed}/${groqRpmLimit} RPM) — إجمالي طلبات اليوم: ${dailyUsedTotal}`}
          >
            <span className="text-teal-300 font-bold shrink-0">
              ⚡{flashRpmUsed}/{flashRpmLimit} RPM
            </span>
            <span className="hidden md:inline text-zinc-400">|</span>
            <span className="hidden md:inline text-indigo-300 font-bold shrink-0">
              🛡️{groqRpmUsed}/{groqRpmLimit} RPM
            </span>
            <span className="text-zinc-500">|</span>
            <span className="text-amber-300 font-sans font-bold shrink-0">
              اليوم: {dailyUsedTotal}
            </span>
          </div>
        </div>

        {/* Right: Magnifier Quick Icon + "🌙 وضع السهرة (زاقا)" Toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowMagnifier((prev) => !prev)}
            className={`min-h-11 min-w-11 px-2.5 py-1 rounded-xl flex items-center justify-center gap-1 font-bold text-xs border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${
              showMagnifier
                ? "bg-teal-600 text-white border-teal-300"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700"
            }`}
            aria-expanded={showMagnifier}
            aria-label="لوحة تحكم العدسة المكبرة لويندوز"
            title="العدسة المكبرة"
          >
            <span aria-hidden="true">🔍</span>
            <span className="hidden sm:inline">عدسة</span>
          </button>

          <button
            type="button"
            onClick={toggleZakaMode}
            className={`min-h-11 px-2.5 sm:px-3.5 py-1 rounded-xl flex items-center gap-1.5 font-bold text-xs sm:text-sm border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 shrink-0 ${
              isZakaMode
                ? "bg-amber-600 hover:bg-amber-500 text-white border-amber-300"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-600"
            }`}
            aria-pressed={isZakaMode}
            aria-label="تفعيل أو إيقاف وضع السهرة الصوتي بكلمة النداء ZAZA ظاظا"
          >
            <span aria-hidden="true">🌙</span>
            <span>
              {isZakaMode ? "إغلاق السهرة (ZAZA - ظاظا)" : "وضع السهرة (ZAZA - ظاظا)"}
            </span>
          </button>
        </div>
      </header>

      {/* ZAKA OLED Lounge Mode Status Strip + Live Heard Monitor */}
      {isZakaMode && (
        <div
          className="px-3 py-2 bg-[#000000] border-b border-zinc-800 flex flex-col gap-1.5 text-xs shrink-0"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            {zakaPhase === "mic_error" ? (
              <>
                <span className="text-red-400 font-bold">
                  ❌ [■] المايكروفون متوقف حالياً (تحقق من الصلاحية أو رابط HTTPS)
                </span>
                <button
                  type="button"
                  onClick={handleRearmZaka}
                  className="min-h-10 px-3 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold border border-teal-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                >
                  🔄 إعادة تشغيل المايك
                </button>
              </>
            ) : zakaPhase === "disarmed" ? (
              <>
                <span className="text-amber-300 font-bold">
                  🛡️ [■] توقف الاستماع التلقائي بعد 10 دقائق خمول لحماية الخصوصية
                </span>
                <button
                  type="button"
                  onClick={handleRearmZaka}
                  className="min-h-10 px-3 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold border border-teal-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                >
                  🔄 تنشيط ZAZA — ظاظا
                </button>
              </>
            ) : zakaPhase === "capturing" ? (
              <span className="text-teal-300 font-bold">
                🎙️ [●] سمعتك يا باشا! قول أمرك خلال 6 ثوانٍ... (إرسال تلقائي بعد 2.2 ث صمت)
              </span>
            ) : (
              <span className="text-zinc-300">
                🌙 [{isListening ? "● المايك نشط" : "… جاري تهيئة المايك"}] | نادي بـ{" "}
                <strong className="text-amber-300">«يا ظاظا / زازا / ZAZA»</strong> متبوعاً بأمرك أو انتظر الرد
              </span>
            )}
          </div>

          {/* Faint Live Speech Monitor Line inside OLED Screen confirming real-time mic capture */}
          <div className="px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-900 text-[11px] text-zinc-300 font-mono truncate">
            <span className="text-zinc-400">🎧 السماع اللحظي: </span>
            <span>
              {!isListening && zakaPhase !== "capturing"
                ? "(المايك غير نشط حالياً)"
                : liveHeardText
                  ? `"${liveHeardText}"`
                  : "بانتظار صوتك..."}
            </span>
          </div>
        </div>
      )}

      {/* Fallback Alert Toast if triggered */}
      {quotaAlert && (
        <div
          className="px-3 py-1.5 bg-amber-950 border-b border-amber-600 text-amber-200 text-xs font-semibold truncate shrink-0"
          role="status"
        >
          {quotaAlert}
        </div>
      )}

      {/* WINDOWS MAGNIFIER LENS CONTROL PANEL */}
      {showMagnifier && (
        <section
          className="p-3 bg-zinc-900 border-b-2 border-zinc-700 flex flex-col gap-2.5 shrink-0 select-none max-h-[52dvh] overflow-y-auto"
          aria-label="لوحة تحكم عدسة ويندوز المكبرة"
        >
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-lg" aria-hidden="true">
                🔍
              </span>
              <h3 className="text-sm font-bold text-zinc-50">
                العدسة المكبرة لويندوز (Lens Mode)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowMagnifier(false)}
              className="min-h-10 min-w-10 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold border border-zinc-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              aria-label="إغلاق لوحة العدسة"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => handleMagnifierAction("open")}
              className="min-h-14 px-2 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs border-2 border-teal-300 flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            >
              <span aria-hidden="true">🔍</span>
              <span>فتح</span>
            </button>
            <button
              type="button"
              onClick={() => handleMagnifierAction("zoom_in")}
              className="min-h-14 px-2 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-xs border-2 border-zinc-600 flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            >
              <span aria-hidden="true">➕</span>
              <span>تكبير</span>
            </button>
            <button
              type="button"
              onClick={() => handleMagnifierAction("zoom_out")}
              className="min-h-14 px-2 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-xs border-2 border-zinc-600 flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            >
              <span aria-hidden="true">➖</span>
              <span>تصغير</span>
            </button>
            <button
              type="button"
              onClick={() => handleMagnifierAction("close")}
              className="min-h-14 px-2 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs border-2 border-red-300 flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            >
              <span aria-hidden="true">✖️</span>
              <span>قفل</span>
            </button>
          </div>

          <div
            onTouchStart={handleTouchpadStart}
            onTouchMove={handleTouchpadMove}
            onTouchEnd={handleTouchpadEnd}
            onTouchCancel={handleTouchpadEnd}
            className="min-h-[96px] w-full rounded-xl bg-zinc-950 border-2 border-zinc-700 active:border-teal-400 flex flex-col items-center justify-center gap-1 p-2 text-center touch-none"
            aria-label="منطقة لمس مصغرة لتحريك العدسة"
          >
            <span className="text-xs font-bold text-zinc-200">
              🖐️ اسحب إصبعك هنا لتحريك العدسة بسلاسة
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => handleStepPan(-70, 0)}
              className="min-h-14 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-xs border-2 border-zinc-600 flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            >
              ⬅️ يسار
            </button>
            <button
              type="button"
              onClick={() => handleStepPan(0, -70)}
              className="min-h-14 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-xs border-2 border-zinc-600 flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            >
              ⬆️ أعلى
            </button>
            <button
              type="button"
              onClick={() => handleStepPan(0, 70)}
              className="min-h-14 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-xs border-2 border-zinc-600 flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            >
              ⬇️ أسفل
            </button>
            <button
              type="button"
              onClick={() => handleStepPan(70, 0)}
              className="min-h-14 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-xs border-2 border-zinc-600 flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            >
              ➡️ يمين
            </button>
          </div>
        </section>
      )}

      {/* 2. CHAT MESSAGES SCROLL AREA (Takes largest vertical space: flex-1 overflow-y-auto) */}
      <main
        className={`flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 flex flex-col gap-3 scroll-smooth ${
          isZakaMode ? "bg-[#000000]" : "bg-zinc-950"
        }`}
        role="log"
        aria-live="polite"
      >
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col gap-1.5 max-w-[88%] sm:max-w-[80%] rounded-2xl p-3 sm:p-3.5 border-2 ${
              msg.role === "user"
                ? isZakaMode
                  ? "self-end bg-zinc-950 border-teal-700 text-zinc-50"
                  : "self-end bg-teal-950 border-teal-600 text-zinc-50"
                : msg.isError
                  ? "self-start bg-red-950 border-red-600 text-zinc-50"
                  : isZakaMode
                    ? "self-start bg-zinc-950 border-zinc-800 text-zinc-100"
                    : "self-start bg-zinc-900 border-zinc-700 text-zinc-100"
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-1 text-xs font-bold text-zinc-300">
              <span>{msg.role === "user" ? "👤 أنت" : "🤖 ZAZA — ظاظا"}</span>
              {msg.routeInfo?.targetModel === "local-fast-path" && (
                <span className="px-1.5 py-0.5 rounded bg-zinc-950 border border-teal-600 text-teal-300 font-mono text-[10px]">
                  ⚡ مجاني 0 توكن
                </span>
              )}
            </div>

            <p className="text-base sm:text-lg leading-relaxed whitespace-pre-wrap select-text">
              {msg.content}
            </p>

            {msg.tools && msg.tools.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-zinc-800">
                {msg.tools.map((t, tIdx) => (
                  <span
                    key={tIdx}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 border border-teal-600 text-teal-300 text-xs font-mono font-bold"
                  >
                    ⚙️ نفذت {t.name}
                  </span>
                ))}
              </div>
            )}

            {/* Compact Debug Trace Badge: [Heard Text ◄ Domain ◄ Model ◄ Tokens] */}
            {msg.role === "assistant" && msg.debugTrace && (
              <div
                className="mt-1 pt-1.5 border-t border-zinc-800 text-[11px] font-mono text-zinc-300 flex flex-wrap items-center gap-1"
                aria-label="تشخيص المسار والأداة"
              >
                <span className="px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 max-w-full truncate">
                  [🎙️ {msg.debugTrace.heardText || "—"} ◄ 📦 {msg.debugTrace.domain || "chat"} ◄ 🤖{" "}
                  {msg.debugTrace.model || "—"} ◄ 🪙 {msg.debugTrace.tokens ?? 0} توكن]
                </span>
              </div>
            )}
          </div>
        ))}

        {/* HUMAN-IN-THE-LOOP CONFIRMATION CARD */}
        {pendingAction && (
          <div
            className="p-4 rounded-xl bg-zinc-900 border-2 border-amber-500 flex flex-col gap-3 self-start max-w-[92%]"
            role="alert"
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden="true">
                ⚠️
              </span>
              <span className="text-sm sm:text-base font-bold text-amber-200">
                مطلوب تأكيدك: {pendingAction.title || pendingAction.action}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleConfirmAction(true)}
                className="min-h-14 px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-sm border-2 border-teal-300 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              >
                <span>✅</span>
                <span>تأكيد التنفيذ</span>
              </button>
              <button
                type="button"
                onClick={() => handleConfirmAction(false)}
                className="min-h-14 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm border-2 border-red-300 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              >
                <span>❌</span>
                <span>إلغاء</span>
              </button>
            </div>
          </div>
        )}

        {/* STREAMING RESPONSE BUBBLE */}
        {isStreaming && (
          <div className="self-start max-w-[88%] sm:max-w-[80%] rounded-2xl p-3.5 border-2 bg-zinc-900 border-teal-600 text-zinc-100 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-teal-300 text-xs font-bold border-b border-zinc-800 pb-1.5">
              <span>[●] جاري التنفيذ والرد...</span>
              {currentRouteInfo && (
                <div className="flex items-center gap-1.5 text-[11px] font-mono">
                  <span className="px-1.5 py-0.5 rounded bg-zinc-950 border border-teal-600 text-teal-300 font-bold">
                    🎯 {currentRouteInfo.domain}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-300">
                    {currentRouteInfo.targetModel}
                  </span>
                </div>
              )}
            </div>

            {currentStreamText ? (
              <p className="text-base sm:text-lg leading-relaxed whitespace-pre-wrap">
                {currentStreamText}
              </p>
            ) : (
              <span className="text-xs sm:text-sm text-zinc-300">
                جاري معالجة وتنفيذ طلبك...
              </span>
            )}

            {currentTools.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-zinc-800">
                {currentTools.map((t, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 border border-teal-600 text-teal-300 text-xs font-mono font-bold"
                  >
                    ✓ نفذت {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={chatBottomRef} />
      </main>

      {/* 3. SLEEK COMPACT BOTTOM INPUT BAR (Auto-expanding 1-to-3 lines + Safe Area Inset) */}
      <footer
        className={`shrink-0 px-2.5 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4 sm:pt-2.5 border-t flex flex-col gap-1.5 ${
          isZakaMode
            ? "bg-[#000000] border-zinc-800"
            : "bg-zinc-900 border-zinc-800"
        }`}
      >
        {/* Active Recording Banner with 2s Breath Pause Notice & Instant Send */}
        {isActivelyCapturingVoice && (
          <div
            className="px-3 py-2 rounded-xl bg-zinc-950 border-2 border-amber-500 text-zinc-50 flex items-center justify-between gap-2"
            role="status"
            aria-live="polite"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-zinc-50 truncate">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500 shrink-0"
                  aria-hidden="true"
                />
                <span>🎙️ استماع مستمر — خُد نفسك (يُرسل بعد 2.2 ثانية صمت)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleInstantVoiceSend}
              disabled={!inputText.trim() || isStreaming}
              className="min-h-11 px-3.5 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-800 disabled:text-zinc-400 text-white font-bold text-xs sm:text-sm border border-teal-300 disabled:border-zinc-700 shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              aria-label="إرسال فوري للجملة المنطوقة دون انتظار مهلة الصمت"
            >
              إرسال فوري ⚡
            </button>
          </div>
        )}

        {/* Error notification banner */}
        {speechError && (
          <div
            className="px-3 py-1.5 rounded-xl bg-red-950 border border-red-600 text-zinc-100 text-xs font-semibold flex items-center justify-between gap-2"
            role="alert"
          >
            <span className="truncate">{speechError}</span>
            <button
              type="button"
              onClick={() => setSpeechError("")}
              className="min-h-8 min-w-8 px-2 py-0.5 rounded bg-red-900 hover:bg-red-800 text-white font-bold shrink-0"
              aria-label="إغلاق التنبيه"
            >
              ✕
            </button>
          </div>
        )}

        {/* Optional Quick Chips Drawer (Toggled to keep bottom bar ultra-compact) */}
        {showQuickChips && (
          <div
            className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar select-none"
            aria-label="Quick Action Suggestions"
          >
            {quickChips.map((chip, idx) => (
              <button
                key={idx}
                type="button"
                disabled={isStreaming}
                onClick={() => handleSendMessage(chip.text)}
                className="whitespace-nowrap px-3 py-1.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-semibold shrink-0 disabled:opacity-40"
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {/* Compact Single-Row Input Capsule (1 line -> expands up to 3 lines max + Integrated Mic & Send) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className={`flex items-end gap-1.5 p-1 rounded-2xl border-2 ${
            isZakaMode
              ? "bg-zinc-950 border-zinc-800"
              : "bg-zinc-950 border-zinc-700"
          }`}
        >
          {/* Quick Shortcuts Drawer Toggle */}
          <button
            type="button"
            onClick={() => setShowQuickChips((prev) => !prev)}
            className={`min-h-11 min-w-11 rounded-xl flex items-center justify-center shrink-0 border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${
              showQuickChips
                ? "bg-zinc-800 text-teal-300 border-teal-500"
                : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800"
            }`}
            aria-expanded={showQuickChips}
            aria-label="إظهار أو إخفاء الأوامر السريعة"
            title="أوامر سريعة"
          >
            <span className="text-base font-bold" aria-hidden="true">
              ⚡
            </span>
          </button>

          {/* Integrated Mic Button */}
          <button
            type="button"
            onClick={toggleListening}
            disabled={isStreaming || !speechSupported}
            className={`min-h-11 min-w-11 px-2.5 rounded-xl flex items-center justify-center shrink-0 border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 disabled:opacity-40 ${
              isActivelyCapturingVoice
                ? "bg-red-600 hover:bg-red-500 text-white border-red-300"
                : isZakaMode && zakaPhase === "standby"
                  ? "bg-amber-600 hover:bg-amber-500 text-white border-amber-300"
                  : "bg-zinc-800 hover:bg-zinc-700 text-zinc-50 border-zinc-600"
            }`}
            aria-pressed={isActivelyCapturingVoice}
            aria-label={
              isActivelyCapturingVoice
                ? "إيقاف التسجيل الصوتي"
                : "تحدث بالمايك (ar-EG)"
            }
            title={
              isZakaMode
                ? "اضغط للتحدث فوراً مع ZAZA — ظاظا"
                : isActivelyCapturingVoice
                  ? "إيقاف الاستماع"
                  : "تحدث بالمايك (وضع صامت عند الطلب)"
            }
          >
            <span className="text-lg" aria-hidden="true">
              {isActivelyCapturingVoice ? "⏹" : "🎙️"}
            </span>
          </button>

          {/* Auto-Expanding 1-to-3 Line Textarea */}
          <textarea
            ref={inputRef}
            rows={1}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              syncTextareaHeight(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={
              isZakaMode
                ? 'نادي "يا ظاظا..." أو اكتب طلبك'
                : "اكتب طلبك أو اضغط 🎙️..."
            }
            disabled={isStreaming}
            className="flex-1 min-h-[42px] max-h-[88px] py-2 px-2.5 bg-transparent text-zinc-50 text-base leading-snug placeholder-zinc-400 resize-none overflow-y-auto focus:outline-none disabled:opacity-50"
            aria-label="رسالة نصية للمساعد الذكي ZAZA — ظاظا"
          />

          {/* Integrated Send Button */}
          <button
            type="submit"
            disabled={!inputText.trim() || isStreaming}
            className="min-h-11 min-w-11 px-3.5 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 disabled:bg-zinc-800 disabled:opacity-40 text-white font-bold text-base border-2 border-teal-300 disabled:border-zinc-700 flex items-center justify-center shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            aria-label="إرسال الأمر"
          >
            <span className="text-lg" aria-hidden="true">
              ➤
            </span>
          </button>
        </form>
      </footer>
    </div>
  );
}
