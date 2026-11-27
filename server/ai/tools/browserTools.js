import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import { launchUrlInChromeForeground } from './youtubeTools.js';

/**
 * Smart URL resolver for Egyptian Arabic & English website names, LinkedIn Profile, and search queries.
 */
export function resolveSmartUrl(rawInput) {
  const raw = (rawInput || '').trim();
  if (!raw) return '';

  const lower = raw.toLowerCase();

  // 1. LinkedIn personal profile ("بروفايلي على لينكد إن" / "linkedin profile" / "حسابي في لينكد إن")
  const mentionsLinkedIn =
    /linkedin|لينكد\s*ان|لينكد\s*إن|لينكدان|لينكدإن/i.test(raw);
  const mentionsProfile =
    /بروفايل|بروفايلي|صفحتي|حسابي|اكونتي|أكونتي|profile|\/in\/me/i.test(raw);

  if (mentionsLinkedIn && mentionsProfile) {
    return 'https://www.linkedin.com/in/me/';
  }

  // 2. Direct full URLs
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  // 3. Well-known platforms in Arabic or English
  if (mentionsLinkedIn || /^linkedin(?:\.com)?$/i.test(lower)) {
    return 'https://www.linkedin.com/';
  }
  if (/github|جيت\s*هاب|جيتهاب|جت\s*هاب/i.test(raw)) {
    return 'https://github.com/';
  }
  if (/chatgpt|شات\s*جي\s*بي\s*تي|تشات\s*جي\s*بي\s*تي|جي\s*بي\s*تي/i.test(raw)) {
    return 'https://chatgpt.com/';
  }
  if (/^(?:يوتيوب|اليوتيوب|youtube(?:\.com)?)$/i.test(raw)) {
    return 'https://www.youtube.com/';
  }
  if (/فيسبوك|فيس\s*بوك|^facebook(?:\.com)?$/i.test(raw)) {
    return 'https://www.facebook.com/';
  }
  if (/^(?:جوجل|غوغل|google(?:\.com)?)$/i.test(raw)) {
    return 'https://www.google.com/';
  }
  if (/واتساب|واتس\s*اب|whatsapp/i.test(raw)) {
    return 'https://web.whatsapp.com/';
  }

  // 4. Domain-like strings (e.g. "npmjs.com", "vercel.com/dashboard")
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(raw) && !raw.includes(' ')) {
    return `https://${raw}`;
  }

  // 5. Fallback to Google Search
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

/**
 * Normalize Arabic/English target tab title to browser MainWindowTitle keyword
 */
export function normalizeTabTargetTitle(rawTarget) {
  const raw = (rawTarget || '').trim();
  if (!raw) return '';
  if (/يوتيوب|اليوتيوب|youtube/i.test(raw)) return 'YouTube';
  if (/لينكد|linkedin/i.test(raw)) return 'LinkedIn';
  if (/جيت\s*هاب|جيتهاب|github/i.test(raw)) return 'GitHub';
  if (/شات\s*جي\s*بي\s*تي|chatgpt/i.test(raw)) return 'ChatGPT';
  if (/فيسبوك|فيس\s*بوك|facebook/i.test(raw)) return 'Facebook';
  if (/جوجل|غوغل|google/i.test(raw)) return 'Google';
  if (/واتساب|whatsapp/i.test(raw)) return 'WhatsApp';
  return raw;
}

/**
 * AI Tool: Open a URL, known platform, LinkedIn profile, or search query in Google Chrome
 */
export const openBrowserUrl = tool({
  description:
    'فتح موقع إلكتروني معروف (لينكد إن، بروفايل لينكد إن https://www.linkedin.com/in/me/، جيت هاب، شات جي بي تي، فيسبوك، جوجل) أو رابط أو بحث في متصفح Google Chrome مع دعم التصفح الخفي (incognito: true).',
  inputSchema: z.object({
    url: z
      .string()
      .describe(
        'رابط الموقع (مثل https://www.linkedin.com/in/me/ لبروفايل لينكد إن، https://github.com، https://chatgpt.com) أو اسم الموقع أو جملة البحث'
      ),
    incognito: z
      .boolean()
      .optional()
      .default(false)
      .describe('ضع true لفتح الموقع في وضع التصفح الخفي (Incognito Mode)'),
  }),
  execute: async ({ url, incognito = false }) => {
    const targetUrl = resolveSmartUrl(url);
    if (!targetUrl) {
      return { success: false, message: 'يرجى تحديد رابط الموقع أو كلمة البحث.' };
    }

    const extraArgs = incognito ? ['--incognito'] : [];
    console.log(`[browserTools:openBrowserUrl] Opening ${targetUrl} (incognito=${Boolean(incognito)})`);

    const launchRes = await launchUrlInChromeForeground(targetUrl, extraArgs, 'Chrome');
    if (!launchRes.success) {
      return {
        success: false,
        url: targetUrl,
        incognito: Boolean(incognito),
        error: launchRes.error,
        message: `فشل فتح المتصفح: ${launchRes.error}`,
      };
    }

    return {
      success: true,
      url: targetUrl,
      incognito: Boolean(incognito),
      method: launchRes.method,
      pid: launchRes.pid || null,
      foreground: Boolean(launchRes.foreground),
      message: `✓ تم فتح ${targetUrl}${incognito ? ' في وضع التصفح الخفي (Incognito)' : ''} بنجاح.`,
    };
  },
});

