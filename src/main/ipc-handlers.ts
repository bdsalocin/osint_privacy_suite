/**
 * Electron IPC Handlers for OSINT & Privacy Suite
 * Encapsulates all 15 IPC communication channels between Renderer and Main processes.
 */

import { ipcMain, shell, clipboard } from 'electron';
import { ToolOrchestrator } from '../core/orchestrator.js';
import { StorageEngine, DiscoveredAccountRecord, ScanRecord, GdprRequestRecord, GdprRequestInput } from '../storage/database.js';
import { generateGdprArticle17Email, GdprRequestParams, GdprEmailResult } from '../core/gdpr-generator.js';
import { OrchestratorTargets, SupportedTool, OrchestratorResult, ToolHealth } from '../core/types.js';

export interface IpcHandlerDependencies {
  orchestrator: ToolOrchestrator;
  storage: StorageEngine;
  shell?: { openExternal: (url: string) => Promise<void> };
  clipboard?: { writeText: (text: string) => void };
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
  };
}

/**
 * Registers all 15 IPC handlers on ipcMain
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
}
