import { describe, it, expect } from 'vitest';
import {
  calculateRiskScore,
  getAccountRiskPoints,
  classifyLeak,
  getRiskLevel,
  generateRemediationRecommendations,
  isAccountCleaned,
  JDM_DIFFICULTY_WEIGHTS,
} from '../../src/core/risk-engine.js';
import { UnifiedAccount, UnifiedLeak } from '../../src/core/types.js';

describe('Global Privacy Risk Engine (risk-engine.ts)', () => {
  const createAccount = (overrides: Partial<UnifiedAccount> = {}): UnifiedAccount => ({
    id: 'acc-test-' + Math.random(),
    serviceId: 'test_service',
    serviceName: 'TestService',
    domain: 'testservice.com',
    accountIdentifier: 'target_user',
    sourceTool: 'holehe',
    status: 'claimed',
    metadata: {},
    cleaned: false,
    ...overrides,
  });

  const createLeak = (overrides: Partial<UnifiedLeak> = {}): UnifiedLeak => ({
    id: 'leak-test-' + Math.random(),
    target: 'target@test.com',
    sourceTool: 'h8mail',
    breachName: 'TestBreach',
    dataClasses: ['credentials'],
    details: 'Breach details',
    ...overrides,
  });

  describe('TC-01: Empty inputs and baseline', () => {
    it('returns score 0 and low level for empty inputs', () => {
      const result = calculateRiskScore([], []);
      expect(result.score).toBe(0);
      expect(result.level).toBe('low');
      expect(result.breakdown).toEqual({
        accountsScore: 0,
        leaksScore: 0,
        uncleanedCount: 0,
        criticalLeaksCount: 0,
      });
      expect(result.recommendations).toEqual([]);
    });
  });

  describe('TC-02 & TC-03: Cleaned accounts contribute 0 points', () => {
    it('returns score 0 when all accounts are marked cleaned', () => {
      const accounts: UnifiedAccount[] = [
        createAccount({ cleaned: true, jdm: { matched: true, difficulty: 'impossible' } }),
        createAccount({ cleaned: true, jdm: { matched: true, difficulty: 'hard' } }),
        createAccount({ cleaned: true, jdm: { matched: true, difficulty: 'easy' } }),
      ];
      const result = calculateRiskScore(accounts, []);
      expect(result.score).toBe(0);
      expect(result.breakdown.accountsScore).toBe(0);
      expect(result.breakdown.uncleanedCount).toBe(0);
    });

    it('treats accounts with status completed or deleted as cleaned', () => {
      const accounts: UnifiedAccount[] = [
        createAccount({ status: 'completed' as any, jdm: { matched: true, difficulty: 'impossible' } }),
        createAccount({ status: 'deleted' as any, jdm: { matched: true, difficulty: 'hard' } }),
      ];
      const result = calculateRiskScore(accounts, []);
      expect(result.score).toBe(0);
      expect(result.breakdown.accountsScore).toBe(0);
      expect(isAccountCleaned(accounts[0])).toBe(true);
      expect(isAccountCleaned(accounts[1])).toBe(true);
    });
  });

  describe('TC-04 & TC-05: JDM Difficulty Points', () => {
    it('accurately attributes points according to difficulty table', () => {
      expect(getAccountRiskPoints(createAccount({ jdm: { matched: true, difficulty: 'impossible' } }))).toBe(10);
      expect(getAccountRiskPoints(createAccount({ jdm: { matched: true, difficulty: 'hard' } }))).toBe(7);
      expect(getAccountRiskPoints(createAccount({ jdm: { matched: true, difficulty: 'limited' } }))).toBe(5);
      expect(getAccountRiskPoints(createAccount({ jdm: { matched: true, difficulty: 'conditional' } }))).toBe(5);
      expect(getAccountRiskPoints(createAccount({ jdm: { matched: true, difficulty: 'medium' } }))).toBe(4);
      expect(getAccountRiskPoints(createAccount({ jdm: { matched: true, difficulty: 'easy' } }))).toBe(2);
      expect(getAccountRiskPoints(createAccount({ jdm: { matched: true, difficulty: 'unknown' } }))).toBe(3);
    });

    it('falls back to unknown points when jdm is unmatched or missing', () => {
      expect(getAccountRiskPoints(createAccount({ jdm: undefined }))).toBe(3);
      expect(getAccountRiskPoints(createAccount({ jdm: { matched: false } }))).toBe(3);
    });
  });

  describe('TC-06 to TC-08: Leak Classification', () => {
    it('classifies leaks with passwords as critical (25 points)', () => {
      const leak = createLeak({ dataClasses: ['passwords', 'emails'] });
      const classification = classifyLeak(leak);
      expect(classification.points).toBe(25);
      expect(classification.isCritical).toBe(true);
    });

    it('classifies leaks with personal data (15 points, non critical)', () => {
      const leak = createLeak({ dataClasses: ['phone_numbers', 'names'] });
      const classification = classifyLeak(leak);
      expect(classification.points).toBe(15);
      expect(classification.isCritical).toBe(false);
    });

    it('classifies general metadata breaches (8 points)', () => {
      const leak = createLeak({ dataClasses: ['usernames'], details: 'Simple usernames list' });
      const classification = classifyLeak(leak);
      expect(classification.points).toBe(8);
      expect(classification.isCritical).toBe(false);
    });
  });

  describe('TC-09 to TC-11: Clamping and Caps', () => {
    it('caps accountsScore to 60 even with overwhelming account exposures', () => {
      const accounts = Array.from({ length: 20 }, () =>
        createAccount({ jdm: { matched: true, difficulty: 'impossible' } })
      );
      const result = calculateRiskScore(accounts, []);
      expect(result.breakdown.accountsScore).toBe(60);
      expect(result.score).toBe(60);
      expect(result.level).toBe('elevated');
    });

    it('clamps overall score strictly to 100', () => {
      const accounts = Array.from({ length: 15 }, () =>
        createAccount({ jdm: { matched: true, difficulty: 'impossible' } })
      );
      const leaks = Array.from({ length: 10 }, () =>
        createLeak({ dataClasses: ['passwords'] })
      );
      const result = calculateRiskScore(accounts, leaks);
      expect(result.score).toBe(100);
      expect(result.level).toBe('critical');
    });

    it('clamps minimal score to 0', () => {
      const result = calculateRiskScore([], []);
      expect(result.score).toBe(0);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('TC-12: Risk Level Thresholds', () => {
    it('maps scores to exact risk levels at all boundaries', () => {
      expect(getRiskLevel(0)).toBe('low');
      expect(getRiskLevel(24)).toBe('low');
      expect(getRiskLevel(25)).toBe('moderate');
      expect(getRiskLevel(49)).toBe('moderate');
      expect(getRiskLevel(50)).toBe('elevated');
      expect(getRiskLevel(74)).toBe('elevated');
      expect(getRiskLevel(75)).toBe('critical');
      expect(getRiskLevel(100)).toBe('critical');
    });
  });

  describe('TC-13 to TC-16: Remediation Recommendations', () => {
    it('prioritizes critical leaks at priority 1 (password action)', () => {
      const accounts = [createAccount({ jdm: { matched: true, difficulty: 'easy', deleteUrl: 'https://test.com/del' } })];
      const leaks = [createLeak({ dataClasses: ['passwords'], breachName: 'Adobe' })];
      const recs = generateRemediationRecommendations(accounts, leaks);
      expect(recs[0].priority).toBe(1);
      expect(recs[0].actionType).toBe('password');
      expect(recs[0].targetService).toContain('Adobe');
    });

    it('generates GDPR Article 17 recommendation for impossible difficulty accounts', () => {
      const accounts = [
        createAccount({
          serviceName: 'Steam',
          jdm: { matched: true, difficulty: 'impossible' },
        }),
      ];
      const recs = generateRemediationRecommendations(accounts, []);
      const gdprRec = recs.find((r) => r.actionType === 'gdpr');
      expect(gdprRec).toBeDefined();
      expect(gdprRec?.priority).toBe(2);
      expect(gdprRec?.title).toContain('Demande RGPD Article 17');
    });

    it('deduplicates recommendations by service name', () => {
      const accounts = [
        createAccount({ serviceName: 'Twitter', jdm: { matched: true, difficulty: 'easy', deleteUrl: 'http://del' } }),
        createAccount({ serviceName: 'Twitter', jdm: { matched: true, difficulty: 'easy', deleteUrl: 'http://del' } }),
      ];
      const recs = generateRemediationRecommendations(accounts, []);
      const twitterRecs = recs.filter((r) => r.targetService === 'Twitter');
      expect(twitterRecs.length).toBe(1);
    });

    it('respects maxRecommendations capping parameter', () => {
      const accounts = Array.from({ length: 15 }, (_, i) =>
        createAccount({ serviceName: `Service${i}`, jdm: { matched: true, difficulty: 'easy', deleteUrl: 'http://del' } })
      );
      const recs = generateRemediationRecommendations(accounts, [], 3);
      expect(recs.length).toBe(3);
    });
  });

  describe('TC-17: STRICT ADVERSARIAL ZERO-HYPHEN AUDIT IN FRENCH TEXT', () => {
    it('STRICT CHECK: ensures zero hyphens (-, –, —) in all French recommendations', () => {
      const accounts = [
        createAccount({ serviceName: 'Discord', jdm: { matched: true, difficulty: 'impossible' } }),
        createAccount({ serviceName: 'Google', jdm: { matched: true, difficulty: 'hard' } }),
        createAccount({ serviceName: 'Spotify', jdm: { matched: true, difficulty: 'easy', deleteUrl: 'http://del' } }),
        createAccount({ serviceName: 'ForumInconnu', jdm: undefined }),
        createAccount({ serviceName: 'Hyphen-Service', jdm: { matched: true, difficulty: 'impossible' } }),
      ];
      const leaks = [
        createLeak({ breachName: 'LinkedIn 2012', dataClasses: ['passwords', 'emails'] }),
        createLeak({ breachName: 'Facebook-Scrape', dataClasses: ['phone_numbers'] }),
      ];

      const result = calculateRiskScore(accounts, leaks, { maxRecommendations: 20 });
      const forbiddenDashes = ['-', '–', '—'];

      for (const rec of result.recommendations) {
        for (const dash of forbiddenDashes) {
          expect(
            rec.title.includes(dash),
            `Recommendation title contains forbidden dash "${dash}": "${rec.title}"`
          ).toBe(false);

          expect(
            rec.description.includes(dash),
            `Recommendation description contains forbidden dash "${dash}": "${rec.description}"`
          ).toBe(false);
        }
      }
    });
  });

  describe('TC-18 & TC-19: Robustness & Immutability', () => {
    it('handles unexpected or null inputs gracefully', () => {
      const result = calculateRiskScore(undefined as any, null as any);
      expect(result.score).toBe(0);
      expect(result.level).toBe('low');
    });

    it('does not mutate input arrays or objects', () => {
      const accounts = [createAccount({ serviceName: 'GitHub' })];
      const leaks = [createLeak({ breachName: 'Breach1' })];

      const accountsCopy = JSON.parse(JSON.stringify(accounts));
      const leaksCopy = JSON.parse(JSON.stringify(leaks));

      calculateRiskScore(accounts, leaks);

      expect(accounts).toEqual(accountsCopy);
      expect(leaks).toEqual(leaksCopy);
    });
  });

  describe('TC-20: Adversarial Prototype Safety and Extreme JDM Difficulties', () => {
    it('safely handles prototype property names without prototype pollution or NaN', () => {
      const prototypeKeys = ['toString', 'valueOf', 'constructor', '__proto__', 'hasOwnProperty', 'isPrototypeOf'];
      for (const key of prototypeKeys) {
        const account = createAccount({
          jdm: { matched: true, difficulty: key as any },
        });
        const points = getAccountRiskPoints(account);
        expect(typeof points).toBe('number');
        expect(isNaN(points)).toBe(false);
        expect(points).toBe(JDM_DIFFICULTY_WEIGHTS.unknown);

        const res = calculateRiskScore([account], []);
        expect(typeof res.score).toBe('number');
        expect(isNaN(res.score)).toBe(false);
        expect(res.score).toBeGreaterThanOrEqual(0);
        expect(res.score).toBeLessThanOrEqual(100);
        expect(res.breakdown.accountsScore).toBe(JDM_DIFFICULTY_WEIGHTS.unknown);
      }
    });

    it('safely handles arbitrary strings and non-string difficulty values', () => {
      const weirdValues = ['EXTREME', 'SUPER_CRITICAL', '', ' ', 'null', 'undefined', '12345', null, undefined, 123, NaN, Infinity, -999, {}, []];
      for (const val of weirdValues) {
        const account = createAccount({
          jdm: { matched: true, difficulty: val as any },
        });
        const points = getAccountRiskPoints(account);
        expect(typeof points).toBe('number');
        expect(isNaN(points)).toBe(false);
        expect(points).toBe(JDM_DIFFICULTY_WEIGHTS.unknown);

        const res = calculateRiskScore([account], []);
        expect(typeof res.score).toBe('number');
        expect(isNaN(res.score)).toBe(false);
      }
    });
  });

  describe('TC-21: Corrupt, Null and Primitive Elements Resilience', () => {
    it('safely processes accounts array containing null, undefined, and non-object primitives', () => {
      const corruptAccounts = [
        null,
        undefined,
        {},
        { serviceName: 'MissingJdm', accountIdentifier: 'test' },
        { serviceName: 'NullJdm', jdm: null },
        { serviceName: 'BrokenJdm', jdm: { matched: null, difficulty: null } },
        'not-an-account',
        12345,
        false,
        { cleaned: 'yes', serviceName: 'StringCleaned' },
      ];

      const res = calculateRiskScore(corruptAccounts as any, []);
      expect(typeof res.score).toBe('number');
      expect(isNaN(res.score)).toBe(false);
      expect(res.score).toBeGreaterThanOrEqual(0);
      expect(res.score).toBeLessThanOrEqual(100);
    });

    it('safely processes leaks array containing null, undefined, and non-object primitives', () => {
      const corruptLeaks = [
        null,
        undefined,
        {},
        { breachName: null, details: null, dataClasses: null },
        { breachName: 12345, details: { object: true }, dataClasses: 'not-array' },
        'not-a-leak',
        12345,
        { breachName: 'Clean Breach', details: 'no dangerous words', dataClasses: [] },
      ];

      const res = calculateRiskScore([], corruptLeaks as any);
      expect(typeof res.score).toBe('number');
      expect(isNaN(res.score)).toBe(false);
      expect(res.score).toBeGreaterThanOrEqual(0);
      expect(res.score).toBeLessThanOrEqual(100);
    });

    it('safely guards isAccountCleaned and getAccountRiskPoints against null and primitives', () => {
      expect(isAccountCleaned(null as any)).toBe(false);
      expect(isAccountCleaned(undefined as any)).toBe(false);
      expect(isAccountCleaned('string' as any)).toBe(false);
      expect(isAccountCleaned(12345 as any)).toBe(false);

      expect(getAccountRiskPoints(null as any)).toBe(0);
      expect(getAccountRiskPoints(undefined as any)).toBe(0);
      expect(getAccountRiskPoints('invalid' as any)).toBe(0);
    });
  });
});
