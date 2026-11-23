import { tool } from 'ai';
import { z } from 'zod';
import ytSearch from 'yt-search';
import { exec } from 'child_process';
import { mediaControl, youtubeControl, closeTab, openLens, zoomInLens, zoomOutLens, closeLens, panLens } from '../services/nutService.js';
import { executePowerAction } from '../services/systemService.js';

/**
 * Tool 1: Play YouTube Video
 * Searches YouTube via yt-search, grabs the top matching video,
 * and launches it directly in the default browser via Windows command: start "" "<url>"
 */
export const playYoutubeVideo = tool({
  description:
    'البحث عن أي فيديو أو أغنية أو ملخص ماتش أو فيلم أو قرآن على يوتيوب وتشغيله مباشرة في المتصفح الافتراضي للكمبيوتر.',
  inputSchema: z.object({
    query: z.string().describe('نص أو جملة البحث عن الفيديو على يوتيوب (مثال: ملخص ماتش الاهلي، اغاني عمرو دياب، قران سورة الكهف)'),
  }),
  execute: async ({ query }) => {
    try {
      const cleanQuery = (query || '').trim();
      if (!cleanQuery) {
        return { success: false, message: 'من فضلك وضح اسم الفيديو أو محتوى البحث المطلوب.' };
      }

      console.log(`[relaxTools:playYoutubeVideo] Searching YouTube for: "${cleanQuery}"`);
      const searchResult = await ytSearch(cleanQuery);
      const video = searchResult?.videos?.[0];

      if (!video || !video.url) {
        return {
          success: false,
          query: cleanQuery,
          message: `عذراً، لم أجد أي فيديو مطابق لـ "${cleanQuery}" على يوتيوب.`,
        };
      }

      const videoUrl = video.url;
      const videoTitle = video.title || cleanQuery;
      console.log(`[relaxTools:playYoutubeVideo] Found video: "${videoTitle}" (${videoUrl})`);

      // Open in default browser via Windows command: start "" "<url>"
      const isWindows = process.platform === 'win32';
      const cmd = isWindows ? `start "" "${videoUrl}"` : `open "${videoUrl}"`;

      await new Promise((resolve, reject) => {
        exec(cmd, (err) => {
          if (err) {
            console.error('[relaxTools:playYoutubeVideo] Failed to launch browser:', err);
            return reject(err);
          }
          resolve();
        });
      });

      return {
        success: true,
        title: videoTitle,
        url: videoUrl,
        author: video.author?.name,
        duration: video.duration?.timestamp,
        message: `تم تشغيل: ${videoTitle}`,
      };
    } catch (err) {
      console.error('[relaxTools:playYoutubeVideo] Error:', err);
      return { success: false, error: err.message, message: `فشل تشغيل الفيديو: ${err.message}` };
    }
  },
});

/**
 * Tool 2: Control Media and Relaxation Actions
 * Actions: volume_up, volume_down, mute, play_pause, fullscreen, close_tab, lock, sleep
 * Supports optional repeat count (default 1)
 */
