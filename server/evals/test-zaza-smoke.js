import assert from 'assert';
import { performance } from 'perf_hooks';
import {
  WAKE_WORD_DETECT_REGEX,
  WAKE_WORD_STRIP_REGEX,
  hasWakeWord,
  stripWakeWord,
  matchZeroTokenFastPath,
} from '../ai/fastPath.js';
import { routeCommand, filterToolsByDomain } from '../ai/router.js';
import { runAgent } from '../ai/agent.js';
import { aiTools } from '../ai/tools.js';

async function runZazaSmokeTests() {
  console.log('====================================================');
  console.log('🧪 ZAZA (ظاظا) Comprehensive Smoke Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total += 1;
    const t0 = performance.now();
    try {
      await fn();
      const ms = (performance.now() - t0).toFixed(2);
      console.log(`✅ [PASS] ${name} (${ms}ms)`);
      passed += 1;
    } catch (err) {
      const ms = (performance.now() - t0).toFixed(2);
      console.error(`❌ [FAIL] ${name} (${ms}ms): ${err.message}`);
      throw err;
    }
  }

  // 1. Wake-word detection & stripping for all required Arabic & English variations
  await test('Wake-word detection & stripping (all required forms)', () => {
    const wakeOnlyCases = [
      'ظاظا',
      'زازا',
      'يا زوزو',
      'إيه يا زاقا',
      'ZAZA',
      'ظاظه',
      'ظاظة',
      'زازه',
      'زازة',
      'زوزه',
      'زوزة',
      'ذاذا',
      'سازه',
      'زاكا',
      'زكا',
      'زكى',
      'زكي',
      'زادكا',
      'zaza',
      'Zozo',
      'Zaka',
      'Zaqa',
      'ألو يا ظاظا',
      'إزيك يا زازا',
      'hey zaza',
      'ok zaka',
    ];

    for (const phrase of wakeOnlyCases) {
      assert.strictEqual(
        WAKE_WORD_DETECT_REGEX.test(phrase),
        true,
        `WAKE_WORD_DETECT_REGEX failed to match "${phrase}"`
      );
      assert.strictEqual(hasWakeWord(phrase), true, `hasWakeWord failed for "${phrase}"`);
      assert.strictEqual(
        stripWakeWord(phrase),
        '',
        `Expected empty stripped command for wake-only "${phrase}", got "${stripWakeWord(phrase)}"`
      );
    }

    // One-Breath Commands
    const oneBreathCases = [
      { input: 'يا ظاظا علي شوية', expected: 'علي شوية' },
      { input: 'زازا علي شوية', expected: 'علي شوية' },
      { input: 'يا ظاظا افتح لي اليوتيوب', expected: 'افتح لي اليوتيوب' },
      { input: 'zaza open youtube', expected: 'open youtube' },
      { input: 'إيه يا زاقا وطي شوية', expected: 'وطي شوية' },
    ];

    for (const { input, expected } of oneBreathCases) {
      assert.strictEqual(WAKE_WORD_DETECT_REGEX.test(input), true, `Did not detect wake word in "${input}"`);
      const stripped = input.replace(WAKE_WORD_STRIP_REGEX, '').trim();
      assert.strictEqual(
        stripped,
        expected,
        `WAKE_WORD_STRIP_REGEX mismatch for "${input}": expected "${expected}", got "${stripped}"`
      );
    }
  });

  // 2. Fast Path execution (< 10ms, 0 tokens) for volume commands
  await test('Fast Path: "علي شوية" & "وطي شوية" & "يا ظاظا علي شوية" (< 10ms, 0 tokens)', () => {
    const t0 = performance.now();
    const up = matchZeroTokenFastPath('علي شوية');
    const down = matchZeroTokenFastPath('وطي شوية');
    const oneBreathUp = matchZeroTokenFastPath('يا ظاظا علي شوية');
    const elapsed = performance.now() - t0;

    assert.ok(up, 'Expected Fast Path match for "علي شوية"');
    assert.strictEqual(up.action, 'volume_up');
    assert.strictEqual(up.tokensUsed, 0);

    assert.ok(down, 'Expected Fast Path match for "وطي شوية"');
    assert.strictEqual(down.action, 'volume_down');
    assert.strictEqual(down.tokensUsed, 0);

    assert.ok(oneBreathUp, 'Expected Fast Path match for "يا ظاظا علي شوية"');
    assert.strictEqual(oneBreathUp.action, 'volume_up');
    assert.strictEqual(oneBreathUp.tokensUsed, 0);

    assert.ok(elapsed < 10, `Expected Fast Path matching < 10ms, took ${elapsed.toFixed(2)}ms`);
    console.log(`   ↳ Fast Path matched all 3 commands in ${elapsed.toFixed(3)}ms (0 tokens)`);
  });

  // 3. Routing & execution of "افتح لي اليوتيوب"
  await test('Route & Execute: "افتح لي اليوتيوب" (foreground PowerShell Start-Process + anti-hallucination guard)', async () => {
    const route = await routeCommand('افتح لي اليوتيوب');
    console.log(`   ↳ Router output: domain=${route.domain}, complexity=${route.complexity}, model=${route.targetModel}`);
    assert.strictEqual(route.domain, 'youtube', `Expected domain "youtube", got "${route.domain}"`);

    const domainTools = filterToolsByDomain(aiTools, route.domain, route.complexity);
    const agentResult = await runAgent({
      prompt: route.cleanText || 'افتح لي اليوتيوب',
      domain: route.domain,
      tools: domainTools,
      model: route.targetModel,
      maxSteps: route.maxSteps || 2,
      dryRun: false,
    });

    assert.ok(
      agentResult.toolResults && agentResult.toolResults.length > 0,
      'Expected at least one real tool execution (no fake text-only reply)'
    );

    const ytResult = agentResult.toolResults.find((tr) => tr.toolName === 'playYoutubeVideo')?.result;
    assert.ok(ytResult, 'Expected playYoutubeVideo tool result');
    assert.strictEqual(ytResult.success, true, `playYoutubeVideo failed: ${ytResult.error || ytResult.message}`);
    assert.ok(
      String(ytResult.url || '').includes('youtube.com'),
      `Expected YouTube URL, got "${ytResult.url}"`
    );

    console.log(`   ↳ Executed tool: playYoutubeVideo -> ${ytResult.url} (method: ${ytResult.method})`);
    console.log(`   ↳ ZAZA Reply: ${agentResult.text}`);
  });

  console.log('\n====================================================');
  console.log(`🎉 ZAZA SMOKE TEST SUMMARY: ${passed}/${total} PASSED (100%)`);
  console.log('====================================================');
}

runZazaSmokeTests().catch((err) => {
  console.error('\n💥 ZAZA SMOKE TEST FAILED:', err);
  process.exit(1);
});
