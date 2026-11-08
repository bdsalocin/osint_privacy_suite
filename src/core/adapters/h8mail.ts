/**
 * h8mail OSINT Tool Adapter
 * Finds compromised credentials and breach data for email addresses
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
  UnifiedLeak,
} from '../types.js';

export class H8mailAdapter extends BaseAdapter {
  readonly name: SupportedTool = 'h8mail';

  constructor(options: BaseAdapterOptions = {}) {
    super({
      binaryPath: options.binaryPath ?? `${os.homedir()}/.local/bin/h8mail`,
      customRunner: options.customRunner,
      defaultTimeoutMs: options.defaultTimeoutMs ?? 30_000,
    });
  }

  async checkHealth(): Promise<ToolHealth> {
    const isExe = await this.isExecutable(this.binaryPath);
    if (!isExe) {
      return {
        installed: false,
        path: this.binaryPath,
        error: `h8mail binary not found or not executable at ${this.binaryPath}`,
      };
    }

    try {
      const res = await this.runCommand(this.binaryPath, ['--version'], { timeoutMs: 5_000 });
      const versionMatch = (res.stdout + ' ' + res.stderr).match(/(\d+\.\d+(\.\d+)?)/);
      return {
        installed: true,
        path: this.binaryPath,
        version: versionMatch ? versionMatch[0] : '2.5.6',
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
    const target = context.email?.trim() || context.username?.trim();

    if (!target) {
      return this.createResult({
        success: false,
        durationMs: 0,
        error: 'h8mail requires an email or username target',
      });
    }

    let workDir = context.options?.outputDir;
    if (!workDir) {
      try {
        workDir = await mkdtemp(path.join(os.tmpdir(), 'h8mail-'));
      } catch (err: any) {
        return this.createResult({
          success: false,
          durationMs: Date.now() - startTime,
          error: `Failed to create output directory: ${err.message}`,
        });
      }
    }

    const jsonPath = path.join(workDir, `h8mail_${Date.now()}.json`);

    context.onProgress?.(`Starting h8mail breach search for ${target}...`, 10);

    const args = [
      '-t',
      target,
      '-j',
      jsonPath,
      '-sk', // Essential: skip Scylla / HunterIO defaults to avoid hanging on obsolete services
      '--hide',
    ];

    if (context.options?.apiKeys) {
      args.push('-k', String(context.options.apiKeys));
    }

    if (context.options?.configFile) {
      args.push('-c', String(context.options.configFile));
    }

    try {
      const execResult = await this.runCommand(this.binaryPath, args, {
        cwd: workDir,
        timeoutMs: context.options?.timeoutMs ?? this.defaultTimeoutMs,
        signal: context.signal,
        onStdoutLine: (line) => {
          context.onProgress?.(`h8mail: ${line.trim()}`);
        },
      });

      let leaks: UnifiedLeak[] = [];

      if (existsSync(jsonPath)) {
        const jsonContent = await readFile(jsonPath, 'utf-8');
        try {
          const parsed = JSON.parse(jsonContent);
          leaks = this.parseJsonOutput(parsed, target);
        } catch (jsonErr: any) {
          context.onProgress?.(`Warning: Failed to parse h8mail JSON: ${jsonErr.message}`);
        }
      }

      const isSuccess = execResult.exitCode === 0 || leaks.length > 0;

      if (!isSuccess && execResult.exitCode !== 0) {
        return this.createResult({
          success: false,
          durationMs: execResult.durationMs,
          error: execResult.stderr || `h8mail failed with exit code ${execResult.exitCode}`,
          rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        });
      }

      context.onProgress?.(
        `h8mail completed: ${leaks.length} breach item(s) found.`,
        100
      );

      return this.createResult({
        success: true,
        durationMs: execResult.durationMs,
        rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        leaks,
        reportPaths: existsSync(jsonPath) ? { json: jsonPath } : undefined,
      });
    } catch (err: any) {
      return this.createResult({
        success: false,
        durationMs: Date.now() - startTime,
        error: err?.message ?? 'h8mail execution error',
      });
    }
  }

  /**
   * Parse h8mail output JSON:
   * { "targets": [ { "target": "...", "pwn_num": 1, "data": [ ["BreachName", "info"] ] } ] }
   */
  parseJsonOutput(data: any, target: string): UnifiedLeak[] {
    if (!data || typeof data !== 'object' || !Array.isArray(data.targets)) {
      return [];
    }

    const leaks: UnifiedLeak[] = [];

    for (const t of data.targets) {
      if (!t || typeof t !== 'object') continue;
      const targetIdentifier = t.target || target;
      if (!Array.isArray(t.data)) continue;

      for (let i = 0; i < t.data.length; i++) {
        const row = t.data[i];
        if (!row) continue;
        let breachName = 'Unknown Breach';
        let details = '';

        if (Array.isArray(row)) {
          breachName = String(row[0] || 'Unknown Breach');
          details = row.slice(1).join(' | ');
        } else if (typeof row === 'string') {
          breachName = row;
          details = row;
        } else if (row && typeof row === 'object') {
          breachName = row.source || row.breach || 'Unknown Breach';
          details = JSON.stringify(row);
        }

        const cleanBreach = breachName.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();

        leaks.push({
          id: `h8mail_${cleanBreach}_${i}_${Buffer.from(targetIdentifier).toString('hex').slice(0, 8)}`,
          target: targetIdentifier,
          sourceTool: 'h8mail',
          breachName,
          dataClasses: ['credentials', 'passwords'],
          details: details || `Compromise identified via ${breachName}`,
        });
      }
    }

    return leaks;
  }
}
