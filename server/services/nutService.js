import { mouse, Point, keyboard, Key } from '@nut-tree/nut-js';

// Optimize responsiveness for real-time tracking
mouse.config.autoDelayMs = 0;

// Track cursor coordinates purely in software to avoid native getPosition bugs on Windows multi-monitor setups
let cachedPos = { x: 960, y: 540 };

// Delta coalescing queue to prevent async pile-up and cursor freeze
let isMoving = false;
let pendingDelta = { dx: 0, dy: 0 };

/**
 * Absolute movement mapped to normalized coordinates (0 to 1) for Face Tracking
 */
export async function moveToNormalized(normX, normY) {
  try {
    if (typeof normX !== 'number' || typeof normY !== 'number') return;
    const clampedX = Math.max(0, Math.min(1, normX));
    const clampedY = Math.max(0, Math.min(1, normY));
    const targetX = Math.round(clampedX * 1920);
    const targetY = Math.round(clampedY * 1080);
    cachedPos = { x: targetX, y: targetY };
    await mouse.setPosition(new Point(targetX, targetY));
    return cachedPos;
  } catch (err) {
    console.error('[nutService] moveToNormalized error:', err.message);
  }
}

/**
 * Relative movement with UNBOUNDED coordinates for Multi-Monitor support.
 * Uses Delta Coalescing so rapid events don't stack up async calls.
 * Does NOT clamp to 0 or screen width/height, allowing cursor to traverse freely to
 * secondary monitors on the left (negative coordinates) or right/above/below.
 */
export async function moveDelta(dx, dy) {
  try {
    if (typeof dx !== 'number' || typeof dy !== 'number' || isNaN(dx) || isNaN(dy)) return;

    // Accumulate into pending queue
    pendingDelta.dx += dx;
    pendingDelta.dy += dy;

    // If an async move is already in-flight, return and let the loop handle accumulated deltas
    if (isMoving) return cachedPos;
    isMoving = true;

    while (pendingDelta.dx !== 0 || pendingDelta.dy !== 0) {
      const curDx = pendingDelta.dx;
      const curDy = pendingDelta.dy;
      pendingDelta.dx = 0;
      pendingDelta.dy = 0;

      cachedPos.x += curDx;
      cachedPos.y += curDy;

      // Safety guard against NaN or non-finite numbers
      if (!Number.isFinite(cachedPos.x) || !Number.isFinite(cachedPos.y)) {
        cachedPos = { x: 960, y: 540 };
      }

      const targetX = Math.round(cachedPos.x);
      const targetY = Math.round(cachedPos.y);

      await mouse.setPosition(new Point(targetX, targetY));
    }

    isMoving = false;
    return cachedPos;
  } catch (err) {
    isMoving = false;
    console.error('[nutService] moveDelta error:', err.message);
  }
}

/**
 * Sync software cursor position safely on touch start without clamping or freezing
 */
export async function syncTouchpadStart() {
  try {
    pendingDelta = { dx: 0, dy: 0 };
    const pos = await mouse.getPosition();
    if (
      pos &&
      Number.isFinite(pos.x) &&
      Number.isFinite(pos.y) &&
      Math.abs(pos.x) < 30000 &&
      Math.abs(pos.y) < 30000
    ) {
      cachedPos = { x: pos.x, y: pos.y };
    }
  } catch {
    // Keep cachedPos fallback
  }
  return cachedPos;
}

export async function leftClick() {
  try {
    await mouse.leftClick();
    return { success: true, action: 'left_click' };
  } catch (err) {
    console.error('[nutService] leftClick error:', err.message);
  }
}

export async function rightClick() {
  try {
    await mouse.rightClick();
    return { success: true, action: 'right_click' };
  } catch (err) {
    console.error('[nutService] rightClick error:', err.message);
  }
}

export async function doubleClick() {
  try {
    await mouse.leftClick();
    await mouse.leftClick();
    return { success: true, action: 'double_click' };
  } catch (err) {
    console.error('[nutService] doubleClick error:', err.message);
  }
}

export async function scroll(direction, steps = 2) {
  try {
    // Boosted 2.5x to 3x for snappy, comfortable video scrolling
    const s = Math.min(Math.max(2, Math.round(steps * 2.8)), 50);
    if (direction === 'up') {
      await mouse.scrollUp(s);
    } else if (direction === 'down') {
      await mouse.scrollDown(s);
    }
    return { success: true, direction, steps: s };
  } catch (err) {
    console.error('[nutService] scroll error:', err.message);
  }
}

