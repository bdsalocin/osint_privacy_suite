/**
 * Holehe OSINT Tool Adapter
 * Checks email registration across ~120 online services
 */

import { readdir, readFile, rm } from 'node:fs/promises';
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

export class HoleheAdapter extends BaseAdapter {
  readonly name: SupportedTool = 'holehe';

  constructor(options: BaseAdapterOptions = {}) {
    super({
      binaryPath: options.binaryPath ?? `${os.homedir()}/.local/bin/holehe`,
      customRunner: options.customRunner,
      defaultTimeoutMs: options.defaultTimeoutMs ?? 45_000,
    });
  }

  async checkHealth(): Promise<ToolHealth> {
    const isExe = await this.isExecutable(this.binaryPath);
    if (!isExe) {
      return {
        installed: false,
        path: this.binaryPath,
        error: `Holehe binary not found or not executable at ${this.binaryPath}`,
      };
    }

    try {
      const res = await this.runCommand(this.binaryPath, ['--help'], { timeoutMs: 5_000 });
      if (res.exitCode === 0 || res.stdout.includes('holehe') || res.stderr.includes('holehe')) {
        return {
          installed: true,
          path: this.binaryPath,
          version: 'latest',
        };
      }
      return {
        installed: false,
        path: this.binaryPath,
        error: `Unexpected exit output: ${res.stderr || res.stdout}`,
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
    const email = context.email?.trim();

    if (!email || !email.includes('@')) {
      return this.createResult({
        success: false,
        durationMs: 0,
        error: 'Holehe requires a valid email address target',
      });
    }

    // Prepare temporary directory for CSV export
    let workDir = context.options?.outputDir;
    let tempDirCreated = false;
    if (!workDir) {
      try {
        workDir = await mkdtemp(path.join(os.tmpdir(), 'holehe-'));
        tempDirCreated = true;
      } catch (err: any) {
        return this.createResult({
          success: false,
          durationMs: Date.now() - startTime,
          error: `Failed to create temporary directory: ${err.message}`,
        });
      }
    }

    context.onProgress?.(`Starting Holehe analysis for ${email}...`, 10);

    const args = [
      email,
      '--only-used',
      '--no-clear',
      '--no-color',
      '-C',
    ];

    if (context.options?.noPasswordRecovery) {
      args.push('-NP');
    }
    if (context.options?.timeout) {
      args.push('-T', String(context.options.timeout));
    }

    try {
      const execResult = await this.runCommand(this.binaryPath, args, {
        cwd: workDir,
        timeoutMs: context.options?.timeoutMs ?? this.defaultTimeoutMs,
        signal: context.signal,
        onStdoutLine: (line) => {
          context.onProgress?.(`Holehe: ${line.trim()}`);
        },
      });

      // Find generated CSV file in workDir
      const files = await readdir(workDir);
      const csvFile = files.find(
        (f) => f.startsWith('holehe_') && f.endsWith('.csv')
      );

      let accounts: UnifiedAccount[] = [];
      let csvPath: string | undefined;

      if (csvFile) {
        csvPath = path.join(workDir, csvFile);
        const csvContent = await readFile(csvPath, 'utf-8');
        accounts = this.parseCsvOutput(csvContent, email);
      }

      // Holehe exits with code 1 after exporting CSV due to exit() in core.py
      const isSuccess = csvFile !== undefined || execResult.exitCode === 0;

      if (!isSuccess && execResult.exitCode !== 0) {
        return this.createResult({
          success: false,
          durationMs: execResult.durationMs,
          error: execResult.stderr || `Holehe failed with exit code ${execResult.exitCode}`,
          rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        });
      }

      context.onProgress?.(
        `Holehe completed: ${accounts.length} claimed account(s) found.`,
        100
      );

      return this.createResult({
        success: true,
        durationMs: execResult.durationMs,
        rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        accounts,
        reportPaths: csvPath ? { csv: csvPath } : undefined,
      });
    } catch (err: any) {
      return this.createResult({
        success: false,
        durationMs: Date.now() - startTime,
        error: err?.message ?? 'Holehe execution error',
      });
    } finally {
      // Do not delete tempDir if user requested reports or if csv was kept
      // Cleanup only if empty or explicitly requested
    }
  }

  /**
   * Parse CSV generated by Holehe
   * Headers: name,domain,rateLimit,exists,emailrecovery,phoneNumber,others
   */
  parseCsvOutput(csvContent: string, targetEmail: string): UnifiedAccount[] {
    const lines = csvContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length <= 1) {
      return [];
    }

    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const nameIdx = header.indexOf('name');
    const domainIdx = header.indexOf('domain');
    const rateLimitIdx = header.indexOf('ratelimit');
    const existsIdx = header.indexOf('exists');
    const emailRecIdx = header.indexOf('emailrecovery');
    const phoneIdx = header.indexOf('phonenumber');
    const othersIdx = header.indexOf('others');

    const accounts: UnifiedAccount[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = this.parseCsvLine(lines[i]);
      if (parts.length < 4) continue;

      const rawName = parts[nameIdx] ?? '';
      const domain = parts[domainIdx] ?? '';
      const rateLimitStr = parts[rateLimitIdx] ?? 'false';
      const existsStr = parts[existsIdx] ?? 'false';
      const emailRecovery = parts[emailRecIdx] !== 'null' ? parts[emailRecIdx] : undefined;
      const phoneNumber = parts[phoneIdx] !== 'null' ? parts[phoneIdx] : undefined;
      const others = parts[othersIdx] !== 'null' ? parts[othersIdx] : undefined;

      const isClaimed = existsStr.toLowerCase() === 'true';
      const isRateLimited = rateLimitStr.toLowerCase() === 'true';

      if (isClaimed) {
        const serviceId = rawName.toLowerCase().trim();
        const serviceName = this.formatServiceName(rawName);

        accounts.push({
          id: `holehe_${serviceId}_${Buffer.from(targetEmail).toString('hex').slice(0, 8)}`,
          serviceId,
          serviceName,
          domain: domain.trim(),
          accountIdentifier: targetEmail,
          sourceTool: 'holehe',
          status: 'claimed',
          metadata: {
            rateLimit: isRateLimited,
            emailRecovery,
            phoneNumber,
            others,
          },
          cleaned: false,
        });
      }
    }

    return accounts;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  private formatServiceName(name: string): string {
    if (!name) return '';
    const knownNames: Record<string, string> = {
      github: 'GitHub',
      twitter: 'Twitter / X',
      x: 'Twitter / X',
      spotify: 'Spotify',
      discord: 'Discord',
      amazon: 'Amazon',
      instagram: 'Instagram',
      snapchat: 'Snapchat',
      google: 'Google',
      pinterest: 'Pinterest',
      linkedin: 'LinkedIn',
      reddit: 'Reddit',
      adobe: 'Adobe',
      steam: 'Steam',
      dropbox: 'Dropbox',
      netflix: 'Netflix',
    };

    const lower = name.toLowerCase();
    if (knownNames[lower]) {
      return knownNames[lower];
    }
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
}
