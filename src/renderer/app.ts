/**
 * Main Renderer Controller for OSINT & Privacy Suite
 * Handles navigation across the 4 views, scan orchestration, table filtering,
 * modal dialogs, and local persistence interactions.
 *
 * Strict French rule: ZERO hyphens in any user-facing text, alerts, or labels.
 */

import type { ElectronAPI } from '../preload/index.js';
import type {
  SupportedTool,
  OrchestratorResult,
  OrchestratorProgressEvent,
  ToolStatus,
  UnifiedAccount,
  UnifiedLeak,
} from '../core/types.js';
import type {
  DiscoveredAccountRecord,
  ScanRecord,
} from '../storage/database.js';
import type {
  RiskLevel,
  RiskScoreResult,
  RemediationRecommendation,
} from '../core/risk-engine.js';
import type { AuditComparisonResult } from '../core/audit-comparator.js';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Current application state
let currentScanId: string | null = null;
let currentAccounts: DiscoveredAccountRecord[] = [];
let currentResult: OrchestratorResult | null = null;
let currentRiskResult: RiskScoreResult | null = null;
let currentScanLeaks: UnifiedLeak[] = [];
const toolProgressMap: Record<SupportedTool, { status: ToolStatus; progress: number; message: string }> = {
  holehe: { status: 'queued', progress: 0, message: 'En attente' },
  maigret: { status: 'queued', progress: 0, message: 'En attente' },
  ignorant: { status: 'queued', progress: 0, message: 'En attente' },
  h8mail: { status: 'queued', progress: 0, message: 'En attente' },
  ghunt: { status: 'queued', progress: 0, message: 'En attente' },
  spiderfoot: { status: 'queued', progress: 0, message: 'En attente' },
};

// Helper: Format date in French without hyphens (e.g. 08/11/2026 à 22:30)
function formatDateFr(isoDate?: string | null): string {
  if (!isoDate) return 'Date inconnue';
  try {
    const d = new Date(isoDate);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} à ${hours}:${minutes}`;
  } catch {
    return 'Date non disponible';
  }
}

// Helper: Map JustDeleteMe difficulty to French label (strictly without hyphens)
function getJdmDifficultyLabel(diff?: string | null): { label: string; cssClass: string } {
  const d = (diff || 'unknown').toLowerCase();
  switch (d) {
    case 'easy':
      return { label: 'Facile', cssClass: 'jdm-easy' };
    case 'medium':
      return { label: 'Moyen', cssClass: 'jdm-medium' };
    case 'hard':
      return { label: 'Difficile', cssClass: 'jdm-hard' };
    case 'impossible':
      return { label: 'Impossible', cssClass: 'jdm-impossible' };
    case 'limited':
    case 'conditional':
      return { label: 'Conditionnel', cssClass: 'jdm-limited' };
    default:
      return { label: 'Inconnu', cssClass: 'jdm-unknown' };
  }
}

// Helper: Status label without hyphens
function getStatusLabel(status: ToolStatus): string {
  switch (status) {
    case 'queued':
      return 'En attente';
    case 'running':
      return 'En cours';
    case 'completed':
      return 'Terminé';
    case 'failed':
      return 'Erreur';
    case 'skipped':
      return 'Ignoré';
    default:
      return 'En attente';
  }
}

/* ==========================================================================
   GESTION DU THEME SOMBRE ET CLAIR
   ========================================================================== */
const THEME_STORAGE_KEY = 'osint_theme';
export type AppTheme = 'dark' | 'light';

const SVG_SUN = `
  <svg class="svg-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="5"></circle>
    <line x1="12" y1="1" x2="12" y2="3"></line>
    <line x1="12" y1="21" x2="12" y2="23"></line>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
    <line x1="1" y1="12" x2="3" y2="12"></line>
    <line x1="21" y1="12" x2="23" y2="12"></line>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
  </svg>
`;

const SVG_MOON = `
  <svg class="svg-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
  </svg>
`;

export function getSavedTheme(): AppTheme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Local storage unavailable
  }
  return 'dark';
}

export function applyTheme(theme: AppTheme): void {
  const isLight = theme === 'light';
  document.body.classList.toggle('light-theme', isLight);
  document.body.classList.toggle('dark-theme', !isLight);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable
  }

  const iconContainer = document.getElementById('theme-toggle-icon');
  const labelElement = document.getElementById('theme-toggle-label');

  if (iconContainer) {
    iconContainer.innerHTML = isLight ? SVG_MOON : SVG_SUN;
  }
  if (labelElement) {
    labelElement.textContent = isLight ? 'Mode sombre' : 'Mode clair';
  }
}

export function toggleTheme(): void {
  const isCurrentlyLight = document.body.classList.contains('light-theme');
  const nextTheme: AppTheme = isCurrentlyLight ? 'dark' : 'light';
  applyTheme(nextTheme);
}

export function initTheme(): void {
  const toggleBtn = document.getElementById('theme-toggle') || document.getElementById('btn-theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      toggleTheme();
    });
  }

  const initialTheme = getSavedTheme();
  applyTheme(initialTheme);
}

/* ==========================================================================
   MODULE DE NOTIFICATIONS TOAST
   ========================================================================== */
function showToast(
  message: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'info',
  durationMs = 4000
): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'warning') icon = '⚠️';
  if (type === 'error') icon = '❌';

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button type="button" class="toast-close" aria-label="Fermer la notification">&times;</button>
  `;

  const btnClose = toast.querySelector('.toast-close');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      toast.classList.add('toast-fadeout');
      setTimeout(() => toast.remove(), 250);
    });
  }

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.add('toast-fadeout');
      setTimeout(() => toast.remove(), 250);
    }
  }, durationMs);
}

/* ==========================================================================
   NAVIGATION ENTRE LES 4 VUES
   ========================================================================== */
function initNavigation(): void {
  const navBtns = [
    { btnId: 'nav-view1', viewId: 'view1' },
    { btnId: 'nav-view2', viewId: 'view2' },
    { btnId: 'nav-view3', viewId: 'view3' },
    { btnId: 'nav-view4', viewId: 'view4' },
  ];

  navBtns.forEach(({ btnId, viewId }) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    btn.addEventListener('click', () => {
      // Update active nav button
      navBtns.forEach((item) => {
        const b = document.getElementById(item.btnId);
        const v = document.getElementById(item.viewId);
        if (b) b.classList.remove('active');
        if (v) v.classList.remove('active');
      });

      btn.classList.add('active');
      const targetView = document.getElementById(viewId);
      if (targetView) targetView.classList.add('active');

      // Refresh data when switching to specific views
      if (viewId === 'view2') {
        renderAccountsTable();
      } else if (viewId === 'view4') {
        loadSavedScans();
        loadToolsHealth();
      }
    });
  });

  // Switch to View 2 from Banner
  const btnGotoView2 = document.getElementById('btn-goto-view2');
  if (btnGotoView2) {
    btnGotoView2.addEventListener('click', () => {
      const nav2 = document.getElementById('nav-view2');
      if (nav2) nav2.click();
    });
  }
}

