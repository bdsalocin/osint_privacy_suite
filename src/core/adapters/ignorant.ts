import os from 'node:os';
/**
 * Ignorant OSINT Tool Adapter
 * Checks if a phone number is registered on Snapchat, Instagram, Amazon, etc.
 */

import { BaseAdapter, BaseAdapterOptions } from './base-adapter.js';
import {
  SupportedTool,
  ToolExecutionContext,
  ToolHealth,
  ToolResult,
  UnifiedAccount,
} from '../types.js';

export interface ParsedPhone {
  countryCode: string;
  nationalNumber: string;
  fullInternational: string;
}

export class IgnorantAdapter extends BaseAdapter {
  readonly name: SupportedTool = 'ignorant';

  constructor(options: BaseAdapterOptions = {}) {
    super({
      binaryPath: options.binaryPath ?? `${os.homedir()}/.local/bin/ignorant`,
      customRunner: options.customRunner,
      defaultTimeoutMs: options.defaultTimeoutMs ?? 20_000,
    });
  }

  async checkHealth(): Promise<ToolHealth> {
    const isExe = await this.isExecutable(this.binaryPath);
    if (!isExe) {
      return {
        installed: false,
        path: this.binaryPath,
        error: `Ignorant binary not found or not executable at ${this.binaryPath}`,
      };
    }

    try {
      const res = await this.runCommand(this.binaryPath, ['--help'], { timeoutMs: 5_000 });
      if (res.exitCode === 0 || res.stdout.includes('ignorant') || res.stdout.includes('country_code')) {
        return {
          installed: true,
          path: this.binaryPath,
          version: 'v1.2',
        };
      }
      return {
        installed: false,
        path: this.binaryPath,
        error: `Unexpected output from ignorant --help: ${res.stderr || res.stdout}`,
      };
    } catch (err: any) {
      return {
        installed: false,
        path: this.binaryPath,
        error: err?.message ?? 'Health check failed',
      };
    }
  }

  /**
   * Normalize phone number to pure digits countryCode and nationalNumber
   * Mandatory: countryCode MUST NOT contain '+' (causes KeyError in Snapchat module)
   */
  static parsePhoneNumber(
    phoneInput?: string,
    options?: { countryCode?: string; nationalNumber?: string }
  ): ParsedPhone | null {
    if (options?.countryCode && options?.nationalNumber) {
      const cc = options.countryCode.replace(/\D/g, '');
      let nat = options.nationalNumber.replace(/\D/g, '');
      if (nat.startsWith('0')) nat = nat.substring(1);
      if (cc && nat) {
        return {
          countryCode: cc,
          nationalNumber: nat,
          fullInternational: `+${cc}${nat}`,
        };
      }
    }

    if (!phoneInput) return null;

    let clean = phoneInput.trim().replace(/[\s\-\.\(\)]/g, '');
    if (clean.startsWith('00')) {
      clean = clean.substring(2);
    } else if (clean.startsWith('+')) {
      clean = clean.substring(1);
    }

    // Pure digits only
    clean = clean.replace(/\D/g, '');
    if (!clean) return null;

    // French numbers starting with 0 (e.g. 0612345678 or 0712345678)
    if (clean.startsWith('0') && clean.length === 10) {
      return {
        countryCode: '33',
        nationalNumber: clean.substring(1),
        fullInternational: `+33${clean.substring(1)}`,
      };
    }

    // Common country codes
    const commonPrefixes = [
      '33', // France
      '1',  // US / Canada
      '44', // UK
      '49', // Germany
      '34', // Spain
      '39', // Italy
      '32', // Belgium
      '41', // Switzerland
      '31', // Netherlands
      '351', // Portugal
      '212', // Morocco
      '213', // Algeria
      '216', // Tunisia
      '221', // Senegal
      '225', // Ivory Coast
    ];

    for (const prefix of commonPrefixes) {
      if (clean.startsWith(prefix) && clean.length > prefix.length + 5) {
        let nat = clean.substring(prefix.length);
        if (nat.startsWith('0')) nat = nat.substring(1);
        return {
          countryCode: prefix,
          nationalNumber: nat,
          fullInternational: `+${prefix}${nat}`,
        };
      }
    }

    // Fallback: if length is 11 or 12 and starts with 33
    if (clean.startsWith('33') && clean.length >= 11) {
      let nat = clean.substring(2);
      if (nat.startsWith('0')) nat = nat.substring(1);
      return {
        countryCode: '33',
        nationalNumber: nat,
        fullInternational: `+33${nat}`,
      };
    }

    // Default split if no prefix matched: assume first 2 digits cc if length >= 10
    if (clean.length >= 10) {
      const cc = clean.substring(0, 2);
      let nat = clean.substring(2);
      if (nat.startsWith('0')) nat = nat.substring(1);
      return {
        countryCode: cc,
        nationalNumber: nat,
        fullInternational: `+${cc}${nat}`,
      };
    }

    return null;
  }

