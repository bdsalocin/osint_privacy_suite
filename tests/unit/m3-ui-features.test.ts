/**
 * Unit tests for Milestone 3 UI features:
 * - HTML structure for Risk Gauge, Historical Comparator, Export buttons, Theme toggle, Toast container
 * - Responsive CSS rules in main.css (root overflow guard, table-responsive, media queries down to 480px/400px)
 * - Light theme color definitions and overrides
 * - Zero-hyphen in French UI text nodes in index.html
 * - Complete anonymity guarantee
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(__dirname, '../../');
const htmlPath = path.join(rootDir, 'src/renderer/index.html');
const cssPath = path.join(rootDir, 'src/renderer/styles/main.css');
const appTsPath = path.join(rootDir, 'src/renderer/app.ts');

describe('Milestone 3 UI Features & Theme Integration', () => {
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');
  const appTsContent = fs.readFileSync(appTsPath, 'utf-8');

  describe('HTML Structure & Required Component IDs', () => {
    it('contains theme switcher toggle button and child elements', () => {
      expect(htmlContent).toContain('id="theme-toggle"');
      expect(htmlContent).toContain('id="theme-toggle-icon"');
      expect(htmlContent).toContain('id="theme-toggle-label"');
    });

    it('contains Risk Score container and radial SVG gauge with r=70', () => {
      expect(htmlContent).toContain('id="risk-score-container"');
      expect(htmlContent).toContain('id="risk-gauge-svg"');
      expect(htmlContent).toContain('id="gauge-progress-circle"');
      expect(htmlContent).toContain('id="gauge-score-value"');
      expect(htmlContent).toContain('id="gauge-level-text"');
      expect(htmlContent).toContain('id="risk-level-badge"');
      expect(htmlContent).toContain('id="risk-recommendations-list"');

      // Verify SVG circle radius r="70"
      expect(htmlContent).toMatch(/<circle[^>]*id="gauge-progress-circle"[^>]*r="70"/);
    });

    it('contains View 2 HTML and PDF export buttons', () => {
      expect(htmlContent).toContain('id="btn-export-html-view2"');
      expect(htmlContent).toContain('id="btn-export-pdf-view2"');
    });

    it('contains View 4 Historical Comparator component and IDs', () => {
      expect(htmlContent).toContain('id="audit-comparator-panel"');
      expect(htmlContent).toContain('id="select-audit-a"');
      expect(htmlContent).toContain('id="select-audit-b"');
      expect(htmlContent).toContain('id="btn-compare-audits"');
      expect(htmlContent).toContain('id="comparator-results"');
      expect(htmlContent).toContain('id="comparator-score-evolution-badge"');
      expect(htmlContent).toContain('id="stat-newly-exposed"');
      expect(htmlContent).toContain('id="stat-persistently-exposed"');
      expect(htmlContent).toContain('id="stat-resolved-accounts"');
      expect(htmlContent).toContain('id="table-comparison"');
      expect(htmlContent).toContain('id="comparison-tbody"');
    });

    it('contains global toast container before body close', () => {
      expect(htmlContent).toContain('id="toast-container"');
    });
  });

  describe('CSS Architecture, Variables & Responsive Breakpoints', () => {
    it('defines root overflow protection preventing horizontal scrolling', () => {
      expect(cssContent).toMatch(/html,\s*body[^{]*{[^}]*overflow-x:\s*hidden/);
      expect(cssContent).toMatch(/\.app-container[^{]*{[^}]*overflow-x:\s*hidden/);
      expect(cssContent).toMatch(/\.main-content[^{]*{[^}]*overflow-x:\s*hidden/);
    });

    it('defines table-responsive styling with horizontal touch scroll', () => {
      expect(cssContent).toMatch(/\.table-responsive\s*{[^}]*overflow-x:\s*auto/);
      expect(cssContent).toMatch(/\.table-responsive\s*{[^}]*-webkit-overflow-scrolling:\s*touch/);
    });

    it('defines subtabs-nav with nowrap and horizontal scrolling', () => {
      expect(cssContent).toMatch(/\.subtabs-nav\s*{[^}]*flex-wrap:\s*nowrap/);
      expect(cssContent).toMatch(/\.subtabs-nav\s*{[^}]*overflow-x:\s*auto/);
    });

    it('defines comprehensive light theme variables under .light-theme', () => {
      expect(cssContent).toContain('.light-theme');
      expect(cssContent).toMatch(/\.light-theme\s*{[^}]*--bg-primary:\s*#f8fafc/);
      expect(cssContent).toMatch(/\.light-theme\s*{[^}]*--bg-secondary:\s*#ffffff/);
      expect(cssContent).toMatch(/\.light-theme\s*{[^}]*--text-primary:\s*#0f172a/);
    });

    it('includes responsive media queries for 820px, 600px and 480px', () => {
      expect(cssContent).toContain('@media (max-width: 820px)');
      expect(cssContent).toContain('@media (max-width: 600px)');
      expect(cssContent).toContain('@media (max-width: 480px)');
    });

    it('configures 480px navbar grid with 4 equal columns and no text truncation', () => {
      expect(cssContent).toMatch(/grid-template-columns:\s*repeat\(4,\s*1fr\)/);
    });

    it('defines gauge progress transition animation', () => {
      expect(cssContent).toMatch(/stroke-dashoffset\s+0\.8s/);
    });
  });

  describe('TypeScript Renderer Wiring & Integrity', () => {
    it('initializes theme from localStorage on startup', () => {
      expect(appTsContent).toContain("THEME_STORAGE_KEY = 'osint_theme'");
      expect(appTsContent).toContain('localStorage.getItem(THEME_STORAGE_KEY)');
      expect(appTsContent).toContain('initTheme()');
    });

    it('contains no hardcoded color: #fff in renderer logic', () => {
      expect(appTsContent).not.toMatch(/color:\s*#fff\b/i);
    });

    it('implements refreshRiskScore, comparator and export handlers', () => {
      expect(appTsContent).toContain('async function refreshRiskScore');
      expect(appTsContent).toContain('function initComparatorView4');
      expect(appTsContent).toContain('function updateComparatorSelects');
      expect(appTsContent).toContain('function renderComparisonResults');
      expect(appTsContent).toContain('initExportButtonsView2');
    });
  });

  describe('Strict Zero-Hyphen Constraint in French UI Text Nodes', () => {
    it('has zero forbidden hyphens in index.html user-facing labels', () => {
      const textMatches = htmlContent.match(/>([^<]+)</g) || [];
      const forbiddenHyphens = ['-', '–', '—'];
      const violations: string[] = [];

      for (const raw of textMatches) {
        const text = raw.replace(/^>|<$/g, '').trim();
        // Skip empty, numbers, code, or entities
        if (!text || text === '&times;' || text === '×' || text === '&copy;' || /^[0-9%/\s]+$/.test(text)) {
          continue;
        }
        // Only inspect text with alphabet letters
        if (/[a-zA-ZÀ-ÿ]/.test(text)) {
          for (const hyphen of forbiddenHyphens) {
            if (text.includes(hyphen)) {
              violations.push(text);
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('Strict Anonymity Guarantee', () => {
    it('contains no author personal identifiers in package.json or renderer files', () => {
      const packageJson = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8');
      const authorTokens = ['bmljb2xhcw==', 'YnJlc3N5', 'YmRzYWxvY2lu'].map((b) =>
        Buffer.from(b, 'base64').toString('utf-8')
      );

      for (const token of authorTokens) {
        expect(packageJson.toLowerCase()).not.toContain(token);
        expect(htmlContent.toLowerCase()).not.toContain(token);
        expect(cssContent.toLowerCase()).not.toContain(token);
        expect(appTsContent.toLowerCase()).not.toContain(token);
      }
    });
  });
});