/* ==========================================================================
   VUE 1 : ACCUEIL ET LANCEMENT UNIFIÉ
   ========================================================================== */
function initView1(): void {
  const btnStart = document.getElementById('btn-start-scan') as HTMLButtonElement | null;
  const btnCancel = document.getElementById('btn-cancel-scan') as HTMLButtonElement | null;
  const btnSelectAll = document.getElementById('btn-select-all-tools');
  const btnDeselectAll = document.getElementById('btn-deselect-all-tools');

  const toolCheckboxes = document.querySelectorAll<HTMLInputElement>('.tools-grid input[type="checkbox"]');

  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      toolCheckboxes.forEach((cb) => (cb.checked = true));
    });
  }

  if (btnDeselectAll) {
    btnDeselectAll.addEventListener('click', () => {
      toolCheckboxes.forEach((cb) => (cb.checked = false));
    });
  }

  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      await startUnifiedScan();
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', async () => {
      await window.electronAPI.cancelScan(currentScanId || '*');
      const msg = document.getElementById('progress-message');
      if (msg) msg.textContent = 'Arrêt d urgence demandé par l utilisateur.';
    });
  }

  // Subscribe to realtime progress events
  if (window.electronAPI && typeof window.electronAPI.onToolProgress === 'function') {
    window.electronAPI.onToolProgress((event: OrchestratorProgressEvent) => {
      handleProgressUpdate(event);
    });
  }
}

async function startUnifiedScan(): Promise<void> {
  const inputEmail = document.getElementById('input-email') as HTMLInputElement | null;
  const inputUsername = document.getElementById('input-username') as HTMLInputElement | null;
  const inputPhone = document.getElementById('input-phone') as HTMLInputElement | null;
  const selectPrefix = document.getElementById('select-phone-prefix') as HTMLSelectElement | null;

  const email = inputEmail?.value.trim() || undefined;
  const username = inputUsername?.value.trim() || undefined;
  const rawPhone = inputPhone?.value.trim() || '';
  const prefix = selectPrefix?.value || '+33';
  const phone = rawPhone ? `${prefix} ${rawPhone}` : undefined;

  if (!email && !username && !phone) {
    alert('Veuillez renseigner au moins une cible (adresse électronique, pseudonyme ou numéro de téléphone).');
    return;
  }

  // Determine selected tools
  const selectedTools: SupportedTool[] = [];
  const toolCheckboxes = document.querySelectorAll<HTMLInputElement>('.tools-grid input[type="checkbox"]');
  toolCheckboxes.forEach((cb) => {
    if (cb.checked) selectedTools.push(cb.value as SupportedTool);
  });

  if (selectedTools.length === 0) {
    alert('Veuillez sélectionner au moins un outil d analyse.');
    return;
  }

  // Reset UI
  const progressContainer = document.getElementById('scan-progress-container');
  const bannerCompleted = document.getElementById('banner-completed');
  const btnStart = document.getElementById('btn-start-scan') as HTMLButtonElement | null;
  const btnCancel = document.getElementById('btn-cancel-scan') as HTMLButtonElement | null;
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressMessage = document.getElementById('progress-message');

  if (progressContainer) progressContainer.style.display = 'flex';
  if (bannerCompleted) bannerCompleted.style.display = 'none';
  if (btnStart) btnStart.disabled = true;
  if (btnCancel) btnCancel.style.display = 'inline-flex';
  if (progressBarFill) progressBarFill.style.width = '0%';
  if (progressPercent) progressPercent.textContent = '0%';
  if (progressMessage) progressMessage.textContent = 'Lancement des outils en parallèle...';

  // Initialize status cards
  selectedTools.forEach((tool) => {
    toolProgressMap[tool] = { status: 'running', progress: 10, message: 'En cours d analyse' };
    updateToolStatusCard(tool, 'running', 'En cours');
  });

  try {
    const result = await window.electronAPI.startScan({
      targets: { email, username, phone },
      selectedTools,
    });

    currentResult = result;
    currentScanId = result.scanId;
    currentScanLeaks = result.leaks || [];

    // Load newly discovered accounts
    currentAccounts = await window.electronAPI.getAccounts(result.scanId);
    await refreshRiskScore();

    // Finalize progress bar
    if (progressBarFill) progressBarFill.style.width = '100%';
    if (progressPercent) progressPercent.textContent = '100%';
    if (progressMessage) progressMessage.textContent = 'Analyse globale terminée avec succès.';

    // Show completion banner
    if (bannerCompleted) {
      bannerCompleted.style.display = 'flex';
      const summaryText = document.getElementById('banner-summary-text');
      const detailsText = document.getElementById('banner-details-text');
      if (summaryText) {
        summaryText.textContent = `Audit finalisé : ${result.summary.totalAccountsFound} comptes identifiés`;
      }
      if (detailsText) {
        detailsText.textContent = `${result.summary.successfulTools} outils réussis sur ${result.summary.totalTools} mobilisés.`;
      }
    }

    // Refresh OSINT View 3
    populateView3(result);
  } catch (err: any) {
    if (progressMessage) {
      progressMessage.textContent = `Erreur lors de l analyse : ${err?.message || err}`;
    }
  } finally {
    if (btnStart) btnStart.disabled = false;
    if (btnCancel) btnCancel.style.display = 'none';
  }
}

function handleProgressUpdate(event: OrchestratorProgressEvent): void {
  if (event.scanId) {
    currentScanId = event.scanId;
  }
  const tool = event.tool;
  if (!tool) return;

  toolProgressMap[tool] = {
    status: event.status,
    progress: event.progress ?? (event.status === 'completed' ? 100 : 50),
    message: event.message ?? getStatusLabel(event.status),
  };

  updateToolStatusCard(tool, event.status, getStatusLabel(event.status));

  // Compute overall progress
  const tools = Object.values(toolProgressMap);
  const activeTools = tools.filter((t) => t.status !== 'queued');
  if (activeTools.length > 0) {
    const total = activeTools.reduce((acc, curr) => acc + curr.progress, 0);
    const avg = Math.round(total / activeTools.length);
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressMessage = document.getElementById('progress-message');

    if (progressBarFill) progressBarFill.style.width = `${avg}%`;
    if (progressPercent) progressPercent.textContent = `${avg}%`;
    if (progressMessage && event.message) {
      progressMessage.textContent = `[${tool}] ${event.message}`;
    }
  }
}

function updateToolStatusCard(tool: SupportedTool, status: ToolStatus, label: string): void {
  const card = document.getElementById(`status-card-${tool}`);
  if (!card) return;

  const pill = card.querySelector('.status-pill');
  if (!pill) return;

  pill.className = `status-pill status-${status}`;
  pill.textContent = label;
}

/* ==========================================================================
   VUE 2 : AUDIT ET NETTOYAGE DE COMPTES
   ========================================================================== */
