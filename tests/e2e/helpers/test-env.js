/**
 * Gestionnaire d'environnement de test et chargement des jeux de données autoritaires (ESM)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
export const TMP_DIR = path.resolve(__dirname, '../.tmp');

export function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
  return TMP_DIR;
}

export function cleanTmpDir() {
  if (fs.existsSync(TMP_DIR)) {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

export function loadJdmSample() {
  const content = fs.readFileSync(path.join(FIXTURES_DIR, 'jdm_sample.json'), 'utf8');
  return JSON.parse(content);
}

export function loadJgmdSample() {
  const content = fs.readFileSync(path.join(FIXTURES_DIR, 'jgmd_sample.json'), 'utf8');
  return JSON.parse(content);
}

export function loadToolOutput(fileName) {
  const filePath = path.join(FIXTURES_DIR, 'tool_outputs', fileName);
  return fs.readFileSync(filePath, 'utf8');
}
