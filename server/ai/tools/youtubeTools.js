import { tool } from 'ai';
import { z } from 'zod';
import { exec, execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Locate Google Chrome executable across standard Windows installation directories.
 */
export function findWindowsChromeExecutable() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : '',
  ].filter(Boolean);

  for (const exePath of candidates) {
    if (fs.existsSync(exePath)) {
      return exePath;
    }
  }
  return null;
}

/**
 * Bring Chrome (or active browser window) to the foreground using Win32 ShowWindow(hWnd, 9) + SetForegroundWindow(hWnd).
 */
export function bringBrowserWindowToFront(preferredTitlePattern = 'YouTube|Chrome') {
  const safePattern = String(preferredTitlePattern || 'Chrome').replace(/'/g, "''");
  const psScript = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class Win32BringFront {',
    '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
    '}',
    '"@;',
    'Start-Sleep -Milliseconds 350;',
    '$procs = Get-Process -Name chrome,msedge,brave -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 };',
    'if ($procs) {',
    `  $win = $procs | Where-Object { $_.MainWindowTitle -match '${safePattern}' } | Select-Object -First 1;`,
    '  if (-not $win) { $win = $procs | Select-Object -First 1 }',
    '  [Win32BringFront]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero);',
    '  [Win32BringFront]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero);',
    '  [Win32BringFront]::ShowWindow($win.MainWindowHandle, 9) | Out-Null;',
    '  [Win32BringFront]::SetForegroundWindow($win.MainWindowHandle) | Out-Null;',
    '  Write-Output ("FOCUSED:" + $win.MainWindowTitle);',
    '}',
  ].join('\n');

  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -EncodedCommand ${encoded}`,
      { shell: 'cmd.exe', timeout: 5000 },
      (err, stdout) => {
        resolve({
          focused: !err && Boolean((stdout || '').includes('FOCUSED:')),
          windowTitle: (stdout || '').split('FOCUSED:')[1]?.trim() || null,
        });
      }
    );
  });
}

/**
 * Launch a URL reliably in Windows foreground via PowerShell Start-Process (execFile),
 * with Chrome direct spawn for extra flags like --incognito, followed by foreground window focus.
 */
export async function launchUrlInChromeForeground(targetUrl, extraChromeArgs = [], focusPattern = 'Chrome') {
  const safeUrl = String(targetUrl || '').trim();
  if (!safeUrl) {
    return { success: false, error: 'URL is empty' };
  }

  const chromeExe = findWindowsChromeExecutable();

  // If extra Chrome arguments (e.g. --incognito) are requested, launch Chrome directly with them
  if (extraChromeArgs.length > 0 && chromeExe) {
    const launched = await new Promise((resolve) => {
      try {
        const child = spawn(chromeExe, [...extraChromeArgs, safeUrl], {
          detached: true,
          shell: false,
          windowsHide: false,
          stdio: 'ignore',
        });

        let settled = false;
        child.once('error', (err) => {
          if (!settled) {
            settled = true;
            resolve({ ok: false, error: err.message });
          }
        });

        child.once('spawn', () => {
          child.unref();
          if (!settled) {
            settled = true;
            resolve({ ok: true, method: 'chrome_spawn', executable: chromeExe, pid: child.pid });
          }
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });

    if (launched.ok) {
      const focusInfo = await bringBrowserWindowToFront(focusPattern);
      return {
        success: true,
        method: launched.method,
        executable: launched.executable,
        pid: launched.pid,
        foreground: focusInfo.focused,
      };
    }
  }

  // Primary Windows foreground launch via PowerShell Start-Process (avoids cmd.exe '&' truncation)
  const psRes = await new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Start-Process '${safeUrl.replace(/'/g, "''")}'`],
      { timeout: 6000 },
      (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true, method: 'powershell_start_process' });
        }
      }
    );
  });

  if (psRes.success) {
    const focusInfo = await bringBrowserWindowToFront(focusPattern);
    return { ...psRes, foreground: focusInfo.focused };
  }

  // Secondary fallback: direct Chrome spawn if Start-Process failed
  if (chromeExe) {
    const launched = await new Promise((resolve) => {
      try {
        const child = spawn(chromeExe, [safeUrl], {
          detached: true,
          shell: false,
          windowsHide: false,
          stdio: 'ignore',
        });
        let settled = false;
        child.once('error', (err) => {
          if (!settled) {
            settled = true;
            resolve({ success: false, error: err.message });
          }
        });
        child.once('spawn', () => {
          child.unref();
          if (!settled) {
            settled = true;
            resolve({ success: true, method: 'chrome_spawn', executable: chromeExe, pid: child.pid });
          }
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
    if (launched.success) {
      const focusInfo = await bringBrowserWindowToFront(focusPattern);
      return { ...launched, foreground: focusInfo.focused };
    }
  }

  return psRes;
}

/**
 * AI Tool: Open YouTube homepage or search YouTube, extract clean VIDEO_ID, open in foreground
 */
export const playYoutubeVideo = tool({
  description:
    'فتح موقع يوتيوب (الصفحة الرئيسية) أو البحث عن أي فيديو أو أغنية أو ملخص ماتش أو فيلم أو قرآن على يوتيوب وتشغيله مباشرة في مقدمة ويندوز.',
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .default('')
      .describe('نص أو جملة البحث عن الفيديو على يوتيوب (مثال: ملخص ماتش الأهلي والزمالك، سورة الكهف، عمرو دياب)، أو اتركه فارغاً / "youtube" لفتح الصفحة الرئيسية ليوتيوب'),
  }),
  execute: async ({ query = '' }) => {
    const cleanQuery = String(query || '')
      .replace(/["'`<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const isHomepageRequest =
      !cleanQuery ||
      /^(?:(?:افتح|شغل)(?:\s+(?:لي|لنا))?\s+)?(?:ال)?(?:يوتيوب|youtube(?:\.com)?)(?:\s+(?:الرئيسي[ةه]|العادي|فقط|بس))?$/i.test(
        cleanQuery,
      ) ||
      /^(?:home|homepage|الرئيسي[ةه])$/i.test(cleanQuery);

    if (isHomepageRequest) {
      const homeUrl = 'https://www.youtube.com/';
      const launchResult = await launchUrlInChromeForeground(homeUrl, [], 'YouTube|Chrome');
      if (!launchResult.success) {
        return {
          success: false,
          query: cleanQuery || 'YouTube',
          url: homeUrl,
          error: launchResult.error,
          message: `فشل فتح يوتيوب في المتصفح: ${launchResult.error}`,
        };
      }
      return {
        success: true,
        query: cleanQuery || 'YouTube',
        videoId: null,
        url: homeUrl,
        directVideo: false,
        homepage: true,
        method: launchResult.method,
        pid: launchResult.pid || null,
        foreground: Boolean(launchResult.foreground),
        message: '✓ تم فتح يوتيوب في المقدمة يا باشا! 🎬',
      };
    }

    const fallbackSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
    let videoUrl = fallbackSearchUrl;
    let videoId = null;
    let directVideo = false;

    try {
      const response = await fetch(fallbackSearchUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'ar,en;q=0.9',
        },
        signal: AbortSignal.timeout(6500),
      });

      if (response.ok) {
        const html = await response.text();
        const watchMatch = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
        const shortsMatch = !watchMatch ? html.match(/\/shorts\/([a-zA-Z0-9_-]{11})/) : null;

        if (watchMatch && watchMatch[1]) {
          videoId = watchMatch[1];
          videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
          directVideo = true;
        } else if (shortsMatch && shortsMatch[1]) {
          videoId = shortsMatch[1];
          videoUrl = `https://www.youtube.com/shorts/${videoId}`;
          directVideo = true;
        }
      }
    } catch (fetchErr) {
      console.warn('[youtubeTools:playYoutubeVideo] Fetch fallback to search URL:', fetchErr.message);
    }

    const launchResult = await launchUrlInChromeForeground(videoUrl, [], 'YouTube|Chrome');
    if (!launchResult.success) {
      return {
        success: false,
        query: cleanQuery,
        url: videoUrl,
        error: launchResult.error,
        message: `فشل فتح يوتيوب في المتصفح: ${launchResult.error}`,
      };
    }

    return {
      success: true,
      query: cleanQuery,
      videoId,
      url: videoUrl,
      directVideo,
      method: launchResult.method,
      pid: launchResult.pid || null,
      foreground: Boolean(launchResult.foreground),
      message: directVideo
        ? `✓ تم تشغيل فيديو يوتيوب في المقدمة: ${videoUrl}`
        : `✓ تم فتح نتائج بحث يوتيوب في المقدمة عن: "${cleanQuery}"`,
    };
  },
});

/**
 * AI Tool: Control Windows Media Playback and Volume via Virtual Key Codes
 */
export const controlMediaPlayback = tool({
  description:
    'التحكم الفوري في الصوت وتشغيل الوسائط على ويندوز (play_pause للتشغيل والإيقاف، mute لكتم الصوت، volume_up لرفع الصوت 7 نبضات ~14%، volume_down لخفض الصوت 7 نبضات ~14%، next للتالي).',
  inputSchema: z.object({
    action: z
      .enum(['play_pause', 'mute', 'volume_up', 'volume_down', 'next'])
      .describe('إجراء التحكم في الميديا والصوت'),
    repeat: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('عدد النبضات المتتالية (افتراضياً 7 نبضات = ~14% لرفع وخفض الصوت، و 1 لباقي الأوامر)'),
  }),
  execute: async ({ action, repeat }) => {
    const keyMap = {
      play_pause: 179, // 0xB3 VK_MEDIA_PLAY_PAUSE
      mute: 173,       // 0xAD VK_VOLUME_MUTE
      volume_down: 174,// 0xAE VK_VOLUME_DOWN
      volume_up: 175,  // 0xAF VK_VOLUME_UP
      next: 176,       // 0xB0 VK_MEDIA_NEXT_TRACK
    };

    const charCode = keyMap[action];
    if (!charCode) {
      return { success: false, error: `إجراء غير مدعوم: ${action}` };
    }

    const isVolumeStep = action === 'volume_up' || action === 'volume_down';
    const defaultPulses = isVolumeStep ? 7 : 1;
    const count = Math.max(1, Math.min(repeat && repeat > 1 ? repeat : defaultPulses, 20));
    const psCmd = `powershell -NoProfile -Command "$w = New-Object -ComObject WScript.Shell; for($i=0; $i -lt ${count}; $i++) { $w.SendKeys([char]${charCode}); Start-Sleep -Milliseconds 35 }"`;

    return new Promise((resolve) => {
      exec(psCmd, { shell: 'cmd.exe', timeout: 5000 }, (err) => {
        if (err) {
          resolve({
            success: false,
            action,
            error: err.message,
            message: `فشل تنفيذ أمر الميديا (${action}): ${err.message}`,
          });
        } else {
          resolve({
            success: true,
            action,
            pulses: count,
            repeat: count,
            message: `✓ تم تنفيذ أمر الميديا (${action}) بنجاح (${count} نبضات).`,
          });
        }
      });
    });
  },
});
