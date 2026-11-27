import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { routeCommand, filterToolsByDomain } from './ai/router.js';
import { runAgent } from './ai/agent.js';
import { aiTools } from './ai/tools.js';
import { fileOperation } from './ai/tools/officeFileTools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

async function runStage6IntegrationTest() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║    STAGE 5 & 6 COMPLETE INTEGRATION TEST (EGYPTIAN DIALECT)    ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
    }
  }

  // =========================================================================
  // 1. 7-DOMAIN FILTERING & TOKEN SAVINGS VERIFICATION
  // =========================================================================
  console.log('--- 1. Testing 7-Domain Tool Filtering & Isolation ---');
  const totalToolsCount = Object.keys(aiTools).length;
  const domains = ['youtube', 'browser', 'file_office', 'vision', 'system_cli', 'power', 'chat'];

  for (const domain of domains) {
    const filtered = filterToolsByDomain(aiTools, domain, 'simple');
    const keys = Object.keys(filtered);
    console.log(`  • ${domain.padEnd(12)} -> [${keys.join(', ')}] (${keys.length}/${totalToolsCount} tools)`);
    if (domain === 'chat') {
      assert(keys.length === 0, 'Domain "chat" receives 0 tools');
    } else {
      assert(keys.length > 0 && keys.length <= 3, `Domain "${domain}" receives <= 3 tools (${keys.length})`);
    }
  }

  // =========================================================================
  // 2. REAL EXCEL CELL UPDATE IN EGYPTIAN ARABIC
  // =========================================================================
  console.log('\n--- 2. Testing Real Excel Update ("افتح شيت الاكسيل _test_stage6.xlsx وخلي خلية A1 خمسمية") ---');
  const excelPath = path.join(os.homedir(), 'Desktop', '_test_stage6.xlsx');
  try {
    if (fs.existsSync(excelPath)) fs.unlinkSync(excelPath);

    const excelPrompt = 'افتح شيت الاكسيل _test_stage6.xlsx وخلي خلية A1 خمسمية';
    const routeExcel = await routeCommand(excelPrompt);
    console.log(`  ↪ Route: domain=${routeExcel.domain}, complexity=${routeExcel.complexity}, cleanText="${routeExcel.cleanText}"`);

    const toolsExcel = filterToolsByDomain(aiTools, routeExcel.domain, routeExcel.complexity);
    const resExcel = await runAgent({
      prompt: routeExcel.cleanText,
      model: routeExcel.targetModel,
      tools: toolsExcel,
      maxSteps: 3,
      dryRun: false, // Real Excel file creation/modification
    });

    const calledExcelTool = resExcel.toolCalls.some((tc) => tc.toolName === 'updateExcelCell');
    assert(calledExcelTool, 'Agent invoked updateExcelCell tool');

    const fileExists = fs.existsSync(excelPath);
    assert(fileExists, `Excel file created at ${excelPath}`);

    if (fileExists) {
      const wb = XLSX.readFile(excelPath);
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const a1Val = firstSheet?.A1?.v;
      console.log(`  ↪ Read back from disk: A1 = ${a1Val} (type: ${typeof a1Val})`);
      assert(Number(a1Val) === 500, 'Cell A1 in _test_stage6.xlsx equals 500 on disk');
    } else {
      assert(false, 'Cell A1 in _test_stage6.xlsx equals 500 on disk');
    }
  } finally {
    try {
      if (fs.existsSync(excelPath)) fs.unlinkSync(excelPath);
      console.log('  🧹 Cleaned up temporary _test_stage6.xlsx');
    } catch (_) {}
  }

  await new Promise((r) => setTimeout(r, 2000));

  // =========================================================================
  // 3. REAL VISION SCREEN CAPTURE & ANALYSIS
  // =========================================================================
  console.log('\n--- 3. Testing Real Vision Analysis ("بص على الشاشة دلوقتي وقولي إيه اللي مفتوح قدامي باختصار") ---');
  const visionPrompt = 'بص على الشاشة دلوقتي وقولي إيه اللي مفتوح قدامي باختصار';
  const routeVision = await routeCommand(visionPrompt);
  console.log(`  ↪ Route: domain=${routeVision.domain}, complexity=${routeVision.complexity}, target=${routeVision.targetModel}`);

  const toolsVision = filterToolsByDomain(aiTools, routeVision.domain, routeVision.complexity);
  const resVision = await runAgent({
    prompt: routeVision.cleanText,
    model: routeVision.targetModel,
    tools: toolsVision,
    maxSteps: 3,
    dryRun: false,
  });

  const calledVisionTool = resVision.toolCalls.some((tc) => tc.toolName === 'captureAndAnalyzeScreen');
  const visionResult = resVision.toolResults.find((tr) => tr.toolName === 'captureAndAnalyzeScreen');
  const visionData = visionResult?.result || visionResult?.output;
  console.log(`  ↪ Vision Model: ${visionData?.model} | Analysis snippet: "${String(visionData?.analysis || resVision.text).slice(0, 120)}..."`);

  assert(calledVisionTool, 'Agent invoked captureAndAnalyzeScreen tool');
  assert(Boolean(visionData?.success && visionData?.analysis?.length > 10), 'Vision tool analyzed real screen via gemini-3.1-flash-lite');

  await new Promise((r) => setTimeout(r, 2000));

  // =========================================================================
  // 4. YOUTUBE & BROWSER INCOGNITO ROUTING (DRY RUN)
  // =========================================================================
  console.log('\n--- 4. Testing YouTube & Browser Incognito Routing (dryRun: true) ---');

  // 4a. YouTube
  const ytPrompt = 'شغل ملخص ماتش الأهلي والزمالك';
  const routeYt = await routeCommand(ytPrompt);
  console.log(`  ↪ YouTube Route: domain=${routeYt.domain}, cleanText="${routeYt.cleanText}"`);
  const toolsYt = filterToolsByDomain(aiTools, routeYt.domain, routeYt.complexity);
  const resYt = await runAgent({
    prompt: routeYt.cleanText,
    model: routeYt.targetModel,
    tools: toolsYt,
    maxSteps: 2,
    dryRun: true,
  });
  const ytCall = resYt.toolCalls.find((tc) => tc.toolName === 'playYoutubeVideo');
  const ytQuery = ytCall?.args?.query || ytCall?.input?.query || '';
  console.log(`  ↪ Extracted YouTube query: "${ytQuery}"`);
  assert(Boolean(ytCall && ytQuery.length > 0), 'YouTube command invoked playYoutubeVideo with query');

  // 4b. Browser Incognito
  const browserPrompt = 'افتح لينكد ان في وضع التخفي';
  const routeBrowser = await routeCommand(browserPrompt);
  console.log(`  ↪ Browser Route: domain=${routeBrowser.domain}, cleanText="${routeBrowser.cleanText}"`);
  const toolsBrowser = filterToolsByDomain(aiTools, routeBrowser.domain, routeBrowser.complexity);
  const resBrowser = await runAgent({
    prompt: routeBrowser.cleanText,
    model: routeBrowser.targetModel,
    tools: toolsBrowser,
    maxSteps: 2,
    dryRun: true,
  });
  const browserCall = resBrowser.toolCalls.find((tc) => tc.toolName === 'openBrowserUrl');
  const bInput = browserCall?.args || browserCall?.input || {};
  console.log(`  ↪ Extracted Browser args: url="${bInput.url}", incognito=${bInput.incognito}`);
  assert(Boolean(browserCall && bInput.incognito === true), 'Browser incognito command extracted incognito: true');

  // =========================================================================
  // 5. FILE DELETION SAFETY GUARDRAIL
  // =========================================================================
  console.log('\n--- 5. Testing File Deletion Safety Guard ("امسح ملف test.txt من الديسكتوب") ---');
  const delPrompt = 'امسح ملف test.txt من الديسكتوب';
  const routeDel = await routeCommand(delPrompt);
  console.log(`  ↪ Delete Route: domain=${routeDel.domain}, requiresConfirmation=${routeDel.requiresConfirmation}`);
  assert(routeDel.requiresConfirmation === true, 'Router flagged file deletion with requiresConfirmation: true');

  const delToolRes = await fileOperation.execute({ action: 'delete', target: 'test.txt', confirmed: false });
  assert(
    delToolRes.success === false && delToolRes.status === 'awaiting_confirmation' && delToolRes.requiresConfirmation === true,
    'fileOperation(delete, confirmed: false) halted at awaiting_confirmation'
  );

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  const pct = Math.round((passed / total) * 100);
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log(`║  STAGE 6 INTEGRATION RESULT: ${passed}/${total} PASSED (${pct}%)`.padEnd(65) + '║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runStage6IntegrationTest().catch((err) => {
  console.error('Fatal Stage 6 Test Error:', err);
  process.exit(1);
});
