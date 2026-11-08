import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { BaseAdapter } from '../../src/core/adapters/base-adapter.js';
import { HoleheAdapter } from '../../src/core/adapters/holehe.js';
import { MaigretAdapter } from '../../src/core/adapters/maigret.js';
import { IgnorantAdapter } from '../../src/core/adapters/ignorant.js';
import { H8mailAdapter } from '../../src/core/adapters/h8mail.js';
import { GHuntAdapter } from '../../src/core/adapters/ghunt.js';
import { SpiderfootAdapter } from '../../src/core/adapters/spiderfoot.js';
import { Normalizer } from '../../src/core/normalizer.js';
import { ToolOrchestrator } from '../../src/core/orchestrator.js';
import { SupportedTool, ToolExecutionContext, ToolHealth, ToolResult, UnifiedAccount, UnifiedLeak } from '../../src/core/types.js';

class SignalTestAdapter extends BaseAdapter {
  readonly name: SupportedTool = 'holehe';
  async checkHealth(): Promise<ToolHealth> {
    return { installed: true };
  }
  async execute(context: ToolExecutionContext): Promise<ToolResult> {
    const res = await this.runCommand('/bin/sh', ['-c', 'kill -9 $$']);
    return this.createResult({
      success: res.exitCode === 0,
      durationMs: res.durationMs,
      error: res.exitCode !== 0 ? `Process killed with exit code ${res.exitCode}` : undefined,
    });
  }
}

