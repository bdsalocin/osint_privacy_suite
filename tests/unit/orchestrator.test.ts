import { describe, it, expect, vi } from 'vitest';
import { ToolOrchestrator } from '../../src/core/orchestrator.js';
import { IToolAdapter, OrchestratorProgressEvent, SupportedTool, ToolExecutionContext, ToolHealth, ToolResult } from '../../src/core/types.js';

class MockAdapter implements IToolAdapter {
  constructor(
    readonly name: SupportedTool,
    private mockResult: Partial<ToolResult> = {},
    private delayMs: number = 10,
    private shouldThrow: boolean = false
  ) {}

  async checkHealth(): Promise<ToolHealth> {
    return { installed: true, version: '1.0.0' };
  }

  async execute(context: ToolExecutionContext): Promise<ToolResult> {
    if (this.shouldThrow) {
      throw new Error(`Fatal mock crash in ${this.name}`);
    }

    context.onProgress?.(`Mock progress from ${this.name}`, 50);

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    return {
      toolName: this.name,
      success: this.mockResult.success ?? true,
      durationMs: this.delayMs,
      rawOutput: null,
      error: this.mockResult.error,
      accounts: this.mockResult.accounts ?? [],
      leaks: this.mockResult.leaks ?? [],
      ...this.mockResult,
    };
  }
}

