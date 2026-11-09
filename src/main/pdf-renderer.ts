/**
 * Native PDF Renderer for OSINT & Privacy Suite
 * Uses Electron webContents.printToPDF with an offscreen sandboxed BrowserWindow.
 * Strict zero-hyphen enforcement in French error messages and labels.
 */

import { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface PdfRenderOptions {
  timeoutMs?: number;
}

/**
 * Renders an HTML string into a PDF Buffer using an offscreen BrowserWindow
 */
export async function renderHtmlToPdf(
  htmlContent: string,
  options: PdfRenderOptions = {}
): Promise<Buffer> {
  if (!htmlContent || typeof htmlContent !== 'string') {
    throw new Error('Le contenu HTML fourni est vide');
  }

  const timeoutMs = options.timeoutMs ?? 15000;
  const tempFilename = `audit_render_${Date.now()}_${Math.random().toString(36).slice(2, 10)}.html`;
  const tempFilePath = path.join(os.tmpdir(), tempFilename);

  let pdfWindow: BrowserWindow | null = null;
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    await fs.writeFile(tempFilePath, htmlContent, 'utf-8');

    pdfWindow = new BrowserWindow({
      show: false,
      width: 1200,
      height: 1600,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        webSecurity: true,
      },
    });

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      let isSettled = false;

      const safeReject = (err: Error) => {
        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      };

      const safeResolve = (buf: Buffer) => {
        if (!isSettled) {
          isSettled = true;
          resolve(buf);
        }
      };

      timeoutId = setTimeout(() => {
        safeReject(new Error('Delai d attente depasse pour la generation du document PDF'));
      }, timeoutMs);

      const webContents = pdfWindow!.webContents;

      webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
        safeReject(new Error(`Echec du chargement du document HTML pour le rendu PDF (${errorDescription || errorCode})`));
      });

      webContents.once('did-finish-load', async () => {
        try {
          // Wait briefly for layout and SVG gauge paint
          await new Promise((r) => setTimeout(r, 100));

          if (pdfWindow && !pdfWindow.isDestroyed()) {
            const buffer = await pdfWindow.webContents.printToPDF({
              printBackground: true,
              pageSize: 'A4',
              margins: {
                top: 0,
                bottom: 0,
                left: 0,
                right: 0,
              },
            });
            safeResolve(buffer);
          } else {
            safeReject(new Error('Fenetre de rendu detruite avant l impression'));
          }
        } catch (err: any) {
          const rawMsg = String(err?.message || err);
          const cleanMsg = rawMsg.replace(/[-–—]/g, ' ');
          safeReject(new Error(cleanMsg));
        }
      });

      pdfWindow!.loadFile(tempFilePath).catch((loadErr) => {
        safeReject(loadErr instanceof Error ? loadErr : new Error(String(loadErr)));
      });
    });

    return pdfBuffer;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      try {
        pdfWindow.destroy();
      } catch {}
    }
    try {
      await fs.unlink(tempFilePath);
    } catch {}
  }
}
