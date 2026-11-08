/**
 * Base OSINT Tool Adapter
 */

import os from 'node:os';
import { ChildProcess, spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  IToolAdapter,
  SupportedTool,
  ToolExecutionContext,
  ToolHealth,
  ToolResult,
  UnifiedAccount,
  UnifiedLeak,
} from '../types.js';

export interface CommandExecutionOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  allowedExitCodes?: number[];
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  signal?: AbortSignal;
}

export interface CommandExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandExecutionOptions
) => Promise<CommandExecutionResult>;

export interface BaseAdapterOptions {
  binaryPath?: string;
  customRunner?: CommandRunner;
  defaultTimeoutMs?: number;
}

export abstract class BaseAdapter implements IToolAdapter {
  abstract readonly name: SupportedTool;
  protected binaryPath: string;
  protected customRunner?: CommandRunner;
  protected defaultTimeoutMs: number;
  protected activeProcesses = new Set<ChildProcess>();

  constructor(options: BaseAdapterOptions = {}) {
    this.binaryPath = options.binaryPath ?? '';
    this.customRunner = options.customRunner;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
  }

  public abort(signal: NodeJS.Signals = 'SIGTERM'): void {
    this.abortActiveProcesses(signal);
  }

  public abortActiveProcesses(signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const child of this.activeProcesses) {
      let hasExited = child.exitCode !== null || child.signalCode !== null;
      child.once('exit', () => {
        hasExited = true;
      });

      try {
        child.kill(signal);
      } catch {}

      setTimeout(() => {
        if (!hasExited && child.exitCode === null && child.signalCode === null) {
          try {
            if (child.pid) {
              process.kill(child.pid, 0);
              child.kill('SIGKILL');
            }
          } catch {}
        }
      }, 500);
    }
    this.activeProcesses.clear();
  }

  abstract checkHealth(): Promise<ToolHealth>;
  abstract execute(context: ToolExecutionContext): Promise<ToolResult>;

  /**
   * Helper to check if a file exists and is executable
   */
  protected async isExecutable(filePath: string): Promise<boolean> {
    if (!filePath || !existsSync(filePath)) {
      return false;
    }
    try {
      await access(filePath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute command using child_process.spawn or injected runner
   */
  protected async runCommand(
    command: string,
    args: string[],
    options: CommandExecutionOptions = {}
  ): Promise<CommandExecutionResult> {
    if (this.customRunner) {
      return this.customRunner(command, args, options);
    }

    if (options.signal?.aborted) {
      return {
        exitCode: -1,
        stdout: '',
        stderr: 'Execution cancelled by user',
        durationMs: 0,
        timedOut: false,
      };
    }

    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:${os.homedir()}/.local/bin:${process.env.PATH || ''}`,
      ...options.env,
    };

    return new Promise<CommandExecutionResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let killed = false;

      const child = spawn(command, args, {
        cwd: options.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcesses.add(child);

      let hasExited = false;
      child.once('exit', () => {
        hasExited = true;
      });

      const killWithEscalation = (sig: NodeJS.Signals = 'SIGTERM') => {
        killed = true;
        try {
          child.kill(sig);
        } catch {}
        setTimeout(() => {
          if (!hasExited && child.exitCode === null && child.signalCode === null) {
            try {
              if (child.pid) {
                process.kill(child.pid, 0);
                child.kill('SIGKILL');
              }
            } catch {}
          }
        }, 500);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killWithEscalation('SIGTERM');
      }, timeoutMs);

      let abortListener: (() => void) | undefined;
      if (options.signal) {
        abortListener = () => {
          killWithEscalation('SIGTERM');
        };
        if (options.signal.aborted) {
          abortListener();
        } else {
          options.signal.addEventListener('abort', abortListener, { once: true });
        }
      }

      const cleanup = () => {
        clearTimeout(timer);
        this.activeProcesses.delete(child);
        if (options.signal && abortListener) {
          options.signal.removeEventListener('abort', abortListener);
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        if (options.onStdoutLine) {
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              options.onStdoutLine(line);
            }
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        if (options.onStderrLine) {
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              options.onStderrLine(line);
            }
          }
        }
      });

      child.on('error', (err) => {
        cleanup();
        resolve({
          exitCode: -1,
          stdout,
          stderr: `${stderr}\n${err.message}`.trim(),
          durationMs: Date.now() - startTime,
          timedOut,
        });
      });

      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        const exitCode =
          code ??
          (killed
            ? -1
            : signal
            ? 128 + (os.constants.signals[signal as keyof typeof os.constants.signals] ?? 0)
            : 1);
        resolve({
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
          timedOut,
        });
      });
    });
  }

  /**
   * Build a standardized ToolResult
   */
  protected createResult(params: {
    success: boolean;
    durationMs: number;
    rawOutput?: any;
    error?: string;
    accounts?: UnifiedAccount[];
    leaks?: UnifiedLeak[];
    reportPaths?: { html?: string; json?: string; csv?: string };
  }): ToolResult {
    return {
      toolName: this.name,
      success: params.success,
      durationMs: params.durationMs,
      rawOutput: params.rawOutput ?? null,
      error: params.error,
      accounts: params.accounts ?? [],
      leaks: params.leaks ?? [],
      reportPaths: params.reportPaths,
    };
  }
}
