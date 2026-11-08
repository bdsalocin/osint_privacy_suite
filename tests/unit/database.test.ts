import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStorageEngine, StorageEngine } from '../../src/storage/database.js';

describe('StorageEngine — SQLite Local Persistence (node:sqlite)', () => {
  let storage: StorageEngine;

  beforeEach(() => {
    storage = createStorageEngine(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  describe('Scan Management (CRUD)', () => {
    it('creates and retrieves a scan with parsed JSON fields', () => {
      const scanId = storage.createScan({
        title: 'Audit de test',
        targetEmail: 'jean@example.com',
        targetUsername: 'jeandupont',
        targetPhone: '+33699504346',
        toolsSelected: ['holehe', 'maigret', 'ignorant'],
        summaryCounts: { total: 10, claimed: 4 }
      });

      expect(typeof scanId).toBe('string');
      expect(scanId.length).toBeGreaterThan(0);

      const retrieved = storage.getScan(scanId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.title).toBe('Audit de test');
      expect(retrieved?.target_email).toBe('jean@example.com');
      expect(retrieved?.tools_selected).toEqual(['holehe', 'maigret', 'ignorant']);
      expect(retrieved?.summary_counts).toEqual({ total: 10, claimed: 4 });
      expect(retrieved?.status).toBe('running');
    });

    it('lists scans ordered chronologically descending', () => {
      storage.createScan({ title: 'Scan Ancien', createdAt: '2026-11-01T10:00:00.000Z' });
      storage.createScan({ title: 'Scan Recent', createdAt: '2026-11-08T10:00:00.000Z' });

      const list = storage.listScans();
      expect(list.length).toBe(2);
      expect(list[0].title).toBe('Scan Recent');
      expect(list[1].title).toBe('Scan Ancien');
    });

    it('deletes a scan successfully', () => {
      const scanId = storage.createScan({ title: 'Scan to Delete' });
      const deleted = storage.deleteScan(scanId);
      expect(deleted).toBe(true);

      const check = storage.getScan(scanId);
      expect(check).toBeNull();
    });
  });

  describe('Discovered Accounts & Processing State', () => {
    it('saves accounts and retrieves them by scanId with JDM/JGMD metadata', () => {
      const scanId = storage.createScan({ title: 'Scan with Accounts' });

      storage.saveAccounts([
        {
          id: 'acc_spotify_1',
          scanId,
          serviceName: 'Spotify',
          accountIdentifier: 'jean@example.com',
          domain: 'spotify.com',
          sourceTools: ['holehe', 'maigret'],
          jdm: {
            matched: true,
            difficulty: 'medium',
            deleteUrl: 'https://support.spotify.com/close-account',
            notes: 'Contact support',
            notes_fr: 'Contacter le support'
          },
          jgmd: {
            matched: true,
            exportUrl: 'https://www.spotify.com/account/privacy/'
          },
          status: 'detected'
        }
      ]);

      const accounts = storage.getAccountsByScan(scanId);
      expect(accounts.length).toBe(1);
      const acc = accounts[0];
      expect(acc.id).toBe('acc_spotify_1');
      expect(acc.service_name).toBe('Spotify');
      expect(acc.source_tools).toEqual(['holehe', 'maigret']);
      expect(acc.jdm_matched).toBe(1);
      expect(acc.jdm_difficulty).toBe('medium');
      expect(acc.jdm_deletion_url).toBe('https://support.spotify.com/close-account');
      expect(acc.jgmd_matched).toBe(1);
      expect(acc.jgmd_export_url).toBe('https://www.spotify.com/account/privacy/');
      expect(acc.status).toBe('detected');
      expect(acc.processed_at).toBeNull();
    });

    it('automatically records processed_at timestamp when marked completed or deleted', () => {
      const scanId = storage.createScan({ title: 'Scan Status' });
      storage.saveAccounts([
        {
          id: 'acc_target_1',
          scanId,
          serviceName: 'Twitter',
          accountIdentifier: 'user@example.com',
          domain: 'twitter.com',
          status: 'detected'
        }
      ]);

      // Update to completed
      const updated = storage.updateAccountStatus('acc_target_1', 'completed', 'Compte clôturé avec succès');
      expect(updated).toBe(true);

      const accountsAfterComplete = storage.getAccountsByScan(scanId);
      expect(accountsAfterComplete[0].status).toBe('completed');
      expect(accountsAfterComplete[0].status_notes).toBe('Compte clôturé avec succès');
      expect(accountsAfterComplete[0].processed_at).not.toBeNull();

      // Ensure processed_at is an ISO timestamp
      expect(new Date(accountsAfterComplete[0].processed_at!).getTime()).not.toBeNaN();
    });

    it('retains processed_at when updating notes with a non-terminal status like pending', () => {
      const scanId = storage.createScan({ title: 'Scan Notes' });
      storage.saveAccounts([
        {
          id: 'acc_target_2',
          scanId,
          serviceName: 'GitHub',
          accountIdentifier: 'user@example.com',
          domain: 'github.com',
          status: 'deleted',
          processedAt: '2026-11-05T12:00:00.000Z'
        }
      ]);

      storage.updateAccountStatus('acc_target_2', 'pending', 'Note mise à jour');
      const accounts = storage.getAccountsByScan(scanId);
      expect(accounts[0].processed_at).toBe('2026-11-05T12:00:00.000Z');
      expect(accounts[0].status_notes).toBe('Note mise à jour');
    });
  });

  describe('GDPR Requests & Deadlines', () => {
    it('saves a GDPR request with auto-computed 30-day legal deadline', () => {
      const scanId = storage.createScan({ title: 'Scan RGPD' });
      const sentDate = '2026-11-08T12:00:00.000Z';

      const reqId = storage.saveGdprRequest({
        scanId,
        serviceName: 'Spotify',
        recipientEmail: 'privacy@spotify.com',
        legalBasis: 'GDPR_ART_17_ERASURE',
        emailSubject: 'Demande RGPD',
        emailBody: 'Corps du message',
        sentDate
      });

      expect(typeof reqId).toBe('string');
      const requests = storage.getGdprRequests(scanId);
      expect(requests.length).toBe(1);
      const req = requests[0];
      expect(req.service_name).toBe('Spotify');
      expect(req.recipient_email).toBe('privacy@spotify.com');
      expect(req.sent_date).toBe(sentDate);

      // Verify that deadline is exactly 30 days later
      const sentTime = new Date(sentDate).getTime();
      const deadlineTime = new Date(req.deadline_date).getTime();
      const diffDays = Math.round((deadlineTime - sentTime) / (1000 * 3600 * 24));
      expect(diffDays).toBe(30);
    });
  });

  describe('Cascade Deletion & Referential Integrity', () => {
    it('deletes associated accounts and gdpr requests when scan is deleted', () => {
      const scanId = storage.createScan({ title: 'Parent Scan' });
      storage.saveAccounts([
        {
          id: 'child_account_1',
          scanId,
          serviceName: 'TestService',
          accountIdentifier: 'id@example.com',
          domain: 'testservice.com'
        }
      ]);

      storage.saveGdprRequest({
        scanId,
        accountId: 'child_account_1',
        serviceName: 'TestService',
        recipientEmail: 'dpo@testservice.com',
        emailSubject: 'Subj',
        emailBody: 'Body'
      });

      // Verify insertion
      expect(storage.getAccountsByScan(scanId).length).toBe(1);
      expect(storage.getGdprRequests(scanId).length).toBe(1);

      // Delete parent scan
      storage.deleteScan(scanId);

      // Check cascade
      expect(storage.getAccountsByScan(scanId).length).toBe(0);
      expect(storage.getGdprRequests(scanId).length).toBe(0);
    });
  });

  describe('ACID Transactions, Reentrance & Idempotent Close', () => {
    it('rolls back all accounts in saveAccounts if one account insertion fails', () => {
      const scanId = storage.createScan({ title: 'ACID Scan' });

      expect(() => {
        storage.saveAccounts([
          { id: 'acc_ok_1', scanId, serviceName: 'Valid1', domain: 'v1.com' },
          { id: 'acc_ok_2', scanId, serviceName: 'Valid2', domain: 'v2.com' },
          { id: 'acc_bad_fk', scanId: 'non_existent_scan_id_9999', serviceName: 'Bad', domain: 'b.com' }
        ]);
      }).toThrow(/FOREIGN KEY/i);

      // Verify that NEITHER acc_ok_1 NOR acc_ok_2 were persisted
      const accounts = storage.getAccountsByScan(scanId);
      expect(accounts.length).toBe(0);
    });

    it('rolls back the scan, accounts and requests in importScanFromJson on failure', () => {
      const invalidPayload = {
        version: '1.0',
        scan: { id: 'scan_to_abort', title: 'Should Be Aborted' },
        accounts: [
          { id: 'acc_abort_1', service_name: 'Abort1', domain: 'abort1.com' }
        ],
        gdprRequests: [
          {
            id: 'req_abort_1',
            service_name: 'Abort1',
            recipient_email: 'dpo@abort.com',
            legal_basis: 'INVALID_BASIS_SHOULD_THROW'
          }
        ]
      };

      expect(() => {
        storage.importScanFromJson(invalidPayload);
      }).toThrow(/CHECK constraint failed/i);

      expect(storage.getScan('scan_to_abort')).toBeNull();
      expect(storage.getAccountsByScan('scan_to_abort').length).toBe(0);
      expect(storage.getGdprRequests('scan_to_abort').length).toBe(0);
    });

    it('allows nesting saveAccounts inside an outer active transaction without SQLite collision', () => {
      const scanId = storage.createScan({ title: 'Outer Tx Scan' });

      storage.db.exec('BEGIN TRANSACTION;');
      storage.saveAccounts([
        { id: 'acc_outer_1', scanId, serviceName: 'Outer1', domain: 'outer1.com' }
      ]);
      storage.saveAccounts([
        { id: 'acc_outer_2', scanId, serviceName: 'Outer2', domain: 'outer2.com' }
      ]);
      storage.db.exec('COMMIT;');

      const accounts = storage.getAccountsByScan(scanId);
      expect(accounts.length).toBe(2);
    });

    it('supports calling close() multiple times idempotently without throwing', () => {
      expect(() => {
        storage.close();
        storage.close();
        storage.close();
      }).not.toThrow();
    });
  });
});

