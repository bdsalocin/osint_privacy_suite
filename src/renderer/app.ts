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
} from '../core/types.js';
import type {
  DiscoveredAccountRecord,
  ScanRecord,
} from '../storage/database.js';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// Current application state
let currentScanId: string | null = null;
let currentAccounts: DiscoveredAccountRecord[] = [];
let currentResult: OrchestratorResult | null = null;
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

    // Load newly discovered accounts
    currentAccounts = await window.electronAPI.getAccounts(result.scanId);

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
        <div class="service-title" style="font-weight: 600; color: #fff;">${escapeHtml(acc.service_name)}</div>
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
              <h3 style="color: #fff;">${escapeHtml(meta.name || gAcc.accountIdentifier)}</h3>
              <p class="text-secondary" style="font-size: 0.85rem;">Gaia ID : <code>${escapeHtml(meta.gaiaId || 'Non extrait')}</code></p>
            </div>
          </div>
          <div style="margin-top: 1rem;">
            <strong style="font-size: 0.85rem; color: #fff;">Services Google détectés :</strong>
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

async function loadSavedScans(): Promise<void> {
  const tbody = document.getElementById('scans-tbody');
  if (!tbody) return;

  try {
    const scans: ScanRecord[] = await window.electronAPI.listScans();

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
        <td><strong style="color: #fff;">${accountsCount}</strong></td>
        <td style="text-align: right;">
          <div class="action-buttons">
            <button type="button" class="btn-table-action btn-reload-scan" data-id="${escapeHtml(scan.id)}">Recharger</button>
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
            const nav2 = document.getElementById('nav-view2');
            if (nav2) nav2.click();
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
        <td><strong style="color: #fff;">${escapeHtml(tool)}</strong></td>
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
  initNavigation();
  initView1();
  initView2();
  initView3();
  initView4();
});
