import { describe, it, expect, vi } from 'vitest';
import { IgnorantAdapter } from '../../../src/core/adapters/ignorant.js';

describe('IgnorantAdapter', () => {
  describe('parsePhoneNumber', () => {
    it('strips leading + and cleans country code (preventing Snapchat KeyError)', () => {
      const parsed = IgnorantAdapter.parsePhoneNumber('+33612345678');
      expect(parsed).not.toBeNull();
      expect(parsed?.countryCode).toBe('33'); // No '+' sign
      expect(parsed?.nationalNumber).toBe('612345678');
      expect(parsed?.fullInternational).toBe('+33612345678');
    });

    it('formats French local 10-digit numbers starting with 0', () => {
      const parsed = IgnorantAdapter.parsePhoneNumber('06 12 34 56 78');
      expect(parsed).not.toBeNull();
      expect(parsed?.countryCode).toBe('33');
      expect(parsed?.nationalNumber).toBe('612345678');
    });

    it('handles international numbers with spaces and parentheses', () => {
      const parsed = IgnorantAdapter.parsePhoneNumber('+1 (555) 123-4567');
      expect(parsed).not.toBeNull();
      expect(parsed?.countryCode).toBe('1');
      expect(parsed?.nationalNumber).toBe('5551234567');
    });

    it('accepts explicit countryCode and nationalNumber options', () => {
      const parsed = IgnorantAdapter.parsePhoneNumber(undefined, {
        countryCode: '+49',
        nationalNumber: '015112345678',
      });
      expect(parsed).not.toBeNull();
      expect(parsed?.countryCode).toBe('49'); // Stripped '+'
      expect(parsed?.nationalNumber).toBe('15112345678'); // Stripped leading 0
    });

    it('returns null for invalid or empty inputs', () => {
      expect(IgnorantAdapter.parsePhoneNumber('')).toBeNull();
      expect(IgnorantAdapter.parsePhoneNumber('abc')).toBeNull();
    });
  });

  describe('execute', () => {
    it('executes CLI with pure numeric arguments and parses stdout statuses', async () => {
      let capturedArgs: string[] = [];

      const mockRunner = vi.fn().mockImplementation(async (_cmd, args) => {
        capturedArgs = args;
        return {
          exitCode: 0,
          stdout:
            `[+] Snapchat\n` +
            `[-] Amazon\n` +
            `[x] Instagram\n`,
          stderr: '',
          durationMs: 80,
          timedOut: false,
        };
      });

      const adapter = new IgnorantAdapter({
        binaryPath: '/mock/ignorant',
        customRunner: mockRunner,
      });

      const result = await adapter.execute({
        phone: '+33 6 12 34 56 78',
      });

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('ignorant');

      // Check args passed to ignorant
      expect(capturedArgs[0]).toBe('33'); // Must NOT be '+33'
      expect(capturedArgs[1]).toBe('612345678'); // Stripped leading 0
      expect(capturedArgs).toContain('--only-used');
      expect(capturedArgs).toContain('--no-clear');
      expect(capturedArgs).toContain('--no-color');

      // Check accounts parsed
      expect(result.accounts).toHaveLength(2); // Snapchat (claimed) and Instagram (rate_limited)

      const snapchat = result.accounts.find((a) => a.serviceId === 'snapchat');
      expect(snapchat).toBeDefined();
      expect(snapchat?.serviceName).toBe('Snapchat');
      expect(snapchat?.domain).toBe('snapchat.com');
      expect(snapchat?.status).toBe('claimed');

      const instagram = result.accounts.find((a) => a.serviceId === 'instagram');
      expect(instagram).toBeDefined();
      expect(instagram?.status).toBe('rate_limited');
      expect(instagram?.metadata.rateLimited).toBe(true);
    });

    it('returns failure when phone number is missing or cannot be parsed', async () => {
      const adapter = new IgnorantAdapter();
      const result = await adapter.execute({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('valid phone number');
    });
  });
});
