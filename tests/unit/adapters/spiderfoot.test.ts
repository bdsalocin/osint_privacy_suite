import { describe, it, expect, vi } from 'vitest';
import { SpiderfootAdapter } from '../../../src/core/adapters/spiderfoot.js';

describe('SpiderfootAdapter', () => {
  it('validates targets', async () => {
    const adapter = new SpiderfootAdapter();
    const result = await adapter.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires an email, username, phone, or domain');
  });

  it('checks health when installation is missing or valid', async () => {
    const adapterMissing = new SpiderfootAdapter({
      spiderfootDir: '/non/existent/sf_dir',
    });
    const healthMissing = await adapterMissing.checkHealth();
    expect(healthMissing.installed).toBe(false);

    const mockRunner = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'SpiderFoot 4.0.0',
      stderr: '',
      durationMs: 40,
      timedOut: false,
    });

    const adapterValid = new SpiderfootAdapter({
      spiderfootDir: '/mock/sf',
      pythonBinary: '/mock/sf/venv/bin/python',
      customRunner: mockRunner,
    });

    vi.spyOn(adapterValid as any, 'isExecutable').mockResolvedValue(true);
    // Mock fs checks
    vi.mock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        existsSync: (p: string) => p.includes('/mock/sf') || actual.existsSync(p),
      };
    });

    const healthValid = await adapterValid.checkHealth();
    expect(healthValid.installed).toBe(true);
  });

  it('executes CLI with cwd, -u passive, -o json, -q and parses JSON accounts and leaks', async () => {
    let capturedArgs: string[] = [];
    let capturedOpts: any = null;

    const mockRunner = vi.fn().mockImplementation(async (_cmd, args, opts) => {
      capturedArgs = args;
      capturedOpts = opts;

      const mockJsonArray = [
        {
          generated: 1794169979,
          type: 'Account on External Site',
          data: 'https://github.com/testtarget',
          module: 'sfp_accounts',
          source: 'testtarget',
        },
        {
          generated: 1794169979,
          type: 'LEAKED_CREDENTIAL',
          data: 'testtarget@example.com:plaintext_pwd',
          module: 'sfp_haveibeenpwned',
          source: 'Collection1',
        },
      ];

      return {
        exitCode: 0,
        stdout: JSON.stringify(mockJsonArray),
        stderr: '',
        durationMs: 300,
        timedOut: false,
      };
    });

    const sfDir = '/mock/spiderfoot_dir';
    const adapter = new SpiderfootAdapter({
      spiderfootDir: sfDir,
      customRunner: mockRunner,
    });

    const result = await adapter.execute({
      email: 'testtarget@example.com',
      options: { modules: 'sfp_accounts,sfp_haveibeenpwned' },
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe('spiderfoot');

    // Verify cwd: Mandatory to avoid ModuleNotFoundError in Python
    expect(capturedOpts.cwd).toBe(sfDir);
    expect(capturedOpts.env?.PYTHONPATH).toBe(sfDir);

    // Verify args
    expect(capturedArgs).toEqual([
      'sf.py',
      '-s',
      'testtarget@example.com',
      '-u',
      'passive',
      '-o',
      'json',
      '-q',
      '-m',
      'sfp_accounts,sfp_haveibeenpwned',
    ]);

    // Verify accounts parsed
    expect(result.accounts).toHaveLength(1);
    const acc = result.accounts[0];
    expect(acc.serviceId).toBe('github');
    expect(acc.serviceName).toBe('GitHub');
    expect(acc.domain).toBe('github.com');
    expect(acc.profileUrl).toBe('https://github.com/testtarget');

    // Verify leaks parsed
    expect(result.leaks).toHaveLength(1);
    const leak = result.leaks[0];
    expect(leak.sourceTool).toBe('spiderfoot');
    expect(leak.breachName).toBe('Collection1');
    expect(leak.details).toBe('testtarget@example.com:plaintext_pwd');
  });
});
