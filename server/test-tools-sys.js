import { aiTools } from './ai/tools.js';
import { filterToolsByDomain } from './ai/router.js';
import { runTerminalCommand } from './ai/tools/systemCliTools.js';
import { controlPower } from './ai/tools/powerTools.js';

async function runTests() {
  console.log('====================================================');
  console.log('🚀 Phase 5: System CLI & Power Tools Verification Test');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  // 1. Test Domain Filtering for system_cli
  console.log('--- 1. Testing Domain Filtering: system_cli ---');
  const sysCliTools = filterToolsByDomain(aiTools, 'system_cli', 'simple');
  const sysCliKeys = Object.keys(sysCliTools);
  console.log('Filtered tools for system_cli (simple):', sysCliKeys);
  assert(
    sysCliKeys.includes('openApplication') &&
    sysCliKeys.includes('runTerminalCommand') &&
    sysCliKeys.includes('listOrKillProcess'),
    'system_cli simple mode contains openApplication, runTerminalCommand, listOrKillProcess'
  );
  assert(
    !sysCliKeys.includes('controlPower') && !sysCliKeys.includes('playYoutubeVideo'),
    'system_cli does not leak power or youtube tools'
  );

  // 2. Test Domain Filtering for power
  console.log('\n--- 2. Testing Domain Filtering: power ---');
  const powerToolsFiltered = filterToolsByDomain(aiTools, 'power', 'simple');
  const powerKeys = Object.keys(powerToolsFiltered);
  console.log('Filtered tools for power (simple):', powerKeys);
  assert(
    powerKeys.includes('controlPower') && powerKeys.includes('controlMedia'),
    'power simple mode contains controlPower and controlMedia'
  );
  assert(
    !powerKeys.includes('runTerminalCommand') && !powerKeys.includes('listOrKillProcess'),
    'power domain does not leak cli tools'
  );

  // 3. Test Safe CLI Execution via runTerminalCommand
  console.log('\n--- 3. Testing Safe CLI Execution: node -v ---');
  const nodeResult = await runTerminalCommand.execute({ command: 'node -v' });
  console.log('node -v result:', nodeResult);
  assert(nodeResult.success === true, 'node -v succeeded');
  assert(nodeResult.exitCode === 0, 'node -v exitCode is 0');
  assert(nodeResult.stdout && nodeResult.stdout.includes('v'), 'node -v stdout contains version string');

  // 4. Test Error Catching & No Server Crash on Invalid CLI Command
  console.log('\n--- 4. Testing CLI Error Handling: non_existent_command_12345 ---');
  const errResult = await runTerminalCommand.execute({ command: 'non_existent_command_12345' });
  console.log('Error command result:', errResult);
  assert(errResult.success === false, 'Invalid command reports success = false');
  assert(errResult.exitCode !== 0, 'Invalid command reports non-zero exitCode');
  assert(errResult.stderr && errResult.stderr.length > 0, 'Invalid command captures stderr output cleanly');

  // 5. Test Power Protection: Shutdown without confirmation must be blocked
  console.log('\n--- 5. Testing Power Guard: Unconfirmed Shutdown ---');
  const shutdownBlocked = await controlPower.execute({ action: 'shutdown', confirmed: false });
  console.log('Shutdown unconfirmed result:', shutdownBlocked);
  assert(shutdownBlocked.success === false, 'Unconfirmed shutdown is rejected (success = false)');
  assert(
    shutdownBlocked.requiresConfirmation === true || shutdownBlocked.status === 'awaiting_confirmation',
    'Unconfirmed shutdown sets requiresConfirmation: true and status: awaiting_confirmation'
  );
  assert(shutdownBlocked.pendingAction && shutdownBlocked.pendingAction.action === 'shutdown', 'Pending action created for shutdown');

  // 6. Test Power Safety: Cancel Shutdown
  console.log('\n--- 6. Testing Power Action: cancel_shutdown ---');
  const cancelResult = await controlPower.execute({ action: 'cancel_shutdown' });
  console.log('Cancel shutdown result:', cancelResult);
  assert(cancelResult.success === true, 'cancel_shutdown returns success: true');

  console.log('\n====================================================');
  console.log(`Test Results: ${passed} / ${total} tests passed.`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
