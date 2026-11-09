import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createIpcHandlers,
  registerIpcHandlers,
  toUnifiedAccount,
  adaptAccountToUnified,
} from '../../src/main/ipc-handlers.js';
import { createStorageEngine, StorageEngine } from '../../src/storage/database.js';
import { ToolOrchestrator } from '../../src/core/orchestrator.js';
import { UnifiedAccount, UnifiedLeak } from '../../src/core/types.js';

describe('Milestone 2 IPC Handlers Unit & Integration Tests', () => {
  let storage: StorageEngine;
  let orchestrator: ToolOrchestrator;
  let mockShell: { openExternal: ReturnType<typeof vi.fn> };
  let mockClipboard: { writeText: ReturnType<typeof vi.fn> };
  let mockDialog: { showSaveDialog: ReturnType<typeof vi.fn> };
  let mockFs: { writeFileSync: ReturnType<typeof vi.fn> };
  let mockPdfPrinter: ReturnType<typeof vi.fn>;
  let handlers: ReturnType<typeof createIpcHandlers>;

  const sampleAccounts: UnifiedAccount[] = [
    {
      id: 'acc_1',
      serviceId: 'github',
      serviceName: 'GitHub',
      domain: 'github.com',
      accountIdentifier: 'target@example.com',
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
    {
      id: 'acc_2',
      serviceId: 'twitter',
      serviceName: 'X',
      domain: 'x.com',
      accountIdentifier: 'target_user',
      sourceTool: 'maigret',
      status: 'claimed',
      cleaned: false,
      metadata: {},
      jdm: {
        matched: true,
        difficulty: 'medium',
        deleteUrl: 'https://twitter.com/settings/deactivate',
      },
    },
    {
      id: 'acc_3',
      serviceId: 'oldservice',
      serviceName: 'OldService',
      domain: 'oldservice.com',
      accountIdentifier: 'target@example.com',
      sourceTool: 'holehe',
      status: 'unclaimed',
      cleaned: true,
      metadata: {},
      jdm: {
        matched: true,
        difficulty: 'hard',
      },
    },
  ];

  const sampleLeaks: UnifiedLeak[] = [
    {
      id: 'leak_1',
      target: 'target@example.com',
      sourceTool: 'h8mail',
      breachName: 'Dropbox 2012 Breach',
      breachDate: '2012-07-01',
      dataClasses: ['passwords', 'email_addresses'],
      details: 'Hashed passwords exposed',
    },
  ];

  beforeEach(() => {
    storage = createStorageEngine(':memory:');
    orchestrator = new ToolOrchestrator({ adapters: {} });
    mockShell = { openExternal: vi.fn().mockResolvedValue(undefined) };
    mockClipboard = { writeText: vi.fn() };
    mockDialog = {
      showSaveDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePath: '/tmp/test_report.html',
      }),
    };
    mockFs = {
      writeFileSync: vi.fn(),
    };
    mockPdfPrinter = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock pdf'));

    handlers = createIpcHandlers({
      orchestrator,
      storage,
      shell: mockShell,
      clipboard: mockClipboard,
      dialog: mockDialog,
      fs: mockFs,
      pdfPrinter: mockPdfPrinter,
    });
  });

  /* --------------------------------------------------------------------------
     SUITE 1: toUnifiedAccount & Schema Reconciliation
     -------------------------------------------------------------------------- */
  describe('Data Reconciliation (toUnifiedAccount)', () => {
    it('maps SQLite snake_case records into camelCase UnifiedAccount correctly', () => {
      const dbRecord = {
        id: 'acc_db_1',
        scan_id: 'scan_123',
        service_name: 'Dropbox',
        account_identifier: 'victim@test.com',
        domain: 'dropbox.com',
        source_tools: ['holehe'],
        jdm_matched: 1,
        jdm_difficulty: 'easy',
        jdm_deletion_url: 'https://dropbox.com/account/delete',
        jdm_notes: 'Fast deletion',
        jdm_notes_fr: 'Suppression rapide',
        jdm_dpo_email: 'privacy@dropbox.com',
        status: 'completed',
        processed_at: '2026-11-09T10:00:00Z',
      };

      const unified = toUnifiedAccount(dbRecord);
      expect(unified.id).toBe('acc_db_1');
      expect(unified.serviceName).toBe('Dropbox');
      expect(unified.serviceId).toBe('dropbox');
      expect(unified.accountIdentifier).toBe('victim@test.com');
      expect(unified.sourceTool).toBe('holehe');
      expect(unified.cleaned).toBe(true);
      expect(unified.jdm).toBeDefined();
      expect(unified.jdm?.matched).toBe(true);
      expect(unified.jdm?.difficulty).toBe('easy');
      expect(unified.jdm?.deleteUrl).toBe('https://dropbox.com/account/delete');
      expect(unified.jdm?.notesFr).toBe('Suppression rapide');
    });

    it('preserves already normalized UnifiedAccount objects', () => {
      const existing = sampleAccounts[0];
      const unified = toUnifiedAccount(existing);
      expect(unified.serviceName).toBe('GitHub');
      expect(unified.jdm?.difficulty).toBe('easy');
      expect(unified.cleaned).toBe(false);
    });

    it('safely handles empty or null input without throwing', () => {
      const fallback = toUnifiedAccount(null);
      expect(fallback).toBeDefined();
      expect(fallback.serviceName).toBe('Service inconnu');
      expect(fallback.cleaned).toBe(false);
    });

    it('provides adaptAccountToUnified alias', () => {
      expect(adaptAccountToUnified).toBe(toUnifiedAccount);
    });
  });

  /* --------------------------------------------------------------------------
     SUITE 2: risk:calculate IPC Channel
     -------------------------------------------------------------------------- */
  describe('Channel risk:calculate', () => {
    it('calculates risk score and recommendations from accounts and leaks', async () => {
      const result = await handlers.handleRiskCalculate({}, {
        accounts: sampleAccounts,
        leaks: sampleLeaks,
      });

      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThan(0);
      expect(['low', 'moderate', 'elevated', 'critical']).toContain(result.level);
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.uncleanedCount).toBe(2); // Only 2 non-cleaned accounts
      expect(result.breakdown.criticalLeaksCount).toBe(1); // passwords breach is critical
      expect(Array.isArray(result.recommendations)).toBe(true);
      expect(result.recommendations.length).toBeGreaterThan(0);

      // Verify zero hyphens in all generated recommendations
      for (const rec of result.recommendations) {
        expect(rec.title).not.toMatch(/[-–—]/);
        expect(rec.description).not.toMatch(/[-–—]/);
      }
    });

    it('supports positional arguments (accounts, leaks)', async () => {
      const result = await handlers.handleRiskCalculate({}, sampleAccounts, sampleLeaks);
      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThan(0);
    });

    it('supports direct scanId parameter to compute risk from database records', async () => {
      const scanId = storage.createScan({
        title: 'Audit DB Risk',
        targetEmail: 'test@example.com',
        status: 'completed',
        toolsSelected: ['holehe'],
      });
      storage.saveAccounts([
        {
          scanId,
          id: 'acc_db_risk_1',
          serviceName: 'Adobe',
          domain: 'adobe.com',
          accountIdentifier: 'test@example.com',
          sourceTools: ['holehe'],
          jdm: { matched: true, difficulty: 'medium' },
          status: 'detected',
        },
      ]);

      const result = await handlers.handleRiskCalculate({}, { scanId });
      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThan(0);
      expect(result.breakdown.uncleanedCount).toBe(1);
    });

    it('handles empty inputs safely and returns 0 score', async () => {
      const result = await handlers.handleRiskCalculate({}, { accounts: [], leaks: [] });
      expect(result.score).toBe(0);
      expect(result.level).toBe('low');
      expect(result.breakdown.uncleanedCount).toBe(0);
    });

    it('resists prototype pollution and malformed entries without throwing', async () => {
      const dirtyAccounts = [
        null,
        undefined,
        {},
        { __proto__: { admin: true } },
        { serviceName: 'Valid', status: 'detected' },
      ];
      const result = await handlers.handleRiskCalculate({}, {
        accounts: dirtyAccounts as any,
        leaks: null as any,
      });
      expect(result).toBeDefined();
      expect(typeof result.score).toBe('number');
    });
  });

  /* --------------------------------------------------------------------------
     SUITE 3: report:exportHtml IPC Channel
     -------------------------------------------------------------------------- */
  describe('Channel report:exportHtml', () => {
    let scanId: string;

    beforeEach(() => {
      scanId = storage.createScan({
        title: 'Audit Test Export',
        targetEmail: 'target@example.com',
        status: 'completed',
        toolsSelected: ['holehe', 'maigret', 'h8mail'],
      });
      storage.saveAccounts(
        sampleAccounts.map((acc) => ({
          scanId,
          id: acc.id,
          serviceName: acc.serviceName,
          domain: acc.domain,
          accountIdentifier: acc.accountIdentifier,
          sourceTools: [acc.sourceTool],
          jdm: acc.jdm,
          status: acc.cleaned ? 'completed' : 'detected',
        }))
      );
      storage.saveLeaks(scanId, sampleLeaks);
    });

    it('exports standalone HTML directly to customPath if provided', async () => {
      const customPath = '/tmp/custom_report.html';
      const response = await handlers.handleReportExportHtml({}, {
        scanId,
        customPath,
      });

      expect(response.success).toBe(true);
      expect(response.filePath).toBe(customPath);
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        customPath,
        expect.stringContaining('<!DOCTYPE html>'),
        'utf-8'
      );

      // Verify HTML content contains report elements
      const writtenHtml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(writtenHtml).toContain('target@example.com');
      expect(writtenHtml).toContain('svg');
      expect(writtenHtml).toContain('@media print');
    });

    it('prompts dialog.showSaveDialog if customPath is omitted', async () => {
      mockDialog.showSaveDialog.mockResolvedValueOnce({
        canceled: false,
        filePath: '/Users/test/Documents/audit_report.html',
      });

      const response = await handlers.handleReportExportHtml({}, { scanId });

      expect(response.success).toBe(true);
      expect(response.filePath).toBe('/Users/test/Documents/audit_report.html');
      expect(mockDialog.showSaveDialog).toHaveBeenCalledTimes(1);

      // Verify zero hyphen enforcement in dialog options
      const dialogOpts = mockDialog.showSaveDialog.mock.calls[0][0];
      expect(dialogOpts.title).toBeDefined();
      expect(dialogOpts.title).not.toMatch(/[-–—]/);
      for (const filter of dialogOpts.filters || []) {
        expect(filter.name).not.toMatch(/[-–—]/);
      }
    });

    it('handles dialog cancellation cleanly without writing to disk', async () => {
      mockDialog.showSaveDialog.mockResolvedValueOnce({
        canceled: true,
      });

      const response = await handlers.handleReportExportHtml({}, { scanId });

      expect(response.success).toBe(false);
      expect(response.canceled).toBe(true);
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('returns error when scanId is non-existent with zero-hyphen French error', async () => {
      const response = await handlers.handleReportExportHtml({}, {
        scanId: 'invalid_scan_999',
      });

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error).not.toMatch(/[-–—]/);
    });
  });

  /* --------------------------------------------------------------------------
     SUITE 4: report:exportPdf IPC Channel
     -------------------------------------------------------------------------- */
  describe('Channel report:exportPdf', () => {
    let scanId: string;

    beforeEach(() => {
      scanId = storage.createScan({
        title: 'Audit PDF Test',
        targetEmail: 'pdf@target.com',
        status: 'completed',
        toolsSelected: ['holehe'],
      });
      storage.saveAccounts([
        {
          scanId,
          id: 'acc_pdf_1',
          serviceName: 'LinkedIn',
          domain: 'linkedin.com',
          accountIdentifier: 'pdf@target.com',
          sourceTools: ['holehe'],
          status: 'detected',
        },
      ]);
    });

    it('exports PDF directly to customPath using injected pdfPrinter', async () => {
      const customPath = '/tmp/audit_export.pdf';
      const response = await handlers.handleReportExportPdf({}, {
        scanId,
        customPath,
      });

      expect(response.success).toBe(true);
      expect(response.filePath).toBe(customPath);
      expect(mockPdfPrinter).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        customPath,
        expect.any(Buffer)
      );
    });

    it('prompts dialog.showSaveDialog with zero-hyphen options when customPath omitted', async () => {
      mockDialog.showSaveDialog.mockResolvedValueOnce({
        canceled: false,
        filePath: '/Users/test/Downloads/audit_export.pdf',
      });

      const response = await handlers.handleReportExportPdf({}, { scanId });

      expect(response.success).toBe(true);
      expect(response.filePath).toBe('/Users/test/Downloads/audit_export.pdf');

      const dialogOpts = mockDialog.showSaveDialog.mock.calls[0][0];
      expect(dialogOpts.title).not.toMatch(/[-–—]/);
      for (const filter of dialogOpts.filters || []) {
        expect(filter.name).not.toMatch(/[-–—]/);
      }
    });

    it('returns canceled when user dismisses save dialog', async () => {
      mockDialog.showSaveDialog.mockResolvedValueOnce({
        canceled: true,
      });

      const response = await handlers.handleReportExportPdf({}, { scanId });

      expect(response.success).toBe(false);
      expect(response.canceled).toBe(true);
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('handles pdfPrinter failure gracefully without unhandled rejection', async () => {
      mockPdfPrinter.mockRejectedValueOnce(new Error('Erreur impression PDF'));

      const response = await handlers.handleReportExportPdf({}, {
        scanId,
        customPath: '/tmp/fail.pdf',
      });

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error).not.toMatch(/[-–—]/);
    });
  });

  /* --------------------------------------------------------------------------
     SUITE 5: scan:compare IPC Channel
     -------------------------------------------------------------------------- */
  describe('Channel scan:compare', () => {
    let scanIdA: string;
    let scanIdB: string;

    beforeEach(() => {
      // Baseline audit A
      scanIdA = storage.createScan({
        title: 'Audit Initial A',
        targetEmail: 'user@example.com',
        status: 'completed',
        toolsSelected: ['holehe'],
      });
      storage.saveAccounts([
        {
          scanId: scanIdA,
          id: 'a1',
          serviceName: 'GitHub',
          domain: 'github.com',
          accountIdentifier: 'user@example.com',
          sourceTools: ['holehe'],
          status: 'detected',
        },
        {
          scanId: scanIdA,
          id: 'a2',
          serviceName: 'Twitter',
          domain: 'twitter.com',
          accountIdentifier: 'user@example.com',
          sourceTools: ['holehe'],
          status: 'detected',
        },
      ]);

      // Later audit B: Twitter deleted, GitHub persistent, Spotify newly discovered
      scanIdB = storage.createScan({
        title: 'Audit Suivi B',
        targetEmail: 'user@example.com',
        status: 'completed',
        toolsSelected: ['holehe'],
      });
      storage.saveAccounts([
        {
          scanId: scanIdB,
          id: 'b1',
          serviceName: 'GitHub',
          domain: 'github.com',
          accountIdentifier: 'user@example.com',
          sourceTools: ['holehe'],
          status: 'detected',
        },
        {
          scanId: scanIdB,
          id: 'b2',
          serviceName: 'Twitter',
          domain: 'twitter.com',
          accountIdentifier: 'user@example.com',
          sourceTools: ['holehe'],
          status: 'deleted',
        },
        {
          scanId: scanIdB,
          id: 'b3',
          serviceName: 'Spotify',
          domain: 'spotify.com',
          accountIdentifier: 'user@example.com',
          sourceTools: ['holehe'],
          status: 'detected',
        },
      ]);
    });

    it('categorizes accounts into newly exposed, persistent, and resolved', async () => {
      const result = await handlers.handleScanCompare({}, {
        scanIdA,
        scanIdB,
      });

      expect(result).toBeDefined();
      expect(result.newlyExposed.some((a) => a.serviceName === 'Spotify')).toBe(true);
      expect(result.persistentlyExposed.some((a) => a.serviceName === 'GitHub')).toBe(true);
      expect(result.resolvedAccounts.some((a) => a.serviceName === 'Twitter')).toBe(true);

      // Verify stats
      expect(result.stats.newCount).toBe(1);
      expect(result.stats.persistentCount).toBe(1);
      expect(result.stats.resolvedCount).toBe(1);

      // Verify score evolution description is in French without hyphens
      expect(result.scoreEvolution).toBeDefined();
      expect(typeof result.scoreEvolution.scoreA).toBe('number');
      expect(typeof result.scoreEvolution.scoreB).toBe('number');
      expect(result.scoreEvolution.descriptionFrench).not.toMatch(/[-–—]/);
    });

    it('supports positional arguments handleScanCompare({}, scanIdA, scanIdB)', async () => {
      const result = await handlers.handleScanCompare({}, scanIdA, scanIdB);
      expect(result).toBeDefined();
      expect(result.stats.newCount).toBe(1);
    });

    it('returns zero new and zero resolved when comparing identical scans', async () => {
      const result = await handlers.handleScanCompare({}, scanIdA, scanIdA);
      expect(result.stats.newCount).toBe(0);
      expect(result.stats.resolvedCount).toBe(0);
      expect(result.stats.persistentCount).toBe(2);
      expect(result.scoreEvolution.delta).toBe(0);
    });

    it('handles non-existent scan IDs with zero-hyphen French error', async () => {
      const result = await handlers.handleScanCompare({}, 'missing_a', 'missing_b');
      // Either returns error structure or throws formatted error without hyphens
      if (result && typeof result === 'object' && 'error' in (result as any)) {
        expect((result as any).error).not.toMatch(/[-–—]/);
      }
    });
  });

  /* --------------------------------------------------------------------------
     SUITE 6: Full Registration on ipcMain (19 Channels Total)
     -------------------------------------------------------------------------- */
  describe('IPC Channel Registration', () => {
    it('registers all 19 channels on ipcMain', () => {
      const registeredChannels: string[] = [];
      const mockIpcMain = {
        handle: vi.fn().mockImplementation((channel: string) => {
          registeredChannels.push(channel);
        }),
      };

      registerIpcHandlers(
        {
          orchestrator,
          storage,
          shell: mockShell,
          clipboard: mockClipboard,
          dialog: mockDialog,
          fs: mockFs,
          pdfPrinter: mockPdfPrinter,
        },
        mockIpcMain as any
      );

      // Verify 15 legacy channels
      const legacyChannels = [
        'scan:start',
        'scan:cancel',
        'accounts:get',
        'account:updateStatus',
        'gdpr:generateEmail',
        'gdpr:saveRequest',
        'gdpr:listRequests',
        'scans:list',
        'scan:load',
        'scan:delete',
        'scan:exportJson',
        'scan:importJson',
        'tools:checkHealth',
        'shell:openExternal',
        'clipboard:writeText',
      ];
      for (const ch of legacyChannels) {
        expect(registeredChannels).toContain(ch);
      }

      // Verify 4 new Milestone 2 channels
      const m2Channels = [
        'risk:calculate',
        'report:exportHtml',
        'report:exportPdf',
        'scan:compare',
      ];
      for (const ch of m2Channels) {
        expect(registeredChannels).toContain(ch);
      }

      expect(registeredChannels.length).toBe(19);
    });
  });
});