describe('Adversarial & Stress Harness — OSINT Adapters, Normalizer & Orchestrator', () => {

  // =========================================================================
  // 0. BaseAdapter Adversarial Tests
  // =========================================================================
  describe('BaseAdapter: Resiliency and process signal handling', () => {
    it('does not mask abnormal termination / fatal kill signal as exitCode 0', async () => {
      const adapter = new SignalTestAdapter();
      const result = await adapter.execute({});
      // When a process is killed by SIGKILL, exitCode should NOT be 0 (success)
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // =========================================================================
  // 1. HoleheAdapter Adversarial Tests
  // =========================================================================
  describe('HoleheAdapter: Resiliency against corrupt CSV & extreme inputs', () => {
    it('handles corrupted, empty, or truncated CSV files without throwing', () => {
      const adapter = new HoleheAdapter();

      // Empty CSV
      expect(adapter.parseCsvOutput('', 'test@example.com')).toEqual([]);

      // Single line (header only)
      expect(adapter.parseCsvOutput('name,domain,rateLimit,exists,emailrecovery,phoneNumber,others', 'test@example.com')).toEqual([]);

      // Corrupted header with missing columns
      const corruptedHeader = 'foo,bar,baz\n1,2,3\n4,5,6';
      expect(adapter.parseCsvOutput(corruptedHeader, 'test@example.com')).toEqual([]);

      // Unclosed quotes and messy rows
      const unclosedQuotesCsv =
        'name,domain,rateLimit,exists,emailrecovery,phoneNumber,others\n' +
        '"github,github.com,False,True,"unclosed quote here,null,null\n' +
        'twitter,twitter.com,False,False,null,null,null\n';
      const parsed = adapter.parseCsvOutput(unclosedQuotesCsv, 'test@example.com');
      // Should not throw, should handle gracefully
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('handles extreme and non-ASCII target emails gracefully', async () => {
      const testDir = await mkdtemp(path.join(os.tmpdir(), 'holehe-adv-'));
      const mockRunner = vi.fn().mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'All results exported',
        durationMs: 50,
        timedOut: false,
      });

      // Write a valid CSV into testDir
      await writeFile(
        path.join(testDir, 'holehe_test.csv'),
        'name,domain,rateLimit,exists,emailrecovery,phoneNumber,others\ngithub,github.com,False,True,null,null,null\n',
        'utf-8'
      );

      const adapter = new HoleheAdapter({
        binaryPath: '/mock/holehe',
        customRunner: mockRunner,
      });

      // Email with complex RFC characters and Unicode
      const extremeEmail = 'user+tag.sub_name!#$%&\'*+-/=?^_{|}~@héhé-test.fr';
      const result = await adapter.execute({
        email: extremeEmail,
        options: { outputDir: testDir },
      });

      expect(result.success).toBe(true);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0].accountIdentifier).toBe(extremeEmail);
      expect(result.accounts[0].id).toBeDefined();
    });

    it('gracefully fails when spawn process crashes with ENOENT', async () => {
      const adapter = new HoleheAdapter({
        binaryPath: '/non/existent/path/holehe_fail_bin',
      });
      const result = await adapter.execute({ email: 'test@example.com' });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // =========================================================================
  // 2. MaigretAdapter Adversarial Tests
  // =========================================================================
  describe('MaigretAdapter: Resiliency against malformed JSON & weird usernames', () => {
    it('handles malformed, primitive, or array JSON data without throwing', () => {
      const adapter = new MaigretAdapter();

      // Null, empty, primitive inputs
      expect(adapter.parseJsonOutput(null as any, 'user1')).toEqual([]);
      expect(adapter.parseJsonOutput(undefined as any, 'user1')).toEqual([]);
      expect(adapter.parseJsonOutput('string' as any, 'user1')).toEqual([]);
      expect(adapter.parseJsonOutput(12345 as any, 'user1')).toEqual([]);
      expect(adapter.parseJsonOutput([] as any, 'user1')).toEqual([]);

      // Malformed site objects inside valid root object
      const dirtyData = {
        site1: null,
        site2: 'not-an-object',
        site3: { status: null },
        site4: { status: { status: 'Unclaimed' } },
        site5: {
          status: { status: 'Claimed', site_name: 'DirtySite' },
          url_user: 'https://dirtysite.com/user1',
          url_main: 'not-a-valid-url',
        },
      };

      const parsed = adapter.parseJsonOutput(dirtyData, 'user1');
      expect(parsed).toHaveLength(1);
      expect(parsed[0].serviceId).toBe('dirtysite');
      expect(parsed[0].status).toBe('claimed');
    });

    it('safely handles usernames with path traversal, emojis, spaces and quotes', async () => {
      const testDir = await mkdtemp(path.join(os.tmpdir(), 'maigret-adv-'));
      let capturedArgs: string[] = [];

      const mockRunner = vi.fn().mockImplementation(async (_cmd, args) => {
        capturedArgs = args;
        return {
          exitCode: 0,
          stdout: 'Completed',
          stderr: '',
          durationMs: 40,
          timedOut: false,
        };
      });

      const adapter = new MaigretAdapter({
        binaryPath: '/mock/maigret',
        customRunner: mockRunner,
      });

      const exoticUsername = '../../evil_user 🚀 "quotes" & accents_éè';
      const result = await adapter.execute({
        username: exoticUsername,
        options: { outputDir: testDir },
      });

      expect(result.success).toBe(true);
      expect(capturedArgs).toContain(exoticUsername);
    });

    it('does not report success when Maigret crashes and leaves a corrupt or empty report file', async () => {
      const testDir = await mkdtemp(path.join(os.tmpdir(), 'maigret-crash-'));
      // Simulate partial corrupted report file created before crash
      await writeFile(path.join(testDir, 'report_crashuser_simple.json'), '{ broken json ...');

      const mockRunner = vi.fn().mockResolvedValue({
        exitCode: 139, // SIGSEGV
        stdout: '',
        stderr: 'Segmentation fault (core dumped)',
        durationMs: 30,
        timedOut: false,
      });

      const adapter = new MaigretAdapter({
        binaryPath: '/mock/maigret',
        customRunner: mockRunner,
      });

      const result = await adapter.execute({
        username: 'crashuser',
        options: { outputDir: testDir },
      });

      // Must NOT be marked success when exitCode is non-zero and no accounts were parsed!
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Segmentation fault|exit code 139/i);
    });
  });

  // =========================================================================
  // 3. IgnorantAdapter Adversarial Tests
  // =========================================================================
  describe('IgnorantAdapter: Resiliency against malformed phone numbers & outputs', () => {
    it('accurately parses extreme phone number representations without KeyError', () => {
      // Multiple leading pluses, spaces, dashes
      const p1 = IgnorantAdapter.parsePhoneNumber('  ++33 (0)6 12-34-56-78  ');
      expect(p1).not.toBeNull();
      expect(p1?.countryCode).toBe('33');
      expect(p1?.nationalNumber).toBe('612345678');
      expect(p1?.fullInternational).toBe('+33612345678');

      // Double zero notation
      const p2 = IgnorantAdapter.parsePhoneNumber('0033612345678');
      expect(p2).not.toBeNull();
      expect(p2?.countryCode).toBe('33');
      expect(p2?.nationalNumber).toBe('612345678');

      // International number with unknown prefix but >= 10 digits
      const p3 = IgnorantAdapter.parsePhoneNumber('+61 412 345 678');
      expect(p3).not.toBeNull();
      expect(p3?.countryCode).toBe('61');
      expect(p3?.nationalNumber).toBe('412345678');

      // US number with dots and parens
      const p4 = IgnorantAdapter.parsePhoneNumber('+1.555.867.5309');
      expect(p4).not.toBeNull();
      expect(p4?.countryCode).toBe('1');
      expect(p4?.nationalNumber).toBe('5558675309');

      // Number containing alphabetic text and phone
      const p5 = IgnorantAdapter.parsePhoneNumber('Tel: 06 12 34 56 78');
      expect(p5).not.toBeNull();
      expect(p5?.countryCode).toBe('33');
      expect(p5?.nationalNumber).toBe('612345678');

      // Completely invalid phone inputs
      expect(IgnorantAdapter.parsePhoneNumber('')).toBeNull();
      expect(IgnorantAdapter.parsePhoneNumber('   ')).toBeNull();
      expect(IgnorantAdapter.parsePhoneNumber('12345')).toBeNull();
      expect(IgnorantAdapter.parsePhoneNumber('+')).toBeNull();
      expect(IgnorantAdapter.parsePhoneNumber('no digits here')).toBeNull();
    });

    it('handles noisy stdout with rate limits and unexpected markers', () => {
      const adapter = new IgnorantAdapter();
      const noisyStdout =
        `[!] Warning: Snapchat API latency high\n` +
        `[+] Snapchat\n` +
        `[x] Instagram\n` +
        `[-] WhatsApp\n` +
        `[+] unknown-custom-service.com\n` +
        `Garbage line 12345\n` +
        `[x] Rate limit exceeded on Telegram\n`;

      const parsed = adapter.parseStdout(noisyStdout, '+33612345678');
      expect(parsed.length).toBeGreaterThanOrEqual(3);

      const snapchat = parsed.find((a) => a.serviceId === 'snapchat');
      expect(snapchat).toBeDefined();
      expect(snapchat?.status).toBe('claimed');

      const instagram = parsed.find((a) => a.serviceId === 'instagram');
      expect(instagram).toBeDefined();
      expect(instagram?.status).toBe('rate_limited');
    });
  });

  // =========================================================================
  // 4. H8mailAdapter Adversarial Tests
  // =========================================================================
  describe('H8mailAdapter: Resiliency against corrupt breach data', () => {
    it('safely parses empty, null, or corrupt targets JSON', () => {
      const adapter = new H8mailAdapter();

      expect(adapter.parseJsonOutput(null, 'test@example.com')).toEqual([]);
      expect(adapter.parseJsonOutput({}, 'test@example.com')).toEqual([]);
      expect(adapter.parseJsonOutput({ targets: 'not-an-array' }, 'test@example.com')).toEqual([]);
      expect(adapter.parseJsonOutput({ targets: [] }, 'test@example.com')).toEqual([]);

      // Targets with null elements or strange structures
      const mixedTargets = {
        targets: [
          null, // Null item in array
          { target: 'test@example.com', data: null }, // Null data
          {
            target: 'test@example.com',
            data: [
              ['Collection1', 'pass123', 'hash456'],
              'SimpleStringBreach',
              { source: 'ExploitIn', details: 'dump' },
              null, // Null row
            ],
          },
        ],
      };

      // Ensure that null target in targets does NOT throw unhandled TypeError
      let parsed: UnifiedLeak[] = [];
      expect(() => {
        parsed = adapter.parseJsonOutput(mixedTargets, 'test@example.com');
      }).not.toThrow();

      expect(parsed.length).toBeGreaterThanOrEqual(3);
    });
  });

  // =========================================================================
  // 5. GHuntAdapter Adversarial Tests
  // =========================================================================
  describe('GHuntAdapter: Resiliency against unauthenticated sessions & noisy stdout', () => {
    it('returns informative failure when session creds file is missing', async () => {
      const adapter = new GHuntAdapter({
        sessionFilePath: '/tmp/non_existent_ghunt_creds_' + Date.now(),
      });

      const result = await adapter.execute({ email: 'target@gmail.com' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('session not found');
    });

    it('parses noisy, multiline Rich CLI stdout with missing fields', () => {
      const adapter = new GHuntAdapter();
      const noisyStdout =
        `╭─────────── Google Account ───────────╮\n` +
        `│ Name : Jean Test                  │\n` +
        `│ Gaia ID : 109876543219876543210      │\n` +
        `│ Profile picture : https://lh3.googleusercontent.com/a/photo.jpg │\n` +
        `│ Last profile edit : 2026-03-01 10:00 │\n` +
        `│ Chat entity type : User              │\n` +
        `│ [+] YouTube                          │\n` +
        `│ [+] Google Photos                    │\n` +
        `╰──────────────────────────────────────╯\n`;

      const accounts = adapter.parseStdout(noisyStdout, 'target@gmail.com');
      expect(accounts).toHaveLength(2); // Google account + YouTube

      const googleAcc = accounts.find((a) => a.serviceId === 'google');
      expect(googleAcc).toBeDefined();
      expect(googleAcc?.metadata.name).toBe('Jean Test');
      expect(googleAcc?.metadata.gaiaId).toBe('109876543219876543210');
      expect(googleAcc?.avatarUrl).toContain('lh3.googleusercontent.com');

      const youtubeAcc = accounts.find((a) => a.serviceId === 'youtube');
      expect(youtubeAcc).toBeDefined();
    });

    it('handles stdout with no Google account found gracefully', () => {
      const adapter = new GHuntAdapter();
      const emptyStdout = 'Searching...\n[-] No account found for target@example.com\nDone.\n';
      const accounts = adapter.parseStdout(emptyStdout, 'target@example.com');
      expect(accounts).toEqual([]);
    });
  });

  // =========================================================================
  // 6. SpiderfootAdapter Adversarial Tests
  // =========================================================================
  describe('SpiderfootAdapter: Resiliency against corrupt stdout JSON & banners', () => {
    it('extracts JSON array embedded in noisy banners and stderr logs', () => {
      const adapter = new SpiderfootAdapter();
      const noisyOutput =
        `****************************************************************\n` +
        `* SpiderFoot 4.0.0 by Steve Micallef                           *\n` +
        `****************************************************************\n` +
        `[INFO] Starting scan for target.com\n` +
        `[\n` +
        `  {"generated": 1700000000, "type": "ACCOUNT_EXTERNAL_OWNED", "data": "https://github.com/target", "module": "sfp_accounts", "source": "github.com"},\n` +
        `  {"generated": 1700000001, "type": "LEAKED_PASSWORD", "data": "hash:pass123", "module": "sfp_pwned", "source": "HaveIBeenPwned"}\n` +
        `]\n` +
        `[INFO] Scan completed.\n`;

      const { accounts, leaks } = adapter.parseJsonStdout(noisyOutput, 'target@example.com');
      expect(accounts).toHaveLength(1);
      expect(accounts[0].serviceId).toBe('github');
      expect(leaks).toHaveLength(1);
      expect(leaks[0].sourceTool).toBe('spiderfoot');
    });

    it('does not crash when JSON in stdout is completely truncated or invalid', () => {
      const adapter = new SpiderfootAdapter();
      const truncatedOutput = `[INFO] Scan started\n[ {"type": "ACCOUNT", "data": "broken json ...`;
      const { accounts, leaks } = adapter.parseJsonStdout(truncatedOutput, 'target');
      expect(accounts).toEqual([]);
      expect(leaks).toEqual([]);
    });
  });

  // =========================================================================
  // 7. Normalizer Adversarial Tests
  // =========================================================================
  describe('Normalizer: Extreme edge cases and data deduplication', () => {
    it('normalizes partial accounts with missing fields safely', () => {
      const acc = Normalizer.normalizeAccount({});
      expect(acc.serviceId).toBe('unknown_service');
      expect(acc.domain).toBe('unknown_service.com');
      expect(acc.status).toBe('claimed');
      expect(acc.cleaned).toBe(false);
      expect(acc.metadata).toEqual({});
    });

    it('guards against null or undefined items in deduplicateAccounts and deduplicateLeaks', () => {
      expect(() => {
        const accountsWithNull = Normalizer.deduplicateAccounts([null as any, undefined as any]);
        expect(Array.isArray(accountsWithNull)).toBe(true);
      }).not.toThrow();

      expect(() => {
        const leaksWithNull = Normalizer.deduplicateLeaks([null as any, undefined as any]);
        expect(Array.isArray(leaksWithNull)).toBe(true);
      }).not.toThrow();

      expect(() => {
        const resultsWithNull = Normalizer.normalizeResults([null as any, undefined as any]);
        expect(resultsWithNull.accounts).toBeDefined();
        expect(resultsWithNull.leaks).toBeDefined();
      }).not.toThrow();
    });

    it('handles thousands of duplicate accounts with high efficiency', () => {
      const accounts: UnifiedAccount[] = [];
      for (let i = 0; i < 2000; i++) {
        accounts.push({
          id: `id_${i}`,
          serviceId: i % 2 === 0 ? 'github' : 'GITHUB',
          serviceName: 'GitHub',
          domain: 'github.com',
          accountIdentifier: 'target_user',
          sourceTool: i % 3 === 0 ? 'holehe' : 'maigret',
          status: 'claimed',
          metadata: { iteration: i },
          cleaned: false,
        });
      }

      const startTime = Date.now();
      const deduped = Normalizer.deduplicateAccounts(accounts);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(200); // Must be very fast (O(N))
      expect(deduped).toHaveLength(1);
      expect(deduped[0].serviceId).toBe('github');
      expect(deduped[0].metadata.sourceTools).toContain('holehe');
      expect(deduped[0].metadata.sourceTools).toContain('maigret');
    });

    it('merges account attributes prioritizing claimed status and rich metadata', () => {
      const acc1: UnifiedAccount = {
        id: 'acc1',
        serviceId: 'twitter',
        serviceName: 'twitter',
        domain: 'twitter.com',
        accountIdentifier: 'victim',
        sourceTool: 'holehe',
        status: 'rate_limited',
        metadata: { rateLimit: true },
        cleaned: false,
      };

      const acc2: UnifiedAccount = {
        id: 'acc2',
        serviceId: 'twitter',
        serviceName: 'Twitter / X',
        domain: 'twitter.com',
        accountIdentifier: 'victim',
        sourceTool: 'maigret',
        status: 'claimed',
        profileUrl: 'https://twitter.com/victim',
        avatarUrl: 'https://pbs.twimg.com/avatar.jpg',
        metadata: { rank: 10 },
        cleaned: false,
      };

      const deduped = Normalizer.deduplicateAccounts([acc1, acc2]);
      expect(deduped).toHaveLength(1);
      const merged = deduped[0];

      expect(merged.status).toBe('claimed'); // Claimed over rate_limited
      expect(merged.serviceName).toBe('Twitter / X'); // Richer service name
      expect(merged.profileUrl).toBe('https://twitter.com/victim');
      expect(merged.avatarUrl).toBe('https://pbs.twimg.com/avatar.jpg');
      expect(merged.metadata.sourceTools).toEqual(expect.arrayContaining(['holehe', 'maigret']));
    });

    it('deduplicates leaks by (target, breachName) merging dataClasses and details', () => {
      const leak1: UnifiedLeak = {
        id: 'l1',
        target: 'test@example.com',
        sourceTool: 'h8mail',
        breachName: 'Collection1',
        dataClasses: ['passwords'],
        details: 'Hash found',
      };

      const leak2: UnifiedLeak = {
        id: 'l2',
        target: 'test@example.com',
        sourceTool: 'spiderfoot',
        breachName: 'Collection1',
        dataClasses: ['emails', 'usernames'],
        details: 'Email exposed in leak',
      };

      const deduped = Normalizer.deduplicateLeaks([leak1, leak2]);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].dataClasses).toEqual(expect.arrayContaining(['passwords', 'emails', 'usernames']));
      expect(deduped[0].details).toContain('Hash found');
      expect(deduped[0].details).toContain('Email exposed in leak');
    });
  });

  // =========================================================================
  // 8. ToolOrchestrator Adversarial & Stress Tests
  // =========================================================================
  describe('ToolOrchestrator: Concurrent stress & failure modes', () => {
    it('executes in parallel with chaotic adapters without unhandled rejection', async () => {
      // Create chaotic adapters simulating edge behaviors
      const fastSucceedAdapter = {
        name: 'holehe' as const,
        checkHealth: vi.fn().mockResolvedValue({ installed: true }),
        execute: vi.fn().mockResolvedValue({
          toolName: 'holehe',
          success: true,
          durationMs: 20,
          rawOutput: {},
          accounts: [{
            id: 'h1',
            serviceId: 'github',
            serviceName: 'GitHub',
            domain: 'github.com',
            accountIdentifier: 'victim@example.com',
            sourceTool: 'holehe',
            status: 'claimed',
            metadata: {},
            cleaned: false,
          }],
          leaks: [],
        }),
      };

      const crashingAdapter = {
        name: 'maigret' as const,
        checkHealth: vi.fn().mockResolvedValue({ installed: true }),
        execute: vi.fn().mockRejectedValue(new Error('Fatal segmentation fault in C extension')),
      };

      const hangingAdapter = {
        name: 'spiderfoot' as const,
        checkHealth: vi.fn().mockResolvedValue({ installed: true }),
        execute: vi.fn().mockImplementation(() => new Promise(() => {})), // Never resolves
      };

      const orchestrator = new ToolOrchestrator({
        adapters: {
          holehe: fastSucceedAdapter,
          maigret: crashingAdapter,
          spiderfoot: hangingAdapter,
        },
        defaultToolTimeoutMs: 150, // Short timeout for stress test
      });

      const events: any[] = [];
      const result = await orchestrator.runScan(
        { email: 'victim@example.com', username: 'victim' },
        ['holehe', 'maigret', 'spiderfoot'],
        (evt) => events.push(evt)
      );

      // Verify orchestrator remained stable and produced structured result
      expect(result.scanId).toBeDefined();
      expect(result.toolResults.holehe?.success).toBe(true);
      expect(result.toolResults.maigret?.success).toBe(false);
      expect(result.toolResults.maigret?.error).toContain('Fatal segmentation fault');
      expect(result.toolResults.spiderfoot?.success).toBe(false);
      expect(result.toolResults.spiderfoot?.error).toContain('timed out');

      // Discovered accounts from succeeding adapter are still collected
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0].serviceId).toBe('github');

      // Verify events stream
      const completedEvents = events.filter((e) => e.status === 'completed');
      const failedEvents = events.filter((e) => e.status === 'failed');
      expect(completedEvents.some((e) => e.tool === 'holehe')).toBe(true);
      expect(failedEvents.some((e) => e.tool === 'maigret')).toBe(true);
      expect(failedEvents.some((e) => e.tool === 'spiderfoot')).toBe(true);
    });

    it('handles rapid scan cancellation without hanging or memory leaks', async () => {
      const slowAdapter = {
        name: 'holehe' as const,
        checkHealth: vi.fn().mockResolvedValue({ installed: true }),
        execute: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 5000))
        ),
      };

      const orchestrator = new ToolOrchestrator({
        adapters: { holehe: slowAdapter },
      });

      const scanPromise = orchestrator.runScan(
        { email: 'test@example.com' },
        ['holehe']
      );

      // Let scan start, then immediately cancel
      await new Promise((r) => setTimeout(r, 20));
      // Extract active scan ID
      const activeScanId = Array.from((orchestrator as any).activeScans.keys())[0] as string;
      expect(activeScanId).toBeDefined();

      const cancelled = orchestrator.cancelScan(activeScanId);
      expect(cancelled).toBe(true);

      const result = await scanPromise;
      expect(result.toolResults.holehe?.success).toBe(false);
      expect(result.toolResults.holehe?.error).toContain('cancelled');
    });

    it('handles empty inputs without any failure or exception', async () => {
      const orchestrator = new ToolOrchestrator();
      const result = await orchestrator.runScan({});
      expect(result.scanId).toBeDefined();
      expect(result.accounts).toHaveLength(0);
      expect(result.leaks).toHaveLength(0);
      expect(result.summary.successfulTools).toBe(0);
    });
  });
});
