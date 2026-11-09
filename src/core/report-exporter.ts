/**
 * Standalone Audit Report Exporter (HTML & PDF printable format)
 * OSINT & Privacy Suite (Milestone 1)
 *
 * ZERO HYPHEN RULE IN FRENCH TEXT:
 * Strict user rule: Zero occurrences of hyphen characters (-, –, —) in French labels,
 * titles, table headers, descriptions, or status texts.
 *
 * ANONYMITY RULE:
 * Zero occurrences of personal names or identities.
 */

import { UnifiedAccount, UnifiedLeak, JdmDifficulty } from './types.js';
import { RiskLevel, RiskScoreResult, RemediationRecommendation } from './risk-engine.js';

export interface ReportScanMetadata {
  id: string;
  title?: string;
  target_email?: string | null;
  targetEmail?: string | null;
  target_username?: string | null;
  targetUsername?: string | null;
  target_phone?: string | null;
  targetPhone?: string | null;
  created_at?: string;
  createdAt?: string;
  status?: string;
  tools_selected?: string[];
  toolsSelected?: string[];
  summary_counts?: Record<string, any>;
  summaryCounts?: Record<string, any>;
}

export type ReportScanInput = ReportScanMetadata;

export interface ReportExporterOptions {
  locale?: 'fr';
  includeLegalNotice?: boolean;
  generatedAt?: string;
}

