/**
 * Electron IPC Handlers for OSINT & Privacy Suite
 * Encapsulates all 19 IPC communication channels between Renderer and Main processes.
 * Strict zero-hyphen compliance in French dialog labels, filters, and error messages.
 */

import { ipcMain, shell, clipboard, dialog, BrowserWindow } from 'electron';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ToolOrchestrator } from '../core/orchestrator.js';
import {
  StorageEngine,
  DiscoveredAccountRecord,
  ScanRecord,
  GdprRequestRecord,
  GdprRequestInput,
} from '../storage/database.js';
import {
  generateGdprArticle17Email,
  GdprRequestParams,
  GdprEmailResult,
} from '../core/gdpr-generator.js';
import {
  OrchestratorTargets,
  SupportedTool,
  OrchestratorResult,
  ToolHealth,
  UnifiedAccount,
  UnifiedLeak,
} from '../core/types.js';
import {
  calculateRiskScore,
  RiskScoreResult,
  RiskEngineOptions,
} from '../core/risk-engine.js';
import {
  generateStandaloneHtmlReport,
} from '../core/report-exporter.js';
import {
  compareAudits,
  AuditComparisonResult,
  AuditSnapshot,
} from '../core/audit-comparator.js';
import { renderHtmlToPdf } from './pdf-renderer.js';

export interface ExportReportResult {
  success: boolean;
  filePath?: string;
  canceled?: boolean;
  error?: string;
}

export interface IpcHandlerDependencies {
  orchestrator: ToolOrchestrator;
  storage: StorageEngine;
  shell?: { openExternal: (url: string) => Promise<void> };
  clipboard?: { writeText: (text: string) => void };
  dialog?: {
    showSaveDialog: (
      windowOrOptions: any,
      maybeOptions?: any
    ) => Promise<{ canceled: boolean; filePath?: string }>;
    showMessageBox?: (options: any) => Promise<any>;
  };
  fs?: {
    writeFile?: (path: string, data: string | Uint8Array, encoding?: any) => Promise<void>;
    writeFileSync?: (path: string, data: string | Buffer | Uint8Array, encoding?: any) => void;
  };
  pdfRenderer?: (html: string, options?: any) => Promise<Buffer | Uint8Array>;
  pdfPrinter?: (html: string, options?: any) => Promise<Buffer | Uint8Array>;
  getMainWindow?: () => any;
}

/**
 * Validates that an external URL uses only safe protocols (https, http, mailto)
 */
export function isAllowedExternalUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * Reconciles and normalizes any account structure (SQLite snake_case record or partial)
 * into a typed camelCase UnifiedAccount required by core engines.
 */
