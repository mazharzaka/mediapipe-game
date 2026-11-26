import fs from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { generateObjectWithFallback } from './llmClient.js';

// In-Memory Cache for Desktop files (30 seconds TTL)
let cachedDesktopFiles = null;
let lastDesktopCacheTime = 0;
const CACHE_TTL_MS = 30000;

/**
 * Reads user's Desktop directory to pass file names as context for correcting phonetic filenames.
 */
export function getDesktopFilesContext() {
  const now = Date.now();
  if (cachedDesktopFiles && now - lastDesktopCacheTime < CACHE_TTL_MS) {
    return cachedDesktopFiles;
  }

  try {
    const desktopPath = path.join(os.homedir(), 'Desktop');
    if (fs.existsSync(desktopPath)) {
      const files = fs.readdirSync(desktopPath);
      // Filter out hidden, system, and temporary files
      const visible = files
        .filter((f) => !f.startsWith('.') && !f.startsWith('~$') && f.toLowerCase() !== 'desktop.ini')
        .slice(0, 50);
      cachedDesktopFiles = visible;
      lastDesktopCacheTime = now;
      return cachedDesktopFiles;
    }
  } catch (err) {
    console.warn('[Router:getDesktopFilesContext] Failed to read desktop files:', err.message);
  }

  cachedDesktopFiles = [];
  lastDesktopCacheTime = now;
  return cachedDesktopFiles;
}

// Strict Zod Schema for Command Routing & Semantic Filtering
export const routeOutputSchema = z.object({
  cleanText: z
    .string()
    .describe(
      'النص النهائي المصحح برمجياً: تم تصحيح الأخطاء الصوتية، كتابة المصطلحات الإنجليزية بالإنجليزية الصحيحة (VS Code, Antigravity, npm run dev, Terminal, LinkedIn, Incognito, Book1.xlsx, A1)، وتحويل الأرقام المنطوقة إلى أرقام مجردة (500 بدلاً من خمسمية)'
    ),
  domain: z
    .enum(['youtube', 'system_cli', 'browser', 'file_office', 'power', 'vision', 'chat'])
    .describe('المجال الوظيفي الدقيق للأمر'),
  complexity: z
    .enum(['simple', 'complex'])
    .describe(
      'مستوى الصعوبة: simple لأمر مباشر من خطوة واحدة واضحة، complex لأمر مركب من خطوتين أو أكثر أو يتطلب تعديل بيانات أو فحص مخرجات واتخاذ قرار'
    ),
  requiresConfirmation: z
    .boolean()
    .describe(
      'true فقط للأوامر الحساسة أو غير القابلة للتراجع (إيقاف التشغيل Shutdown، إعادة التشغيل Restart، حذف ملفات، إرسال إيميل)، و false لباقي الأوامر'
    ),
  reasoning: z
    .string()
    .describe('سبب موجز جداً (5 إلى 8 كلمات باللغة العربية) يوضح اختيار المجال ومستوى الصعوبة'),
});

