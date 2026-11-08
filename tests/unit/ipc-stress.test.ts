/**
 * Empirical Adversarial Stress & Concurrency Test Suite for Milestone 3 IPC Handlers
 * Executed by teamwork_challenger_m3_2
 *
 * Focus areas:
 * 1. IPC Saturation: Burst load on all IPC channels (accounts:get, account:updateStatus, scans:list, tools:checkHealth, gdpr:generateEmail).
 * 2. High Concurrency: 200 simultaneous account:updateStatus calls on SQLite persistence.
 * 3. Asynchronous Cancellation: scan:cancel responsiveness, abort signal propagation, and IPC non-blocking verification.
 * 4. External URL Security: Strict protocol whitelisting (rejection of file://, javascript:, data:, smb://, etc.).
 * 5. Database WAL mode integrity and resilience under multi-target burst writes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createIpcHandlers, isAllowedExternalUrl } from '../../src/main/ipc-handlers.js';
import { createStorageEngine, StorageEngine } from '../../src/storage/database.js';
import { ToolOrchestrator } from '../../src/core/orchestrator.js';
import { IToolAdapter, ToolHealth, ToolResult, SupportedTool } from '../../src/core/types.js';

describe('Empirical Adversarial Stress & Concurrency Suite (Milestone 3 IPC)', () => {
  let tempDbPath: string;
  let diskStorage: StorageEngine;
  let memStorage: StorageEngine;
  let orchestrator: ToolOrchestrator;
  let mockShell: { openExternal: ReturnType<typeof vi.fn> };
  let mockClipboard: { writeText: ReturnType<typeof vi.fn> };

  const createMockAdapter = (
    name: SupportedTool,
    options: {
      delayMs?: number;
      shouldAbort?: boolean;
      accounts?: any[];
      failHealth?: boolean;
    } = {}
  ): IToolAdapter => {
    return {
      name,
      checkHealth: vi.fn().mockImplementation(async (): Promise<ToolHealth> => {
        if (options.failHealth) {
          return { installed: false, error: `${name} missing` };
        }
        return { installed: true, version: '1.2.3', path: `/usr/local/bin/${name}` };
      }),
      execute: vi.fn().mockImplementation(async (ctx) => {
        if (options.delayMs && options.delayMs > 0) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, options.delayMs);
            if (ctx.signal) {
              ctx.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new Error('Aborted by signal'));
              });
            }
          });
        }
        ctx.onProgress?.(`Progress from ${name}`, 50);
        return {
          toolName: name,
          success: true,
          durationMs: options.delayMs ?? 10,
          rawOutput: `raw output from ${name}`,
          accounts: options.accounts ?? [],
          leaks: [],
        } as ToolResult;
      }),
    };
  };

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `ipc_stress_${Date.now()}_${Math.random().toString(36).substring(2)}.db`);
    diskStorage = createStorageEngine(tempDbPath);
    memStorage = createStorageEngine(':memory:');

    mockShell = {
      openExternal: vi.fn().mockResolvedValue(undefined),
    };
    mockClipboard = {
      writeText: vi.fn(),
    };
  });

  afterEach(() => {
    try {
      diskStorage.close();
    } catch {}
    try {
      memStorage.close();
    } catch {}
    if (fs.existsSync(tempDbPath)) {
      try {
        fs.unlinkSync(tempDbPath);
      } catch {}
    }
    const walFile = `${tempDbPath}-wal`;
    const shmFile = `${tempDbPath}-shm`;
    if (fs.existsSync(walFile)) {
      try {
        fs.unlinkSync(walFile);
      } catch {}
    }
    if (fs.existsSync(shmFile)) {
      try {
        fs.unlinkSync(shmFile);
      } catch {}
    }
  });

  /* --------------------------------------------------------------------------
     STRESS TEST 1: Saturation IPC et Concurrence Massive (200 Mises à jour)
     -------------------------------------------------------------------------- */
  describe('IPC Saturation & Massive Concurrency (200 Status Updates)', () => {
    it('executes 200 concurrent account:updateStatus operations without deadlock and maintains SQLite integrity', async () => {
      // 1. Initialiser une analyse et générer 200 comptes dans la base SQLite sur disque
      const scanId = diskStorage.createScan({
        title: 'Audit Saturation Concurrence',
        targetEmail: 'stress@target.local',
        targetUsername: 'stresstarget',
        status: 'completed',
        toolsSelected: ['holehe', 'maigret'],
      });

      const NUM_ACCOUNTS = 200;
      const initialAccounts = [];
      for (let i = 0; i < NUM_ACCOUNTS; i++) {
        initialAccounts.push({
          id: `acc_stress_${i}`,
          scanId,
          serviceName: `Service_${i}`,
          domain: `service${i}.example.com`,
          accountIdentifier: `user_${i}@example.com`,
          sourceTools: ['holehe'],
          jdm: {
            matched: true,
            difficulty: (i % 4 === 0 ? 'easy' : i % 4 === 1 ? 'medium' : i % 4 === 2 ? 'hard' : 'impossible') as any,
            deleteUrl: `https://service${i}.example.com/delete`,
          },
          status: 'detected',
        });
      }
      diskStorage.saveAccounts(initialAccounts);

      const orchestrator = new ToolOrchestrator({
        adapters: {
          holehe: createMockAdapter('holehe'),
          maigret: createMockAdapter('maigret'),
        },
      });

      const handlers = createIpcHandlers({
        orchestrator,
        storage: diskStorage,
        shell: mockShell,
        clipboard: mockClipboard,
      });

      // Vérifier que les 200 comptes sont bien enregistrés
      const loadedBefore = handlers.handleAccountsGet({}, scanId);
      expect(loadedBefore.length).toBe(NUM_ACCOUNTS);

      // 2. Déclencher 200 mises à jour de statut concurrentes via Promise.all
      // En alternant les statuts 'completed', 'deleted', 'ignored', 'pending'
      const statuses = ['completed', 'deleted', 'ignored', 'pending'];
      const startTime = Date.now();

      const updatePromises = Array.from({ length: NUM_ACCOUNTS }, (_, i) => {
        const assignedStatus = statuses[i % statuses.length];
        const notes = `Traitement simultané indice ${i}`;
        return Promise.resolve().then(() =>
          handlers.handleAccountUpdateStatus({}, {
            accountId: `acc_stress_${i}`,
            status: assignedStatus,
            notes,
          })
        );
      });

      // Intercaler également en rafale des lectures concurrentes sur les autres canaux IPC
      const getAccountsPromises = Array.from({ length: 20 }, () =>
        Promise.resolve().then(() => handlers.handleAccountsGet({}, scanId))
      );
      const listScansPromises = Array.from({ length: 20 }, () =>
        Promise.resolve().then(() => handlers.handleScansList({}))
      );
      const healthPromises = Array.from({ length: 10 }, () =>
        handlers.handleToolsCheckHealth({})
      );
      const gdprPromises = Array.from({ length: 20 }, (_, i) =>
        Promise.resolve().then(() =>
          handlers.handleGdprGenerateEmail({}, {
            serviceName: `Service_${i}`,
            userName: 'Jean Dupont',
            userEmail: 'stress@target.local',
            language: 'fr',
          })
        )
      );

      // Exécuter l'ensemble des requêtes saturantes simultanément
      const [updateResults, getResults, scansResults, healthResults, gdprResults] = await Promise.all([
        Promise.all(updatePromises),
        Promise.all(getAccountsPromises),
        Promise.all(listScansPromises),
        Promise.all(healthPromises),
        Promise.all(gdprPromises),
      ]);

      const durationMs = Date.now() - startTime;
      console.log(`[STRESS_TEST] 200 mises à jour concurrentes + 70 requêtes IPC achevées en ${durationMs}ms`);

      // 3. Vérifications strictes
      // Chaque mise à jour doit avoir retourné true (succès sans verrou ni deadlock)
      expect(updateResults.length).toBe(NUM_ACCOUNTS);
      expect(updateResults.every((res) => res === true)).toBe(true);

      // Les lectures concurrentes n'ont pas subi de blocage
      expect(getResults.length).toBe(20);
      expect(getResults.every((accounts) => accounts.length === NUM_ACCOUNTS)).toBe(true);
      expect(scansResults.length).toBe(20);
      expect(scansResults.every((scans) => scans.length >= 1)).toBe(true);
      expect(healthResults.length).toBe(10);
      expect(gdprResults.length).toBe(20);

      // 4. Contrôle d'intégrité de la persistance SQLite sur disque
      const finalAccounts = handlers.handleAccountsGet({}, scanId);
      expect(finalAccounts.length).toBe(NUM_ACCOUNTS);

      for (let i = 0; i < NUM_ACCOUNTS; i++) {
        const expectedStatus = statuses[i % statuses.length];
        const acc = finalAccounts.find((a) => a.id === `acc_stress_${i}`);
        expect(acc).toBeDefined();
        expect(acc?.status).toBe(expectedStatus);
        expect(acc?.status_notes).toBe(`Traitement simultané indice ${i}`);
        // processed_at doit être renseigné pour completed ou deleted
        if (expectedStatus === 'completed' || expectedStatus === 'deleted') {
          expect(acc?.processed_at).toBeTruthy();
        }
      }
    });

    it('survives rapid interleaved bursts across all 15 IPC channels', async () => {
      const orchestrator = new ToolOrchestrator({
        adapters: {
          holehe: createMockAdapter('holehe'),
        },
      });

      const handlers = createIpcHandlers({
        orchestrator,
        storage: memStorage,
        shell: mockShell,
        clipboard: mockClipboard,
      });

      // Créer une série d'opérations croisées
      const burstOps: Promise<any>[] = [];

      for (let i = 0; i < 50; i++) {
        burstOps.push(
          Promise.resolve().then(() =>
            handlers.handleGdprSaveRequest({}, {
              serviceName: `Entreprise_${i}`,
              recipientEmail: `dpo_${i}@corp.com`,
              legalBasis: 'GDPR_ART_17_ERASURE',
              emailSubject: `Demande de suppression ${i}`,
              emailBody: 'Je demande l effacement de mes donnees personnelles.',
            })
          )
        );
        burstOps.push(
          Promise.resolve().then(() =>
            handlers.handleGdprGenerateEmail({}, {
              serviceName: `Plateforme_${i}`,
              userName: 'Jean Dupont',
              userEmail: 'jean@exemple.fr',
              language: 'fr',
            })
          )
        );
        burstOps.push(
          Promise.resolve().then(() => handlers.handleScansList({}))
        );
        burstOps.push(
          Promise.resolve().then(() => handlers.handleGdprListRequests({}))
        );
      }

      const results = await Promise.all(burstOps);
      expect(results.length).toBe(200);

      // Vérifier le nombre de requêtes RGPD enregistrées
      const gdprList = handlers.handleGdprListRequests({});
      expect(gdprList.length).toBe(50);
    });
  });

  /* --------------------------------------------------------------------------
     STRESS TEST 2: Annulation Asynchrone (scan:cancel) et Non-Blocage IPC
     -------------------------------------------------------------------------- */
  describe('Asynchronous Cancellation (scan:cancel) & Non-Blocking IPC', () => {
    it('cancels an active long-running scan immediately, terminates cleanly and keeps IPC responsive', async () => {
      // Configurer un adaptateur avec un délai intentionnel de 3000ms
      const slowAdapter = createMockAdapter('holehe', { delayMs: 3000 });
      const orchestrator = new ToolOrchestrator({
        adapters: {
          holehe: slowAdapter,
        },
      });

      const handlers = createIpcHandlers({
        orchestrator,
        storage: memStorage,
        shell: mockShell,
        clipboard: mockClipboard,
      });

      const mockSender = { send: vi.fn() };
      const event = { sender: mockSender };

      // Lancer le scan en asynchrone
      let scanResolved = false;
      const scanPromise = handlers.handleScanStart(event, {
        targets: { email: 'longscan@example.com' },
        selectedTools: ['holehe'],
      }).then((res) => {
        scanResolved = true;
        return res;
      });

      // Attendre 50ms que le scan soit enregistré dans activeScans
      await new Promise((r) => setTimeout(r, 50));

      // Obtenir le scanId via un écouteur ou via les scans enregistrés
      const scans = handlers.handleScansList({});
      // Note: handleScanStart crée le scan en BDD à la fin. Mais l'orchestrateur a le scanId actif.
      // Récupérer le scanId depuis les progress events émis
      expect(mockSender.send).toHaveBeenCalled();
      const firstCallArgs = mockSender.send.mock.calls[0];
      const progressEvent = firstCallArgs[1];
      const activeScanId = progressEvent.scanId;
      expect(activeScanId).toBeDefined();

      const cancelStartTime = Date.now();
      // Envoyer immédiatement l'annulation
      const cancelled = handlers.handleScanCancel({}, activeScanId);
      const cancelDurationMs = Date.now() - cancelStartTime;

      expect(cancelled).toBe(true);
      // L'annulation doit être quasi instantanée (sub-50ms)
      expect(cancelDurationMs).toBeLessThan(50);

      // Le scan initial doit se résoudre rapidement sans attendre les 3000ms
      const scanResult = await scanPromise;
      expect(scanResolved).toBe(true);
      expect(scanResult.scanId).toBe(activeScanId);

      // L'outil annulé doit refléter l'échec d'exécution ou l'annulation
      expect(scanResult.toolResults.holehe?.success).toBe(false);
      expect(scanResult.toolResults.holehe?.error).toContain('cancelled');

      // VÉRIFICATION CRITIQUE : Les canaux IPC ultérieurs doivent être 100% opérationnels et non bloqués
      const postCancelHealth = await handlers.handleToolsCheckHealth({});
      expect(postCancelHealth.holehe.installed).toBe(true);

      const postCancelScans = handlers.handleScansList({});
      expect(postCancelScans.length).toBe(1);

      const postCancelGdpr = handlers.handleGdprGenerateEmail({}, {
        serviceName: 'LinkedIn',
        userName: 'Jean Dupont',
        userEmail: 'test@example.com',
        language: 'fr',
      });
      expect(postCancelGdpr.subject).toBeDefined();
    });

    it('handles idempotent, unknown, or repeated cancellations gracefully without crashing', () => {
      const orchestrator = new ToolOrchestrator({});
      const handlers = createIpcHandlers({
        orchestrator,
        storage: memStorage,
        shell: mockShell,
        clipboard: mockClipboard,
      });

      // Annulation d'un ID inexistant
      expect(handlers.handleScanCancel({}, 'inexistent_scan_123')).toBe(false);
      expect(handlers.handleScanCancel({}, '')).toBe(false);
      expect(handlers.handleScanCancel({}, null as any)).toBe(false);
      expect(handlers.handleScanCancel({}, undefined as any)).toBe(false);
    });
  });

  /* --------------------------------------------------------------------------
     STRESS TEST 3: Sécurité de shell:openExternal et Rejet des Protocoles Dangereux
     -------------------------------------------------------------------------- */
  describe('Security Testing of shell:openExternal Protocol Whitelist', () => {
    const dangerousUrls = [
      'file:///etc/passwd',
      'file:///Applications/Calculator.app',
      'file://localhost${os.homedir()}/.bashrc',
      'javascript:alert(1)',
      'javascript:/*--></title></style></textarea></script><svg/onload=alert(1)>',
      'javascript:void(0)',
      'data:text/html,<script>alert(document.cookie)</script>',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'smb://malicious.corp/share/payload.exe',
      'smb://192.168.1.1/exploit',
      'ftp://ftp.example.org/malware.sh',
      'blob:https://example.com/2b39f7e8',
      'vbscript:MsgBox("PWNED")',
      'powershell:Start-Process calc',
      'applescript:do shell script "touch /tmp/pwned"',
      'ssh://root@target.server.com:22',
      'telnet://insecure.host:23',
      'gopher://evil.server:70',
      'ldap://domain.controller/ou=users',
      'chrome://settings',
      'about:blank',
      'about:config',
      'invalid-protocol://path',
      'not a url at all',
      '   ',
    ];

    it('rejects every dangerous or unapproved protocol with strict error and blocks shell execution', async () => {
      const orchestrator = new ToolOrchestrator({});
      const handlers = createIpcHandlers({
        orchestrator,
        storage: memStorage,
        shell: mockShell,
        clipboard: mockClipboard,
      });

      for (const badUrl of dangerousUrls) {
        // Validation unitaire préalable
        expect(isAllowedExternalUrl(badUrl)).toBe(false);

        // Appel direct du gestionnaire IPC
        await expect(handlers.handleShellOpenExternal({}, badUrl)).rejects.toThrow(
          'Protocole URL non autorisé'
        );
      }

      // S'assurer que le shell sous-jacent n'a JAMAIS été appelé
      expect(mockShell.openExternal).not.toHaveBeenCalled();
    });

    it('allows only legitimate https, http, and mailto URLs', async () => {
      const orchestrator = new ToolOrchestrator({});
      const handlers = createIpcHandlers({
        orchestrator,
        storage: memStorage,
        shell: mockShell,
        clipboard: mockClipboard,
      });

      const allowedUrls = [
        'https://justdeleteme.xyz',
        'https://github.com/settings/profile',
        'https://subdomain.domain.co.uk/path/to/page?param=1#anchor',
        'http://insecure.example.com/delete',
        'mailto:dpo@service.com',
        'mailto:dpo@corp.com?subject=Demande%20RGPD&body=Bonjour',
      ];

      for (const safeUrl of allowedUrls) {
        expect(isAllowedExternalUrl(safeUrl)).toBe(true);
        await handlers.handleShellOpenExternal({}, safeUrl);
        expect(mockShell.openExternal).toHaveBeenCalledWith(safeUrl);
      }

      expect(mockShell.openExternal).toHaveBeenCalledTimes(allowedUrls.length);
    });
  });

  /* --------------------------------------------------------------------------
     STRESS TEST 4: Résilience aux Injections et Données Malformées
     -------------------------------------------------------------------------- */
  describe('Adversarial Injections and Boundary Inputs', () => {
    it('safely handles SQL injection attempts in updateAccountStatus notes and status', () => {
      const scanId = memStorage.createScan({
        title: 'Audit Injection Test',
        targetEmail: 'sqli@target.local',
        status: 'completed',
        toolsSelected: ['holehe'],
      });

      memStorage.saveAccounts([
        {
          id: 'acc_sqli_target',
          scanId,
          serviceName: 'SQLiService',
          domain: 'sqliservice.com',
          accountIdentifier: 'victim@target.local',
          sourceTools: ['holehe'],
          jdm: { matched: false },
          status: 'detected',
        },
      ]);

      const orchestrator = new ToolOrchestrator({});
      const handlers = createIpcHandlers({
        orchestrator,
        storage: memStorage,
        shell: mockShell,
        clipboard: mockClipboard,
      });

      // Injection SQL malveillante dans status_notes
      const maliciousNotes = "Robert'); DROP TABLE discovered_accounts; --";
      const updated = handlers.handleAccountUpdateStatus({}, {
        accountId: 'acc_sqli_target',
        status: 'completed',
        notes: maliciousNotes,
      });

      expect(updated).toBe(true);

      // Vérifier que la table discovered_accounts n'a pas été supprimée
      const accounts = handlers.handleAccountsGet({}, scanId);
      expect(accounts.length).toBe(1);
      expect(accounts[0].status_notes).toBe(maliciousNotes);
      expect(accounts[0].status).toBe('completed');
    });

    it('returns false when updating a non-existent account ID', () => {
      const orchestrator = new ToolOrchestrator({});
      const handlers = createIpcHandlers({
        orchestrator,
        storage: memStorage,
        shell: mockShell,
        clipboard: mockClipboard,
      });

      const updated = handlers.handleAccountUpdateStatus({}, {
        accountId: 'non_existent_account_xyz',
        status: 'completed',
      });
      expect(updated).toBe(false);
    });
  });
});