export async function scrollDelta(dy) {
  try {
    if (typeof dy !== 'number') return;
    // Boosted 2.5x to 3x for smooth, responsive scrolling through feeds
    const steps = Math.min(25, Math.max(3, Math.round((Math.abs(dy) / 10) * 2.8)));
    if (dy < 0) {
      await mouse.scrollUp(steps);
    } else if (dy > 0) {
      await mouse.scrollDown(steps);
    }
    return { success: true, steps };
  } catch (err) {
    console.error('[nutService] scrollDelta error:', err.message);
  }
}

export async function mediaControl(action) {
  try {
    switch (action) {
      case 'volume_up':
        await keyboard.pressKey(Key.AudioVolUp);
        await keyboard.releaseKey(Key.AudioVolUp);
        return { success: true, action, message: 'تم رفع الصوت' };
      case 'volume_down':
        await keyboard.pressKey(Key.AudioVolDown);
        await keyboard.releaseKey(Key.AudioVolDown);
        return { success: true, action, message: 'تم خفض الصوت' };
      case 'mute':
        await keyboard.pressKey(Key.AudioMute);
        await keyboard.releaseKey(Key.AudioMute);
        return { success: true, action, message: 'تم كتم/إلغاء كتم الصوت' };
      case 'play_pause':
        await keyboard.pressKey(Key.AudioPlay);
        await keyboard.releaseKey(Key.AudioPlay);
        return { success: true, action, message: 'تم تبديل التشغيل/الإيقاف المؤقت' };
      case 'next':
        await keyboard.pressKey(Key.AudioNext);
        await keyboard.releaseKey(Key.AudioNext);
        return { success: true, action, message: 'تم الانتقال للتراك التالي' };
      case 'previous':
        await keyboard.pressKey(Key.AudioPrev);
        await keyboard.releaseKey(Key.AudioPrev);
        return { success: true, action, message: 'تم الانتقال للتراك السابق' };
      default:
        throw new Error(`إجراء وسائط غير معروف: ${action}`);
    }
  } catch (err) {
    console.error('[nutService] mediaControl error:', err.message);
    throw err;
  }
}

/**
 * Dedicated YouTube keyboard shortcuts
 */
export async function youtubeControl(action) {
  try {
    switch (action) {
      case 'play_pause':
        await keyboard.pressKey(Key.K);
        await keyboard.releaseKey(Key.K);
        return { success: true, action, message: 'تشغيل / إيقاف مؤقت (K)' };

      case 'forward':
        await keyboard.pressKey(Key.L);
        await keyboard.releaseKey(Key.L);
        return { success: true, action, message: 'تقديم 10 ثوانٍ (L)' };

      case 'rewind':
        await keyboard.pressKey(Key.J);
        await keyboard.releaseKey(Key.J);
        return { success: true, action, message: 'تأخير 10 ثوانٍ (J)' };

      case 'speed_up':
        await keyboard.pressKey(Key.LeftShift);
        await keyboard.pressKey(Key.Period);
        await keyboard.releaseKey(Key.Period);
        await keyboard.releaseKey(Key.LeftShift);
        return { success: true, action, message: 'تسريع الفيديو (>)' };

      case 'speed_down':
        await keyboard.pressKey(Key.LeftShift);
        await keyboard.pressKey(Key.Comma);
        await keyboard.releaseKey(Key.Comma);
        await keyboard.releaseKey(Key.LeftShift);
        return { success: true, action, message: 'تبطيء الفيديو (<)' };

      case 'fullscreen':
        await keyboard.pressKey(Key.F);
        await keyboard.releaseKey(Key.F);
        return { success: true, action, message: 'ملء الشاشة (F)' };

      case 'mute':
        await keyboard.pressKey(Key.M);
        await keyboard.releaseKey(Key.M);
        return { success: true, action, message: 'كتم / إلغاء كتم الصوت (M)' };

      case 'captions':
        await keyboard.pressKey(Key.C);
        await keyboard.releaseKey(Key.C);
        return { success: true, action, message: 'الترجمة والتسميات التوضيحية (C)' };

      case 'next_video':
        await keyboard.pressKey(Key.LeftShift);
        await keyboard.pressKey(Key.N);
        await keyboard.releaseKey(Key.N);
        await keyboard.releaseKey(Key.LeftShift);
        return { success: true, action, message: 'الفيديو التالي (Shift+N)' };

      case 'skip_ad':
        // Trigger Ctrl + Shift + X (YouTube Ad Skipper Chrome Extension)
        await keyboard.pressKey(Key.LeftControl, Key.LeftShift, Key.X);
        await keyboard.releaseKey(Key.LeftControl, Key.LeftShift, Key.X);
        return { success: true, action, message: 'تخطي الإعلان (Ctrl+Shift+X)' };

      case 'volume_up':
        await keyboard.pressKey(Key.Up);
        await keyboard.releaseKey(Key.Up);
        return { success: true, action, message: 'رفع صوت يوتيوب' };

      case 'volume_down':
        await keyboard.pressKey(Key.Down);
        await keyboard.releaseKey(Key.Down);
        return { success: true, action, message: 'خفض صوت يوتيوب' };

      default:
        throw new Error(`إجراء يوتيوب غير مدعوم: ${action}`);
    }
  } catch (err) {
    console.error('[nutService] youtubeControl error:', err.message);
    throw err;
  }
}