export const controlMedia = tool({
  description:
    'التحكم في الوسائط ومستوى الصوت والنوافذ والطاقة (رفع الصوت، خفض الصوت، كتم الصوت، تشغيل/إيقاف مؤقت، ملء الشاشة، قفل التاب، قفل الكمبيوتر، وضع النوم).',
  inputSchema: z.object({
    action: z
      .enum(['volume_up', 'volume_down', 'mute', 'play_pause', 'fullscreen', 'close_tab', 'lock', 'sleep'])
      .describe('إجراء التحكم المطلوب: volume_up (رفع الصوت), volume_down (خفض الصوت), mute (كتم الصوت), play_pause (تشغيل/إيقاف), fullscreen (ملء الشاشة), close_tab (قفل التاب), lock (قفل الكمبيوتر), sleep (وضع النوم)'),
    repeat: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(1)
      .describe('عدد مرات تكرار الإجراء (مثلاً لرفع الصوت أو خفضه عدة درجات) - افتراضياً 1'),
  }),
  execute: async ({ action, repeat = 1 }) => {
    try {
      const count = Math.max(1, Math.min(repeat || 1, 10));
      console.log(`[relaxTools:controlMedia] Executing action: ${action} (repeat: ${count})`);

      for (let i = 0; i < count; i++) {
        switch (action) {
          case 'volume_up':
          case 'volume_down':
          case 'mute':
          case 'play_pause':
            await mediaControl(action);
            break;
          case 'fullscreen':
            await youtubeControl('fullscreen');
            break;
          case 'close_tab':
            await closeTab();
            break;
          case 'lock':
            await executePowerAction('lock');
            break;
          case 'sleep':
            await executePowerAction('sleep');
            break;
          default:
            throw new Error(`إجراء غير معروف: ${action}`);
        }
        if (count > 1 && i < count - 1) {
          await new Promise((r) => setTimeout(r, 60));
        }
      }

      const actionArabicNames = {
        volume_up: `تم رفع الصوت (${count} درجات)`,
        volume_down: `تم خفض الصوت (${count} درجات)`,
        mute: 'تم تبديل كتم الصوت',
        play_pause: 'تم تشغيل / إيقاف الوسائط',
        fullscreen: 'تم تبديل ملء الشاشة',
        close_tab: 'تم إغلاق التاب الحالي',
        lock: 'تم قفل شاشة الكمبيوتر',
        sleep: 'تم تفعيل وضع النوم للكمبيوتر',
      };

      return {
        success: true,
        action,
        repeat: count,
        message: actionArabicNames[action] || `تم تنفيذ ${action}`,
      };
    } catch (err) {
      console.error('[relaxTools:controlMedia] Error:', err);
      return { success: false, action, error: err.message, message: `فشل تنفيذ الأمر: ${err.message}` };
    }
  },
});

/**
 * Tool 3: Control Windows Magnifier Lens Mode
 * Supports voice commands like: "افتح العدسة", "كبر العدسة", "صغر العدسة", "اقفل العدسة", "حرك العدسة لفوق"
 */
export const controlMagnifier = tool({
  description:
    'التحكم في عدسة ويندوز المكبرة العائمة (Windows Magnifier Lens Mode) لتكبير وقراءة الشاشة والنصوص من مسافة بعيدة (افتح العدسة، كبر، صغر، اقفل، أو حرك العدسة بالاتجاهات).',
  inputSchema: z.object({
    action: z
      .enum(['open', 'close', 'zoom_in', 'zoom_out', 'pan_up', 'pan_down', 'pan_left', 'pan_right'])
      .describe('إجراء العدسة: open (فتح العدسة العائمة), close (إغلاق العدسة), zoom_in (تكبير), zoom_out (تصغير), pan_up (تحريك لأعلى), pan_down (تحريك لأسفل), pan_left (تحريك يسار), pan_right (تحريك يمين)'),
    step: z
      .number()
      .int()
      .optional()
      .default(70)
      .describe('مقدار التحريك بالبكسل في حالة pan (افتراضياً 70)'),
  }),
  execute: async ({ action, step = 70 }) => {
    try {
      console.log(`[relaxTools:controlMagnifier] Executing action: ${action}, step: ${step}`);
      const delta = Math.max(10, Math.min(step || 70, 500));

      switch (action) {
        case 'open':
          return await openLens();
        case 'close':
          return await closeLens();
        case 'zoom_in':
          return await zoomInLens();
        case 'zoom_out':
          return await zoomOutLens();
        case 'pan_up':
          await panLens(0, -delta);
          return { success: true, action, message: `تم تحريك العدسة لأعلى ${delta} بكسل` };
        case 'pan_down':
          await panLens(0, delta);
          return { success: true, action, message: `تم تحريك العدسة لأسفل ${delta} بكسل` };
        case 'pan_left':
          await panLens(-delta, 0);
          return { success: true, action, message: `تم تحريك العدسة لليسار ${delta} بكسل` };
        case 'pan_right':
          await panLens(delta, 0);
          return { success: true, action, message: `تم تحريك العدسة لليمين ${delta} بكسل` };
        default:
          throw new Error(`إجراء عدسة غير معروف: ${action}`);
      }
    } catch (err) {
      console.error('[relaxTools:controlMagnifier] Error:', err);
      return { success: false, action, error: err.message, message: `فشل إجراء العدسة: ${err.message}` };
    }
  },
});

export const relaxTools = {
  playYoutubeVideo,
  controlMedia,
  controlMagnifier,
};
