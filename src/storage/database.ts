/**
 * Local SQLite Persistence Engine
 * Uses the native standard node:sqlite module (DatabaseSync) with zero external binary dependencies.
 * Guarantees 100% local confidentiality: zero telemetry, zero external network leakage.
 */

import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const req = createRequire(import.meta.url);
const { DatabaseSync: NodeDatabaseSync } = req('node:sqlite');
const DatabaseSyncConstructor = NodeDatabaseSync as typeof DatabaseSync;

export type ScanStatus = 'running' | 'completed' | 'failed';
export type AccountStatus = 'detected' | 'pending' | 'completed' | 'deleted' | 'ignored';
export type GdprLegalBasis = 'GDPR_ART_17_ERASURE' | 'GDPR_ART_15_ACCESS' | 'GDPR_ART_20_PORTABILITY';
export type GdprResponseStatus = 'pending' | 'favorable' | 'refusal' | 'no_response';

export interface ScanRecord {
  id: string;
  title: string;
  target_email?: string | null;
  target_username?: string | null;
  target_phone?: string | null;
  created_at: string;
  status: ScanStatus;
  tools_selected: string[];
  summary_counts: Record<string, any>;
}

export interface CreateScanInput {
  id?: string;
  title?: string;
  targetEmail?: string | null;
  target_email?: string | null;
  targetUsername?: string | null;
  target_username?: string | null;
  targetPhone?: string | null;
  target_phone?: string | null;
  createdAt?: string;
  created_at?: string;
  status?: ScanStatus;
  toolsSelected?: string[];
  tools_selected?: string[];
  summaryCounts?: Record<string, any>;
  summary_counts?: Record<string, any>;
}

export interface DiscoveredAccountRecord {
  id: string;
  scan_id: string;
  service_name: string;
  service_category?: string | null;
  account_identifier: string;
  profile_url?: string | null;
  domain: string;
  source_tools: string[];
  jdm_matched: number;
  jdm_difficulty: string;
  jdm_deletion_url?: string | null;
  jdm_notes?: string | null;
  jdm_notes_fr?: string | null;
  jdm_dpo_email?: string | null;
  jgmd_matched: number;
  jgmd_export_url?: string | null;
  jgmd_notes?: string | null;
  status: AccountStatus;
  status_notes?: string | null;
  first_seen_at: string;
  updated_at: string;
  processed_at?: string | null;
}

export interface DiscoveredAccountInput {
  id?: string;
  scanId?: string;
  scan_id?: string;
  serviceName?: string;
  service_name?: string;
  serviceCategory?: string | null;
  service_category?: string | null;
  accountIdentifier?: string;
  account_identifier?: string;
  profileUrl?: string | null;
  profile_url?: string | null;
  domain?: string;
  sourceTools?: string[];
  sourceTool?: string;
  source_tools?: string[] | string;
  jdm?: {
    matched?: boolean;
    difficulty?: string;
    deleteUrl?: string | null;
    notes?: string | null;
    notes_fr?: string | null;
    email?: string | null;
  };
  jdm_matched?: number | boolean;
  jdm_difficulty?: string;
  jdm_deletion_url?: string | null;
  jdm_notes?: string | null;
  jdm_notes_fr?: string | null;
  jdm_dpo_email?: string | null;
  jgmd?: {
    matched?: boolean;
    exportUrl?: string | null;
    notes?: string | null;
  };
  jgmd_matched?: number | boolean;
  jgmd_export_url?: string | null;
  jgmd_notes?: string | null;
  status?: string;
  statusNotes?: string | null;
  status_notes?: string | null;
  firstSeenAt?: string;
  first_seen_at?: string;
  updatedAt?: string;
  updated_at?: string;
  processedAt?: string | null;
  processed_at?: string | null;
}

export interface GdprRequestRecord {
  id: string;
  account_id?: string | null;
  scan_id?: string | null;
  service_name: string;
  recipient_email: string;
  legal_basis: GdprLegalBasis;
  email_subject: string;
  email_body: string;
  sent_date: string;
  deadline_date: string;
  response_status: GdprResponseStatus;
  response_date?: string | null;
  user_notes?: string | null;
  created_at: string;
}