export function getCachedPos() {
  return { ...cachedPos };
}

/**
 * Zoom In (Ctrl + Plus / Equal)
 */
export async function zoomIn() {
  try {
    await keyboard.pressKey(Key.LeftControl, Key.Equal);
    await keyboard.releaseKey(Key.LeftControl, Key.Equal);
    return { success: true, action: 'zoom_in', message: 'تكبير الصفحة (Ctrl +)' };
  } catch (err) {
    console.error('[nutService] zoomIn error:', err.message);
    throw err;
  }
}

/**
 * Zoom Out (Ctrl + Minus)
 */
export async function zoomOut() {
  try {
    await keyboard.pressKey(Key.LeftControl, Key.Minus);
    await keyboard.releaseKey(Key.LeftControl, Key.Minus);
    return { success: true, action: 'zoom_out', message: 'تصغير الصفحة (Ctrl -)' };
  } catch (err) {
    console.error('[nutService] zoomOut error:', err.message);
    throw err;
  }
}

/**
 * Zoom Reset (Ctrl + 0)
 */
export async function zoomReset() {
  try {
    await keyboard.pressKey(Key.LeftControl, Key.Num0);
    await keyboard.releaseKey(Key.LeftControl, Key.Num0);
    return { success: true, action: 'zoom_reset', message: 'إعادة ضبط الحجم الطبيعي (Ctrl 0)' };
  } catch (err) {
    console.error('[nutService] zoomReset error:', err.message);
    throw err;
  }
}

/**
 * Switch Active Window (Alt + Tab)
 */
export async function switchWindow() {
  try {
    await keyboard.pressKey(Key.LeftAlt, Key.Tab);
    await keyboard.releaseKey(Key.LeftAlt, Key.Tab);
    return { success: true, action: 'switch_window', message: 'تبديل النافذة (Alt + Tab)' };
  } catch (err) {
    console.error('[nutService] switchWindow error:', err.message);
    throw err;
  }
}

/**
 * Type text onto the target computer with optional Enter key press
 */
export async function typeText(text = '', pressEnter = false) {
  try {
    const clean = String(text || '');
    if (clean) {
      await keyboard.type(clean);
    }
    if (pressEnter) {
      await new Promise((r) => setTimeout(r, 60));
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
    }
    return {
      success: true,
      text: clean,
      pressedEnter: pressEnter,
      message: `تمت كتابة النص بنجاح${pressEnter ? ' مع ضغط Enter' : ''}`,
    };
  } catch (err) {
    console.error('[nutService] typeText error:', err.message);
    throw err;
  }
}

/**
 * Press Backspace key
 */
export async function backspace() {
  try {
    await keyboard.pressKey(Key.Backspace);
    await keyboard.releaseKey(Key.Backspace);
    return { success: true, action: 'backspace', message: 'مسح (Backspace)' };
  } catch (err) {
    console.error('[nutService] backspace error:', err.message);
    throw err;
  }
}

/**
 * Press Enter key
 */
export async function pressEnterKey() {
  try {
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    return { success: true, action: 'enter', message: 'إدخال (Enter)' };
  } catch (err) {
    console.error('[nutService] pressEnterKey error:', err.message);
    throw err;
  }
}

/**
 * Browser Back (Alt + Left)
 */
export async function browserBack() {
  try {
    await keyboard.pressKey(Key.LeftAlt, Key.Left);
    await keyboard.releaseKey(Key.LeftAlt, Key.Left);
    return { success: true, action: 'browser_back', message: 'رجوع في المتصفح (Alt + Left)' };
  } catch (err) {
    console.error('[nutService] browserBack error:', err.message);
    throw err;
  }
}

/**
 * Browser Forward (Alt + Right)
 */
export async function browserForward() {
  try {
    await keyboard.pressKey(Key.LeftAlt, Key.Right);
    await keyboard.releaseKey(Key.LeftAlt, Key.Right);
    return { success: true, action: 'browser_forward', message: 'تقديم في المتصفح (Alt + Right)' };
  } catch (err) {
    console.error('[nutService] browserForward error:', err.message);
    throw err;
  }
}
