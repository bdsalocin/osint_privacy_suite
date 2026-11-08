import { describe, it, expect, vi } from 'vitest';
import { H8mailAdapter } from '../../../src/core/adapters/h8mail.js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('H8mailAdapter', () => {
  it('validates target parameter', async () => {
    const adapter = new H8mailAdapter();
    const result = await adapter.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires an email or username');
  });

  it('checks health and extracts version', async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'h8mail 2.5.6',
      stderr: '',
      durationMs: 30,
      timedOut: false,
    });

    const adapter = new H8mailAdapter({
      binaryPath: '/mock/h8mail',
      customRunner: mockRunner,
    });

    vi.spyOn(adapter as any, 'isExecutable').mockResolvedValue(true);

    const health = await adapter.checkHealth();
    expect(health.installed).toBe(true);
    expect(health.version).toBe('2.5.6');
  });

  it('executes CLI with -sk flag, writes output to JSON, and parses breach records into UnifiedLeak', async () => {
    const testDir = path.join(os.tmpdir(), `test_h8mail_${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    let capturedArgs: string[] = [];
    let jsonOutputPath = '';

    const mockRunner = vi.fn().mockImplementation(async (_cmd, args) => {
      capturedArgs = args;
      const jIdx = args.indexOf('-j');
      if (jIdx !== -1) {
        jsonOutputPath = args[jIdx + 1];
        const mockData = {
          targets: [
            {
              target: 'victim@example.com',
              pwn_num: 2,
              data: [
                ['Collection1', 'password_hash_123'],
                ['Adobe', 'adobe_compromise_info'],
              ],
            },
          ],
        };
        await writeFile(jsonOutputPath, JSON.stringify(mockData), 'utf-8');
      }

      return {
        exitCode: 0,
        stdout: 'Checking breaches...',
        stderr: '',
        durationMs: 150,
        timedOut: false,
      };
    });

    const adapter = new H8mailAdapter({
      binaryPath: '/mock/h8mail',
      customRunner: mockRunner,
    });

    const result = await adapter.execute({
      email: 'victim@example.com',
      options: { outputDir: testDir, apiKeys: 'hibp=fake_key' },
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe('h8mail');
    expect(result.leaks).toHaveLength(2);

    const leak1 = result.leaks[0];
    expect(leak1.target).toBe('victim@example.com');
    expect(leak1.sourceTool).toBe('h8mail');
    expect(leak1.breachName).toBe('Collection1');
    expect(leak1.details).toContain('password_hash_123');

    const leak2 = result.leaks[1];
    expect(leak2.breachName).toBe('Adobe');

    // Verify critical -sk flag (skips defunct Scylla service)
    expect(capturedArgs).toContain('-sk');
    expect(capturedArgs).toContain('-t');
    expect(capturedArgs).toContain('victim@example.com');
    expect(capturedArgs).toContain('-j');
    expect(capturedArgs).toContain('--hide');
    expect(capturedArgs).toContain('-k');
    expect(capturedArgs).toContain('hibp=fake_key');
  });
});
