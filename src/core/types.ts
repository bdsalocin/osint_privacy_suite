/**
 * Core Types and Interfaces for OSINT & Privacy Suite
 */

export type SupportedTool = 'holehe' | 'maigret' | 'ignorant' | 'h8mail' | 'ghunt' | 'spiderfoot';

export type AccountStatus = 'claimed' | 'unclaimed' | 'rate_limited';

export type JdmDifficulty = 'easy' | 'medium' | 'hard' | 'impossible' | 'limited' | 'conditional' | 'unknown';

export interface JdmInfo {
  matched: boolean;
  difficulty?: JdmDifficulty;
  deleteUrl?: string;
  notes?: string;
  notesFr?: string;
  notes_fr?: string;
  email?: string;
  emailBody?: string;
  email_body?: string;
  getDataUrl?: string;
}


export interface UnifiedAccount {
  id: string; // Unique generated ID
  serviceId: string; // Normalized lowercase (e.g. "github", "snapchat", "amazon")
  serviceName: string; // Display name (e.g. "GitHub", "Snapchat", "Amazon")
  domain: string; // Main domain (e.g. "github.com")
  accountIdentifier: string; // Target email, username, or phone used for detection
  sourceTool: SupportedTool;
  status: AccountStatus;
  profileUrl?: string; // Direct profile URL if available
  avatarUrl?: string; // Avatar URL if extracted
  metadata: Record<string, any>; // Enriched data
  jdm?: JdmInfo;
  cleaned: boolean; // Local persistence status
  cleanedDate?: string;
}

export interface UnifiedLeak {
  id: string;
  target: string;
  sourceTool: 'h8mail' | 'spiderfoot';
  breachName: string;
  breachDate?: string;
  dataClasses: string[];
  details: string;
}

export interface ToolExecutionContext {
  email?: string;
  username?: string;
  phone?: string; // Indicatif nettoyé
  options?: Record<string, any>;
  onProgress?: (message: string, percent?: number) => void;
  signal?: AbortSignal;
}

export interface ToolResult {
  toolName: SupportedTool;
  success: boolean;
  durationMs: number;
  rawOutput: any;
  error?: string;
  accounts: UnifiedAccount[];
  leaks: UnifiedLeak[];
  reportPaths?: {
    html?: string;
    json?: string;
    csv?: string;
  };
}

export interface ToolHealth {
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
  sessionValid?: boolean;
}

export interface IToolAdapter {
  readonly name: SupportedTool;
  checkHealth(): Promise<ToolHealth>;
  execute(context: ToolExecutionContext): Promise<ToolResult>;
  abort?(signal?: NodeJS.Signals): void;
  abortActiveProcesses?(signal?: NodeJS.Signals): void;
}

export type ToolStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped';

export interface OrchestratorProgressEvent {
  scanId: string;
  tool: SupportedTool;
  status: ToolStatus;
  progress?: number;
  message?: string;
  timestamp: string;
}

export interface OrchestratorTargets {
  email?: string;
  username?: string;
  phone?: string;
  options?: Record<string, any>;
}

export interface OrchestratorResult {
  scanId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  targets: OrchestratorTargets;
  toolResults: Partial<Record<SupportedTool, ToolResult>>;
  accounts: UnifiedAccount[];
  leaks: UnifiedLeak[];
  summary: {
    totalTools: number;
    successfulTools: number;
    failedTools: number;
    totalAccountsFound: number;
    totalLeaksFound: number;
  };
}
