import { describe, it, expect } from 'vitest';
import { BaseAdapter } from '../../src/core/adapters/base-adapter.js';
import { ToolOrchestrator } from '../../src/core/orchestrator.js';
import { SupportedTool, ToolExecutionContext, ToolHealth, ToolResult } from '../../src/core/types.js';

class RealSleepAdapter extends BaseAdapter {
  readonly name: SupportedTool = 'holehe';
  public spawnedPid?: number;

  async checkHealth(): Promise<ToolHealth> {
    return { installed: true };
  }

  async execute(context: ToolExecutionContext): Promise<ToolResult> {
    const sleepSec = context.options?.sleepSec ?? 10;
    // We execute sleep directly to test whether the process is terminated on abort
    const res = await this.runCommand('/bin/sleep', [String(sleepSec)], {
      timeoutMs: 30_000,
    });

    return this.createResult({
      success: res.exitCode === 0,
      durationMs: res.durationMs,
      error: res.exitCode !== 0 ? 'Sleep process interrupted or failed' : undefined,
    });
  }
}

describe('Empirical Zombie and Orphan Process Check', () => {
  it('checks whether child process is terminated when scan is cancelled', async () => {
    const adapter = new RealSleepAdapter();
    const orchestrator = new ToolOrchestrator({
      adapters: { holehe: adapter },
    });

    let activeScanId = '';
    const scanPromise = orchestrator.runScan(
      { email: 'test@example.com', options: { sleepSec: 10 } },
      ['holehe'],
      (evt) => {
        if (!activeScanId) activeScanId = evt.scanId;
      }
    );

    // Give process 100ms to spawn
    await new Promise((r) => setTimeout(r, 100));

    // Find the pid of sleep process spawned by our node process
    const { execSync } = await import('node:child_process');
    const pgrepOutput = execSync(`pgrep -P ${process.pid} sleep || true`, { encoding: 'utf-8' }).trim();
    const childPid = parseInt(pgrepOutput.split('\n')[0], 10);

    console.log(`Detected child sleep PID: ${childPid}`);

    // Now cancel scan
    const cancelled = orchestrator.cancelScan(activeScanId);
    expect(cancelled).toBe(true);

    const scanResult = await scanPromise;
    expect(scanResult.toolResults.holehe?.error).toMatch(/cancelled/i);

    // Check if the child process is still running right after cancelScan
    await new Promise((r) => setTimeout(r, 100));

    let isChildStillAlive = false;
    if (childPid && !isNaN(childPid)) {
      try {
        process.kill(childPid, 0); // signal 0 tests existence
        isChildStillAlive = true;
      } catch {
        isChildStillAlive = false;
      }
    }

    console.log(`Is child process ${childPid} still alive after cancelScan? ${isChildStillAlive}`);

    // Clean up if alive
    if (isChildStillAlive && childPid) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {}
    }

    // A robust orchestrator must NOT leave zombie or orphan processes running!
    expect(isChildStillAlive).toBe(false);
  });

  it('checks whether child process is terminated when tool times out at orchestrator level', async () => {
    const adapter = new RealSleepAdapter();
    const orchestrator = new ToolOrchestrator({
      adapters: { holehe: adapter },
      defaultToolTimeoutMs: 150, // Orchestrator timeout is 150ms
    });

    const scanPromise = orchestrator.runScan(
      { email: 'timeout@example.com', options: { sleepSec: 10 } },
      ['holehe']
    );

    // Give process 50ms to spawn
    await new Promise((r) => setTimeout(r, 50));

    const { execSync } = await import('node:child_process');
    const pgrepOutput = execSync(`pgrep -P ${process.pid} sleep || true`, { encoding: 'utf-8' }).trim();
    const childPid = parseInt(pgrepOutput.split('\n')[0], 10);

    console.log(`Detected child sleep PID on timeout test: ${childPid}`);

    const scanResult = await scanPromise;
    expect(scanResult.toolResults.holehe?.error).toMatch(/timed out/i);

    // Wait 50ms after orchestrator timeout
    await new Promise((r) => setTimeout(r, 50));

    let isChildStillAlive = false;
    if (childPid && !isNaN(childPid)) {
      try {
        process.kill(childPid, 0);
        isChildStillAlive = true;
      } catch {
        isChildStillAlive = false;
      }
    }

    console.log(`Is child process ${childPid} still alive after timeout? ${isChildStillAlive}`);

    if (isChildStillAlive && childPid) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {}
    }

    expect(isChildStillAlive).toBe(false);
  });

  it('checks whether child process is terminated via SIGKILL escalation when SIGTERM is ignored', async () => {
    class StubbornProcessAdapter extends BaseAdapter {
      readonly name: SupportedTool = 'holehe';
      async checkHealth() {
        return { installed: true };
      }
      async execute(context: ToolExecutionContext): Promise<ToolResult> {
        const res = await this.runCommand(
          'python3',
          [
            '-c',
            'import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(10)',
          ],
          {
            timeoutMs: 200,
            signal: context.signal,
          }
        );
        return this.createResult({
          success: res.exitCode === 0,
          durationMs: res.durationMs,
        });
      }
    }

    const adapter = new StubbornProcessAdapter();
    const orchestrator = new ToolOrchestrator({
      adapters: { holehe: adapter },
      defaultToolTimeoutMs: 200,
    });

    const scanPromise = orchestrator.runScan(
      { email: 'stubborn@example.com' },
      ['holehe']
    );

    // Give process 100ms to spawn
    await new Promise((r) => setTimeout(r, 100));

    const { execSync } = await import('node:child_process');
    const pgrepOutput = execSync(
      `pgrep -P ${process.pid} -f "signal.SIG_IGN" || true`,
      { encoding: 'utf-8' }
    ).trim();
    const childPid = parseInt(pgrepOutput.split('\n')[0], 10);

    console.log(`Detected stubborn child PID: ${childPid}`);

    const scanResult = await scanPromise;
    expect(scanResult.toolResults.holehe?.error).toMatch(/timed out/i);

    // Wait 700ms (timeout was 200ms + 500ms escalation delay)
    await new Promise((r) => setTimeout(r, 700));

    let isChildStillAlive = false;
    if (childPid && !isNaN(childPid)) {
      try {
        process.kill(childPid, 0);
        isChildStillAlive = true;
      } catch {
        isChildStillAlive = false;
      }
    }

    console.log(`Is stubborn child process ${childPid} still alive after timeout + 700ms? ${isChildStillAlive}`);

    // Clean up if alive
    if (isChildStillAlive && childPid) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {}
    }

    // Must be killed by SIGKILL escalation!
    expect(isChildStillAlive).toBe(false);
  });
});

