import { useState, useEffect, useRef } from "react";
import { socket } from "../socket";

export default function AiAgentTab() {
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        'أهلاً بيك يا باشا! 🍿 أنا مساعد الفرجة والاسترخاء الذكي (AI Agent). اطلب مني أي حاجة بالصوت أو الكتابة، زي: "شغلي ملخص ماتش وعلي الصوت"، "شغل قرآن"، "اعمل ملء الشاشة"، أو "اقفل التاب".',
      tools: [],
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStreamText, setCurrentStreamText] = useState("");
  const [currentTools, setCurrentTools] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);

  // Web Speech API Voice Recognition (ar-EG)
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);

  const [socketStatus, setSocketStatus] = useState(socket.connected);
  const [showMagnifier, setShowMagnifier] = useState(false);

  // AI Quota Tracking State
  const [quotaStatus, setQuotaStatus] = useState(null);
  const [quotaAlert, setQuotaAlert] = useState(null);
  const [currentRouteInfo, setCurrentRouteInfo] = useState(null);

  const chatBottomRef = useRef(null);
  const inputRef = useRef(null);
  const touchStartRef = useRef(null);

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
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: finalText,
            tools: finalTools,
            routeInfo: currentRouteInfo,
          },
        ]);
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

    socket.on("ai_route_info", handleRouteInfo);

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

    socket.on("ai_stream_chunk", handleChunk);
    socket.on("ai_stream_done", handleDone);
    socket.on("ai_error", handleAiError);
    socket.on("ai_action_confirmed", handleActionConfirmed);
    socket.on("ai_action_cancelled", handleActionCancelled);
    socket.on("ai_route_info", handleRouteInfo);

    return () => {
      socket.off("ai_stream_chunk", handleChunk);
      socket.off("ai_stream_done", handleDone);
      socket.off("ai_error", handleAiError);
      socket.off("ai_action_confirmed", handleActionConfirmed);
      socket.off("ai_action_cancelled", handleActionCancelled);
      socket.off("ai_route_info", handleRouteInfo);
    };
  }, [currentStreamText, currentTools]);

  // Listen to live AI quota updates and fallback alerts from server
  useEffect(() => {
    const handleQuotaStatus = (data) => {
      if (data?.quotaStats) {
        setQuotaStatus(data.quotaStats);
      }
      if (data?.type === "ai_fallback_triggered" && data.reason) {
        setQuotaAlert(`⚠️ تم التحويل إلى ${data.nextModel}: ${data.reason}`);
        setTimeout(() => setQuotaAlert(null), 7000);
      }
    };

    socket.on("ai_quota_status", handleQuotaStatus);
    return () => {
      socket.off("ai_quota_status", handleQuotaStatus);
    };
  }, []);

  // Web Speech API Voice Recognition (ar-EG)
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "ar-EG";

      recognition.onstart = () => {
        setIsListening(true);
        isListeningRef.current = true;
        setSpeechError("");
      };

      recognition.onresult = (event) => {
        let interimText = "";
        let finalText = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcriptPiece = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += transcriptPiece;
          } else {
            interimText += transcriptPiece;
          }
        }

        const currentText = (finalText || interimText).trim();
        if (currentText) {
          setInputText(currentText);
        }

        // When a final sentence is recognized, send it directly
        if (finalText && finalText.trim()) {
          handleSendMessage(finalText.trim());
        }
      };

      recognition.onerror = (event) => {
        console.error("[Web Speech API Error]:", event.error);
        setIsListening(false);
        isListeningRef.current = false;
        if (event.error === "no-speech") {
          setSpeechError("لم يتم سماع أي صوت، اضغط على المايك وتحدث مجدداً.");
        } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setSpeechError("❌ تم رفض صلاحية الميكروفون في المتصفح.");
        } else {
          setSpeechError(`⚠️ خطأ في التعرف على الصوت: ${event.error}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        isListeningRef.current = false;
      };

      recognitionRef.current = recognition;
    } catch (err) {
      console.error("SpeechRecognition initialization failed:", err);
      setSpeechSupported(false);
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
      }
    };
  }, []);

  const toggleListening = () => {
    if (!speechSupported) {
      setSpeechError("المتصفح لا يدعم Web Speech API. يُرجى استخدام متصفح Google Chrome.");
      return;
    }

    if (isListeningRef.current) {
      try {
        recognitionRef.current?.stop();
      } catch (_) {}
      setIsListening(false);
      isListeningRef.current = false;
    } else {
      setSpeechError("");
      try {
        if (recognitionRef.current) {
          recognitionRef.current.start();
        }
      } catch (err) {
        console.error("Error starting SpeechRecognition:", err);
        setIsListening(false);
        isListeningRef.current = false;
      }
    }
  };

  const handleSendMessage = (textToSend) => {
    const prompt = (textToSend || inputText).trim();
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

    const historyPayload = messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    socket.emit("ai_command", {
      text: prompt,
      prompt,
      history: historyPayload,
    });
  };

  const handleConfirmAction = (confirmed) => {
    if (!pendingAction) return;
    socket.emit("ai_confirm_action", {
      actionId: pendingAction.id,
      action: pendingAction.action,
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

  // Quick Action Chips specifically for Relax & OS Control
  const quickChips = [
    { label: "🔍 افتح العدسة المكبرة", text: "افتح العدسة المكبرة لويندوز" },
    { label: "🍿 ملخص ماتش وعلي الصوت", text: "شغلي ملخص ماتش وعلي الصوت" },
    { label: "🎵 شغل يوتيوب", text: "شغل اغاني هادية على يوتيوب" },
    { label: "🔊 علّي الصوت", text: "علي الصوت شوية" },
    { label: "🔉 وطّي الصوت", text: "وطي الصوت شوية" },
    { label: "🎬 ملء الشاشة", text: "اعمل ملء الشاشة للفيديو" },
    { label: "❌ اقفل التاب", text: "اقفل التاب الحالي" },
    { label: "💻 افتح الحاسبة", text: "افتح الآلة الحاسبة" },
    { label: "📊 فحص الجهاز", text: "ما هي حالة الجهاز واستهلاك الرامات؟" },
    { label: "🔒 قفل الشاشة", text: "اقفل شاشة الجهاز" },
  ];

  return (
    <div
      className="flex flex-col h-[calc(100dvh-130px)] sm:h-[calc(100dvh-175px)] max-h-[calc(100dvh-130px)] w-full overflow-hidden bg-zinc-950 rounded-2xl border-2 border-zinc-700"
      aria-label="AI OS Assistant Section"
    >
      {/* 1. COMPACT TOP HEADER */}
      <header className="p-3 sm:p-4 bg-zinc-900 border-b-2 border-zinc-800 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-2xl sm:text-3xl shrink-0" aria-hidden="true">
            🤖
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-xl font-bold text-zinc-50 truncate">
                المساعد الذكي (الفرجة والاسترخاء)
              </h2>
              <span className="hidden sm:inline-block px-2 py-0.5 rounded bg-zinc-950 border border-teal-500/40 text-teal-300 font-mono text-xs font-bold shrink-0">
                GEMINI 3.8 FLASH
              </span>
            </div>
            <p className="text-xs text-zinc-400 truncate hidden sm:block">
              افتح الفيديوهات والأغاني، تحكم في الصوت، واقفل التابات بالعامية
              المصرية.
            </p>
          </div>
        </div>

        {/* Header Right Actions: Quick Magnifier Toggle + Live Status indicator */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowMagnifier((prev) => !prev)}
            className={`min-h-11 sm:min-h-12 px-2.5 sm:px-3 py-1 rounded-xl flex items-center gap-1.5 font-bold text-xs sm:text-sm border-2 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 shrink-0 ${
              showMagnifier
                ? "bg-teal-600 hover:bg-teal-500 text-white border-teal-300"
                : "bg-zinc-800 hover:bg-zinc-700 text-teal-300 border-teal-500/50"
            }`}
            aria-expanded={showMagnifier}
            aria-label="لوحة تحكم العدسة المكبرة لويندوز"
            title="فتح / إغلاق لوحة تحكم العدسة المكبرة"
          >
            <span className="text-base sm:text-lg" aria-hidden="true">
              🔍
            </span>
            <span>{showMagnifier ? "إخفاء العدسة" : "عدسة مكبرة"}</span>
          </button>

          {/* Live Status indicator */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 shrink-0">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isStreaming
                  ? "bg-amber-400 animate-pulse"
                  : socketStatus
                    ? "bg-emerald-400"
                    : "bg-rose-500"
              }`}
              aria-hidden="true"
            />
            <span className="text-xs font-semibold text-zinc-300 hidden sm:inline">
              {isStreaming
                ? "جاري التنفيذ..."
                : socketStatus
                  ? "جاهز"
                  : "غير متصل"}
            </span>
          </div>
        </div>
      </header>

      {/* LIVE AI QUOTA STATUS BAR */}
      <section
        aria-label="Live AI Quota Status"
        className="px-3 py-1.5 bg-zinc-950 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 select-none"
      >
        <div className="flex flex-wrap items-center gap-3 text-zinc-300">
          <div className="flex items-center gap-1">
            <span className="font-semibold text-teal-400">⚡ Gemini 3.1 Flash-Lite:</span>
            <span className="font-mono bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 text-[11px]">
              {quotaStatus?.models?.["gemini-3.1-flash-lite"]?.rpm ?? 0}/15 RPM
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="font-semibold text-indigo-400">🛡️ Groq Fallback:</span>
            <span className="font-mono bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 text-[11px]">
              {quotaStatus?.models?.["openai/gpt-oss-120b"]?.rpm ?? 0}/30 RPM
            </span>
          </div>
        </div>

        {quotaAlert && (
          <div className="text-amber-300 bg-amber-950/80 border border-amber-500/50 px-2 py-0.5 rounded text-[11px] animate-in fade-in truncate max-w-full">
            {quotaAlert}
          </div>
        )}
      </section>

      {/* WINDOWS MAGNIFIER LENS CONTROL PANEL (Mobile-First, Ergonomic, High Contrast) */}
      {showMagnifier && (
        <section
          className="p-3 sm:p-4 bg-zinc-900 border-b-2 border-zinc-700 flex flex-col gap-3 shrink-0 select-none animate-in fade-in"
          aria-label="لوحة تحكم عدسة ويندوز المكبرة"
        >
          {/* Panel Title & Status */}
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">
                🔍
              </span>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-zinc-50">
                  العدسة المكبرة لويندوز (Lens Mode)
                </h3>
                <p className="text-xs text-zinc-400">
                  تحكم لحظي فوري (0ms) لتكبير وقراءة الشاشة من مسافة 5–6 متر
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowMagnifier(false)}
              className="min-h-10 min-w-10 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold border border-zinc-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              aria-label="إغلاق لوحة العدسة"
            >
              ✕
            </button>
          </div>

          {/* Row 1: Primary Lens Action Buttons (>= 56px per agent.md) */}
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => handleMagnifierAction("open")}
              className="min-h-14 px-2 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-bold text-xs sm:text-sm border-2 border-teal-300 flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              title="فتح عدسة ويندوز المكبرة العائمة"
            >
              <span className="text-lg" aria-hidden="true">
                🔍
              </span>
              <span className="truncate">فتح العدسة</span>
            </button>

            <button
              type="button"
              onClick={() => handleMagnifierAction("zoom_in")}
              className="min-h-14 px-2 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-50 font-bold text-xs sm:text-sm border-2 border-zinc-600 flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              title="تكبير العدسة"
            >
              <span className="text-lg font-bold" aria-hidden="true">
                ➕
              </span>
              <span>تكبير</span>
            </button>

            <button
              type="button"
              onClick={() => handleMagnifierAction("zoom_out")}
              className="min-h-14 px-2 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-50 font-bold text-xs sm:text-sm border-2 border-zinc-600 flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              title="تصغير العدسة"
            >
              <span className="text-lg font-bold" aria-hidden="true">
                ➖
              </span>
              <span>تصغير</span>
            </button>

            <button
              type="button"
              onClick={() => handleMagnifierAction("close")}
              className="min-h-14 px-2 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold text-xs sm:text-sm border-2 border-rose-300 flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
              title="إغلاق العدسة بالكامل"
            >
              <span className="text-lg font-bold" aria-hidden="true">
                ✖️
              </span>
              <span>قفل</span>
            </button>
          </div>

          {/* Row 2: Soft Mini Touchpad for Smooth Lens Panning */}
          <div
            onTouchStart={handleTouchpadStart}
            onTouchMove={handleTouchpadMove}
            onTouchEnd={handleTouchpadEnd}
            onTouchCancel={handleTouchpadEnd}
            className="min-h-[120px] sm:min-h-[135px] w-full rounded-xl bg-zinc-950 border-2 border-zinc-700 active:border-teal-400 flex flex-col items-center justify-center gap-1.5 p-3 text-center touch-none cursor-grab active:cursor-grabbing transition-colors relative overflow-hidden"
            aria-label="منطقة لمس مصغرة لتحريك العدسة"
          >
            <span
              className="text-2xl sm:text-3xl text-teal-400 select-none pointer-events-none"
              aria-hidden="true"
            >
              🖐️
            </span>
            <span className="text-xs sm:text-sm font-bold text-zinc-200 select-none pointer-events-none">
              منطقة اللمس (Mini Touchpad)
            </span>
            <span className="text-xs text-zinc-400 select-none pointer-events-none">
              اسحب إصبعك هنا لتحريك العدسة بسلاسة وفورية فوق السطور
            </span>
          </div>

          {/* Row 3: 4 Step-by-Step Directional Arrows (70px per step) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-zinc-400">
              تحريك دقيق خطوة بخطوة (70px لكل ضغطة):
            </span>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => handleStepPan(-70, 0)}
                className="min-h-14 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-teal-700 text-zinc-50 font-bold text-sm sm:text-base border-2 border-zinc-600 active:border-teal-400 flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                aria-label="تحريك العدسة لليسار 70 بكسل"
                title="تحريك يسار 70px"
              >
                <span className="text-xl" aria-hidden="true">
                  ⬅️
                </span>
                <span>يسار</span>
              </button>

              <button
                type="button"
                onClick={() => handleStepPan(0, -70)}
                className="min-h-14 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-teal-700 text-zinc-50 font-bold text-sm sm:text-base border-2 border-zinc-600 active:border-teal-400 flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                aria-label="تحريك العدسة لأعلى 70 بكسل"
                title="تحريك لأعلى 70px"
              >
                <span className="text-xl" aria-hidden="true">
                  ⬆️
                </span>
                <span>أعلى</span>
              </button>

              <button
                type="button"
                onClick={() => handleStepPan(0, 70)}
                className="min-h-14 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-teal-700 text-zinc-50 font-bold text-sm sm:text-base border-2 border-zinc-600 active:border-teal-400 flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                aria-label="تحريك العدسة لأسفل 70 بكسل"
                title="تحريك لأسفل 70px"
              >
                <span className="text-xl" aria-hidden="true">
                  ⬇️
                </span>
                <span>أسفل</span>
              </button>

              <button
                type="button"
                onClick={() => handleStepPan(70, 0)}
                className="min-h-14 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-teal-700 text-zinc-50 font-bold text-sm sm:text-base border-2 border-zinc-600 active:border-teal-400 flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                aria-label="تحريك العدسة لليمين 70 بكسل"
                title="تحريك يمين 70px"
              >
                <span className="text-xl" aria-hidden="true">
                  ➡️
                </span>
                <span>يمين</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 2. CHAT MESSAGES SCROLL AREA (Responsive, Flex-1, Auto-Scroll) */}
      <main
        className="flex-1 overflow-y-auto p-3 sm:p-5 flex flex-col gap-3 min-h-0 scroll-smooth"
        role="log"
        aria-live="polite"
      >
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col gap-1.5 max-w-[88%] sm:max-w-[80%] rounded-2xl p-3 sm:p-4 border-2 ${
              msg.role === "user"
                ? "self-end bg-teal-950/80 border-teal-600 text-teal-50"
                : msg.isError
                  ? "self-start bg-rose-950/80 border-rose-600 text-rose-100"
                  : "self-start bg-zinc-900 border-zinc-700 text-zinc-100"
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-1 text-xs font-bold text-zinc-400">
              <span>{msg.role === "user" ? "👤 أنت" : "🤖 المساعد الذكي"}</span>
            </div>

            <p className="text-base sm:text-lg leading-relaxed whitespace-pre-wrap select-text">
              {msg.content}
            </p>

            {/* Badges for completed tools */}
            {msg.tools && msg.tools.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-zinc-800">
                {msg.tools.map((t, tIdx) => (
                  <span
                    key={tIdx}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-zinc-950 border border-teal-500/50 text-teal-300 text-xs font-mono font-bold"
                  >
                    ⚙️ نفذت {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* HUMAN-IN-THE-LOOP POWER CONFIRMATION CARD */}
        {pendingAction && (
          <div
            className="p-4 rounded-xl bg-amber-950/90 border-2 border-amber-500 flex flex-col gap-3 animate-in fade-in self-start max-w-[92%]"
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
                className="min-h-12 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold text-sm border border-teal-300"
              >
                تأكيد التنفيذ ✓
              </button>
              <button
                type="button"
                onClick={() => handleConfirmAction(false)}
                className="min-h-12 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm border border-rose-300"
              >
                إلغاء ✕
              </button>
            </div>
          </div>
        )}

        {/* SLEEK LOADING & STREAMING INDICATOR BUBBLE */}
        {isStreaming && (
          <div className="self-start max-w-[88%] sm:max-w-[80%] rounded-2xl p-3.5 sm:p-4 border-2 bg-zinc-900 border-teal-500/70 text-zinc-100 flex flex-col gap-2 animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-2 text-teal-300 text-xs font-bold border-b border-zinc-800 pb-1.5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-teal-500"></span>
                </span>
                <span>جاري التنفيذ والرد...</span>
              </div>
              {currentRouteInfo && (
                <div className="flex items-center gap-1.5 text-[11px] font-mono">
                  <span className="px-1.5 py-0.5 rounded bg-zinc-950 border border-teal-500/50 text-teal-300 font-bold">
                    🎯 {currentRouteInfo.domain}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-700 text-zinc-300">
                    {currentRouteInfo.targetModel}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${
                    currentRouteInfo.complexity === 'complex'
                      ? 'bg-amber-950/80 border-amber-500/50 text-amber-300 font-bold'
                      : 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300 font-bold'
                  }`}>
                    {currentRouteInfo.complexity === 'complex' ? 'مركب (5x)' : 'بسيط (1x)'}
                  </span>
                </div>
              )}
            </div>

            {currentRouteInfo?.cleanText && currentRouteInfo.cleanText !== currentRouteInfo.rawText && (
              <div className="text-xs text-zinc-400 italic bg-zinc-950/70 px-2.5 py-1 rounded border border-zinc-800">
                🔍 تم توجيه وتصحيح الأمر: "{currentRouteInfo.cleanText}"
              </div>
            )}

            {currentStreamText ? (
              <p className="text-base sm:text-lg leading-relaxed whitespace-pre-wrap">
                {currentStreamText}
              </p>
            ) : (
              <div className="flex items-center gap-2 py-1 text-zinc-400">
                <span className="w-2 h-2 bg-teal-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-2 h-2 bg-teal-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-2 h-2 bg-teal-400 rounded-full animate-bounce"></span>
                <span className="text-xs sm:text-sm text-zinc-400 mr-2">
                  بيبحث وينفّذ طلبك حالاً...
                </span>
              </div>
            )}

            {currentTools.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-zinc-800">
                {currentTools.map((t, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-zinc-950 border border-teal-500/50 text-teal-300 text-xs font-mono font-bold"
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

      {/* 3. PINNED BOTTOM ACTION BAR (Chips + Input + Voice + Send) */}
      <footer className="shrink-0 p-2.5 sm:p-4 bg-zinc-900 border-t-2 border-zinc-800 flex flex-col gap-2.5">
        {/* Live Audio Listening Status Banner */}
        {isListening && (
          <div
            className="p-2.5 rounded-xl bg-rose-950/90 border-2 border-rose-500 text-rose-100 text-xs sm:text-sm font-bold flex items-center justify-between gap-2 shadow-lg animate-pulse"
            role="status"
          >
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-rose-500 animate-ping" />
              <span>🔴 جاري الاستماع اللحظي (Google Web Speech ar-EG)... تحدث الآن</span>
            </div>
            <span className="text-xs text-rose-300 font-normal">يتم الإرسال فور التوقف</span>
          </div>
        )}

        {/* Error notification banner */}
        {speechError && (
          <div
            className="p-2 sm:p-2.5 rounded-xl bg-rose-950/90 border border-rose-600 text-rose-100 text-xs sm:text-sm font-semibold flex items-center justify-between gap-2 animate-in fade-in"
            role="alert"
          >
            <span className="truncate">{speechError}</span>
            <button
              type="button"
              onClick={() => setSpeechError("")}
              className="text-xs px-2 py-0.5 rounded bg-rose-900 hover:bg-rose-800 text-white font-bold shrink-0"
            >
              ✕
            </button>
          </div>
        )}

        {/* Quick Action Chips (Horizontally Scrollable without breaking mobile layout) */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar select-none"
          aria-label="Quick Action Suggestions"
        >
          {quickChips.map((chip, idx) => (
            <button
              key={idx}
              type="button"
              disabled={isStreaming}
              onClick={() => handleSendMessage(chip.text)}
              className="whitespace-nowrap px-3 py-1.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs sm:text-sm font-medium transition-colors shrink-0 disabled:opacity-40"
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Unified Input Row: Voice Button + Text Input + Send Button */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          {/* Voice Input Button (Google Web Speech API ar-EG) */}
          <button
            type="button"
            onClick={toggleListening}
            disabled={isStreaming || !speechSupported}
            className={`min-h-14 w-14 sm:w-16 rounded-xl flex items-center justify-center shrink-0 border-2 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 disabled:opacity-40 ${
              isListening
                ? "bg-rose-600 hover:bg-rose-500 text-white border-rose-300 animate-pulse"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-600"
            }`}
            aria-pressed={isListening}
            aria-label={
              isListening
                ? "إيقاف الاستماع الصوتي"
                : "تحدث بالمايك (Google Web Speech ar-EG)"
            }
            title={
              isListening
                ? "إيقاف الاستماع"
                : "تحدث بالصوت فورياً (Google Web Speech)"
            }
          >
            <span className="text-2xl" aria-hidden="true">
              {isListening ? "⏹" : "🎙️"}
            </span>
          </button>

          {/* Text Input Field */}
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="اكتب طلبك... (شغلي ملخص ماتش وعلي الصوت)"
            disabled={isStreaming}
            className="flex-1 min-h-14 px-4 py-3 rounded-xl bg-zinc-950 border-2 border-zinc-700 text-zinc-50 text-base sm:text-lg placeholder-zinc-500 focus:outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-500/20 disabled:opacity-50"
            aria-label="Text command for AI OS assistant"
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputText.trim() || isStreaming}
            className="min-h-14 px-4 sm:px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 disabled:bg-zinc-800 disabled:opacity-40 text-white font-bold text-base sm:text-lg border-2 border-teal-300 disabled:border-zinc-700 flex items-center justify-center gap-1.5 shrink-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Send text command"
          >
            <span className="hidden sm:inline">إرسال</span>
            <span className="text-xl" aria-hidden="true">
              ➤
            </span>
          </button>
        </form>
      </footer>
    </div>
  );
}