export function toUnifiedAccount(acc: any): UnifiedAccount {
  if (!acc || typeof acc !== 'object') {
    return {
      id: 'acc_inconnu',
      serviceId: 'inconnu',
      serviceName: 'Service inconnu',
      domain: '',
      accountIdentifier: '',
      sourceTool: 'holehe',
      status: 'claimed',
      cleaned: false,
      metadata: {},
      jdm: {
        matched: false,
        difficulty: 'unknown',
      },
    };
  }

  const isCleaned =
    acc.cleaned === true ||
    acc.status === 'completed' ||
    acc.status === 'deleted';

  // If already a well-formed UnifiedAccount with jdm object and serviceName
  if (acc.jdm && typeof acc.jdm === 'object' && typeof acc.serviceName === 'string') {
    return {
      ...acc,
      cleaned: isCleaned,
    };
  }

  const serviceName = acc.serviceName || acc.service_name || 'Service inconnu';
  const serviceId = acc.serviceId || serviceName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const domain = acc.domain || `${serviceId}.com`;
  const accountIdentifier = acc.accountIdentifier || acc.account_identifier || '';

  let sourceTool = 'holehe';
  if (acc.sourceTool) {
    sourceTool = acc.sourceTool;
  } else if (Array.isArray(acc.source_tools) && acc.source_tools.length > 0) {
    sourceTool = acc.source_tools[0];
  } else if (typeof acc.source_tools === 'string') {
    try {
      const parsed = JSON.parse(acc.source_tools);
      if (Array.isArray(parsed) && parsed.length > 0) sourceTool = parsed[0];
    } catch {
      sourceTool = acc.source_tools;
    }
  }

  const jdmMatched = acc.jdm_matched === 1 || acc.jdm_matched === true || Boolean(acc.jdm?.matched);
  const jdmDifficulty = acc.jdm_difficulty || acc.jdm?.difficulty || 'unknown';
  const jdmDeleteUrl = acc.jdm_deletion_url || acc.jdm?.deleteUrl || undefined;
  const jdmNotes = acc.jdm_notes || acc.jdm?.notes || undefined;
  const jdmNotesFr = acc.jdm_notes_fr || acc.jdm?.notesFr || acc.jdm?.notes_fr || undefined;
  const jdmEmail = acc.jdm_dpo_email || acc.jdm?.email || undefined;

  return {
    id: acc.id || `acc_${serviceId}_${accountIdentifier}`,
    serviceId,
    serviceName,
    domain,
    accountIdentifier,
    sourceTool: sourceTool as any,
    status: isCleaned ? 'unclaimed' : (acc.status === 'unclaimed' ? 'unclaimed' : 'claimed'),
    profileUrl: acc.profile_url || acc.profileUrl || undefined,
    avatarUrl: acc.avatar_url || acc.avatarUrl || undefined,
    metadata: acc.metadata || {},
    cleaned: isCleaned,
    cleanedDate: acc.processed_at || acc.cleanedDate || undefined,
    jdm: {
      matched: jdmMatched,
      difficulty: jdmDifficulty,
      deleteUrl: jdmDeleteUrl,
      notes: jdmNotes,
      notesFr: jdmNotesFr,
      email: jdmEmail,
    },
  };
}

export const adaptAccountToUnified = toUnifiedAccount;

async function writeOutput(
  fsModule: any,
  filePath: string,
  content: string | Buffer | Uint8Array,
  encoding?: string
): Promise<void> {
  if (fsModule && typeof fsModule.writeFileSync === 'function') {
    if (encoding) {
      fsModule.writeFileSync(filePath, content, encoding);
    } else {
      fsModule.writeFileSync(filePath, content);
    }
    return;
  }
  if (fsModule && typeof fsModule.writeFile === 'function') {
    if (encoding) {
      await fsModule.writeFile(filePath, content, encoding);
    } else {
      await fsModule.writeFile(filePath, content);
    }
    return;
  }
  if (encoding) {
    await fsPromises.writeFile(filePath, content as string, encoding as BufferEncoding);
  } else {
    await fsPromises.writeFile(filePath, content);
  }
}

/**
 * Factory for all IPC handlers logic (testable independently)
 */
