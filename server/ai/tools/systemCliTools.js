import { tool } from 'ai';
import { z } from 'zod';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Intelligent Windows application resolver.
 * Searches PATH, %LOCALAPPDATA%\Programs, and Program Files.
 */
export function resolveAppExecutable(appName) {
  const norm = (appName || '').trim().toLowerCase();
  const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  if (norm.includes('code') || norm.includes('vscode')) {
    const candidates = [
      path.join(localApp, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(localApp, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.join(progFiles, 'Microsoft VS Code', 'Code.exe'),
      'code.cmd',
      'code',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'code';
  }

  if (norm.includes('antigravity') || norm.includes('agy')) {
    const candidates = [
      path.join(localApp, 'Programs', 'Antigravity', 'Antigravity.exe'),
      path.join(localApp, 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
      path.join(localApp, 'Programs', 'antigravity', 'bin', 'agy.cmd'),
      path.join(progFiles, 'Antigravity', 'Antigravity.exe'),
      'agy',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'agy';
  }

  if (norm.includes('chrome')) {
    const candidates = [
      path.join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      'chrome',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'chrome';
  }

  if (norm.includes('terminal') || norm.includes('wt') || norm.includes('cmd')) {
    const wtPath = path.join(localApp, 'Microsoft', 'WindowsApps', 'wt.exe');
    if (fs.existsSync(wtPath)) return wtPath;
    return 'cmd.exe';
  }

  if (norm.includes('calc')) return 'calc.exe';
  if (norm.includes('notepad')) return 'notepad.exe';
  if (norm.includes('explorer')) return 'explorer.exe';

  return appName;
}

/**
 * AI Tool: Open Windows applications with optional target path
 */
export const openApplication = tool({
  description:
    'فتح البرامج والتطبيقات على Windows (VS Code, Antigravity, Chrome, Terminal, Calculator, Explorer, Notepad) مع دعم تمرير مسار مجلد أو ملف اختياري. أمثلة: "افتح في اس كود" (app: "VS Code"), "افتح الحاسبة" (app: "Calculator"), "open terminal" (app: "Terminal").',
  inputSchema: z.object({
    app: z
      .enum(['VS Code', 'Antigravity', 'Chrome', 'Terminal', 'Calculator', 'Explorer', 'Notepad'])
      .describe('اسم البرنامج المراد فتحه (VS Code | Antigravity | Chrome | Terminal | Calculator | Explorer | Notepad)'),
    path: z
      .string()
      .optional()
      .describe('مسار مجلد المشروع أو الملف المراد فتحه في التطبيق (اختياري)'),
  }),
  execute: async ({ app, path: targetPath }) => {
    const exe = resolveAppExecutable(app);
    let effectivePath = targetPath ? targetPath.trim() : null;

    // Resolve relative path against workspace root if provided
    if (effectivePath && !path.isAbsolute(effectivePath)) {
      effectivePath = path.resolve(process.cwd(), effectivePath);
    }

    try {
      const args = [];
      if (effectivePath && fs.existsSync(effectivePath)) {
        args.push(effectivePath);
      }

      console.log(`[Tool:openApplication] Spawning ${app} (${exe}) with args:`, args);

      const child = spawn(exe, args, {
        detached: true,
        shell: true,
        stdio: 'ignore',
      });
      child.unref();

      const detailsText = effectivePath ? ` مع المسار: ${effectivePath}` : '';
      return {
        success: true,
        action: 'open_application',
        details: { app, executable: exe, path: effectivePath },
        error: null,
        app,
        executable: exe,
        path: effectivePath,
        message: `✓ تم تشغيل تطبيق ${app} بنجاح${detailsText}.`,
      };
    } catch (err) {
      console.error(`[Tool:openApplication Error]:`, err.message);
      return {
        success: false,
        action: 'open_application',
        details: { app, path: effectivePath },
        error: `فشل فتح تطبيق ${app}: ${err.message}`,
        app,
      };
    }
  },
});

/**
 * AI Tool: Run CLI and Terminal commands with intelligent clipping and background protection
 */
export const runTerminalCommand = tool({
  description:
    'تنفيذ أوامر التيرمنال والـ CLI في مجلد محدد مع مهلة 15 ثانية، واسترجاع مخرجات stdout و stderr لتحليلها واكتشاف الأخطاء. للأوامر المستمرة مثل npm run dev، يفتحها في نافذة مستقلة دون تعليق السيرفر.',
  inputSchema: z.object({
    command: z.string().describe('أمر التيرمنال المراد تنفيذه (مثل: dir, node -v, git status, npm run dev, netstat -ano)'),
    cwd: z.string().optional().describe('مجلد العمل المطلوب لتنفيذ الأمر فيه (افتراضياً مجلد المشروع الحالي)'),
    isLongRunning: z
      .boolean()
      .optional()
      .describe('ضع true إذا كان الأمر يستمر في العمل مثل dev server أو مراقب ملفات'),
  }),
  execute: async ({ command, cwd, isLongRunning }) => {
    const trimmedCommand = (command || '').trim();
    if (!trimmedCommand) {
      return { success: false, exitCode: 1, stdout: '', stderr: 'لم يتم تمرير أي أمر للتنفيذ.' };
    }

    const defaultCwd = path.resolve(process.cwd(), '..'); // project root or cwd
    const effectiveCwd = cwd ? path.resolve(cwd) : (fs.existsSync('d:\\projects\\mediapipe-game') ? 'd:\\projects\\mediapipe-game' : process.cwd());

    // Auto-detect persistent servers or watchers
    const isPersistent =
      isLongRunning ||
      /(?:npm\s+(?:run\s+)?(?:dev|start|watch)|vite|nodemon|next\s+dev)/i.test(trimmedCommand);

    if (isPersistent) {
      try {
        console.log(`[systemCliTools:runTerminalCommand] Launching persistent command: "${trimmedCommand}" in "${effectiveCwd}"`);
        const child = spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `cd /d "${effectiveCwd}" && ${trimmedCommand}`], {
          detached: true,
          shell: true,
          stdio: 'ignore',
        });
        child.unref();

        return {
          success: true,
          exitCode: 0,
          isBackground: true,
          stdout: `تم تشغيل الأمر "${trimmedCommand}" في نافذة Terminal مستقلة في الخلفية داخل المجلد "${effectiveCwd}".`,
          stderr: '',
        };
      } catch (err) {
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: `تعذر تشغيل نافذة التيرمنال المستقلة: ${err.message}`,
        };
      }
    }

    // Execute standard command with strict 15000ms timeout
    return new Promise((resolve) => {
      exec(
        trimmedCommand,
        {
          cwd: effectiveCwd,
          timeout: 15000,
          maxBuffer: 2 * 1024 * 1024, // 2MB
          shell: 'cmd.exe',
        },
        (error, stdout, stderr) => {
          const clipText = (txt) => {
            if (!txt) return '';
            const t = txt.trim();
            return t.length > 2000 ? '...(تم اقتصاص الجزء الأقدم)...\n' + t.slice(-2000) : t;
          };

          const outClean = clipText(stdout);
          const errClean = clipText(stderr);
          const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;

          resolve({
            success: !error || exitCode === 0,
            exitCode,
            stdout: outClean,
            stderr: errClean,
            cwd: effectiveCwd,
          });
        }
      );
    });
  },
});

/**
 * AI Tool: Inspect or terminate processes (port checking, process listing, killing)
 */
export const listOrKillProcess = tool({
  description:
    'فحص العمليات الجارية على النظام (معرفة ما يعمل على بورت معين عبر netstat أو اسم البرنامج) أو إغلاق تطبيق/عملية عند الطلب الصريح.',
  inputSchema: z.object({
    action: z
      .enum(['list', 'find_port', 'kill'])
      .describe('نوع الإجراء: list لعرض العمليات، find_port لمعرفة ما يعمل على بورت معين، kill لإغلاق عملية'),
    port: z.number().optional().describe('رقم المنفذ (البورت) للبحث عنه عند اختيار find_port (مثل: 3000, 5173)'),
    processName: z.string().optional().describe('اسم البرنامج مثل node.exe أو Code.exe للبحث أو الإغلاق'),
    pid: z.number().optional().describe('معرف العملية (PID) لإنهائها بدقة عند اختيار kill'),
    confirmed: z
      .boolean()
      .optional()
      .default(false)
      .describe('يجب أن تكون true فقط بعد موافقة المستخدم الصريحة على قتل/إنهاء العملية kill'),
  }),
  execute: async ({ action, port, processName, pid, confirmed = false }) => {
    if (action === 'find_port') {
      if (!port) {
        return { success: false, error: 'يجب تحديد رقم البورت (port) للبحث عنه.' };
      }
      return new Promise((resolve) => {
        exec(`netstat -ano | findstr :${port}`, { shell: 'cmd.exe', timeout: 5000 }, (err, stdout) => {
          if (err || !stdout.trim()) {
            resolve({
              success: true,
              port,
              found: false,
              message: `لا توجد أي عملية تستمع حالياً على المنفذ (Port ${port}).`,
            });
            return;
          }
          const lines = stdout.trim().split('\n').map((l) => l.trim()).slice(0, 10);
          resolve({
            success: true,
            port,
            found: true,
            rawOutput: lines.join('\n'),
            message: `تم العثور على العمليات التالية على المنفذ ${port}:\n${lines.join('\n')}`,
          });
        });
      });
    }

    if (action === 'kill') {
      const targetDesc = pid ? `PID ${pid}` : processName || 'عملية غير محددة';
      if (!confirmed) {
        console.warn(`[systemCliTools:listOrKillProcess] Blocked unconfirmed process kill: ${targetDesc}`);
        return {
          success: false,
          status: 'awaiting_confirmation',
          requiresConfirmation: true,
          action: 'kill',
          target: targetDesc,
          pendingAction: {
            id: `proc_kill_${Date.now()}`,
            action: 'kill',
            title: `تأكيد إنهاء العملية: ${targetDesc}`,
            reason: `إنهاء العملية (${targetDesc}) بالإجبار قد يؤدي لفقدان بيانات غير محفوظة`,
          },
          message: `⚠️ تنبيه: إنهاء العملية (${targetDesc}) يتطلب تأكيدك الصريح أولاً.`,
        };
      }

      let killCmd = '';
      if (pid) {
        killCmd = `taskkill /PID ${pid} /F`;
      } else if (processName) {
        killCmd = `taskkill /IM "${processName}" /F`;
      } else {
        return { success: false, error: 'يجب تمرير معرف العملية (pid) أو اسم البرنامج (processName) لإنهائه.' };
      }

      return new Promise((resolve) => {
        exec(killCmd, { shell: 'cmd.exe', timeout: 5000 }, (err, stdout, stderr) => {
          if (err) {
            resolve({
              success: false,
              error: stderr.trim() || err.message,
              message: `فشل إنهاء العملية: ${stderr.trim() || err.message}`,
            });
          } else {
            resolve({
              success: true,
              message: `✓ تم إنهاء العملية بنجاح (${pid ? `PID: ${pid}` : processName}).`,
              details: stdout.trim(),
            });
          }
        });
      });
    }

    // Default: list processes
    return new Promise((resolve) => {
      const filter = processName ? ` | findstr /i "${processName}"` : '';
      exec(`tasklist /FO TABLE /NH${filter}`, { shell: 'cmd.exe', timeout: 7000 }, (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve({ success: false, error: 'تعذر جلب قائمة العمليات الجارية.' });
          return;
        }
        const lines = stdout.trim().split('\n').map((l) => l.trim()).slice(0, 15);
        resolve({
          success: true,
          count: lines.length,
          processes: lines.join('\n'),
        });
      });
    });
  },
});
