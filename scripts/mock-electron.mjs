export const ipcMain = {
  handle: () => {},
  on: () => {},
  emit: () => {},
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
};

export default { ipcMain, shell, clipboard, app };
