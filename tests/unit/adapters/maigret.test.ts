import { describe, it, expect, vi } from 'vitest';
import { MaigretAdapter } from '../../../src/core/adapters/maigret.js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('MaigretAdapter', () => {
  it('validates target username', async () => {
    const adapter = new MaigretAdapter();
    const result = await adapter.execute({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('valid username');
  });

  it('checks health and extracts version', async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'maigret v0.6.6',
      stderr: '',
      durationMs: 40,
      timedOut: false,
    });

    const adapter = new MaigretAdapter({
      binaryPath: '/mock/maigret',
      customRunner: mockRunner,
    });

    vi.spyOn(adapter as any, 'isExecutable').mockResolvedValue(true);

    const health = await adapter.checkHealth();
    expect(health.installed).toBe(true);
    expect(health.version).toBe('v0.6.6');
  });

  it('executes CLI with required flags and parses JSON output and HTML report path', async () => {
    const testDir = path.join(os.tmpdir(), `test_maigret_${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    const username = 'testuser';
    const jsonPath = path.join(testDir, `report_${username}_simple.json`);
    const htmlPath = path.join(testDir, `report_${username}_plain.html`);

    const mockReportData = {
      GitHub: {
        status: {
          status: 'Claimed',
          url: 'https://github.com/testuser',
          site_name: 'GitHub',
          ids: {
            uid: '98765',
            image: 'https://avatars.githubusercontent.com/u/98765',
            location: 'Paris, France',
          },
          tags: ['coding', 'tech'],
        },
        url_user: 'https://github.com/testuser',
        url_main: 'https://www.github.com/',
        http_status: 200,
        rank: 10,
      },
      Reddit: {
        status: {
          status: 'Available',
          url: 'https://reddit.com/user/testuser',
          site_name: 'Reddit',
        },
      },
    };

    await writeFile(jsonPath, JSON.stringify(mockReportData), 'utf-8');
    await writeFile(htmlPath, '<html><body>Report</body></html>', 'utf-8');

    let capturedArgs: string[] = [];
    const mockRunner = vi.fn().mockImplementation(async (_cmd, args) => {
      capturedArgs = args;
      return {
        exitCode: 0,
        stdout: 'Searching username...',
        stderr: '',
        durationMs: 250,
        timedOut: false,
      };
    });

    const adapter = new MaigretAdapter({
      binaryPath: '/mock/maigret',
      customRunner: mockRunner,
    });

    const progressLogs: string[] = [];
    const result = await adapter.execute({
      username,
      options: { outputDir: testDir, topSites: 200 },
      onProgress: (msg) => progressLogs.push(msg),
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe('maigret');
    expect(result.accounts).toHaveLength(1); // Only Claimed (GitHub)

    const github = result.accounts[0];
    expect(github.serviceId).toBe('github');
    expect(github.serviceName).toBe('GitHub');
    expect(github.domain).toBe('github.com');
    expect(github.profileUrl).toBe('https://github.com/testuser');
    expect(github.avatarUrl).toBe('https://avatars.githubusercontent.com/u/98765');
    expect(github.metadata.tags).toContain('coding');
    expect(github.sourceTool).toBe('maigret');

    // Report paths
    expect(result.reportPaths?.json).toBe(jsonPath);
    expect(result.reportPaths?.html).toBe(htmlPath);

    // Verify flags
    expect(capturedArgs).toContain(username);
    expect(capturedArgs).toContain('--no-progressbar');
    expect(capturedArgs).toContain('--no-color');
    expect(capturedArgs).toContain('--no-autoupdate');
    expect(capturedArgs).toContain('-J');
    expect(capturedArgs).toContain('simple');
    expect(capturedArgs).toContain('-H');
    expect(capturedArgs).toContain('--top-sites');
    expect(capturedArgs).toContain('200');
  });
});
