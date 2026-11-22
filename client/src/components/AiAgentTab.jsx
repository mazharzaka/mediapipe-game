import { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';

export default function AiAgentTab() {
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'أهلاً بك! أنا مساعد التحكم الذكي (AI OS Agent). اطلب مني بالصوت أو الكتابة فتح المواقع، تشغيل البرامج، التحكم في مستوى الصوت والوسائط، أو فحص حالة الحاسوب.',
      tools: [],
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStreamText, setCurrentStreamText] = useState('');
  const [currentTools, setCurrentTools] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [speechError, setSpeechError] = useState('');
  const [socketStatus, setSocketStatus] = useState(socket.connected);

  const recognitionRef = useRef(null);
  const chatBottomRef = useRef(null);

  // Monitor socket connection
  useEffect(() => {
    const handleConnect = () => setSocketStatus(true);
    const handleDisconnect = () => setSocketStatus(false);

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, []);

  // Auto-scroll chat to latest message
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamText, pendingAction]);

  // Socket listeners for streaming AI responses & Errors
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
            role: 'assistant',
            content: finalText,
            tools: finalTools,
          },
        ]);
      }

      if (data?.pendingAction) {
        setPendingAction(data.pendingAction);
      }

      setCurrentStreamText('');
      setCurrentTools([]);
    };

    const handleAiError = (data) => {
      setIsStreaming(false);
      const errText = data?.error || 'خطأ غير معروف في خادم الذكاء الاصطناعي';
      setSpeechError(`[تنبيه السيرفر]: ${errText}`);

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ خطأ في المساعد الذكي:\n${errText}\n\nيرجى التأكد من إضافة GOOGLE_GENERATIVE_AI_API_KEY صحيح في ملف server/.env والتأكد من تفعيل خدمة Gemini API.`,
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
          role: 'assistant',
          content: data?.success
            ? `✓ ${data.message || 'تم تأكيد وتنفيذ الأمر بنجاح.'}`
            : `✕ فشل تنفيذ الأمر: ${data?.error || 'خطأ غير معروف'}`,
          tools: [],
        },
      ]);
    };

    const handleActionCancelled = (data) => {
      setPendingAction(null);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `ℹ️ ${data?.message || 'تم إلغاء الأمر بأمان بناءً على رغبتك.'}`,
          tools: [],
        },
      ]);
    };

    socket.on('ai_stream_chunk', handleChunk);
    socket.on('ai_stream_done', handleDone);
    socket.on('ai_error', handleAiError);
    socket.on('ai_action_confirmed', handleActionConfirmed);
    socket.on('ai_action_cancelled', handleActionCancelled);

    return () => {
      socket.off('ai_stream_chunk', handleChunk);
      socket.off('ai_stream_done', handleDone);
      socket.off('ai_error', handleAiError);
      socket.off('ai_action_confirmed', handleActionConfirmed);
      socket.off('ai_action_cancelled', handleActionCancelled);
    };
  }, [currentStreamText, currentTools]);

  // Setup Web Speech API for Arabic (ar-EG) with clear Arabic error diagnosis
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ar-EG';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setSpeechError('');
    };

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = 0; i < event.results.length; i++) {
        const item = event.results[i];
        if (item.isFinal) {
          finalTranscript += item[0].transcript;
        } else {
          interimTranscript += item[0].transcript;
        }
      }

      const text = finalTranscript || interimTranscript;
      if (text) {
        setInputText(text);
      }
    };

    recognition.onerror = (event) => {
      console.warn('[Web Speech Error]:', event.error);
      setIsListening(false);

      // Diagnose exact browser reason in clear Arabic
      switch (event.error) {
        case 'not-allowed':
          setSpeechError(
            '❌ تم حظر إذن الميكروفون! اضغط على علامة القفل بجانب شريط العنوان واسمح بصلاحية الميكروفون للموقع.'
          );
          break;
        case 'service-not-allowed':
          setSpeechError(
            '⚠️ خدمة التعرف الصوتي غير مسموحة عبر اتصال غير آمن (HTTP). يجب فتح الموقع عبر HTTPS أو localhost لتشغيل المايك.'
          );
          break;
        case 'no-speech':
          setSpeechError('ℹ️ لم يتم التقاط صوت واضح، يرجى التحدث بوضوح وإعادة المحاولة.');
          break;
        case 'audio-capture':
          setSpeechError('❌ لم يتم العثور على ميكروفون متصل بجهازك.');
          break;
        case 'network':
          setSpeechError('⚠️ خطأ في الاتصال بالشبكة لخدمة التعرف الصوتي.');
          break;
        default:
          setSpeechError(`خطأ في الميكروفون: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, []);

  const toggleVoiceInput = () => {
    // Check HTTPS / Secure Context requirement for Web Speech
    const isLocal =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1');
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

    if (!isLocal && !isHttps) {
      setSpeechError(
        '⚠️ متصفحات الهواتف والكمبيوتر تحظر تشغيل الميكروفون عبر بروتوكول HTTP غير المشفر. لتفعيل المايك من الهاتف، استخدم رابط نفق HTTPS (مثل Cloudflare أو ngrok) أو افتح الموقع من الكمبيوتر عبر localhost.'
      );
      return;
    }

    if (!speechSupported) {
      setSpeechError('المتصفح الحالي لا يدعم ميزة التعرف الصوتي (Web Speech API).');
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setSpeechError('');
      try {
        recognitionRef.current?.start();
      } catch (err) {
        console.error('Speech start exception:', err);
        setSpeechError('تعذر بدء تشغيل الميكروفون، يرجى إعادة المحاولة.');
      }
    }
  };

  const handleSendMessage = (textToSend) => {
    const prompt = (textToSend || inputText).trim();
    if (!prompt || isStreaming) return;

    // Check socket connection first
    if (!socket.connected) {
      setSpeechError('⚠️ خادم السيرفر غير متصل حالياً! جاري محاولة إعادة الاتصال...');
      socket.connect();
      return;
    }

    // Append user message to UI history
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: prompt, tools: [] },
    ]);
    setInputText('');
    setSpeechError('');

    // Prepare context history
    const historyPayload = messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Emit AI command payload reliably to backend
    socket.emit('ai_command', {
      text: prompt,
      prompt,
      history: historyPayload,
    });
  };

  const handleConfirmAction = (confirmed) => {
    if (!pendingAction) return;
    socket.emit('ai_confirm_action', {
      actionId: pendingAction.id,
      action: pendingAction.action,
      confirmed,
    });
    if (!confirmed) {
      setPendingAction(null);
    }
  };

  const quickPrompts = [
    { label: '🌐 فتح يوتيوب', text: 'افتح موقع يوتيوب' },
    { label: '🔊 رفع الصوت', text: 'ارفع الصوت' },
    { label: '🔉 خفض الصوت', text: 'اخفض الصوت' },
    { label: '💻 فتح الحاسبة', text: 'افتح الآلة الحاسبة' },
    { label: '📊 فحص الجهاز', text: 'ما هي حالة الجهاز واستهلاك الرامات؟' },
    { label: '🔒 قفل الشاشة', text: 'اقفل شاشة الجهاز' },
  ];

  return (
    <div className="flex flex-col gap-6 w-full" aria-label="AI OS Assistant Section">
      {/* Information Header Card */}
      <div className="p-6 rounded-xl bg-zinc-900 border-2 border-zinc-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-zinc-950 border border-zinc-700 text-teal-400 font-mono text-sm font-bold">
            <span>[GEMINI 2.5 FLASH]</span>
            <span>Vercel AI SDK</span>
          </div>
          <h2 className="text-2xl font-bold text-zinc-50">
            🤖 المساعد الذكي لنظام التشغيل (AI OS Agent)
          </h2>
          <p className="text-base text-zinc-300">
            تحكم كامل في نظام التشغيل والتطبيقات والوسائط عبر الذكاء الاصطناعي بالأوامر الصوتية أو النصية.
          </p>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-950 border border-zinc-700 self-stretch sm:self-auto justify-center">
          <span
            className={`w-3.5 h-3.5 rounded-full ${
              isStreaming
                ? 'bg-amber-500 animate-pulse'
                : socketStatus
                  ? 'bg-green-500'
                  : 'bg-red-500'
            }`}
            aria-hidden="true"
          />
          <span className="text-base font-semibold text-zinc-200">
            {isStreaming
              ? '[●] جاري المعالجة...'
              : socketStatus
                ? '[●] جاهز للأوامر'
                : '[■] السيرفر غير متصل'}
          </span>
        </div>
      </div>

      {/* Human-in-the-Loop Dangerous Action Confirmation Card */}
      {pendingAction && (
        <section
          aria-label="Human in the loop confirmation required"
          className="p-6 rounded-xl bg-zinc-900 border-4 border-amber-500 flex flex-col gap-4 animate-in fade-in duration-150"
        >
          <div className="flex items-start gap-3">
            <span className="text-3xl" aria-hidden="true">
              ⚠️
            </span>
            <div className="space-y-1">
              <h3 className="text-2xl font-bold text-amber-300">
                مطلوب تأكيدك الصريح لتنفيذ أمر طاقة حساس (Human-in-the-Loop)
              </h3>
              <p className="text-lg text-zinc-100 font-semibold">
                طلب المساعد تنفيذ: <span className="text-amber-400 font-mono underline">{pendingAction.title || pendingAction.action}</span>
              </p>
              <p className="text-base text-zinc-300">
                حفاظاً على أمانك وبياناتك، لن يتم تنفيذ أي أمر إغلاق أو قفل للجهاز دون الضغط على زر التأكيد أدناه.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <button
              type="button"
              onClick={() => handleConfirmAction(true)}
              className="min-h-16 px-6 py-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xl border-2 border-teal-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Confirm and execute system power action"
            >
              <span className="text-2xl" aria-hidden="true">
                ✓
              </span>
              <span>تأكيد التنفيذ الآن / Confirm</span>
            </button>

            <button
              type="button"
              onClick={() => handleConfirmAction(false)}
              className="min-h-16 px-6 py-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xl border-2 border-red-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Cancel system power action"
            >
              <span className="text-2xl" aria-hidden="true">
                ✕
              </span>
              <span>إلغاء الأمر / Cancel</span>
            </button>
          </div>
        </section>
      )}

      {/* Chat Messages Display Container */}
      <section
        aria-label="AI Conversation Stream"
        className="p-6 rounded-xl bg-zinc-900 border-2 border-zinc-700 min-h-[340px] max-h-[500px] overflow-y-auto flex flex-col gap-4"
      >
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex flex-col gap-2 max-w-[85%] rounded-xl p-4 border-2 ${
              msg.role === 'user'
                ? 'self-end bg-teal-950/80 border-teal-600 text-teal-50'
                : msg.isError
                  ? 'self-start bg-red-950/80 border-red-600 text-red-100'
                  : 'self-start bg-zinc-950 border-zinc-700 text-zinc-100'
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-1 text-sm font-bold">
              <span>{msg.role === 'user' ? '👤 أنت (المستخدم)' : '🤖 المساعد الذكي'}</span>
            </div>

            <p className="text-lg leading-relaxed whitespace-pre-wrap select-text">
              {msg.content}
            </p>

            {/* Badges for completed tools */}
            {msg.tools && msg.tools.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800">
                {msg.tools.map((t, tIdx) => (
                  <div
                    key={tIdx}
                    className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-zinc-900 border border-teal-500 text-teal-300 text-sm font-mono font-semibold"
                  >
                    <span>⚙️ أداة: {t.name}</span>
                    {t.args && Object.keys(t.args).length > 0 && (
                      <span className="text-zinc-400 text-xs">
                        ({JSON.stringify(t.args)})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Live Streaming Response Bubble */}
        {isStreaming && (
          <div className="self-start max-w-[85%] rounded-xl p-4 border-2 bg-zinc-950 border-amber-600 text-zinc-100 flex flex-col gap-2 animate-pulse">
            <div className="flex items-center gap-2 text-amber-400 text-sm font-bold border-b border-zinc-800 pb-1">
              <span>● جاري الرد حيّاً (Streaming)...</span>
            </div>

            <p className="text-lg leading-relaxed whitespace-pre-wrap">
              {currentStreamText || 'جاري التفكير والتنفيذ...'}
            </p>

            {/* Streaming active tools badges */}
            {currentTools.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800">
                {currentTools.map((t, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-900 border border-teal-500 text-teal-300 text-sm font-mono font-semibold"
                  >
                    ✓ تم تنفيذ {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={chatBottomRef} />
      </section>

      {/* Quick Prompt Recommendation Chips */}
      <section aria-label="Quick Action Suggestions">
        <span className="text-base font-bold text-zinc-300 block mb-2">
          أوامر سريعة مقترحة (اضغط للتجربة الفورية):
        </span>
        <div className="flex flex-wrap gap-2">
          {quickPrompts.map((q, idx) => (
            <button
              key={idx}
              type="button"
              disabled={isStreaming}
              onClick={() => handleSendMessage(q.text)}
              className="min-h-14 px-4 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border-2 border-zinc-700 hover:border-zinc-500 text-zinc-200 text-base font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150 disabled:opacity-50"
            >
              {q.label}
            </button>
          ))}
        </div>
      </section>

      {/* Voice & Text Input Controls */}
      <section
        aria-label="Input Controls"
        className="p-6 rounded-xl bg-zinc-900 border-2 border-zinc-700 flex flex-col gap-4"
      >
        {/* Diagnostic Speech / Network Error Notice */}
        {speechError && (
          <div
            className="p-4 rounded-xl bg-red-950 border-2 border-red-600 text-red-100 text-base font-semibold flex items-center justify-between gap-3 animate-in fade-in"
            role="alert"
          >
            <span>{speechError}</span>
            <button
              type="button"
              onClick={() => setSpeechError('')}
              className="text-xs px-2 py-1 rounded bg-red-900 hover:bg-red-800 text-white font-bold"
            >
              إغلاق
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          {/* Large Accessible Microphone Voice Button */}
          <button
            type="button"
            onClick={toggleVoiceInput}
            disabled={isStreaming}
            className={`min-h-16 px-6 py-4 rounded-xl font-bold text-xl flex items-center justify-center gap-3 border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:opacity-50 ${
              isListening
                ? 'bg-red-600 hover:bg-red-500 text-white border-red-300'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-600'
            }`}
            aria-pressed={isListening}
            aria-label={
              isListening
                ? 'إيقاف الاستماع الصوتي'
                : 'بدء الاستماع الصوتي بالعامية المصرية'
            }
          >
            <span className="text-2xl" aria-hidden="true">
              {isListening ? '⏹' : '🎙️'}
            </span>
            <span>
              {isListening ? 'جاري الاستماع... (اضغط للإيقاف)' : 'تحدث بالصوت (ar-EG)'}
            </span>
          </button>

          {/* Text Input Box */}
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendMessage();
              }}
              placeholder="اكتب أمراً هنا... (مثلاً: افتح يوتيوب، علي الصوت، افتح الآلة الحاسبة)"
              disabled={isStreaming}
              className="flex-1 min-h-16 px-5 py-4 rounded-xl bg-zinc-950 border-2 border-zinc-700 text-zinc-50 text-lg placeholder-zinc-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:opacity-50"
              aria-label="Text command for AI OS assistant"
            />

            {/* Send Button */}
            <button
              type="button"
              onClick={() => handleSendMessage()}
              disabled={!inputText.trim() || isStreaming}
              className="min-h-16 px-8 py-4 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-800 disabled:opacity-40 text-white font-bold text-xl border-2 border-teal-300 disabled:border-zinc-700 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Send text command"
            >
              <span>إرسال</span>
              <span className="text-2xl" aria-hidden="true">
                ➤
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