export interface GdprRequestInput {
  id?: string;
  accountId?: string | null;
  account_id?: string | null;
  scanId?: string | null;
  scan_id?: string | null;
  serviceName?: string;
  service_name?: string;
  recipientEmail?: string;
  recipient_email?: string;
  legalBasis?: GdprLegalBasis;
  legal_basis?: GdprLegalBasis;
  emailSubject?: string;
  email_subject?: string;
  emailBody?: string;
  email_body?: string;
  sentDate?: string;
  sent_date?: string;
  deadlineDate?: string;
  deadline_date?: string;
  responseStatus?: GdprResponseStatus;
  response_status?: GdprResponseStatus;
  responseDate?: string | null;
  response_date?: string | null;
  userNotes?: string | null;
  user_notes?: string | null;
  createdAt?: string;
  created_at?: string;
}

export interface StorageEngine {
  db: DatabaseSync;
  createScan(scan: CreateScanInput): string;
  getScan(scanId: string): ScanRecord | null;
  listScans(): ScanRecord[];
  deleteScan(scanId: string): boolean;
  saveAccounts(accounts: DiscoveredAccountInput[]): void;
  getAccountsByScan(scanId: string): DiscoveredAccountRecord[];
  updateAccountStatus(accountId: string, status: string, notes?: string | null): boolean;
  saveGdprRequest(request: GdprRequestInput): string;
  getGdprRequests(scanId?: string | null): GdprRequestRecord[];
  exportScanToJson(scanId: string): string;
  importScanFromJson(jsonContent: string | Record<string, any>): string;
  close(): void;
}

/**
 * Initializes and configures the native SQLite storage engine
 */