function initView2(): void {
  const inputSearch = document.getElementById('input-search-accounts');
  const filterDifficulty = document.getElementById('filter-difficulty');
  const filterStatus = document.getElementById('filter-status');
  const filterTool = document.getElementById('filter-tool');

  [inputSearch, filterDifficulty, filterStatus, filterTool].forEach((el) => {
    if (el) {
      el.addEventListener('input', () => renderAccountsTable());
      el.addEventListener('change', () => renderAccountsTable());
    }
  });

  initGdprModal();
  initExportButtonsView2();
  refreshRiskScore();
}

function initExportButtonsView2(): void {
  const btnExportHtml = document.getElementById('btn-export-html-view2');
  const btnExportPdf = document.getElementById('btn-export-pdf-view2');

  if (btnExportHtml) {
    btnExportHtml.addEventListener('click', async () => {
      if (!currentScanId) {
        showToast('Veuillez d abord lancer ou charger un audit pour exporter le rapport.', 'warning');
        return;
      }
      btnExportHtml.setAttribute('disabled', 'true');
      showToast('Génération du rapport HTML en cours...', 'info');
      try {
        const res = await window.electronAPI.exportHtmlReport(currentScanId);
        if (res.canceled) {
          showToast('Exportation HTML annulée.', 'info');
        } else if (res.success) {
          showToast('Rapport HTML autonome exporté avec succès !', 'success');
        } else {
          showToast(`Échec de l exportation HTML : ${res.error || 'Erreur non précisée'}`, 'error');
        }
      } catch (err: any) {
        showToast(`Erreur : ${err?.message || err}`, 'error');
      } finally {
        btnExportHtml.removeAttribute('disabled');
      }
    });
  }

  if (btnExportPdf) {
    btnExportPdf.addEventListener('click', async () => {
      if (!currentScanId) {
        showToast('Veuillez d abord lancer ou charger un audit pour exporter le rapport.', 'warning');
        return;
      }
      btnExportPdf.setAttribute('disabled', 'true');
      showToast('Génération du document PDF en cours...', 'info');
      try {
        const res = await window.electronAPI.exportPdfReport(currentScanId);
        if (res.canceled) {
          showToast('Exportation PDF annulée.', 'info');
        } else if (res.success) {
          showToast('Rapport PDF officiel exporté avec succès !', 'success');
        } else {
          showToast(`Échec de l exportation PDF : ${res.error || 'Erreur non précisée'}`, 'error');
        }
      } catch (err: any) {
        showToast(`Erreur : ${err?.message || err}`, 'error');
      } finally {
        btnExportPdf.removeAttribute('disabled');
      }
    });
  }
}

function getRiskLevelInfo(level?: RiskLevel | string): {
  label: string;
  shortLabel: string;
  color: string;
  badgeClass: string;
  frenchBadgeClass: string;
} {
  const l = (level || 'low').toLowerCase();
  switch (l) {
    case 'critical':
      return {
        label: 'Risque critique',
        shortLabel: 'Critique',
        color: '#ef4444',
        badgeClass: 'badge-risk-critical',
        frenchBadgeClass: 'badge-risk-critique',
      };
    case 'elevated':
      return {
        label: 'Risque élevé',
        shortLabel: 'Élevé',
        color: '#f97316',
        badgeClass: 'badge-risk-elevated',
        frenchBadgeClass: 'badge-risk-eleve',
      };
    case 'moderate':
      return {
        label: 'Risque modéré',
        shortLabel: 'Modéré',
        color: '#f59e0b',
        badgeClass: 'badge-risk-moderate',
        frenchBadgeClass: 'badge-risk-moyen',
      };
    case 'low':
    default:
      return {
        label: 'Risque faible',
        shortLabel: 'Faible',
        color: '#10b981',
        badgeClass: 'badge-risk-low',
        frenchBadgeClass: 'badge-risk-faible',
      };
  }
}

async function refreshRiskScore(
  accounts?: (UnifiedAccount | DiscoveredAccountRecord)[],
  leaks?: UnifiedLeak[]
): Promise<void> {
  try {
    const targetAccounts = accounts !== undefined ? accounts : currentAccounts;
    const targetLeaks = leaks !== undefined ? leaks : currentScanLeaks;
    const riskResult = await window.electronAPI.calculateRiskScore(targetAccounts, targetLeaks);
    currentRiskResult = riskResult;
    renderRiskScoreUI(riskResult);
  } catch (err: any) {
    console.error('Erreur lors du calcul du score de risque :', err);
  }
}

function renderRiskScoreUI(result: RiskScoreResult): void {
  const clampedScore = Math.max(0, Math.min(100, Math.round(result.score || 0)));
  const circumference = 439.82; // 2 * Math.PI * 70
  const strokeOffset = (circumference * (1 - clampedScore / 100)).toFixed(2);
  const levelInfo = getRiskLevelInfo(result.level);

  // 1. Cercle SVG
  const circleArc = document.getElementById('gauge-progress-circle') as SVGCircleElement | null;
  if (circleArc) {
    circleArc.style.strokeDashoffset = strokeOffset;
    circleArc.style.stroke = levelInfo.color;
  }

  // 2. Chiffre et libelle central
  const scoreVal = document.getElementById('gauge-score-value');
  const levelText = document.getElementById('gauge-level-text');
  if (scoreVal) scoreVal.textContent = String(clampedScore);
  if (levelText) {
    levelText.textContent = levelInfo.shortLabel.toUpperCase();
    levelText.style.fill = levelInfo.color;
  }

  // 3. Badge textuel de niveau
  const levelBadge = document.getElementById('risk-level-badge');
  if (levelBadge) {
    levelBadge.textContent = levelInfo.label;
    levelBadge.className = `badge ${levelInfo.badgeClass} ${levelInfo.frenchBadgeClass}`;
  }

  // 4. Decomposition metrique
  const uncleanedEl = document.getElementById('risk-uncleaned-count');
  const accountsScoreEl = document.getElementById('risk-accounts-score');
  const criticalLeaksEl = document.getElementById('risk-critical-leaks');
  const leaksScoreEl = document.getElementById('risk-leaks-score');

  if (uncleanedEl) uncleanedEl.textContent = String(result.breakdown?.uncleanedCount ?? 0);
  if (accountsScoreEl) accountsScoreEl.textContent = `${result.breakdown?.accountsScore ?? 0} / 60`;
  if (criticalLeaksEl) criticalLeaksEl.textContent = String(result.breakdown?.criticalLeaksCount ?? 0);
  if (leaksScoreEl) leaksScoreEl.textContent = `${result.breakdown?.leaksScore ?? 0} / 100`;

  // 5. Recommandations prioritaires
  renderRecommendations(result.recommendations || []);
}

