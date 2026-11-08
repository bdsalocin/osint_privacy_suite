import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createStorageEngine, StorageEngine } from '../../src/storage/database.js';
import {
  exportScanToJson,
  importScanFromJson,
  exportScanToFile,
  importScanFromFile,
  validateAuditCaseJson
} from '../../src/storage/json-store.js';

describe('JsonStore — Export & Import of Audit Cases', () => {
  let storage: StorageEngine;
  let tempDir: string;

  beforeEach(() => {
    storage = createStorageEngine(':memory:');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-store-test-'));
  });

  afterEach(() => {
    storage.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('validateAuditCaseJson', () => {
    it('returns true for structurally valid audit payloads', () => {
      const valid = {
        version: '1.0',
        scan: { id: 'scan_1', title: 'Test' },
        accounts: []
      };
      expect(validateAuditCaseJson(valid)).toBe(true);
    });

    it('returns false for null, non-objects or missing required properties', () => {
      expect(validateAuditCaseJson(null)).toBe(false);
      expect(validateAuditCaseJson({})).toBe(false);
      expect(validateAuditCaseJson({ scan: {} })).toBe(false);
      expect(validateAuditCaseJson({ scan: { id: '1' } })).toBe(false); // missing accounts
    });
  });

  describe('JSON String Round-Trip (Export / Import)', () => {
    it('exports a complete scan with accounts and requests, then restores it into a fresh database', () => {
      const scanId = storage.createScan({
        title: 'Audit Jean Dupont',
        targetEmail: 'jean@example.com',
        targetUsername: 'jean',
        targetPhone: '+33699504346',
        toolsSelected: ['holehe', 'maigret'],
        summaryCounts: { total: 1 }
      });

      storage.saveAccounts([
        {
          id: 'acc_spotify_1',
          scanId,
          serviceName: 'Spotify',
          accountIdentifier: 'jean@example.com',
          domain: 'spotify.com',
          sourceTools: ['holehe'],
          jdm: {
            matched: true,
            difficulty: 'medium',
            deleteUrl: 'https://spotify.com/delete'
          },
          jgmd: {
            matched: true,
            exportUrl: 'https://spotify.com/privacy'
          },
          status: 'pending',
          statusNotes: 'En cours de fermeture'
        }
      ]);

      storage.saveGdprRequest({
        scanId,
        accountId: 'acc_spotify_1',
        serviceName: 'Spotify',
        recipientEmail: 'privacy@spotify.com',
        legalBasis: 'GDPR_ART_17_ERASURE',
        emailSubject: 'Demande RGPD',
        emailBody: 'Corps du message'
      });

      // Export to JSON string
      const jsonOutput = exportScanToJson(storage, scanId);
      expect(typeof jsonOutput).toBe('string');
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.version).toBe('1.0');
      expect(parsed.scan.id).toBe(scanId);
      expect(parsed.accounts).toHaveLength(1);
      expect(parsed.gdprRequests).toHaveLength(1);

      // Import into fresh second storage engine
      const storage2 = createStorageEngine(':memory:');
      const restoredScanId = importScanFromJson(storage2, jsonOutput);
      expect(restoredScanId).toBe(scanId);

      const restoredScan = storage2.getScan(restoredScanId);
      expect(restoredScan?.title).toBe('Audit Jean Dupont');
      expect(restoredScan?.target_email).toBe('jean@example.com');

      const restoredAccounts = storage2.getAccountsByScan(restoredScanId);
      expect(restoredAccounts).toHaveLength(1);
      expect(restoredAccounts[0].service_name).toBe('Spotify');
      expect(restoredAccounts[0].status).toBe('pending');
      expect(restoredAccounts[0].status_notes).toBe('En cours de fermeture');
      expect(restoredAccounts[0].jdm_difficulty).toBe('medium');

      const restoredRequests = storage2.getGdprRequests(restoredScanId);
      expect(restoredRequests).toHaveLength(1);
      expect(restoredRequests[0].service_name).toBe('Spotify');

      storage2.close();
    });

    it('throws error when exporting non-existent scan', () => {
      expect(() => exportScanToJson(storage, 'non_existent_scan_id')).toThrow('Scan introuvable');
    });

    it('throws error when importing invalid JSON structure', () => {
      expect(() => importScanFromJson(storage, '{"invalid": true}')).toThrow("Format JSON d'export invalide");
    });
  });

  describe('File System Persistence (Export / Import to file)', () => {
    it('writes atomic JSON file to disk and reloads it cleanly', () => {
      const scanId = storage.createScan({ title: 'File Persistence Test' });
      storage.saveAccounts([
        {
          id: 'acc_test_1',
          scanId,
          serviceName: 'GitHub',
          accountIdentifier: 'octocat',
          domain: 'github.com',
          status: 'detected'
        }
      ]);

      const targetFile = path.join(tempDir, 'subfolder', 'audit_export.json');
      exportScanToFile(storage, scanId, targetFile);

      expect(fs.existsSync(targetFile)).toBe(true);

      const storageFresh = createStorageEngine(':memory:');
      const importedId = importScanFromFile(storageFresh, targetFile);
      expect(importedId).toBe(scanId);

      const importedAccounts = storageFresh.getAccountsByScan(importedId);
      expect(importedAccounts).toHaveLength(1);
      expect(importedAccounts[0].service_name).toBe('GitHub');

      storageFresh.close();
    });

    it('throws error when importing from a non-existent file', () => {
      const storageFresh = createStorageEngine(':memory:');
      expect(() => importScanFromFile(storageFresh, path.join(tempDir, 'missing.json'))).toThrow('Fichier introuvable');
      storageFresh.close();
    });
  });
});
