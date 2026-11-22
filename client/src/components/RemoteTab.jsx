import { useState, useEffect } from 'react';
import { socket } from '../socket';
import LiveTypingInput from './LiveTypingInput';

export default function RemoteTab() {
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const handleFeedback = (data) => {
      if (data?.success) {
        setFeedback(`✓ ${data.message || data.action || 'تم التنفيذ بنجاح'}`);
      } else if (data?.error) {
        setFeedback(`✕ خطأ: ${data.error}`);
      }
      setTimeout(() => setFeedback(''), 2500);
    };

    socket.on('remote_feedback', handleFeedback);
    return () => socket.off('remote_feedback', handleFeedback);
  }, []);

  const triggerYoutube = (action) => {
    socket.emit('youtube_control', { action });
  };

  const triggerMedia = (action) => {
    socket.emit('remote_media', { action });
  };

  const triggerSystemControl = (action) => {
    socket.emit('system_control', { action });
  };

  const triggerClick = (button) => {
    socket.emit('mouse_click', { button });
  };

  const triggerScroll = (direction) => {
    socket.emit('mouse_scroll', { direction, amount: 3 });
  };

  const launchApp = (appName) => {
    socket.emit('ai_command', { text: `افتح تطبيق ${appName}` });
    setFeedback(`جاري طلب تشغيل ${appName}...`);
    setTimeout(() => setFeedback(''), 2000);
  };

  return (
    <div
      className="flex flex-col gap-6 w-full overflow-y-auto max-h-[calc(100dvh-64px)] pb-16"
      aria-label="Remote Media and YouTube Controller"
    >
      {/* Header */}
      <div className="p-6 rounded-xl bg-zinc-900 border-2 border-zinc-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-50">
            📱 الريموت المساعد وتحكم يوتيوب (Assistive Remote)
          </h2>
          <p className="text-base text-zinc-300 mt-1">
            أزرار تحكم كاملة لفيديوهات يوتيوب (تخطي الإعلان، التشغيل، التقديم، السرعة) والتحكم العام بنظام الحاسوب.
          </p>
        </div>

        {feedback && (
          <div
            className="px-4 py-2 rounded-lg bg-teal-950 border border-teal-500 text-teal-300 font-bold text-base animate-in fade-in"
            role="status"
          >
            {feedback}
          </div>
        )}
      </div>

      {/* TOP SECTION: LIVE TYPING CONTROLLER (Instant Access on Mobile) */}
      <LiveTypingInput />

      {/* SECTION 1: FULL YOUTUBE DEDICATED CONTROLLER (Restored & Enhanced) */}
      <section
        aria-label="YouTube Dedicated Player Controls"
        className="p-6 rounded-2xl bg-zinc-900 border-2 border-red-900/60 flex flex-col gap-5"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl text-red-500" aria-hidden="true">
              ▶️
            </span>
            <h3 className="text-2xl font-bold text-zinc-50">
              أزرار التحكم في يوتيوب (YouTube Remote)
            </h3>
          </div>
          <span className="text-sm font-semibold text-zinc-400">
            اختصارات لوحة المفاتيح المباشرة لمشغل يوتيوب
          </span>
        </div>

        {/* PRIMARY ACTION: SKIP AD (Large, Emergency-Level Visibility) */}
        <div>
          <button
            type="button"
            onClick={() => triggerYoutube('skip_ad')}
            className="w-full min-h-16 px-6 py-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xl sm:text-2xl border-2 border-amber-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
            aria-label="Skip YouTube Ad"
          >
            <span className="text-2xl" aria-hidden="true">
              ⏭️
            </span>
            <span>تخطي الإعلان (Skip Ad)</span>
          </button>
        </div>

        {/* Main Playback & Screen Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            type="button"
            onClick={() => triggerYoutube('play_pause')}
            className="min-h-16 px-6 py-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xl border-2 border-teal-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Play or Pause Video (K)"
          >
            <span className="text-2xl" aria-hidden="true">
              ⏯️
            </span>
            <span>تشغيل / إيقاف (K)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerYoutube('fullscreen')}
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Toggle Fullscreen (F)"
          >
            <span className="text-2xl" aria-hidden="true">
              ⛶
            </span>
            <span>ملء الشاشة (F)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerYoutube('mute')}
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Mute Video (M)"
          >
            <span className="text-2xl" aria-hidden="true">
              🔇
            </span>
            <span>كتم الصوت (M)</span>
          </button>
        </div>

        {/* Seeking (Forward / Rewind 10s) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => triggerYoutube('rewind')}
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Rewind 10 Seconds (J)"
          >
            <span className="text-2xl" aria-hidden="true">
              ⏪
            </span>
            <span>تأخير 10 ثوانٍ (-10s / J)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerYoutube('forward')}
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Forward 10 Seconds (L)"
          >
            <span className="text-2xl" aria-hidden="true">
              ⏩
            </span>
            <span>تقديم 10 ثوانٍ (+10s / L)</span>
          </button>
        </div>

        {/* Video Speed Control & Captions & Next */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => triggerYoutube('speed_down')}
            className="min-h-16 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Slow Down Video"
          >
            <span className="text-xl" aria-hidden="true">
              🐢
            </span>
            <span>تبطيء السرعة (&lt;)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerYoutube('speed_up')}
            className="min-h-16 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Speed Up Video"
          >
            <span className="text-xl" aria-hidden="true">
              ⚡
            </span>
            <span>تسريع (&gt;)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerYoutube('captions')}
            className="min-h-16 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Toggle Subtitles / Captions (C)"
          >
            <span className="text-xl" aria-hidden="true">
              💬
            </span>
            <span>الترجمة (C)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerYoutube('next_video')}
            className="min-h-16 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Next Video (Shift+N)"
          >
            <span className="text-xl" aria-hidden="true">
              ⏭️
            </span>
            <span>التالي (Next)</span>
          </button>
        </div>

        {/* YouTube Volume Adjusters */}
        <div className="grid grid-cols-2 gap-4 pt-1">
          <button
            type="button"
            onClick={() => triggerYoutube('volume_up')}
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="YouTube Volume Up"
          >
            <span className="text-2xl" aria-hidden="true">
              🔊
            </span>
            <span>رفع صوت يوتيوب (▲)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerYoutube('volume_down')}
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="YouTube Volume Down"
          >
            <span className="text-2xl" aria-hidden="true">
              🔉
            </span>
            <span>خفض صوت يوتيوب (▼)</span>
          </button>
        </div>
      </section>

      {/* SECTION 2: BROWSER ZOOM & WINDOW SWITCH CONTROLS */}
      <section
        aria-label="Browser Zoom and Window Switching Controls"
        className="p-6 rounded-2xl bg-zinc-900 border-2 border-zinc-700 flex flex-col gap-5"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden="true">
              🪟
            </span>
            <h3 className="text-2xl font-bold text-zinc-50">
              التحكم في النوافذ والتكبير (Windows & Zoom)
            </h3>
          </div>
          <span className="text-sm font-semibold text-zinc-400">
            تكبير/تصغير صفحات الويب والتبديل السريع بين التطبيقات
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <button
            type="button"
            onClick={() => triggerSystemControl('browser_back')}
            className="min-h-16 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-base sm:text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Browser Back (Alt + Left)"
          >
            <span className="text-xl" aria-hidden="true">
              ⬅
            </span>
            <span>رجوع (Alt+←)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerSystemControl('browser_forward')}
            className="min-h-16 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-base sm:text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Browser Forward (Alt + Right)"
          >
            <span className="text-xl" aria-hidden="true">
              ➡
            </span>
            <span>تقديم (Alt+→)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerSystemControl('zoom_in')}
            className="min-h-16 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-base sm:text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Zoom In (Ctrl +)"
          >
            <span className="text-xl" aria-hidden="true">
              🔍+
            </span>
            <span>تكبير (Ctrl +)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerSystemControl('zoom_out')}
            className="min-h-16 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-base sm:text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Zoom Out (Ctrl -)"
          >
            <span className="text-xl" aria-hidden="true">
              🔍-
            </span>
            <span>تصغير (Ctrl -)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerSystemControl('zoom_reset')}
            className="min-h-16 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-base sm:text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Reset Zoom (Ctrl 0)"
          >
            <span className="text-xl" aria-hidden="true">
              🔄
            </span>
            <span>حجم 100%</span>
          </button>

          <button
            type="button"
            onClick={() => triggerSystemControl('switch_window')}
            className="min-h-16 px-4 py-3 rounded-xl bg-teal-700 hover:bg-teal-600 text-white font-bold text-base sm:text-lg border-2 border-teal-300 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Switch Windows (Alt + Tab)"
          >
            <span className="text-xl" aria-hidden="true">
              📑
            </span>
            <span>تبديل النوافذ</span>
          </button>
        </div>
      </section>

      {/* SECTION 3: SYSTEM AUDIO & GENERAL MOUSE CONTROLS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* General System Audio */}
        <section
          aria-label="General System Audio Controls"
          className="p-6 rounded-xl bg-zinc-900 border-2 border-zinc-700 flex flex-col gap-4"
        >
          <h3 className="text-xl font-bold text-zinc-50 border-b border-zinc-700 pb-2">
            🔊 صوت النظام العام (Windows Audio)
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => triggerMedia('volume_up')}
              className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
              aria-label="System Volume Up"
            >
              <span className="text-2xl" aria-hidden="true">
                🔊
              </span>
              <span>صوت النظام (+)</span>
            </button>

            <button
              type="button"
              onClick={() => triggerMedia('volume_down')}
              className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
              aria-label="System Volume Down"
            >
              <span className="text-2xl" aria-hidden="true">
                🔉
              </span>
              <span>صوت النظام (-)</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => triggerMedia('mute')}
              className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
              aria-label="Mute Windows Master Volume"
            >
              <span className="text-2xl" aria-hidden="true">
                🔇
              </span>
              <span>كتم صوت النظام</span>
            </button>

            <button
              type="button"
              onClick={() => triggerMedia('play_pause')}
              className="min-h-16 px-6 py-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xl border-2 border-teal-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
              aria-label="Play/Pause System Media"
            >
              <span className="text-2xl" aria-hidden="true">
                ⏯️
              </span>
              <span>تشغيل الوسائط</span>
            </button>
          </div>
        </section>

        {/* General Mouse Clicks & Scrolling */}
        <section
          aria-label="Mouse Actions"
          className="p-6 rounded-xl bg-zinc-900 border-2 border-zinc-700 flex flex-col gap-4"
        >
          <h3 className="text-xl font-bold text-zinc-50 border-b border-zinc-700 pb-2">
            🖱️ نقرات وتمرير الفأرة (Mouse Controls)
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => triggerClick('left')}
              className="min-h-16 px-6 py-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xl border-2 border-teal-300 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
              aria-label="Left Click"
            >
              <span className="text-2xl" aria-hidden="true">
                👆
              </span>
              <span>كليك يسار</span>
            </button>

            <button
              type="button"
              onClick={() => triggerClick('right')}
              className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
              aria-label="Right Click"
            >
              <span className="text-2xl" aria-hidden="true">
                👉
              </span>
              <span>كليك يمين</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => triggerScroll('up')}
              className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
              aria-label="Scroll Up"
            >
              <span className="text-2xl" aria-hidden="true">
                ▲
              </span>
              <span>تمرير لأعلى</span>
            </button>

            <button
              type="button"
              onClick={() => triggerScroll('down')}
              className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
              aria-label="Scroll Down"
            >
              <span className="text-2xl" aria-hidden="true">
                ▼
              </span>
              <span>تمرير لأسفل</span>
            </button>
          </div>

          {/* Quick Apps row */}
          <div className="pt-2 border-t border-zinc-800">
            <span className="text-sm font-bold text-zinc-400 block mb-2">
              تشغيل التطبيقات السريعة:
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => launchApp('calculator')}
                className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-semibold flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <span>🧮</span>
                <span>الحاسبة</span>
              </button>
              <button
                type="button"
                onClick={() => launchApp('notepad')}
                className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-semibold flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <span>📝</span>
                <span>المفكرة</span>
              </button>
              <button
                type="button"
                onClick={() => launchApp('chrome')}
                className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-semibold flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <span>🌐</span>
                <span>كروم</span>
              </button>
              <button
                type="button"
                onClick={() => launchApp('vscode')}
                className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm font-semibold flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <span>💻</span>
                <span>VSCode</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
