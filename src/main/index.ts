/**
 * Main Process for OSINT & Privacy Suite
 * Lifecycle, BrowserWindow management, IPC registration, and automated headless testing.
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipc-handlers.js';
import { ToolOrchestrator } from '../core/orchestrator.js';
import { createStorageEngine, StorageEngine } from '../storage/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let storageEngine: StorageEngine | null = null;

const isHeadlessTest = process.argv.includes('--test-headless');

function getDatabasePath(): string {
  if (isHeadlessTest) {
    return ':memory:';
  }
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'osint_suite.db');
}

async function runHeadlessValidation(win: BrowserWindow): Promise<void> {
  console.log('[HEADLESS_TEST] Démarrage de la validation automatisée');

  // Guard timer to prevent hanging
  const timeoutId = setTimeout(() => {
    console.error('[HEADLESS_TEST_FAILURE] Délai d attente dépassé (15s)');
    app.exit(1);
  }, 15000);

  try {
    // 1. Verify bridge exposure
    const bridgeOk = await win.webContents.executeJavaScript(`
      Boolean(window.electronAPI && typeof window.electronAPI.startScan === 'function')
    `);
    if (!bridgeOk) {
      throw new Error('window.electronAPI non disponible dans le renderer');
    }
    console.log('[HEADLESS_TEST] Pont preload electronAPI vérifié avec succès');

    // 2. Verify navigation buttons
    const navOk = await win.webContents.executeJavaScript(`
      (() => {
        const v1 = document.getElementById('nav-view1');
        const v2 = document.getElementById('nav-view2');
        const v3 = document.getElementById('nav-view3');
        const v4 = document.getElementById('nav-view4');
        return Boolean(v1 && v2 && v3 && v4);
      })()
    `);
    if (!navOk) {
      throw new Error('Boutons de navigation des 4 vues introuvables');
    }
    console.log('[HEADLESS_TEST] Boutons de navigation des 4 vues vérifiés avec succès');

    // 3. Verify target inputs
    const inputsOk = await win.webContents.executeJavaScript(`
      (() => {
        const email = document.getElementById('input-email');
        const username = document.getElementById('input-username');
        const phone = document.getElementById('input-phone');
        return Boolean(email && username && phone);
      })()
    `);
    if (!inputsOk) {
      throw new Error('Champs de saisie multi cibles introuvables');
    }
    console.log('[HEADLESS_TEST] Champs de saisie multi cibles vérifiés avec succès');

    // 4. Test view switching
    const viewSwitchOk = await win.webContents.executeJavaScript(`
      (() => {
        const v2 = document.getElementById('nav-view2');
        const v3 = document.getElementById('nav-view3');
        const v4 = document.getElementById('nav-view4');
        const v1 = document.getElementById('nav-view1');
        v2.click();
        const s2 = document.getElementById('view2').classList.contains('active');
        v3.click();
        const s3 = document.getElementById('view3').classList.contains('active');
        v4.click();
        const s4 = document.getElementById('view4').classList.contains('active');
        v1.click();
        const s1 = document.getElementById('view1').classList.contains('active');
        return s1 && s2 && s3 && s4;
      })()
    `);
    if (!viewSwitchOk) {
      throw new Error('Bascule entre les 4 vues défaillante');
    }
    console.log('[HEADLESS_TEST] Navigation entre les 4 vues vérifiée avec succès');

    // 5. Test IPC health check invocation
    const healthOk = await win.webContents.executeJavaScript(`
      (async () => {
        try {
          const health = await window.electronAPI.checkHealth();
          return Boolean(health && typeof health === 'object');
        } catch (e) {
          return false;
        }
      })()
    `);
    if (!healthOk) {
      throw new Error('Appel IPC checkHealth en échec');
    }
    console.log('[HEADLESS_TEST] Appel IPC checkHealth validé avec succès');

    // 6. Test Milestone 2 Preload Bridge Methods
    const m2BridgeOk = await win.webContents.executeJavaScript(`
      Boolean(
        window.electronAPI &&
        typeof window.electronAPI.calculateRiskScore === 'function' &&
        typeof window.electronAPI.exportHtmlReport === 'function' &&
        typeof window.electronAPI.exportPdfReport === 'function' &&
        typeof window.electronAPI.compareAudits === 'function'
      )
    `);
    if (!m2BridgeOk) {
      throw new Error('Methodes preload du Jalon 2 non disponibles dans le renderer');
    }
    console.log('[HEADLESS_TEST] Methodes preload du Jalon 2 validees avec succes');

    clearTimeout(timeoutId);
    console.log('[HEADLESS_TEST_SUCCESS] Toutes les vérifications ont réussi');
    app.quit();
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.error(`[HEADLESS_TEST_FAILURE] ${err?.message || err}`);
    app.exit(1);
  }
}

function createWindow(): void {
  const dbPath = getDatabasePath();
  storageEngine = createStorageEngine(dbPath);
  const orchestrator = new ToolOrchestrator();

  registerIpcHandlers({
    orchestrator,
    storage: storageEngine,
  });

  const preloadPath = path.resolve(__dirname, '../preload/index.js');

  mainWindow = new BrowserWindow({
    title: 'OSINT & Privacy Suite',
    width: 1280,
    height: 850,
    minWidth: 380,
    minHeight: 480,
    show: !isHeadlessTest,
    backgroundColor: '#090d16',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Capture console messages from renderer
  mainWindow.webContents.on('console-message', (event: any) => {
    const level = event?.level;
    const message = event?.message;
    if (isHeadlessTest || (typeof level === 'number' && level > 1)) {
      console.log(`[RENDERER_CONSOLE] [Niveau ${level}] ${message}`);
    }
  });

  const htmlPath = path.resolve(__dirname, '../renderer/index.html');
  mainWindow.loadFile(htmlPath);

  mainWindow.webContents.on('did-finish-load', () => {
    if (isHeadlessTest && mainWindow) {
      runHeadlessValidation(mainWindow);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (storageEngine) {
    try {
      storageEngine.close();
    } catch {}
  }
  if (process.platform !== 'darwin' || isHeadlessTest) {
    app.quit();
  }
});
