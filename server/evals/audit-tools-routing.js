import assert from 'assert';
import { performance } from 'perf_hooks';
import {
  matchZeroTokenFastPath,
  isSpatialOrVisualScreenIntent,
} from '../ai/fastPath.js';
import { routeCommand, filterToolsByDomain } from '../ai/router.js';
import { runAgent } from '../ai/agent.js';
import { aiTools } from '../ai/tools.js';

async function runAuditSuite() {
  console.log('==================================================================');
  console.log('🔍 FULL AUDIT SUITE: Tools, Spatial Vision, YouTube & Fast Path');
  console.log('==================================================================\n');

  const report = [];

  async function runCase(id, label, fn) {
    const t0 = performance.now();
    try {
      const details = await fn();
      const ms = (performance.now() - t0).toFixed(1);
      report.push({ id, label, status: 'PASS', ms, details });
      console.log(`✅ [PASS] Case ${id}: ${label} (${ms}ms)`);
      if (details) console.log(`   ↳ ${details}`);
    } catch (err) {
      const ms = (performance.now() - t0).toFixed(1);
      report.push({ id, label, status: 'FAIL', ms, details: err.message });
      console.error(`❌ [FAIL] Case ${id}: ${label} (${ms}ms) -> ${err.message}`);
    }
  }

  // Case 1: "افتح لي اليوتيوب" (Direct homepage open without search)
  await runCase(1, '"افتح لي اليوتيوب" (فتح مباشر بدون بحث)', async () => {
    const route = await routeCommand('افتح لي اليوتيوب');
    assert.strictEqual(route.domain, 'youtube', `Expected domain "youtube", got "${route.domain}"`);

    const tools = filterToolsByDomain(aiTools, route.domain, route.complexity);
    const res = await runAgent({
      prompt: route.cleanText || 'افتح لي اليوتيوب',
      domain: route.domain,
      tools,
      model: route.targetModel,
      maxSteps: 2,
      dryRun: false,
    });

    const yt = res.toolResults?.find((tr) => tr.toolName === 'playYoutubeVideo')?.result;
    assert.ok(yt, 'playYoutubeVideo tool was not executed');
    assert.strictEqual(yt.success, true, `Tool failed: ${yt.error}`);
    assert.strictEqual(yt.url, 'https://www.youtube.com/', `Expected direct homepage URL, got ${yt.url}`);
    assert.strictEqual(yt.action, 'open_youtube_home', `Expected action open_youtube_home, got ${yt.action}`);
    return `domain=${route.domain} | tool=playYoutubeVideo | url=${yt.url} | method=${yt.method}`;
  });

  // Case 2: "هات لي ماتش برشلونة" (Search and play YouTube video)
  await runCase(2, '"هات لي ماتش برشلونة" (بحث وتشغيل فيديو YouTube)', async () => {
    const route = await routeCommand('هات لي ماتش برشلونة');
    assert.strictEqual(route.domain, 'youtube', `Expected domain "youtube", got "${route.domain}"`);

    const tools = filterToolsByDomain(aiTools, route.domain, route.complexity);
    const res = await runAgent({
      prompt: route.cleanText || 'هات لي ماتش برشلونة',
      domain: route.domain,
      tools,
      model: route.targetModel,
      maxSteps: 2,
      dryRun: false,
    });

    const yt = res.toolResults?.find((tr) => tr.toolName === 'playYoutubeVideo')?.result;
    assert.ok(yt, 'playYoutubeVideo tool was not executed');
    assert.strictEqual(yt.success, true, `Tool failed: ${yt.error}`);
    assert.strictEqual(yt.action, 'play_youtube_video', `Expected action play_youtube_video, got ${yt.action}`);
    assert.ok(
      yt.url.includes('youtube.com/watch?v=') || yt.url.includes('youtube.com/results?search_query='),
      `Unexpected URL: ${yt.url}`
    );
    return `domain=${route.domain} | tool=playYoutubeVideo | url=${yt.url} | directVideo=${yt.directVideo}`;
  });

  // Case 3: "هات لي أول فيديو على اليوتيوب من ناحية اليمين" (Spatial/Visual routing, NOT YouTube search)
  await runCase(3, '"هات لي أول فيديو على اليوتيوب من ناحية اليمين" (توجيه بصري/تفاعلي وليس بحث YouTube)', async () => {
    const prompt = 'هات لي أول فيديو على اليوتيوب من ناحية اليمين';
    assert.strictEqual(isSpatialOrVisualScreenIntent(prompt), true, 'Spatial intent detector failed');

    const route = await routeCommand(prompt);
    assert.strictEqual(route.domain, 'vision', `Expected domain "vision", got "${route.domain}"`);

    const tools = filterToolsByDomain(aiTools, route.domain, route.complexity);
    assert.ok(tools.captureAndAnalyzeScreen, 'captureAndAnalyzeScreen must be in vision domain tools');
    assert.strictEqual(Boolean(tools.playYoutubeVideo), false, 'playYoutubeVideo must NOT be exposed for spatial vision intent');

    const res = await runAgent({
      prompt: route.cleanText || prompt,
      domain: route.domain,
      tools,
      model: 'gemini-3.1-flash-lite',
      maxSteps: 2,
      dryRun: false,
    });

    const vis = res.toolResults?.find((tr) => tr.toolName === 'captureAndAnalyzeScreen')?.result;
    assert.ok(vis, 'captureAndAnalyzeScreen tool was not executed');
    assert.strictEqual(vis.success, true, `Vision tool failed: ${vis.error}`);
    assert.ok(vis.analysis && vis.analysis.length > 5, 'Expected non-empty visual analysis');
    return `domain=${route.domain} | tool=captureAndAnalyzeScreen | visionModel=${vis.model} | analysis="${vis.analysis.slice(0, 75).replace(/\n/g, ' ')}..."`;
  });

  // Case 4: "إنت شايف إيه دلوقتي" (Live screenshot + Multimodal Vision model)
  await runCase(4, '"إنت شايف إيه دلوقتي" (التقاط الشاشة وإرسالها لموديل الرؤية)', async () => {
    const prompt = 'إنت شايف إيه دلوقتي';
    assert.strictEqual(isSpatialOrVisualScreenIntent(prompt), true, 'Visual intent detector failed');

    const route = await routeCommand(prompt);
    assert.strictEqual(route.domain, 'vision', `Expected domain "vision", got "${route.domain}"`);

    const tools = filterToolsByDomain(aiTools, route.domain, route.complexity);
    const res = await runAgent({
      prompt: route.cleanText || prompt,
      domain: route.domain,
      tools,
      model: 'gemini-3.1-flash-lite',
      maxSteps: 2,
      dryRun: false,
    });

    const vis = res.toolResults?.find((tr) => tr.toolName === 'captureAndAnalyzeScreen')?.result;
    assert.ok(vis, 'captureAndAnalyzeScreen tool was not executed');
    assert.strictEqual(vis.success, true, `Vision tool failed: ${vis.error}`);
    assert.ok(vis.details?.screenshotBytes > 1000, 'Expected real non-empty screenshot PNG buffer');
    assert.ok(
      ['gemini-3.1-flash-lite', 'gemma-4-31b-it', 'gemini-3-flash-preview'].includes(vis.model),
      `Expected multimodal vision model, got ${vis.model}`
    );
    return `domain=${route.domain} | visionModel=${vis.model} | screenshot=${vis.details.screenshotBytes}B | analysis="${vis.analysis.slice(0, 75).replace(/\n/g, ' ')}..."`;
  });

  // Case 5: "علي شوية" (Instant Fast Path, 0 tokens, < 10ms)
  await runCase(5, '"علي شوية" (تنفيذ فوري 0 توكنز)', async () => {
    const t0 = performance.now();
    const match = matchZeroTokenFastPath('علي شوية');
    const elapsed = performance.now() - t0;

    assert.ok(match, 'Fast Path failed to match "علي شوية"');
    assert.strictEqual(match.action, 'volume_up', `Expected volume_up, got ${match.action}`);
    assert.strictEqual(match.tokensUsed, 0, `Expected 0 tokens, got ${match.tokensUsed}`);
    assert.ok(elapsed < 10, `Fast Path took too long: ${elapsed.toFixed(2)}ms`);
    return `action=${match.action} | repeat=${match.repeat} | tokens=0 | latency=${elapsed.toFixed(3)}ms`;
  });

  console.log('\n==================================================================');
  const passedCount = report.filter((r) => r.status === 'PASS').length;
  console.log(`📊 AUDIT SUMMARY: ${passedCount}/${report.length} PASSED`);
  console.log('==================================================================');

  if (passedCount !== report.length) {
    process.exit(1);
  }
}

runAuditSuite().catch((err) => {
  console.error('💥 AUDIT SUITE CRASHED:', err);
  process.exit(1);
});
