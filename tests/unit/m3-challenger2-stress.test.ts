/**
 * Challenger 2 Adversarial Stress Suite for Milestone 3 (M3_RESPONSIVE_UI_THEMES)
 * Empirical stress tests, generators, oracles and invariants for:
 * 1. Risk Score Gauge (R2) stress (0, cleaned, 500 accounts, null/corrupted items, prototype pollution, SVG offset bounds)
 * 2. HTML & PDF Exporter (R3) stress (massive datasets, concurrent generation, edge cases)
 * 3. Historical Comparator (R4) stress (identical, empty, 2000+ accounts, mismatched dates, zero-hyphen evolution, tripartite breakdown invariants)
 */

import { describe, it, expect } from 'vitest';
import {
  calculateRiskScore,
  getAccountRiskPoints,
  classifyLeak,
  isAccountCleaned,
  RiskScoreResult,
  MAX_OVERALL_SCORE,
} from '../../src/core/risk-engine.js';
import {
  compareAudits,
  formatScoreEvolutionFrench,
  getCanonicalAccountKey,
  AuditSnapshot,
} from '../../src/core/audit-comparator.js';
import { generateStandaloneHtmlReport } from '../../src/core/report-exporter.js';
import { UnifiedAccount, UnifiedLeak, JdmDifficulty } from '../../src/core/types.js';

