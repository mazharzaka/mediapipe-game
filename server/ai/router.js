import fs from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { generateObjectWithFallback } from './llmClient.js';
import { isSpatialOrVisualScreenIntent } from './fastPath.js';

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
  directCall: z
    .object({
      tool: z.string().describe('اسم الأداة المباشرة للتنفيذ الفوري بدون LLM ثانٍ'),
      args: z.record(z.any()).optional().describe('معاملات الأداة'),
    })
    .optional()
    .describe('استخدمه فقط للمهام البسيطة الواضحة التي تنفذ بأداة واحدة مباشرة'),
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
   - الاستعانة بقائمة ملفات الديسكتوب لمطابقة الأسماء المنطوقة بالعربية فقط (مثل "بوك 1")، أما إذا ذكر المستخدم اسم ملف صريح بامتداد (.xlsx, .txt) مثل _test_stage6.xlsx فاحتفظ بالاسم كما هو بالضبط ولا تستبدله أبداً بأي ملف آخر.

3. تصنيف المجال (domain) بدقة إلى واحد من المجالات السبعة:
   - "youtube": تشغيل وبحث الفيديوهات والأغاني والماتشات، والتحكم في الصوت/الملء أثناء المشاهدة.
   - "system_cli": أوامر التيرمنال، تشغيل السيرفرات والأكواد، برامج المطورين، فحص أخطاء logs/terminal.
   - "browser": فتح المواقع والروابط، التصفح، إغلاق وفتح التابات، المتصفح الخفي Incognito.
   - "file_office": التعامل مع ملفات الإكسيل والأوفيس، تعديل الخلايا، وعرض أو فتح أو إنشاء أو حذف الملفات والمجلدات على سطح المكتب (Desktop).
   - "power": أوامر الطاقة (Lock, Sleep, Restart, Shutdown).
   - "vision": عدسة ويندوز المكبرة (Windows Magnifier)، تكبير وتصغير الشاشة، قراءة وفحص محتوى الشاشة بصرياً.
   - "chat": استفسارات عامة، دردشة، تحية، أسئلة لا تتطلب تنفيذ أوامر على الجهاز.

4. تحديد مستوى الصعوبة (complexity):
   - "simple": أي أمر أحادي التنفيذ في مجالات youtube, browser, power, file_office (حتى لو كانت الجملة العربية طويلة جداً، أو تتضمن فتح ملف إكسيل وتعديل خلية واحدة لأن الأداة تنفذها في خطوة واحدة).
   - "complex": فقط للأوامر التي تجمع فعلين مستقلين تماماً في جملة واحدة (مثل فتح موقع ثم قفل تاب آخر ثم ملء الشاشة)، أو قراءة مخرجات تيرمنال وفحص الأخطاء لاتخاذ قرار.

5. شرط التأكيد (requiresConfirmation):
   - يكون true فقط للأوامر الخطيرة غير القابلة للتراجع: إيقاف التشغيل الكامل (Shutdown)، إعادة التشغيل (Restart)، حذف ملفات، أو قتل العمليات (kill process).
   - يكون false لأي أمر آخر (بما فيها Lock و Sleep وفتح/إغلاق البرامج والتابات).

أمثلة مرجعية (Few-Shot Examples):
- الإدخال: "افتح شيت الاكسيل اللي اسمه بوك 1 وخلي خلية اي 1 خمسمية"
  cleanText: "عدل خلية A1 إلى 500 في شيت الإكسيل Book1.xlsx"
  domain: "file_office"
  complexity: "simple"
  requiresConfirmation: false
  reasoning: "تعديل خلية إكسيل بأداة واحدة مباشرة"

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

- الإدخال: "طفي الكمبيوتر دلوقتي"
  cleanText: "إيقاف تشغيل الكمبيوتر (Shutdown)"
  domain: "power"
  complexity: "simple"
  requiresConfirmation: true
  reasoning: "إطفاء الكمبيوتر أمر طاقة حساس يتطلب تأكيد"

