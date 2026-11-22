import { useState, useEffect } from 'react';
import { socket } from '../socket';
import LiveTypingInput from './LiveTypingInput';

/**
 * RemoteTab Component
 * Organized into 3 distinct, accessible sections (WCAG AAA >= 56px touch targets):
 * 1. Media & YouTube Controls
 * 2. Live Typing & Clipboard Synchronization (UTF-8)
 * 3. System Navigation & Power Controls (Lock & Sleep with Confirmation)
 */
export default function RemoteTab() {
  const [feedback, setFeedback] = useState('');
  const [clipboardText, setClipboardText] = useState('');
  const [showSleepConfirm, setShowSleepConfirm] = useState(false);

  useEffect(() => {
    const handleFeedback = (data) => {
      if (data?.success) {
        setFeedback(`✓ ${data.message || data.action || 'تم التنفيذ بنجاح'}`);
      } else if (data?.error) {
        setFeedback(`✕ خطأ: ${data.error}`);
      }
      setTimeout(() => setFeedback(''), 2500);
    };

    const handleClipboardContent = (data) => {
      if (data?.success) {
        if (data.text) {
          setClipboardText(data.text);
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(data.text).catch(() => {});
          }
          setFeedback('✓ تم جلب النص من الكمبيوتر ونسخه للموبايل');
        } else {
          setFeedback('الحافظة على الكمبيوتر فارغة حالياً');
        }
      } else if (data?.error) {
        setFeedback(`✕ فشل قراءة الحافظة: ${data.error}`);
      }
      setTimeout(() => setFeedback(''), 2500);
    };

    socket.on('remote_feedback', handleFeedback);
    socket.on('clipboard_content', handleClipboardContent);

    return () => {
      socket.off('remote_feedback', handleFeedback);
      socket.off('clipboard_content', handleClipboardContent);
    };
  }, []);

  const showToast = (msg) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(''), 2500);
  };

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
    showToast(`جاري طلب تشغيل ${appName}...`);
  };

  const handleCopyFromPC = () => {
    showToast('جاري قراءة الحافظة من الكمبيوتر...');
    socket.emit('clipboard_get', (res) => {
      if (res?.success && res.text) {
        setClipboardText(res.text);
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(res.text).catch(() => {});
        }
        showToast('✓ تم جلب النص من الكمبيوتر ونسخه للموبايل');
      } else if (res?.success && !res.text) {
        showToast('الحافظة على الكمبيوتر فارغة حالياً');
      } else if (res?.error) {
        showToast(`✕ فشل: ${res.error}`);
      }
    });
  };

  const handleSendToPC = () => {
    if (!clipboardText.trim()) return;
    socket.emit('clipboard_set', { text: clipboardText }, (res) => {
      if (res?.success) {
        showToast('✓ تم حفظ النص في كليبورد الكمبيوتر');
      } else if (res?.error) {
        showToast(`✕ فشل: ${res.error}`);
      }
    });
  };

  const handleLockPC = () => {
    socket.emit('power_action', { action: 'lock' }, (res) => {
      if (res?.success) {
        showToast('🔒 تم قفل شاشة الكمبيوتر بنجاح');
      }
    });
  };

  const handleConfirmSleep = () => {
    setShowSleepConfirm(false);
    socket.emit('power_action', { action: 'sleep' }, (res) => {
      if (res?.success) {
        showToast('🌙 تم إرسال أمر النوم (Sleep) للكمبيوتر');
      }
    });
  };

  return (
    <div
      className="flex flex-col gap-6 w-full overflow-y-auto max-h-[calc(100dvh-64px)] pb-16"
      aria-label="Remote Media and YouTube Controller"
    >
      {/* Header & Status */}
      <div className="p-4 sm:p-6 rounded-xl bg-zinc-900 border-2 border-zinc-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-zinc-50">
            📱 الريموت المساعد الشامل (Assistive Remote)
          </h2>
          <p className="text-sm sm:text-base text-zinc-300 mt-1">
            أزرار تحكم متكاملة في يوتيوب، الكتابة السريعة ومزامنة الحافظة، وإدارة النظام والطاقة.
          </p>
        </div>

        {feedback && (
          <div
            className="px-4 py-2 rounded-lg bg-teal-950 border border-teal-500 text-teal-300 font-bold text-sm sm:text-base animate-in fade-in"
            role="status"
          >
            {feedback}
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* SECTION 1: 🎬 MEDIA & YOUTUBE CONTROLLER                       */}
      {/* ============================================================== */}
      <section
        aria-label="YouTube and Media Controls"
        className="p-5 sm:p-6 rounded-2xl bg-zinc-900 border-2 border-red-900/60 flex flex-col gap-5"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl text-red-500" aria-hidden="true">
              🎬
            </span>
            <h3 className="text-xl sm:text-2xl font-bold text-zinc-50">
              1. تحكم يوتيوب والوسائط (Media & YouTube)
            </h3>
          </div>
          <span className="text-xs sm:text-sm font-semibold text-zinc-400">
            أزرار تحكم سريعة لمشغل يوتيوب والصوت العام
          </span>
        </div>

        {/* PRIMARY ACTION: SKIP AD (Emergency High Visibility) */}
        <div>
          <button
            type="button"
            onClick={() => triggerYoutube('skip_ad')}
            className="w-full min-h-16 px-6 py-4 rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-bold text-xl sm:text-2xl border-2 border-amber-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Skip YouTube Ad"
          >
            <span className="text-2xl" aria-hidden="true">
              ⏭️
            </span>
            <span>تخطي الإعلان (Skip Ad)</span>
          </button>
        </div>

        {/* Main Playback & Screen Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => triggerYoutube('play_pause')}
            className="min-h-16 px-6 py-4 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-bold text-xl border-2 border-teal-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
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
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-50 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
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
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-amber-300 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Mute Video (M)"
          >
            <span className="text-2xl" aria-hidden="true">
              🔇
            </span>
            <span>كتم الصوت (M)</span>
          </button>
        </div>

        {/* Seeking 10s */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => triggerYoutube('rewind')}
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-lg sm:text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
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
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-lg sm:text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Forward 10 Seconds (L)"
          >
            <span className="text-2xl" aria-hidden="true">
              ⏩
            </span>
            <span>تقديم 10 ثوانٍ (+10s / L)</span>
          </button>
        </div>

        {/* Speed, Captions & Next */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            type="button"
            onClick={() => triggerYoutube('speed_down')}
            className="min-h-14 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-sm sm:text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Slow Down Video"
          >
            <span className="text-lg" aria-hidden="true">
              🐢
            </span>
            <span>تبطيء (&lt;)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerYoutube('speed_up')}
            className="min-h-14 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-sm sm:text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Speed Up Video"
          >
            <span className="text-lg" aria-hidden="true">
              ⚡
            </span>
            <span>تسريع (&gt;)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerYoutube('captions')}
            className="min-h-14 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-sm sm:text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Toggle Subtitles / Captions (C)"
          >
            <span className="text-lg" aria-hidden="true">
              💬
            </span>
            <span>الترجمة (C)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerYoutube('next_video')}
            className="min-h-14 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-sm sm:text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Next Video (Shift+N)"
          >
            <span className="text-lg" aria-hidden="true">
              ⏭️
            </span>
            <span>التالي (Next)</span>
          </button>
        </div>

        {/* Volume Rows */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={() => triggerYoutube('volume_up')}
            className="min-h-14 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-base sm:text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="YouTube Volume Up"
          >
            <span className="text-xl" aria-hidden="true">
              🔊
            </span>
            <span>صوت يوتيوب (▲)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerYoutube('volume_down')}
            className="min-h-14 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-bold text-base sm:text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="YouTube Volume Down"
          >
            <span className="text-xl" aria-hidden="true">
              🔉
            </span>
            <span>صوت يوتيوب (▼)</span>
          </button>
        </div>

        {/* Master Windows Volume Controls */}
        <div className="pt-2 border-t border-zinc-800">
          <span className="text-xs sm:text-sm font-bold text-zinc-400 block mb-2">
            صوت النظام العام (Windows Master Volume):
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <button
              type="button"
              onClick={() => triggerMedia('volume_up')}
              className="min-h-14 px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-zinc-200 font-semibold text-sm border border-zinc-700 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              aria-label="Windows Volume Up"
            >
              <span>🔊</span>
              <span>رفع النظام</span>
            </button>
            <button
              type="button"
              onClick={() => triggerMedia('volume_down')}
              className="min-h-14 px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-zinc-200 font-semibold text-sm border border-zinc-700 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              aria-label="Windows Volume Down"
            >
              <span>🔉</span>
              <span>خفض النظام</span>
            </button>
            <button
              type="button"
              onClick={() => triggerMedia('mute')}
              className="min-h-14 px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-amber-300 font-semibold text-sm border border-zinc-700 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              aria-label="Mute Windows Audio"
            >
              <span>🔇</span>
              <span>كتم النظام</span>
            </button>
            <button
              type="button"
              onClick={() => triggerMedia('play_pause')}
              className="min-h-14 px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-teal-300 font-semibold text-sm border border-zinc-700 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              aria-label="Play/Pause System Media"
            >
              <span>⏯️</span>
              <span>تبديل الوسائط</span>
            </button>
          </div>
        </div>
      </section>

      {/* ============================================================== */}
      {/* SECTION 2: ⌨️ LIVE TYPING & CLIPBOARD SYNCHRONIZATION           */}
      {/* ============================================================== */}
      <section
        aria-label="Live Typing and Clipboard Controls"
        className="p-5 sm:p-6 rounded-2xl bg-zinc-900 border-2 border-zinc-700 flex flex-col gap-5"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden="true">
              ⌨️
            </span>
            <h3 className="text-xl sm:text-2xl font-bold text-zinc-50">
              2. الكتابة الحية ومزامنة الحافظة (Typing & Clipboard)
            </h3>
          </div>
          <span className="text-xs sm:text-sm font-semibold text-zinc-400">
            كتابة فورية للكمبيوتر ومزامنة الحافظة (UTF-8 عربي/إنجليزي)
          </span>
        </div>

        {/* Live Typing Input Component (Instant keystroke diffing, Backspace, Enter to search) */}
        <LiveTypingInput compact />

        {/* Clipboard Sync Sub-card */}
        <div className="p-4 sm:p-5 rounded-xl bg-zinc-950 border-2 border-zinc-800 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl" aria-hidden="true">
                📋
              </span>
              <h4 className="text-base sm:text-lg font-bold text-zinc-100">
                مزامنة الحافظة (Clipboard Sync)
              </h4>
            </div>
            <span className="text-xs text-zinc-400">دعم كامل للنصوص العربية والرموز</span>
          </div>

          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={clipboardText}
              onChange={(e) => setClipboardText(e.target.value)}
              placeholder="اكتب أو الصق نصاً هنا لنقله بين الهاتف والكمبيوتر..."
              className="w-full min-h-14 px-4 py-3 rounded-xl bg-zinc-900 border-2 border-zinc-700 text-zinc-100 placeholder-zinc-500 text-base font-medium focus:outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-500/20"
              aria-label="Clipboard text field"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleCopyFromPC}
              className="min-h-14 px-4 py-3 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-bold text-base border-2 border-teal-300 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
              aria-label="Copy clipboard text from PC to phone"
            >
              <span className="text-xl" aria-hidden="true">
                📥
              </span>
              <span>نسخ من الكمبيوتر</span>
            </button>

            <button
              type="button"
              onClick={handleSendToPC}
              disabled={!clipboardText.trim()}
              className="min-h-14 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 disabled:opacity-40 disabled:hover:bg-zinc-800 text-amber-300 font-bold text-base border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
              aria-label="Send text to PC clipboard"
            >
              <span className="text-xl" aria-hidden="true">
                📤
              </span>
              <span>إرسال لكليبورد الكمبيوتر</span>
            </button>
          </div>
        </div>
      </section>

      {/* ============================================================== */}
      {/* SECTION 3: ⚡ SYSTEM & POWER CONTROLS                          */}
      {/* ============================================================== */}
      <section
        aria-label="System Navigation and Power Controls"
        className="p-5 sm:p-6 rounded-2xl bg-zinc-900 border-2 border-zinc-700 flex flex-col gap-5"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl text-amber-400" aria-hidden="true">
              ⚡
            </span>
            <h3 className="text-xl sm:text-2xl font-bold text-zinc-50">
              3. النظام وإدارة الطاقة (System & Power)
            </h3>
          </div>
          <span className="text-xs sm:text-sm font-semibold text-zinc-400">
            أوامر الطاقة السريعة والتحكم في النوافذ والتطبيقات
          </span>
        </div>

        {/* POWER ACTIONS ROW (Lock & Sleep with Confirmation) */}
        <div className="p-4 rounded-xl bg-zinc-950 border-2 border-zinc-800 flex flex-col gap-3">
          <span className="text-sm font-bold text-zinc-300 block">
            أوامر الطاقة السريعة (Power Management):
          </span>

          {showSleepConfirm ? (
            <div className="p-4 rounded-xl bg-amber-950/90 border-2 border-amber-500 flex flex-col gap-3 animate-in fade-in">
              <div className="flex items-center gap-2 text-amber-200 font-bold text-base sm:text-lg">
                <span className="text-2xl" aria-hidden="true">
                  ⚠️
                </span>
                <span>هل تريد بالتأكيد وضع جهاز الكمبيوتر في وضع السكون (Sleep)؟</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleConfirmSleep}
                  className="min-h-14 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white font-bold text-base sm:text-lg border-2 border-amber-300 flex items-center justify-center gap-2 transition-colors"
                >
                  <span>تأكيد السكون 🌙</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSleepConfirm(false)}
                  className="min-h-14 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 font-bold text-base sm:text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 transition-colors"
                >
                  <span>إلغاء ✕</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleLockPC}
                className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-amber-300 font-bold text-lg sm:text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
                aria-label="Lock PC Workstation"
              >
                <span className="text-2xl" aria-hidden="true">
                  🔒
                </span>
                <span>قفل الشاشة (Lock PC)</span>
              </button>

              <button
                type="button"
                onClick={() => setShowSleepConfirm(true)}
                className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-lg sm:text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
                aria-label="Put PC to Sleep"
              >
                <span className="text-2xl" aria-hidden="true">
                  🌙
                </span>
                <span>وضع النوم (Sleep Mode)</span>
              </button>
            </div>
          )}
        </div>

        {/* Windows Switcher & Zoom Controls */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <button
            type="button"
            onClick={() => triggerSystemControl('switch_window')}
            className="min-h-14 sm:min-h-16 px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-600 active:bg-teal-800 text-white font-bold text-sm sm:text-base border-2 border-teal-300 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Switch Windows (Alt + Tab)"
          >
            <span className="text-lg sm:text-xl" aria-hidden="true">
              📑
            </span>
            <span>تبديل النوافذ</span>
          </button>

          <button
            type="button"
            onClick={() => triggerSystemControl('browser_back')}
            className="min-h-14 sm:min-h-16 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-sm sm:text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Browser Back"
          >
            <span className="text-lg sm:text-xl" aria-hidden="true">
              ⬅
            </span>
            <span>رجوع (Alt+←)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerSystemControl('browser_forward')}
            className="min-h-14 sm:min-h-16 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-sm sm:text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Browser Forward"
          >
            <span className="text-lg sm:text-xl" aria-hidden="true">
              ➡
            </span>
            <span>تقديم (Alt+→)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerSystemControl('zoom_in')}
            className="min-h-14 sm:min-h-16 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-sm sm:text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Zoom In (Ctrl +)"
          >
            <span className="text-lg sm:text-xl" aria-hidden="true">
              🔍+
            </span>
            <span>تكبير (Ctrl+)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerSystemControl('zoom_out')}
            className="min-h-14 sm:min-h-16 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-sm sm:text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Zoom Out (Ctrl -)"
          >
            <span className="text-lg sm:text-xl" aria-hidden="true">
              🔍-
            </span>
            <span>تصغير (Ctrl-)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerSystemControl('zoom_reset')}
            className="min-h-14 sm:min-h-16 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-sm sm:text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Reset Zoom (Ctrl 0)"
          >
            <span className="text-lg sm:text-xl" aria-hidden="true">
              🔄
            </span>
            <span>حجم 100%</span>
          </button>
        </div>

        {/* General Mouse Clicks & Scrolling */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            type="button"
            onClick={() => triggerClick('left')}
            className="min-h-14 px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-bold text-base border-2 border-teal-300 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Left Click"
          >
            <span className="text-xl" aria-hidden="true">
              👆
            </span>
            <span>كليك يسار</span>
          </button>

          <button
            type="button"
            onClick={() => triggerClick('right')}
            className="min-h-14 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Right Click"
          >
            <span className="text-xl" aria-hidden="true">
              👉
            </span>
            <span>كليك يمين</span>
          </button>

          <button
            type="button"
            onClick={() => triggerScroll('up')}
            className="min-h-14 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Scroll Up"
          >
            <span className="text-xl" aria-hidden="true">
              ▲
            </span>
            <span>تمرير لأعلى</span>
          </button>

          <button
            type="button"
            onClick={() => triggerScroll('down')}
            className="min-h-14 px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-base border-2 border-zinc-600 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors"
            aria-label="Scroll Down"
          >
            <span className="text-xl" aria-hidden="true">
              ▼
            </span>
            <span>تمرير لأسفل</span>
          </button>
        </div>

        {/* Quick Apps row */}
        <div className="pt-2 border-t border-zinc-800">
          <span className="text-xs sm:text-sm font-bold text-zinc-400 block mb-2">
            تشغيل التطبيقات السريعة (Quick Apps):
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => launchApp('calculator')}
              className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-semibold flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <span>🧮</span>
              <span>الحاسبة</span>
            </button>
            <button
              type="button"
              onClick={() => launchApp('notepad')}
              className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-semibold flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <span>📝</span>
              <span>المفكرة</span>
            </button>
            <button
              type="button"
              onClick={() => launchApp('chrome')}
              className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-semibold flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <span>🌐</span>
              <span>كروم</span>
            </button>
            <button
              type="button"
              onClick={() => launchApp('vscode')}
              className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 active:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-semibold flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <span>💻</span>
              <span>VSCode</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
