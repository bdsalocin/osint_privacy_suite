import { describe, it, expect } from 'vitest';
import {
  generateStandaloneHtmlReport,
  renderSvgGauge,
  formatFrenchDate,
  escapeHtml,
  getRiskLevelMetadata,
  getJdmDifficultyBadge,
  getAccountResolutionBadge,
} from '../../src/core/report-exporter.js';
import { RiskScoreResult } from '../../src/core/risk-engine.js';
import { UnifiedAccount, UnifiedLeak } from '../../src/core/types.js';

describe('Report Exporter (Standalone HTML & PDF Print Preparation)', () => {
  const sampleScan = {
    id: 'scan-test-1234',
    title: 'Audit Confidentiel Test',
    target_email: 'target@example.org',
    target_username: 'osint_target',
    target_phone: '+33600000000',
    created_at: '2026-11-09T10:45:00.000Z',
    status: 'completed',
    tools_selected: ['holehe', 'maigret', 'h8mail'],
    summary_counts: { totalAccounts: 2, totalLeaks: 1 },
  };

  const sampleRiskScore: RiskScoreResult = {
    score: 42,
    level: 'moderate',
    breakdown: {
      accountsScore: 24,
      leaksScore: 18,
      uncleanedCount: 2,
      criticalLeaksCount: 0,
    },
    recommendations: [
      {
        priority: 1,
        title: 'Changement immediat des mots de passe compromis',
        description: 'Des identifiants ont ete detectes. Modifiez sans attendre vos mots de passe.',
        actionType: 'password',
        targetService: 'Adobe',
      },
      {
        priority: 2,
        title: 'Demande RGPD Article 17 pour Steam',
        description: 'La suppression autonome est impossible. Adressez une demande formelle.',
        actionType: 'gdpr',
        targetService: 'Steam',
      },
    ],
  };

  const sampleAccounts: UnifiedAccount[] = [
    {
      id: 'acc-1',
      serviceId: 'spotify',
      serviceName: 'Spotify',
      domain: 'spotify.com',
      accountIdentifier: 'target@example.org',
      sourceTool: 'holehe',
      status: 'claimed',
      cleaned: false,
      metadata: {},
      jdm: {
        matched: true,
        difficulty: 'easy',
        deleteUrl: 'https://spotify.com/delete',
      },
    },
    {
      id: 'acc-2',
      serviceId: 'steam',
      serviceName: 'Steam',
      domain: 'steampowered.com',
      accountIdentifier: 'osint_target',
      sourceTool: 'maigret',
      status: 'claimed',
      cleaned: true,
      metadata: {},
      jdm: {
        matched: true,
        difficulty: 'impossible',
      },
    },
  ];

  const sampleLeaks: UnifiedLeak[] = [
    {
      id: 'leak-1',
      target: 'target@example.org',
      sourceTool: 'h8mail',
      breachName: 'Adobe Breach',
      breachDate: '2013-10-04',
      dataClasses: ['passwords', 'emails'],
      details: 'Compromised 153 million accounts',
    },
  ];

  describe('Suite 1: Standalone HTML Structure & Self Containment', () => {
    it('generates a complete valid HTML5 document with DOCTYPE, html, head, and body', () => {
      const html = generateStandaloneHtmlReport(sampleScan, sampleAccounts, sampleLeaks, sampleRiskScore);
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html).toContain('<html lang="fr">');
      expect(html).toContain('</html>');
      expect(html).toContain('<head>');
      expect(html).toContain('</head>');
      expect(html).toContain('<body>');
      expect(html).toContain('</body>');
      expect(html).toContain('<meta charset="utf-8"');
      expect(html).toContain('<meta name="viewport"');
      expect(html).toContain('<title>');
    });

    it('is completely self-contained with zero external stylesheets, fonts, or scripts', () => {
      const html = generateStandaloneHtmlReport(sampleScan, sampleAccounts, sampleLeaks, sampleRiskScore);
      expect(html.includes('<link rel="stylesheet"')).toBe(false);
      expect(html.includes('<script src=')).toBe(false);
      expect(html.includes('unpkg.com')).toBe(false);
      expect(html.includes('cdnjs.cloudflare.com')).toBe(false);
      expect(html.includes('jsdelivr.net')).toBe(false);
      expect(html.includes('googleapis.com')).toBe(false);
      expect(html).toContain('<style>');
      expect(html).toContain('</style>');
    });
  });

  describe('Suite 2: Embedded SVG Radial Gauge Verification', () => {
    it('renders SVG gauge with correct viewBox, dimensions, and circle elements', () => {
      const svg = renderSvgGauge(42, 'moderate');
      expect(svg).toContain('viewBox="0 0 200 200"');
      expect(svg).toContain('width="180"');
      expect(svg).toContain('height="180"');
      expect(svg).toContain('<circle cx="100" cy="100" r="70"');
      expect(svg).toContain('stroke-dasharray="439.82"');
      expect(svg).toContain('42');
      expect(svg).toContain('sur 100');
      expect(svg).toContain('MODERE');
    });

    it('computes correct stroke-dashoffset for score 0, 50, and 100', () => {
      const svg0 = renderSvgGauge(0, 'low');
      expect(svg0).toContain('stroke-dashoffset="439.82"');

      const svg50 = renderSvgGauge(50, 'elevated');
      expect(svg50).toContain('stroke-dashoffset="219.91"');

      const svg100 = renderSvgGauge(100, 'critical');
      expect(svg100).toContain('stroke-dashoffset="0.00"');
    });

    it('assigns correct colors and tier labels for low, moderate, elevated, and critical levels', () => {
      expect(getRiskLevelMetadata('low')).toEqual({ labelFr: 'Faible', color: '#10b981', badgeBg: '#ecfdf5' });
      expect(getRiskLevelMetadata('moderate')).toEqual({ labelFr: 'Modere', color: '#f59e0b', badgeBg: '#fffbeb' });
      expect(getRiskLevelMetadata('elevated')).toEqual({ labelFr: 'Eleve', color: '#f97316', badgeBg: '#fff7ed' });
      expect(getRiskLevelMetadata('critical')).toEqual({ labelFr: 'Critique', color: '#ef4444', badgeBg: '#fef2f2' });
    });

    it('clamps negative scores to 0 and excessive scores to 100', () => {
      const svgNeg = renderSvgGauge(-15, 'low');
      expect(svgNeg).toContain('>0<');
      expect(svgNeg).toContain('stroke-dashoffset="439.82"');

      const svgOver = renderSvgGauge(150, 'critical');
      expect(svgOver).toContain('>100<');
      expect(svgOver).toContain('stroke-dashoffset="0.00"');
    });
  });

  describe('Suite 3: Scan Metadata & Target Parameters', () => {
    it('renders email, username, phone, scanId, and formatted date cleanly', () => {
      const html = generateStandaloneHtmlReport(sampleScan, sampleAccounts, sampleLeaks, sampleRiskScore);
      expect(html).toContain('<code>target@example.org</code>');
      expect(html).toContain('<code>osint_target</code>');
      expect(html).toContain('<code>+33600000000</code>');
      expect(html).toContain('<code>scan-test-1234</code>');
      expect(html).toContain('09/11/2026');
    });

    it('gracefully handles missing or null target fields with non renseigne', () => {
      const emptyScan = { id: 'scan-empty' };
      const html = generateStandaloneHtmlReport(emptyScan, [], [], {
        score: 0,
        level: 'low',
        breakdown: { accountsScore: 0, leaksScore: 0, uncleanedCount: 0, criticalLeaksCount: 0 },
        recommendations: [],
      });
      expect(html).toContain('Non renseigne');
    });
  });

  describe('Suite 4: Discovered Accounts Table & JDM Badges', () => {
    it('renders table rows for each detected account with proper badges and deletion links', () => {
      const html = generateStandaloneHtmlReport(sampleScan, sampleAccounts, sampleLeaks, sampleRiskScore);
      expect(html).toContain('Spotify');
      expect(html).toContain('Facile');
      expect(html).toContain('A traiter');
      expect(html).toContain('https://spotify.com/delete');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');

      expect(html).toContain('Steam');
      expect(html).toContain('Impossible');
      expect(html).toContain('Assaini');
    });

    it('renders empty table notice when accounts array is empty', () => {
      const html = generateStandaloneHtmlReport(sampleScan, [], sampleLeaks, sampleRiskScore);
      expect(html).toContain('Aucun compte public repertorie lors de cet audit.');
    });
  });

  describe('Suite 5: Security Leaks & Breaches Table', () => {
    it('renders breach table with source, name, date, compromised data classes, and details', () => {
      const html = generateStandaloneHtmlReport(sampleScan, sampleAccounts, sampleLeaks, sampleRiskScore);
      expect(html).toContain('Adobe Breach');
      expect(html).toContain('04/10/2013');
      expect(html).toContain('passwords');
      expect(html).toContain('emails');
      expect(html).toContain('Compromised 153 million accounts');
    });

    it('renders empty breach notice when leaks array is empty', () => {
      const html = generateStandaloneHtmlReport(sampleScan, sampleAccounts, [], sampleRiskScore);
      expect(html).toContain('Aucune fuite de donnees ni breche compromise identifiee pour cette cible.');
    });
  });

  describe('Suite 6: Prioritized Remediation Recommendations', () => {
    it('renders recommendations sorted with appropriate priority badges', () => {
      const html = generateStandaloneHtmlReport(sampleScan, sampleAccounts, sampleLeaks, sampleRiskScore);
      expect(html).toContain('Priorite 1 (Critique)');
      expect(html).toContain('Changement immediat des mots de passe compromis');
      expect(html).toContain('Priorite 2 (Haute)');
      expect(html).toContain('Demande RGPD Article 17 pour Steam');
    });
  });

  describe('Suite 7: Print Stylesheet & Offline Archiving (@media print)', () => {
    it('includes @page A4 configuration and essential print rules', () => {
      const html = generateStandaloneHtmlReport(sampleScan, sampleAccounts, sampleLeaks, sampleRiskScore);
      expect(html).toContain('@page');
      expect(html).toContain('size: A4 portrait');
      expect(html).toContain('@media print');
      expect(html).toContain('page-break-inside: avoid');
      expect(html).toContain('thead');
      expect(html).toContain('table-header-group');
      expect(html).toContain('print-color-adjust: exact');
    });
  });

  describe('Suite 8: Automated Strict French Zero Hyphen Audit', () => {
    it('STRICT ADVERSARIAL CHECK: ensures zero hyphens (-, –, —) in all French text nodes', () => {
      const html = generateStandaloneHtmlReport(sampleScan, sampleAccounts, sampleLeaks, sampleRiskScore);

      // Extract visible text by stripping <style>, <script>, <code>, and all HTML tags
      const textOnly = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<code[^>]*>[\s\S]*?<\/code>/gi, '')
        .replace(/<[^>]+>/g, ' ');

      const forbiddenDashes = ['-', '–', '—'];
      const lines = textOnly.split('\n').map((l) => l.trim()).filter((l) => l.length > 2);

      const violations: string[] = [];
      for (const line of lines) {
        if (/[a-zA-ZÀ-ÿ]/.test(line)) {
          for (const dash of forbiddenDashes) {
            if (line.includes(dash)) {
              violations.push(`Violation "${dash}" in: "${line}"`);
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('Suite 9: Strict Anonymity Counter Proof', () => {
    it('contains strictly zero author signatures or developer identity markers', () => {
      const html = generateStandaloneHtmlReport(sampleScan, sampleAccounts, sampleLeaks, sampleRiskScore);
      expect(html).toContain('Audit 100% hors ligne et confidentiel');
      expect(html).toContain('Document strictement personnel et confidentiel');
      expect(html.toLowerCase().includes('author')).toBe(false);
      expect(html.toLowerCase().includes('developer')).toBe(false);
    });
  });

  describe('Suite 10: XSS Injection & Adversarial Edge Cases', () => {
    it('properly escapes malicious HTML/XSS payloads in accounts and breaches', () => {
      const maliciousAccounts: UnifiedAccount[] = [
        {
          id: 'xss-1',
          serviceId: 'evil',
          serviceName: '<script>alert("xss")</script>',
          domain: 'evil.com',
          accountIdentifier: 'victim"><img src=x onerror=alert(1)>',
          sourceTool: 'holehe',
          status: 'claimed',
          cleaned: false,
          metadata: {},
        },
      ];

      const html = generateStandaloneHtmlReport(sampleScan, maliciousAccounts, [], sampleRiskScore);
      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(html).not.toContain('victim"><img src=x onerror=alert(1)>');
      expect(html).toContain('&quot;&gt;&lt;img src=x');
    });
  });

  describe('Suite 11: Null and Corrupt Array Elements Resilience', () => {
    it('handles null and undefined items in accounts array without crashing', () => {
      const defaultScore: RiskScoreResult = {
        score: 0,
        level: 'low',
        breakdown: { accountsScore: 0, leaksScore: 0, uncleanedCount: 0, criticalLeaksCount: 0 },
        recommendations: [],
      };
      const html = generateStandaloneHtmlReport(sampleScan, [null, undefined] as any, [], defaultScore);
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain('Aucun compte public repertorie lors de cet audit.');
    });

    it('handles null and undefined items in leaks array without crashing', () => {
      const defaultScore: RiskScoreResult = {
        score: 0,
        level: 'low',
        breakdown: { accountsScore: 0, leaksScore: 0, uncleanedCount: 0, criticalLeaksCount: 0 },
        recommendations: [],
      };
      const html = generateStandaloneHtmlReport(sampleScan, [], [null, undefined] as any, defaultScore);
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain('Aucune fuite de donnees ni breche compromise identifiee pour cette cible.');
    });

    it('gracefully renders mixed arrays containing both valid items and nulls', () => {
      const html = generateStandaloneHtmlReport(
        sampleScan,
        [null, sampleAccounts[0], undefined] as any,
        [undefined, sampleLeaks[0], null] as any,
        sampleRiskScore
      );
      expect(html).toContain('Spotify');
      expect(html).toContain('Adobe Breach');
    });

    it('handles null or undefined scan and riskScore objects gracefully', () => {
      const html = generateStandaloneHtmlReport(null as any, [], [], null as any);
      expect(typeof html).toBe('string');
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html).toContain('sur 100');
    });
  });
});
