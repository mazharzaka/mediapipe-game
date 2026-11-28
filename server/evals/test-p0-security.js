import assert from 'assert';
import { controlPower } from '../ai/tools/powerTools.js';
import { listOrKillProcess, runTerminalCommand } from '../ai/tools/systemCliTools.js';
import { fileOperation } from '../ai/tools/officeFileTools.js';

async function runTests() {
  // 1. Verify `confirmed` is removed from inputSchema
  assert.strictEqual('confirmed' in controlPower.inputSchema.shape, false, 'controlPower should not have confirmed in inputSchema');
  assert.strictEqual('confirmed' in listOrKillProcess.inputSchema.shape, false, 'listOrKillProcess should not have confirmed in inputSchema');
  assert.strictEqual('confirmed' in fileOperation.inputSchema.shape, false, 'fileOperation should not have confirmed in inputSchema');

  // 2. Verify sensitive tools return awaiting_confirmation even if model passes fake confirmed: true
  const powerRes = await controlPower.execute({ action: 'shutdown', confirmed: true });
  assert.strictEqual(powerRes.status, 'awaiting_confirmation');
  assert.ok(powerRes.pendingAction?.id, 'powerRes should have pendingAction.id');

  const killRes = await listOrKillProcess.execute({ action: 'kill', pid: 99999, confirmed: true });
  assert.strictEqual(killRes.status, 'awaiting_confirmation');
  assert.ok(killRes.pendingAction?.id, 'killRes should have pendingAction.id');

  const delRes = await fileOperation.execute({ action: 'delete', target: 'nonexistent_test.txt', confirmed: true });
  assert.strictEqual(delRes.status, 'awaiting_confirmation');
  assert.ok(delRes.pendingAction?.id, 'delRes should have pendingAction.id');

  // 3. Verify runTerminalCommand blocks destructive commands
  const destructiveCmds = ['SHUTDOWN /s /t 0', 'del /f test.txt', 'rd /s /q foo', 'Remove-Item bar', 'taskkill /IM node.exe /F'];
  for (const cmd of destructiveCmds) {
    const res = await runTerminalCommand.execute({ command: cmd });
    assert.strictEqual(res.status, 'awaiting_confirmation', `Command should be blocked: ${cmd}`);
    assert.ok(res.pendingAction?.id, `Blocked command should have pendingAction.id: ${cmd}`);
  }

  console.log('✓ All P0 security tests passed!');
}

runTests().catch((err) => {
  console.error('✗ P0 security test failed:', err);
  process.exit(1);
});
