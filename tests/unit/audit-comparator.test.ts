import { describe, it, expect } from 'vitest';
import {
  compareAudits,
  getCanonicalAccountKey,
  isAccountResolved,
  formatScoreEvolutionFrench,
} from '../../src/core/audit-comparator.js';
import { UnifiedAccount } from '../../src/core/types.js';

describe('AuditComparator — Chronological Audit Comparison Engine', () => {
  describe('Canonical Key Normalization', () => {
    it('normalizes service names and identifiers to lowercase trimmed keys', () => {
      const key1 = getCanonicalAccountKey({ serviceName: 'GitHub', accountIdentifier: 'User@Example.COM' });
      const key2 = getCanonicalAccountKey({ serviceName: ' github ', accountIdentifier: 'user@example.com' });
      expect(key1).toBe('github:::user@example.com');
      expect(key1).toBe(key2);
    });

    it('distinguishes different services with identical usernames', () => {
      const key1 = getCanonicalAccountKey({ serviceName: 'GitHub', accountIdentifier: 'jdupont' });
      const key2 = getCanonicalAccountKey({ serviceName: 'Spotify', accountIdentifier: 'jdupont' });
      expect(key1).not.toBe(key2);
    });

    it('distinguishes different identifiers on the same service', () => {
      const key1 = getCanonicalAccountKey({ serviceName: 'Twitter', accountIdentifier: 'target1' });
      const key2 = getCanonicalAccountKey({ serviceName: 'Twitter', accountIdentifier: 'target2' });
      expect(key1).not.toBe(key2);
    });
  });

  describe('Tripartite Account Classification', () => {
    it('categorizes newly appeared accounts in newlyExposed', () => {
      const auditA = { accounts: [] };
      const auditB = {
        accounts: [
          { serviceName: 'Discord', accountIdentifier: 'target#1234', cleaned: false },
          { serviceName: 'Steam', accountIdentifier: 'target_gamer', cleaned: false },
        ],
      };

      const result = compareAudits(auditA as any, auditB as any);
      expect(result.newlyExposed.length).toBe(2);
      expect(result.persistentlyExposed.length).toBe(0);
      expect(result.resolvedAccounts.length).toBe(0);
      expect(result.stats.newCount).toBe(2);
    });

    it('categorizes uncleaned accounts present in both audits in persistentlyExposed', () => {
      const auditA = {
        accounts: [{ serviceName: 'Twitter', accountIdentifier: 'target_user', cleaned: false }],
      };
      const auditB = {
        accounts: [{ serviceName: 'Twitter', accountIdentifier: 'target_user', cleaned: false }],
      };

      const result = compareAudits(auditA as any, auditB as any);
      expect(result.persistentlyExposed.length).toBe(1);
      expect(result.persistentlyExposed[0].serviceName).toBe('Twitter');
      expect(result.newlyExposed.length).toBe(0);
      expect(result.resolvedAccounts.length).toBe(0);
      expect(result.stats.persistentCount).toBe(1);
    });

    it('categorizes accounts marked cleaned or completed in Audit B in resolvedAccounts', () => {
      const auditA = {
        accounts: [{ serviceName: 'Spotify', accountIdentifier: 'target@test.com', cleaned: false }],
      };
      const auditB = {
        accounts: [{ serviceName: 'Spotify', accountIdentifier: 'target@test.com', cleaned: true }],
      };

      const result = compareAudits(auditA as any, auditB as any);
      expect(result.resolvedAccounts.length).toBe(1);
      expect(result.resolvedAccounts[0].serviceName).toBe('Spotify');
      expect(result.persistentlyExposed.length).toBe(0);
      expect(result.newlyExposed.length).toBe(0);
      expect(result.stats.resolvedCount).toBe(1);
    });

    it('categorizes accounts present in Audit A that disappeared in Audit B in resolvedAccounts', () => {
      const auditA = {
        accounts: [{ serviceName: 'Pinterest', accountIdentifier: 'target_user', cleaned: false }],
      };
      const auditB = {
        accounts: [], // Account deleted and no longer detected
      };

      const result = compareAudits(auditA as any, auditB as any);
      expect(result.resolvedAccounts.length).toBe(1);
      expect(result.resolvedAccounts[0].serviceName).toBe('Pinterest');
      expect(result.resolvedAccounts[0].cleaned).toBe(true);
      expect(result.stats.resolvedCount).toBe(1);
    });

    it('correctly segments a comprehensive multi-account evolution scenario', () => {
      const auditA = {
        riskScore: 70,
        accounts: [
          { serviceName: 'GitHub', accountIdentifier: 'dev', cleaned: false }, // Persistent
          { serviceName: 'Twitter', accountIdentifier: 'dev', cleaned: false }, // Cleaned in B
          { serviceName: 'LinkedIn', accountIdentifier: 'dev', cleaned: false }, // Disappeared in B
          { serviceName: 'Dropbox', accountIdentifier: 'dev', cleaned: false }, // Persistent
        ],
      };
      const auditB = {
        riskScore: 45,
        accounts: [
          { serviceName: 'GitHub', accountIdentifier: 'dev', cleaned: false }, // Persistent
          { serviceName: 'Twitter', accountIdentifier: 'dev', cleaned: true }, // Cleaned in B
          { serviceName: 'Dropbox', accountIdentifier: 'dev', cleaned: false }, // Persistent
          { serviceName: 'TikTok', accountIdentifier: 'dev', cleaned: false }, // New
          { serviceName: 'Snapchat', accountIdentifier: 'dev', cleaned: false }, // New
        ],
      };

      const result = compareAudits(auditA as any, auditB as any);
      expect(result.newlyExposed.length).toBe(2); // TikTok, Snapchat
      expect(result.persistentlyExposed.length).toBe(2); // GitHub, Dropbox
      expect(result.resolvedAccounts.length).toBe(2); // Twitter (cleaned), LinkedIn (disappeared)
      expect(result.stats.totalA).toBe(4);
      expect(result.stats.totalB).toBe(5);
    });
  });

  describe('Risk Score Evolution & Zero-Hyphen French Formatting', () => {
    it('formats score decrease without any hyphen characters', () => {
      const evolution = formatScoreEvolutionFrench(60, 48);
      expect(evolution.delta).toBe(-12);
      expect(evolution.descriptionFrench).toBe('Baisse de 12 points');
      expect(evolution.descriptionFrench.includes('-')).toBe(false);
      expect(evolution.descriptionFrench.includes('–')).toBe(false);
      expect(evolution.descriptionFrench.includes('—')).toBe(false);
    });

    it('formats singular point decrease correctly without hyphens', () => {
      const evolution = formatScoreEvolutionFrench(50, 49);
      expect(evolution.delta).toBe(-1);
      expect(evolution.descriptionFrench).toBe('Baisse de 1 point');
      expect(evolution.descriptionFrench.includes('-')).toBe(false);
    });

    it('formats score increase without any hyphen characters', () => {
      const evolution = formatScoreEvolutionFrench(30, 45);
      expect(evolution.delta).toBe(15);
      expect(evolution.descriptionFrench).toBe('Hausse de 15 points');
      expect(evolution.descriptionFrench.includes('-')).toBe(false);
    });

    it('formats singular point increase correctly without hyphens', () => {
      const evolution = formatScoreEvolutionFrench(30, 31);
      expect(evolution.delta).toBe(1);
      expect(evolution.descriptionFrench).toBe('Hausse de 1 point');
      expect(evolution.descriptionFrench.includes('-')).toBe(false);
    });

    it('formats stable score as "Score stable" without hyphens', () => {
      const evolution = formatScoreEvolutionFrench(42, 42);
      expect(evolution.delta).toBe(0);
      expect(evolution.descriptionFrench).toBe('Score stable');
      expect(evolution.descriptionFrench.includes('-')).toBe(false);
    });

    it('passes adversarial zero-hyphen audit across 100 random score transitions', () => {
      for (let i = 0; i < 100; i++) {
        const scoreA = Math.floor(Math.random() * 101);
        const scoreB = Math.floor(Math.random() * 101);
        const evolution = formatScoreEvolutionFrench(scoreA, scoreB);
        const text = evolution.descriptionFrench;

        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
        expect(text.includes('-')).toBe(false);
        expect(text.includes('–')).toBe(false);
        expect(text.includes('—')).toBe(false);
      }
    });
  });

  describe('Edge Cases & Boundary Inputs', () => {
    it('handles completely empty snapshots without throwing', () => {
      const result = compareAudits({ accounts: [] } as any, { accounts: [] } as any);
      expect(result.newlyExposed).toEqual([]);
      expect(result.persistentlyExposed).toEqual([]);
      expect(result.resolvedAccounts).toEqual([]);
      expect(result.scoreEvolution.descriptionFrench).toBe('Score stable');
      expect(result.stats.totalA).toBe(0);
      expect(result.stats.totalB).toBe(0);
    });

    it('deduplicates accounts within the same audit array gracefully', () => {
      const auditA = {
        accounts: [
          { serviceName: 'GitHub', accountIdentifier: 'user@test.com' },
          { serviceName: 'github', accountIdentifier: 'user@test.com' }, // duplicate
        ],
      };
      const auditB = { accounts: [] };

      const result = compareAudits(auditA as any, auditB as any);
      expect(result.stats.totalA).toBe(1);
      expect(result.resolvedAccounts.length).toBe(1);
    });
  });
});
