import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { ToolOrchestrator } from '../../src/core/orchestrator.js';
import { BaseAdapter } from '../../src/core/adapters/base-adapter.js';
import {
  IToolAdapter,
  OrchestratorProgressEvent,
  SupportedTool,
  ToolExecutionContext,
  ToolHealth,
  ToolResult,
} from '../../src/core/types.js';

class MockDelayAdapter implements IToolAdapter {
  public executionCount = 0;
  public activeExecutions = 0;
  public peakConcurrent = 0;

  constructor(
    readonly name: SupportedTool,
    private delayMs: number = 20,
    private shouldFail: boolean = false,
    private shouldThrow: boolean = false
  ) {}

  async checkHealth(): Promise<ToolHealth> {
    return { installed: true, version: '1.0.0' };
  }

  async execute(context: ToolExecutionContext): Promise<ToolResult> {
    this.executionCount++;
    this.activeExecutions++;
    if (this.activeExecutions > this.peakConcurrent) {
      this.peakConcurrent = this.activeExecutions;
    }

    context.onProgress?.(`Starting ${this.name}`, 10);

    if (this.shouldThrow) {
      this.activeExecutions--;
      throw new Error(`Uncaught exception in adapter ${this.name}`);
    }

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    this.activeExecutions--;

    if (this.shouldFail) {
      return {
        toolName: this.name,
        success: false,
        durationMs: this.delayMs,
        rawOutput: null,
        error: `Tool ${this.name} simulated failure`,
        accounts: [],
        leaks: [],
      };
    }

    return {
      toolName: this.name,
      success: true,
      durationMs: this.delayMs,
      rawOutput: null,
      accounts: [
        {
          id: `${this.name}_acc_${this.executionCount}`,
          serviceId: this.name,
          serviceName: this.name.toUpperCase(),
          domain: `${this.name}.example.com`,
          accountIdentifier: context.email || context.username || context.phone || 'target',
          sourceTool: this.name,
          status: 'claimed',
          cleaned: false,
          metadata: { run: this.executionCount },
        },
      ],
      leaks: [],
    };
  }
}

// Subclass of BaseAdapter that spawns real OS processes to test process lifecycle
class RealProcessAdapter extends BaseAdapter {
  readonly name: SupportedTool;
  public lastSpawnedPid?: number;

  constructor(name: SupportedTool, defaultTimeoutMs: number = 10_000) {
    super({ defaultTimeoutMs });
    this.name = name;
  }

  async checkHealth(): Promise<ToolHealth> {
    return { installed: true };
  }

  async execute(context: ToolExecutionContext): Promise<ToolResult> {
    const sleepSeconds = context.options?.sleepSeconds ?? 10;
    // We run sleep command via runCommand to observe real child_process lifecycle
    const result = await this.runCommand('/bin/sleep', [String(sleepSeconds)], {
      timeoutMs: context.options?.timeoutMs ?? this.defaultTimeoutMs,
    });

    return this.createResult({
      success: result.exitCode === 0,
      durationMs: result.durationMs,
      error: result.exitCode !== 0 ? `Process exited with code ${result.exitCode}` : undefined,
    });
  }
}

