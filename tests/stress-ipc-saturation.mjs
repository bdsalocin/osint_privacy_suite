/**
 * Standalone Adversarial IPC Saturation & Concurrency Stress Test Harness
 * Author: teamwork_challenger_m3_2 (IPC Stress & Concurrency Challenger)
 * Milestone: Jalon 3 (Interface de Bureau Unifiée à 4 Vues & Shell Electron)
 */

import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert';

// Register module redirection for 'electron'
register('../scripts/electron-loader.mjs', import.meta.url);

const { createIpcHandlers, isAllowedExternalUrl } = await import('../dist/src/main/ipc-handlers.js');
const { createStorageEngine } = await import('../dist/src/storage/database.js');
const { ToolOrchestrator } = await import('../dist/src/core/orchestrator.js');

console.log('='.repeat(80));
console.log('  CHALLENGER M3.2 — HARNAIS DE STRESS TEST ADVERSARIAL IPC & CONCURRENCE');
console.log('='.repeat(80));
console.log(`Environnement : Node.js ${process.version} (${process.platform} ${process.arch})`);
console.log(`Date          : ${new Date().toISOString()}\n`);

let passedTests = 0;
let totalTests = 0;
const failures = [];

async function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`  [EN COURS] ${name}... `);
  const start = Date.now();
  try {
    await fn();
    const elapsed = Date.now() - start;
    passedTests++;
    process.stdout.write(`\r  [SUCCÈS]   ${name} (${elapsed} ms)\n`);
  } catch (err) {
    const elapsed = Date.now() - start;
    process.stdout.write(`\r  [ÉCHEC]    ${name} (${elapsed} ms)\n`);
    console.error(`             Erreur : ${err.message}`);
    failures.push({ name, error: err.message, stack: err.stack });
  }
}

// Helpers
function createMockAdapter(name, options = {}) {
  return {
    name,
    checkHealth: async () => ({
      installed: !options.failHealth,
      version: '1.2.3',
      path: `/usr/local/bin/${name}`,
      error: options.failHealth ? `${name} non disponible` : undefined,
    }),
    execute: async (ctx) => {
      if (options.delayMs && options.delayMs > 0) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, options.delayMs);
          if (ctx.signal) {
            ctx.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('Interrompu par signal'));
            });
          }
        });
      }
      ctx.onProgress?.(`Progression ${name}`, 50);
      return {
        toolName: name,
        success: true,
        durationMs: options.delayMs ?? 10,
        rawOutput: `Sortie brute de ${name}`,
        accounts: options.accounts ?? [],
        leaks: [],
      };
    },
  };
}

// Mock Shell & Clipboard
const recordedExternalUrls = [];
const mockShell = {
  openExternal: async (url) => {
    recordedExternalUrls.push(url);
  },
};
const recordedClipboard = [];
const mockClipboard = {
  writeText: (text) => {
    recordedClipboard.push(text);
  },
};

// ============================================================================
// PARTIE 1 : Test de saturation IPC & 200 mises à jour concurrentes
// ============================================================================
console.log('--- PARTIE 1 : Saturation IPC et 200 Mises à Jour Concurrentes ---');

