/**
 * Maigret OSINT Tool Adapter
 * Collects dossiers on a person by username across thousands of sites
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { BaseAdapter, BaseAdapterOptions } from './base-adapter.js';
import {
  SupportedTool,
  ToolExecutionContext,
  ToolHealth,
  ToolResult,
  UnifiedAccount,
} from '../types.js';

export class MaigretAdapter extends BaseAdapter {
  readonly name: SupportedTool = 'maigret';

  constructor(options: BaseAdapterOptions = {}) {
    super({
      binaryPath: options.binaryPath ?? `${os.homedir()}/.local/bin/maigret`,
      customRunner: options.customRunner,
      defaultTimeoutMs: options.defaultTimeoutMs ?? 60_000,
    });
  }

  async checkHealth(): Promise<ToolHealth> {
    const isExe = await this.isExecutable(this.binaryPath);
    if (!isExe) {
      return {
        installed: false,
        path: this.binaryPath,
        error: `Maigret binary not found or not executable at ${this.binaryPath}`,
      };
    }

    try {
      const res = await this.runCommand(this.binaryPath, ['--version'], { timeoutMs: 5_000 });
      const versionMatch = res.stdout.match(/v?(\d+\.\d+(\.\d+)?)/i);
      return {
        installed: true,
        path: this.binaryPath,
        version: versionMatch ? versionMatch[0] : 'v0.6.6',
      };
    } catch (err: any) {
      return {
        installed: false,
        path: this.binaryPath,
        error: err?.message ?? 'Health check failed',
      };
    }
  }

  async execute(context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const username = context.username?.trim();

    if (!username) {
      return this.createResult({
        success: false,
        durationMs: 0,
        error: 'Maigret requires a valid username target',
      });
    }

    // Prepare destination folder for reports
    let workDir = context.options?.outputDir;
    if (!workDir) {
      try {
        workDir = await mkdtemp(path.join(os.tmpdir(), 'maigret-'));
      } catch (err: any) {
        return this.createResult({
          success: false,
          durationMs: Date.now() - startTime,
          error: `Failed to create output directory: ${err.message}`,
        });
      }
    }

    context.onProgress?.(`Starting Maigret analysis for ${username}...`, 10);

    const args = [
      username,
      '--no-progressbar',
      '--no-color',
      '--no-autoupdate',
      '-J',
      'simple',
      '-H',
      '--folderoutput',
      workDir,
    ];

    if (context.options?.topSites) {
      args.push('--top-sites', String(context.options.topSites));
    } else {
      args.push('--top-sites', '500');
    }

    if (context.options?.connections) {
      args.push('-n', String(context.options.connections));
    }

    if (context.options?.timeout) {
      args.push('--timeout', String(context.options.timeout));
    }

    if (context.options?.site) {
      args.push('--site', String(context.options.site));
    }

    try {
      const execResult = await this.runCommand(this.binaryPath, args, {
        cwd: workDir,
        timeoutMs: context.options?.timeoutMs ?? this.defaultTimeoutMs,
        signal: context.signal,
        onStdoutLine: (line) => {
          context.onProgress?.(`Maigret: ${line.trim()}`);
        },
      });

      const jsonPath = path.join(workDir, `report_${username}_simple.json`);
      const htmlPath = path.join(workDir, `report_${username}_plain.html`);

      let accounts: UnifiedAccount[] = [];

      if (existsSync(jsonPath)) {
        const jsonContent = await readFile(jsonPath, 'utf-8');
        try {
          const parsed = JSON.parse(jsonContent);
          accounts = this.parseJsonOutput(parsed, username);
        } catch (jsonErr: any) {
          context.onProgress?.(`Warning: Failed to parse Maigret JSON: ${jsonErr.message}`);
        }
      }

      const reportPaths: { json?: string; html?: string } = {};
      if (existsSync(jsonPath)) reportPaths.json = jsonPath;
      if (existsSync(htmlPath)) reportPaths.html = htmlPath;

      const isSuccess = execResult.exitCode === 0 || accounts.length > 0;

      if (!isSuccess) {
        return this.createResult({
          success: false,
          durationMs: execResult.durationMs,
          error: execResult.stderr || `Maigret failed with exit code ${execResult.exitCode}`,
          rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        });
      }

      context.onProgress?.(
        `Maigret completed: ${accounts.length} profile(s) found.`,
        100
      );

      return this.createResult({
        success: true,
        durationMs: execResult.durationMs,
        rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        accounts,
        reportPaths: Object.keys(reportPaths).length > 0 ? reportPaths : undefined,
      });
    } catch (err: any) {
      return this.createResult({
        success: false,
        durationMs: Date.now() - startTime,
        error: err?.message ?? 'Maigret execution error',
      });
    }
  }

  /**
   * Parse Maigret simple JSON structure
   */
  parseJsonOutput(data: Record<string, any>, targetUsername: string): UnifiedAccount[] {
    if (!data || typeof data !== 'object') {
      return [];
    }

    const accounts: UnifiedAccount[] = [];

    for (const [key, siteData] of Object.entries(data)) {
      if (!siteData || typeof siteData !== 'object') continue;

      const statusObj = siteData.status;
      const status = statusObj?.status;
      if (status !== 'Claimed') continue;

      const siteName = statusObj?.site_name || key;
      const serviceName = siteName;
      const serviceId = siteName.toLowerCase().trim();
      const profileUrl = siteData.url_user || statusObj?.url;
      const urlMain = siteData.url_main;

      const domain = this.extractDomain(urlMain, profileUrl);
      const avatarUrl = statusObj?.ids?.image;

      accounts.push({
        id: `maigret_${serviceId}_${Buffer.from(targetUsername).toString('hex').slice(0, 8)}`,
        serviceId,
        serviceName,
        domain,
        accountIdentifier: targetUsername,
        sourceTool: 'maigret',
        status: 'claimed',
        profileUrl,
        avatarUrl,
        metadata: {
          ids: statusObj?.ids,
          tags: statusObj?.tags,
          rank: siteData.rank,
          httpStatus: siteData.http_status,
        },
        cleaned: false,
      });
    }

    return accounts;
  }

  private extractDomain(urlMain?: string, profileUrl?: string): string {
    const rawUrl = urlMain || profileUrl;
    if (!rawUrl) return '';
    try {
      const parsed = new URL(rawUrl);
      return parsed.hostname.replace(/^www\./i, '');
    } catch {
      return rawUrl.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '');
    }
  }
}