function renderRecommendations(recommendations: RemediationRecommendation[]): void {
  const container = document.getElementById('risk-recommendations-list');
  const countBadge = document.getElementById('recommendations-count-badge');
  if (!container) return;

  const count = recommendations.length;
  if (countBadge) {
    const word = count === 1 ? 'recommandation' : 'recommandations';
    countBadge.textContent = `${count} ${word}`;
  }

  if (count === 0) {
    container.innerHTML = `
      <div class="empty-recommendations-state">
        <p class="text-secondary">Aucune recommandation active. Vos comptes identifiés sont assainis ou aucune fuite n a été détectée.</p>
      </div>
    `;
    return;
  }

  const priorityLabels: Record<number, { label: string; cssClass: string }> = {
    1: { label: 'Priorité 1', cssClass: 'badge-risk-critical badge-risk-critique' },
    2: { label: 'Priorité 2', cssClass: 'badge-risk-elevated badge-risk-eleve' },
    3: { label: 'Priorité 3', cssClass: 'badge-risk-moderate badge-risk-moyen' },
    4: { label: 'Priorité 4', cssClass: 'badge-blue' },
  };

  const actionIcons: Record<string, string> = {
    password: '🔑 Mot de passe',
    delete: '🗑️ Suppression',
    gdpr: '📜 Exercice RGPD',
    export: '📦 Sauvegarde',
  };

  container.innerHTML = recommendations
    .map((rec) => {
      const pInfo = priorityLabels[rec.priority] || priorityLabels[4];
      const actionIcon = actionIcons[rec.actionType] || '🛡️ Action';
      return `
        <div class="recommendation-item-card priority-${rec.priority}">
          <div class="rec-header">
            <div class="rec-tags">
              <span class="badge ${pInfo.cssClass}">${pInfo.label}</span>
              ${rec.targetService ? `<span class="badge badge-subtle">${escapeHtml(rec.targetService)}</span>` : ''}
            </div>
            <span class="rec-action-type">${actionIcon}</span>
          </div>
          <h4 class="rec-title">${escapeHtml(rec.title)}</h4>
          <p class="rec-desc text-secondary">${escapeHtml(rec.description)}</p>
        </div>
      `;
    })
    .join('');
}

function renderAccountsTable(): void {
  const tbody = document.getElementById('accounts-tbody');
  if (!tbody) return;

  const inputSearch = document.getElementById('input-search-accounts') as HTMLInputElement | null;
  const filterDifficulty = document.getElementById('filter-difficulty') as HTMLSelectElement | null;
  const filterStatus = document.getElementById('filter-status') as HTMLSelectElement | null;
  const filterTool = document.getElementById('filter-tool') as HTMLSelectElement | null;

  const search = (inputSearch?.value || '').toLowerCase().trim();
  const diffFilter = filterDifficulty?.value || 'all';
  const statusFilter = filterStatus?.value || 'all';
  const toolFilter = filterTool?.value || 'all';

  // Filter accounts
  const filtered = currentAccounts.filter((acc) => {
    // Search match
    if (search) {
      const matchName = acc.service_name.toLowerCase().includes(search);
      const matchDomain = acc.domain.toLowerCase().includes(search);
      const matchIdent = acc.account_identifier.toLowerCase().includes(search);
      if (!matchName && !matchDomain && !matchIdent) return false;
    }

    // Difficulty match
    if (diffFilter !== 'all') {
      const d = (acc.jdm_difficulty || 'unknown').toLowerCase();
      if (d !== diffFilter) return false;
    }

    // Status match
    if (statusFilter !== 'all') {
      if (statusFilter === 'completed' && acc.status !== 'completed' && acc.status !== 'deleted') return false;
      if (statusFilter === 'detected' && (acc.status === 'completed' || acc.status === 'deleted')) return false;
    }

    // Tool match
    if (toolFilter !== 'all') {
      const tools = Array.isArray(acc.source_tools) ? acc.source_tools : [];
      if (!tools.includes(toolFilter)) return false;
    }

    return true;
  });

  // Update statistics cards
  updateAccountStats();

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          Aucun compte ne correspond aux filtres sélectionnés.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach((acc) => {
    const isCompleted = acc.status === 'completed' || acc.status === 'deleted';
    const tr = document.createElement('tr');
    if (isCompleted) tr.classList.add('row-completed');

    const diffInfo = getJdmDifficultyLabel(acc.jdm_difficulty);
    const sourceBadges = (acc.source_tools || ['inconnu'])
      .map((t) => `<span class="badge badge-blue">${escapeHtml(t)}</span>`)
      .join(' ');

    tr.innerHTML = `
      <td>
        <input type="checkbox" class="account-status-checkbox" data-id="${escapeHtml(acc.id)}" ${isCompleted ? 'checked' : ''}>
      </td>
      <td>
        <div class="service-title" style="font-weight: 600; color: var(--text-primary);">${escapeHtml(acc.service_name)}</div>
        <div class="text-secondary" style="font-size: 0.75rem;">${escapeHtml(acc.domain)}</div>
      </td>
      <td>
        <code>${escapeHtml(acc.account_identifier)}</code>
      </td>
      <td>
        ${sourceBadges}
      </td>
      <td>
        <span class="jdm-badge ${diffInfo.cssClass}">${diffInfo.label}</span>
      </td>
      <td style="text-align: right;">
        <div class="action-buttons">
          ${
            acc.jdm_deletion_url
              ? `<button type="button" class="btn-table-action btn-delete-url" data-url="${escapeHtml(acc.jdm_deletion_url)}">Supprimer</button>`
              : ''
          }
          ${
            acc.jgmd_export_url
              ? `<button type="button" class="btn-table-action btn-export-url" data-url="${escapeHtml(acc.jgmd_export_url)}">Données</button>`
              : ''
          }
          <button type="button" class="btn-table-action btn-table-gdpr" data-id="${escapeHtml(acc.id)}">Demande RGPD</button>
        </div>
      </td>
    `;

    // Event: Checkbox status toggle
    const checkbox = tr.querySelector('.account-status-checkbox') as HTMLInputElement | null;
    if (checkbox) {
      checkbox.addEventListener('change', async () => {
        const newStatus = checkbox.checked ? 'completed' : 'detected';
        await window.electronAPI.updateAccountStatus(acc.id, newStatus);
        acc.status = newStatus as any;
        if (checkbox.checked) {
          tr.classList.add('row-completed');
        } else {
          tr.classList.remove('row-completed');
        }
        updateAccountStats();
        await refreshRiskScore();
      });
    }

    // Event: Delete external link
    const btnDelete = tr.querySelector('.btn-delete-url');
    if (btnDelete) {
      btnDelete.addEventListener('click', () => {
        const url = btnDelete.getAttribute('data-url');
        if (url) window.electronAPI.openExternal(url);
      });
    }

    // Event: Data export external link
    const btnData = tr.querySelector('.btn-export-url');
    if (btnData) {
      btnData.addEventListener('click', () => {
        const url = btnData.getAttribute('data-url');
        if (url) window.electronAPI.openExternal(url);
      });
    }

    // Event: GDPR modal trigger
    const btnGdpr = tr.querySelector('.btn-table-gdpr');
    if (btnGdpr) {
      btnGdpr.addEventListener('click', () => {
        openGdprModal(acc);
      });
    }

    tbody.appendChild(tr);
  });
}