  async execute(context: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const parsed = IgnorantAdapter.parsePhoneNumber(context.phone, context.options);

    if (!parsed) {
      return this.createResult({
        success: false,
        durationMs: 0,
        error: 'Ignorant requires a valid phone number with identifiable country code',
      });
    }

    context.onProgress?.(
      `Starting Ignorant analysis for +${parsed.countryCode} ${parsed.nationalNumber}...`,
      10
    );

    const args = [
      parsed.countryCode,
      parsed.nationalNumber,
      '--only-used',
      '--no-clear',
      '--no-color',
    ];

    if (context.options?.timeout) {
      args.push('-T', String(context.options.timeout));
    }

    try {
      const execResult = await this.runCommand(this.binaryPath, args, {
        timeoutMs: context.options?.timeoutMs ?? this.defaultTimeoutMs,
        signal: context.signal,
        onStdoutLine: (line) => {
          context.onProgress?.(`Ignorant: ${line.trim()}`);
        },
      });

      const accounts = this.parseStdout(execResult.stdout, parsed.fullInternational);

      // Ignorant returns 0 on success
      if (execResult.exitCode !== 0 && accounts.length === 0) {
        return this.createResult({
          success: false,
          durationMs: execResult.durationMs,
          error: execResult.stderr || `Ignorant failed with exit code ${execResult.exitCode}`,
          rawOutput: { stdout: execResult.stdout, stderr: execResult.stderr },
        });
      }

      context.onProgress?.(
        `Ignorant completed: ${accounts.length} service(s) identified.`,
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
        error: err?.message ?? 'Ignorant execution error',
      });
    }
  }

  /**
   * Parse stdout markers:
   * [+] ServiceName -> Claimed
   * [-] ServiceName -> Unclaimed
   * [x] ServiceName -> Rate limited / error
   */
  parseStdout(stdout: string, phoneIdentifier: string): UnifiedAccount[] {
    const lines = stdout.split('\n');
    const accounts: UnifiedAccount[] = [];

    const serviceDomains: Record<string, { name: string; domain: string }> = {
      snapchat: { name: 'Snapchat', domain: 'snapchat.com' },
      instagram: { name: 'Instagram', domain: 'instagram.com' },
      amazon: { name: 'Amazon', domain: 'amazon.com' },
      whatsapp: { name: 'WhatsApp', domain: 'whatsapp.com' },
      telegram: { name: 'Telegram', domain: 'telegram.org' },
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // [+] Snapchat or [+] snapchat.com
      const claimedMatch = line.match(/^\[\+\]\s*([a-zA-Z0-9_\-\.]+)/i);
      const rateLimitedMatch = line.match(/^\[x\]\s*([a-zA-Z0-9_\-\.]+)/i);

      if (claimedMatch) {
        const rawService = claimedMatch[1].toLowerCase().replace(/\.com$/, '');
        const meta = serviceDomains[rawService] ?? {
          name: rawService.charAt(0).toUpperCase() + rawService.slice(1),
          domain: `${rawService}.com`,
        };

        accounts.push({
          id: `ignorant_${rawService}_${Buffer.from(phoneIdentifier).toString('hex').slice(0, 8)}`,
          serviceId: rawService,
          serviceName: meta.name,
          domain: meta.domain,
          accountIdentifier: phoneIdentifier,
          sourceTool: 'ignorant',
          status: 'claimed',
          metadata: {
            detectionMethod: 'phone_lookup',
            rawOutput: line,
          },
          cleaned: false,
        });
      } else if (rateLimitedMatch) {
        const rawService = rateLimitedMatch[1].toLowerCase().replace(/\.com$/, '');
        const meta = serviceDomains[rawService] ?? {
          name: rawService.charAt(0).toUpperCase() + rawService.slice(1),
          domain: `${rawService}.com`,
        };

        accounts.push({
          id: `ignorant_${rawService}_${Buffer.from(phoneIdentifier).toString('hex').slice(0, 8)}`,
          serviceId: rawService,
          serviceName: meta.name,
          domain: meta.domain,
          accountIdentifier: phoneIdentifier,
          sourceTool: 'ignorant',
          status: 'rate_limited',
          metadata: {
            detectionMethod: 'phone_lookup',
            rawOutput: line,
            rateLimited: true,
          },
          cleaned: false,
        });
      }
    }

    return accounts;
  }
}
