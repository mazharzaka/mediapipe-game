import { useState, useRef, useEffect, useCallback } from 'react';
import { socket } from '../socket';

export default function TouchpadController() {
  // Base sensitivity: Default 2.5
  const [sensitivity, setSensitivity] = useState(2.5);
  const sensitivityRef = useRef(2.5);

  const [textInput, setTextInput] = useState('');
  const [actionFeedback, setActionFeedback] = useState(null);
  const feedbackTimeoutRef = useRef(null);

  // Touch tracking refs
  const lastTouchPosRef = useRef({ x: 0, y: 0 });
  const lastTwoFingerYRef = useRef(null);
  const touchStartTimeRef = useRef(0);
  const hasMovedRef = useRef(false);
  const totalDistanceRef = useRef(0);
  const lastEmitTimeRef = useRef(0);

  // Touchpad visual touch active state
  const [isTouching, setIsTouching] = useState(false);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  const showFeedback = (msg) => {
    setActionFeedback(msg);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => {
      setActionFeedback(null);
    }, 2000);
  };

  // --- Touchpad Gesture Handlers ---
  const handleTouchStart = (e) => {
    setIsTouching(true);
    touchStartTimeRef.current = performance.now();
    hasMovedRef.current = false;
    totalDistanceRef.current = 0;

    // Notify backend to sync cached mouse position from OS immediately
    socket.emit('touch_start');

    if (e.touches.length === 1) {
      lastTouchPosRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      lastTwoFingerYRef.current = null;
    } else if (e.touches.length === 2) {
      lastTwoFingerYRef.current =
        (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  };

  const handleTouchMove = (e) => {
    const now = performance.now();

    // 1-Finger Drag: Relative Mouse Movement with Dynamic Acceleration
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rawDx = touch.clientX - lastTouchPosRef.current.x;
      const rawDy = touch.clientY - lastTouchPosRef.current.y;
      const stepDist = Math.hypot(rawDx, rawDy);

      totalDistanceRef.current += stepDist;
      if (totalDistanceRef.current > 6) {
        hasMovedRef.current = true;
      }

      lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };

      // Throttle mouse movement to ~16ms (60 FPS)
      if (now - lastEmitTimeRef.current >= 16) {
        lastEmitTimeRef.current = now;
        const sens = sensitivityRef.current;

        // Dynamic Acceleration: Fast flick (> 12px) gets an additional 1.8x multiplier
        const accel = stepDist > 12 ? 1.8 : 1.0;
        const dx = rawDx * sens * accel;
        const dy = rawDy * sens * accel;

        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          socket.emit('mouse_move_relative', {
            dx: Math.round(dx),
            dy: Math.round(dy),
          });
        }
      }
    }
    // 2-Finger Drag: Scroll
    else if (e.touches.length === 2) {
      hasMovedRef.current = true;
      const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      if (lastTwoFingerYRef.current !== null) {
        const deltaY = avgY - lastTwoFingerYRef.current;

        // Threshold for scrolling
        if (Math.abs(deltaY) > 6 && now - lastEmitTimeRef.current >= 60) {
          lastEmitTimeRef.current = now;
          lastTwoFingerYRef.current = avgY;
          // When fingers swipe UP (deltaY < 0), scroll UP
          const direction = deltaY < 0 ? 'up' : 'down';
          socket.emit('mouse_scroll', { direction, amount: 150 });
        }
      } else {
        lastTwoFingerYRef.current = avgY;
      }
    }
  };

  const handleTouchEnd = (e) => {
    setIsTouching(false);
    const elapsed = performance.now() - touchStartTimeRef.current;

    // Tap Detection: finger lifted within 200ms with negligible movement (< 8px)
    if (elapsed < 200 && !hasMovedRef.current && totalDistanceRef.current < 8) {
      socket.emit('mouse_click', { button: 'left' });
      showFeedback('👆 نقرة سريعة (Tap)');
    }

    lastTwoFingerYRef.current = null;
  };

  const handleTouchCancel = () => {
    setIsTouching(false);
    lastTwoFingerYRef.current = null;
  };

  // Click Helpers
  const triggerClick = (button) => {
    socket.emit('mouse_click', { button });
    showFeedback(button === 'left' ? '🖱️ كليك يسار' : '🖱️ كليك يمين');
  };

  // Keyboard Helpers
  const handleSendText = (e) => {
    e?.preventDefault();
    if (!textInput.trim()) return;
    socket.emit('type_text', { text: textInput });
    showFeedback(`تم إرسال: "${textInput}"`);
    setTextInput('');
  };

  const handleEnterKey = () => {
    socket.emit('key_enter');
    showFeedback('↵ مفتاح Enter');
  };

  const handleBackspaceKey = () => {
    socket.emit('key_backspace');
    showFeedback('⌫ مفتاح Backspace');
  };

  return (
    <section
      className="flex flex-col gap-6 w-full"
      aria-label="Touchpad Mouse and Keyboard Controller"
    >
      {/* Action Notification Banner */}
      {actionFeedback && (
        <div
          role="status"
          aria-live="polite"
          className="p-4 rounded-xl bg-teal-600 border-2 border-teal-300 text-white font-bold text-lg flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-xl">
              ✓
            </span>
            <span>{actionFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            className="px-3 py-1 bg-teal-800 rounded-md text-sm text-white"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Main Touchpad Box */}
          <div className="p-6 rounded-2xl bg-zinc-900 border-2 border-zinc-700 flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-700 pb-3">
              <div>
                <h2 className="text-2xl font-bold text-zinc-50 flex items-center gap-2">
                  <span aria-hidden="true">🖱️</span>
                  <span>مساحة اللمس / Touchpad Area</span>
                </h2>
                <p className="text-sm text-zinc-300 mt-1">
                  سحب بإصبع واحد للتحريك (مع تسارع ذكي)، نقرة سريعة (Tap) للكليك، وإصبعان للتمرير.
                </p>
              </div>

                  {/* Sensitivity Setting Indicator */}
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <span className="text-sm text-zinc-300 font-semibold">
                      الحساسية:
                    </span>
                    <span className="font-mono text-base font-bold text-teal-400 px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800">
                      {sensitivity.toFixed(2)}x
                    </span>
                  </div>
              </div>

              {/* Large Touchpad Surface with touch-action: none */}
              <div
                tabIndex={0}
                role="region"
                aria-label="Virtual Touchpad Surface. Drag one finger to move cursor, tap to click, drag two fingers to scroll."
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
                style={{ touchAction: 'none' }}
                className={`w-full h-80 sm:h-96 rounded-2xl border-4 transition-colors duration-150 flex flex-col items-center justify-center p-6 select-none cursor-crosshair focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${isTouching
                    ? 'bg-zinc-900 border-teal-500 shadow-none'
                    : 'bg-zinc-950 border-zinc-700'
                  }`}
              >
                <div className="text-center pointer-events-none space-y-2">
                  <span className="text-5xl sm:text-6xl" aria-hidden="true">
                    {isTouching ? '👆' : '🖐️'}
                  </span>
                  <p className="text-xl sm:text-2xl font-extrabold text-zinc-200">
                    {isTouching ? 'جاري التحريك والتتبع...' : 'المس واسحب هنا للتحكم بالماوس'}
                  </p>
                  <p className="text-sm text-zinc-400">
                    Touch & Drag here • 2 Fingers to Scroll • Quick Tap to Left Click
                  </p>
                </div>
              </div>

                {/* Touchpad Speed Slider & Step Controls */}
                <div className="flex flex-col gap-3 p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="touchpad-sensitivity-slider"
                      className="text-base font-bold text-zinc-200"
                    >
                      سرعة التاتش باد / Touchpad Speed Slider:
                    </label>
                    <span className="font-mono text-lg font-bold text-teal-400">
                      {sensitivity.toFixed(2)}x (+1.8x عند السحب السريع)
                    </span>
                  </div>

                  <input
                    id="touchpad-sensitivity-slider"
                    type="range"
                    min="1.0"
                    max="5.0"
                    step="0.25"
                    value={sensitivity}
                    onChange={(e) => setSensitivity(parseFloat(e.target.value))}
                    className="w-full h-3 bg-zinc-900 border border-zinc-700 rounded-lg cursor-pointer accent-teal-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                    aria-label="Touchpad sensitivity slider"
                  />

                  <div className="flex items-center justify-between gap-4 pt-1">
                    <button
                      type="button"
                      onClick={() => setSensitivity((s) => Math.max(1.0, Math.round((s - 0.25) * 100) / 100))}
                      disabled={sensitivity <= 1.0}
                      className="min-h-12 px-4 rounded-lg bg-zinc-900 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 text-zinc-200 font-bold text-base flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                    >
                      <span>−</span>
                      <span>تقليل السرعة</span>
                    </button>

                    <span className="text-xs font-mono text-zinc-400 text-center">
                      1.0x (دقيق) ← 2.5x (افتراضي) → 5.0x (فائق السرعة)
                    </span>

                    <button
                      type="button"
                      onClick={() => setSensitivity((s) => Math.min(5.0, Math.round((s + 0.25) * 100) / 100))}
                      disabled={sensitivity >= 5.0}
                      className="min-h-12 px-4 rounded-lg bg-zinc-900 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 text-zinc-200 font-bold text-base flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                    >
                      <span>+</span>
                      <span>زيادة السرعة</span>
                    </button>
                  </div>
                </div>

                {/* Two Large Helper Click Buttons Below Touchpad (Left & Right Click) */}
                  <div className="grid grid-cols-2 gap-4 pt-1">
                    <button
                      type="button"
                      onClick={() => triggerClick('left')}
                      className="min-h-16 px-6 py-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-extrabold text-xl border-2 border-teal-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
                      aria-label="Left Mouse Click"
                    >
                      <span className="text-2xl" aria-hidden="true">
                        🖱️
                      </span>
                      <span>كليك يسار / Left Click</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => triggerClick('right')}
                      className="min-h-16 px-6 py-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xl border-2 border-blue-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
                      aria-label="Right Mouse Click"
                    >
                      <span className="text-2xl" aria-hidden="true">
                        🖱️
                      </span>
                      <span>كليك يمين / Right Click</span>
                    </button>
                  </div>
                </div>

                {/* Quick Remote Typing & Keyboard Section */}
                <div className="p-6 rounded-2xl bg-zinc-900 border-2 border-zinc-700 flex flex-col gap-4">
                  <div className="border-b border-zinc-700 pb-2">
                    <h2 className="text-2xl font-bold text-zinc-50 flex items-center gap-2">
                      <span aria-hidden="true">⌨️</span>
                      <span>كيبورد سريع للكتابة / Remote Keyboard</span>
                    </h2>
                    <p className="text-base text-zinc-300 mt-1">
                      اكتب أي نص هنا وأرسله مباشرة للكمبيوتر ليتم كتابته في المكان المحدد.
                    </p>
                  </div>

                  <form onSubmit={handleSendText} className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="text"
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      placeholder="اكتب النص هنا (مثلاً: كلمة بحث، رابط، أو جملة)..."
                      className="flex-1 min-h-16 px-4 rounded-xl bg-zinc-950 border-2 border-zinc-700 text-xl font-bold text-zinc-50 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                    />

                    <button
                      type="submit"
                      disabled={!textInput.trim()}
                      className="min-h-16 px-6 py-4 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xl border-2 border-teal-300 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 transition-colors duration-150"
                    >
                      <span className="text-2xl" aria-hidden="true">
                        📤
                      </span>
                      <span>إرسال للكمبيوتر</span>
                    </button>
                  </form>

                  {/* Keyboard Helper Keys (Enter, Space, Backspace) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleEnterKey}
                      className="min-h-14 px-4 py-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-zinc-100 font-bold text-lg border-2 border-zinc-700 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                    >
                      <span className="text-xl" aria-hidden="true">
                        ↵
                      </span>
                      <span>مفتاح Enter (إدخال)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => socket.emit('type_text', { text: ' ' })}
                      className="min-h-14 px-4 py-3 rounded-xl bg-zinc-950 hover:bg-zinc-800 text-zinc-100 font-bold text-lg border-2 border-zinc-700 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                    >
                      <span className="text-xl" aria-hidden="true">
                        ␣
                      </span>
                      <span>مسافة (Space)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleBackspaceKey}
                      className="min-h-14 px-4 py-3 rounded-xl bg-zinc-950 hover:bg-red-900/40 text-red-300 hover:text-white font-bold text-lg border-2 border-zinc-700 hover:border-red-500 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
                    >
                      <span className="text-xl" aria-hidden="true">
                        ⌫
                      </span>
                      <span>مسح (Backspace)</span>
                    </button>
                  </div>
                </div>
              </section>
              );
}
