/**
 * GHunt OSINT Tool Adapter
 * Investigates Google accounts using email targets
 */

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BaseAdapter, BaseAdapterOptions } from './base-adapter.js';
import {
  SupportedTool,
  ToolExecutionContext,
  ToolHealth,
  ToolResult,
  UnifiedAccount,
} from '../types.js';

export class GHuntAdapter extends BaseAdapter {
  readonly name: SupportedTool = 'ghunt';
  private sessionFilePath: string;

  constructor(options: BaseAdapterOptions & { sessionFilePath?: string } = {}) {
    super({
      binaryPath: options.binaryPath ?? `${os.homedir()}/.local/bin/ghunt`,
      customRunner: options.customRunner,
      defaultTimeoutMs: options.defaultTimeoutMs ?? 30_000,
    });
    this.sessionFilePath =
      options.sessionFilePath ?? path.join(os.homedir(), '.malfrats', 'ghunt', 'creds.m');
  }

  async checkHealth(): Promise<ToolHealth> {
    const isExe = await this.isExecutable(this.binaryPath);
    if (!isExe) {
      return {
        installed: false,
        path: this.binaryPath,
        error: `GHunt binary not found or not executable at ${this.binaryPath}`,
      };
    }

    const sessionExists = existsSync(this.sessionFilePath);

    return {
      installed: true,
      path: this.binaryPath,
      version: '2.3.4 (Spider Edition)',
      sessionValid: sessionExists,
      error: sessionExists
        ? undefined
        : `Google session not found at ${this.sessionFilePath}. Use 'ghunt login' to authenticate.`,
    };
  }

  async execute(context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const email = context.email?.trim();

    if (!email || !email.includes('@')) {
      return this.createResult({
        success: false,
        durationMs: 0,
        error: 'GHunt requires a valid email address target',
      });
    }

    // Check session presence
    const hasSession = existsSync(this.sessionFilePath);
    if (!hasSession && !context.options?.ignoreMissingSession) {
      return this.createResult({
        success: false,
        durationMs: Date.now() - startTime,
        error: `GHunt session not found (${this.sessionFilePath}). Please configure a Google session first.`,
      });
    }

    context.onProgress?.(`Starting GHunt investigation for ${email}...`, 10);

    // Run without --json due to upstream NameError bug on 'photos' in ghunt/modules/email.py
    const args = ['email', email];

    try {
      const execResult = await this.runCommand(this.binaryPath, args, {
        timeoutMs: context.options?.timeoutMs ?? this.defaultTimeoutMs,
        signal: context.signal,
        onStdoutLine: (line) => {
          context.onProgress?.(`GHunt: ${line.trim()}`);
        },
      });

      // Handle invalid session error message from GHunt
      if (
        execResult.exitCode !== 0 &&
        (execResult.stderr.includes('GHuntInvalidSession') ||
          execResult.stdout.includes('GHuntInvalidSession') ||
          execResult.stderr.includes('No stored session found'))
      ) {
        return this.createResult({
          success: false,
          durationMs: execResult.durationMs,
          error: 'GHunt session expired or invalid. Please re-authenticate via ghunt login.',
          rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        });
      }

      const accounts = this.parseStdout(execResult.stdout, email);

      if (execResult.exitCode !== 0 && accounts.length === 0) {
        return this.createResult({
          success: false,
          durationMs: execResult.durationMs,
          error: execResult.stderr || `GHunt failed with exit code ${execResult.exitCode}`,
          rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        });
      }

      context.onProgress?.(
        `GHunt completed: Google account profile analyzed.`,
        100
      );

      return this.createResult({
        success: true,
        durationMs: execResult.durationMs,
        rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        accounts,
      });
    } catch (err: any) {
      return this.createResult({
        success: false,
        durationMs: Date.now() - startTime,
        error: err?.message ?? 'GHunt execution error',
      });
    }
  }

  /**
   * Parse structured output from GHunt stdout
   */
  parseStdout(stdout: string, email: string): UnifiedAccount[] {
    if (!stdout) return [];

    const accounts: UnifiedAccount[] = [];

    // Helper to sanitize Rich CLI borders, vertical bars, and trailing whitespace
    const cleanRichText = (raw: string | undefined): string => {
      if (!raw) return '';
      return raw.replace(/[│┃║|]/g, '').trim();
    };

    // Extract basic fields
    const nameMatch = stdout.match(/Name\s*:\s*([^\n\r]+)/i);
    const gaiaMatch = stdout.match(/Gaia ID\s*:\s*(\d+)/i);
    const photoMatch = stdout.match(/(?:Profile picture|Profile photo)\s*:\s*(https?:\/\/[^\s\n│┃║|]+)/i);
    const lastEditMatch = stdout.match(/Last profile edit\s*:\s*([^\n\r]+)/i);
    const chatTypeMatch = stdout.match(/Chat entity type\s*:\s*([^\n\r]+)/i);

    // Active services detection
    const servicesFound: string[] = [];
    if (/\[\+\]\s*YouTube/i.test(stdout)) servicesFound.push('YouTube');
    if (/\[\+\]\s*(?:Google\s*)?Photos/i.test(stdout)) servicesFound.push('Google Photos');
    if (/\[\+\]\s*(?:Google\s*)?Maps/i.test(stdout)) servicesFound.push('Google Maps');
    if (/\[\+\]\s*(?:Google\s*)?Calendar/i.test(stdout)) servicesFound.push('Google Calendar');
    if (/\[\+\]\s*(?:Google\s*)?Drive/i.test(stdout)) servicesFound.push('Google Drive');
    if (/\[\+\]\s*(?:Google\s*)?Play Games/i.test(stdout)) servicesFound.push('Play Games');

    const gaiaId = gaiaMatch ? gaiaMatch[1] : undefined;
    const rawName = nameMatch ? cleanRichText(nameMatch[1]) : '';
    const displayName = rawName || 'Google Account';
    const avatarUrl = photoMatch ? cleanRichText(photoMatch[1]) : undefined;
    const lastEdit = lastEditMatch ? cleanRichText(lastEditMatch[1]) : undefined;
    const chatEntityType = chatTypeMatch ? cleanRichText(chatTypeMatch[1]) : undefined;

    // Only create an account if we actually identified something Google-related
    if (
      gaiaId ||
      rawName ||
      servicesFound.length > 0 ||
      stdout.includes('Google Account') ||
      stdout.includes('Google Account Found') ||
      stdout.includes('[+] Target :')
    ) {
      accounts.push({
        id: `ghunt_google_${Buffer.from(email).toString('hex').slice(0, 8)}`,
        serviceId: 'google',
        serviceName: 'Google',
        domain: 'google.com',
        accountIdentifier: email,
        sourceTool: 'ghunt',
        status: 'claimed',
        profileUrl: gaiaId ? `https://myaccount.google.com/?gaia_id=${gaiaId}` : undefined,
        avatarUrl,
        metadata: {
          name: displayName,
          gaiaId,
          lastEdit,
          chatEntityType,
          servicesFound,
        },
        cleaned: false,
      });

      // If YouTube was specifically found
      if (servicesFound.includes('YouTube')) {
        accounts.push({
          id: `ghunt_youtube_${Buffer.from(email).toString('hex').slice(0, 8)}`,
          serviceId: 'youtube',
          serviceName: 'YouTube',
          domain: 'youtube.com',
          accountIdentifier: email,
          sourceTool: 'ghunt',
          status: 'claimed',
          avatarUrl,
          metadata: {
            parentGaiaId: gaiaId,
            detectedVia: 'ghunt',
          },
          cleaned: false,
        });
      }
    }

    return accounts;
  }
}