function updateAccountStats(): void {
  const total = currentAccounts.length;
  const easyMedium = currentAccounts.filter((a) => {
    const d = (a.jdm_difficulty || '').toLowerCase();
    return d === 'easy' || d === 'medium';
  }).length;
  const processed = currentAccounts.filter((a) => a.status === 'completed' || a.status === 'deleted').length;
  const rate = total > 0 ? Math.round((processed / total) * 100) : 0;

  const statTotal = document.getElementById('stat-total-accounts');
  const statEasyMed = document.getElementById('stat-easy-medium');
  const statProc = document.getElementById('stat-processed');
  const statRate = document.getElementById('stat-sanitization-rate');

  if (statTotal) statTotal.textContent = String(total);
  if (statEasyMed) statEasyMed.textContent = String(easyMedium);
  if (statProc) statProc.textContent = String(processed);
  if (statRate) statRate.textContent = `${rate}%`;
}

/* ==========================================================================
   MODALE RGPD ARTICLE 17 (Droit à l'effacement sans tiret)
   ========================================================================== */
let activeGdprMailtoUri = '';
let activeGdprAccountId: string | null = null;
let activeGdprServiceName = '';

function initGdprModal(): void {
  const modal = document.getElementById('modal-gdpr');
  const btnClose = document.getElementById('btn-modal-close');
  const btnCopy = document.getElementById('btn-gdpr-copy');
  const btnMailto = document.getElementById('btn-gdpr-mailto');
  const btnSave = document.getElementById('btn-gdpr-save');

  if (btnClose && modal) {
    btnClose.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  // Close on backdrop click
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const bodyInput = document.getElementById('gdpr-input-body') as HTMLTextAreaElement | null;
      if (bodyInput && bodyInput.value) {
        window.electronAPI.writeClipboard(bodyInput.value);
        showModalFeedback('Texte copié dans le presse papier !');
      }
    });
  }

  if (btnMailto) {
    btnMailto.addEventListener('click', () => {
      if (activeGdprMailtoUri) {
        window.electronAPI.openExternal(activeGdprMailtoUri);
      }
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      const recipientInput = document.getElementById('gdpr-input-recipient') as HTMLInputElement | null;
      const subjectInput = document.getElementById('gdpr-input-subject') as HTMLInputElement | null;
      const bodyInput = document.getElementById('gdpr-input-body') as HTMLTextAreaElement | null;

      try {
        await window.electronAPI.saveGdprRequest({
          accountId: activeGdprAccountId,
          scanId: currentScanId,
          serviceName: activeGdprServiceName,
          recipientEmail: recipientInput?.value || '',
          legalBasis: 'GDPR_ART_17_ERASURE',
          emailSubject: subjectInput?.value || '',
          emailBody: bodyInput?.value || '',
        });
        showModalFeedback('Démarche enregistrée avec succès !');
      } catch (err: any) {
        showModalFeedback(`Erreur : ${err?.message || err}`);
      }
    });
  }
}

async function openGdprModal(account: DiscoveredAccountRecord): Promise<void> {
  const modal = document.getElementById('modal-gdpr');
  if (!modal) return;

  activeGdprAccountId = account.id;
  activeGdprServiceName = account.service_name;
  modal.style.display = 'flex';

  const emailResult = await window.electronAPI.generateGdprEmail({
    serviceName: account.service_name,
    accountUsername: account.account_identifier,
    userEmail: account.account_identifier.includes('@') ? account.account_identifier : '',
    recipientEmail: account.jdm_dpo_email || undefined,
    language: 'fr',
  });

  activeGdprMailtoUri = emailResult.mailtoUri;

  const recipientInput = document.getElementById('gdpr-input-recipient') as HTMLInputElement | null;
  const subjectInput = document.getElementById('gdpr-input-subject') as HTMLInputElement | null;
  const bodyInput = document.getElementById('gdpr-input-body') as HTMLTextAreaElement | null;
  const feedback = document.getElementById('modal-feedback-text');

  if (recipientInput) recipientInput.value = emailResult.recipientEmail;
  if (subjectInput) subjectInput.value = emailResult.subject;
  if (bodyInput) bodyInput.value = emailResult.body;
  if (feedback) feedback.textContent = '';
}

function showModalFeedback(msg: string): void {
  const feedback = document.getElementById('modal-feedback-text');
  if (feedback) {
    feedback.textContent = msg;
    setTimeout(() => {
      if (feedback.textContent === msg) feedback.textContent = '';
    }, 4000);
  }
}

/* ==========================================================================
   VUE 3 : EXPLORATION OSINT APPROFONDIE PAR ONGLETS
   ========================================================================== */
function initView3(): void {
  const subtabBtns = document.querySelectorAll<HTMLButtonElement>('.subtab-btn');
  subtabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      subtabBtns.forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.subtab-panel').forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-subtab');
      if (targetId) {
        const panel = document.getElementById(targetId);
        if (panel) panel.classList.add('active');
      }
    });
  });
}