export function escapeHtml(str?: string | null): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatFrenchDate(dateStr?: string | null): string {
  if (!dateStr || dateStr === 'null' || dateStr === 'undefined') return 'Date non precisee';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    return String(dateStr).replace(/[-–—]/g, '/');
  }
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} a ${hours}:${minutes}`;
}

export function getRiskLevelMetadata(level?: RiskLevel | string | null): {
  labelFr: string;
  color: string;
  badgeBg: string;
} {
  switch (level) {
    case 'low':
      return { labelFr: 'Faible', color: '#10b981', badgeBg: '#ecfdf5' };
    case 'moderate':
      return { labelFr: 'Modere', color: '#f59e0b', badgeBg: '#fffbeb' };
    case 'elevated':
      return { labelFr: 'Eleve', color: '#f97316', badgeBg: '#fff7ed' };
    case 'critical':
    default:
      return { labelFr: 'Critique', color: '#ef4444', badgeBg: '#fef2f2' };
  }
}

export function getJdmDifficultyBadge(difficulty?: JdmDifficulty | string | null): {
  labelFr: string;
  color: string;
  badgeBg: string;
} {
  switch (difficulty) {
    case 'easy':
      return { labelFr: 'Facile', color: '#10b981', badgeBg: '#ecfdf5' };
    case 'medium':
      return { labelFr: 'Moyen', color: '#f59e0b', badgeBg: '#fffbeb' };
    case 'hard':
      return { labelFr: 'Difficile', color: '#f97316', badgeBg: '#fff7ed' };
    case 'impossible':
      return { labelFr: 'Impossible', color: '#ef4444', badgeBg: '#fef2f2' };
    case 'limited':
      return { labelFr: 'Limite', color: '#8b5cf6', badgeBg: '#f5f3ff' };
    case 'conditional':
      return { labelFr: 'Conditionnel', color: '#6366f1', badgeBg: '#eef2ff' };
    case 'unknown':
    default:
      return { labelFr: 'Non repertorie', color: '#64748b', badgeBg: '#f8fafc' };
  }
}

export function getAccountResolutionBadge(cleaned?: boolean | null, status?: string | null): {
  labelFr: string;
  color: string;
  badgeBg: string;
} {
  const isResolved = cleaned === true || status === 'completed' || status === 'deleted';
  if (isResolved) {
    return { labelFr: 'Assaini', color: '#10b981', badgeBg: '#ecfdf5' };
  }
  return { labelFr: 'A traiter', color: '#ef4444', badgeBg: '#fef2f2' };
}

export function renderSvgGauge(score?: number | null, level?: RiskLevel | null): string {
  const numScore = typeof score === 'number' && !isNaN(score) ? score : 0;
  const clampedScore = Math.max(0, Math.min(100, Math.round(numScore)));
  const circumference = 439.82;
  const strokeOffset = (circumference * (1 - clampedScore / 100)).toFixed(2);
  const meta = getRiskLevelMetadata(level ?? 'low');

  return `
    <svg class="risk-gauge-svg" viewBox="0 0 200 200" width="180" height="180" aria-label="Jauge de risque ${clampedScore} sur 100">
      <circle cx="100" cy="100" r="70" fill="none" stroke="#e2e8f0" stroke-width="14" />
      <circle
        cx="100"
        cy="100"
        r="70"
        fill="none"
        stroke="${meta.color}"
        stroke-width="14"
        stroke-linecap="round"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${strokeOffset}"
        transform="rotate(-90 100 100)"
      />
      <text x="100" y="92" text-anchor="middle" font-family="system-ui, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="36" font-weight="700" fill="#0f172a">${clampedScore}</text>
      <text x="100" y="115" text-anchor="middle" font-family="system-ui, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="500" fill="#64748b">sur 100</text>
      <text x="100" y="136" text-anchor="middle" font-family="system-ui, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="11" font-weight="700" fill="${meta.color}" letter-spacing="1">${meta.labelFr.toUpperCase()}</text>
    </svg>
  `.trim();
}

export function generateStandaloneHtmlReport(
  scan?: ReportScanInput | null,
  accounts: UnifiedAccount[] = [],
  leaks: UnifiedLeak[] = [],
  riskScore?: RiskScoreResult | null,
  options: ReportExporterOptions = {}
): string {
  const safeScan: ReportScanInput = scan && typeof scan === 'object' ? scan : ({} as ReportScanInput);
  const safeOptions: ReportExporterOptions = options && typeof options === 'object' ? options : {};
  const safeAccounts: UnifiedAccount[] = (Array.isArray(accounts) ? accounts : []).filter(
    (a): a is UnifiedAccount => a !== null && typeof a === 'object'
  );
  const safeLeaks: UnifiedLeak[] = (Array.isArray(leaks) ? leaks : []).filter(
    (l): l is UnifiedLeak => l !== null && typeof l === 'object'
  );
  const safeRiskScore: RiskScoreResult =
    riskScore && typeof riskScore === 'object'
      ? riskScore
      : {
          score: 0,
          level: 'low',
          breakdown: {
            accountsScore: 0,
            leaksScore: 0,
            uncleanedCount: 0,
            criticalLeaksCount: 0,
          },
          recommendations: [],
        };

  const safeBreakdown =
    safeRiskScore.breakdown && typeof safeRiskScore.breakdown === 'object'
      ? {
          accountsScore:
            typeof safeRiskScore.breakdown.accountsScore === 'number' && !isNaN(safeRiskScore.breakdown.accountsScore)
              ? safeRiskScore.breakdown.accountsScore
              : 0,
          leaksScore:
            typeof safeRiskScore.breakdown.leaksScore === 'number' && !isNaN(safeRiskScore.breakdown.leaksScore)
              ? safeRiskScore.breakdown.leaksScore
              : 0,
          uncleanedCount:
            typeof safeRiskScore.breakdown.uncleanedCount === 'number'
              ? safeRiskScore.breakdown.uncleanedCount
              : 0,
          criticalLeaksCount:
            typeof safeRiskScore.breakdown.criticalLeaksCount === 'number'
              ? safeRiskScore.breakdown.criticalLeaksCount
              : 0,
        }
      : { accountsScore: 0, leaksScore: 0, uncleanedCount: 0, criticalLeaksCount: 0 };

  const targetEmail = safeScan.target_email || safeScan.targetEmail || 'Non renseigne';
  const targetUsername = safeScan.target_username || safeScan.targetUsername || 'Non renseigne';
  const targetPhone = safeScan.target_phone || safeScan.targetPhone || 'Non renseigne';
  const scanDate = formatFrenchDate(safeScan.created_at || safeScan.createdAt || safeOptions.generatedAt);
  const scanId = safeScan.id || 'analyse_locale';
  const rawTools = Array.isArray(safeScan.tools_selected)
    ? safeScan.tools_selected
    : Array.isArray(safeScan.toolsSelected)
      ? safeScan.toolsSelected
      : [];
  const toolsList = rawTools.map((t) => String(t)).join(', ') || 'Tous les modules OSINT';

  const totalAccounts = safeAccounts.length;
  const cleanedActual = safeAccounts.filter(
    (a) => a.cleaned === true || (a as any).status === 'completed' || (a as any).status === 'deleted'
  ).length;
  const pendingAccounts = totalAccounts - cleanedActual;
  const totalLeaks = safeLeaks.length;

  const svgGaugeHtml = renderSvgGauge(safeRiskScore.score, safeRiskScore.level);

  // Recommendations rows
  const safeRecommendations = (
    Array.isArray(safeRiskScore.recommendations) ? safeRiskScore.recommendations : []
  ).filter((rec): rec is RemediationRecommendation => rec !== null && typeof rec === 'object');

  const recommendationsRowsHtml = safeRecommendations.length === 0
    ? `<div class="empty-notice">Aucune recommandation particuliere. Votre empreinte numerique est sous controle.</div>`
    : safeRecommendations
        .map((rec) => {
          let priorityLabel = 'Priorite 4 (Basse)';
          let priorityBg = '#f1f5f9';
          let priorityColor = '#475569';
          if (rec.priority === 1) {
            priorityLabel = 'Priorite 1 (Critique)';
            priorityBg = '#fef2f2';
            priorityColor = '#ef4444';
          } else if (rec.priority === 2) {
            priorityLabel = 'Priorite 2 (Haute)';
            priorityBg = '#fff7ed';
            priorityColor = '#f97316';
          } else if (rec.priority === 3) {
            priorityLabel = 'Priorite 3 (Moyenne)';
            priorityBg = '#fffbeb';
            priorityColor = '#f59e0b';
          }

          const targetServiceBadge = rec.targetService
            ? `<span class="badge badge-neutral">${escapeHtml(rec.targetService).replace(/[-–—]/g, ' ')}</span>`
            : '';

          const safeTitle = escapeHtml(rec.title || '').replace(/[-–—]/g, ' ');
          const safeDesc = escapeHtml(rec.description || '').replace(/[-–—]/g, ' ');

          return `
            <div class="recommendation-card">
              <div class="rec-header">
                <span class="badge" style="background:${priorityBg}; color:${priorityColor}; border-color:${priorityColor}40;">
                  ${priorityLabel}
                </span>
                ${targetServiceBadge}
              </div>
              <h4 class="rec-title">${safeTitle}</h4>
              <p class="rec-desc">${safeDesc}</p>
            </div>
          `;
        })
        .join('');

  // Accounts rows
  const accountsRowsHtml = safeAccounts.length === 0
    ? `<tr><td colspan="7" class="empty-cell">Aucun compte public repertorie lors de cet audit.</td></tr>`
    : safeAccounts
        .map((acc) => {
          const resBadge = getAccountResolutionBadge(acc.cleaned, (acc as any).status);
          const jdmBadge = getJdmDifficultyBadge(acc.jdm?.difficulty);
          const deleteUrl = acc.jdm?.deleteUrl;
          const actionLinkHtml = deleteUrl
            ? `<a href="${escapeHtml(deleteUrl)}" target="_blank" rel="noopener noreferrer" class="action-btn-link">Page de suppression</a>`
            : `<span class="text-muted">Aucun lien direct</span>`;

          const safeServiceName = escapeHtml(acc.serviceName || acc.serviceId || 'Service inconnu').replace(/[-–—]/g, ' ');

          return `
            <tr>
              <td>
                <span class="badge" style="background:${resBadge.badgeBg}; color:${resBadge.color}; border-color:${resBadge.color}40;">
                  ${resBadge.labelFr}
                </span>
              </td>
              <td><strong>${safeServiceName}</strong></td>
              <td><code>${escapeHtml(acc.accountIdentifier || 'Identifiant non precise')}</code></td>
              <td><code>${escapeHtml(acc.domain || 'Domaine non precise')}</code></td>
              <td><span class="badge badge-tool">${escapeHtml(acc.sourceTool || 'Manuel')}</span></td>
              <td>
                <span class="badge" style="background:${jdmBadge.badgeBg}; color:${jdmBadge.color}; border-color:${jdmBadge.color}40;">
                  ${jdmBadge.labelFr}
                </span>
              </td>
              <td>${actionLinkHtml}</td>
            </tr>
          `;
        })
        .join('');

  // Leaks rows
  const leaksRowsHtml = safeLeaks.length === 0
    ? `<tr><td colspan="5" class="empty-cell">Aucune fuite de donnees ni breche compromise identifiee pour cette cible.</td></tr>`
    : safeLeaks
        .map((leak) => {
          const leakDate = leak.breachDate ? formatFrenchDate(leak.breachDate) : 'Date non precisee';
          const safeBreachName = escapeHtml(leak.breachName || 'Breche inconnue').replace(/[-–—]/g, ' ');
          const rawDataClasses = Array.isArray(leak.dataClasses) ? leak.dataClasses : [];
          const dataClassesBadges = rawDataClasses
            .map((cls) => cls ? `<span class="badge badge-data-class">${escapeHtml(String(cls)).replace(/[-–—]/g, ' ')}</span>` : '')
            .filter(Boolean)
            .join(' ') || '<span class="text-muted">Non precise</span>';

          return `
            <tr>
              <td><span class="badge badge-tool">${escapeHtml(leak.sourceTool || 'Manuel')}</span></td>
              <td><strong>${safeBreachName}</strong></td>
              <td>${leakDate}</td>
              <td>${dataClassesBadges}</td>
              <td><span class="text-sm">${escapeHtml(leak.details || 'Aucun detail complementaire').replace(/[-–—]/g, ' ')}</span></td>
            </tr>
          `;
        })
        .join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Rapport d audit de confidentialite et OSINT</title>
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: system-ui, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8fafc;
      color: #0f172a;
      line-height: 1.5;
      font-size: 14px;
      padding: 24px;
    }
    .report-container {
      max-width: 980px;
      margin: 0 auto;
    }
    .report-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .header-branding h1 {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.02em;
    }
    .header-branding p {
      font-size: 13px;
      color: #64748b;
      margin-top: 2px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
    }
    .meta-item {
      background: #f8fafc;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid #f1f5f9;
    }
    .meta-label {
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .meta-value {
      font-size: 13px;
      font-weight: 500;
      color: #1e293b;
      margin-top: 4px;
      word-break: break-all;
    }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .risk-panel-grid {
      display: grid;
      grid-template-columns: 220px 1fr;
      gap: 24px;
      align-items: center;
    }
    .gauge-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 12px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .stat-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
    }
    .stat-number {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
    }
    .stat-label {
      font-size: 12px;
      color: #64748b;
      font-weight: 500;
    }
    .score-breakdown-note {
      grid-column: 1 / -1;
      background: #f1f5f9;
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 12px;
      color: #475569;
    }
    .recommendations-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .recommendation-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px 16px;
      background: #ffffff;
    }
    .rec-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .rec-title {
      font-size: 14px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .rec-desc {
      font-size: 13px;
      color: #475569;
      line-height: 1.4;
    }
    .table-responsive {
      width: 100%;
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }
    thead th {
      background: #f8fafc;
      color: #475569;
      font-weight: 600;
      font-size: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid #e2e8f0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    tbody td {
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
    }
    tbody tr:hover {
      background: #f8fafc;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid transparent;
      white-space: nowrap;
    }
    .badge-tool {
      background: #f1f5f9;
      color: #334155;
      border-color: #cbd5e1;
    }
    .badge-neutral {
      background: #f1f5f9;
      color: #475569;
      border-color: #e2e8f0;
    }
    .badge-data-class {
      background: #fee2e2;
      color: #991b1b;
      border-color: #fca5a5;
      font-size: 10px;
      padding: 1px 6px;
    }
    .action-btn-link {
      color: #2563eb;
      font-weight: 600;
      text-decoration: none;
    }
    .action-btn-link:hover {
      text-decoration: underline;
    }
    .empty-cell {
      text-align: center;
      padding: 24px;
      color: #64748b;
      font-style: italic;
    }
    .empty-notice {
      padding: 16px;
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-radius: 8px;
      color: #065f46;
      font-size: 13px;
    }
    .legal-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      font-size: 12px;
      color: #475569;
      line-height: 1.5;
    }
    .report-footer {
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
      padding-top: 16px;
      border-top: 1px solid #e2e8f0;
      margin-top: 24px;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
      color: #0f172a;
    }
    .text-muted {
      color: #94a3b8;
      font-size: 12px;
    }
    .text-sm {
      font-size: 12px;
      color: #475569;
    }

    @media (max-width: 640px) {
      body {
        padding: 12px;
      }
      .risk-panel-grid {
        grid-template-columns: 1fr;
        justify-items: center;
      }
      .stats-grid {
        width: 100%;
      }
    }

    @page {
      size: A4 portrait;
      margin: 12mm 15mm 15mm 15mm;
    }

    @media print {
      body {
        background: #ffffff !important;
        color: #0f172a !important;
        font-size: 10pt !important;
        padding: 0 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .report-container {
        max-width: 100% !important;
      }
      .report-card {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        border: 1px solid #cbd5e1 !important;
        box-shadow: none !important;
        margin-bottom: 12pt !important;
        padding: 16px !important;
      }
      table {
        page-break-inside: auto !important;
        width: 100% !important;
      }
      thead {
        display: table-header-group !important;
      }
      tr {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      h1, h2, h3, h4 {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
      .no-print {
        display: none !important;
      }
      a {
        color: #2563eb !important;
        text-decoration: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="report-container">

    <!-- Section 1 : En tete et Cibles -->
    <header class="report-card">
      <div class="header-top">
        <div class="header-branding">
          <h1>OSINT Privacy Suite</h1>
          <p>Rapport officiel d audit de confidentialite et d empreinte numerique</p>
        </div>
        <div class="header-badge">
          <span class="badge" style="background:#ecfdf5; color:#047857; border-color:#a7f3d0; padding:6px 12px; font-size:12px;">
            Audit 100% hors ligne et confidentiel
          </span>
        </div>
      </div>

      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">Date de l audit</div>
          <div class="meta-value">${scanDate}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Identifiant de l analyse</div>
          <div class="meta-value"><code>${escapeHtml(scanId)}</code></div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Adresse electronique</div>
          <div class="meta-value"><code>${escapeHtml(targetEmail)}</code></div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Pseudonyme recherche</div>
          <div class="meta-value"><code>${escapeHtml(targetUsername)}</code></div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Numero de telephone</div>
          <div class="meta-value"><code>${escapeHtml(targetPhone)}</code></div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Modules mobilises</div>
          <div class="meta-value">${escapeHtml(toolsList)}</div>
        </div>
      </div>
    </header>

    <!-- Section 2 : Diagnostic de Risque et Jauge SVG -->
    <section class="report-card">
      <h2 class="section-title">Indice global de risque et diagnostic</h2>
      <div class="risk-panel-grid">
        <div class="gauge-wrapper">
          ${svgGaugeHtml}
        </div>
        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-number">${totalAccounts}</div>
            <div class="stat-label">Comptes publics trouves</div>
          </div>
          <div class="stat-box">
            <div class="stat-number" style="color:#10b981;">${cleanedActual}</div>
            <div class="stat-label">Comptes resolus ou assainis</div>
          </div>
          <div class="stat-box">
            <div class="stat-number" style="color:${pendingAccounts > 0 ? '#ef4444' : '#10b981'};">${pendingAccounts}</div>
            <div class="stat-label">Comptes restant a traiter</div>
          </div>
          <div class="stat-box">
            <div class="stat-number" style="color:${totalLeaks > 0 ? '#ef4444' : '#10b981'};">${totalLeaks}</div>
            <div class="stat-label">Breches de securite recensees</div>
          </div>
          <div class="score-breakdown-note">
            Score decompose : <strong>${safeBreakdown.accountsScore} points</strong> imputables aux comptes non assainis et <strong>${safeBreakdown.leaksScore} points</strong> imputables aux fuites de donnees.
          </div>
        </div>
      </div>
    </section>

    <!-- Section 3 : Recommandations prioritaires -->
    <section class="report-card">
      <h2 class="section-title">Plan d action et recommandations prioritaires</h2>
      <div class="recommendations-list">
        ${recommendationsRowsHtml}
      </div>
    </section>

    <!-- Section 4 : Inventaire des Comptes Détectés -->
    <section class="report-card">
      <h2 class="section-title">Inventaire detaille des comptes detectes</h2>
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th>Statut</th>
              <th>Service</th>
              <th>Identifiant</th>
              <th>Domaine</th>
              <th>Source</th>
              <th>Difficulte JDM</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${accountsRowsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Section 5 : Registre des Fuites et Brèches -->
    <section class="report-card">
      <h2 class="section-title">Registre des fuites et breches de securite</h2>
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Nom de la breche</th>
              <th>Date de compromission</th>
              <th>Donnees compromises</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${leaksRowsHtml}
          </tbody>
        </table>
      </div>
    </section>

    <!-- Section 6 : Cadre Juridique RGPD -->
    <section class="report-card legal-card">
      <h3 style="font-size:14px; font-weight:700; margin-bottom:8px; color:#0f172a;">Cadre juridique et exercice de vos droits</h3>
      <p style="margin-bottom:6px;">
        En application de l Article 17 du Reglement General sur la Protection des Donnees (RGPD), toute personne dispose du droit d obtenir l effacement de ses donnees a caractere personnel dans les meilleurs delais.
      </p>
      <p>
        Les responsables de traitement disposent d un delai legal maximal d un mois a compter de la reception de votre demande formelle pour proceder a l effacement ou notifier les motifs d un refus conforme au cadre europeen.
      </p>
    </section>

    <!-- Section 7 : Pied de Page Confidentiel -->
    <footer class="report-footer">
      <p>Document strictement personnel et confidentiel genere 100% hors ligne par OSINT Privacy Suite.</p>
      <p>Toutes les donnees de cet audit sont conservees exclusivement sur votre equipement local sans transmission externe.</p>
    </footer>

  </div>
</body>
</html>`.trim();
}