const ROUTER_SYSTEM_PROMPT = `أنت "المصفّي والموجّه الدلالي الذكي" (Semantic Router & Normalizer) لنظام التحكم المساعد في الحاسوب بالعامية المصرية.
مهمتك:
1. تحليل الأمر الصوتي الخام للمستخدم (الذي قد يحتوي على أخطاء تفريغ صوتي، أو كلمات إنجليزية كُتبت بحروف عربية، أو أرقام منطوقة).
2. تنظيف وتصحيح النص (cleanText):
   - تحويل المصطلحات الإنجليزية إلى شكلها الصحيح:
     * "في اس كود" / "فيجوال استوديو" ◄ "VS Code"
     * "أنتجافتي" / "انتي جرافيتي" / "أنتي جرافتي" ◄ "Antigravity"
     * "ام بي ام ران ديف" / "ران ديف" / "ان بي ام" ◄ "npm run dev"
     * "التيرميل" / "التيرمينال" / "ترمنال" ◄ "Terminal"
     * "لينكد إن" ◄ "LinkedIn"
     * "فيسبوك" ◄ "Facebook"
     * "متخفي" / "وضع التصفح الخفي" ◄ "Incognito"
     * "بوك 1" / "بوك وان" ◄ "Book1.xlsx" (خاصة إذا كان متعلقاً بالإكسيل أو موجوداً على الديسكتوب)
     * "اي 1" / "خلية اي 1" ◄ "A1"
     * تحويل الأرقام المنطوقة لأرقام مجردة: "خمسمية" ◄ "500"، "مية" ◄ "100"، "ألفين ونص" ◄ "2500"
   - الاستعانة بقائمة ملفات الديسكتوب الممررة لمطابقة اسم الملف المذكور بأقرب ملف حقيقي موجود.

3. تصنيف المجال (domain) بدقة إلى واحد من المجالات السبعة:
   - "youtube": تشغيل وبحث الفيديوهات والأغاني والماتشات، والتحكم في الصوت/الملء أثناء المشاهدة.
   - "system_cli": أوامر التيرمنال، تشغيل السيرفرات والأكواد، برامج المطورين، فحص أخطاء logs/terminal.
   - "browser": فتح المواقع والروابط، التصفح، إغلاق وفتح التابات، المتصفح الخفي Incognito.
   - "file_office": التعامل مع ملفات الإكسيل والأوفيس، تعديل الخلايا، قراءة وكتابة الجداول والمستندات.
   - "power": أوامر الطاقة (Lock, Sleep, Restart, Shutdown).
   - "vision": عدسة ويندوز المكبرة (Windows Magnifier)، تكبير وتصغير الشاشة، قراءة وفحص محتوى الشاشة بصرياً.
   - "chat": استفسارات عامة، دردشة، تحية، أسئلة لا تتطلب تنفيذ أوامر على الجهاز.

4. تحديد مستوى الصعوبة (complexity):
   - "simple": أمر مباشر من خطوة واحدة واضحة (مثل تشغيل فيديو، رفع/خفض الصوت، فتح برنامج، إغلاق تاب، عمل Lock، إيقاف التشغيل).
   - "complex": أمر مركب من خطوتين أو أكثر (مثل فتح موقع ثم قفل تاب ثم ملء الشاشة)، أو يتطلب تعديل بيانات داخل ملف (تعديل خلية في إكسيل)، أو قراءة مخرجات تيرمنال/شاشة واتخاذ قرار بناءً عليها.

5. شرط التأكيد (requiresConfirmation):
   - يكون true فقط للأوامر الخطيرة غير القابلة للتراجع: إيقاف التشغيل الكامل (Shutdown)، إعادة التشغيل (Restart)، حذف ملفات، أو إرسال إيميل.
   - يكون false لأي أمر آخر (بما فيها Lock و Sleep وفتح/إغلاق البرامج والتابات).

أمثلة مرجعية (Few-Shot Examples):
- الإدخال: "افتح شيت الاكسيل اللي اسمه بوك 1 وخلي خلية اي 1 خمسمية"
  cleanText: "افتح شيت الإكسيل Book1.xlsx وعدل خلية A1 إلى 500"
  domain: "file_office"
  complexity: "complex"
  requiresConfirmation: false
  reasoning: "تعديل خلية بملف إكسيل مركب من خطوتين"

- الإدخال: "بقول لك افتح أنتجافتي وشغل ام بي ام ران ديف من التيرميل"
  cleanText: "افتح Antigravity وشغل npm run dev في Terminal"
  domain: "system_cli"
  complexity: "complex"
  requiresConfirmation: false
  reasoning: "فتح تطبيق وتنفيذ أمر تيرمنال مركب"

- الإدخال: "شغل ملخص ماتش الأهلي والزمالك نهائي القرن بتعليق عصام الشوالي"
  cleanText: "شغل ملخص ماتش الأهلي والزمالك نهائي القرن بتعليق عصام الشوالي"
  domain: "youtube"
  complexity: "simple"
  requiresConfirmation: false
  reasoning: "تشغيل فيديو يوتيوب مباشر خطوة واحدة"

- الإدخال: "افتح في اس كود"
  cleanText: "افتح VS Code"
  domain: "system_cli"
  complexity: "simple"
  requiresConfirmation: false
  reasoning: "تشغيل تطبيق برمجي مباشر خطوة واحدة"

- الإدخال: "اقفل الجهاز خالص"
  cleanText: "إيقاف تشغيل الكمبيوتر بالكامل (Shutdown)"
  domain: "power"
  complexity: "simple"
  requiresConfirmation: true
  reasoning: "إيقاف تشغيل حاسوب أمر طاقة حساس"

- الإدخال: "لو السيرفر مطلع إيرور في التيرمنال اقرأه وقولي السبب"
  cleanText: "افحص مخرجات Terminal وإذا كان هناك خطأ اشرح سببه"
  domain: "system_cli"
  complexity: "complex"
  requiresConfirmation: false
  reasoning: "قراءة مخرجات وفحص أخطاء السيرفر البرمجي"

- الإدخال: "افتح لينكد إن واقفل فيسبوك واعمل ملء الشاشة"
  cleanText: "افتح LinkedIn واقفل Facebook واعمل ملء الشاشة"
  domain: "browser"
  complexity: "complex"
  requiresConfirmation: false
  reasoning: "إجراءات تصفح متعددة الخطوات في المتصفح"

- الإدخال: "اعمل لوك للشاشة بعد اذنك"
  cleanText: "قفل الشاشة (Lock)"
  domain: "power"
  complexity: "simple"
  requiresConfirmation: false
  reasoning: "قفل شاشة بسيط قابل للتراجع فورياً"`;

