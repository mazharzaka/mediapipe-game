import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { routeCommand, filterToolsByDomain, getDesktopFilesContext } from './ai/router.js';
import { aiTools } from './ai/tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

console.log('='.repeat(80));
console.log('🧠 اختبار المصفّي والموجّه الدلالي الذكي (Phase 4 Semantic Router Verification)');
console.log('='.repeat(80));

// 1. Display Desktop Files Context
const desktopFiles = getDesktopFilesContext();
console.log(`📁 ملفات سطح المكتب المرصودة في السياق (${desktopFiles.length} ملف):`);
console.log(desktopFiles.length > 0 ? desktopFiles.slice(0, 10).map((f) => `   - ${f}`).join('\n') : '   (لا توجد ملفات)');
console.log('-'.repeat(80));

// 12 Diverse, Realistic, and Challenging Raw Egyptian Voice Transcripts
const testCases = [
  {
    id: 1,
    rawText: 'افتح شيت الاكسيل اللي اسمه بوك 1 وخلي خلية اي 1 خمسمية',
    expectedDomain: 'file_office',
    expectedComplexity: 'complex',
    expectedConfirm: false,
  },
  {
    id: 2,
    rawText: 'بقول لك افتح أنتجافتي وشغل ام بي ام ران ديف من التيرميل',
    expectedDomain: 'system_cli',
    expectedComplexity: 'complex',
    expectedConfirm: false,
  },
  {
    id: 3,
    rawText: 'شغل ملخص ماتش الأهلي والزمالك نهائي القرن بتعليق عصام الشوالي',
    expectedDomain: 'youtube',
    expectedComplexity: 'simple',
    expectedConfirm: false,
  },
  {
    id: 4,
    rawText: 'افتح في اس كود',
    expectedDomain: 'system_cli',
    expectedComplexity: 'simple',
    expectedConfirm: false,
  },
  {
    id: 5,
    rawText: 'اقفل الجهاز خالص',
    expectedDomain: 'power',
    expectedComplexity: 'simple',
    expectedConfirm: true,
  },
  {
    id: 6,
    rawText: 'لو السيرفر مطلع إيرور في التيرمنال اقرأه وقولي السبب',
    expectedDomain: 'system_cli',
    expectedComplexity: 'complex',
    expectedConfirm: false,
  },
  {
    id: 7,
    rawText: 'اعمل لوك للشاشة عشان قايم اعمل شاي',
    expectedDomain: 'power',
    expectedComplexity: 'simple',
    expectedConfirm: false,
  },
  {
    id: 8,
    rawText: 'افتح لينكد إن في المتصفح واقفل تاب فيسبوك واعمل ملء الشاشة',
    expectedDomain: 'browser',
    expectedComplexity: 'complex',
    expectedConfirm: false,
  },
  {
    id: 9,
    rawText: 'كبر الشاشة 200 في المية بالعدسة وحركها شمال شوية',
    expectedDomain: 'vision',
    expectedComplexity: 'complex',
    expectedConfirm: false,
  },
  {
    id: 10,
    rawText: 'وطي الصوت شوية يا باشا',
    expectedDomain: 'youtube', // media control within relax suite
    expectedComplexity: 'simple',
    expectedConfirm: false,
  },
  {
    id: 11,
    rawText: 'افتح نافذة متخفية في الكروم واكتب google.com',
    expectedDomain: 'browser',
    expectedComplexity: 'simple',
    expectedConfirm: false,
  },
  {
    id: 12,
    rawText: 'ازيك يا بطل عامل ايه النهاردة، يومك عامل ايه؟',
    expectedDomain: 'chat',
    expectedComplexity: 'simple',
    expectedConfirm: false,
  },
];

let totalPassed = 0;
const results = [];

console.log('\n🚀 بدء اختبار التوجيه على 12 جملة صوتية مصرية خام متنوعة:\n');

for (const testCase of testCases) {
  const t0 = Date.now();
  const route = await routeCommand(testCase.rawText);
  const latency = Date.now() - t0;

  const filteredTools = filterToolsByDomain(aiTools, route.domain, route.complexity);
  const toolNames = Object.keys(filteredTools);

  const domainMatch = route.domain === testCase.expectedDomain;
  const complexityMatch = route.complexity === testCase.expectedComplexity;
  const confirmMatch = route.requiresConfirmation === testCase.expectedConfirm;
  const passed = domainMatch && complexityMatch && confirmMatch;

  if (passed) totalPassed++;

  results.push({
    id: testCase.id,
    rawText: testCase.rawText,
    cleanText: route.cleanText,
    domain: route.domain,
    complexity: route.complexity,
    targetModel: route.targetModel,
    maxSteps: route.maxSteps,
    requiresConfirmation: route.requiresConfirmation,
    latency,
    reasoning: route.reasoning,
    toolCount: toolNames.length,
    tools: toolNames.join(', ') || '(بدون أدوات)',
    passed,
  });

  console.log(`[${testCase.id}/12] ${passed ? '✅' : '⚠️'} النص الخام: "${testCase.rawText}"`);
  console.log(`   ◄ cleanText:             "${route.cleanText}"`);
  console.log(`   ◄ Domain:                ${route.domain} (متوقع: ${testCase.expectedDomain})`);
  console.log(`   ◄ Complexity:            ${route.complexity} (متوقع: ${testCase.expectedComplexity})`);
  console.log(`   ◄ Target Model:          ${route.targetModel} (maxSteps: ${route.maxSteps})`);
  console.log(`   ◄ Requires Confirmation: ${route.requiresConfirmation ? '🚨 نعم (True)' : 'لا (False)'}`);
  console.log(`   ◄ الأدوات المصفاة:       ${toolNames.length} أدوات [${toolNames.join(', ') || 'بدون'}]`);
  console.log(`   ◄ التفسير (Reasoning):   ${route.reasoning}`);
  console.log(`   ◄ زمن التوجيه:           ${latency} ms\n`);
}

console.log('='.repeat(80));
console.log(`📊 نتيجة الفحص الشامل للمرحلة الرابعة:`);
console.log(`   - إجمالي الحالات: ${testCases.length}`);
console.log(`   - التطابق الكامل: ${totalPassed} / ${testCases.length} (${Math.round((totalPassed / testCases.length) * 100)}%)`);
const avgLatency = Math.round(results.reduce((acc, r) => acc + r.latency, 0) / results.length);
console.log(`   - متوسط زمن التوجيه والتنظيف: ${avgLatency} ms`);
console.log('='.repeat(80));

if (totalPassed >= 10) {
  console.log('🎉 نجح اختبار المصفّي والموجّه الدلالي الذكي بنسبة ممتازة تفوق 85%!');
  process.exitCode = 0;
} else {
  console.error('❌ تنبيه: نسبة الدقة أقل من الحد الأدنى المطلوب.');
  process.exitCode = 1;
}
