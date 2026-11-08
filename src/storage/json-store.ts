/**
 * JSON File Store for OSINT & Privacy Suite
 * Handles atomic serialization, export and import of full audit cases in JSON format.
 */

import fs from 'node:fs';
import path from 'node:path';
import { StorageEngine } from './database.js';

export interface AuditCaseExport {
  version: string;
  exportedAt: string;
  scan: Record<string, any>;
  accounts: Record<string, any>[];
  gdprRequests?: Record<string, any>[];
}

/**
 * Validates the structure of an exported audit case JSON payload
 */
export function validateAuditCaseJson(data: any): boolean {
  if (!data || typeof data !== 'object') return false;
  if (!data.scan || typeof data.scan !== 'object' || !data.scan.id) return false;
  if (!Array.isArray(data.accounts)) return false;
  return true;
}

/**
 * Exports an audit scan and all related accounts/requests to a formatted JSON string
 */
export function exportScanToJson(storage: StorageEngine, scanId: string): string {
  return storage.exportScanToJson(scanId);
}

/**
 * Imports an audit scan and all related accounts/requests from a JSON string or object
 */
export function importScanFromJson(
  storage: StorageEngine,
  jsonContent: string | Record<string, any>
): string {
  const parsed = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
  if (!validateAuditCaseJson(parsed)) {
    throw new Error("Format JSON d'export invalide : structure de scan ou comptes corrompue");
  }
  return storage.importScanFromJson(parsed);
}

/**
 * Exports an audit scan directly to a JSON file on disk
 */
export function exportScanToFile(
  storage: StorageEngine,
  scanId: string,
  filePath: string
): void {
  const jsonString = exportScanToJson(storage, scanId);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Atomic file write using temporary file
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, jsonString, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Imports an audit scan from a JSON file on disk
 */
export function importScanFromFile(
  storage: StorageEngine,
  filePath: string
): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fichier introuvable : ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return importScanFromJson(storage, content);
}