/**
 * Routes a raw voice transcript through the fast semantic classifier (Gemini 3.1 Flash-Lite),
 * correcting phonetic text, assigning domain, complexity, confirmation need, and target execution model.
 */
export async function routeCommand(rawTranscript) {
  const rawText = (rawTranscript || '').trim();
  if (!rawText) {
    return {
      rawText: '',
      cleanText: '',
      domain: 'chat',
      complexity: 'simple',
      requiresConfirmation: false,
      targetModel: 'gemini-3.1-flash-lite',
      maxSteps: 1,
      reasoning: 'نص فارغ بدون محتوى',
      meta: null,
    };
  }

  const desktopFiles = getDesktopFilesContext();
  const promptContent = [
    `الطلب الصوتي الخام للمستخدم:`,
    `"${rawText}"`,
    ``,
    `ملفات سطح المكتب (Desktop) المتاحة حالياً على جهاز المستخدم:`,
    desktopFiles.length > 0 ? desktopFiles.map((f) => `- ${f}`).join('\n') : '(لا توجد ملفات حالياً على Desktop)',
  ].join('\n');

  try {
    const { result, meta } = await generateObjectWithFallback({
      prompt: promptContent,
      system: ROUTER_SYSTEM_PROMPT,
      schema: routeOutputSchema,
      temperature: 0,
      primaryModel: 'gemini-3.1-flash-lite',
      timeoutMs: 6000,
    });

    const output = result.object;
    const isComplex = output.complexity === 'complex';

    // Model & Step budget assignment based on complexity:
    // Simple: fast lightweight model (gemini-3.1-flash-lite), 1 step budget
    // Complex: heavier reasoning model (gemma-4-31b-it), 5 steps budget
    const targetModel = isComplex ? 'gemma-4-31b-it' : 'gemini-3.1-flash-lite';
    const maxSteps = isComplex ? 5 : 1;

    return {
      rawText,
      cleanText: output.cleanText,
      domain: output.domain,
      complexity: output.complexity,
      requiresConfirmation: output.requiresConfirmation,
      targetModel,
      maxSteps,
      reasoning: output.reasoning,
      meta,
    };
  } catch (err) {
    console.error('[Router:routeCommand Error]:', err.message);
    // Robust fallback if LLM routing fails: treat as simple chat or direct text
    return {
      rawText,
      cleanText: rawText,
      domain: 'chat',
      complexity: 'simple',
      requiresConfirmation: false,
      targetModel: 'gemini-3.1-flash-lite',
      maxSteps: 1,
      reasoning: 'توجيه احتياطي لتعذر الاتصال بالمصفّي',
      meta: { error: err.message },
    };
  }
}

/**
 * Dynamically filters available AI tools based on identified domain and complexity level.
 * In simple mode, provides only the 2-3 most essential domain tools to save token consumption and reduce latency.
 * In complex mode, enables cross-domain and multi-step toolsets.
 */
export function filterToolsByDomain(allTools, domain, complexity) {
  if (!allTools || typeof allTools !== 'object') return allTools;

  // Pure conversation in simple mode does not need tools
  if (domain === 'chat' && complexity === 'simple') {
    return {};
  }

  // Primary 2-3 tools mapping per domain
  const domainToolMap = {
    youtube: ['playYoutubeVideo', 'controlMedia'],
    browser: ['openWebsite', 'controlMedia'],
    system_cli: ['openApp', 'getSystemStatus'],
    file_office: ['openApp', 'getSystemStatus'],
    power: ['requestPowerAction', 'controlMedia'],
    vision: ['controlMagnifier', 'getSystemStatus'],
    chat: ['getSystemStatus'],
  };

  if (complexity === 'simple') {
    const allowed = domainToolMap[domain] || ['controlMedia', 'openApp'];
    const filtered = {};
    for (const toolName of allowed) {
      if (allTools[toolName]) {
        filtered[toolName] = allTools[toolName];
      }
    }
    return filtered;
  }

  // Complex tasks: include domain tools plus related operational tools
  const complexAllowed = new Set([
    ...(domainToolMap[domain] || []),
    'controlMedia',
    'openApp',
    'openWebsite',
    'getSystemStatus',
    'requestPowerAction',
    'controlMagnifier',
    'playYoutubeVideo',
  ]);

  const filtered = {};
  for (const [toolName, toolObj] of Object.entries(allTools)) {
    if (complexAllowed.has(toolName)) {
      filtered[toolName] = toolObj;
    }
  }
  return filtered;
}