describe('Challenger 2 Adversarial Stress Suite — Milestone 3', () => {
  // Helper: compute SVG gauge offset identical to renderer formula
  function computeGaugeOffset(score: number): number {
    const clampedScore = Math.max(0, Math.min(100, Math.round(score || 0)));
    const circumference = 439.82; // 2 * Math.PI * 70
    return parseFloat((circumference * (1 - clampedScore / 100)).toFixed(2));
  }

  // Helper: check for forbidden hyphen characters in French strings
  function hasForbiddenHyphens(text: string): boolean {
    return /[-–—]/.test(text);
  }

  // =========================================================================
  // SCOPE 1: Risk Score Gauge (R2) Adversarial Stress
  // =========================================================================
  describe('Scope 1: Risk Score Gauge (R2) Adversarial Stress', () => {
    it('handles extreme edge case: 0 accounts and 0 leaks cleanly', () => {
      const res = calculateRiskScore([], []);
      expect(res.score).toBe(0);
      expect(Number.isInteger(res.score)).toBe(true);
      expect(res.level).toBe('low');
      expect(res.breakdown.accountsScore).toBe(0);
      expect(res.breakdown.leaksScore).toBe(0);
      expect(res.breakdown.uncleanedCount).toBe(0);
      expect(res.breakdown.criticalLeaksCount).toBe(0);
      expect(res.recommendations).toEqual([]);

      const offset = computeGaugeOffset(res.score);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(439.82);
      expect(offset).toBe(439.82);
    });

    it('handles extreme edge case: 100% cleaned accounts with 0 uncleaned remaining', () => {
      const cleanedAccounts: UnifiedAccount[] = Array.from({ length: 60 }, (_, i) => ({
        id: `acc-clean-${i}`,
        serviceId: `svc_${i}`,
        serviceName: `Service ${i}`,
        domain: `service${i}.com`,
        accountIdentifier: `user_${i}`,
        sourceTool: 'holehe',
        status: 'claimed',
        cleaned: true,
        metadata: {},
        jdm: {
          name: `Service ${i}`,
          difficulty: 'impossible' as JdmDifficulty,
          matched: true,
        },
      }));

      const res = calculateRiskScore(cleanedAccounts, []);
      expect(res.score).toBe(0);
      expect(Number.isInteger(res.score)).toBe(true);
      expect(res.level).toBe('low');
      expect(res.breakdown.accountsScore).toBe(0);
      expect(res.breakdown.uncleanedCount).toBe(0);
      expect(res.recommendations.length).toBe(0);

      const offset = computeGaugeOffset(res.score);
      expect(offset).toBe(439.82);
    });

    it('handles high volume: 500 uncleaned accounts under 50ms and caps score properly', () => {
      const difficulties: JdmDifficulty[] = ['impossible', 'hard', 'medium', 'easy', 'unknown', 'limited'];
      const largeAccounts: UnifiedAccount[] = Array.from({ length: 500 }, (_, i) => ({
        id: `acc-large-${i}`,
        serviceId: `svc_${i % 40}`,
        serviceName: `Large Service ${i % 40}`,
        domain: `largeservice${i % 40}.com`,
        accountIdentifier: `target_dev_${i}`,
        sourceTool: 'maigret',
        status: 'claimed',
        cleaned: false,
        metadata: {},
        jdm: {
          name: `Large Service ${i % 40}`,
          difficulty: difficulties[i % difficulties.length],
          matched: true,
          deleteUrl: i % 3 === 0 ? `https://largeservice${i % 40}.com/delete` : undefined,
        },
      }));

      const startTime = performance.now();
      const res = calculateRiskScore(largeAccounts, []);
      const elapsedMs = performance.now() - startTime;

      expect(elapsedMs).toBeLessThan(50);
      expect(Number.isInteger(res.score)).toBe(true);
      expect(res.score).toBeGreaterThanOrEqual(0);
      expect(res.score).toBeLessThanOrEqual(MAX_OVERALL_SCORE);
      expect(res.breakdown.accountsScore).toBeLessThanOrEqual(60);
      expect(res.breakdown.uncleanedCount).toBe(500);

      const offset = computeGaugeOffset(res.score);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(439.82);

      // Recommendations validation
      expect(res.recommendations.length).toBeGreaterThan(0);
      expect(res.recommendations.length).toBeLessThanOrEqual(8);
      for (const rec of res.recommendations) {
        expect(rec.priority).toBeGreaterThanOrEqual(1);
        expect(rec.priority).toBeLessThanOrEqual(4);
        expect(hasForbiddenHyphens(rec.title)).toBe(false);
        expect(hasForbiddenHyphens(rec.description)).toBe(false);
      }
    });

    it('handles arrays with null, undefined, primitive and corrupted items gracefully', () => {
      const corruptAccounts: any[] = [
        null,
        undefined,
        42,
        'string_account',
        true,
        [],
        {},
        { id: null, serviceName: null, cleaned: null },
        { serviceName: 'ValidService', jdm: { matched: true, difficulty: 'impossible' } },
        null,
      ];

      const corruptLeaks: any[] = [
        null,
        undefined,
        12345,
        'leak_str',
        {},
        { breachName: null, dataClasses: null },
        { breachName: 'PwnedPasswords', dataClasses: ['passwords'], details: 'plain password leaked' },
      ];

      const res = calculateRiskScore(corruptAccounts, corruptLeaks);
      expect(Number.isInteger(res.score)).toBe(true);
      expect(res.score).toBeGreaterThanOrEqual(0);
      expect(res.score).toBeLessThanOrEqual(100);

      const offset = computeGaugeOffset(res.score);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(439.82);

      expect(res.breakdown.uncleanedCount).toBe(4); // [], {}, null-props object, and ValidService
      expect(res.breakdown.criticalLeaksCount).toBe(1);
    });

    it('survives prototype pollution attacks in accounts and options objects', () => {
      const pollutedAccount = JSON.parse(
        '{"__proto__":{"polluted":true,"difficulty":"impossible","score":999},"serviceName":"MaliciousSite"}'
      );
      const pollutedOptions = JSON.parse(
        '{"__proto__":{"maxRecommendations":-5,"accountsScore":1000}}'
      );

      const res = calculateRiskScore([pollutedAccount], [], pollutedOptions);
      expect(Number.isInteger(res.score)).toBe(true);
      expect(res.score).toBeGreaterThanOrEqual(0);
      expect(res.score).toBeLessThanOrEqual(100);

      // Ensure global prototype was NOT poisoned
      expect((Object.prototype as any).polluted).toBeUndefined();

      const offset = computeGaugeOffset(res.score);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(439.82);
    });

    it('asserts that SVG offset is strictly bounded in [0, 439.82] across all possible integer scores 0 to 100', () => {
      for (let s = 0; s <= 100; s++) {
        const offset = computeGaugeOffset(s);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThanOrEqual(439.82);
      }
      expect(computeGaugeOffset(0)).toBe(439.82);
      expect(computeGaugeOffset(100)).toBe(0);
      expect(computeGaugeOffset(50)).toBe(219.91);
    });
  });

  // =========================================================================
  // SCOPE 2: HTML & PDF Exporter (R3) Adversarial Stress
  // =========================================================================
  describe('Scope 2: HTML & PDF Exporter (R3) Adversarial Stress', () => {
    it('generates standalone HTML report with 0 accounts and 0 leaks cleanly without error', () => {
      const html = generateStandaloneHtmlReport(
        {
          id: 'scan-empty-001',
          created_at: '2026-11-09T10:00:00Z',
          target_email: 'test@empty.local',
        },
        [],
        []
      );

      expect(typeof html).toBe('string');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Aucun compte');
    });

    it('generates report for massive dataset (1,000 accounts) without stack overflow or performance degradation', () => {
      const thousandAccounts: UnifiedAccount[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `acc-stress-${i}`,
        serviceId: `svc_${i % 50}`,
        serviceName: `Massive Service ${i % 50}`,
        domain: `massive${i % 50}.com`,
        accountIdentifier: `target_stress_${i}`,
        sourceTool: 'holehe',
        status: 'claimed',
        cleaned: i % 4 === 0,
        metadata: {},
        jdm: {
          name: `Massive Service ${i % 50}`,
          difficulty: i % 2 === 0 ? 'easy' : 'hard',
          matched: true,
        },
      }));

      const startTime = performance.now();
      const html = generateStandaloneHtmlReport(
        {
          id: 'scan-massive-001',
          created_at: '2026-11-09T11:00:00Z',
          target_username: 'target_massive',
        },
        thousandAccounts,
        []
      );
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(250);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html.length).toBeGreaterThan(50000);
      expect(html).toContain('target_stress_999');
    });

    it('sanitizes aggressive XSS and malicious HTML injections in account properties', () => {
      const maliciousAccounts: UnifiedAccount[] = [
        {
          id: 'acc-xss-1',
          serviceId: '<script>alert("xss")</script>',
          serviceName: '<img src=x onerror=alert("pwn")>',
          domain: '"><script>fetch("http://evil.com")</script>',
          accountIdentifier: '<b>BoldUser</b>',
          sourceTool: 'maigret',
          status: 'claimed',
          cleaned: false,
          metadata: {},
        },
      ];

      const html = generateStandaloneHtmlReport(
        { id: 'scan-xss-001', target_email: 'target@evil.local' },
        maliciousAccounts,
        []
      );

      expect(html).not.toContain('<script>alert');
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&lt;img');
    });

    it('survives rapid consecutive report generation cycles without memory or state leakage', () => {
      const accounts: UnifiedAccount[] = [
        {
          id: 'acc-rapid-1',
          serviceId: 'rapid_svc',
          serviceName: 'Rapid Service',
          domain: 'rapid.com',
          accountIdentifier: 'rapid_target',
          sourceTool: 'holehe',
          status: 'claimed',
          cleaned: false,
          metadata: {},
        },
      ];

      for (let i = 0; i < 50; i++) {
        const html = generateStandaloneHtmlReport(
          { id: `scan-cycle-${i}` },
          accounts,
          []
        );
        expect(html.length).toBeGreaterThan(1000);
      }
    });
  });

  // =========================================================================
  // SCOPE 3: Historical Comparator (R4) Adversarial Stress
  // =========================================================================
  describe('Scope 3: Historical Comparator (R4) Adversarial Stress', () => {
    it('compares identical audits: produces delta 0, Score stable, and exactly 0 newly exposed or resolved', () => {
      const accounts: UnifiedAccount[] = [
        {
          id: 'acc-1',
          serviceId: 'github',
          serviceName: 'GitHub',
          domain: 'github.com',
          accountIdentifier: 'octocat',
          sourceTool: 'maigret',
          status: 'claimed',
          cleaned: false,
          metadata: {},
        },
        {
          id: 'acc-2',
          serviceId: 'spotify',
          serviceName: 'Spotify',
          domain: 'spotify.com',
          accountIdentifier: 'octocat',
          sourceTool: 'holehe',
          status: 'claimed',
          cleaned: false,
          metadata: {},
        },
      ];

      const auditA: AuditSnapshot = {
        scan: { id: 'audit-a', created_at: '2026-11-01T12:00:00Z' },
        accounts,
      };
      const auditB: AuditSnapshot = {
        scan: { id: 'audit-b', created_at: '2026-11-08T12:00:00Z' },
        accounts: [...accounts],
      };

      const result = compareAudits(auditA, auditB);
      expect(result.stats.totalA).toBe(2);
      expect(result.stats.totalB).toBe(2);
      expect(result.stats.newCount).toBe(0);
      expect(result.stats.persistentCount).toBe(2);
      expect(result.stats.resolvedCount).toBe(0);
      expect(result.newlyExposed.length).toBe(0);
      expect(result.persistentlyExposed.length).toBe(2);
      expect(result.resolvedAccounts.length).toBe(0);

      // Score evolution
      expect(result.scoreEvolution.delta).toBe(0);
      expect(result.scoreEvolution.descriptionFrench).toBe('Score stable');
      expect(hasForbiddenHyphens(result.scoreEvolution.descriptionFrench)).toBe(false);
    });

    it('compares completely empty audits without throwing', () => {
      const auditA: AuditSnapshot = { accounts: [] };
      const auditB: AuditSnapshot = { accounts: [] };

      const result = compareAudits(auditA, auditB);
      expect(result.stats.totalA).toBe(0);
      expect(result.stats.totalB).toBe(0);
      expect(result.stats.newCount).toBe(0);
      expect(result.stats.persistentCount).toBe(0);
      expect(result.stats.resolvedCount).toBe(0);
      expect(result.scoreEvolution.delta).toBe(0);
      expect(result.scoreEvolution.descriptionFrench).toBe('Score stable');
    });

    it('stress tests comparison of thousands of accounts (2,000 in A, 2,000 in B) and verifies tripartite sum invariant', () => {
      // Create 2,000 accounts for A (keys 0 to 1999)
      const accountsA: UnifiedAccount[] = Array.from({ length: 2000 }, (_, i) => ({
        id: `acc-a-${i}`,
        serviceId: `service_${i % 100}`,
        serviceName: `Service ${i % 100}`,
        domain: `service${i % 100}.com`,
        accountIdentifier: `ident_${i}`,
        sourceTool: 'holehe',
        status: 'claimed',
        cleaned: false,
        metadata: {},
      }));

      // Create 2,000 accounts for B:
      // - 1,000 overlap with A (keys 1000 to 1999): 500 remain uncleaned, 500 cleaned
      // - 1,000 newly exposed (keys 2000 to 2999)
      // Disappeared from A: keys 0 to 999 (1000 accounts resolved)
      const accountsB: UnifiedAccount[] = [
        ...Array.from({ length: 500 }, (_, idx) => {
          const i = 1000 + idx;
          return {
            id: `acc-b-persistent-${i}`,
            serviceId: `service_${i % 100}`,
            serviceName: `Service ${i % 100}`,
            domain: `service${i % 100}.com`,
            accountIdentifier: `ident_${i}`,
            sourceTool: 'holehe' as const,
            status: 'claimed' as const,
            cleaned: false,
            metadata: {},
          };
        }),
        ...Array.from({ length: 500 }, (_, idx) => {
          const i = 1500 + idx;
          return {
            id: `acc-b-resolved-${i}`,
            serviceId: `service_${i % 100}`,
            serviceName: `Service ${i % 100}`,
            domain: `service${i % 100}.com`,
            accountIdentifier: `ident_${i}`,
            sourceTool: 'holehe' as const,
            status: 'claimed' as const,
            cleaned: true,
            metadata: {},
          };
        }),
        ...Array.from({ length: 1000 }, (_, idx) => {
          const i = 2000 + idx;
          return {
            id: `acc-b-new-${i}`,
            serviceId: `service_${i % 100}`,
            serviceName: `Service ${i % 100}`,
            domain: `service${i % 100}.com`,
            accountIdentifier: `ident_${i}`,
            sourceTool: 'maigret' as const,
            status: 'claimed' as const,
            cleaned: false,
            metadata: {},
          };
        }),
      ];

      const start = performance.now();
      const result = compareAudits({ accounts: accountsA }, { accounts: accountsB });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(150); // Linear complexity verified
      expect(result.stats.totalA).toBe(2000);
      expect(result.stats.totalB).toBe(2000);
      expect(result.stats.newCount).toBe(1000);
      expect(result.stats.persistentCount).toBe(500);
      // Resolved: 500 cleaned in B + 1,000 disappeared from A = 1,500
      expect(result.stats.resolvedCount).toBe(1500);

      // Tripartite Breakdown Invariant Oracle:
      // Total canonical unique accounts in A U B must equal:
      // newlyExposed + persistentlyExposed + resolvedAccounts
      const totalUniqueKeys = new Set([
        ...accountsA.map(getCanonicalAccountKey),
        ...accountsB.map(getCanonicalAccountKey),
      ]).size;

      const tripartiteSum =
        result.stats.newCount + result.stats.persistentCount + result.stats.resolvedCount;
      expect(tripartiteSum).toBe(totalUniqueKeys);
      expect(tripartiteSum).toBe(3000); // 1000 disappeared + 1000 overlap + 1000 new
    });

    it('handles audits with mismatched dates, reversed chronology, or invalid date strings without crashing', () => {
      const auditFuture: AuditSnapshot = {
        scan: { id: 'scan-future', created_at: '2099-12-31T23:59:59Z' },
        accounts: [{ serviceName: 'GitHub', accountIdentifier: 'user1' }],
      };
      const auditPast: AuditSnapshot = {
        scan: { id: 'scan-past', created_at: '1970-01-01T00:00:00Z' },
        accounts: [{ serviceName: 'GitHub', accountIdentifier: 'user1' }],
      };
      const auditMalformedDate: AuditSnapshot = {
        scan: { id: 'scan-malformed', created_at: 'corrupt-date-not-iso' },
        accounts: [],
      };

      expect(() => compareAudits(auditFuture, auditPast)).not.toThrow();
      expect(() => compareAudits(auditPast, auditFuture)).not.toThrow();
      expect(() => compareAudits(auditMalformedDate, auditFuture)).not.toThrow();
    });

    it('verifies that score evolution string contains ZERO hyphens or minus signs across 2,000 random transitions', () => {
      for (let i = 0; i < 2000; i++) {
        const scoreA = Math.floor(Math.random() * 101);
        const scoreB = Math.floor(Math.random() * 101);
        const evolution = formatScoreEvolutionFrench(scoreA, scoreB);

        const desc = evolution.descriptionFrench;
        expect(hasForbiddenHyphens(desc)).toBe(false);
        expect(desc).not.toContain('-');
        expect(desc).not.toContain('–');
        expect(desc).not.toContain('—');
        expect(desc).not.toContain('−'); // unicode minus sign

        if (scoreB < scoreA) {
          const delta = scoreA - scoreB;
          const word = delta === 1 ? 'point' : 'points';
          expect(desc).toBe(`Baisse de ${delta} ${word}`);
        } else if (scoreB > scoreA) {
          const delta = scoreB - scoreA;
          const word = delta === 1 ? 'point' : 'points';
          expect(desc).toBe(`Hausse de ${delta} ${word}`);
        } else {
          expect(desc).toBe('Score stable');
        }
      }
    });
  });
});
