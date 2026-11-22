import { tool } from 'ai';
import { z } from 'zod';
import { openWebsite, openApp, getSystemStatus } from '../services/systemService.js';
import { mediaControl } from '../services/nutService.js';

/**
 * AI Tool: Open any valid website in default browser
 */
export const openWebsiteTool = tool({
  description: 'فتح موقع إلكتروني أو رابط في المتصفح الافتراضي (مثل: يوتيوب، جوجل، فيسبوك، جيتميل، إلخ)',
  inputSchema: z.object({
    url: z.string().describe('رابط الموقع كاملاً أو اسم النطاق مثل https://youtube.com أو google.com'),
  }),
  execute: async ({ url }) => {
    return await openWebsite(url);
  },
});

/**
 * AI Tool: Control media playback and volume
 */
export const mediaControlTool = tool({
  description: 'التحكم في تشغيل الوسائط ومستوى الصوت (رفع الصوت، خفض الصوت، كتم الصوت، تشغيل/إيقاف مؤقت، التالي، السابق)',
  inputSchema: z.object({
    action: z
      .enum(['volume_up', 'volume_down', 'mute', 'play_pause', 'next', 'previous'])
      .describe('إجراء التحكم المطلوب تنفيذه على الوسائط'),
  }),
  execute: async ({ action }) => {
    return await mediaControl(action);
  },
});

/**
 * AI Tool: Launch allowed desktop applications
 */
export const openAppTool = tool({
  description: 'فتح برامج وتطبيقات محددة على نظام التشغيل (vscode, chrome, notepad, calculator)',
  inputSchema: z.object({
    app: z
      .enum(['vscode', 'chrome', 'notepad', 'calculator'])
      .describe('اسم البرنامج المراد فتحه: vscode (كود), chrome (متصفح), notepad (المفكرة), calculator (الآلة الحاسبة)'),
  }),
  execute: async ({ app }) => {
    return await openApp(app);
  },
});

/**
 * AI Tool: Read system hardware & network status
 */
export const getSystemStatusTool = tool({
  description: 'قراءة تقرير حي عن حالة الجهاز (استهلاك الرام RAM، المعالج CPU، وقت التشغيل، ونظام التشغيل)',
  inputSchema: z.object({}),
  execute: async () => {
    const status = getSystemStatus();
    return { success: true, status };
  },
});

/**
 * AI Tool: Human-in-the-Loop sensitive power action
 * NOTE: Does NOT execute directly; triggers a client confirmation prompt.
 */
export const requestPowerActionTool = tool({
  description:
    'طلب تنفيذ أوامر الطاقة الحساسة مثل قفل الجهاز (lock)، وضع السكون (sleep)، أو إيقاف التشغيل (shutdown). بنظام Human-in-the-Loop، لا ينفذ الأمر مباشرة بل يطلب تأكيد المستخدم أولاً.',
  inputSchema: z.object({
    action: z
      .enum(['lock', 'sleep', 'shutdown'])
      .describe('نوع أمر الطاقة المطلوب: lock أو sleep أو shutdown'),
    reason: z
      .string()
      .optional()
      .describe('سبب أو توضيح مختصر للطلب'),
  }),
  execute: async ({ action, reason }) => {
    const actionNames = {
      lock: 'قفل شاشة الحاسوب (Lock)',
      sleep: 'وضع السكون (Sleep)',
      shutdown: 'إيقاف تشغيل الحاسوب بالكامل (Shutdown)',
    };
    return {
      requiresConfirmation: true,
      pendingAction: {
        id: `power_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        action,
        title: actionNames[action] || action,
        reason: reason || 'طلب أمر طاقة من المساعد الذكي',
        createdAt: new Date().toISOString(),
      },
      message: `تم تسجيل طلب ${actionNames[action] || action}. يتطلب تأكيد المستخدم بالضغط على زر الموافقة في الشاشة قبل التنفيذ.`,
    };
  },
});

export const aiTools = {
  openWebsite: openWebsiteTool,
  mediaControl: mediaControlTool,
  openApp: openAppTool,
  getSystemStatus: getSystemStatusTool,
  requestPowerAction: requestPowerActionTool,
};
