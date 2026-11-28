import { tool } from 'ai';
import { z } from 'zod';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

// Strictly multimodal vision models (NEVER text-only models like Groq)
const MULTIMODAL_VISION_MODELS = [
  'gemini-3.1-flash-lite',
  'gemma-4-31b-it',
  'gemini-3-flash-preview',
];

/**
 * AI Tool: Capture a live screenshot of Windows primary display and analyze it visually via Multimodal Vision
 */
export const captureAndAnalyzeScreen = tool({
  description:
    'التقاط لقطة شاشة حقيقية (Screenshot) للشاشة الحالية وتحليلها بصرياً عبر موديل رؤية (Multimodal Vision). استخدم هذه الأداة دائماً عند أي سؤال عما يظهر على الشاشة أو أي إشارة مكانية/بصرية مثل: "إنت شايف إيه دلوقتي"، "بص على الشاشة"، "اقرأ الشاشة"، "أول فيديو على اليمين"، "اضغط على التاني على الشمال". Examples: "what do you see on screen", "first video on the right".',
  inputSchema: z.object({
    question: z
      .string()
      .optional()
      .default('صف باختصار ووضوح ما يظهر حالياً على شاشة الكمبيوتر باللغة العربية.')
      .describe('سؤال المستخدم أو العنصر المكاني المطلوب تحديده على الشاشة الحالية (مثال: "إنت شايف إيه دلوقتي" أو "حدد أول فيديو على اليمين")'),
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

    console.log(`[Tool:captureAndAnalyzeScreen] Capturing live Windows screenshot for question: "${question || 'describe screen'}"`);

    try {
      // 1. Capture screen to temporary PNG via direct execFile powershell.exe (15s timeout + 1 retry on cold start)
      const captureOnce = () =>
        new Promise((resolve, reject) => {
          execFile(
            'powershell.exe',
            ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psScript],
            { timeout: 15000 },
            (err, stdout, stderr) => {
              if (err) {
                return reject(new Error(stderr?.trim() || err.message));
              }
              resolve();
            }
          );
        });

      try {
        await captureOnce();
      } catch (firstCapErr) {
        console.warn('[Tool:captureAndAnalyzeScreen] First screenshot capture attempt failed, retrying once:', firstCapErr.message);
        await captureOnce();
      }

      if (!fs.existsSync(tempFilePath)) {
        throw new Error('لم يتم إنشاء ملف لقطة الشاشة المؤقت.');
      }

      // 2. Read PNG buffer
      const imageBuffer = fs.readFileSync(tempFilePath);
      console.log(`[Tool:captureAndAnalyzeScreen] Screenshot captured (${imageBuffer.length} bytes). Sending to Multimodal Vision...`);

      // 3. Analyze using Multimodal Vision models ONLY (15s timeout each)
      const apiKey = (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
      if (!apiKey) {
        throw new Error('مفتاح Gemini API غير موجود في ملف .env');
      }

      const google = createGoogleGenerativeAI({ apiKey });
      const userPrompt = (question || 'صف ما تراه على الشاشة الحالية بإيجاز واضح باللغة العربية.').trim();

      let text = '';
      let usedModel = MULTIMODAL_VISION_MODELS[0];
      let lastVisionErr = null;

      for (const visionModel of MULTIMODAL_VISION_MODELS) {
        try {
          console.log(`[Tool:captureAndAnalyzeScreen] Calling multimodal model: ${visionModel} (timeout 15s)`);
          const res = await generateText({
            model: google(visionModel),
            abortSignal: AbortSignal.timeout(15000),
            maxRetries: 0,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: userPrompt },
                  { type: 'file', data: imageBuffer, mediaType: 'image/png' },
                ],
              },
            ],
          });
          text = res.text;
          usedModel = visionModel;
          break;
        } catch (visionErr) {
          lastVisionErr = visionErr;
          console.warn(`[Tool:captureAndAnalyzeScreen] Model ${visionModel} failed: ${visionErr.message}`);
          if (/429|503|quota|rate|exhausted|timeout|aborted|overloaded|high demand/i.test(visionErr.message || '')) {
            continue;
          }
          throw visionErr;
        }
      }

      if (!text && lastVisionErr) {
        throw lastVisionErr;
      }

      console.log(`[Tool:captureAndAnalyzeScreen] Success via ${usedModel} (${text.length} chars)`);
      return {
        success: true,
        action: 'capture_and_analyze_screen',
        details: { model: usedModel, screenshotBytes: imageBuffer.length, question: userPrompt },
        error: null,
        model: usedModel,
        analysis: text,
        message: text,
      };
    } catch (err) {
      console.error('[Tool:captureAndAnalyzeScreen Error]:', err.message);
      return {
        success: false,
        action: 'capture_and_analyze_screen',
        details: { question },
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
