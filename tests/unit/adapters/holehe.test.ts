import { describe, it, expect, vi } from 'vitest';
import { HoleheAdapter } from '../../../src/core/adapters/holehe.js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('HoleheAdapter', () => {
  it('validates target email', async () => {
    const adapter = new HoleheAdapter();
    const resultNoTarget = await adapter.execute({});
    expect(resultNoTarget.success).toBe(false);
    expect(resultNoTarget.error).toContain('valid email');

    const resultInvalidEmail = await adapter.execute({ email: 'notanemail' });
    expect(resultInvalidEmail.success).toBe(false);
    expect(resultInvalidEmail.error).toContain('valid email');
  });

  it('checks health correctly when binary is missing', async () => {
    const adapter = new HoleheAdapter({ binaryPath: '/non/existent/holehe' });
    const health = await adapter.checkHealth();
    expect(health.installed).toBe(false);
    expect(health.error).toBeDefined();
  });

  it('checks health correctly when binary is available', async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'holehe 2.0.0',
      stderr: '',
      durationMs: 50,
      timedOut: false,
    });

    const adapter = new HoleheAdapter({
      binaryPath: '/mock/holehe',
      customRunner: mockRunner,
    });

    // Mock isExecutable
    vi.spyOn(adapter as any, 'isExecutable').mockResolvedValue(true);

    const health = await adapter.checkHealth();
    expect(health.installed).toBe(true);
    expect(health.version).toBe('latest');
  });

  it('executes CLI with required options and handles exit code 1 with CSV file', async () => {
    const testDir = path.join(os.tmpdir(), `test_holehe_${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Simulate Holehe creating CSV file before exiting with code 1 (Python exit())
    const csvFileName = `holehe_${Date.now()}_test@example.com_results.csv`;
    const csvFilePath = path.join(testDir, csvFileName);
    const mockCsvContent = `name,domain,rateLimit,exists,emailrecovery,phoneNumber,others\n` +
      `github,github.com,False,True,null,null,null\n` +
      `twitter,twitter.com,False,True,null,null,null\n` +
      `spotify,spotify.com,True,False,null,null,null\n`;

    await writeFile(csvFilePath, mockCsvContent, 'utf-8');

    let capturedArgs: string[] = [];
    let capturedCwd = '';

    const mockRunner = vi.fn().mockImplementation(async (_cmd, args, opts) => {
      capturedArgs = args;
      capturedCwd = opts?.cwd;
      return {
        exitCode: 1, // Exit code 1 from Holehe exit("All results exported...")
        stdout: 'Checking services...',
        stderr: `All results have been exported to ${csvFileName}`,
        durationMs: 120,
        timedOut: false,
      };
    });

    const adapter = new HoleheAdapter({
      binaryPath: '/mock/holehe',
      customRunner: mockRunner,
    });

    const progressMessages: string[] = [];
    const result = await adapter.execute({
      email: 'test@example.com',
      options: { outputDir: testDir, noPasswordRecovery: true, timeout: 5 },
      onProgress: (msg) => progressMessages.push(msg),
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe('holehe');
    expect(result.accounts).toHaveLength(2); // github and twitter (claimed)

    // Check account properties
    const githubAcc = result.accounts.find((a) => a.serviceId === 'github');
    expect(githubAcc).toBeDefined();
    expect(githubAcc?.serviceName).toBe('GitHub');
    expect(githubAcc?.domain).toBe('github.com');
    expect(githubAcc?.status).toBe('claimed');
    expect(githubAcc?.sourceTool).toBe('holehe');

    // Verify CLI arguments
    expect(capturedArgs).toContain('test@example.com');
    expect(capturedArgs).toContain('--only-used');
    expect(capturedArgs).toContain('--no-clear');
    expect(capturedArgs).toContain('--no-color');
    expect(capturedArgs).toContain('-C');
    expect(capturedArgs).toContain('-NP');
    expect(capturedArgs).toContain('-T');
    expect(capturedArgs).toContain('5');
    expect(capturedCwd).toBe(testDir);

    expect(progressMessages.length).toBeGreaterThan(0);
  });

  it('correctly handles tool failure when no CSV is produced and exit code is non-zero', async () => {
    const testDir = path.join(os.tmpdir(), `test_holehe_fail_${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    const mockRunner = vi.fn().mockResolvedValue({
      exitCode: 2,
      stdout: '',
      stderr: 'Network error or connection timed out',
      durationMs: 100,
      timedOut: false,
    });

    const adapter = new HoleheAdapter({
      binaryPath: '/mock/holehe',
      customRunner: mockRunner,
    });

    const result = await adapter.execute({
      email: 'fail@example.com',
      options: { outputDir: testDir },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
    expect(result.accounts).toHaveLength(0);
  });
});
