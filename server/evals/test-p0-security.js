import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
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

  // 4. Verify serverConfirmed: true actually deletes a temp file and verifies Ground Truth
  const tempFile = path.join(os.tmpdir(), `p0_security_test_${Date.now()}.txt`);
  fs.writeFileSync(tempFile, 'temporary test file', 'utf8');
  assert.strictEqual(fs.existsSync(tempFile), true, 'Temp file should exist before delete');

  const blockedDel = await fileOperation.execute({ action: 'delete', target: tempFile });
  assert.strictEqual(blockedDel.status, 'awaiting_confirmation', 'Unconfirmed delete should pause');
  assert.ok(blockedDel.pendingAction?.id, 'Blocked delete should have pendingAction.id');
  assert.strictEqual(fs.existsSync(tempFile), true, 'Temp file must still exist before confirmation');

  const confirmedDel = await fileOperation.execute(blockedDel.pendingAction.args, { serverConfirmed: true });
  assert.strictEqual(confirmedDel.success, true, 'Confirmed delete should succeed');
  assert.strictEqual(confirmedDel.verified, true, 'Confirmed delete should be verified');
  assert.strictEqual(fs.existsSync(tempFile), false, 'Temp file must be deleted from disk');

  console.log('✓ All P0 security tests passed!');
}

runTests().catch((err) => {
  console.error('✗ P0 security test failed:', err);
  process.exit(1);
});
