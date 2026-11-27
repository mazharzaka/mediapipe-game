import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { playYoutubeVideo } from './ai/tools/youtubeTools.js';
import { openBrowserUrl, browserTabAction } from './ai/tools/browserTools.js';
import { updateExcelCell } from './ai/tools/officeFileTools.js';
import { listOrKillProcess } from './ai/tools/systemCliTools.js';
import { captureAndAnalyzeScreen } from './ai/tools/visionTools.js';
import { controlPower } from './ai/tools/powerTools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runRealToolsVerification() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║       REAL EXECUTION VERIFICATION SUITE (ALL 6 TOOLBOXES)        ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let total = 0;

  function check(condition, label, details = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✅ [PASS] ${label}${details ? ` -> ${details}` : ''}`);
    } else {
      console.error(`  ❌ [FAIL] ${label}${details ? ` -> ${details}` : ''}`);
    }
  }

  // =========================================================================
  // 1. youtubeTools: Real YouTube URL extraction + Chrome foreground launch + tab close
  // =========================================================================
  console.log('--- 1. [youtubeTools] Real YouTube Extraction & Foreground Launch ---');
  const ytRes = await playYoutubeVideo.execute({ query: 'ملخص ماتش الأهلي والزمالك' });
  const isCleanYtUrl =
    typeof ytRes.url === 'string' &&
    /^https:\/\/www\.youtube\.com\/(?:watch\?v=[a-zA-Z0-9_-]{11}|shorts\/[a-zA-Z0-9_-]{11}|results\?search_query=[^&\s]+)$/.test(
      ytRes.url
    );
  check(Boolean(ytRes.success && isCleanYtUrl), 'Extracted clean YouTube URL & spawned Chrome', `url=${ytRes.url}, method=${ytRes.method}`);

  await sleep(2200);
  const closeYtRes = await browserTabAction.execute({ action: 'close_current_tab', targetTitle: 'YouTube' });
  // Fallback Ctrl+W if Chrome tab title hadn't finished loading "YouTube" yet
  if (!closeYtRes.success) {
    await browserTabAction.execute({ action: 'close_current_tab' });
  }
  console.log(`  🧹 Closed test YouTube tab (targeted match=${Boolean(closeYtRes.success)})`);

  // =========================================================================
  // 2. browserTools: Real URL launch + Honest rejection of non-existent tab
  // =========================================================================
  console.log('\n--- 2. [browserTools] Real Browser Launch & Non-Existent Tab Guard ---');
  const openRes = await openBrowserUrl.execute({ url: 'https://example.com', incognito: false });
  check(Boolean(openRes.success && openRes.url === 'https://example.com'), 'Launched test URL in Chrome', `url=${openRes.url}, method=${openRes.method}`);

  await sleep(1800);
  const closeExample = await browserTabAction.execute({ action: 'close_current_tab', targetTitle: 'Example' });
  if (!closeExample.success) {
    await browserTabAction.execute({ action: 'close_current_tab' });
  }

  const fakeTabRes = await browserTabAction.execute({
    action: 'close_current_tab',
    targetTitle: '__NON_EXISTENT_WINDOW_TITLE_88421__',
  });
  check(
    fakeTabRes.success === false && fakeTabRes.found === false,
    'Honestly rejected closing non-existent tab title',
    `success=${fakeTabRes.success}, message="${fakeTabRes.message}"`
  );

  // =========================================================================
  // 3. officeFileTools: Real Excel creation on Desktop, cell edit, disk readback & cleanup
  // =========================================================================
  console.log('\n--- 3. [officeFileTools] Real Excel File Creation, Cell Update & Cleanup ---');
  const tempExcelName = `_real_verify_${Date.now()}.xlsx`;
  const tempExcelPath = path.join(os.homedir(), 'Desktop', tempExcelName);
  try {
    const excelRes = await updateExcelCell.execute({
      fileName: tempExcelName,
      cell: 'C4',
      value: 950,
      openAfterSave: false,
    });
    const existsOnDisk = fs.existsSync(tempExcelPath);
    let readBackVal = null;
    if (existsOnDisk) {
      const wb = XLSX.readFile(tempExcelPath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      readBackVal = ws?.C4?.v;
    }
    check(
      Boolean(excelRes.success && existsOnDisk && Number(readBackVal) === 950),
      'Created Excel on Desktop & verified cell C4=950 from disk',
      `path=${tempExcelPath}, C4=${readBackVal}`
    );
  } finally {
    if (fs.existsSync(tempExcelPath)) {
      fs.unlinkSync(tempExcelPath);
    }
    check(!fs.existsSync(tempExcelPath), 'Cleaned up temporary Excel file from Desktop');
  }

  // =========================================================================
  // 4. systemCliTools: Real Port 3000 inspection & Server PID verification
  // =========================================================================
  console.log('\n--- 4. [systemCliTools] Real Port 3000 Inspection & Active PID ---');
  const portRes = await listOrKillProcess.execute({ action: 'find_port', port: 3000 });
  const pidMatch = String(portRes.rawOutput || '').match(/LISTENING\s+(\d+)/i);
  const extractedPid = pidMatch ? Number(pidMatch[1]) : 0;
  check(
    Boolean(portRes.success && portRes.found === true && extractedPid > 0),
    'Port 3000 inspected with real listening server PID',
    `PID=${extractedPid}`
  );

  // =========================================================================
  // 5. visionTools: Real Windows Screen Capture & Gemini 3.1 Flash-Lite Analysis
  // =========================================================================
  console.log('\n--- 5. [visionTools] Real Screen Capture & Multimodal Vision Analysis ---');
  const visionRes = await captureAndAnalyzeScreen.execute({
    question: 'صف باختصار شديد في سطر واحد ما يظهر على الشاشة الآن باللغة العربية.',
  });
  check(
    Boolean(visionRes.success && visionRes.model === 'gemini-3.1-flash-lite' && String(visionRes.analysis || '').length > 5),
    'Captured live Windows screen & analyzed via gemini-3.1-flash-lite',
    `snippet="${String(visionRes.analysis || '').replace(/\n+/g, ' ').slice(0, 80)}..."`
  );

  // =========================================================================
  // 6. powerTools: Real Shutdown Guardrail Verification
  // =========================================================================
  console.log('\n--- 6. [powerTools] Shutdown Safety Guardrail Verification ---');
  const powerRes = await controlPower.execute({ action: 'shutdown', confirmed: false });
  check(
    Boolean(powerRes.success === false && powerRes.status === 'awaiting_confirmation' && powerRes.requiresConfirmation === true),
    'Blocked unconfirmed shutdown at awaiting_confirmation',
    `status=${powerRes.status}`
  );

  // =========================================================================
  // FINAL SUMMARY
  // =========================================================================
  const pct = Math.round((passed / total) * 100);
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  REAL TOOLS VERIFICATION RESULT: ${passed}/${total} PASSED (${pct}%)`.padEnd(67) + '║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runRealToolsVerification().catch((err) => {
  console.error('Fatal Real Tools Verification Error:', err);
  process.exit(1);
});
