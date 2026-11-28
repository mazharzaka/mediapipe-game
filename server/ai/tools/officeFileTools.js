import { tool } from 'ai';
import { z } from 'zod';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import crypto from 'crypto';

/**
 * Resolve a file/folder path: if relative, resolve against user's Desktop directory.
 */
function resolveDesktopOrPath(targetPath) {
  const raw = (targetPath || '').trim();
  if (!raw) return path.join(os.homedir(), 'Desktop');
  if (path.isAbsolute(raw)) return raw;
  return path.join(os.homedir(), 'Desktop', raw);
}

/**
 * AI Tool: Read, create, or update a specific cell in an Excel (.xlsx) workbook
 */
export const updateExcelCell = tool({
  description:
    'قراءة أو إنشاء أو تعديل خلية معينة في ملف إكسيل (.xlsx) على سطح المكتب (Desktop) أو مسار محدد (مثل تعديل خلية A1 إلى 500 في Book1.xlsx) مع إمكانية فتح الملف.',
  inputSchema: z.object({
    fileName: z
      .string()
      .describe('اسم ملف الإكسيل (مثل Book1.xlsx أو _test_stage6.xlsx) أو مساره الكامل'),
    cell: z
      .string()
      .describe('عنوان الخلية المطلوب تعديلها (مثل A1 أو B3)'),
    value: z
      .union([z.string(), z.number()])
      .describe('القيمة المراد كتابتها في الخلية (رقم أو نص مثل 500)'),
    sheetName: z
      .string()
      .optional()
      .describe('اسم ورقة العمل (اختياري، الافتراضي أول ورقة أو Sheet1)'),
    openAfterSave: z
      .boolean()
      .optional()
      .default(false)
      .describe('ضع true إذا طلب المستخدم فتح ملف الإكسيل في البرنامج بعد الحفظ'),
  }),
  execute: async ({ fileName, cell, value, sheetName, openAfterSave = false }) => {
    try {
      let cleanFileName = (fileName || 'Book1.xlsx').trim();
      if (!cleanFileName.toLowerCase().endsWith('.xlsx')) {
        cleanFileName += '.xlsx';
      }

      const resolvedPath = resolveDesktopOrPath(cleanFileName);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const cellRef = (cell || 'A1').trim().toUpperCase();

      // Convert numeric strings cleanly to numbers
      let parsedValue = value;
      if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value.trim()))) {
        parsedValue = Number(value.trim());
      }

      let wb;
      let fileCreated = false;
      if (fs.existsSync(resolvedPath)) {
        wb = XLSX.readFile(resolvedPath);
      } else {
        wb = XLSX.utils.book_new();
        fileCreated = true;
      }

      let targetSheetName = sheetName?.trim() || wb.SheetNames[0] || 'Sheet1';
      let ws = wb.Sheets[targetSheetName];
      if (!ws) {
        ws = XLSX.utils.aoa_to_sheet([[]]);
        XLSX.utils.book_append_sheet(wb, ws, targetSheetName);
      }

      // Write value into the specified cell
      XLSX.utils.sheet_add_aoa(ws, [[parsedValue]], { origin: cellRef });

      XLSX.writeFile(wb, resolvedPath);

      if (openAfterSave) {
        try {
          const child = spawn('cmd.exe', ['/c', 'start', '', resolvedPath], {
            detached: true,
            shell: false,
            stdio: 'ignore',
          });
          child.unref();
        } catch (_) {}
      }

      return {
        success: true,
        fileCreated,
        filePath: resolvedPath,
        sheet: targetSheetName,
        cell: cellRef,
        value: parsedValue,
        message: `✓ تم ${fileCreated ? 'إنشاء وحفظ' : 'تحديث'} خلية ${cellRef} بقيمة (${parsedValue}) في الملف "${path.basename(resolvedPath)}" بنجاح.`,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `فشل تعديل ملف الإكسيل: ${err.message}`,
      };
    }
  },
});

/**
 * AI Tool: File & Desktop Operations with Human-in-the-Loop protection for deletion
 */
