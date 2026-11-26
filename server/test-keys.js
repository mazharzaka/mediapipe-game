import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env explicitly
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY || process.env.GROQ_AI_API;

console.log('='.repeat(60));
console.log('🧪 اختبار مفاتيح ونماذج الذكاء الاصطناعي (Phase 1 AI Verification)');
console.log('='.repeat(60));

if (!geminiApiKey) {
  console.error('❌ خطأ: لم يتم العثور على GEMINI_API_KEY في ملف .env');
  process.exit(1);
}

if (!groqApiKey) {
  console.error('❌ خطأ: لم يتم العثور على GROQ_API_KEY في ملف .env');
  process.exit(1);
}

const google = createGoogleGenerativeAI({ apiKey: geminiApiKey });
const groq = createGroq({ apiKey: groqApiKey });

let allPassed = true;

// 1. اختبار موديل Gemini 3.1 Flash-Lite
console.log('\n[1/2] 🔍 جاري اختبار Gemini (Google AI)...');
const geminiModelName = 'gemini-3.1-flash-lite';

try {
  const t0 = Date.now();
  const result = await generateText({
    model: google(geminiModelName),
    prompt: 'رد بكلمة تمام فقط بدون أي إضافات'
  });
  const latency = Date.now() - t0;

  console.log(`✅ [Gemini] نجاح (200 OK)`);
  console.log(`   - الموديل المعتمد: ${geminiModelName}`);
  console.log(`   - الرد المستلم: "${result.text.trim()}"`);
  console.log(`   - زمن الاستجابة: ${latency} ms`);
} catch (err) {
  allPassed = false;
  console.error(`❌ [Gemini] فشل الاتصال بالموديل ${geminiModelName}:`, err.message);
}

// 2. اختبار موديل Groq (openai/gpt-oss-120b)
console.log('\n[2/2] 🔍 جاري اختبار Groq AI...');
const groqModelName = 'openai/gpt-oss-120b';

try {
  const t0 = Date.now();
  const result = await generateText({
    model: groq(groqModelName),
    prompt: 'رد بكلمة تمام فقط بدون أي إضافات'
  });
  const latency = Date.now() - t0;

  console.log(`✅ [Groq] نجاح (200 OK)`);
  console.log(`   - الموديل المعتمد: ${groqModelName}`);
  console.log(`   - الرد المستلم: "${result.text.trim()}"`);
  console.log(`   - زمن الاستجابة: ${latency} ms`);
} catch (err) {
  allPassed = false;
  console.error(`❌ [Groq] فشل الاتصال بالموديل ${groqModelName}:`, err.message);
}

console.log('\n' + '='.repeat(60));
if (allPassed) {
  console.log('🎉 اكتمل الفحص بنجاح: كلا المفتاحين والموديلين يعملان بكفاءة عالية (200 OK).');
  console.log('='.repeat(60));
  process.exit(0);
} else {
  console.error('⚠️ انتهى الفحص مع وجود أخطاء في أحد النماذج.');
  console.log('='.repeat(60));
  process.exit(1);
}