export function createStorageEngine(dbPath: string = ':memory:'): StorageEngine {
  const db = new DatabaseSyncConstructor(dbPath);

  // Initialize SQLite DDL Schema with Foreign Key enforcement
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        target_email TEXT,
        target_username TEXT,
        target_phone TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        tools_selected TEXT NOT NULL,
        summary_counts TEXT
    );

    CREATE TABLE IF NOT EXISTS discovered_accounts (
        id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
        service_name TEXT NOT NULL,
        service_category TEXT,
        account_identifier TEXT NOT NULL,
        profile_url TEXT,
        domain TEXT NOT NULL,
        source_tools TEXT NOT NULL,
        jdm_matched INTEGER NOT NULL DEFAULT 0,
        jdm_difficulty TEXT NOT NULL CHECK (jdm_difficulty IN ('easy', 'medium', 'hard', 'impossible', 'limited', 'unknown')),
        jdm_deletion_url TEXT,
        jdm_notes TEXT,
        jdm_notes_fr TEXT,
        jdm_dpo_email TEXT,
        jgmd_matched INTEGER NOT NULL DEFAULT 0,
        jgmd_export_url TEXT,
        jgmd_notes TEXT,
        status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'pending', 'completed', 'deleted', 'ignored')),
        status_notes TEXT,
        first_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS gdpr_requests (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES discovered_accounts(id) ON DELETE SET NULL,
        scan_id TEXT REFERENCES scans(id) ON DELETE CASCADE,
        service_name TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        legal_basis TEXT NOT NULL CHECK (legal_basis IN ('GDPR_ART_17_ERASURE', 'GDPR_ART_15_ACCESS', 'GDPR_ART_20_PORTABILITY')),
        email_subject TEXT NOT NULL,
        email_body TEXT NOT NULL,
        sent_date TEXT NOT NULL,
        deadline_date TEXT NOT NULL,
        response_status TEXT NOT NULL DEFAULT 'pending' CHECK (response_status IN ('pending', 'favorable', 'refusal', 'no_response')),
        response_date TEXT,
        user_notes TEXT,
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_scan ON discovered_accounts(scan_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_status ON discovered_accounts(status);
    CREATE INDEX IF NOT EXISTS idx_accounts_difficulty ON discovered_accounts(jdm_difficulty);
    CREATE INDEX IF NOT EXISTS idx_gdpr_account ON gdpr_requests(account_id);
  `);

  let inTransaction = false;
  let isOpen = true;

  function withTransaction<T>(fn: () => T): T {
    const alreadyInTransaction = inTransaction || (db as any).isTransaction === true;
    if (alreadyInTransaction) {
      return fn();
    }
    inTransaction = true;
    db.exec('BEGIN TRANSACTION;');
    try {
      const res = fn();
      db.exec('COMMIT;');
      return res;
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Rollback failed or already aborted
      }
      throw err;
    } finally {
      inTransaction = false;
    }
  }

  const engine: StorageEngine = {
    db,

    createScan(scan: CreateScanInput): string {
      const id = scan.id || crypto.randomUUID();
      const stmt = db.prepare(`
        INSERT INTO scans (id, title, target_email, target_username, target_phone, created_at, status, tools_selected, summary_counts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        scan.title || 'Scan sans titre',
        scan.targetEmail ?? scan.target_email ?? null,
        scan.targetUsername ?? scan.target_username ?? null,
        scan.targetPhone ?? scan.target_phone ?? null,
        scan.createdAt ?? scan.created_at ?? new Date().toISOString(),
        scan.status || 'running',
        JSON.stringify(scan.toolsSelected ?? scan.tools_selected ?? []),
        JSON.stringify(scan.summaryCounts ?? scan.summary_counts ?? {})
      );
      return id;
    },

    getScan(scanId: string): ScanRecord | null {
      const stmt = db.prepare('SELECT * FROM scans WHERE id = ?');
      const row = stmt.get(scanId) as any;
      if (!row) return null;
      return {
        ...row,
        tools_selected: JSON.parse(row.tools_selected || '[]'),
        summary_counts: JSON.parse(row.summary_counts || '{}')
      };
    },

    listScans(): ScanRecord[] {
      const stmt = db.prepare('SELECT * FROM scans ORDER BY created_at DESC');
      const rows = stmt.all() as any[];
      return rows.map((r) => ({
        ...r,
        tools_selected: JSON.parse(r.tools_selected || '[]'),
        summary_counts: JSON.parse(r.summary_counts || '{}')
      }));
    },

    deleteScan(scanId: string): boolean {
      const stmt = db.prepare('DELETE FROM scans WHERE id = ?');
      const info = stmt.run(scanId) as any;
      return Boolean(info && info.changes > 0);
    },

    saveAccounts(accounts: DiscoveredAccountInput[]): void {
      if (!Array.isArray(accounts) || accounts.length === 0) return;

      withTransaction(() => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO discovered_accounts (
            id, scan_id, service_name, service_category, account_identifier, profile_url, domain,
            source_tools, jdm_matched, jdm_difficulty, jdm_deletion_url, jdm_notes, jdm_notes_fr,
            jdm_dpo_email, jgmd_matched, jgmd_export_url, jgmd_notes, status, status_notes,
            first_seen_at, updated_at, processed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const a of accounts) {
          const id = a.id || crypto.randomUUID();
          const scanId = a.scanId ?? a.scan_id;
          if (!scanId) continue;

          const serviceName = a.serviceName ?? a.service_name ?? 'unknown_service';
          const serviceCategory = a.serviceCategory ?? a.service_category ?? null;
          const accountIdentifier = a.accountIdentifier ?? a.account_identifier ?? '';
          const profileUrl = a.profileUrl ?? a.profile_url ?? null;
          const domain = a.domain ?? `${serviceName.toLowerCase()}.com`;

          let sourceTools: string[] = ['unknown'];
          if (Array.isArray(a.sourceTools)) sourceTools = a.sourceTools;
          else if (Array.isArray(a.source_tools)) sourceTools = a.source_tools as string[];
          else if (typeof a.source_tools === 'string') {
            try {
              sourceTools = JSON.parse(a.source_tools);
            } catch {
              sourceTools = [a.source_tools];
            }
          } else if (a.sourceTool) sourceTools = [a.sourceTool];

          let jdmMatched = 0;
          let jdmDifficulty = 'unknown';
          let jdmDeleteUrl: string | null = null;
          let jdmNotes: string | null = null;
          let jdmNotesFr: string | null = null;
          let jdmEmail: string | null = null;

          if (a.jdm) {
            jdmMatched = a.jdm.matched ? 1 : 0;
            jdmDifficulty = a.jdm.difficulty || 'unknown';
            jdmDeleteUrl = a.jdm.deleteUrl ?? null;
            jdmNotes = a.jdm.notes ?? null;
            jdmNotesFr = a.jdm.notes_fr ?? null;
            jdmEmail = a.jdm.email ?? null;
          } else {
            jdmMatched = (a.jdm_matched === 1 || a.jdm_matched === true) ? 1 : 0;
            jdmDifficulty = a.jdm_difficulty || 'unknown';
            jdmDeleteUrl = a.jdm_deletion_url ?? null;
            jdmNotes = a.jdm_notes ?? null;
            jdmNotesFr = a.jdm_notes_fr ?? null;
            jdmEmail = a.jdm_dpo_email ?? null;
          }

          // Map conditional to limited
          if (jdmDifficulty === 'conditional') jdmDifficulty = 'limited';
          if (!['easy', 'medium', 'hard', 'impossible', 'limited', 'unknown'].includes(jdmDifficulty)) {
            jdmDifficulty = 'unknown';
          }

          let jgmdMatched = 0;
          let jgmdExportUrl: string | null = null;
          let jgmdNotes: string | null = null;

          if (a.jgmd) {
            jgmdMatched = a.jgmd.matched ? 1 : 0;
            jgmdExportUrl = a.jgmd.exportUrl ?? null;
            jgmdNotes = a.jgmd.notes ?? null;
          } else {
            jgmdMatched = (a.jgmd_matched === 1 || a.jgmd_matched === true) ? 1 : 0;
            jgmdExportUrl = a.jgmd_export_url ?? null;
            jgmdNotes = a.jgmd_notes ?? null;
          }

          const validStatuses = ['detected', 'pending', 'completed', 'deleted', 'ignored'];
          const status = validStatuses.includes(a.status || '') ? a.status! : 'detected';
          const statusNotes = a.statusNotes ?? a.status_notes ?? null;

          const firstSeenAt = a.firstSeenAt ?? a.first_seen_at ?? new Date().toISOString();
          const updatedAt = a.updatedAt ?? a.updated_at ?? new Date().toISOString();
          const processedAt = a.processedAt ?? a.processed_at ?? null;

          stmt.run(
            id,
            scanId,
            serviceName,
            serviceCategory,
            accountIdentifier,
            profileUrl,
            domain,
            JSON.stringify(sourceTools),
            jdmMatched,
            jdmDifficulty,
            jdmDeleteUrl,
            jdmNotes,
            jdmNotesFr,
            jdmEmail,
            jgmdMatched,
            jgmdExportUrl,
            jgmdNotes,
            status,
            statusNotes,
            firstSeenAt,
            updatedAt,
            processedAt
          );
        }
      });
    },

    getAccountsByScan(scanId: string): DiscoveredAccountRecord[] {
      const stmt = db.prepare('SELECT * FROM discovered_accounts WHERE scan_id = ? ORDER BY service_name ASC');
      const rows = stmt.all(scanId) as any[];
      return rows.map((r) => ({
        ...r,
        source_tools: JSON.parse(r.source_tools || '[]')
      }));
    },

    updateAccountStatus(accountId: string, status: string, notes: string | null = null): boolean {
      const stmt = db.prepare(`
        UPDATE discovered_accounts
        SET status = ?, status_notes = ?, updated_at = ?, processed_at = CASE WHEN ? IN ('completed', 'deleted') THEN ? ELSE processed_at END
        WHERE id = ?
      `);
      const now = new Date().toISOString();
      const info = stmt.run(status, notes, now, status, now, accountId) as any;
      return Boolean(info && info.changes > 0);
    },

    saveGdprRequest(request: GdprRequestInput): string {
      const id = request.id || crypto.randomUUID();
      const stmt = db.prepare(`
        INSERT INTO gdpr_requests (
          id, account_id, scan_id, service_name, recipient_email, legal_basis,
          email_subject, email_body, sent_date, deadline_date, response_status,
          response_date, user_notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = new Date().toISOString();
      const sentDate = request.sentDate ?? request.sent_date ?? now;
      const sentTime = new Date(sentDate).getTime();
      const defaultDeadline = new Date(sentTime + 30 * 24 * 3600 * 1000).toISOString();
      const deadlineDate = request.deadlineDate ?? request.deadline_date ?? defaultDeadline;

      stmt.run(
        id,
        request.accountId ?? request.account_id ?? null,
        request.scanId ?? request.scan_id ?? null,
        request.serviceName ?? request.service_name ?? 'unknown_service',
        request.recipientEmail ?? request.recipient_email ?? 'dpo@service.com',
        request.legalBasis ?? request.legal_basis ?? 'GDPR_ART_17_ERASURE',
        request.emailSubject ?? request.email_subject ?? '',
        request.emailBody ?? request.email_body ?? '',
        sentDate,
        deadlineDate,
        request.responseStatus ?? request.response_status ?? 'pending',
        request.responseDate ?? request.response_date ?? null,
        request.userNotes ?? request.user_notes ?? null,
        request.createdAt ?? request.created_at ?? now
      );
      return id;
    },

    getGdprRequests(scanId: string | null = null): GdprRequestRecord[] {
      if (scanId) {
        const stmt = db.prepare('SELECT * FROM gdpr_requests WHERE scan_id = ? ORDER BY sent_date DESC');
        return stmt.all(scanId) as any[];
      }
      const stmt = db.prepare('SELECT * FROM gdpr_requests ORDER BY sent_date DESC');
      return stmt.all() as any[];
    },

    exportScanToJson(scanId: string): string {
      const scan = this.getScan(scanId);
      if (!scan) throw new Error(`Scan introuvable : ${scanId}`);
      const accounts = this.getAccountsByScan(scanId);
      const gdprRequests = this.getGdprRequests(scanId);

      const exportPayload = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        scan,
        accounts,
        gdprRequests
      };

      return JSON.stringify(exportPayload, null, 2);
    },

    importScanFromJson(jsonContent: string | Record<string, any>): string {
      const payload = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
      if (!payload.scan || !payload.scan.id) {
        throw new Error("Format JSON d'export invalide : objet scan manquant");
      }

      return withTransaction(() => {
        this.createScan({
          id: payload.scan.id,
          title: payload.scan.title,
          targetEmail: payload.scan.target_email,
          targetUsername: payload.scan.target_username,
          targetPhone: payload.scan.target_phone,
          createdAt: payload.scan.created_at,
          status: payload.scan.status,
          toolsSelected: payload.scan.tools_selected,
          summaryCounts: payload.scan.summary_counts
        });

        if (Array.isArray(payload.accounts) && payload.accounts.length > 0) {
          const mapped: DiscoveredAccountInput[] = payload.accounts.map((a: any) => ({
            id: a.id,
            scanId: payload.scan.id,
            serviceName: a.service_name ?? a.serviceName,
            serviceCategory: a.service_category ?? a.serviceCategory,
            accountIdentifier: a.account_identifier ?? a.accountIdentifier,
            profileUrl: a.profile_url ?? a.profileUrl,
            domain: a.domain,
            sourceTools: a.source_tools ?? a.sourceTools,
            jdm: a.jdm ?? {
              matched: a.jdm_matched === 1 || a.jdm_matched === true,
              difficulty: a.jdm_difficulty,
              deleteUrl: a.jdm_deletion_url,
              notes: a.jdm_notes,
              notes_fr: a.jdm_notes_fr,
              email: a.jdm_dpo_email
            },
            jgmd: a.jgmd ?? {
              matched: a.jgmd_matched === 1 || a.jgmd_matched === true,
              exportUrl: a.jgmd_export_url,
              notes: a.jgmd_notes
            },
            status: a.status,
            statusNotes: a.status_notes ?? a.statusNotes,
            firstSeenAt: a.first_seen_at ?? a.firstSeenAt,
            updatedAt: a.updated_at ?? a.updatedAt,
            processedAt: a.processed_at ?? a.processedAt
          }));
          this.saveAccounts(mapped);
        }

        if (Array.isArray(payload.gdprRequests)) {
          for (const req of payload.gdprRequests) {
            this.saveGdprRequest({
              id: req.id,
              accountId: req.account_id ?? req.accountId,
              scanId: payload.scan.id,
              serviceName: req.service_name ?? req.serviceName,
              recipientEmail: req.recipient_email ?? req.recipientEmail,
              legalBasis: req.legal_basis ?? req.legalBasis,
              emailSubject: req.email_subject ?? req.emailSubject,
              emailBody: req.email_body ?? req.emailBody,
              sentDate: req.sent_date ?? req.sentDate,
              deadlineDate: req.deadline_date ?? req.deadlineDate,
              responseStatus: req.response_status ?? req.responseStatus,
              responseDate: req.response_date ?? req.responseDate,
              userNotes: req.user_notes ?? req.userNotes
            });
          }
        }

        return payload.scan.id;
      });
    },

    close(): void {
      if (!isOpen || (db as any).isOpen === false) return;
      try {
        db.close();
      } catch {
        // safe fallback
      }
      isOpen = false;
    }
  };

  return engine;
}