await runTest('200 mises à jour de statut concurrentes sur SQLite en mode WAL sans deadlock', async () => {
  const tempDb = path.join(os.tmpdir(), `stress_ipc_wal_${Date.now()}.db`);
  const storage = createStorageEngine(tempDb);

  try {
    const orchestrator = new ToolOrchestrator({
      adapters: {
        holehe: createMockAdapter('holehe'),
        maigret: createMockAdapter('maigret'),
      },
    });

    const handlers = createIpcHandlers({
      orchestrator,
      storage,
      shell: mockShell,
      clipboard: mockClipboard,
    });

    // 1. Initialiser une analyse mère
    const scanId = storage.createScan({
      title: 'Audit Saturation 200 Comptes',
      targetEmail: 'concurrency@test.lan',
      status: 'completed',
      toolsSelected: ['holehe', 'maigret'],
    });

    // 2. Insérer 200 comptes
    const NUM_ACCOUNTS = 200;
    const accountList = [];
    for (let i = 0; i < NUM_ACCOUNTS; i++) {
      accountList.push({
        id: `acc_concur_${i}`,
        scanId,
        serviceName: `Plateforme_${i}`,
        domain: `plateforme${i}.fr`,
        accountIdentifier: `identifiant_${i}`,
        sourceTools: ['holehe'],
        jdm: {
          matched: true,
          difficulty: i % 2 === 0 ? 'easy' : 'hard',
          deleteUrl: `https://plateforme${i}.fr/supprimer`,
        },
        status: 'detected',
      });
    }
    storage.saveAccounts(accountList);

    // Vérifier l'insertion
    const inserted = handlers.handleAccountsGet({}, scanId);
    assert.strictEqual(inserted.length, NUM_ACCOUNTS, 'Tous les 200 comptes doivent être persistés');

    // 3. Simuler 200 mises à jour de statut hautement concurrentes
    const statuses = ['completed', 'deleted', 'ignored', 'pending'];
    const updatePromises = Array.from({ length: NUM_ACCOUNTS }, (_, i) => {
      const targetStatus = statuses[i % statuses.length];
      return Promise.resolve().then(() =>
        handlers.handleAccountUpdateStatus({}, {
          accountId: `acc_concur_${i}`,
          status: targetStatus,
          notes: `Note de traitement sous concurrence indice ${i}`,
        })
      );
    });

    // Intercaler des lectures massives simultanées (50 lectures de comptes, 50 scans:list, 50 checkHealth, 50 gdpr)
    const interleavedReads = [
      ...Array.from({ length: 50 }, () => Promise.resolve().then(() => handlers.handleAccountsGet({}, scanId))),
      ...Array.from({ length: 50 }, () => Promise.resolve().then(() => handlers.handleScansList({}))),
      ...Array.from({ length: 50 }, () => handlers.handleToolsCheckHealth({})),
      ...Array.from({ length: 50 }, (_, i) =>
        Promise.resolve().then(() =>
          handlers.handleGdprGenerateEmail({}, {
            serviceName: `Plateforme_${i}`,
            userName: 'Jean Dupont',
            userEmail: 'jean@test.fr',
            language: 'fr',
          })
        )
      ),
    ];

    const [updateResults, ...readResults] = await Promise.all([
      Promise.all(updatePromises),
      ...interleavedReads,
    ]);

    // Validation des 200 retours
    assert.strictEqual(updateResults.length, NUM_ACCOUNTS);
    assert(updateResults.every((res) => res === true), 'Chaque mise a jour concurrente doit retourner true');

    // 4. Contrôle d'intégrité de la persistance SQLite
    const finalAccounts = handlers.handleAccountsGet({}, scanId);
    assert.strictEqual(finalAccounts.length, NUM_ACCOUNTS);

    for (let i = 0; i < NUM_ACCOUNTS; i++) {
      const expectedStatus = statuses[i % statuses.length];
      const acc = finalAccounts.find((a) => a.id === `acc_concur_${i}`);
      assert(acc, `Le compte acc_concur_${i} doit exister`);
      assert.strictEqual(acc.status, expectedStatus);
      assert.strictEqual(acc.status_notes, `Note de traitement sous concurrence indice ${i}`);
      if (expectedStatus === 'completed' || expectedStatus === 'deleted') {
        assert(acc.processed_at, 'processed_at doit etre renseigne');
      }
    }
  } finally {
    try {
      storage.close();
    } catch {}
    if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb);
    if (fs.existsSync(`${tempDb}-wal`)) fs.unlinkSync(`${tempDb}-wal`);
    if (fs.existsSync(`${tempDb}-shm`)) fs.unlinkSync(`${tempDb}-shm`);
  }
});

