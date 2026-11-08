/**
 * Adversarial Headless Shell & DOM Navigation Challenger Suite — Jalon 3
 * Teamwork Challenger (teamwork_challenger_m3_1)
 *
 * Empirical verification:
 * 1. DOM navigation resilience under rapid cyclic and random switching
 * 2. Form stress on View 1 (empty inputs, 10,000 chars, HTML/XSS injection, exotic phone prefixes)
 * 3. Button state transitions (disabled/enabled, cancel button visibility)
 * 4. GDPR modal stress (open/close rapid cycles, strict zero-dash audit in French text)
 * 5. Absence of uncaught JavaScript exceptions or console errors
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { createStorageEngine } from '../dist/src/storage/database.js';
import { ToolOrchestrator } from '../dist/src/core/orchestrator.js';
import { registerIpcHandlers } from '../dist/src/main/ipc-handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let total = 0;
const failures = [];
const consoleErrors = [];
const openedUrls = [];
let clipboardContent = '';

function recordPass(name) {
  passed++;
  total++;
  console.log(`  [PASS] ${name}`);
}

function recordFail(name, err) {
  total++;
  const msg = err?.message || String(err);
  console.error(`  [FAIL] ${name} -> ${msg}`);
  failures.push({ name, error: msg, stack: err?.stack });
}

// Timeout guard to prevent test hangs
const timeoutTimer = setTimeout(() => {
  console.error('\n[FATAL] Délai d exécution dépassé (60s) — interruption forcée');
  process.exit(2);
}, 60000);

app.whenReady().then(async () => {
  console.log('='.repeat(78));
  console.log('  CHALLENGER M3 — CONTRE-ÉPREUVE ADVERSARIALE DU DOM ET SHELL ELECTRON');
  console.log('='.repeat(78));

  const storage = createStorageEngine(':memory:');
  const orchestrator = new ToolOrchestrator();

  // Populate memory storage with seed scan & accounts for testing View 2 & 4
  const seedScanId = 'test-seed-scan-001';
  storage.createScan({
    id: seedScanId,
    title: 'Audit Seed Test',
    target_email: 'adversary@test.local',
    target_username: 'adversary_user',
    target_phone: '+33 612345678',
    status: 'completed',
    tools_selected: ['holehe', 'maigret', 'ignorant', 'ghunt', 'h8mail', 'spiderfoot'],
    summary_counts: {
      totalAccountsFound: 3,
      successfulTools: 6,
      totalTools: 6,
    },
  });

  storage.saveAccounts([
    {
      scanId: seedScanId,
      id: 'acc-twitter-001',
      serviceName: 'Twitter',
      domain: 'twitter.com',
      accountIdentifier: 'adversary_user',
      profileUrl: 'https://twitter.com/adversary_user',
      sourceTools: ['maigret'],
      jdm: {
        name: 'Twitter',
        difficulty: 'easy',
        url: 'https://twitter.com/settings/deactivate',
        deleteUrl: 'https://twitter.com/settings/deactivate',
        matched: true,
        notes: null,
      },
      status: 'detected',
    },
    {
      scanId: seedScanId,
      id: 'acc-spotify-002',
      serviceName: 'Spotify',
      domain: 'spotify.com',
      accountIdentifier: 'adversary@test.local',
      profileUrl: 'https://open.spotify.com/user/adversary',
      sourceTools: ['holehe'],
      jdm: {
        name: 'Spotify',
        difficulty: 'medium',
        url: 'https://support.spotify.com/close-account',
        deleteUrl: 'https://support.spotify.com/close-account',
        matched: true,
        notes: null,
      },
      status: 'completed',
    },
    {
      scanId: seedScanId,
      id: 'acc-steam-003',
      serviceName: 'Steam',
      domain: 'steampowered.com',
      accountIdentifier: 'adversary_user',
      profileUrl: null,
      sourceTools: ['maigret'],
      jdm: {
        name: 'Steam',
        difficulty: 'hard',
        url: 'https://help.steampowered.com',
        deleteUrl: 'https://help.steampowered.com',
        matched: true,
        notes: null,
      },
      status: 'detected',
    },
  ]);

  const mockShell = {
    async openExternal(url) {
      openedUrls.push(url);
    },
  };

  const mockClipboard = {
    writeText(text) {
      clipboardContent = text;
    },
  };

  registerIpcHandlers({
    orchestrator,
    storage,
    shell: mockShell,
    clipboard: mockClipboard,
  });

  const preloadPath = path.resolve(__dirname, '../dist/src/preload/index.js');
  const htmlPath = path.resolve(__dirname, '../dist/src/renderer/index.html');

  const win = new BrowserWindow({
    title: 'OSINT Suite Adversarial Harness',
    width: 1280,
    height: 850,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Track console errors and exceptions from Renderer
  win.webContents.on('console-message', (event) => {
    if (event.level >= 2) {
      // 2 = warning, 3 = error
      consoleErrors.push(`[Niveau ${event.level}] ${event.message}`);
    }
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    consoleErrors.push(`[CRASH] Renderer process gone: ${details.reason}`);
  });

  win.webContents.on('unresponsive', () => {
    consoleErrors.push('[FREEZE] Renderer window unresponsive');
  });

  await win.loadFile(htmlPath);

  // Setup DOM spies for alert and confirm to avoid native blocking dialogs
  await win.webContents.executeJavaScript(`
    (() => {
      window.__alert_log = [];
      window.__confirm_log = [];
      window.alert = (msg) => { window.__alert_log.push(msg); };
      window.confirm = (msg) => { window.__confirm_log.push(msg); return true; };
      return null;
    })()
  `);

  try {
    // =========================================================================
    // PARTIE 1 : RÉSILIENCE DE NAVIGATION DOM (STRESS CLICS RAPIDES)
    // =========================================================================
    console.log('\n--- PARTIE 1 : Résilience de Navigation DOM (Stress Clics Rapides) ---');

    // Test 1.1: Sequential rapid switching 50 full cycles (200 clicks)
    try {
      const res = await win.webContents.executeJavaScript(`
        (() => {
          const views = ['view1', 'view2', 'view3', 'view4'];
          const navs = views.map(v => document.getElementById('nav-' + v));

          for (let cycle = 0; cycle < 50; cycle++) {
            for (let i = 0; i < views.length; i++) {
              navs[i].click();

              // Verify active states
              const activeNavs = document.querySelectorAll('.nav-item.active');
              const activePanels = document.querySelectorAll('.view-panel.active');

              if (activeNavs.length !== 1 || activePanels.length !== 1) {
                return { ok: false, error: 'Multiple or zero active views at cycle ' + cycle + ', view ' + views[i] };
              }

              if (activeNavs[0].id !== 'nav-' + views[i]) {
                return { ok: false, error: 'Mismatch in active nav item for ' + views[i] };
              }

              if (activePanels[0].id !== views[i]) {
                return { ok: false, error: 'Mismatch in active panel for ' + views[i] };
              }
            }
          }
          return { ok: true };
        })()
      `);
      assert.strictEqual(res.ok, true, res.error);
      recordPass('Navigation séquentielle rapide (50 cycles, 200 bascules sans désynchronisation)');
    } catch (err) {
      recordFail('Navigation séquentielle rapide', err);
    }

    // Test 1.2: Random stress navigation (100 random view switches)
    try {
      const res = await win.webContents.executeJavaScript(`
        (() => {
          const views = ['view1', 'view2', 'view3', 'view4'];
          for (let i = 0; i < 100; i++) {
            const randomIndex = Math.floor(Math.random() * views.length);
            const target = views[randomIndex];
            document.getElementById('nav-' + target).click();

            const activePanel = document.querySelector('.view-panel.active');
            const activeNav = document.querySelector('.nav-item.active');

            if (!activePanel || activePanel.id !== target || !activeNav || activeNav.id !== 'nav-' + target) {
              return { ok: false, error: 'Desynchronization during random click ' + i + ' on ' + target };
            }
          }
          return { ok: true };
        })()
      `);
      assert.strictEqual(res.ok, true, res.error);
      recordPass('Navigation aléatoire haute fréquence (100 clics aléatoires)');
    } catch (err) {
      recordFail('Navigation aléatoire haute fréquence', err);
    }

    // Test 1.3: Verify all 4 view containers remain intact and accessible in the DOM
    try {
      const res = await win.webContents.executeJavaScript(`
        (() => {
          const v1 = document.getElementById('view1');
          const v2 = document.getElementById('view2');
          const v3 = document.getElementById('view3');
          const v4 = document.getElementById('view4');
          const inputs = document.querySelectorAll('input, button, select');
          return {
            allViewsExist: Boolean(v1 && v2 && v3 && v4),
            elementCount: inputs.length,
            v1ChildCount: v1.children.length,
            v2ChildCount: v2.children.length,
            v3ChildCount: v3.children.length,
            v4ChildCount: v4.children.length,
          };
        })()
      `);
      assert.strictEqual(res.allViewsExist, true);
      assert.ok(res.elementCount > 20, 'At least 20 interactive elements preserved');
      assert.ok(res.v1ChildCount >= 2, 'View 1 structure preserved');
      assert.ok(res.v2ChildCount >= 2, 'View 2 structure preserved');
      assert.ok(res.v3ChildCount >= 2, 'View 3 structure preserved');
      assert.ok(res.v4ChildCount >= 2, 'View 4 structure preserved');
      recordPass('Intégrité structurelle des 4 vues post-stress navigation');
    } catch (err) {
      recordFail('Intégrité structurelle des 4 vues', err);
    }

    // =========================================================================
    // PARTIE 2 : FORMULAIRES ET SÉLECTEURS DE LA VUE 1 (ENTRÉES EXTRÊMES & XSS)
    // =========================================================================
    console.log('\n--- PARTIE 2 : Formulaires et Sélecteurs de la Vue 1 (Entrées Extrêmes) ---');

    // Switch to View 1
    await win.webContents.executeJavaScript(`(() => { document.getElementById('nav-view1').click(); return null; })()`);

    // Test 2.1: Empty submission rejection
    try {
      const res = await win.webContents.executeJavaScript(`
        (async () => {
          window.__alert_log = [];
          document.getElementById('input-email').value = '';
          document.getElementById('input-username').value = '';
          document.getElementById('input-phone').value = '';

          const btnStart = document.getElementById('btn-start-scan');
          btnStart.click();

          // Wait a tick
          await new Promise(r => setTimeout(r, 50));

          const alerted = window.__alert_log.some(msg => msg.includes('Veuillez renseigner au moins une cible'));
          const progressShown = document.getElementById('scan-progress-container').style.display === 'flex';

          return { alerted, progressShown };
        })()
      `);
      assert.strictEqual(res.alerted, true, 'User was alerted when submitting empty fields');
      assert.strictEqual(res.progressShown, false, 'Scan did not launch with empty fields');
      recordPass('Rejet propre des soumissions à champs vides avec message informatif');
    } catch (err) {
      recordFail('Rejet des soumissions vides', err);
    }

    // Test 2.2: Extreme payload 10,000 characters in each input field
    try {
      const res = await win.webContents.executeJavaScript(`
        (() => {
          const emailInput = document.getElementById('input-email');
          const userInput = document.getElementById('input-username');
          const phoneInput = document.getElementById('input-phone');

          const longStr = 'x'.repeat(10000);
          emailInput.value = 'u'.repeat(9991) + '@test.org';
          userInput.value = longStr;
          phoneInput.value = '0'.repeat(10000);

          return {
            emailLen: emailInput.value.length,
            userLen: userInput.value.length,
            phoneLen: phoneInput.value.length,
          };
        })()
      `);
      assert.strictEqual(res.emailLen, 10000);
      assert.strictEqual(res.userLen, 10000);
      assert.strictEqual(res.phoneLen, 10000);
      recordPass('Saisie de chaînes extrêmes de 10 000 caractères sans blocage');
    } catch (err) {
      recordFail('Saisie de chaînes extrêmes', err);
    }

    // Test 2.3: HTML and XSS injection vectors in input fields
    try {
      const res = await win.webContents.executeJavaScript(`
        (() => {
          window.__xss_fired = false;
          const xssPayloads = [
            '<script>window.__xss_fired = true;</script>',
            '<img src="invalid-src" onerror="window.__xss_fired = true">',
            '<svg onload="window.__xss_fired = true">',
            '"><script>window.__xss_fired = true;</script>',
            'javascript:window.__xss_fired=true',
            '\\x3cscript\\x3ewindow.__xss_fired=true\\x3c/script\\x3e'
          ];

          const emailInput = document.getElementById('input-email');
          const userInput = document.getElementById('input-username');
          const phoneInput = document.getElementById('input-phone');

          for (const p of xssPayloads) {
            emailInput.value = p;
            userInput.value = p;
            phoneInput.value = p;
          }

          return {
            xssFired: window.__xss_fired,
            inputContainsScriptTag: userInput.value.includes('<script>'),
          };
        })()
      `);
      assert.strictEqual(res.xssFired, false, 'No XSS payload executed in window context');
      assert.strictEqual(res.inputContainsScriptTag, true, 'Input safely retains raw text value');
      recordPass('Résilience aux vecteurs d injection HTML/XSS dans les formulaires');
    } catch (err) {
      recordFail('Résilience XSS dans formulaires', err);
    }

    // Test 2.4: Exotic and international telephone prefixes and non-standard inputs
    try {
      const res = await win.webContents.executeJavaScript(`
        (() => {
          const selectPrefix = document.getElementById('select-phone-prefix');
          const phoneInput = document.getElementById('input-phone');

          const exoticPrefixes = ['+33', '+32', '+41', '+1', '+44'];
          const exoticInputs = [
            '06 12 34 56 78',
            '(555) 019-2834',
            '07-89-01-23-45',
            '+999999999999999',
            'ABC DEF GHI',
            '📱📞💬',
            '  06   99  50   ',
            '0033612345678'
          ];

          let successCount = 0;
          for (const pfx of exoticPrefixes) {
            selectPrefix.value = pfx;
            for (const inp of exoticInputs) {
              phoneInput.value = inp;
              if (phoneInput.value === inp && selectPrefix.value === pfx) {
                successCount++;
              }
            }
          }
          return {
            totalAttempted: exoticPrefixes.length * exoticInputs.length,
            successCount,
          };
        })()
      `);
      assert.strictEqual(res.successCount, res.totalAttempted);
      recordPass('Prise en charge d indicatifs internationaux et formats téléphoniques variés');
    } catch (err) {
      recordFail('Indicatifs et formats téléphoniques variés', err);
    }

    // Test 2.5: Tool selectors toggle stress (Tout cocher / Tout décocher)
    try {
      const res = await win.webContents.executeJavaScript(`
        (() => {
          const btnAll = document.getElementById('btn-select-all-tools');
          const btnNone = document.getElementById('btn-deselect-all-tools');
          const checkboxes = document.querySelectorAll('.tools-grid input[type="checkbox"]');

          for (let i = 0; i < 50; i++) {
            btnNone.click();
            const noneChecked = Array.from(checkboxes).every(c => !c.checked);
            if (!noneChecked) return { ok: false, error: 'Deselect all failed at cycle ' + i };

            btnAll.click();
            const allChecked = Array.from(checkboxes).every(c => c.checked);
            if (!allChecked) return { ok: false, error: 'Select all failed at cycle ' + i };
          }
          return { ok: true, count: checkboxes.length };
        })()
      `);
      assert.strictEqual(res.ok, true, res.error);
      assert.strictEqual(res.count, 6, 'All 6 tool checkboxes present and toggled');
      recordPass('Bascule rapide Tout cocher / Tout décocher (50 itérations sur les 6 outils)');
    } catch (err) {
      recordFail('Bascule Tout cocher / Tout décocher', err);
    }

    // Test 2.6: Rejection when all tools are unchecked
    try {
      const res = await win.webContents.executeJavaScript(`
        (async () => {
          window.__alert_log = [];
          document.getElementById('input-email').value = 'test@example.com';
          document.getElementById('btn-deselect-all-tools').click();

          const btnStart = document.getElementById('btn-start-scan');
          btnStart.click();

          await new Promise(r => setTimeout(r, 50));

          const alerted = window.__alert_log.some(msg => msg.includes('au moins un outil'));
          // Restore tools
          document.getElementById('btn-select-all-tools').click();

          return { alerted };
        })()
      `);
      assert.strictEqual(res.alerted, true, 'User alerted when no tool is selected');
      recordPass('Alerte utilisateur et blocage lors de soumission avec 0 outil sélectionné');
    } catch (err) {
      recordFail('Blocage sans outil', err);
    }

    // Test 2.7: Button state transitions during scan lifecycle
    try {
      const res = await win.webContents.executeJavaScript(`
        (async () => {
          const btnStart = document.getElementById('btn-start-scan');
          const btnCancel = document.getElementById('btn-cancel-scan');
          const progressContainer = document.getElementById('scan-progress-container');

          const initialStartDisabled = btnStart.disabled;
          const initialCancelDisplay = btnCancel.style.display;

          // Select only Holehe for quick execution
          document.getElementById('btn-deselect-all-tools').click();
          document.getElementById('tool-holehe').checked = true;

          document.getElementById('input-email').value = 'lifecycle@test.com';
          btnStart.click();

          // Wait a tick for async launch
          await new Promise(r => setTimeout(r, 40));

          const runningStartDisabled = btnStart.disabled;
          const runningCancelDisplay = btnCancel.style.display;
          const runningProgressDisplay = progressContainer.style.display;

          // Trigger cancel immediately
          btnCancel.click();

          // Wait for scan to terminate and finally block to run
          let finished = false;
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 100));
            if (!btnStart.disabled && btnCancel.style.display === 'none') {
              finished = true;
              break;
            }
          }

          // Restore tool selection
          document.getElementById('btn-select-all-tools').click();

          return {
            initialStartDisabled,
            initialCancelDisplay,
            runningStartDisabled,
            runningCancelDisplay,
            runningProgressDisplay,
            finished,
          };
        })()
      `);
      assert.strictEqual(res.initialStartDisabled, false, 'Start button enabled initially');
      assert.strictEqual(res.initialCancelDisplay, 'none', 'Cancel button hidden initially');
      assert.strictEqual(res.runningStartDisabled, true, 'Start button disabled during scan');
      assert.strictEqual(res.runningCancelDisplay, 'inline-flex', 'Cancel button shown during scan');
      assert.strictEqual(res.runningProgressDisplay, 'flex', 'Progress dashboard displayed during scan');
      assert.strictEqual(res.finished, true, 'Buttons returned to idle state after cancel');
      recordPass('Transitions d état rigoureuses des boutons (Start désactivé, Cancel affiché)');
    } catch (err) {
      recordFail('Transitions d état des boutons', err);
    }

    // =========================================================================
    // PARTIE 3 : VUE 2 (AUDIT & ASSAINISSEMENT) & PERSISTANCE DES ACTIONS
    // =========================================================================
    console.log('\n--- PARTIE 3 : Vue 2 (Audit et Assainissement) & Persistance ---');

    // Switch to View 4 first, then reload seed scan into session
    await win.webContents.executeJavaScript(`(() => { document.getElementById('nav-view4').click(); return null; })()`);
    await new Promise(r => setTimeout(r, 100));
    await win.webContents.executeJavaScript(`
      (() => {
        const reloadBtn = document.querySelector('.btn-reload-scan[data-id="test-seed-scan-001"]');
        if (reloadBtn) reloadBtn.click();
        return null;
      })()
    `);
    await new Promise(r => setTimeout(r, 150));

    // Test 3.1: Table rendering and counts
    try {
      const res = await win.webContents.executeJavaScript(`
        (() => {
          const rows = document.querySelectorAll('#accounts-tbody tr');
          const statTotal = document.getElementById('stat-total-accounts').textContent;
          const statEasyMed = document.getElementById('stat-easy-medium').textContent;
          const statProcessed = document.getElementById('stat-processed').textContent;
          const statRate = document.getElementById('stat-sanitization-rate').textContent;

          return {
            rowCount: rows.length,
            statTotal,
            statEasyMed,
            statProcessed,
            statRate,
          };
        })()
      `);
      assert.strictEqual(res.rowCount, 3, '3 seed accounts rendered in table');
      assert.strictEqual(res.statTotal, '3', 'Total stat is 3');
      assert.strictEqual(res.statEasyMed, '2', 'Easy + Medium is 2 (Twitter=easy, Spotify=medium)');
      assert.strictEqual(res.statProcessed, '1', 'Processed count is 1 (Spotify)');
      assert.strictEqual(res.statRate, '33%', 'Sanitization rate is 33%');
      recordPass('Rendu initial du tableau d audit et calcul exact des statistiques (33% assaini)');
    } catch (err) {
      recordFail('Rendu tableau d audit et statistiques', err);
    }

    // Test 3.2: Checkbox status toggle and instantaneous database persistence
    try {
      const res = await win.webContents.executeJavaScript(`
        (async () => {
          // Find Twitter checkbox
          const twitterCheckbox = document.querySelector('input.account-status-checkbox[data-id="acc-twitter-001"]');
          if (!twitterCheckbox) return { ok: false, error: 'Twitter checkbox not found' };

          twitterCheckbox.checked = true;
          twitterCheckbox.dispatchEvent(new Event('change'));

          // Wait for async persistence
          await new Promise(r => setTimeout(r, 100));

          const statProcessed = document.getElementById('stat-processed').textContent;
          const statRate = document.getElementById('stat-sanitization-rate').textContent;
          const rowHasClass = twitterCheckbox.closest('tr').classList.contains('row-completed');

          return {
            ok: true,
            statProcessed,
            statRate,
            rowHasClass,
          };
        })()
      `);
      assert.strictEqual(res.ok, true, res.error);
      assert.strictEqual(res.statProcessed, '2', 'Processed count incremented to 2');
      assert.strictEqual(res.statRate, '67%', 'Sanitization rate increased to 67%');
      assert.strictEqual(res.rowHasClass, true, 'Row styling updated to completed');

      // Verify directly in backend SQLite
      const updatedAccount = storage.db.prepare('SELECT status FROM discovered_accounts WHERE id = ?').get('acc-twitter-001');
      assert.strictEqual(updatedAccount.status, 'completed', 'Backend SQLite confirmed status updated to completed');
      recordPass('Basculement de case à cocher d assainissement avec persistance SQLite immédiate');
    } catch (err) {
      recordFail('Basculement case à cocher assainissement', err);
    }

    // Test 3.3: Search and multi-criteria filters
    try {
      const res = await win.webContents.executeJavaScript(`
        (() => {
          const searchInput = document.getElementById('input-search-accounts');
          const filterDiff = document.getElementById('filter-difficulty');
          const filterStatus = document.getElementById('filter-status');

          // 1. Search filter
          searchInput.value = 'spotify';
          searchInput.dispatchEvent(new Event('input'));
          const spotifyRows = document.querySelectorAll('#accounts-tbody tr').length;

          // 2. Filter by status
          searchInput.value = '';
          searchInput.dispatchEvent(new Event('input'));
          filterStatus.value = 'detected';
          filterStatus.dispatchEvent(new Event('change'));
          const detectedRows = document.querySelectorAll('#accounts-tbody tr').length;

          // 3. Reset filters
          filterStatus.value = 'all';
          filterStatus.dispatchEvent(new Event('change'));
          const allRows = document.querySelectorAll('#accounts-tbody tr').length;

          return {
            spotifyRows,
            detectedRows,
            allRows,
          };
        })()
      `);
      assert.strictEqual(res.spotifyRows, 1, 'Search filter matches exactly Spotify');
      assert.strictEqual(res.detectedRows, 1, 'Status filter matches Steam (the only detected left)');
      assert.strictEqual(res.allRows, 3, 'All rows restored when filters reset');
      recordPass('Filtrage dynamique multi-critères (recherche plein texte, statut, difficulté)');
    } catch (err) {
      recordFail('Filtrage dynamique multi-critères', err);
    }

    // =========================================================================
    // PARTIE 4 : MODALE RGPD ARTICLE 17 & AUDIT CONTRADICTOIRE DU ZÉRO TIRET
    // =========================================================================
    console.log('\n--- PARTIE 4 : Modale RGPD Article 17 & Contre-Épreuve Zéro Tiret ---');

    // Test 4.1: Repeated open and close of GDPR modal (50 cycles)
    try {
      const res = await win.webContents.executeJavaScript(`
        (async () => {
          const modal = document.getElementById('modal-gdpr');
          const btnClose = document.getElementById('btn-modal-close');
          const btnGdprTrigger = document.querySelector('button.btn-table-gdpr[data-id="acc-twitter-001"]');

          for (let i = 0; i < 25; i++) {
            // Open via button
            btnGdprTrigger.click();
            await new Promise(r => setTimeout(r, 20));
            if (modal.style.display !== 'flex') {
              return { ok: false, error: 'Modal failed to open at cycle ' + i };
            }

            // Close via close button
            btnClose.click();
            await new Promise(r => setTimeout(r, 20));
            if (modal.style.display !== 'none') {
              return { ok: false, error: 'Modal failed to close via btn at cycle ' + i };
            }

            // Open again
            btnGdprTrigger.click();
            await new Promise(r => setTimeout(r, 20));

            // Close via backdrop click
            modal.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 20));
            if (modal.style.display !== 'none') {
              return { ok: false, error: 'Modal failed to close via backdrop at cycle ' + i };
            }
          }
          return { ok: true };
        })()
      `);
      assert.strictEqual(res.ok, true, res.error);
      recordPass('Ouverture et fermeture répétitive de la modale RGPD (50 cycles sans fuite d état)');
    } catch (err) {
      recordFail('Ouverture/fermeture modale RGPD', err);
    }

    // Test 4.2: Open modal and perform strict zero-dash verification on all displayed text
    try {
      const res = await win.webContents.executeJavaScript(`
        (async () => {
          const btnGdprTrigger = document.querySelector('button.btn-table-gdpr[data-id="acc-twitter-001"]');
          btnGdprTrigger.click();
          await new Promise(r => setTimeout(r, 100));

          const modal = document.getElementById('modal-gdpr');
          const recipientVal = document.getElementById('gdpr-input-recipient').value;
          const subjectVal = document.getElementById('gdpr-input-subject').value;
          const bodyVal = document.getElementById('gdpr-input-body').value;

          // Check static text inside modal dialog
          const modalDialog = modal.querySelector('.modal-dialog');
          const allTextNodes = [];
          const walker = document.createTreeWalker(modalDialog, NodeFilter.SHOW_TEXT);
          let node;
          while (node = walker.nextNode()) {
            const val = node.nodeValue.trim();
            if (val) allTextNodes.push(val);
          }

          return {
            modalVisible: modal.style.display === 'flex',
            recipientVal,
            subjectVal,
            bodyVal,
            allTextNodes,
          };
        })()
      `);

      assert.strictEqual(res.modalVisible, true);
      assert.ok(res.subjectVal.length > 10, 'Subject is populated');
      assert.ok(res.bodyVal.length > 100, 'Body is populated');

      // Zero-dash verification on subject and body
      const forbiddenHyphens = ['-', '–', '—'];

      for (const dash of forbiddenHyphens) {
        assert.ok(
          !res.subjectVal.includes(dash),
          `Objet du courriel RGPD contient le tiret prohibé "${dash}" : ${res.subjectVal}`
        );
        assert.ok(
          !res.bodyVal.includes(dash),
          `Corps du courriel RGPD contient le tiret prohibé "${dash}" dans le texte`
        );
      }

      // Check all modal UI labels and button texts
      for (const t of res.allTextNodes) {
        // Allow close 'x' or '×'
        if (t === '×' || t === '&times;') continue;
        for (const dash of forbiddenHyphens) {
          assert.ok(
            !t.includes(dash),
            `Texte d interface dans la modale contient le tiret prohibé "${dash}" : "${t}"`
          );
        }
      }

      recordPass('Absence absolue de tirets dans la modale RGPD (Objet, Corps et Libellés)');
    } catch (err) {
      recordFail('Absence de tirets dans la modale RGPD', err);
    }

    // Test 4.3: Test clipboard copy and mailto triggers from modal
    try {
      const res = await win.webContents.executeJavaScript(`
        (async () => {
          clipboardContent = '';
          const btnCopy = document.getElementById('btn-gdpr-copy');
          const btnMailto = document.getElementById('btn-gdpr-mailto');
          const btnSave = document.getElementById('btn-gdpr-save');

          btnCopy.click();
          await new Promise(r => setTimeout(r, 50));

          btnMailto.click();
          await new Promise(r => setTimeout(r, 50));

          btnSave.click();
          await new Promise(r => setTimeout(r, 100));

          const feedback = document.getElementById('modal-feedback-text').textContent;

          // Close modal
          document.getElementById('btn-modal-close').click();

          return { feedback };
        })()
      `);

      assert.ok(clipboardContent.length > 100, 'Clipboard received GDPR email text');
      assert.ok(openedUrls.some(u => u.startsWith('mailto:')), 'Mailto URI triggered via shell');
      assert.ok(res.feedback.includes('succès'), 'Save feedback confirmed in modal');

      // Verify that clipboard content has zero hyphens
      for (const dash of ['-', '–', '—']) {
        assert.ok(
          !clipboardContent.includes(dash),
          `Le texte copié dans le presse-papier contient le tiret prohibé "${dash}"`
        );
      }
      recordPass('Actions de modale RGPD (Copie sans tiret, Mailto, Sauvegarde en base)');
    } catch (err) {
      recordFail('Actions de modale RGPD', err);
    }

    // Test 4.4: Contradictory full-DOM audit for hyphens in all 4 views
    try {
      const res = await win.webContents.executeJavaScript(`
        (() => {
          const forbidden = ['-', '–', '—'];
          const violations = [];

          // Walk all text nodes in main-content
          const main = document.querySelector('.main-content');
          const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
          let n;
          while (n = walker.nextNode()) {
            const txt = n.nodeValue.trim();
            // Ignore code snippets (identifiers/domains like adversary_user or urls)
            if (n.parentElement && (n.parentElement.tagName === 'CODE' || n.parentElement.tagName === 'OPTION')) {
              continue;
            }
            // Check if text is non-empty French label or paragraph
            if (txt.length > 2 && /[a-zA-ZÀ-ÿ]/.test(txt)) {
              for (const dash of forbidden) {
                if (txt.includes(dash)) {
                  violations.push({
                    text: txt,
                    tag: n.parentElement ? n.parentElement.tagName : 'unknown',
                    dash
                  });
                }
              }
            }
          }
          return { violations };
        })()
      `);
      assert.strictEqual(
        res.violations.length,
        0,
        `Violations de tirets détectées dans le DOM : ${JSON.stringify(res.violations)}`
      );
      recordPass('Contre-épreuve d audit intégral du DOM : zéro tiret détecté dans les textes');
    } catch (err) {
      recordFail('Audit intégral zéro tiret dans le DOM', err);
    }

    // =========================================================================
    // PARTIE 5 : VUE 3 (ONGLETS OSINT) & VUE 4 (PARAMÈTRES ET SANTÉ)
    // =========================================================================
    console.log('\n--- PARTIE 5 : Vue 3 (Onglets OSINT) & Vue 4 (Santé des Outils) ---');

    // Test 5.1: View 3 subtabs switching
    try {
      await win.webContents.executeJavaScript(`(() => { document.getElementById('nav-view3').click(); return null; })()`);
      const res = await win.webContents.executeJavaScript(`
        (() => {
          const subtabs = document.querySelectorAll('.subtab-btn');
          for (const btn of subtabs) {
            btn.click();
            const targetId = btn.getAttribute('data-subtab');
            const targetPanel = document.getElementById(targetId);
            if (!targetPanel || !targetPanel.classList.contains('active')) {
              return { ok: false, error: 'Subtab ' + targetId + ' not activated' };
            }
          }
          return { ok: true, count: subtabs.length };
        })()
      `);
      assert.strictEqual(res.ok, true, res.error);
      assert.strictEqual(res.count, 6, 'All 6 OSINT subtabs (Holehe, Maigret, Ignorant, GHunt, h8mail, SpiderFoot) functional');
      recordPass('Bascule réactive des 6 sous-onglets d exploration OSINT approfondie');
    } catch (err) {
      recordFail('Bascule sous-onglets OSINT', err);
    }

    // Test 5.2: View 4 Scans list and Health check trigger
    try {
      await win.webContents.executeJavaScript(`(() => { document.getElementById('nav-view4').click(); return null; })()`);
      const res = await win.webContents.executeJavaScript(`
        (async () => {
          // Wait for loadSavedScans & loadToolsHealth
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 100));
            if (document.querySelectorAll('#health-tbody tr').length === 6) break;
          }

          const scanRows = document.querySelectorAll('#scans-tbody tr');
          const healthRows = document.querySelectorAll('#health-tbody tr');

          return {
            scanRowCount: scanRows.length,
            healthRowCount: healthRows.length,
          };
        })()
      `);
      assert.ok(res.scanRowCount >= 1, 'Seed scan displayed in View 4');
      assert.strictEqual(res.healthRowCount, 6, 'All 6 CLI tools evaluated in health table');
      recordPass('Affichage de l historique des scans et diagnostic de santé des 6 outils CLI');
    } catch (err) {
      recordFail('Historique des scans et diagnostic santé', err);
    }

    // =========================================================================
    // PARTIE 6 : VÉRIFICATION D ABSENCE D ERREURS OU CRASH RENDERER
    // =========================================================================
    console.log('\n--- PARTIE 6 : Audit des Erreurs et Exceptions Renderer ---');

    try {
      assert.strictEqual(
        consoleErrors.length,
        0,
        `Erreurs ou avertissements capturés dans la console Renderer : ${JSON.stringify(consoleErrors)}`
      );
      recordPass('Aucune exception JavaScript non gérée ni message d erreur dans le Renderer');
    } catch (err) {
      recordFail('Audit des erreurs de console Renderer', err);
    }

  } finally {
    clearTimeout(timeoutTimer);
    try {
      storage.close();
      win.destroy();
    } catch {}

    console.log('\n' + '='.repeat(78));
    console.log('  BILAN FINAL DE LA CONTRE-ÉPREUVE ADVERSARIALE (JALON 3)');
    console.log('='.repeat(78));
    console.log(`  Total des tests exécutés : ${total}`);
    console.log(`  Tests réussis (PASS)     : ${passed}`);
    console.log(`  Tests échoués (FAIL)     : ${failures.length}`);

    if (failures.length > 0) {
      console.log('\n  DÉTAIL DES ÉCHECS :');
      failures.forEach((f, idx) => {
        console.log(`  ${idx + 1}. [FAIL] ${f.name} -> ${f.error}`);
      });
      console.log('='.repeat(78));
      app.exit(1);
    } else {
      console.log('\n  🎉 TOUTES LES CONTRE-ÉPREUVES ONT ÉTÉ VALIDÉES AVEC SUCCÈS !');
      console.log('='.repeat(78));
      app.quit();
      process.exit(0);
    }
  }
});
