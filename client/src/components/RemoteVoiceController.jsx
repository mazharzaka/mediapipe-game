import { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';

export default function RemoteVoiceController() {
  // Voice Recognition State via Google Web Speech API (ar-EG / en-US)
  const [isListening, setIsListening] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState('ar-EG');
  const [transcript, setTranscript] = useState('');
  const [speechError, setSpeechError] = useState(null);
  const [speechSupported, setSpeechSupported] = useState(true);

  // User action feedback banner
  const [actionFeedback, setActionFeedback] = useState(null);
  const feedbackTimeoutRef = useRef(null);

  // SpeechRecognition reference
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);

  // Trigger temporary feedback badge/banner
  const showFeedback = (message) => {
    setActionFeedback(message);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => {
      setActionFeedback(null);
    }, 2500);
  };

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
      recognition.lang = voiceLanguage;

      recognition.onstart = () => {
        setIsListening(true);
        isListeningRef.current = true;
        setSpeechError(null);
      };

      recognition.onresult = (event) => {
        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += piece;
          } else {
            interimText += piece;
          }
        }

        const currentText = (finalText || interimText).trim();
        if (currentText) {
          setTranscript(currentText);
        }

        if (finalText && finalText.trim()) {
          showFeedback(`تم التقاط الصوت: "${finalText.trim()}"`);
        }
      };

      recognition.onerror = (event) => {
        console.error('[RemoteVoice WebSpeech Error]:', event.error);
        setIsListening(false);
        isListeningRef.current = false;
        if (event.error === 'no-speech') {
          setSpeechError('لم يتم سماع أي صوت، حاول مجدداً.');
        } else if (event.error === 'not-allowed') {
          setSpeechError('تم رفض إذن استخدام الميكروفون.');
        } else {
          setSpeechError(`خطأ في التعرف على الصوت: ${event.error}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        isListeningRef.current = false;
      };

      recognitionRef.current = recognition;
    } catch (err) {
      console.error('Could not initialize SpeechRecognition:', err);
      setSpeechSupported(false);
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (_) {}
      }
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, [voiceLanguage]);

  // Toggle Voice Recognition
  const toggleListening = () => {
    if (!speechSupported) return;
    if (isListeningRef.current) {
      try {
        recognitionRef.current?.stop();
      } catch (_) {}
      setIsListening(false);
      isListeningRef.current = false;
    } else {
      setSpeechError(null);
      try {
        if (recognitionRef.current) {
          recognitionRef.current.lang = voiceLanguage;
          recognitionRef.current.start();
        }
      } catch (err) {
        console.error('Error starting speech recognition:', err);
        setIsListening(false);
        isListeningRef.current = false;
      }
    }
  };

  // Switch recognition language
  const toggleLanguage = () => {
    if (isListeningRef.current) {
      try {
        recognitionRef.current?.stop();
      } catch (_) {}
      setIsListening(false);
      isListeningRef.current = false;
    }
    const nextLang = voiceLanguage === 'ar-EG' ? 'en-US' : 'ar-EG';
    setVoiceLanguage(nextLang);
    showFeedback(`تم تغيير لغة الصوت إلى: ${nextLang === 'ar-EG' ? 'العربية' : 'English'}`);
  };

  // Perform voice search dispatch
  const handleSearch = (platform) => {
    if (!transcript.trim()) return;
    socket.emit('voice_search', { query: transcript.trim(), platform });
    showFeedback(
      platform === 'youtube'
        ? `جاري البحث في يوتيوب عن: "${transcript.trim()}"`
        : `جاري البحث في جوجل عن: "${transcript.trim()}"`
    );
  };

  // Dispatch media remote actions
  const sendRemoteAction = (action, label) => {
    socket.emit('remote_action', { action });
    showFeedback(`تم إرسال: ${label}`);
  };

  return (
    <section
      className="flex flex-col gap-6 w-full"
      aria-label="Smart Remote and Voice Control"
    >
      {/* Live Action Feedback Notification Banner (WCAG AAA) */}
      {actionFeedback && (
        <div
          role="status"
          aria-live="polite"
          className="p-4 rounded-xl bg-teal-600 border-2 border-teal-300 text-white font-bold text-lg flex items-center justify-between shadow-none animate-fadeIn"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">
              ✓
            </span>
            <span>{actionFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            className="px-3 py-1 bg-teal-800 hover:bg-teal-700 rounded-md text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* 1. Voice Search Section */}
      <div className="p-6 rounded-2xl bg-zinc-900 border-2 border-zinc-700 flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-700 pb-3">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-zinc-50 flex items-center gap-2">
              <span aria-hidden="true">🎙️</span>
              <span>البحث بالصوت / Voice Search</span>
            </h2>
            <p className="text-base text-zinc-300">
              تحدث للبحث الفوري على شاشة اللابتوب عبر يوتيوب أو جوجل.
            </p>
          </div>

          {/* Language Toggle Button */}
          <button
            type="button"
            onClick={toggleLanguage}
            className="min-h-14 px-5 py-2.5 rounded-xl bg-zinc-950 border-2 border-zinc-700 hover:border-zinc-500 text-zinc-100 font-bold text-lg flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
            aria-label={`Current language: ${voiceLanguage === 'ar-EG' ? 'Arabic' : 'English'
              }. Click to switch language.`}
          >
            <span className="text-xl" aria-hidden="true">
              🌐
            </span>
            <span>
              {voiceLanguage === 'ar-EG' ? 'اللغة: العربية (مصر)' : 'Lang: English (US)'}
            </span>
          </button>
        </div>

        {/* Browser Speech API Warning if Unsupported */}
        {!speechSupported && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-red-950 border-2 border-red-500 text-red-200 text-base font-semibold"
          >
            [!] ميزة التعرف الصوتي غير مدعومة في هذا المتصفح. يُرجى فتح الصفحة عبر متصفح Google Chrome أو Microsoft Edge على الهاتف أو الحاسوب.
          </div>
        )}

        {/* Large Accessible Microphone Target Button */}
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={toggleListening}
            disabled={!speechSupported}
            className={`w-full min-h-24 sm:min-h-28 px-6 py-5 rounded-2xl text-2xl sm:text-3xl font-extrabold flex items-center justify-center gap-4 border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-zinc-950 disabled:opacity-40 disabled:cursor-not-allowed ${isListening
              ? 'bg-red-600 hover:bg-red-500 text-white border-red-300 shadow-none'
              : 'bg-teal-600 hover:bg-teal-500 text-white border-teal-300 shadow-none'
              }`}
            aria-pressed={isListening}
            aria-label={
              isListening
                ? 'Stop listening for voice search'
                : 'Start microphone for voice search'
            }
          >
            <span className="text-4xl" aria-hidden="true">
              {isListening ? '⏹' : '🎙️'}
            </span>
            <span>
              {isListening
                ? 'جارٍ الاستماع الآن... (اضغط للإيقاف)'
                : 'اضغط هنا للتحدث بالصوت / Tap to Speak'}
            </span>
          </button>

          {speechError && (
            <p className="text-red-400 font-semibold text-base" role="alert">
              ⚠️ {speechError}
            </p>
          )}
        </div>

        {/* Transcribed Text Display Box */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col gap-2">
          <label
            htmlFor="voice-query-input"
            className="text-sm font-semibold text-zinc-300 flex items-center justify-between"
          >
            <span>النص المسموع / Detected Text:</span>
            {transcript && (
              <button
                type="button"
                onClick={() => setTranscript('')}
                className="text-xs text-zinc-400 hover:text-white underline"
              >
                مسح / Clear
              </button>
            )}
          </label>
          <input
            id="voice-query-input"
            type="text"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="النص المنطوق سيظهر هنا، أو يمكنك الكتابة يدوياً..."
            className="w-full min-h-14 px-4 rounded-lg bg-zinc-900 border border-zinc-700 text-xl font-bold text-zinc-50 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
          />
        </div>

        {/* Action Buttons for Search */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => handleSearch('youtube')}
            disabled={!transcript.trim()}
            className="min-h-16 px-6 py-4 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xl border-2 border-red-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
            aria-label="Search in YouTube on Windows computer"
          >
            <span className="text-2xl" aria-hidden="true">
              ▶️
            </span>
            <span>بحث في يوتيوب (YouTube)</span>
          </button>

          <button
            type="button"
            onClick={() => handleSearch('google')}
            disabled={!transcript.trim()}
            className="min-h-16 px-6 py-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xl border-2 border-blue-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
            aria-label="Search in Google on Windows computer"
          >
            <span className="text-2xl" aria-hidden="true">
              🔍
            </span>
            <span>بحث في جوجل (Google)</span>
          </button>
        </div>
      </div>

      {/* 2. YouTube & Media Remote Shortcuts Section */}
      <div className="p-6 rounded-2xl bg-zinc-900 border-2 border-zinc-700 flex flex-col gap-6">
        <div className="border-b border-zinc-700 pb-3">
          <h2 className="text-2xl font-bold text-zinc-50 flex items-center gap-2">
            <span aria-hidden="true">📺</span>
            <span>اختصارات يوتيوب والميديا / YouTube & Media Remote</span>
          </h2>
          <p className="text-base text-zinc-300 mt-1">
            أزرار تحكم ضخمة وسريعة ترسل أوامر المفاتيح إلى كمبيوتر الويندوز مباشرة.
          </p>
        </div>

        {/* Primary YouTube Navigation Buttons (Open YouTube + Skip Ad) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Primary Action: Open YouTube */}
          <button
            type="button"
            onClick={() => sendRemoteAction('open_youtube', 'فتح موقع يوتيوب')}
            className="min-h-16 px-6 py-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold text-xl border-2 border-red-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
            aria-label="Open YouTube website on Windows"
          >
            <span className="text-3xl" aria-hidden="true">
              🌐
            </span>
            <span>فتح يوتيوب / Open YouTube</span>
          </button>

          {/* Dedicated Skip Ad Button */}
          <button
            type="button"
            onClick={() => sendRemoteAction('skip_ad', 'تخطي الإعلان (Skip Ad)')}
            className="min-h-16 px-6 py-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-extrabold text-xl border-2 border-amber-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
            aria-label="Skip YouTube Ad in Fullscreen"
          >
            <span className="text-3xl" aria-hidden="true">
              ⏭️
            </span>
            <span>تخطي الإعلان / Skip Ad</span>
          </button>
        </div>

        {/* Playback Controls (Play/Pause, Forward 10, Rewind 10) */}
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-zinc-300">
            التحكم في العرض / Playback:
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Play / Pause (K) */}
            <button
              type="button"
              onClick={() => sendRemoteAction('play_pause', 'تشغيل / إيقاف المؤقت (K)')}
              className="min-h-16 px-4 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Play or Pause video (Key K)"
            >
              <span className="text-2xl" aria-hidden="true">
                ⏯️
              </span>
              <span>تشغيل / إيقاف (K)</span>
            </button>

            {/* Rewind 10s (J) */}
            <button
              type="button"
              onClick={() => sendRemoteAction('rewind_10', 'ترجيع 10 ثوانٍ (J)')}
              className="min-h-16 px-4 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Rewind 10 seconds (Key J)"
            >
              <span className="text-2xl" aria-hidden="true">
                ⏪
              </span>
              <span>ترجيع 10 ثوانٍ (J)</span>
            </button>

            {/* Forward 10s (L) */}
            <button
              type="button"
              onClick={() => sendRemoteAction('forward_10', 'تقديم 10 ثوانٍ (L)')}
              className="min-h-16 px-4 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Forward 10 seconds (Key L)"
            >
              <span className="text-2xl" aria-hidden="true">
                ⏩
              </span>
              <span>تقديم 10 ثوانٍ (L)</span>
            </button>
          </div>
        </div>

        {/* Speed & Volume Controls */}
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-zinc-300">
            السرعة والصوت / Speed & Audio:
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Speed Up (Shift + >) */}
            <button
              type="button"
              onClick={() => sendRemoteAction('speed_up', 'تسريع الفيديو (Shift + >)')}
              className="min-h-16 px-4 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Speed up video (Shift + Period)"
            >
              <span className="text-2xl" aria-hidden="true">
                ⚡
              </span>
              <span>تسريع الفيديو (&gt;)</span>
            </button>

            {/* Speed Down (Shift + <) */}
            <button
              type="button"
              onClick={() => sendRemoteAction('speed_down', 'إبطاء السرعة (Shift + <)')}
              className="min-h-16 px-4 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Slow down video (Shift + Comma)"
            >
              <span className="text-2xl" aria-hidden="true">
                🐢
              </span>
              <span>إبطاء السرعة (&lt;)</span>
            </button>

            {/* Mute (M) */}
            <button
              type="button"
              onClick={() => sendRemoteAction('mute', 'كتم / تشغيل الصوت (M)')}
              className="min-h-16 px-4 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Mute or Unmute audio (Key M)"
            >
              <span className="text-2xl" aria-hidden="true">
                🔇
              </span>
              <span>كتم الصوت (M)</span>
            </button>
          </div>
        </div>

        {/* Display & Browser Controls (Fullscreen, Close Tab) */}
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-zinc-300">
            العرض والمتصفح / Display & Tab:
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Fullscreen (F) */}
            <button
              type="button"
              onClick={() => sendRemoteAction('fullscreen', 'ملء الشاشة (F)')}
              className="min-h-16 px-4 py-4 rounded-xl bg-purple-700 hover:bg-purple-600 text-white font-bold text-xl border-2 border-purple-400 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Toggle Fullscreen (Key F)"
            >
              <span className="text-2xl" aria-hidden="true">
                ⛶
              </span>
              <span>ملء الشاشة / Fullscreen (F)</span>
            </button>

            {/* Close Tab (Ctrl + W) */}
            <button
              type="button"
              onClick={() => sendRemoteAction('close_tab', 'إغلاق التاب الحالي (Ctrl + W)')}
              className="min-h-16 px-4 py-4 rounded-xl bg-zinc-950 hover:bg-red-900/60 text-red-300 hover:text-white font-bold text-xl border-2 border-red-500/80 hover:border-red-400 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Close current browser tab (Ctrl + W)"
            >
              <span className="text-2xl" aria-hidden="true">
                ❌
              </span>
              <span>إغلاق التاب (Ctrl + W)</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
