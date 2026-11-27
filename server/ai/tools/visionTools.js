import { tool } from 'ai';
import { z } from 'zod';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * AI Tool: Capture a live screenshot of Windows primary display and analyze it visually via Gemini 3.1 Flash-Lite
 */
export const captureAndAnalyzeScreen = tool({
  description:
    'التقاط صورة لحظية لشاشة الكمبيوتر الحالية وتحليلها بصرياً باستخدام الذكاء الاصطناعي للإجابة عن سؤال المستخدم عما يظهر على الشاشة (مثل قراءة خطأ، معرفة البرنامج المفتوح، أو وصف المحتوى).',
  inputSchema: z.object({
    question: z
      .string()
      .optional()
      .default('صف باختصار ووضوح ما يظهر حالياً على شاشة الكمبيوتر باللغة العربية.')
      .describe('سؤال المستخدم حول محتوى الشاشة الحالية'),
  }),
  execute: async ({ question }) => {
    const tempFilePath = path.join(os.tmpdir(), `screen_capture_${Date.now()}.png`);
    const escapedPath = tempFilePath.replace(/'/g, "''");

    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
      '$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;',
      '$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;',
      '$graphics = [System.Drawing.Graphics]::FromImage($bmp);',
      '$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);',
      `$bmp.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png);`,
      '$graphics.Dispose();',
      '$bmp.Dispose();',
    ].join(' ');

    try {
      // 1. Capture screen to temporary PNG
      await new Promise((resolve, reject) => {
        exec(
          `powershell -NoProfile -Command "${psScript}"`,
          { shell: 'cmd.exe', timeout: 8000 },
          (err, stdout, stderr) => {
            if (err) {
              return reject(new Error(stderr?.trim() || err.message));
            }
            resolve();
          }
        );
      });

      if (!fs.existsSync(tempFilePath)) {
        throw new Error('لم يتم إنشاء ملف لقطة الشاشة المؤقت.');
      }

      // 2. Read PNG buffer
      const imageBuffer = fs.readFileSync(tempFilePath);

      // 3. Analyze using Gemini 3.1 Flash-Lite multimodal
      const apiKey = (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
      if (!apiKey) {
        throw new Error('مفتاح Gemini API غير موجود في ملف .env');
      }

      const google = createGoogleGenerativeAI({ apiKey });
      const userPrompt = (question || 'صف ما تراه على الشاشة الحالية بإيجاز واضح باللغة العربية.').trim();

      let text = '';
      try {
        const res = await generateText({
          model: google('gemini-3.1-flash-lite'),
          abortSignal: AbortSignal.timeout(12000),
          maxRetries: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: userPrompt },
                { type: 'image', image: imageBuffer },
              ],
            },
          ],
        });
        text = res.text;
      } catch (visionErr) {
        // Fallback to gemma-4-31b-it multimodal if gemini-3.1-flash-lite hits 15 RPM rate limit
        if (/429|quota|rate|exhausted|timeout|aborted/i.test(visionErr.message || '')) {
          const fallbackRes = await generateText({
            model: google('gemma-4-31b-it'),
            abortSignal: AbortSignal.timeout(14000),
            maxRetries: 0,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: userPrompt },
                  { type: 'image', image: imageBuffer },
                ],
              },
            ],
          });
          text = fallbackRes.text;
        } else {
          throw visionErr;
        }
      }

      return {
        success: true,
        model: 'gemini-3.1-flash-lite',
        analysis: text,
        message: text,
      };
    } catch (err) {
      console.error('[visionTools:captureAndAnalyzeScreen Error]:', err.message);
      return {
        success: false,
        error: err.message,
        message: `تعذر التقاط أو تحليل الشاشة: ${err.message}`,
      };
    } finally {
      // Always clean up temporary screenshot file
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (_) {}
    }
  },
});