describe('Empirical Concurrency & Resilience Stress Harness', () => {
  it('handles high volume concurrent scans without state cross-contamination', async () => {
    const adapters: Record<SupportedTool, MockDelayAdapter> = {
      holehe: new MockDelayAdapter('holehe', 15),
      maigret: new MockDelayAdapter('maigret', 25),
      ignorant: new MockDelayAdapter('ignorant', 10),
      h8mail: new MockDelayAdapter('h8mail', 20),
      ghunt: new MockDelayAdapter('ghunt', 15),
      spiderfoot: new MockDelayAdapter('spiderfoot', 30),
    };

    const orchestrator = new ToolOrchestrator({ adapters });

    const totalScans = 25;
    const scanPromises: Promise<any>[] = [];
    const scanEvents: Map<string, OrchestratorProgressEvent[]> = new Map();

    for (let i = 0; i < totalScans; i++) {
      const targetEmail = `user${i}@domain${i}.org`;
      const targetUser = `user_${i}`;
      const targetPhone = `+336000000${String(i).padStart(2, '0')}`;

      const p = orchestrator.runScan(
        { email: targetEmail, username: targetUser, phone: targetPhone },
        ['holehe', 'maigret', 'ignorant', 'h8mail', 'ghunt', 'spiderfoot'],
        (evt) => {
          if (!scanEvents.has(evt.scanId)) {
            scanEvents.set(evt.scanId, []);
          }
          scanEvents.get(evt.scanId)!.push(evt);
        }
      );
      scanPromises.push(p);
    }

    const results = await Promise.all(scanPromises);

    expect(results).toHaveLength(totalScans);

    // Verify each scan maintained isolated identity and results
    const scanIds = new Set<string>();
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      expect(scanIds.has(res.scanId)).toBe(false);
      scanIds.add(res.scanId);

      expect(res.summary.totalTools).toBe(6);
      expect(res.summary.successfulTools).toBe(6);
      expect(res.summary.failedTools).toBe(0);

      // Verify account identifiers match the specific target
      const expectedEmail = `user${i}@domain${i}.org`;
      const expectedUser = `user_${i}`;
      const expectedPhone = `+336000000${String(i).padStart(2, '0')}`;

      for (const acc of res.accounts) {
        expect([expectedEmail, expectedUser, expectedPhone]).toContain(acc.accountIdentifier);
      }

      // Check events received for this scan
      const events = scanEvents.get(res.scanId) ?? [];
      const queued = events.filter((e) => e.status === 'queued');
      const completed = events.filter((e) => e.status === 'completed');
      expect(queued).toHaveLength(6);
      expect(completed).toHaveLength(6);
    }
  });

  it('handles simultaneous mixed failures (timeout + throw + normal failure + success)', async () => {
    const adapters = {
      holehe: new MockDelayAdapter('holehe', 10), // Succeeds
      maigret: new MockDelayAdapter('maigret', 200), // Times out (scan timeout 50ms)
      ignorant: new MockDelayAdapter('ignorant', 5, false, true), // Throws unhandled exception
      h8mail: new MockDelayAdapter('h8mail', 5, true), // Fails normally (success: false)
      ghunt: new MockDelayAdapter('ghunt', 15), // Succeeds
      spiderfoot: new MockDelayAdapter('spiderfoot', 250), // Times out
    };

    const orchestrator = new ToolOrchestrator({
      adapters,
      defaultToolTimeoutMs: 50,
    });

    const result = await orchestrator.runScan(
      { email: 'mixed@test.com', username: 'mixed', phone: '+33611223344' },
      ['holehe', 'maigret', 'ignorant', 'h8mail', 'ghunt', 'spiderfoot']
    );

    expect(result.summary.totalTools).toBe(6);
    expect(result.summary.successfulTools).toBe(2); // holehe, ghunt
    expect(result.summary.failedTools).toBe(4); // maigret (timeout), ignorant (crash), h8mail (error), spiderfoot (timeout)

    // Detailed assertions on errors
    expect(result.toolResults.holehe?.success).toBe(true);
    expect(result.toolResults.ghunt?.success).toBe(true);

    expect(result.toolResults.maigret?.success).toBe(false);
    expect(result.toolResults.maigret?.error).toMatch(/timed out/i);

    expect(result.toolResults.spiderfoot?.success).toBe(false);
    expect(result.toolResults.spiderfoot?.error).toMatch(/timed out/i);

    expect(result.toolResults.ignorant?.success).toBe(false);
    expect(result.toolResults.ignorant?.error).toMatch(/Uncaught exception/i);

    expect(result.toolResults.h8mail?.success).toBe(false);
    expect(result.toolResults.h8mail?.error).toMatch(/simulated failure/i);

    // Clean resolution: timing metrics are present
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.completedAt).toBeDefined();
  });

  it('cancels immediately after trigger and ensures no dangling unhandled rejections', async () => {
    const slowAdapters = {
      holehe: new MockDelayAdapter('holehe', 300),
      maigret: new MockDelayAdapter('maigret', 300),
      spiderfoot: new MockDelayAdapter('spiderfoot', 300),
    };

    const orchestrator = new ToolOrchestrator({
      adapters: slowAdapters,
    });

    let detectedScanId = '';
    const scanPromise = orchestrator.runScan(
      { email: 'abort@test.com', username: 'abort_user' },
      ['holehe', 'maigret', 'spiderfoot'],
      (evt) => {
        if (!detectedScanId) detectedScanId = evt.scanId;
      }
    );

    // Wait minimal time then cancel
    await new Promise((r) => setTimeout(r, 20));
    const wasCancelled = orchestrator.cancelScan(detectedScanId);
    expect(wasCancelled).toBe(true);

    const result = await scanPromise;
    expect(result.scanId).toBe(detectedScanId);

    // All running tools should be marked cancelled
    for (const tool of ['holehe', 'maigret', 'spiderfoot'] as SupportedTool[]) {
      const res = result.toolResults[tool];
      expect(res).toBeDefined();
      expect(res?.success).toBe(false);
      expect(res?.error).toMatch(/cancelled/i);
    }
  });

  it('cancelScan handles unknown scan IDs and repeated cancellation idempotently', async () => {
    const orchestrator = new ToolOrchestrator();

    expect(orchestrator.cancelScan('non-existent-scan-id')).toBe(false);

    const slowAdapters = {
      holehe: new MockDelayAdapter('holehe', 200),
    };
    const orch2 = new ToolOrchestrator({ adapters: slowAdapters });

    let scanId = '';
    const p = orch2.runScan({ email: 'test@idempotent.org' }, ['holehe'], (evt) => {
      scanId = evt.scanId;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(orch2.cancelScan(scanId)).toBe(true);
    // Second cancel call on same scanId must return false without error
    expect(orch2.cancelScan(scanId)).toBe(false);

    const res = await p;
    expect(res.toolResults.holehe?.error).toMatch(/cancelled/i);
  });
});