function populateView3(result: OrchestratorResult): void {
  const toolResults = result.toolResults;

  // 1. Holehe
  const holeheContainer = document.getElementById('holehe-results-container');
  if (holeheContainer) {
    const holehe = toolResults.holehe;
    if (holehe && holehe.accounts && holehe.accounts.length > 0) {
      holeheContainer.innerHTML = holehe.accounts
        .map(
          (a) => `
          <div class="tool-status-card">
            <div>
              <strong>${escapeHtml(a.serviceName)}</strong>
              <div class="text-secondary" style="font-size: 0.8rem;">${escapeHtml(a.accountIdentifier)}</div>
            </div>
            <span class="badge badge-blue">Compte présent</span>
          </div>
        `
        )
        .join('');
    } else {
      holeheContainer.innerHTML = '<p class="text-secondary">Aucun compte détecté par Holehe.</p>';
    }
  }

  // 2. Maigret
  const maigretContainer = document.getElementById('maigret-results-container');
  const btnMaigretReport = document.getElementById('btn-open-maigret-report') as HTMLButtonElement | null;
  if (maigretContainer) {
    const maigret = toolResults.maigret;
    if (maigret && maigret.accounts && maigret.accounts.length > 0) {
      maigretContainer.innerHTML = maigret.accounts
        .map(
          (a) => `
          <div class="tool-status-card">
            <div>
              <strong>${escapeHtml(a.serviceName)}</strong>
              <div class="text-secondary" style="font-size: 0.8rem;">${escapeHtml(a.profileUrl || a.accountIdentifier)}</div>
            </div>
            ${
              a.profileUrl
                ? `<button type="button" class="btn-table-action btn-open-link" data-url="${escapeHtml(a.profileUrl)}">Voir profil</button>`
                : ''
            }
          </div>
        `
        )
        .join('');

      maigretContainer.querySelectorAll('.btn-open-link').forEach((b) => {
        b.addEventListener('click', () => {
          const url = b.getAttribute('data-url');
          if (url) window.electronAPI.openExternal(url);
        });
      });

      if (btnMaigretReport && (maigret as any).reportPath) {
        btnMaigretReport.style.display = 'inline-flex';
        btnMaigretReport.onclick = () => {
          window.electronAPI.openExternal(`file://${(maigret as any).reportPath}`);
        };
      }
    } else {
      maigretContainer.innerHTML = '<p class="text-secondary">Aucun profil public trouvé par Maigret.</p>';
    }
  }

  // 3. Ignorant
  const ignorantContainer = document.getElementById('ignorant-results-container');
  if (ignorantContainer) {
    const ignorant = toolResults.ignorant;
    if (ignorant && ignorant.accounts && ignorant.accounts.length > 0) {
      ignorantContainer.innerHTML = ignorant.accounts
        .map(
          (a) => `
          <div class="tool-status-card">
            <div>
              <strong>${escapeHtml(a.serviceName)}</strong>
              <div class="text-secondary" style="font-size: 0.8rem;">${escapeHtml(a.accountIdentifier)}</div>
            </div>
            <span class="badge badge-cyan">Messagerie active</span>
          </div>
        `
        )
        .join('');
    } else {
      ignorantContainer.innerHTML = '<p class="text-secondary">Aucune présence messagerie trouvée par Ignorant.</p>';
    }
  }

  // 4. GHunt
  const ghuntContainer = document.getElementById('ghunt-results-container');
  if (ghuntContainer) {
    const ghunt = toolResults.ghunt;
    if (ghunt && ghunt.accounts && ghunt.accounts.length > 0) {
      const gAcc = ghunt.accounts[0];
      const meta = gAcc.metadata || {};
      ghuntContainer.innerHTML = `
        <div class="card" style="background: rgba(239, 68, 68, 0.05); border-color: rgba(239, 68, 68, 0.3);">
          <div style="display: flex; gap: 1rem; align-items: center;">
            <div style="font-size: 2.5rem;">👤</div>
            <div>
              <h3 style="color: var(--text-primary);">${escapeHtml(meta.name || gAcc.accountIdentifier)}</h3>
              <p class="text-secondary" style="font-size: 0.85rem;">Gaia ID : <code>${escapeHtml(meta.gaiaId || 'Non extrait')}</code></p>
            </div>
          </div>
          <div style="margin-top: 1rem;">
            <strong style="font-size: 0.85rem; color: var(--text-primary);">Services Google détectés :</strong>
            <p class="text-secondary" style="font-size: 0.85rem; margin-top: 0.25rem;">
              ${Array.isArray(meta.services) && meta.services.length > 0 ? meta.services.join(', ') : 'Profil public, YouTube, Google Maps'}
            </p>
          </div>
        </div>
      `;
    } else {
      ghuntContainer.innerHTML = '<p class="text-secondary">Aucun profil Google extrait par GHunt.</p>';
    }
  }

  // 5. h8mail
  const h8mailContainer = document.getElementById('h8mail-results-container');
  if (h8mailContainer) {
    const leaks = result.leaks || [];
    if (leaks.length > 0) {
      h8mailContainer.innerHTML = `
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Brèche ou Fuite</th>
                <th>Cible</th>
                <th>Données compromises</th>
                <th>Détails</th>
              </tr>
            </thead>
            <tbody>
              ${leaks
                .map(
                  (l) => `
                <tr>
                  <td><strong style="color: #f87171;">${escapeHtml(l.breachName)}</strong></td>
                  <td><code>${escapeHtml(l.target)}</code></td>
                  <td>${(l.dataClasses || []).map((c) => `<span class="badge badge-purple">${escapeHtml(c)}</span>`).join(' ')}</td>
                  <td class="text-secondary" style="font-size: 0.8rem;">${escapeHtml(l.details)}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    } else {
      h8mailContainer.innerHTML = `
        <div class="info-box" style="background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.3);">
          <strong style="color: #34d399;">Aucune brèche de données répertoriée</strong>
          <p class="text-secondary">Vos identifiants ne figurent dans aucune fuite connue analysée par h8mail.</p>
        </div>
      `;
    }
  }

  // 6. SpiderFoot
  const spiderfootContainer = document.getElementById('spiderfoot-results-container');
  if (spiderfootContainer) {
    const sf = toolResults.spiderfoot;
    if (sf && sf.accounts && sf.accounts.length > 0) {
      spiderfootContainer.innerHTML = sf.accounts
        .map(
          (a) => `
          <div class="tool-status-card">
            <div>
              <strong>${escapeHtml(a.serviceName)}</strong>
              <div class="text-secondary" style="font-size: 0.8rem;">${escapeHtml(a.domain)}</div>
            </div>
            <span class="badge badge-amber">Corrélation passive</span>
          </div>
        `
        )
        .join('');
    } else {
      spiderfootContainer.innerHTML = '<p class="text-secondary">Aucune corrélation passive extraite par SpiderFoot.</p>';
    }
  }
}

/* ==========================================================================
   VUE 4 : DOSSIERS LOCAUX ET PARAMÈTRES
   ========================================================================== */
function initView4(): void {
  initComparatorView4();

  const btnCheckAllHealth = document.getElementById('btn-check-all-health');
  if (btnCheckAllHealth) {
    btnCheckAllHealth.addEventListener('click', async () => {
      await loadToolsHealth(true);
    });
  }

  const btnImportTrigger = document.getElementById('btn-import-json-trigger');
  const fileInput = document.getElementById('file-import-json') as HTMLInputElement | null;

  if (btnImportTrigger && fileInput) {
    btnImportTrigger.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = e.target?.result as string;
          const newScanId = await window.electronAPI.importScanJson(content);
          alert(`Dossier importé avec succès (Identifiant : ${newScanId})`);
          loadSavedScans();
        } catch (err: any) {
          alert(`Échec de l import : ${err?.message || err}`);
        }
      };
      reader.readAsText(file);
    });
  }

  // Settings save button
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const feedbackSettings = document.getElementById('settings-save-feedback');
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
      const hibpKey = (document.getElementById('input-hibp-key') as HTMLInputElement | null)?.value || '';
      const hunterKey = (document.getElementById('input-hunter-key') as HTMLInputElement | null)?.value || '';

      localStorage.setItem('osint_hibp_key', hibpKey);
      localStorage.setItem('osint_hunter_key', hunterKey);

      if (feedbackSettings) {
        feedbackSettings.style.display = 'inline';
        setTimeout(() => {
          feedbackSettings.style.display = 'none';
        }, 3000);
      }
    });
  }

  // Restore saved API keys
  const savedHibp = localStorage.getItem('osint_hibp_key');
  const savedHunter = localStorage.getItem('osint_hunter_key');
  if (savedHibp) {
    const el = document.getElementById('input-hibp-key') as HTMLInputElement | null;
    if (el) el.value = savedHibp;
  }
  if (savedHunter) {
    const el = document.getElementById('input-hunter-key') as HTMLInputElement | null;
    if (el) el.value = savedHunter;
  }
}

/* ==========================================================================
   COMPARATEUR D AUDITS CHRONOLOGIQUE
   ========================================================================== */
