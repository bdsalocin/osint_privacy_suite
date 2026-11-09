/**
 * Preload Script for OSINT & Privacy Suite
 * Exposes a secure, typed bridge between the Renderer and Main processes.
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  OrchestratorTargets,
  SupportedTool,
  OrchestratorResult,
  OrchestratorProgressEvent,
  ToolHealth,
  UnifiedAccount,
  UnifiedLeak,
} from '../core/types.js';
import type {
  DiscoveredAccountRecord,
  ScanRecord,
  GdprRequestRecord,
  GdprRequestInput,
} from '../storage/database.js';
import type { GdprRequestParams, GdprEmailResult } from '../core/gdpr-generator.js';
import type { RiskScoreResult, RiskEngineOptions } from '../core/risk-engine.js';
import type { AuditComparisonResult } from '../core/audit-comparator.js';
import type { ExportReportResult } from '../main/ipc-handlers.js';

export type { ExportReportResult };

export interface ElectronAPI {
  startScan: (params: { targets: OrchestratorTargets; selectedTools?: SupportedTool[] }) => Promise<OrchestratorResult>;
  cancelScan: (scanId: string) => Promise<boolean>;
  getAccounts: (scanId?: string) => Promise<DiscoveredAccountRecord[]>;
  updateAccountStatus: (accountId: string, status: string, notes?: string) => Promise<boolean>;
  generateGdprEmail: (params: GdprRequestParams) => Promise<GdprEmailResult>;
  saveGdprRequest: (request: GdprRequestInput) => Promise<string>;
  listGdprRequests: (scanId?: string) => Promise<GdprRequestRecord[]>;
  listScans: () => Promise<ScanRecord[]>;
  loadScan: (scanId: string) => Promise<{ scan: ScanRecord | null; accounts: DiscoveredAccountRecord[] }>;
  deleteScan: (scanId: string) => Promise<boolean>;
  exportScanJson: (scanId: string) => Promise<string>;
  importScanJson: (jsonContent: string) => Promise<string>;
  checkHealth: () => Promise<Record<SupportedTool, ToolHealth>>;
  openExternal: (url: string) => Promise<void>;
  writeClipboard: (text: string) => Promise<void>;
  onToolProgress: (callback: (event: OrchestratorProgressEvent) => void) => () => void;
  removeAllListeners: (channel: string) => void;

  // Milestone 2 IPC bridge methods
  calculateRiskScore: (
    accounts?: (UnifiedAccount | DiscoveredAccountRecord)[],
    leaks?: UnifiedLeak[],
    options?: RiskEngineOptions
  ) => Promise<RiskScoreResult>;
  exportHtmlReport: (scanId: string, customPath?: string) => Promise<ExportReportResult>;
  exportPdfReport: (scanId: string, customPath?: string) => Promise<ExportReportResult>;
  compareAudits: (scanIdA: string, scanIdB: string) => Promise<AuditComparisonResult>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

const api: ElectronAPI = {
  startScan: (params) => ipcRenderer.invoke('scan:start', params),
  cancelScan: (scanId) => ipcRenderer.invoke('scan:cancel', scanId),
  getAccounts: (scanId) => ipcRenderer.invoke('accounts:get', scanId),
  updateAccountStatus: (accountId, status, notes) =>
    ipcRenderer.invoke('account:updateStatus', { accountId, status, notes }),
  generateGdprEmail: (params) => ipcRenderer.invoke('gdpr:generateEmail', params),
  saveGdprRequest: (request) => ipcRenderer.invoke('gdpr:saveRequest', request),
  listGdprRequests: (scanId) => ipcRenderer.invoke('gdpr:listRequests', scanId),
  listScans: () => ipcRenderer.invoke('scans:list'),
  loadScan: (scanId) => ipcRenderer.invoke('scan:load', scanId),
  deleteScan: (scanId) => ipcRenderer.invoke('scan:delete', scanId),
  exportScanJson: (scanId) => ipcRenderer.invoke('scan:exportJson', scanId),
  importScanJson: (jsonContent) => ipcRenderer.invoke('scan:importJson', jsonContent),
  checkHealth: () => ipcRenderer.invoke('tools:checkHealth'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:writeText', text),

  // Milestone 2 IPC bridge methods
  calculateRiskScore: (accounts, leaks, options) =>
    ipcRenderer.invoke('risk:calculate', accounts, leaks, options),
  exportHtmlReport: (scanId, customPath) =>
    ipcRenderer.invoke('report:exportHtml', scanId, customPath),
  exportPdfReport: (scanId, customPath) =>
    ipcRenderer.invoke('report:exportPdf', scanId, customPath),
  compareAudits: (scanIdA, scanIdB) =>
    ipcRenderer.invoke('scan:compare', scanIdA, scanIdB),

  onToolProgress: (callback) => {
    const handler = (_event: IpcRendererEvent, data: OrchestratorProgressEvent) => callback(data);
    ipcRenderer.on('tool:progress', handler);
    return () => {
      ipcRenderer.removeListener('tool:progress', handler);
    };
  },

  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
