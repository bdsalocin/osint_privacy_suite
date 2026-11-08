import os from 'node:os';
/**
 * SpiderFoot OSINT Tool Adapter
 * Automated OSINT collection and multi-source correlation engine
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { BaseAdapter, BaseAdapterOptions } from './base-adapter.js';
import {
  SupportedTool,
  ToolExecutionContext,
  ToolHealth,
  ToolResult,
  UnifiedAccount,
  UnifiedLeak,
} from '../types.js';

export interface SpiderfootAdapterOptions extends BaseAdapterOptions {
  spiderfootDir?: string;
  pythonBinary?: string;
}

export class SpiderfootAdapter extends BaseAdapter {
  readonly name: SupportedTool = 'spiderfoot';
  private spiderfootDir: string;

  constructor(options: SpiderfootAdapterOptions = {}) {
    const dir = options.spiderfootDir ?? `${os.homedir()}/osint-perso/spiderfoot`;
    const py = options.pythonBinary ?? path.join(dir, 'venv', 'bin', 'python');

    super({
      binaryPath: py,
      customRunner: options.customRunner,
      defaultTimeoutMs: options.defaultTimeoutMs ?? 60_000,
    });
    this.spiderfootDir = dir;
  }

  async checkHealth(): Promise<ToolHealth> {
    const dirExists = existsSync(this.spiderfootDir);
    const scriptExists = existsSync(path.join(this.spiderfootDir, 'sf.py'));
    const isExe = await this.isExecutable(this.binaryPath);

    if (!dirExists || !scriptExists || !isExe) {
      return {
        installed: false,
        path: this.binaryPath,
        error: `SpiderFoot installation incomplete at ${this.spiderfootDir}`,
      };
    }

    try {
      const res = await this.runCommand(
        this.binaryPath,
        ['sf.py', '--help'],
        {
          cwd: this.spiderfootDir,
          timeoutMs: 5_000,
        }
      );

      if (res.exitCode === 0 || res.stdout.includes('SpiderFoot') || res.stdout.includes('sf.py')) {
        return {
          installed: true,
          path: this.binaryPath,
          version: '4.0.0',
        };
      }

      return {
        installed: false,
        path: this.binaryPath,
        error: `Unexpected output from SpiderFoot: ${res.stderr || res.stdout}`,
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
    const target =
      context.email?.trim() ||
      context.username?.trim() ||
      context.phone?.trim() ||
      context.options?.domain?.trim();

    if (!target) {
      return this.createResult({
        success: false,
        durationMs: 0,
        error: 'SpiderFoot requires an email, username, phone, or domain target',
      });
    }

    context.onProgress?.(`Starting SpiderFoot passive scan for ${target}...`, 10);

    const args = [
      'sf.py',
      '-s',
      target,
      '-u',
      'passive',
      '-o',
      'json',
      '-q',
    ];

    if (context.options?.modules) {
      args.push('-m', String(context.options.modules));
    }

    if (context.options?.maxThreads) {
      args.push('-max-threads', String(context.options.maxThreads));
    }

    try {
      const execResult = await this.runCommand(this.binaryPath, args, {
        cwd: this.spiderfootDir, // Mandatory cwd to avoid ModuleNotFoundError
        env: {
          PYTHONPATH: this.spiderfootDir,
        },
        timeoutMs: context.options?.timeoutMs ?? this.defaultTimeoutMs,
        signal: context.signal,
        onStdoutLine: (line) => {
          context.onProgress?.(`SpiderFoot: ${line.trim()}`);
        },
      });

      const { accounts, leaks } = this.parseJsonStdout(execResult.stdout, target);

      const isSuccess = execResult.exitCode === 0 || accounts.length > 0 || leaks.length > 0;

      if (!isSuccess && execResult.exitCode !== 0) {
        return this.createResult({
          success: false,
          durationMs: execResult.durationMs,
          error: execResult.stderr || `SpiderFoot failed with exit code ${execResult.exitCode}`,
          rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        });
      }

      context.onProgress?.(
        `SpiderFoot completed: ${accounts.length} account(s), ${leaks.length} leak(s).`,
        100
      );

      return this.createResult({
        success: true,
        durationMs: execResult.durationMs,
        rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        accounts,
        leaks,
      });
    } catch (err: any) {
      return this.createResult({
        success: false,
        durationMs: Date.now() - startTime,
        error: err?.message ?? 'SpiderFoot execution error',
      });
    }
  }

  /**
   * Parse stdout JSON array from SpiderFoot:
   * [ { "generated": 1794169979, "type": "...", "data": "...", "module": "...", "source": "..." } ]
   */
  parseJsonStdout(
    stdout: string,
    target: string
  ): { accounts: UnifiedAccount[]; leaks: UnifiedLeak[] } {
    const accounts: UnifiedAccount[] = [];
    const leaks: UnifiedLeak[] = [];

    if (!stdout || !stdout.trim()) {
      return { accounts, leaks };
    }

    // Extract JSON block (SpiderFoot outputs JSON array, often preceded/followed by [INFO] / banner logs)
    let items: any[] = [];
    let foundArray = false;

    // Fast-path: Match JSON array pattern [ ... ] ignoring external log lines
    const arrayMatch = stdout.match(/\[\s*(?:\{[\s\S]*\}|)\s*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) {
          items = parsed;
          foundArray = true;
        }
      } catch {
        // Fallback to iterative bracket search
      }
    }

    // Fallback: search backwards from candidate start brackets '[{' or '[]'
    if (!foundArray) {
      const startRegex = /\[\s*(?:\{|\])/g;
      let startMatch: RegExpExecArray | null;
      while ((startMatch = startRegex.exec(stdout)) !== null) {
        const startIdx = startMatch.index;
        let endIdx = stdout.lastIndexOf(']');
        while (endIdx > startIdx) {
          try {
            const candidate = JSON.parse(stdout.substring(startIdx, endIdx + 1));
            if (Array.isArray(candidate)) {
              items = candidate;
              foundArray = true;
              break;
            }
          } catch {}
          endIdx = stdout.lastIndexOf(']', endIdx - 1);
        }
        if (foundArray) break;
      }
    }

    if (!foundArray || !Array.isArray(items)) {
      return { accounts, leaks };
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== 'object') continue;

      const type = String(item.type || '').toUpperCase();
      const data = String(item.data || '');
      const module = String(item.module || '');
      const source = String(item.source || '');

      // Identify accounts (e.g. "Account on External Site", "SOCIAL_MEDIA", or URL from sfp_accounts)
      if (
        type.includes('ACCOUNT') ||
        type.includes('SOCIAL_MEDIA') ||
        module === 'sfp_accounts' ||
        module === 'sfp_social'
      ) {
        const domain =
          this.extractDomainFromData(data) ||
          this.cleanDomain(source) ||
          'unknown';
        const serviceId = this.extractServiceId(domain, data);
        const serviceName = this.formatServiceName(serviceId);
        const profileUrl = data.startsWith('http')
          ? data
          : (data.match(/https?:\/\/[^\s\)]+/)?.[0]);

        accounts.push({
          id: `sf_account_${serviceId}_${i}_${Buffer.from(target).toString('hex').slice(0, 8)}`,
          serviceId,
          serviceName,
          domain,
          accountIdentifier: target,
          sourceTool: 'spiderfoot',
          status: 'claimed',
          profileUrl,
          metadata: {
            module,
            type: item.type,
            source,
            rawItem: item,
          },
          cleaned: false,
        });
      }

      // Identify leaks / breaches
      if (
        type.includes('LEAK') ||
        type.includes('BREACH') ||
        type.includes('PASSWORD') ||
        type.includes('COMPROMISED') ||
        module.includes('pwned') ||
        module.includes('leak')
      ) {
        leaks.push({
          id: `sf_leak_${i}_${Buffer.from(target).toString('hex').slice(0, 8)}`,
          target,
          sourceTool: 'spiderfoot',
          breachName: source || module || 'SpiderFoot Correlation',
          dataClasses: ['credentials'],
          details: data,
        });
      }
    }

    return { accounts, leaks };
  }

  private cleanDomain(raw: string): string {
    if (!raw) return '';
    try {
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        const u = new URL(raw);
        return u.hostname.replace(/^www\./i, '').toLowerCase();
      }
    } catch {}
    return raw.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').toLowerCase();
  }

  private extractDomainFromData(data: string): string {
    if (data.startsWith('http://') || data.startsWith('https://')) {
      try {
        const u = new URL(data);
        return u.hostname.replace(/^www\./i, '');
      } catch {
        return '';
      }
    }
    return '';
  }

  private extractServiceId(domain: string, data: string): string {
    if (domain && domain !== 'unknown') {
      const parts = domain.split('.');
      if (parts.length >= 2) {
        return parts[parts.length - 2].toLowerCase();
      }
      return domain.toLowerCase();
    }
    return 'external_service';
  }

  private formatServiceName(serviceId: string): string {
    if (!serviceId) return 'External Service';
    const known: Record<string, string> = {
      github: 'GitHub',
      twitter: 'Twitter / X',
      x: 'Twitter / X',
      linkedin: 'LinkedIn',
      facebook: 'Facebook',
      instagram: 'Instagram',
      reddit: 'Reddit',
      google: 'Google',
      youtube: 'YouTube',
    };
    return known[serviceId.toLowerCase()] ?? (serviceId.charAt(0).toUpperCase() + serviceId.slice(1));
  }
}
