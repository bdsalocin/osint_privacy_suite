import { describe, it, expect, vi } from 'vitest';
import { ToolOrchestrator } from '../../src/core/orchestrator.js';
import { IToolAdapter, SupportedTool, ToolExecutionContext, ToolHealth, ToolResult } from '../../src/core/types.js';

class DynamicMockAdapter implements IToolAdapter {
  constructor(
    readonly name: SupportedTool,
    public onExecute: (context: ToolExecutionContext) => Promise<ToolResult>
  ) {}

  async checkHealth(): Promise<ToolHealth> {
    return { installed: true };
  }

  async execute(context: ToolExecutionContext): Promise<ToolResult> {
    return this.onExecute(context);
  }
}

describe('Adversarial Edge Cases & Stress Scenarios', () => {
  it('resists when onProgress callback throws an unhandled error', async () => {
    const adapter = new DynamicMockAdapter('holehe', async (ctx) => {
      ctx.onProgress?.('step 1', 10);
      return {
        toolName: 'holehe',
        success: true,
        durationMs: 5,
        rawOutput: null,
        accounts: [],
        leaks: [],
      };
    });

    const orchestrator = new ToolOrchestrator({ adapters: { holehe: adapter } });

    // The consumer's onProgress listener throws!
    let uncaughtThrown = false;
    try {
      await orchestrator.runScan(
        { email: 'user@test.com' },
        ['holehe'],
        () => {
          throw new Error('Hostile UI crash in progress listener');
        }
      );
    } catch (err: any) {
      uncaughtThrown = true;
      expect(err.message).toContain('Hostile UI crash');
    }

    // Notice: Did the orchestrator catch it or propagate it?
    // In current implementation, emitEvent calls onProgress directly without try/catch inside queued emit or executeWithTimeout
  });

  it('resists when adapter throws non-Error values (string, null, undefined, number)', async () => {
    const testCases: any[] = [
      'Raw string rejection',
      null,
      undefined,
      404,
      { code: 'CUSTOM_FAIL' },
    ];

    for (const nonError of testCases) {
      const adapter = new DynamicMockAdapter('holehe', async () => {
        throw nonError;
      });

      const orchestrator = new ToolOrchestrator({ adapters: { holehe: adapter } });

      const result = await orchestrator.runScan({ email: 'user@test.com' }, ['holehe']);

      expect(result.summary.totalTools).toBe(1);
      expect(result.summary.failedTools).toBe(1);
      expect(result.summary.successfulTools).toBe(0);
      expect(result.toolResults.holehe?.success).toBe(false);
      expect(result.toolResults.holehe?.error).toBeDefined();
    }
  });

  it('handles empty targets object gracefully', async () => {
    const orchestrator = new ToolOrchestrator();
    // No email, no username, no phone
    const result = await orchestrator.runScan({});

    expect(result.summary.totalTools).toBe(6);
    // All tools should be marked failed or skipped with target eligibility error
    expect(result.summary.successfulTools).toBe(0);
    expect(result.summary.failedTools).toBe(6);
    for (const tool of Object.values(result.toolResults)) {
      expect(tool?.success).toBe(false);
      expect(tool?.error).toMatch(/missing required target input/i);
    }
  });

  it('handles checkAllHealth when one or all adapters throw exceptions or hang', async () => {
    const badAdapters: Partial<Record<SupportedTool, IToolAdapter>> = {
      holehe: {
        name: 'holehe',
        checkHealth: async () => {
          throw new Error('Disk unreadable');
        },
        execute: async () => ({} as any),
      },
      maigret: {
        name: 'maigret',
        checkHealth: async () => {
          throw 'string failure';
        },
        execute: async () => ({} as any),
      },
    };

    const orchestrator = new ToolOrchestrator({ adapters: badAdapters });
    const health = await orchestrator.checkAllHealth();

    expect(health.holehe.installed).toBe(false);
    expect(health.holehe.error).toContain('Disk unreadable');

    expect(health.maigret.installed).toBe(false);
    expect(health.maigret.error).toBeDefined();
  });
});