export const fileOperation = tool({
  description:
    'التعامل مع الملفات والمجلدات على سطح المكتب (open لفتح ملف/مجلد، list_desktop لعرض ملفات الديسكتوب، create_folder لإنشاء مجلد، delete لحذف ملف مع طلب تأكيد المستخدم أولاً).',
  inputSchema: z.object({
    action: z
      .enum(['open', 'list_desktop', 'create_folder', 'delete'])
      .describe('نوع العملية على الملفات'),
    target: z
      .string()
      .optional()
      .describe('اسم الملف أو المجلد على الديسكتوب أو مساره الكامل'),
  }),
  execute: async ({ action, target }, { serverConfirmed = false } = {}) => {
    const desktopDir = path.join(os.homedir(), 'Desktop');

    if (action === 'list_desktop') {
      try {
        const entries = fs.readdirSync(desktopDir);
        return {
          success: true,
          directory: desktopDir,
          count: entries.length,
          files: entries.slice(0, 50),
          message: `يوجد ${entries.length} عنصر على سطح المكتب.`,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    if (!target || !target.trim()) {
      return { success: false, error: 'يجب تحديد اسم الملف أو المجلد المستهدف (target).' };
    }

    const resolvedPath = resolveDesktopOrPath(target);

    if (action === 'open') {
      if (!fs.existsSync(resolvedPath)) {
        return {
          success: false,
          path: resolvedPath,
          message: `الملف أو المجلد غير موجود: ${resolvedPath}`,
        };
      }
      try {
        const child = spawn('cmd.exe', ['/c', 'start', '', resolvedPath], {
          detached: true,
          shell: false,
          stdio: 'ignore',
        });
        child.unref();
        return {
          success: true,
          action: 'open',
          path: resolvedPath,
          message: `✓ تم فتح "${path.basename(resolvedPath)}" بنجاح.`,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    if (action === 'create_folder') {
      try {
        fs.mkdirSync(resolvedPath, { recursive: true });
        return {
          success: true,
          action: 'create_folder',
          path: resolvedPath,
          message: `✓ تم إنشاء المجلد "${path.basename(resolvedPath)}" بنجاح.`,
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    if (action === 'delete') {
      if (serverConfirmed !== true) {
        console.warn(`[officeFileTools:fileOperation] Blocked unconfirmed file delete: ${resolvedPath}`);
        const actionId = crypto.randomUUID();
        return {
          success: false,
          status: 'awaiting_confirmation',
          requiresConfirmation: true,
          action: 'delete',
          target: resolvedPath,
          pendingAction: {
            id: actionId,
            toolName: 'fileOperation',
            realAction: 'delete',
            action: 'delete',
            args: { action, target },
            title: `تأكيد حذف الملف: ${path.basename(resolvedPath)}`,
            reason: `حذف الملف أو المجلد (${resolvedPath}) إجراء حساس لا يمكن التراجع عنه`,
          },
          message: `⚠️ تنبيه: حذف "${path.basename(resolvedPath)}" يتطلب تأكيدك الصريح عبر زر الموافقة أولاً.`,
        };
      }

      try {
        if (!fs.existsSync(resolvedPath)) {
          return {
            success: false,
            verified: false,
            message: `الملف المطلوب حذفه غير موجود: ${resolvedPath}`,
          };
        }
        fs.rmSync(resolvedPath, { recursive: true, force: true });
        if (fs.existsSync(resolvedPath)) {
          return {
            success: false,
            verified: false,
            error: `فشل التحقق من حذف "${path.basename(resolvedPath)}" من القرص.`,
            message: `فشل التحقق من حذف "${path.basename(resolvedPath)}" من القرص.`,
          };
        }
        return {
          success: true,
          verified: true,
          action: 'delete',
          path: resolvedPath,
          message: `✓ تم حذف "${path.basename(resolvedPath)}" بنجاح.`,
        };
      } catch (err) {
        return { success: false, verified: false, error: err.message };
      }
    }

    return { success: false, error: `عملية غير معروفة: ${action}` };
  },
});
