export const ipcMain = {
  handle: () => {},
  on: () => {},
  emit: () => {},
  removeAllListeners: () => {},
};

export const shell = {
  openExternal: async () => {},
};

export const clipboard = {
  writeText: () => {},
};

export const app = {
  getPath: () => '/tmp',
  quit: () => {},
  exit: () => {},
  whenReady: () => Promise.resolve(),
  on: () => {},
};

export const dialog = {
  showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showMessageBox: async () => ({ response: 0 }),
};

export class BrowserWindow {
  constructor() {}
  destroy() {}
  isDestroyed() { return false; }
  loadURL() { return Promise.resolve(); }
  loadFile() { return Promise.resolve(); }
  webContents = {
    printToPDF: async () => Buffer.from('%PDF-1.4\n%EOF'),
    once: (event, cb) => { if (event === 'did-finish-load') setImmediate(cb); },
    on: () => {},
    removeListener: () => {},
    executeJavaScript: async () => true,
  };
  static getFocusedWindow() { return null; }
  static getAllWindows() { return []; }
}

export default { ipcMain, shell, clipboard, app, dialog, BrowserWindow };