function initComparatorView4(): void {
  const btnCompare = document.getElementById('btn-compare-audits');
  if (!btnCompare) return;

  btnCompare.addEventListener('click', async () => {
    const selectA = document.getElementById('select-audit-a') as HTMLSelectElement | null;
    const selectB = document.getElementById('select-audit-b') as HTMLSelectElement | null;

    const scanIdA = selectA?.value;
    const scanIdB = selectB?.value;

    if (!scanIdA || !scanIdB) {
      showToast('Veuillez sélectionner deux audits pour effectuer la comparaison.', 'warning');
      return;
    }

    if (scanIdA === scanIdB) {
      showToast('Veuillez sélectionner deux audits distincts pour observer une évolution.', 'warning');
      return;
    }

    btnCompare.setAttribute('disabled', 'true');
    btnCompare.textContent = 'Comparaison en cours...';

    try {
      const comparison = await window.electronAPI.compareAudits(scanIdA, scanIdB);
      renderComparisonResults(comparison);
      showToast('Comparaison des deux audits finalisée avec succès !', 'success');
    } catch (err: any) {
      showToast(`Erreur lors de la comparaison : ${err?.message || err}`, 'error');
    } finally {
      btnCompare.removeAttribute('disabled');
      btnCompare.innerHTML = '<span>⚖️</span> Comparer les deux audits';
    }
  });
}

function updateComparatorSelects(scans: ScanRecord[]): void {
  const selectA = document.getElementById('select-audit-a') as HTMLSelectElement | null;
  const selectB = document.getElementById('select-audit-b') as HTMLSelectElement | null;
  if (!selectA || !selectB) return;

  const currentValA = selectA.value;
  const currentValB = selectB.value;

  selectA.innerHTML = '<option value="">Sélectionnez le premier audit...</option>';
  selectB.innerHTML = '<option value="">Sélectionnez le second audit...</option>';

  scans.forEach((scan) => {
    const dateFormatted = formatDateFr(scan.created_at);
    const target = scan.target_email || scan.target_username || scan.target_phone || 'Sans cible';
    const count = scan.summary_counts?.totalAccountsFound ?? 0;
    const label = `${dateFormatted} (${target}, ${count} comptes)`;

    const optA = document.createElement('option');
    optA.value = scan.id;
    optA.textContent = label;
    selectA.appendChild(optA);

    const optB = document.createElement('option');
    optB.value = scan.id;
    optB.textContent = label;
    selectB.appendChild(optB);
  });

  if (currentValA && scans.some((s) => s.id === currentValA)) {
    selectA.value = currentValA;
  } else if (scans.length >= 2) {
    selectA.value = scans[scans.length - 1].id;
  }

  if (currentValB && scans.some((s) => s.id === currentValB)) {
    selectB.value = currentValB;
  } else if (scans.length >= 1) {
    selectB.value = scans[0].id;
  }
}