/**
 * AI Tool: Execute browser tab actions (including targeted tab closing by window title)
 */
export const browserTabAction = tool({
  description:
    'التحكم في تبويبات المتصفح (close_current_tab لإغلاق التاب الحالي أو تاب موقع محدد بتمرير targetTitle مثل YouTube أو LinkedIn، new_tab لفتح تاب جديد، reopen_closed_tab لإعادة فتح تاب مغلق، refresh_tab لتحديث الصفحة).',
  inputSchema: z.object({
    action: z
      .enum(['close_current_tab', 'new_tab', 'reopen_closed_tab', 'refresh_tab'])
      .describe('الإجراء المطلوب على التبويب'),
    targetTitle: z
      .string()
      .optional()
      .describe(
        'اختياري: اسم الموقع المراد إغلاق التاب الخاص به إذا حدده المستخدم (مثل YouTube أو LinkedIn أو GitHub)'
      ),
  }),
  execute: async ({ action, targetTitle }) => {
    const cleanTarget = normalizeTabTargetTitle(targetTitle);

    // Targeted tab closing: locate browser window with matching MainWindowTitle, bring to foreground, send Ctrl+W
    if (action === 'close_current_tab' && cleanTarget) {
      const safePattern = cleanTarget.replace(/'/g, "''");
      const psTargetedScript = [
        'Add-Type -TypeDefinition @"',
        'using System;',
        'using System.Runtime.InteropServices;',
        'public class Win32TabFocus {',
        '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
        '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
        '}',
        '"@;',
        `$procs = Get-Process -Name chrome,msedge,brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match '${safePattern}' };`,
        'if (-not $procs) { Write-Output "NOT_FOUND"; exit 0 }',
        '$win = $procs | Select-Object -First 1;',
        '[Win32TabFocus]::ShowWindowAsync($win.MainWindowHandle, 9) | Out-Null;',
        '[Win32TabFocus]::SetForegroundWindow($win.MainWindowHandle) | Out-Null;',
        'Start-Sleep -Milliseconds 180;',
        "(New-Object -ComObject WScript.Shell).SendKeys('^w');",
        'Write-Output ("CLOSED:" + $win.MainWindowTitle);',
      ].join('\n');

      const encodedCommand = Buffer.from(psTargetedScript, 'utf16le').toString('base64');

      return new Promise((resolve) => {
        exec(
          `powershell -NoProfile -EncodedCommand ${encodedCommand}`,
          { shell: 'cmd.exe', timeout: 7000 },
          (err, stdout) => {
            if (err) {
              resolve({
                success: false,
                action,
                targetTitle: cleanTarget,
                error: err.message,
                message: `تعذر البحث عن نافذة (${cleanTarget}): ${err.message}`,
              });
              return;
            }

            const out = (stdout || '').trim();
            if (out.includes('NOT_FOUND') || !out.includes('CLOSED:')) {
              resolve({
                success: false,
                action,
                targetTitle: cleanTarget,
                found: false,
                message: `لم يتم العثور على تبويب نشط بعنوان "${cleanTarget}" في المتصفح حالياً.`,
              });
              return;
            }

            const closedTitle = out.split('CLOSED:')[1]?.trim() || cleanTarget;
            resolve({
              success: true,
              action,
              targetTitle: cleanTarget,
              closedWindow: closedTitle,
              message: `✓ تم تفعيل نافذة (${closedTitle}) وإغلاق تبويب ${cleanTarget} بنجاح.`,
            });
          }
        );
      });
    }

    const sendKeyMap = {
      close_current_tab: '^w',
      new_tab: '^t',
      reopen_closed_tab: '^+t',
      refresh_tab: '{F5}',
    };

    const keys = sendKeyMap[action];
    if (!keys) {
      return { success: false, error: `إجراء تاب غير مدعوم: ${action}` };
    }

    const psCmd = `powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys('${keys}')"`;

    return new Promise((resolve) => {
      exec(psCmd, { shell: 'cmd.exe', timeout: 5000 }, (err) => {
        if (err) {
          resolve({
            success: false,
            action,
            error: err.message,
            message: `فشل تنفيذ إجراء التبويب (${action}): ${err.message}`,
          });
        } else {
          resolve({
            success: true,
            action,
            message: `✓ تم تنفيذ (${action}) على المتصفح بنجاح.`,
          });
        }
      });
    });
  },
});