- الإدخال: "اعمل ريستارت للويندوز"
  cleanText: "إعادة تشغيل الكمبيوتر (Restart)"
  domain: "power"
  complexity: "simple"
  requiresConfirmation: true
  reasoning: "إعادة تشغيل الويندوز أمر طاقة حساس يتطلب تأكيد"

- الإدخال: "شوف بورت 3000 شغال عليه ايه"
  cleanText: "فحص العمليات التي تستمع على Port 3000"
  domain: "system_cli"
  complexity: "simple"
  requiresConfirmation: false
  reasoning: "فحص العمليات على بورت محدد خطوة واحدة"

- الإدخال: "لو السيرفر مطلع إيرور في التيرمنال اقرأه وقولي السبب"
  cleanText: "افحص مخرجات Terminal وإذا كان هناك خطأ اشرح سببه"
  domain: "system_cli"
  complexity: "complex"
  requiresConfirmation: false
  reasoning: "قراءة مخرجات وفحص أخطاء السيرفر البرمجي"

- الإدخال: "امسح ملف test.txt من الديسكتوب"
  cleanText: "حذف ملف test.txt من Desktop"
  domain: "file_office"
  complexity: "simple"
  requiresConfirmation: true
  reasoning: "حذف ملف أمر حساس لا يمكن التراجع عنه"

- الإدخال: "بص على الشاشة دلوقتي وقولي إيه اللي مفتوح قدامي باختصار"
  cleanText: "التقط صورة للشاشة وصف ما هو مفتوح الآن باختصار"
  domain: "vision"
  complexity: "simple"
  requiresConfirmation: false
  reasoning: "التقاط وتحليل محتوى الشاشة بصرياً"

- الإدخال: "افتح لينكد ان في وضع التخفي"
  cleanText: "افتح LinkedIn في وضع Incognito"
  domain: "browser"
  complexity: "simple"
  requiresConfirmation: false
  reasoning: "فتح موقع في وضع التصفح الخفي خطوة واحدة"

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
  reasoning: "قفل شاشة بسيط قابل للتراجع فورياً"

- الإدخال: "شوف port 3000 شغال عليه ايه"
  cleanText: "فحص العمليات التي تعمل على port 3000"
  domain: "system_cli"
  complexity: "simple"
  requiresConfirmation: false
  reasoning: "فحص منفذ port في النظام"

- الإدخال: "اقفل تاب بتاعة اليوتيوب"
  cleanText: "اقفل تاب YouTube في المتصفح"
  domain: "browser"
  complexity: "simple"
  requiresConfirmation: false
  reasoning: "إغلاق تبويب موقع محدد في المتصفح"

- الإدخال: "خش على بروفايلي في لينكد إن"
  cleanText: "افتح بروفايل LinkedIn الشخصي https://www.linkedin.com/in/me/"
  domain: "browser"
  complexity: "simple"
  requiresConfirmation: false
  reasoning: "فتح رابط حساب لينكد إن في المتصفح"