export function createIpcHandlers(deps: IpcHandlerDependencies) {
  const { orchestrator, storage } = deps;
  const shellModule = deps.shell ?? shell;
  const clipboardModule = deps.clipboard ?? clipboard;

  return {
    async handleScanStart(
      event: { sender: { send: (channel: string, data: any) => void } },
      params: { targets: OrchestratorTargets; selectedTools?: SupportedTool[] }
    ): Promise<OrchestratorResult> {
      const { targets, selectedTools } = params;
      const targetEmail = targets?.email ?? null;
      const targetUsername = targets?.username ?? null;
      const targetPhone = targets?.phone ?? null;

      const targetParts: string[] = [];
      if (targetEmail) targetParts.push(targetEmail);
      if (targetUsername) targetParts.push(targetUsername);
      if (targetPhone) targetParts.push(targetPhone);
      const title = targetParts.length > 0 ? `Audit (${targetParts.join(', ')})` : 'Audit global';

      const result = await orchestrator.runScan(targets, selectedTools, (progressEvent) => {
        try {
          event.sender.send('tool:progress', progressEvent);
        } catch {
          // Window might be closing or detached
        }
      });

      // Persist scan summary in SQLite
      storage.createScan({
        id: result.scanId,
        title,
        target_email: targetEmail,
        target_username: targetUsername,
        target_phone: targetPhone,
        status: 'completed',
        tools_selected: (selectedTools && selectedTools.length > 0) ? selectedTools : (Object.keys(result.toolResults) as SupportedTool[]),
        summary_counts: result.summary,
      });

      // Persist discovered accounts in SQLite
      if (result.accounts && result.accounts.length > 0) {
        storage.saveAccounts(
          result.accounts.map((acc) => ({
            scanId: result.scanId,
            id: acc.id,
            serviceName: acc.serviceName,
            domain: acc.domain,
            accountIdentifier: acc.accountIdentifier,
            profileUrl: acc.profileUrl ?? null,
            sourceTools: [acc.sourceTool],
            jdm: acc.jdm,
            status: acc.cleaned ? 'deleted' : 'detected',
          }))
        );
      }

      return result;
    },

    handleScanCancel(_event: any, scanId: string): boolean {
      return orchestrator.cancelScan(scanId);
    },

    handleAccountsGet(_event: any, scanId?: string): DiscoveredAccountRecord[] {
      if (scanId) {
        return storage.getAccountsByScan(scanId);
      }
      const stmt = storage.db.prepare('SELECT * FROM discovered_accounts ORDER BY updated_at DESC');
      const rows = stmt.all() as any[];
      return rows.map((r) => ({
        ...r,
        source_tools: JSON.parse(r.source_tools || '[]'),
      }));
    },

    handleAccountUpdateStatus(
      _event: any,
      params: { accountId: string; status: string; notes?: string }
    ): boolean {
      return storage.updateAccountStatus(params.accountId, params.status, params.notes ?? null);
    },

    handleGdprGenerateEmail(_event: any, params: GdprRequestParams): GdprEmailResult {
      return generateGdprArticle17Email(params);
    },

    handleGdprSaveRequest(_event: any, request: GdprRequestInput): string {
      return storage.saveGdprRequest(request);
    },

    handleGdprListRequests(_event: any, scanId?: string): GdprRequestRecord[] {
      return storage.getGdprRequests(scanId ?? null);
    },

    handleScansList(_event: any): ScanRecord[] {
      return storage.listScans();
    },

    handleScanLoad(_event: any, scanId: string): { scan: ScanRecord | null; accounts: DiscoveredAccountRecord[] } {
      const scan = storage.getScan(scanId);
      const accounts = storage.getAccountsByScan(scanId);
      return { scan, accounts };
    },

    handleScanDelete(_event: any, scanId: string): boolean {
      return storage.deleteScan(scanId);
    },

    handleScanExportJson(_event: any, scanId: string): string {
      return storage.exportScanToJson(scanId);
    },

    handleScanImportJson(_event: any, jsonContent: string): string {
      return storage.importScanFromJson(jsonContent);
    },

    async handleToolsCheckHealth(_event: any): Promise<Record<SupportedTool, ToolHealth>> {
      return await orchestrator.checkAllHealth();
    },

    async handleShellOpenExternal(_event: any, url: string): Promise<void> {
      if (!isAllowedExternalUrl(url)) {
        throw new Error('Protocole URL non autorisé');
      }
      await shellModule.openExternal(url);
    },

    handleClipboardWriteText(_event: any, text: string): void {
      clipboardModule.writeText(text);
    },

    /* ----------------------------------------------------------------------
       Milestone 2 IPC Handlers: Risk, Reports, and Comparator
       ---------------------------------------------------------------------- */

    handleRiskCalculate(
      _event: any,
      accountsOrParams?: any,
      maybeLeaks?: any[],
      maybeOptions?: any
    ): RiskScoreResult {
      let rawAccounts: any[] = [];
      let rawLeaks: any[] = [];
      let options: RiskEngineOptions = {};

      if (accountsOrParams && typeof accountsOrParams === 'object' && !Array.isArray(accountsOrParams)) {
        if (accountsOrParams.scanId && storage) {
          const sId = String(accountsOrParams.scanId);
          rawAccounts = storage.getAccountsByScan(sId);
          rawLeaks = storage.getLeaksByScan(sId);
          options = accountsOrParams.options || {};
        } else {
          rawAccounts = Array.isArray(accountsOrParams.accounts) ? accountsOrParams.accounts : [];
          rawLeaks = Array.isArray(accountsOrParams.leaks) ? accountsOrParams.leaks : [];
          options = accountsOrParams.options || {};
        }
      } else if (typeof accountsOrParams === 'string' && storage) {
        rawAccounts = storage.getAccountsByScan(accountsOrParams);
        rawLeaks = storage.getLeaksByScan(accountsOrParams);
        options = maybeOptions || {};
      } else {
        rawAccounts = Array.isArray(accountsOrParams) ? accountsOrParams : [];
        rawLeaks = Array.isArray(maybeLeaks) ? maybeLeaks : [];
        options = maybeOptions || {};
      }

      const accounts = rawAccounts.map(toUnifiedAccount);
      return calculateRiskScore(accounts, rawLeaks, options);
    },

    async handleReportExportHtml(
      _event: any,
      scanIdOrParams: any,
      maybeTargetPath?: string
    ): Promise<ExportReportResult> {
      try {
        let scanId: string;
        let targetPath: string | undefined;

        if (typeof scanIdOrParams === 'object' && scanIdOrParams !== null) {
          scanId = String(scanIdOrParams.scanId || scanIdOrParams.scan_id || '');
          targetPath = scanIdOrParams.customPath || scanIdOrParams.targetPath || scanIdOrParams.target_path;
        } else {
          scanId = String(scanIdOrParams || '');
          targetPath = maybeTargetPath;
        }

        if (!scanId) {
          return { success: false, error: 'Identifiant d audit manquant' };
        }

        const scan = storage.getScan(scanId);
        if (!scan) {
          return { success: false, error: 'Dossier d audit introuvable' };
        }

        const rawAccounts = storage.getAccountsByScan(scanId);
        const leaks = storage.getLeaksByScan(scanId);
        const accounts = rawAccounts.map(toUnifiedAccount);
        const riskScore = calculateRiskScore(accounts, leaks);
        const html = generateStandaloneHtmlReport(scan, accounts, leaks, riskScore);

        let finalPath = targetPath;
        if (!finalPath) {
          const defaultFilename = `rapport_audit_${scanId.replace(/[-–—]/g, '_')}.html`;
          const dialogModule = deps.dialog ?? dialog;
          const getWin = deps.getMainWindow ?? (() => (typeof BrowserWindow !== 'undefined' && BrowserWindow.getFocusedWindow ? BrowserWindow.getFocusedWindow() : null));
          const parentWin = getWin();

          const dialogOpts = {
            title: 'Enregistrer le rapport d audit HTML',
            defaultPath: path.join(process.cwd(), defaultFilename),
            buttonLabel: 'Enregistrer',
            filters: [
              { name: 'Document HTML', extensions: ['html', 'htm'] },
              { name: 'Tous les fichiers', extensions: ['*'] },
            ],
            properties: ['showOverwriteConfirmation', 'createDirectory'] as any[],
          };

          const dialogRes = parentWin
            ? await dialogModule.showSaveDialog(parentWin, dialogOpts)
            : await dialogModule.showSaveDialog(dialogOpts);

          if (dialogRes.canceled || !dialogRes.filePath) {
            return { success: false, canceled: true };
          }
          finalPath = dialogRes.filePath;
        }

        const fsModule = deps.fs;
        await writeOutput(fsModule, finalPath, html, 'utf-8');
        return { success: true, filePath: finalPath };
      } catch (err: any) {
        const errorMsg = String(err?.message || err).replace(/[-–—]/g, ' ');
        return { success: false, error: errorMsg };
      }
    },

    async handleReportExportPdf(
      _event: any,
      scanIdOrParams: any,
      maybeTargetPath?: string
    ): Promise<ExportReportResult> {
      try {
        let scanId: string;
        let targetPath: string | undefined;

        if (typeof scanIdOrParams === 'object' && scanIdOrParams !== null) {
          scanId = String(scanIdOrParams.scanId || scanIdOrParams.scan_id || '');
          targetPath = scanIdOrParams.customPath || scanIdOrParams.targetPath || scanIdOrParams.target_path;
        } else {
          scanId = String(scanIdOrParams || '');
          targetPath = maybeTargetPath;
        }

        if (!scanId) {
          return { success: false, error: 'Identifiant d audit manquant' };
        }

        const scan = storage.getScan(scanId);
        if (!scan) {
          return { success: false, error: 'Dossier d audit introuvable' };
        }

        const rawAccounts = storage.getAccountsByScan(scanId);
        const leaks = storage.getLeaksByScan(scanId);
        const accounts = rawAccounts.map(toUnifiedAccount);
        const riskScore = calculateRiskScore(accounts, leaks);
        const html = generateStandaloneHtmlReport(scan, accounts, leaks, riskScore);

        let finalPath = targetPath;
        if (!finalPath) {
          const defaultFilename = `rapport_audit_${scanId.replace(/[-–—]/g, '_')}.pdf`;
          const dialogModule = deps.dialog ?? dialog;
          const getWin = deps.getMainWindow ?? (() => (typeof BrowserWindow !== 'undefined' && BrowserWindow.getFocusedWindow ? BrowserWindow.getFocusedWindow() : null));
          const parentWin = getWin();

          const dialogOpts = {
            title: 'Enregistrer le rapport d audit PDF',
            defaultPath: path.join(process.cwd(), defaultFilename),
            buttonLabel: 'Enregistrer',
            filters: [
              { name: 'Document PDF', extensions: ['pdf'] },
              { name: 'Tous les fichiers', extensions: ['*'] },
            ],
            properties: ['showOverwriteConfirmation', 'createDirectory'] as any[],
          };

          const dialogRes = parentWin
            ? await dialogModule.showSaveDialog(parentWin, dialogOpts)
            : await dialogModule.showSaveDialog(dialogOpts);

          if (dialogRes.canceled || !dialogRes.filePath) {
            return { success: false, canceled: true };
          }
          finalPath = dialogRes.filePath;
        }

        let pdfBuffer: Buffer | Uint8Array;
        if (deps.pdfPrinter) {
          pdfBuffer = await deps.pdfPrinter(html);
        } else if (deps.pdfRenderer) {
          pdfBuffer = await deps.pdfRenderer(html);
        } else {
          pdfBuffer = await renderHtmlToPdf(html);
        }

        const fsModule = deps.fs;
        await writeOutput(fsModule, finalPath, pdfBuffer);
        return { success: true, filePath: finalPath };
      } catch (err: any) {
        const errorMsg = String(err?.message || err).replace(/[-–—]/g, ' ');
        return { success: false, error: errorMsg };
      }
    },

    handleScanCompare(
      _event: any,
      scanIdAOrParams: any,
      maybeScanIdB?: any
    ): AuditComparisonResult & { error?: string } {
      let scanIdA: string;
      let scanIdB: string;

      if (typeof scanIdAOrParams === 'object' && scanIdAOrParams !== null) {
        if (Array.isArray(scanIdAOrParams.accounts) && maybeScanIdB && Array.isArray(maybeScanIdB.accounts)) {
          return compareAudits(scanIdAOrParams, maybeScanIdB);
        }
        scanIdA = String(scanIdAOrParams.scanIdA || scanIdAOrParams.scan_id_a || scanIdAOrParams.a || '');
        scanIdB = String(scanIdAOrParams.scanIdB || scanIdAOrParams.scan_id_b || scanIdAOrParams.b || '');
      } else {
        scanIdA = String(scanIdAOrParams || '');
        scanIdB = String(maybeScanIdB || '');
      }

      if (!scanIdA || !scanIdB) {
        throw new Error('Identifiants des deux analyses requis pour la comparaison');
      }

      const scanA = storage.getScan(scanIdA);
      const scanB = storage.getScan(scanIdB);

      const rawAccountsA = storage.getAccountsByScan(scanIdA);
      const rawAccountsB = storage.getAccountsByScan(scanIdB);

      const leaksA = storage.getLeaksByScan(scanIdA);
      const leaksB = storage.getLeaksByScan(scanIdB);

      const accountsA = rawAccountsA.map(toUnifiedAccount);
      const accountsB = rawAccountsB.map(toUnifiedAccount);

      const snapshotA: AuditSnapshot = {
        scan: scanA,
        accounts: accountsA,
        leaks: leaksA,
      };

      const snapshotB: AuditSnapshot = {
        scan: scanB,
        accounts: accountsB,
        leaks: leaksB,
      };

      const comparison = compareAudits(snapshotA, snapshotB);

      if (!scanA || !scanB) {
        return {
          ...comparison,
          error: 'Un ou plusieurs dossiers d audit sont introuvables',
        };
      }

      return comparison;
    },
  };
}