describe('ToolOrchestrator', () => {
  it('registers and retrieves adapters', () => {
    const orchestrator = new ToolOrchestrator();
    const mockHolehe = new MockAdapter('holehe');
    orchestrator.registerAdapter('holehe', mockHolehe);

    expect(orchestrator.getAdapter('holehe')).toBe(mockHolehe);
  });

  it('runs checkAllHealth on all registered tools', async () => {
    const mockAdapters: Record<SupportedTool, IToolAdapter> = {
      holehe: new MockAdapter('holehe'),
      maigret: new MockAdapter('maigret'),
      ignorant: new MockAdapter('ignorant'),
      h8mail: new MockAdapter('h8mail'),
      ghunt: new MockAdapter('ghunt'),
      spiderfoot: new MockAdapter('spiderfoot'),
    };

    const orchestrator = new ToolOrchestrator({ adapters: mockAdapters });
    const healthReport = await orchestrator.checkAllHealth();

    expect(healthReport.holehe.installed).toBe(true);
    expect(healthReport.maigret.installed).toBe(true);
    expect(healthReport.ignorant.installed).toBe(true);
    expect(healthReport.h8mail.installed).toBe(true);
    expect(healthReport.ghunt.installed).toBe(true);
    expect(healthReport.spiderfoot.installed).toBe(true);
  });

  it('automatically selects relevant tools based on target inputs', async () => {
    const executedTools: string[] = [];

    const makeTrackingAdapter = (name: SupportedTool) => {
      const adapter = new MockAdapter(name);
      vi.spyOn(adapter, 'execute').mockImplementation(async (ctx) => {
        executedTools.push(name);
        return {
          toolName: name,
          success: true,
          durationMs: 5,
          rawOutput: null,
          accounts: [],
          leaks: [],
        };
      });
      return adapter;
    };

    const orchestrator = new ToolOrchestrator({
      adapters: {
        holehe: makeTrackingAdapter('holehe'),
        maigret: makeTrackingAdapter('maigret'),
        ignorant: makeTrackingAdapter('ignorant'),
        h8mail: makeTrackingAdapter('h8mail'),
        ghunt: makeTrackingAdapter('ghunt'),
        spiderfoot: makeTrackingAdapter('spiderfoot'),
      },
    });

    // 1. Email only
    await orchestrator.runScan({ email: 'user@example.com' });
    expect(executedTools).toContain('holehe');
    expect(executedTools).toContain('h8mail');
    expect(executedTools).toContain('ghunt');
    expect(executedTools).toContain('spiderfoot');
    expect(executedTools).not.toContain('maigret');
    expect(executedTools).not.toContain('ignorant');

    // Reset tracker
    executedTools.length = 0;

    // 2. Username only
    await orchestrator.runScan({ username: 'johndoe' });
    expect(executedTools).toContain('maigret');
    expect(executedTools).toContain('h8mail');
    expect(executedTools).toContain('spiderfoot');
    expect(executedTools).not.toContain('holehe');
    expect(executedTools).not.toContain('ignorant');

    // Reset tracker
    executedTools.length = 0;

    // 3. Phone only
    await orchestrator.runScan({ phone: '+33612345678' });
    expect(executedTools).toContain('ignorant');
    expect(executedTools).toContain('spiderfoot');
    expect(executedTools).not.toContain('holehe');
    expect(executedTools).not.toContain('maigret');
  });

  it('runs selected tools in parallel and streams progress events', async () => {
    const progressEvents: OrchestratorProgressEvent[] = [];

    const mockHolehe = new MockAdapter('holehe', {
      accounts: [
        {
          id: 'acc1',
          serviceId: 'github',
          serviceName: 'GitHub',
          domain: 'github.com',
          accountIdentifier: 'target@example.com',
          sourceTool: 'holehe',
          status: 'claimed',
          cleaned: false,
          metadata: {},
        },
      ],
    }, 20);

    const mockH8mail = new MockAdapter('h8mail', {
      leaks: [
        {
          id: 'leak1',
          target: 'target@example.com',
          sourceTool: 'h8mail',
          breachName: 'LinkedIn',
          dataClasses: ['passwords'],
          details: 'Pwned',
        },
      ],
    }, 15);

    const orchestrator = new ToolOrchestrator({
      adapters: {
        holehe: mockHolehe,
        h8mail: mockH8mail,
      },
    });

    const result = await orchestrator.runScan(
      { email: 'target@example.com' },
      ['holehe', 'h8mail'],
      (evt) => progressEvents.push(evt)
    );

    expect(result.scanId).toBeDefined();
    expect(result.summary.totalTools).toBe(2);
    expect(result.summary.successfulTools).toBe(2);
    expect(result.summary.failedTools).toBe(0);
    expect(result.summary.totalAccountsFound).toBe(1);
    expect(result.summary.totalLeaksFound).toBe(1);

    // Verify progress events
    const queuedEvents = progressEvents.filter((e) => e.status === 'queued');
    const runningEvents = progressEvents.filter((e) => e.status === 'running');
    const completedEvents = progressEvents.filter((e) => e.status === 'completed');

    expect(queuedEvents.length).toBe(2);
    expect(runningEvents.length).toBeGreaterThanOrEqual(2);
    expect(completedEvents.length).toBe(2);
  });

  it('handles tool crash or timeout with full resilience (other tools succeed)', async () => {
    const failingAdapter = new MockAdapter('holehe', {}, 10, true); // throws exception
    const slowAdapter = new MockAdapter('maigret', {}, 200); // will timeout
    const successfulAdapter = new MockAdapter('spiderfoot', {
      accounts: [
        {
          id: 'sf_1',
          serviceId: 'reddit',
          serviceName: 'Reddit',
          domain: 'reddit.com',
          accountIdentifier: 'johndoe',
          sourceTool: 'spiderfoot',
          status: 'claimed',
          cleaned: false,
          metadata: {},
        },
      ],
    }, 10);

    const orchestrator = new ToolOrchestrator({
      adapters: {
        holehe: failingAdapter,
        maigret: slowAdapter,
        spiderfoot: successfulAdapter,
      },
      defaultToolTimeoutMs: 50, // Short timeout
    });

    const result = await orchestrator.runScan(
      { email: 'test@example.com', username: 'johndoe' },
      ['holehe', 'maigret', 'spiderfoot']
    );

    // Orchestrator did not throw!
    expect(result.summary.totalTools).toBe(3);
    expect(result.summary.successfulTools).toBe(1);
    expect(result.summary.failedTools).toBe(2);

    // Spiderfoot succeeded
    expect(result.toolResults.spiderfoot?.success).toBe(true);
    expect(result.accounts).toHaveLength(1);

    // Holehe recorded exception error
    expect(result.toolResults.holehe?.success).toBe(false);
    expect(result.toolResults.holehe?.error).toContain('Fatal mock crash');

    // Maigret recorded timeout error
    expect(result.toolResults.maigret?.success).toBe(false);
    expect(result.toolResults.maigret?.error).toContain('timed out');
  });

  it('supports scan cancellation', async () => {
    const slowAdapter = new MockAdapter('maigret', {}, 500);

    const orchestrator = new ToolOrchestrator({
      adapters: { maigret: slowAdapter },
    });

    let currentScanId = '';
    const scanPromise = orchestrator.runScan(
      { username: 'longuser' },
      ['maigret'],
      (evt) => {
        currentScanId = evt.scanId;
      }
    );

    // Cancel after 30ms
    await new Promise((r) => setTimeout(r, 30));
    const cancelled = orchestrator.cancelScan(currentScanId);
    expect(cancelled).toBe(true);

    const result = await scanPromise;
    expect(result.toolResults.maigret?.success).toBe(false);
    expect(result.toolResults.maigret?.error).toContain('cancelled');
  });
});