// ============================================================================
// PARTIE 2 : Test d'annulation asynchrone (scan:cancel)
// ============================================================================
console.log('\n--- PARTIE 2 : Annulation Asynchrone (scan:cancel) et Non-Blocage IPC ---');

await runTest('Annulation immédiate dun scan asynchrone et réactivité continue des canaux IPC', async () => {
  const storage = createStorageEngine(':memory:');
  const slowAdapter = createMockAdapter('holehe', { delayMs: 4000 });
  const orchestrator = new ToolOrchestrator({
    adapters: {
      holehe: slowAdapter,
    },
  });

  const handlers = createIpcHandlers({
    orchestrator,
    storage,
    shell: mockShell,
    clipboard: mockClipboard,
  });

  const progressEvents = [];
  const mockSender = {
    send: (channel, data) => {
      progressEvents.push({ channel, data });
    },
  };

  // Démarrer le scan asynchrone
  const scanPromise = handlers.handleScanStart({ sender: mockSender }, {
    targets: { email: 'longcancel@target.lan' },
    selectedTools: ['holehe'],
  });

  // Laisser 50ms pour initialiser le scanId
  await new Promise((r) => setTimeout(r, 50));

  assert(progressEvents.length > 0, 'Des evenements de progression doivent avoir ete emis');
  const activeScanId = progressEvents[0].data.scanId;
  assert(activeScanId, 'Le scanId doit etre defini dans les evenements');

  // Déclencher scan:cancel
  const cancelStart = Date.now();
  const cancelSuccess = handlers.handleScanCancel({}, activeScanId);
  const cancelLatency = Date.now() - cancelStart;

  assert.strictEqual(cancelSuccess, true, 'scan:cancel doit retourner true pour un scan actif');
  assert(cancelLatency < 50, `L annulation doit repondre en moins de 50ms (mesure: ${cancelLatency}ms)`);

  // Attendre la résolution de runScan
  const scanResult = await scanPromise;
  assert.strictEqual(scanResult.scanId, activeScanId);
  assert.strictEqual(scanResult.toolResults.holehe.success, false);
  assert(
    scanResult.toolResults.holehe.error.includes('cancelled') ||
    scanResult.toolResults.holehe.error.includes('Interrompu'),
    'Le resultat de l outil doit expliciter l annulation'
  );

  // Vérifier la réactivité immédiate des canaux IPC ultérieurs
  const health = await handlers.handleToolsCheckHealth({});
  assert.strictEqual(health.holehe.installed, true, 'checkHealth doit fonctionner sans blocage');

  const scans = handlers.handleScansList({});
  assert.strictEqual(scans.length, 1, 'scans:list doit retourner le scan persiste');

  const cancelAgain = handlers.handleScanCancel({}, activeScanId);
  assert.strictEqual(cancelAgain, false, 'Une seconde annulation doit retourner false sans crash');
});

// ============================================================================
// PARTIE 3 : Test de sécurité sur shell:openExternal
// ============================================================================
console.log('\n--- PARTIE 3 : Sécurité de shell:openExternal et Filtrage Strict des Protocoles ---');

const dangerousProtocols = [
  'file:///etc/passwd',
  'file:///Applications/Calculator.app',
  'javascript:alert(1)',
  'javascript:void(document.location="http://evil.com")',
  'data:text/html,<script>alert(1)</script>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'smb://malicious.corp/share/malware.exe',
  'smb://192.168.1.100/exploit',
  'ftp://ftp.insecure.org/trojan',
  'blob:http://target.local/uuid',
  'vbscript:MsgBox("Injection")',
  'powershell:Start-Process calc',
  'applescript:do shell script "whoami"',
  'ssh://root@target.host:22',
  'telnet://legacy.server:23',
  'gopher://old.web:70',
  'chrome://settings',
  'about:blank',
  'invalid-proto://test',
];

