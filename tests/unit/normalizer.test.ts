import { describe, it, expect } from 'vitest';
import { Normalizer } from '../../src/core/normalizer.js';
import { ToolResult, UnifiedAccount, UnifiedLeak } from '../../src/core/types.js';

describe('Normalizer', () => {
  describe('normalizeAccount', () => {
    it('normalizes serviceId, serviceName and domain with defaults', () => {
      const acc = Normalizer.normalizeAccount({
        serviceName: 'github',
        accountIdentifier: 'johndoe',
        sourceTool: 'maigret',
      });

      expect(acc.serviceId).toBe('github');
      expect(acc.serviceName).toBe('github');
      expect(acc.domain).toBe('github.com');
      expect(acc.status).toBe('claimed');
      expect(acc.cleaned).toBe(false);
      expect(acc.id).toBeDefined();
    });

    it('extracts domain from profile URL if domain is missing', () => {
      const acc = Normalizer.normalizeAccount({
        serviceName: 'CustomSite',
        profileUrl: 'https://sub.customsite.org/users/123',
        accountIdentifier: '123',
        sourceTool: 'spiderfoot',
      });

      expect(acc.domain).toBe('sub.customsite.org');
    });
  });

  describe('normalizeLeak', () => {
    it('normalizes target, breachName and defaults dataClasses', () => {
      const leak = Normalizer.normalizeLeak({
        target: 'user@example.com',
        breachName: 'Dropbox',
        sourceTool: 'h8mail',
      });

      expect(leak.target).toBe('user@example.com');
      expect(leak.breachName).toBe('Dropbox');
      expect(leak.dataClasses).toContain('credentials');
      expect(leak.id).toBeDefined();
    });
  });

  describe('deduplicateAccounts', () => {
    it('merges accounts found by different tools for the same service and target', () => {
      const accFromHolehe: UnifiedAccount = {
        id: 'acc_holehe_1',
        serviceId: 'github',
        serviceName: 'github',
        domain: 'github.com',
        accountIdentifier: 'user@example.com',
        sourceTool: 'holehe',
        status: 'claimed',
        cleaned: false,
        metadata: { rateLimit: false },
      };

      const accFromMaigret: UnifiedAccount = {
        id: 'acc_maigret_1',
        serviceId: 'github',
        serviceName: 'GitHub',
        domain: 'github.com',
        accountIdentifier: 'user@example.com',
        sourceTool: 'maigret',
        status: 'claimed',
        profileUrl: 'https://github.com/user',
        avatarUrl: 'https://avatars.github.com/u/1234',
        cleaned: true,
        metadata: { uid: '1234', tags: ['coding'] },
      };

      const deduplicated = Normalizer.deduplicateAccounts([accFromHolehe, accFromMaigret]);

      expect(deduplicated).toHaveLength(1);
      const merged = deduplicated[0];

      expect(merged.serviceId).toBe('github');
      expect(merged.serviceName).toBe('GitHub');
      expect(merged.profileUrl).toBe('https://github.com/user');
      expect(merged.avatarUrl).toBe('https://avatars.github.com/u/1234');
      expect(merged.cleaned).toBe(true); // Preserves cleaned status
      expect(merged.metadata.sourceTools).toEqual(expect.arrayContaining(['holehe', 'maigret']));
      expect(merged.metadata.uid).toBe('1234');
      expect(merged.metadata.rateLimit).toBe(false);
    });

    it('prioritizes claimed status over rate_limited or unclaimed', () => {
      const acc1: UnifiedAccount = {
        id: '1',
        serviceId: 'snapchat',
        serviceName: 'Snapchat',
        domain: 'snapchat.com',
        accountIdentifier: '+33612345678',
        sourceTool: 'ignorant',
        status: 'rate_limited',
        cleaned: false,
        metadata: {},
      };

      const acc2: UnifiedAccount = {
        id: '2',
        serviceId: 'snapchat',
        serviceName: 'Snapchat',
        domain: 'snapchat.com',
        accountIdentifier: '+33612345678',
        sourceTool: 'spiderfoot',
        status: 'claimed',
        cleaned: false,
        metadata: {},
      };

      const merged = Normalizer.deduplicateAccounts([acc1, acc2]);
      expect(merged).toHaveLength(1);
      expect(merged[0].status).toBe('claimed');
    });
  });

  describe('deduplicateLeaks', () => {
    it('merges leaks for the same target and breach, combining dataClasses and details', () => {
      const leak1: UnifiedLeak = {
        id: 'l1',
        target: 'target@example.com',
        sourceTool: 'h8mail',
        breachName: 'Collection1',
        dataClasses: ['passwords'],
        details: 'Hash found in combo',
      };

      const leak2: UnifiedLeak = {
        id: 'l2',
        target: 'target@example.com',
        sourceTool: 'spiderfoot',
        breachName: 'Collection1',
        dataClasses: ['emails', 'usernames'],
        details: 'Listed in breach DB',
      };

      const deduplicated = Normalizer.deduplicateLeaks([leak1, leak2]);
      expect(deduplicated).toHaveLength(1);

      const merged = deduplicated[0];
      expect(merged.breachName).toBe('Collection1');
      expect(merged.dataClasses).toEqual(expect.arrayContaining(['passwords', 'emails', 'usernames']));
      expect(merged.details).toContain('Hash found in combo');
      expect(merged.details).toContain('Listed in breach DB');
    });
  });

  describe('normalizeResults', () => {
    it('aggregates and deduplicates across an array of ToolResults', () => {
      const toolResults: ToolResult[] = [
        {
          toolName: 'holehe',
          success: true,
          durationMs: 100,
          rawOutput: null,
          accounts: [
            {
              id: 'h_1',
              serviceId: 'spotify',
              serviceName: 'Spotify',
              domain: 'spotify.com',
              accountIdentifier: 'test@example.com',
              sourceTool: 'holehe',
              status: 'claimed',
              cleaned: false,
              metadata: {},
            },
          ],
          leaks: [],
        },
        {
          toolName: 'h8mail',
          success: true,
          durationMs: 50,
          rawOutput: null,
          accounts: [],
          leaks: [
            {
              id: 'leak_1',
              target: 'test@example.com',
              sourceTool: 'h8mail',
              breachName: 'Canva',
              dataClasses: ['credentials'],
              details: 'Compromised Canva credentials',
            },
          ],
        },
      ];

      const { accounts, leaks } = Normalizer.normalizeResults(toolResults);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].serviceId).toBe('spotify');
      expect(leaks).toHaveLength(1);
      expect(leaks[0].breachName).toBe('Canva');
    });
  });
});
