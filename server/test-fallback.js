import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateTextWithFallback, getQuotaStats } from './ai/llmClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

console.log('='.repeat(65));
console.log('🧪 اختبار نواة الاتصال المقاومة للأعطال والتحويل التلقائي (Phase 2 Test)');
console.log('='.repeat(65));

let allPassed = true;

// -----------------------------------------------------------------------------
// الاختبار الأول: الاستدعاء الطبيعي مع النموذج الأساسي (Gemini 3.1 Flash-Lite)
// -----------------------------------------------------------------------------
console.log('\n[الاختبار 1/2] 🟢 استدعاء طبيعي مع الموديل الأساسي (Gemini 3.1 Flash-Lite)...');
try {
  const { result, meta } = await generateTextWithFallback({
    prompt: 'رد بكلمة واحدة فقط: ممتاز',
  });

  console.log(`✅ [Test 1 Passed]`);
  console.log(`   - الموديل المستخدم: ${meta.modelUsed}`);
  console.log(`   - المزود: ${meta.provider}`);
  console.log(`   - هل تم تفعيل التحويل الاحتياطي (Fallback): ${meta.fallbackTriggered}`);
  console.log(`   - زمن الاستجابة: ${meta.latencyMs} ms`);
  console.log(`   - الرد المستلم: "${result.text.trim()}"`);
  console.log(`   - حالة الكوتة الحالية (RPM / RPD):`, {
    rpm: `${meta.quota.rpm}/${meta.quota.rpmLimit}`,
    rpd: `${meta.quota.rpd}/${meta.quota.rpdLimit}`,
    totalRequests: meta.quota.totalRequests,
  });

  if (meta.fallbackTriggered || meta.modelUsed !== 'gemini-3.1-flash-lite') {
    throw new Error('كان المتوقع استخدام الموديل الأساسي بدون Fallback.');
  }
} catch (err) {
  allPassed = false;
  console.error('❌ [Test 1 Failed]:', err.message);
}

// -----------------------------------------------------------------------------
// الاختبار الثاني: محاكاة الفشل والتحويل الفوري للاحتياطي (Groq openai/gpt-oss-120b)
// -----------------------------------------------------------------------------
console.log('\n[الاختبار 2/2] 🟡 محاكاة فشل مفتاح جوجل (INVALID_KEY) واختبار التحويل الفوري...');
try {
  const t0 = Date.now();
  const { result, meta } = await generateTextWithFallback({
    prompt: 'رد بكلمة واحدة فقط: شغال',
    googleApiKeyOverride: 'INVALID_KEY_FOR_TESTING_123',
  });
  const totalDuration = Date.now() - t0;

  console.log(`✅ [Test 2 Passed] تم التحويل التلقائي بنجاح!`);
  console.log(`   - الموديل المستخدم: ${meta.modelUsed}`);
  console.log(`   - المزود: ${meta.provider}`);
  console.log(`   - تفعيل التحويل الاحتياطي (fallbackTriggered): ${meta.fallbackTriggered}`);
  console.log(`   - سبب التحويل بالعربية: "${meta.fallbackReason}"`);
  console.log(`   - زمن استجابة الموديل البديل: ${meta.latencyMs} ms`);
  console.log(`   - إجمالي زمن العملية مع الفشل والتحويل: ${totalDuration} ms`);
  console.log(`   - الرد المستلم من Groq: "${result.text.trim()}"`);
  console.log(`   - حالة كوتة Groq الحالية (RPM / RPD):`, {
    rpm: `${meta.quota.rpm}/${meta.quota.rpmLimit}`,
    rpd: `${meta.quota.rpd}/${meta.quota.rpdLimit}`,
    totalRequests: meta.quota.totalRequests,
  });

  if (!meta.fallbackTriggered || meta.modelUsed !== 'openai/gpt-oss-120b') {
    throw new Error('فشل التحويل التلقائي إلى Groq openai/gpt-oss-120b.');
  }

  if (!meta.fallbackReason || !meta.fallbackReason.includes('Groq')) {
    throw new Error('سبب التحويل بالعربية غير مكتمل أو مفقود.');
  }
} catch (err) {
  allPassed = false;
  console.error('❌ [Test 2 Failed]:', err.message);
}

// -----------------------------------------------------------------------------
// ملخص الكوتة الشامل لكل النماذج
// -----------------------------------------------------------------------------
console.log('\n' + '='.repeat(65));
console.log('📊 ملخص استهلاك الكوتة الشامل في الذاكرة (getQuotaStats):');
console.log(JSON.stringify(getQuotaStats(), null, 2));
console.log('='.repeat(65));

if (allPassed) {
  console.log('🎉 نجحت جميع اختبارات المرحلة الثانية بنسبة 100% (Fault Tolerance & Quota Verified).');
} else {
  console.error('⚠️ انتهى الفحص مع فشل أحد الاختبارات.');
  process.exitCode = 1;
}
