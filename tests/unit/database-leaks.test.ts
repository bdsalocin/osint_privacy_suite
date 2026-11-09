import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStorageEngine, StorageEngine } from '../../src/storage/database.js';
import { UnifiedLeak } from '../../src/core/types.js';

describe('StorageEngine — discovered_leaks Persistence & Cascades', () => {
  let storage: StorageEngine;
  let testScanId: string;

  beforeEach(() => {
    storage = createStorageEngine(':memory:');
    testScanId = storage.createScan({
      title: 'Scan Test Leaks',
      targetEmail: 'target@example.com',
      status: 'completed',
    });
  });

  afterEach(() => {
    storage.close();
  });

  describe('saveLeaks and getLeaksByScan', () => {
    it('saves and retrieves leaks with JSON parsed dataClasses and dates', () => {
      const leaks: UnifiedLeak[] = [
        {
          id: 'leak_adobe_001',
          target: 'target@example.com',
          sourceTool: 'h8mail',
          breachName: 'Adobe',
          breachDate: '2013-10-04',
          dataClasses: ['passwords', 'email_addresses', 'password_hints'],
          details: 'Compromised 153 million accounts',
        },
        {
          id: 'leak_linkedin_002',
          target: 'target@example.com',
          sourceTool: 'spiderfoot',
          breachName: 'LinkedIn',
          breachDate: '2012-05-05',
          dataClasses: ['passwords', 'email_addresses'],
          details: 'Sha1 unsalted hashes exposed',
        },
      ];

      storage.saveLeaks(testScanId, leaks);

      const retrieved = storage.getLeaksByScan(testScanId);
      expect(retrieved.length).toBe(2);
      expect(retrieved[0].breachName).toBe('Adobe'); // Ordered by breach_date DESC
      expect(retrieved[0].dataClasses).toEqual(['passwords', 'email_addresses', 'password_hints']);
      expect(retrieved[0].sourceTool).toBe('h8mail');
      expect(retrieved[1].breachName).toBe('LinkedIn');
      expect(retrieved[1].dataClasses).toEqual(['passwords', 'email_addresses']);
    });

    it('returns an empty array when a scan has no recorded leaks', () => {
      const emptyScanId = storage.createScan({ title: 'Empty Scan' });
      const leaks = storage.getLeaksByScan(emptyScanId);
      expect(leaks).toEqual([]);
    });

    it('handles duplicate leak IDs idempotently via INSERT OR REPLACE', () => {
      const leak: UnifiedLeak = {
        id: 'leak_idemp_1',
        target: 'target@example.com',
        sourceTool: 'h8mail',
        breachName: 'Canva',
        dataClasses: ['passwords'],
        details: 'Initial details',
      };

      storage.saveLeaks(testScanId, [leak]);
      expect(storage.getLeaksByScan(testScanId)[0].details).toBe('Initial details');

      // Update same leak ID with newer details
      storage.saveLeaks(testScanId, [{ ...leak, details: 'Updated details' }]);
      const retrieved = storage.getLeaksByScan(testScanId);
      expect(retrieved.length).toBe(1);
      expect(retrieved[0].details).toBe('Updated details');
    });

    it('handles empty or malformed dataClasses gracefully', () => {
      const leak: any = {
        id: 'leak_no_dataclasses',
        target: 'target@example.com',
        sourceTool: 'h8mail',
        breachName: 'PlainBreach',
        details: 'No data classes field',
      };

      storage.saveLeaks(testScanId, [leak]);
      const retrieved = storage.getLeaksByScan(testScanId);
      expect(retrieved.length).toBe(1);
      expect(Array.isArray(retrieved[0].dataClasses)).toBe(true);
    });

    it('automatically persists leaks passed to createScan', () => {
      const scanWithLeaksId = storage.createScan({
        title: 'Scan with direct leaks',
        targetEmail: 'user@test.org',
        status: 'completed',
        leaks: [
          {
            id: 'leak_direct_1',
            target: 'user@test.org',
            sourceTool: 'h8mail',
            breachName: 'DirectBreach',
            dataClasses: ['passwords'],
            details: 'Persisted via createScan',
          },
        ],
      });

      const retrieved = storage.getLeaksByScan(scanWithLeaksId);
      expect(retrieved.length).toBe(1);
      expect(retrieved[0].breachName).toBe('DirectBreach');
      expect(retrieved[0].details).toBe('Persisted via createScan');
    });
  });

  describe('Cascade Deletion & Foreign Key Integrity', () => {
    it('deletes associated leaks when parent scan is deleted', () => {
      storage.saveLeaks(testScanId, [
        {
          id: 'leak_cascade_1',
          target: 'target@example.com',
          sourceTool: 'h8mail',
          breachName: 'Breach1',
          dataClasses: ['passwords'],
          details: 'Cascade test',
        },
      ]);

      expect(storage.getLeaksByScan(testScanId).length).toBe(1);

      // Delete parent scan
      const deleted = storage.deleteScan(testScanId);
      expect(deleted).toBe(true);

      // Verify leaks were cascade deleted
      expect(storage.getLeaksByScan(testScanId).length).toBe(0);
    });

    it('rolls back all leaks if foreign key constraint fails', () => {
      expect(() => {
        storage.saveLeaks('non_existent_scan_9999', [
          {
            id: 'leak_fk_fail',
            target: 'target@example.com',
            sourceTool: 'h8mail',
            breachName: 'BadFK',
            dataClasses: ['emails'],
            details: 'Should throw',
          },
        ]);
      }).toThrow(/FOREIGN KEY/i);
    });
  });

  describe('JSON Export and Import Portability', () => {
    it('includes leaks in exportScanToJson and restores them in importScanFromJson', () => {
      storage.saveLeaks(testScanId, [
        {
          id: 'leak_portable_1',
          target: 'target@example.com',
          sourceTool: 'h8mail',
          breachName: 'Dropbox',
          breachDate: '2012-07-01',
          dataClasses: ['passwords', 'email_addresses'],
          details: '68M accounts',
        },
      ]);

      const jsonStr = storage.exportScanToJson(testScanId);
      const parsed = JSON.parse(jsonStr);
      expect(Array.isArray(parsed.leaks)).toBe(true);
      expect(parsed.leaks.length).toBe(1);
      expect(parsed.leaks[0].breachName).toBe('Dropbox');

      // Create a fresh database and import
      const freshStorage = createStorageEngine(':memory:');
      const importedScanId = freshStorage.importScanFromJson(jsonStr);
      expect(importedScanId).toBe(testScanId);

      const importedLeaks = freshStorage.getLeaksByScan(importedScanId);
      expect(importedLeaks.length).toBe(1);
      expect(importedLeaks[0].breachName).toBe('Dropbox');
      expect(importedLeaks[0].dataClasses).toEqual(['passwords', 'email_addresses']);

      freshStorage.close();
    });
  });
});
