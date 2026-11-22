import { useState, useRef, useEffect } from 'react';
import { socket } from '../socket';

export default function TouchpadTab() {
  const [sensitivity, setSensitivity] = useState(1.8);
  const sensitivityRef = useRef(1.8);
  const [isInteracting, setIsInteracting] = useState(false);
  const [gestureFeedback, setGestureFeedback] = useState('');
  const [isBigCursor, setIsBigCursor] = useState(false);

  // rAF motion accumulator refs
  const pendingDeltaRef = useRef({ dx: 0, dy: 0 });
  const rafRef = useRef(null);

  // Continuous hold scroll refs
  const scrollIntervalRef = useRef(null);
  const scrollTimeoutRef = useRef(null);

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
    const handleBigCursorStatus = (data) => {
      if (typeof data?.enabled === 'boolean') {
        setIsBigCursor(data.enabled);
      }
    };
    socket.on('big_cursor_status', handleBigCursorStatus);

    return () => {
      socket.off('big_cursor_status', handleBigCursorStatus);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
    };
  }, []);

  const showFeedback = (text) => {
    setGestureFeedback(text);
    setTimeout(() => setGestureFeedback(''), 1200);
  };

  const triggerScroll = (dy) => {
    socket.emit('touchpad_scroll', { dy });
    showFeedback(dy < 0 ? '▲ تمرير لأعلى' : '▼ تمرير لأسفل');
  };

  // Continuous hold scroll support
  const startContinuousScroll = (dy) => {
    stopContinuousScroll();
    triggerScroll(dy);
    scrollTimeoutRef.current = setTimeout(() => {
      scrollIntervalRef.current = setInterval(() => {
        socket.emit('touchpad_scroll', { dy: dy * 0.75 });
      }, 70);
    }, 200);
  };

  const stopContinuousScroll = () => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    if (scrollIntervalRef.current) clearInterval(scrollIntervalRef.current);
    scrollTimeoutRef.current = null;
    scrollIntervalRef.current = null;
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
    socket.emit('touchpad_start');
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

      // Smooth step acceleration: stepDist > 12 gives 1.8x boost, otherwise 1.0x linear
      const stepDist = Math.hypot(rawDx, rawDy);
      const accel = stepDist > 12 ? 1.8 : 1.0;

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
    socket.emit('touchpad_start');
    isPointerDownRef.current = true;
    lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    setIsInteracting(true);
  };

  const handlePointerMove = (e) => {
    if (e.pointerType === 'touch' || !isPointerDownRef.current) return;
    const rawDx = e.clientX - lastPointerPosRef.current.x;
    const rawDy = e.clientY - lastPointerPosRef.current.y;

    const stepDist = Math.hypot(rawDx, rawDy);
    const accel = stepDist > 12 ? 1.8 : 1.0;

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

  return (
    <div
      className="h-[calc(100dvh-64px)] max-h-[calc(100dvh-64px)] overflow-hidden flex flex-col gap-2 w-full select-none"
      aria-label="Touchpad Mouse Controller"
    >
      {/* Information Header, Big Cursor & Sensitivity */}
      <div className="p-3 sm:p-4 rounded-xl bg-zinc-900 border-2 border-zinc-700 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden="true">
            🖱️
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-zinc-50">التاتش باد الذكي</h2>
          {gestureFeedback && (
            <span
              className="px-2.5 py-1 rounded-md bg-teal-950 border border-teal-400 text-teal-300 font-bold text-sm animate-in fade-in"
              role="status"
            >
              {gestureFeedback}
            </span>
          )}
        </div>

        {/* Controls bar: Big Cursor Toggle & Sensitivity */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Big Cursor Mode Toggle Button (WCAG AAA >= 56px) */}
          <button
            type="button"
            onClick={() => socket.emit('toggle_big_cursor', { enable: !isBigCursor })}
            className={`min-h-14 px-3 sm:px-4 py-2 rounded-xl font-bold text-sm sm:text-base border-2 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors ${
              isBigCursor
                ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-300'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-600'
            }`}
            aria-label="Toggle Big Mouse Cursor (96px)"
          >
            <span className="text-lg" aria-hidden="true">
              🔍
            </span>
            <span>{isBigCursor ? 'ماوس كبير: 96px' : 'ماوس كبير 🔍'}</span>
          </button>

          <div className="flex items-center gap-2 bg-zinc-950 px-3 py-2 rounded-xl border border-zinc-800 min-h-14">
            <label htmlFor="tp-sens" className="text-xs sm:text-sm font-bold text-zinc-300">
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
              className="w-16 sm:w-20 accent-teal-500 cursor-pointer"
            />
            <span className="font-mono text-teal-400 font-bold text-sm">
              {sensitivity.toFixed(1)}x
            </span>
          </div>
        </div>
      </div>

      {/* Main Touchpad Surface (Takes all remaining screen height flex-1, touch-action: none ONLY on this) */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: 'none' }}
        className={`flex-1 min-h-0 w-full rounded-2xl bg-zinc-900 border-2 transition-colors flex flex-col items-center justify-center p-4 relative cursor-crosshair select-none ${
          isInteracting ? 'border-teal-400 bg-zinc-900/95' : 'border-zinc-700'
        }`}
        role="region"
        aria-label="Touchpad surface"
      >
        <div className="flex flex-col items-center gap-2 text-center pointer-events-none select-none">
          <span className="text-4xl sm:text-5xl" aria-hidden="true">
            🖱️
          </span>
          <span className="text-xl sm:text-2xl font-bold text-zinc-100">
            {isInteracting ? 'جاري تحريك المؤشر...' : 'المس واسحب هنا للتحكم'}
          </span>
          <div className="inline-flex flex-wrap items-center justify-center gap-2 text-xs sm:text-sm text-zinc-300 pt-1">
            <span className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800">
              👆 لمسة = كليك يسار
            </span>
            <span className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800">
              ✌️ لمستين = دبل كليك
            </span>
            <span className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800">
              ↕️ سحب بإصبعين = سكرول
            </span>
          </div>
        </div>
      </div>

      {/* Pinned Bottom Controls (Fixed at bottom with touch-action: manipulation to prevent click lockup) */}
      <div
        className="flex flex-col gap-2 shrink-0 w-full pb-1"
        style={{ touchAction: 'manipulation' }}
      >
        {/* Scroll Buttons Row (Continuous Hold Supported) */}
        <section
          aria-label="Continuous Scroll Buttons"
          className="grid grid-cols-2 gap-2 sm:gap-3"
          style={{ touchAction: 'manipulation' }}
        >
          <button
            type="button"
            onPointerDown={() => startContinuousScroll(-70)}
            onPointerUp={stopContinuousScroll}
            onPointerLeave={stopContinuousScroll}
            onPointerCancel={stopContinuousScroll}
            style={{ touchAction: 'manipulation' }}
            className="min-h-14 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-base sm:text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors select-none"
            aria-label="Scroll Up (Hold for continuous)"
          >
            <span className="text-xl" aria-hidden="true">
              ▲
            </span>
            <span>تمرير لأعلى (اضغط واستمر)</span>
          </button>

          <button
            type="button"
            onPointerDown={() => startContinuousScroll(70)}
            onPointerUp={stopContinuousScroll}
            onPointerLeave={stopContinuousScroll}
            onPointerCancel={stopContinuousScroll}
            style={{ touchAction: 'manipulation' }}
            className="min-h-14 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-base sm:text-lg border-2 border-zinc-600 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors select-none"
            aria-label="Scroll Down (Hold for continuous)"
          >
            <span className="text-xl" aria-hidden="true">
              ▼
            </span>
            <span>تمرير لأسفل (اضغط واستمر)</span>
          </button>
        </section>

        {/* Large Click Buttons Row (WCAG AAA >= 56px) */}
        <section
          aria-label="Mouse Click Action Buttons"
          className="grid grid-cols-3 gap-2 sm:gap-3"
          style={{ touchAction: 'manipulation' }}
        >
          <button
            type="button"
            onClick={() => triggerClick('left')}
            style={{ touchAction: 'manipulation' }}
            className="min-h-14 sm:min-h-16 px-3 sm:px-4 py-3 rounded-xl bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-bold text-base sm:text-xl border-2 border-teal-300 flex items-center justify-center gap-1.5 sm:gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Left Click"
          >
            <span className="text-xl sm:text-2xl" aria-hidden="true">
              👆
            </span>
            <span>كليك يسار</span>
          </button>

          <button
            type="button"
            onClick={triggerDoubleClick}
            style={{ touchAction: 'manipulation' }}
            className="min-h-14 sm:min-h-16 px-3 sm:px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-base sm:text-xl border-2 border-zinc-600 flex items-center justify-center gap-1.5 sm:gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Double Click"
          >
            <span className="text-xl sm:text-2xl" aria-hidden="true">
              ✌️
            </span>
            <span>دبل كليك</span>
          </button>

          <button
            type="button"
            onClick={() => triggerClick('right')}
            style={{ touchAction: 'manipulation' }}
            className="min-h-14 sm:min-h-16 px-3 sm:px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 font-bold text-base sm:text-xl border-2 border-zinc-600 flex items-center justify-center gap-1.5 sm:gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors"
            aria-label="Right Click"
          >
            <span className="text-xl sm:text-2xl" aria-hidden="true">
              👉
            </span>
            <span>كليك يمين</span>
          </button>
        </section>
      </div>
    </div>
  );
}
