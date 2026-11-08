/**
 * Asset copy script for OSINT & Privacy Suite
 * Copies static assets (HTML, CSS) from src/renderer to dist/src/renderer
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const srcRenderer = path.join(rootDir, 'src', 'renderer');
const distRenderer = path.join(rootDir, 'dist', 'src', 'renderer');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    const ext = path.extname(src).toLowerCase();
    if (ext === '.html' || ext === '.css' || ext === '.svg' || ext === '.png' || ext === '.jpg' || ext === '.json') {
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(src, dest);
    }
  }
}

try {
  copyRecursive(srcRenderer, distRenderer);
  console.log('Static assets copied successfully to dist/src/renderer/');
} catch (err) {
  console.error('Failed to copy assets:', err);
  process.exit(1);
}
