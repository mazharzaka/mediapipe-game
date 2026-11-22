import { exec, spawn } from 'child_process';
import os from 'os';

// Whitelist of supported and safe applications
const ALLOWED_APPS = {
  vscode: {
    name: 'Visual Studio Code',
    command: 'code',
  },
  chrome: {
    name: 'Google Chrome',
    command: 'start chrome',
  },
  notepad: {
    name: 'Notepad',
    command: 'notepad',
  },
  calculator: {
    name: 'Calculator',
    command: 'calc',
  },
};

/**
 * Open a website URL safely in the default system browser.
 */
export function openWebsite(rawUrl) {
  return new Promise((resolve, reject) => {
    let cleanUrl = (rawUrl || '').trim();
    if (!cleanUrl) {
      return reject(new Error('رابط الموقع فارغ'));
    }

    // Add protocol if missing
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = `https://${cleanUrl}`;
    }

    try {
      const parsed = new URL(cleanUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return reject(new Error('بروتوكول الرابط غير مسموح'));
      }
    } catch {
      return reject(new Error('رابط الموقع غير صالح'));
    }

    // Escape quotes to prevent injection
    const escapedUrl = cleanUrl.replace(/"/g, '%22');
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? `start "" "${escapedUrl}"` : `open "${escapedUrl}"`;

    exec(cmd, (err) => {
      if (err) {
        console.error('[systemService] openWebsite error:', err);
        return reject(new Error(`فشل فتح الموقع: ${err.message}`));
      }
      resolve({ success: true, url: cleanUrl, message: `تم فتح الموقع بنجاح: ${cleanUrl}` });
    });
  });
}

/**
 * Open a pre-approved desktop application safely.
 */
export function openApp(appName) {
  return new Promise((resolve, reject) => {
    const key = (appName || '').toLowerCase().trim();
    const appConfig = ALLOWED_APPS[key];

    if (!appConfig) {
      const available = Object.keys(ALLOWED_APPS).join(', ');
      return reject(new Error(`التطبيق غير مدعوم. التطبيقات المتاحة هي: ${available}`));
    }

    exec(appConfig.command, (err) => {
      if (err) {
        console.error(`[systemService] openApp (${key}) error:`, err);
        return reject(new Error(`فشل فتح تطبيق ${appConfig.name}: ${err.message}`));
      }
      resolve({ success: true, app: key, appName: appConfig.name, message: `تم تشغيل ${appConfig.name} بنجاح` });
    });
  });
}

/**
 * Gather real-time system diagnostic status via Node's OS module.
 */
export function getSystemStatus() {
  try {
    const totalMemBytes = os.totalmem();
    const freeMemBytes = os.freemem();
    const usedMemBytes = totalMemBytes - freeMemBytes;
    const memUsagePercent = ((usedMemBytes / totalMemBytes) * 100).toFixed(1);

    const cpus = os.cpus() || [];
    const cpuModel = cpus[0]?.model ? cpus[0].model.trim() : 'Unknown CPU';
    const cpuCores = cpus.length;

    const uptimeSeconds = os.uptime();
    const uptimeHours = Math.floor(uptimeSeconds / 3600);
    const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);

    // Collect active IPv4 network addresses
    const networkInterfaces = os.networkInterfaces();
    const localIps = [];
    for (const name of Object.keys(networkInterfaces)) {
      for (const net of networkInterfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          localIps.push({ iface: name, ip: net.address });
        }
      }
    }

    return {
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      hostname: os.hostname(),
      memory: {
        total: `${(totalMemBytes / (1024 ** 3)).toFixed(2)} GB`,
        free: `${(freeMemBytes / (1024 ** 3)).toFixed(2)} GB`,
        usedPercent: `${memUsagePercent}%`,
      },
      cpu: {
        model: cpuModel,
        cores: cpuCores,
      },
      uptime: `${uptimeHours} ساعة و ${uptimeMinutes} دقيقة`,
      localIps,
    };
  } catch (err) {
    console.error('[systemService] getSystemStatus error:', err);
    throw new Error(`فشل قراءة حالة النظام: ${err.message}`);
  }
}

/**
 * Execute sensitive power actions (Human-in-the-Loop confirmed only).
 */
export function executePowerAction(action) {
  return new Promise((resolve, reject) => {
    const act = (action || '').toLowerCase().trim();
    let cmd = '';

    if (act === 'lock') {
      // Windows lock workstation
      cmd = 'rundll32.exe user32.dll,LockWorkStation';
    } else if (act === 'sleep') {
      // Windows sleep/suspend
      cmd = 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0';
    } else if (act === 'shutdown') {
      // Windows shutdown with 15s timer allowing cancel
      cmd = 'shutdown /s /t 15 /c "Shutting down requested via AI Assistive Agent"';
    } else {
      return reject(new Error(`أمر طاقة غير معروف: ${action}. المسموح: lock, sleep, shutdown`));
    }

    exec(cmd, (err) => {
      if (err) {
        console.error(`[systemService] executePowerAction (${act}) error:`, err);
        return reject(new Error(`فشل تنفيذ أمر الطاقة ${act}: ${err.message}`));
      }
      resolve({
        success: true,
        action: act,
        message: `تم تنفيذ أمر الطاقة (${act}) بنجاح`,
      });
    });
  });
}

/**
 * Toggle Windows mouse cursor size (96px for Big Cursor, 32px for normal)
 * Applies immediately via SPI_SETCURSORSIZE (0x2029) and SPI_SETCURSORS (0x0057) without reboot or logout.
 */
export function toggleBigCursor(enable = true) {
  return new Promise((resolve, reject) => {
    const size = enable ? 96 : 32;
    const psScript = `
      Set-ItemProperty -Path 'HKCU:\\Control Panel\\Cursors' -Name 'CursorBaseSize' -Value ${size} -Type DWord;
      $sig = '[DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, IntPtr c, uint d);';
      $w = Add-Type -MemberDefinition $sig -Name 'CUtil${Date.now()}' -Namespace 'W32' -PassThru;
      $w::SystemParametersInfo(0x2029, 0, [IntPtr]${size}, 3);
      $w::SystemParametersInfo(0x0057, 0, [IntPtr]::Zero, 3);
    `;

    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript]);
    let stderr = '';

    ps.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    ps.on('close', (code) => {
      if (code !== 0) {
        console.error('[systemService] toggleBigCursor error:', stderr);
        return reject(new Error(stderr || `PowerShell exited with code ${code}`));
      }
      resolve({
        success: true,
        enabled: enable,
        size,
        message: enable ? 'تم تفعيل وضع الماوس الكبير (96px)' : 'تم استعادة حجم الماوس الطبيعي (32px)',
      });
    });
  });
}