function renderComparisonResults(result: AuditComparisonResult): void {
  const resultsContainer = document.getElementById('comparator-results');
  if (!resultsContainer) return;
  resultsContainer.style.display = 'block';

  // 1. Risk score evolution
  const evolutionBadge = document.getElementById('comparator-score-evolution-badge');
  const detailsEl = document.getElementById('comparator-score-details');

  if (evolutionBadge) {
    evolutionBadge.textContent = result.scoreEvolution.descriptionFrench;
    if (result.scoreEvolution.delta < 0) {
      evolutionBadge.className = 'badge badge-evolution-positive';
    } else if (result.scoreEvolution.delta > 0) {
      evolutionBadge.className = 'badge badge-evolution-negative';
    } else {
      evolutionBadge.className = 'badge badge-evolution-stable';
    }
  }

  if (detailsEl) {
    detailsEl.textContent = `(Score initial : ${result.scoreEvolution.scoreA} sur 100, Score final : ${result.scoreEvolution.scoreB} sur 100)`;
  }

  // 2. Summary stats counters
  const statNew = document.getElementById('stat-newly-exposed');
  const statPersistent = document.getElementById('stat-persistently-exposed');
  const statResolved = document.getElementById('stat-resolved-accounts');

  if (statNew) statNew.textContent = String(result.stats.newCount);
  if (statPersistent) statPersistent.textContent = String(result.stats.persistentCount);
  if (statResolved) statResolved.textContent = String(result.stats.resolvedCount);

  // 3. Differential accounts table
  const tbody = document.getElementById('comparison-tbody');
  if (!tbody) return;

  const allItems: Array<{
    categoryLabel: string;
    categoryClass: string;
    statusLabel: string;
    statusClass: string;
    account: UnifiedAccount;
  }> = [];

  result.newlyExposed.forEach((acc) => {
    allItems.push({
      categoryLabel: 'Nouvelle exposition',
      categoryClass: 'badge-risk-critical',
      statusLabel: 'Exposé',
      statusClass: 'badge-orange',
      account: acc,
    });
  });

  result.persistentlyExposed.forEach((acc) => {
    allItems.push({
      categoryLabel: 'Exposition persistante',
      categoryClass: 'badge-risk-moderate',
      statusLabel: 'Exposé',
      statusClass: 'badge-orange',
      account: acc,
    });
  });

  result.resolvedAccounts.forEach((acc) => {
    allItems.push({
      categoryLabel: 'Compte résolu',
      categoryClass: 'badge-risk-low',
      statusLabel: 'Assaini',
      statusClass: 'badge-blue',
      account: acc,
    });
  });

  if (allItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          Aucun compte à comparer entre ces deux audits.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = allItems
    .map((item) => {
      const diffInfo = getJdmDifficultyLabel(item.account.jdm?.difficulty);
      return `
        <tr>
          <td><span class="badge ${item.categoryClass}">${item.categoryLabel}</span></td>
          <td>
            <div class="service-title" style="font-weight: 600; color: var(--text-primary);">${escapeHtml(item.account.serviceName)}</div>
            <div class="text-secondary" style="font-size: 0.75rem;">${escapeHtml(item.account.domain)}</div>
          </td>
          <td><code>${escapeHtml(item.account.accountIdentifier)}</code></td>
          <td><span class="jdm-badge ${diffInfo.cssClass}">${diffInfo.label}</span></td>
          <td style="text-align: right;"><span class="badge ${item.statusClass}">${item.statusLabel}</span></td>
        </tr>
      `;
    })
    .join('');
}

async function loadSavedScans(): Promise<void> {
  const tbody = document.getElementById('scans-tbody');
  if (!tbody) return;

  try {
    const scans: ScanRecord[] = await window.electronAPI.listScans();
    updateComparatorSelects(scans);

    if (scans.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-state">
            Aucun dossier archivé dans la base SQLite locale.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    scans.forEach((scan) => {
      const tr = document.createElement('tr');
      const targets = [scan.target_email, scan.target_username, scan.target_phone].filter(Boolean).join(', ') || 'Cibles non spécifiées';
      const toolsCount = (scan.tools_selected || []).length;
      const accountsCount = scan.summary_counts?.totalAccountsFound ?? 0;

      tr.innerHTML = `
        <td>${formatDateFr(scan.created_at)}</td>
        <td><code>${escapeHtml(targets)}</code></td>
        <td><span class="badge badge-blue">${toolsCount} outils</span></td>
        <td><strong style="color: var(--text-primary);">${accountsCount}</strong></td>
        <td style="text-align: right;">
          <div class="action-buttons">
            <button type="button" class="btn-table-action btn-reload-scan" data-id="${escapeHtml(scan.id)}">Recharger</button>
            <button type="button" class="btn-table-action btn-export-html-scan" data-id="${escapeHtml(scan.id)}">Rapport HTML</button>
            <button type="button" class="btn-table-action btn-export-pdf-scan" data-id="${escapeHtml(scan.id)}">Rapport PDF</button>
            <button type="button" class="btn-table-action btn-export-scan" data-id="${escapeHtml(scan.id)}">Exporter en JSON</button>
            <button type="button" class="btn-table-action btn-delete-scan" data-id="${escapeHtml(scan.id)}" style="color: #f87171;">Supprimer</button>
          </div>
        </td>
      `;

      // Event: Reload scan into session
      const btnReload = tr.querySelector('.btn-reload-scan');
      if (btnReload) {
        btnReload.addEventListener('click', async () => {
          const loaded = await window.electronAPI.loadScan(scan.id);
          if (loaded.scan) {
            currentScanId = loaded.scan.id;
            currentAccounts = loaded.accounts;
            currentScanLeaks = [];
            await refreshRiskScore();
            const nav2 = document.getElementById('nav-view2');
            if (nav2) nav2.click();
          }
        });
      }

      // Event: Export HTML
      const btnExportHtml = tr.querySelector('.btn-export-html-scan');
      if (btnExportHtml) {
        btnExportHtml.addEventListener('click', async () => {
          showToast('Génération du rapport HTML pour cet audit...', 'info');
          try {
            const res = await window.electronAPI.exportHtmlReport(scan.id);
            if (res.canceled) {
              showToast('Exportation HTML annulée.', 'info');
            } else if (res.success) {
              showToast('Rapport HTML exporté avec succès !', 'success');
            } else {
              showToast(`Échec : ${res.error || 'Erreur inconnue'}`, 'error');
            }
          } catch (err: any) {
            showToast(`Erreur : ${err?.message || err}`, 'error');
          }
        });
      }

      // Event: Export PDF
      const btnExportPdf = tr.querySelector('.btn-export-pdf-scan');
      if (btnExportPdf) {
        btnExportPdf.addEventListener('click', async () => {
          showToast('Impression PDF de cet audit en cours...', 'info');
          try {
            const res = await window.electronAPI.exportPdfReport(scan.id);
            if (res.canceled) {
              showToast('Exportation PDF annulée.', 'info');
            } else if (res.success) {
              showToast('Document PDF généré avec succès !', 'success');
            } else {
              showToast(`Échec : ${res.error || 'Erreur inconnue'}`, 'error');
            }
          } catch (err: any) {
            showToast(`Erreur : ${err?.message || err}`, 'error');
          }
        });
      }

      // Event: Export JSON
      const btnExport = tr.querySelector('.btn-export-scan');
      if (btnExport) {
        btnExport.addEventListener('click', async () => {
          const jsonStr = await window.electronAPI.exportScanJson(scan.id);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `audit_${scan.id}.json`;
          a.click();
          URL.revokeObjectURL(url);
        });
      }

      // Event: Delete scan
      const btnDelete = tr.querySelector('.btn-delete-scan');
      if (btnDelete) {
        btnDelete.addEventListener('click', async () => {
          if (confirm('Voulez vous supprimer définitivement ce dossier d audit ?')) {
            await window.electronAPI.deleteScan(scan.id);
            loadSavedScans();
          }
        });
      }

      tbody.appendChild(tr);
    });
  } catch (err: any) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Erreur : ${err?.message || err}</td></tr>`;
  }
}

let cachedToolsHealth: Record<SupportedTool, any> | null = null;
let inFlightHealthPromise: Promise<Record<SupportedTool, any>> | null = null;

async function loadToolsHealth(force = false): Promise<void> {
  const tbody = document.getElementById('health-tbody');
  if (!tbody) return;

  if (!cachedToolsHealth || force) {
    if (tbody.children.length <= 1) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Vérification de la présence des outils...</td></tr>`;
    }
  }

  try {
    let health: Record<SupportedTool, any>;
    if (cachedToolsHealth && !force) {
      health = cachedToolsHealth;
    } else {
      if (!inFlightHealthPromise || force) {
        inFlightHealthPromise = window.electronAPI.checkHealth().finally(() => {
          inFlightHealthPromise = null;
        });
      }
      health = await inFlightHealthPromise;
      cachedToolsHealth = health;
    }
    const toolUsages: Record<SupportedTool, string> = {
      holehe: 'Recherche email sur plus de 120 plateformes',
      maigret: 'Traçage de pseudonyme sur plus de 3 000 sites',
      ignorant: 'Vérification téléphone sur réseaux et messageries',
      h8mail: 'Détection de fuites et brèches de sécurité',
      ghunt: 'Extraction métadonnées de compte Google',
      spiderfoot: 'Reconnaissance et corrélations passives',
    };

    tbody.innerHTML = '';
    (Object.keys(health) as SupportedTool[]).forEach((tool) => {
      const h = health[tool];
      const tr = document.createElement('tr');
      const isOk = h.installed;

      tr.innerHTML = `
        <td><strong style="color: var(--text-primary);">${escapeHtml(tool)}</strong></td>
        <td class="text-secondary" style="font-size: 0.85rem;">${escapeHtml(toolUsages[tool] || '')}</td>
        <td>
          <span class="status-pill ${isOk ? 'status-completed' : 'status-failed'}">
            ${isOk ? 'Opérationnel' : 'Non détecté'}
          </span>
        </td>
        <td><code>${escapeHtml(h.version || 'Inconnue')}</code></td>
        <td><code style="font-size: 0.75rem;">${escapeHtml(h.path || 'Non trouvé')}</code></td>
        <td style="text-align: right;">
          <button type="button" class="btn-table-action btn-test-single-tool" data-tool="${escapeHtml(tool)}">
            Tester l'outil
          </button>
        </td>
      `;

      const btnTest = tr.querySelector('.btn-test-single-tool');
      if (btnTest) {
        btnTest.addEventListener('click', async () => {
          btnTest.textContent = 'Test en cours...';
          const fresh = await window.electronAPI.checkHealth();
          const item = fresh[tool];
          btnTest.textContent = item.installed ? 'Validé' : 'Échec';
          setTimeout(() => {
            btnTest.textContent = "Tester l'outil";
          }, 2000);
        });
      }

      tbody.appendChild(tr);
    });
  } catch (err: any) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Erreur : ${err?.message || err}</td></tr>`;
  }
}

// Security: Escape HTML to avoid injection
function escapeHtml(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==========================================================================
   INITIALISATION AU CHARGEMENT DU DOM
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  initView1();
  initView2();
  initView3();
  initView4();
});