await runTest('Rejet strict avec levée derreur pour 19 protocoles malveillants et non approuvés', async () => {
  const storage = createStorageEngine(':memory:');
  const orchestrator = new ToolOrchestrator({});
  const handlers = createIpcHandlers({
    orchestrator,
    storage,
    shell: mockShell,
    clipboard: mockClipboard,
  });

  recordedExternalUrls.length = 0;

  for (const maliciousUrl of dangerousProtocols) {
    // 1. Validation unitaire
    assert.strictEqual(
      isAllowedExternalUrl(maliciousUrl),
      false,
      `isAllowedExternalUrl doit rejeter ${maliciousUrl}`
    );

    // 2. Vérification de la levée d'erreur IPC
    let caughtError = null;
    try {
      await handlers.handleShellOpenExternal({}, maliciousUrl);
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError, `handleShellOpenExternal doit lever une erreur pour ${maliciousUrl}`);
    assert.strictEqual(caughtError.message, 'Protocole URL non autorisé');
  }

  // Vérifier qu'aucun appel au shell n'a été exécuté
  assert.strictEqual(recordedExternalUrls.length, 0, 'Aucune URL dangereuse ne doit atteindre le shell');
});

await runTest('Autorisation exclusive des protocoles sûrs (https, http, mailto)', async () => {
  const storage = createStorageEngine(':memory:');
  const orchestrator = new ToolOrchestrator({});
  const handlers = createIpcHandlers({
    orchestrator,
    storage,
    shell: mockShell,
    clipboard: mockClipboard,
  });

  recordedExternalUrls.length = 0;

  const validUrls = [
    'https://justdeleteme.xyz',
    'https://github.com/settings/profile',
    'http://local.service.internal:8080/portal',
    'mailto:dpo@service.com?subject=Droit%20effacement',
  ];

  for (const validUrl of validUrls) {
    assert.strictEqual(isAllowedExternalUrl(validUrl), true);
    await handlers.handleShellOpenExternal({}, validUrl);
  }

  assert.strictEqual(recordedExternalUrls.length, validUrls.length);
  assert.deepStrictEqual(recordedExternalUrls, validUrls);
});

// ============================================================================
// PARTIE 4 : Audit de conformité de style (zéro tiret dans les courriels RGPD)
// ============================================================================
console.log('\n--- PARTIE 4 : Vérification de Conformité Rédactorielle (Zéro Caractère Tiret) ---');

await runTest('Génération de courriel RGPD Article 17 sans aucun caractère tiret en français', async () => {
  const storage = createStorageEngine(':memory:');
  const orchestrator = new ToolOrchestrator({});
  const handlers = createIpcHandlers({
    orchestrator,
    storage,
    shell: mockShell,
    clipboard: mockClipboard,
  });

  const email = handlers.handleGdprGenerateEmail({}, {
    serviceName: 'LinkedIn France',
    userName: 'Jean Dupont',
    userEmail: 'jean@exemple.fr',
    language: 'fr',
  });

  assert(email.subject, 'Le sujet doit être renseigné');
  assert(email.body, 'Le corps doit être renseigné');
  assert(email.mailtoUri, 'L URI mailto doit être renseignée');

  assert(!email.subject.includes('-'), 'Le sujet ne doit contenir AUCUN caractère tiret');
  assert(!email.body.includes('-'), 'Le corps ne doit contenir AUCUN caractère tiret');
});

// ============================================================================
// RÉCAPITULATIF
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log(`RÉSULTAT GLOBAL DU HARNAIS DE STRESS IPC : ${passedTests}/${totalTests} tests réussis`);
if (failures.length === 0) {
  console.log('🎉 TOUS LES STRESS TESTS ADVERSARIAUX IPC ONT ÉTÉ VALIDÉS AVEC SUCCÈS');
  console.log('='.repeat(80));
  process.exit(0);
} else {
  console.error(`❌ ${failures.length} TEST(S) EN ÉCHEC`);
  console.log('='.repeat(80));
  process.exit(1);
}
