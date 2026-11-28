import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import crypto from 'crypto';

/**
 * AI Tool: System Power Controller with Human-in-the-Loop safety guard
 */
export const controlPower = tool({
  description:
    'التحكم في أوامر الطاقة للنظام (Lock, Sleep, Shutdown, Restart, Cancel Shutdown). الأوامر الحساسة مثل Shutdown و Restart تتطلب تأكيداً بشرياً من المستخدم عبر الواجهة قبل التنفيذ لحماية عمل المستخدم.',
  inputSchema: z.object({
    action: z
      .enum(['lock', 'sleep', 'shutdown', 'restart', 'cancel_shutdown'])
      .describe('نوع إجراء الطاقة المطلوب تنفيذه'),
    reason: z
      .string()
      .optional()
      .describe('سبب أو توضيح إضافي لأمر الطاقة'),
  }),
  execute: async ({ action, reason }, { serverConfirmed = false } = {}) => {
    // 1. Lock screen: Instant and fully safe
    if (action === 'lock') {
      return new Promise((resolve) => {
        exec('rundll32.exe user32.dll,LockWorkStation', { shell: 'cmd.exe' }, (err) => {
          if (err) {
            resolve({ success: false, error: `فشل قفل الشاشة: ${err.message}` });
          } else {
            resolve({
              success: true,
              action: 'lock',
              message: '✓ تم قفل شاشة الحاسوب فوراً وبأمان (Lock).',
            });
          }
        });
      });
    }

    // 2. Sleep mode: Instant and safe
    if (action === 'sleep') {
      return new Promise((resolve) => {
        exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', { shell: 'cmd.exe' }, (err) => {
          if (err) {
            resolve({ success: false, error: `فشل تفعيل وضع السكون: ${err.message}` });
          } else {
            resolve({
              success: true,
              action: 'sleep',
              message: '✓ تم تفعيل وضع السكون للحاسوب (Sleep).',
            });
          }
        });
      });
    }

    // 3. Cancel scheduled shutdown
    if (action === 'cancel_shutdown') {
      return new Promise((resolve) => {
        exec('shutdown /a', { shell: 'cmd.exe' }, (err) => {
          // If no shutdown was in progress, Windows returns code 1116, but system is safe
          resolve({
            success: true,
            action: 'cancel_shutdown',
            message: err
              ? '✓ النظام آمن: لا يوجد أمر إيقاف تشغيل قيد التنفيذ حالياً.'
              : '✓ تم إلغاء أمر إيقاف التشغيل بنجاح.',
          });
        });
      });
    }

    // 4. Critical actions: Shutdown & Restart require explicit user confirmation
    const actionTitles = {
      shutdown: 'إيقاف تشغيل الكمبيوتر بالكامل (Shutdown)',
      restart: 'إعادة تشغيل الكمبيوتر (Restart)',
    };

    if (serverConfirmed !== true) {
      console.warn(`[powerTools:controlPower] Blocked unconfirmed power action: ${action}`);
      const actionId = crypto.randomUUID();
      return {
        success: false,
        status: 'awaiting_confirmation',
        requiresConfirmation: true,
        action,
        pendingAction: {
          id: actionId,
          toolName: 'controlPower',
          realAction: action,
          action,
          args: { action, reason },
          title: actionTitles[action] || action,
          reason: reason || 'طلب أمر طاقة من المساعد الذكي',
        },
        message: `⚠️ تنبيه: أمر ${actionTitles[action]} خطير وغير قابل للتراجع. تم حجب التنفيذ التلقائي ويتطلب تأكيدك الصريح عبر الضغط على زر الموافقة في الشاشة.`,
      };
    }

    // If confirmed is true: execute with safety grace window of 10s
    const cmd = action === 'restart'
      ? 'shutdown /r /t 10 /c "Assistive System: Restart confirmed by user"'
      : 'shutdown /s /t 10 /c "Assistive System: Shutdown confirmed by user"';

    return new Promise((resolve) => {
      exec(cmd, { shell: 'cmd.exe' }, (err) => {
        if (err) {
          resolve({ success: false, verified: false, error: `فشل تنفيذ أمر الطاقة: ${err.message}` });
        } else {
          resolve({
            success: true,
            verified: true,
            action,
            message: `✓ تم تأكيد الأمر: جاري تنفيذ ${actionTitles[action]} خلال 10 ثوانٍ (يمكنك إلغاؤه خلال المهلة).`,
          });
        }
      });
    });
  },
});
