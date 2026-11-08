import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIpcHandlers, isAllowedExternalUrl } from '../../src/main/ipc-handlers.js';
import { createStorageEngine, StorageEngine } from '../../src/storage/database.js';
import { ToolOrchestrator } from '../../src/core/orchestrator.js';
import { IToolAdapter, ToolHealth, ToolResult } from '../../src/core/types.js';

describe('IPC Handlers Unit Tests', () => {
  let storage: StorageEngine;
  let orchestrator: ToolOrchestrator;
  let mockShell: { openExternal: ReturnType<typeof vi.fn> };
  let mockClipboard: { writeText: ReturnType<typeof vi.fn> };
  let handlers: ReturnType<typeof createIpcHandlers>;

  const createMockAdapter = (name: string, accounts: any[] = []): IToolAdapter => ({
    name: name as any,
    checkHealth: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0', path: `/bin/${name}` }),
    execute: vi.fn().mockImplementation(async (ctx) => {
      ctx.onProgress?.(`Executing ${name}`, 50);
      return {
        toolName: name,
        success: true,
        durationMs: 10,
        rawOutput: 'ok',
        accounts,
        leaks: [],
      } as ToolResult;
    }),
  });

  beforeEach(() => {
    storage = createStorageEngine(':memory:');
    const mockHolehe = createMockAdapter('holehe', [
      {
        id: 'acc_1',
        serviceId: 'github',
        serviceName: 'GitHub',
        domain: 'github.com',
        accountIdentifier: 'test@example.com',
        sourceTool: 'holehe',
        status: 'claimed',
        cleaned: false,
        metadata: {},
        jdm: {
          matched: true,
          difficulty: 'easy',
          deleteUrl: 'https://github.com/settings/delete',
        },
      },
    ]);
    const mockMaigret = createMockAdapter('maigret');
    const mockIgnorant = createMockAdapter('ignorant');
    const mockH8mail = createMockAdapter('h8mail');
    const mockGhunt = createMockAdapter('ghunt');
    const mockSpiderfoot = createMockAdapter('spiderfoot');

    orchestrator = new ToolOrchestrator({
      adapters: {
        holehe: mockHolehe,
        maigret: mockMaigret,
        ignorant: mockIgnorant,
        h8mail: mockH8mail,
        ghunt: mockGhunt,
        spiderfoot: mockSpiderfoot,
      },
    });

    mockShell = {
      openExternal: vi.fn().mockResolvedValue(undefined),
    };

    mockClipboard = {
      writeText: vi.fn(),
    };

    handlers = createIpcHandlers({
      orchestrator,
      storage,
      shell: mockShell,
      clipboard: mockClipboard,
    });
  });

  describe('isAllowedExternalUrl', () => {
    it('accepts https, http, and mailto URLs', () => {
      expect(isAllowedExternalUrl('https://example.com')).toBe(true);
      expect(isAllowedExternalUrl('http://insecure.org/path')).toBe(true);
      expect(isAllowedExternalUrl('mailto:dpo@service.com?subject=GDPR')).toBe(true);
    });

    it('rejects forbidden or dangerous protocols', () => {
      expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
      expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
      expect(isAllowedExternalUrl('data:text/html,malicious')).toBe(false);
      expect(isAllowedExternalUrl('ftp://server.com')).toBe(false);
      expect(isAllowedExternalUrl('invalid-url')).toBe(false);
    });
  });

  describe('handleScanStart & handleScanCancel', () => {
    it('runs scan, streams progress, persists scan and accounts to database', async () => {
      const mockSender = { send: vi.fn() };
      const event = { sender: mockSender };

      const result = await handlers.handleScanStart(event, {
        targets: { email: 'test@example.com' },
        selectedTools: ['holehe'],
      });

      expect(result).toBeDefined();
      expect(result.scanId).toBeDefined();
      expect(mockSender.send).toHaveBeenCalledWith('tool:progress', expect.any(Object));

      // Verify persisted in SQLite
      const scans = handlers.handleScansList({});
      expect(scans.length).toBe(1);
      expect(scans[0].id).toBe(result.scanId);

      // Verify accounts persisted
      const accounts = handlers.handleAccountsGet({}, result.scanId);
      expect(accounts.length).toBe(1);
      expect(accounts[0].service_name).toBe('GitHub');
      expect(accounts[0].status).toBe('detected');
    });

    it('cancels active scan via handleScanCancel', () => {
      const cancelResult = handlers.handleScanCancel({}, 'non_existent_scan');
      expect(cancelResult).toBe(false);
    });
  });

  describe('handleAccountUpdateStatus', () => {
    it('updates status of account in SQLite', async () => {
      const mockSender = { send: vi.fn() };
      const result = await handlers.handleScanStart({ sender: mockSender }, {
        targets: { email: 'test@example.com' },
        selectedTools: ['holehe'],
      });

      const accounts = handlers.handleAccountsGet({}, result.scanId);
      const accId = accounts[0].id;

      const updated = handlers.handleAccountUpdateStatus({}, {
        accountId: accId,
        status: 'completed',
        notes: 'Dossier traité avec succès',
      });
      expect(updated).toBe(true);

      const updatedAccounts = handlers.handleAccountsGet({}, result.scanId);
      expect(updatedAccounts[0].status).toBe('completed');
    });
  });

  describe('GDPR Email & Request Handlers', () => {
    it('generates GDPR Article 17 email without any hyphens in French', () => {
      const email = handlers.handleGdprGenerateEmail({}, {
        serviceName: 'Twitter',
        userName: 'Jean Dupont',
        userEmail: 'jean@exemple.fr',
        language: 'fr',
      });

      expect(email.subject).toContain('Exercice du droit');
      expect(email.body).toContain('Règlement général');
      expect(email.mailtoUri).toContain('mailto:');
      // Assert absolute zero hyphens in subject and body
      expect(email.subject.includes('-')).toBe(false);
      expect(email.body.includes('-')).toBe(false);
    });

    it('saves and lists GDPR requests in SQLite', () => {
      const reqId = handlers.handleGdprSaveRequest({}, {
        serviceName: 'Facebook',
        recipientEmail: 'dpo@facebook.com',
        legalBasis: 'GDPR_ART_17_ERASURE',
        emailSubject: 'Demande RGPD',
        emailBody: 'Contenu du message',
      });
      expect(reqId).toBeDefined();

      const list = handlers.handleGdprListRequests({});
      expect(list.length).toBe(1);
      expect(list[0].service_name).toBe('Facebook');
    });
  });

  describe('Scans Management (list, load, delete, export, import)', () => {
    it('manages scans lifecycle correctly', async () => {
      const mockSender = { send: vi.fn() };
      const result = await handlers.handleScanStart({ sender: mockSender }, {
        targets: { email: 'test@example.com' },
        selectedTools: ['holehe'],
      });

      const loaded = handlers.handleScanLoad({}, result.scanId);
      expect(loaded.scan).toBeDefined();
      expect(loaded.accounts.length).toBe(1);

      // Export JSON
      const jsonStr = handlers.handleScanExportJson({}, result.scanId);
      expect(typeof jsonStr).toBe('string');
      expect(jsonStr).toContain('GitHub');

      // Delete scan
      const deleted = handlers.handleScanDelete({}, result.scanId);
      expect(deleted).toBe(true);
      const afterDelete = handlers.handleScanLoad({}, result.scanId);
      expect(afterDelete.scan).toBeNull();

      // Import JSON
      const importedScanId = handlers.handleScanImportJson({}, jsonStr);
      expect(importedScanId).toBeDefined();
      const reloaded = handlers.handleScanLoad({}, importedScanId);
      expect(reloaded.scan).toBeDefined();
      expect(reloaded.accounts.length).toBe(1);
    });
  });

  describe('handleToolsCheckHealth', () => {
    it('returns health for all registered tools', async () => {
      const health = await handlers.handleToolsCheckHealth({});
      expect(health.holehe).toBeDefined();
      expect(health.holehe.installed).toBe(true);
    });
  });

  describe('Shell and Clipboard Handlers', () => {
    it('opens safe external URLs via shell', async () => {
      await handlers.handleShellOpenExternal({}, 'https://justdeleteme.xyz');
      expect(mockShell.openExternal).toHaveBeenCalledWith('https://justdeleteme.xyz');
    });

    it('rejects unsafe external URLs and throws', async () => {
      await expect(
        handlers.handleShellOpenExternal({}, 'javascript:stealCookies()')
      ).rejects.toThrow('Protocole URL non autorisé');
    });

    it('writes text to clipboard', () => {
      handlers.handleClipboardWriteText({}, 'Copied text');
      expect(mockClipboard.writeText).toHaveBeenCalledWith('Copied text');
    });
  });
});