/**
 * Registers all 19 IPC handlers on ipcMain
 */
export function registerIpcHandlers(deps: IpcHandlerDependencies, ipc: typeof ipcMain = ipcMain): void {
  const handlers = createIpcHandlers(deps);

  ipc.handle('scan:start', (event, params) => handlers.handleScanStart(event, params));
  ipc.handle('scan:cancel', (event, scanId) => handlers.handleScanCancel(event, scanId));
  ipc.handle('accounts:get', (event, scanId) => handlers.handleAccountsGet(event, scanId));
  ipc.handle('account:updateStatus', (event, params) => handlers.handleAccountUpdateStatus(event, params));
  ipc.handle('gdpr:generateEmail', (event, params) => handlers.handleGdprGenerateEmail(event, params));
  ipc.handle('gdpr:saveRequest', (event, request) => handlers.handleGdprSaveRequest(event, request));
  ipc.handle('gdpr:listRequests', (event, scanId) => handlers.handleGdprListRequests(event, scanId));
  ipc.handle('scans:list', (event) => handlers.handleScansList(event));
  ipc.handle('scan:load', (event, scanId) => handlers.handleScanLoad(event, scanId));
  ipc.handle('scan:delete', (event, scanId) => handlers.handleScanDelete(event, scanId));
  ipc.handle('scan:exportJson', (event, scanId) => handlers.handleScanExportJson(event, scanId));
  ipc.handle('scan:importJson', (event, jsonContent) => handlers.handleScanImportJson(event, jsonContent));
  ipc.handle('tools:checkHealth', (event) => handlers.handleToolsCheckHealth(event));
  ipc.handle('shell:openExternal', (event, url) => handlers.handleShellOpenExternal(event, url));
  ipc.handle('clipboard:writeText', (event, text) => handlers.handleClipboardWriteText(event, text));

  // Milestone 2 IPC Channels
  ipc.handle('risk:calculate', (event, accounts, leaks, options) =>
    handlers.handleRiskCalculate(event, accounts, leaks, options)
  );
  ipc.handle('report:exportHtml', (event, scanId, customPath) =>
    handlers.handleReportExportHtml(event, scanId, customPath)
  );
  ipc.handle('report:exportPdf', (event, scanId, customPath) =>
    handlers.handleReportExportPdf(event, scanId, customPath)
  );
  ipc.handle('scan:compare', (event, scanIdA, scanIdB) =>
    handlers.handleScanCompare(event, scanIdA, scanIdB)
  );
}
