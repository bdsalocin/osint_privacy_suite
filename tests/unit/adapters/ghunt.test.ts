import { describe, it, expect, vi } from 'vitest';
import { GHuntAdapter } from '../../../src/core/adapters/ghunt.js';
import path from 'node:path';
import os from 'node:os';

describe('GHuntAdapter', () => {
  it('validates email parameter', async () => {
    const adapter = new GHuntAdapter();
    const result = await adapter.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('valid email');
  });

  it('reports missing session during health check and execution', async () => {
    const nonExistentSession = path.join(os.tmpdir(), `missing_creds_${Date.now()}.m`);
    const adapter = new GHuntAdapter({
      binaryPath: '/mock/ghunt',
      sessionFilePath: nonExistentSession,
    });

    vi.spyOn(adapter as any, 'isExecutable').mockResolvedValue(true);

    const health = await adapter.checkHealth();
    expect(health.installed).toBe(true);
    expect(health.sessionValid).toBe(false);
    expect(health.error).toContain('Google session not found');

    // Execution should fail gracefully without crash
    const execResult = await adapter.execute({ email: 'target@gmail.com' });
    expect(execResult.success).toBe(false);
    expect(execResult.error).toContain('GHunt session not found');
  });

  it('executes CLI without --json and parses Rich stdout into UnifiedAccount', async () => {
    let capturedArgs: string[] = [];

    const mockRunner = vi.fn().mockImplementation(async (_cmd, args) => {
      capturedArgs = args;
      const stdout =
        `[+] Google Account\n` +
        `Name : John Doe\n` +
        `Gaia ID : 109876543210\n` +
        `Profile picture : https://lh3.googleusercontent.com/a/sample_avatar\n` +
        `Last profile edit : 2024-01-15 10:20:00 (UTC)\n` +
        `Chat entity type : USER\n` +
        `[+] YouTube\n` +
        `[+] Maps\n` +
        `[+] Photos\n`;

      return {
        exitCode: 0,
        stdout,
        stderr: '',
        durationMs: 200,
        timedOut: false,
      };
    });

    const fakeSession = path.join(os.tmpdir(), `fake_creds_${Date.now()}.m`);
    const adapter = new GHuntAdapter({
      binaryPath: '/mock/ghunt',
      sessionFilePath: fakeSession,
      customRunner: mockRunner,
    });

    // Bypass session file check via options
    const result = await adapter.execute({
      email: 'johndoe@gmail.com',
      options: { ignoreMissingSession: true },
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe('ghunt');
    expect(result.accounts).toHaveLength(2); // Google account and YouTube account

    const googleAcc = result.accounts.find((a) => a.serviceId === 'google');
    expect(googleAcc).toBeDefined();
    expect(googleAcc?.serviceName).toBe('Google');
    expect(googleAcc?.domain).toBe('google.com');
    expect(googleAcc?.avatarUrl).toBe('https://lh3.googleusercontent.com/a/sample_avatar');
    expect(googleAcc?.metadata.gaiaId).toBe('109876543210');
    expect(googleAcc?.metadata.name).toBe('John Doe');
    expect(googleAcc?.metadata.servicesFound).toContain('YouTube');
    expect(googleAcc?.metadata.servicesFound).toContain('Google Photos');
    expect(googleAcc?.metadata.servicesFound).toContain('Google Maps');

    const youtubeAcc = result.accounts.find((a) => a.serviceId === 'youtube');
    expect(youtubeAcc).toBeDefined();
    expect(youtubeAcc?.serviceName).toBe('YouTube');
    expect(youtubeAcc?.domain).toBe('youtube.com');

    // Verify args: ensure --json is NOT present (avoiding upstream NameError bug)
    expect(capturedArgs).toEqual(['email', 'johndoe@gmail.com']);
    expect(capturedArgs).not.toContain('--json');
  });

  it('detects invalid or expired session error from GHunt output', async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'ghunt.errors.GHuntInvalidSession: No stored session found.',
      durationMs: 60,
      timedOut: false,
    });

    const adapter = new GHuntAdapter({
      binaryPath: '/mock/ghunt',
      customRunner: mockRunner,
    });

    const result = await adapter.execute({
      email: 'test@gmail.com',
      options: { ignoreMissingSession: true },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('GHunt session expired or invalid');
  });
});
