import { useState, useRef, useEffect } from 'react';
import { socket } from '../socket';

export default function TouchpadTab() {
  const [sensitivity, setSensitivity] = useState(1.8);
  const sensitivityRef = useRef(1.8);
  const [isInteracting, setIsInteracting] = useState(false);
  const [gestureFeedback, setGestureFeedback] = useState('');

  // rAF motion accumulator refs
  const pendingDeltaRef = useRef({ dx: 0, dy: 0 });
  const rafRef = useRef(null);

  // Single & Double Tap tracking refs
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const lastTouchRef = useRef({ x: 0, y: 0 });
  const hasMovedRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const singleTapTimerRef = useRef(null);

  // Two-finger scroll tracking refs
  const lastTwoFingerYRef = useRef(0);
  const isTwoFingerRef = useRef(false);

  // Desktop mouse fallback refs
  const isPointerDownRef = useRef(false);
  const lastPointerPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    };
  }, []);

  const showFeedback = (text) => {
    setGestureFeedback(text);
    setTimeout(() => setGestureFeedback(''), 1200);
  };

  // Flush accumulated deltas synced with screen refresh (rAF)
  const scheduleFlush = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const { dx, dy } = pendingDeltaRef.current;
      if (dx !== 0 || dy !== 0) {
        socket.emit('touchpad_move', { dx, dy });
        pendingDeltaRef.current = { dx: 0, dy: 0 };
      }
    });
  };

  // --- TOUCH EVENTS (Mobile & Touchscreens with 1-finger / 2-finger gestures) ---
  const handleTouchStart = (e) => {
    setIsInteracting(true);
    const touches = e.touches;

    if (touches.length === 1) {
      isTwoFingerRef.current = false;
      const t = touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
      lastTouchRef.current = { x: t.clientX, y: t.clientY };
      hasMovedRef.current = false;
    } else if (touches.length === 2) {
      isTwoFingerRef.current = true;
      hasMovedRef.current = true;
      // Midpoint Y for two-finger scrolling
      lastTwoFingerYRef.current = (touches[0].clientY + touches[1].clientY) / 2;
    }
  };

  const handleTouchMove = (e) => {
    const touches = e.touches;

    if (touches.length === 1 && !isTwoFingerRef.current) {
      const t = touches[0];
      const rawDx = t.clientX - lastTouchRef.current.x;
      const rawDy = t.clientY - lastTouchRef.current.y;

      const distFromStart = Math.hypot(
        t.clientX - touchStartRef.current.x,
        t.clientY - touchStartRef.current.y
      );
      if (distFromStart > 6) {
        hasMovedRef.current = true;
      }

      // Acceleration curve: smooth for precision, accelerated for fast strokes
      const dist = Math.hypot(rawDx, rawDy);
      const accel = 1 + Math.min(dist / 10, 2.8);

      pendingDeltaRef.current.dx += rawDx * sensitivityRef.current * accel;
      pendingDeltaRef.current.dy += rawDy * sensitivityRef.current * accel;

      scheduleFlush();
      lastTouchRef.current = { x: t.clientX, y: t.clientY };
    } else if (touches.length === 2) {
      isTwoFingerRef.current = true;
      hasMovedRef.current = true;
      const midY = (touches[0].clientY + touches[1].clientY) / 2;
      const dy = (lastTwoFingerYRef.current - midY) * 2.2; // Natural 2-finger scroll

      if (Math.abs(dy) > 1.5) {
        socket.emit('touchpad_scroll', { dy });
        lastTwoFingerYRef.current = midY;
        showFeedback('↕️ تمرير بإصبعين (Scroll)');
      }
    }
  };

  const handleTouchEnd = (e) => {
    if (e.touches.length === 0) {
      setIsInteracting(false);

      // Evaluate Tap Gestures (only if didn't drag and duration was brief)
      const duration = Date.now() - touchStartRef.current.time;
      if (!hasMovedRef.current && !isTwoFingerRef.current && duration < 280) {
        const now = Date.now();
        if (now - lastTapTimeRef.current < 300) {
          // Double Tap!
          if (singleTapTimerRef.current) {
            clearTimeout(singleTapTimerRef.current);
            singleTapTimerRef.current = null;
          }
          lastTapTimeRef.current = 0;
          socket.emit('mouse_double_click');
          showFeedback('✌️ نقرة مزدوجة (Double Tap)');
        } else {
          // Single Tap candidate (wait briefly to see if second tap follows)
          lastTapTimeRef.current = now;
          singleTapTimerRef.current = setTimeout(() => {
            socket.emit('touchpad_click', { button: 'left' });
            showFeedback('👆 نقرة يسار (Single Tap)');
          }, 240);
        }
      }

      isTwoFingerRef.current = false;
    }
  };

  // --- DESKTOP POINTER FALLBACK (For testing with mouse on PC) ---
  const handlePointerDown = (e) => {
    if (e.pointerType === 'touch') return; // Handled by Touch events
    e.currentTarget.setPointerCapture(e.pointerId);
    isPointerDownRef.current = true;
    lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    setIsInteracting(true);
  };

  const handlePointerMove = (e) => {
    if (e.pointerType === 'touch' || !isPointerDownRef.current) return;
    const rawDx = e.clientX - lastPointerPosRef.current.x;
    const rawDy = e.clientY - lastPointerPosRef.current.y;

    const dist = Math.hypot(rawDx, rawDy);
    const accel = 1 + Math.min(dist / 10, 2.5);

    pendingDeltaRef.current.dx += rawDx * sensitivityRef.current * accel;
    pendingDeltaRef.current.dy += rawDy * sensitivityRef.current * accel;

    scheduleFlush();
    lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e) => {
    if (e.pointerType === 'touch') return;
    isPointerDownRef.current = false;
    setIsInteracting(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const triggerClick = (button) => {
    socket.emit('touchpad_click', { button });
    showFeedback(button === 'left' ? '👆 كليك يسار' : '👉 كليك يمين');
  };

  const triggerDoubleClick = () => {
    socket.emit('mouse_double_click');
    showFeedback('✌️ دبل كليك');
  };

  const triggerScroll = (dy) => {
    socket.emit('touchpad_scroll', { dy });
    showFeedback(dy < 0 ? '▲ تمرير لأعلى' : '▼ تمرير لأسفل');
  };

  return (
    <div className="flex flex-col gap-6 w-full" aria-label="Touchpad Mouse Controller">
      {/* Information Header & Sensitivity */}
      <div className="p-6 rounded-xl bg-zinc-900 border-2 border-zinc-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-50">
            🖱️ التاتش باد الذكي (Touchpad Controller)
          </h2>
          <p className="text-base text-zinc-300 mt-1">
            دعم كامل للشاشات المتعددة (Multi-Monitor)، تسارع فائق النعومة، وإيماءات اللمس السريعة.
          </p>
        </div>

        {/* Gesture feedback badge / Sensitivity */}
        <div className="flex items-center gap-4">
          {gestureFeedback && (
            <span
              className="px-3 py-1.5 rounded-lg bg-teal-950 border border-teal-400 text-teal-300 font-bold text-base animate-in fade-in"
              role="status"
            >
              {gestureFeedback}
            </span>
          )}

          <div className="flex items-center gap-3 bg-zinc-950 px-4 py-2 rounded-lg border border-zinc-800">
            <label htmlFor="tp-sens" className="text-sm font-bold text-zinc-300">
              الحساسية:
            </label>
            <input
              id="tp-sens"
              type="range"
              min="0.5"
              max="4.0"
              step="0.5"
              value={sensitivity}
              onChange={(e) => setSensitivity(parseFloat(e.target.value))}
              className="w-24 accent-teal-500 cursor-pointer"
            />
            <span className="font-mono text-teal-400 font-bold text-base">
              {sensitivity.toFixed(1)}x
            </span>
          </div>
        </div>
      </div>

      {/* Main Touchpad Grid: Track Surface + Scroll Controls */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
        {/* Trackpad Active Surface */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`md:col-span-10 min-h-[360px] sm:min-h-[420px] rounded-2xl bg-zinc-900 border-2 transition-colors flex flex-col items-center justify-center p-6 select-none touch-none cursor-crosshair relative ${
            isInteracting ? 'border-teal-400 bg-zinc-900/95' : 'border-zinc-700'
          }`}
          role="region"
          aria-label="Touchpad surface"
        >
          <div className="flex flex-col items-center gap-3 text-center pointer-events-none select-none">
            <span className="text-5xl" aria-hidden="true">
              🖱️
            </span>
            <span className="text-2xl font-bold text-zinc-100">
              {isInteracting ? 'جاري تحريك المؤشر...' : 'المس واسحب هنا للتحكم في الماوس'}
            </span>
            <div className="inline-flex flex-wrap items-center justify-center gap-2 text-sm text-zinc-300 pt-1">
              <span className="px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800">
                👆 لمسة = كليك يسار
              </span>
              <span className="px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800">
                ✌️ لمستين = دبل كليك
              </span>
              <span className="px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800">
                ↕️ سحب بإصبعين = سكرول
              </span>
            </div>
          </div>
        </div>

        {/* Vertical Scroll Strip */}
        <div className="md:col-span-2 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => triggerScroll(-70)}
            className="flex-1 min-h-20 rounded-xl bg-zinc-900 hover:bg-zinc-800 border-2 border-zinc-700 hover:border-zinc-500 text-zinc-100 font-bold text-xl flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Scroll Up"
          >
            <span className="text-3xl" aria-hidden="true">
              ▲
            </span>
            <span className="text-sm">تمرير لأعلى</span>
          </button>

          <button
            type="button"
            onClick={() => triggerScroll(70)}
            className="flex-1 min-h-20 rounded-xl bg-zinc-900 hover:bg-zinc-800 border-2 border-zinc-700 hover:border-zinc-500 text-zinc-100 font-bold text-xl flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Scroll Down"
          >
            <span className="text-3xl" aria-hidden="true">
              ▼
            </span>
            <span className="text-sm">تمرير لأسفل</span>
          </button>
        </div>
      </div>

      {/* Large Accessible Bottom Click Buttons (WCAG AAA >= 56px) */}
      <section aria-label="Mouse Click Action Buttons">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            type="button"
            onClick={() => triggerClick('left')}
            className="min-h-16 px-6 py-4 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xl border-2 border-teal-300 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
            aria-label="Left Click"
          >
            <span className="text-2xl" aria-hidden="true">
              👆
            </span>
            <span>كليك يسار (Left Click)</span>
          </button>

          <button
            type="button"
            onClick={triggerDoubleClick}
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
            aria-label="Double Click"
          >
            <span className="text-2xl" aria-hidden="true">
              ✌️
            </span>
            <span>دبل كليك (Double Click)</span>
          </button>

          <button
            type="button"
            onClick={() => triggerClick('right')}
            className="min-h-16 px-6 py-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold text-xl border-2 border-zinc-600 flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
            aria-label="Right Click"
          >
            <span className="text-2xl" aria-hidden="true">
              👉
            </span>
            <span>كليك يمين (Right Click)</span>
          </button>
        </div>
      </section>
    </div>
  );
}