- الإدخال: "اقتل البروسيس بتاع نود"
  cleanText: "إنهاء عملية node.exe (kill process)"
  domain: "system_cli"
  complexity: "simple"
  requiresConfirmation: true
  reasoning: "قتل عملية نظام أمر حساس يتطلب تأكيد"`;

/**
 * Pre-routing phonetic normalization for common Egyptian ASR misrecognitions:
 * - "البوت 3000" / "بورد 3000" -> "port 3000"
 * - "التابعة بتاعة اليوتيوب" / "التابع" -> "تاب"
 */
export function normalizeEgyptianTranscript(input) {
  let text = String(input || '').trim();
  if (!text) return '';

  // 1. Normalize port misrecognitions ("البوت 3000", "بورت 5173", "بورد 8080" -> "port <num>")
  text = text.replace(/(?:ال)?(?:بوت|بورت|بورد)\s*(\d{2,5})/gi, 'port $1');

  // 2. Normalize tab misrecognitions ("التابعة بتاعة اليوتيوب", "التابع يوتيوب" -> "تاب")
  text = text.replace(
    /(?:ال)?تابع[ةه]?(?=\s*(?:بتاع[ةه]?|اليوتيوب|يوتيوب|جوجل|لينكد|فيسبوك|المتصفح|كروم|$))/gi,
    'تاب'
  );

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Apply deterministic domain & safety overrides after phonetic normalization
 */
function applyDeterministicOverrides(normalizedText, routeObj) {
  const out = { ...routeObj };

  // 0. HIGHEST PRIORITY: Spatial / Visual screen references ALWAYS route to Vision (NEVER YouTube search!)
  if (isSpatialOrVisualScreenIntent(normalizedText)) {
    out.domain = 'vision';
    out.complexity = 'simple';
    out.requiresConfirmation = false;
    return out;
  }

  // Opening YouTube homepage or searching/playing YouTube content by name always belongs to youtube domain
  if (
    /(?:افتح|شغل|هات)(?:\s+(?:لي|لنا))?\s+(?:(?:ال)?(?:يوتيوب|يوتوب)|ماتش|ملخص|فيديو|اغني|أغني|قران|قرآن)|\b(?:open|play)\s+youtube\b/i.test(
      normalizedText
    )
  ) {
    out.domain = 'youtube';
  }

  // Port inspection / operations always belong to system_cli
  if (/\bport\s+\d{2,5}\b/i.test(normalizedText)) {
    out.domain = 'system_cli';
  }

  // Tab operations ("اقفل تاب اليوتيوب", "تاب بتاعة لينكد") belong to browser
  if (/(?:اقفل|قفل|شيل|افتح|حدث|ريفرش)\s+(?:ال)?تاب(?:\s|$)/i.test(normalizedText)) {
    out.domain = 'browser';
  }

  // "خش على <site>" / "ادخل على <site>" belongs to browser (unless playing a video explicitly)
  if (
    /(?:^|\s)(?:خش|ادخل)\s+على\s+\S+/i.test(normalizedText) &&
    !/شغل\s+(?:فيديو|اغني|ماتش|ملخص|قران|قرآن)/i.test(normalizedText)
  ) {
    out.domain = 'browser';
  }

  // Desktop file/folder listing, folder creation, or file deletion belongs to file_office
  if (
    /(?:الملفات|ملفات|فولدر|مجلد|شيت|اكسيل|إكسيل|\.xlsx|\.txt|\.docx).*(?:الديسكتوب|ديسكتوب|سطح\s*المكتب)|(?:اعرض|وريني|افتح|امسح|احذف|اعمل\s*فولدر).*(?:الديسكتوب|ديسكتوب|سطح\s*المكتب)/i.test(
      normalizedText
    )
  ) {
    out.domain = 'file_office';
  }

  // Process kill ("اقتل البروسيس" / "انهي عملية" / "kill process") requires HITL confirmation
  if (
    /(?:اقتل|انهي|موت)\s+(?:ال)?(?:بروسيس|برسيس|عملي[ةه]|برنامج)|(?:\bkill\s+(?:process|pid|-9)\b)/i.test(
      normalizedText
    )
  ) {
    out.domain = 'system_cli';
    out.requiresConfirmation = true;
  }

  // Enforce single-action commands in youtube, browser, power, file_office to ALWAYS be 'simple' -> gemini-3.1-flash-lite
  // regardless of sentence length, unless genuinely chaining 2+ distinct cross-tool actions
  if (['youtube', 'browser', 'power', 'file_office'].includes(out.domain)) {
    const hasTrueMultiActionChain =
      /\s+و(?:بعدين\s+)?(?:اقفل|شغل|علي|وطي|اعمل\s+ملء|اعمل\s+ميوت|روح|بص)\b/i.test(normalizedText);
    if (!hasTrueMultiActionChain) {
      out.complexity = 'simple';
    }
  }

  return out;
}

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

  const normalizedInput = normalizeEgyptianTranscript(rawText);
  const needsDesktopFiles = /(?:ملف|ملفات|ديسكتوب|سطح\s*المكتب|اكسيل|إكسيل|شيت|بوك|فولدر|مجلد|xlsx|csv|txt|pdf|excel|desktop|file|folder)/i.test(
    normalizedInput
  );
  const promptParts = [
    `الطلب الصوتي للمستخدم (بعد التطبيع الصوتي المبدئي):`,
    `"${normalizedInput}"`,
  ];
  if (needsDesktopFiles) {
    const desktopFiles = getDesktopFilesContext();
    promptParts.push(
      ``,
      `ملفات سطح المكتب (Desktop) المتاحة حالياً على جهاز المستخدم:`,
      desktopFiles.length > 0 ? desktopFiles.map((f) => `- ${f}`).join('\n') : '(لا توجد ملفات حالياً على Desktop)'
    );
  }
  const promptContent = promptParts.join('\n');

  try {
    const { result, meta } = await generateObjectWithFallback({
      prompt: promptContent,
      system: ROUTER_SYSTEM_PROMPT,
      schema: routeOutputSchema,
      temperature: 0,
      primaryModel: 'gemini-3.1-flash-lite',
      timeoutMs: 9000,
    });

    const output = applyDeterministicOverrides(normalizedInput, result.object);
    const isComplex = output.complexity === 'complex';

    const targetModel = isComplex ? 'gemma-4-31b-it' : 'gemini-3.1-flash-lite';
    const maxSteps = isComplex ? 5 : 1;
    const timeoutMs = isComplex ? 12000 : 6000;

    return {
      rawText,
      normalizedText: normalizedInput,
      cleanText: output.cleanText,
      domain: output.domain,
      complexity: output.complexity,
      requiresConfirmation: output.requiresConfirmation,
      targetModel,
      maxSteps,
      timeoutMs,
      reasoning: output.reasoning,
      directCall: output.directCall || null,
      meta,
    };
  } catch (err) {
    console.error('[Router:routeCommand Error]:', err.message);
    const fallbackOut = applyDeterministicOverrides(normalizedInput, {
      cleanText: normalizedInput,
      domain: 'chat',
      complexity: 'simple',
      requiresConfirmation: false,
      reasoning: 'توجيه احتياطي لتعذر الاتصال بالمصفّي',
    });
    return {
      rawText,
      normalizedText: normalizedInput,
      cleanText: fallbackOut.cleanText,
      domain: fallbackOut.domain,
      complexity: fallbackOut.complexity,
      requiresConfirmation: fallbackOut.requiresConfirmation,
      targetModel: 'gemini-3.1-flash-lite',
      maxSteps: 1,
      reasoning: fallbackOut.reasoning,
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

  // Pure conversation (chat) needs 0 tools
  if (domain === 'chat') {
    return {};
  }

  // Dedicated tools per domain (<= 3 tools for simple tasks)
  const domainToolMap = {
    youtube: ['playYoutubeVideo', 'controlMediaPlayback'],
    browser: ['openBrowserUrl', 'browserTabAction'],
    file_office: ['updateExcelCell', 'fileOperation'],
    vision: ['captureAndAnalyzeScreen', 'controlMagnifier', 'browserTabAction'],
    system_cli: ['openApplication', 'runTerminalCommand', 'listOrKillProcess'],
    power: ['controlPower', 'controlMediaPlayback'],
  };

  if (complexity === 'simple') {
    const allowed = domainToolMap[domain] || [];
    const filtered = {};
    for (const toolName of allowed) {
      if (allTools[toolName]) {
        filtered[toolName] = allTools[toolName];
      }
    }
    return filtered;
  }

  // Complex tasks: domain tools + related cross-domain operational tools
  const relatedDomainsMap = {
    youtube: ['youtube', 'browser'],
    browser: ['browser', 'youtube'],
    file_office: ['file_office', 'system_cli'],
    vision: ['vision', 'system_cli', 'browser'],
    system_cli: ['system_cli', 'file_office', 'power'],
    power: ['power', 'system_cli'],
  };

  const related = relatedDomainsMap[domain] || [domain];
  const complexAllowed = new Set();
  for (const d of related) {
    for (const t of (domainToolMap[d] || [])) {
      complexAllowed.add(t);
    }
  }
  complexAllowed.add('getSystemStatus');

  const filtered = {};
  for (const [toolName, toolObj] of Object.entries(allTools)) {
    if (complexAllowed.has(toolName)) {
      filtered[toolName] = toolObj;
    }
  }
  return filtered;
}
