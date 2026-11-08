/**
 * Normalizer & Deduplication Engine
 * Unifies heterogeneous outputs from OSINT tools into standardized UnifiedAccount and UnifiedLeak models
 */

import {
  AccountStatus,
  SupportedTool,
  ToolResult,
  UnifiedAccount,
  UnifiedLeak,
} from './types.js';

export class Normalizer {
  /**
   * Normalize an incoming partial account object into a full UnifiedAccount
   */
  static normalizeAccount(raw: Partial<UnifiedAccount>): UnifiedAccount {
    const safeRaw = raw && typeof raw === 'object' ? raw : {};
    const rawService = safeRaw.serviceId || safeRaw.serviceName || 'unknown_service';
    const serviceId = rawService.toLowerCase().trim().replace(/[^a-z0-9_\-]/g, '_');
    const serviceName = safeRaw.serviceName || rawService.charAt(0).toUpperCase() + rawService.slice(1);
    const domain = this.normalizeDomain(safeRaw.domain || safeRaw.profileUrl || `${serviceId}.com`);
    const accountIdentifier = safeRaw.accountIdentifier?.trim() || '';
    const status: AccountStatus = safeRaw.status ?? 'claimed';

    const id =
      safeRaw.id ||
      `acc_${serviceId}_${Buffer.from(`${domain}_${accountIdentifier}`).toString('hex').slice(0, 10)}`;

    return {
      id,
      serviceId,
      serviceName,
      domain,
      accountIdentifier,
      sourceTool: safeRaw.sourceTool ?? 'holehe',
      status,
      profileUrl: safeRaw.profileUrl,
      avatarUrl: safeRaw.avatarUrl,
      metadata: safeRaw.metadata ?? {},
      jdm: safeRaw.jdm,
      cleaned: safeRaw.cleaned ?? false,
      cleanedDate: safeRaw.cleanedDate,
    };
  }

  /**
   * Normalize an incoming partial leak object into a full UnifiedLeak
   */
  static normalizeLeak(raw: Partial<UnifiedLeak>): UnifiedLeak {
    const safeRaw = raw && typeof raw === 'object' ? raw : {};
    const target = safeRaw.target?.trim() || '';
    const breachName = safeRaw.breachName?.trim() || 'Unknown Breach';
    const cleanBreach = breachName.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
    const id =
      safeRaw.id ||
      `leak_${cleanBreach}_${Buffer.from(`${target}_${breachName}`).toString('hex').slice(0, 10)}`;

    return {
      id,
      target,
      sourceTool: safeRaw.sourceTool ?? 'h8mail',
      breachName,
      breachDate: safeRaw.breachDate,
      dataClasses: Array.isArray(safeRaw.dataClasses) && safeRaw.dataClasses.length > 0
        ? Array.from(new Set(safeRaw.dataClasses))
        : ['credentials'],
      details: safeRaw.details || `Breach record for ${breachName}`,
    };
  }

  /**
   * Deduplicate accounts based on (serviceId/domain, accountIdentifier)
   * Merges metadata and richest attributes when collisions occur
   */
  static deduplicateAccounts(accounts: UnifiedAccount[]): UnifiedAccount[] {
    if (!Array.isArray(accounts)) return [];
    const map = new Map<string, UnifiedAccount>();

    for (const acc of accounts) {
      if (!acc || typeof acc !== 'object') continue;
      const normalized = this.normalizeAccount(acc);
      // Key on serviceId + accountIdentifier (or domain + accountIdentifier)
      const key = `${normalized.serviceId}:::${normalized.accountIdentifier.toLowerCase()}`;

      if (!map.has(key)) {
        // First occurrence
        map.set(key, {
          ...normalized,
          metadata: {
            ...normalized.metadata,
            sourceTools: [normalized.sourceTool],
          },
        });
      } else {
        // Merge with existing
        const existing = map.get(key)!;
        const merged = this.mergeAccounts(existing, normalized);
        map.set(key, merged);
      }
    }

    return Array.from(map.values());
  }

  /**
   * Deduplicate leaks based on (target, breachName)
   */
  static deduplicateLeaks(leaks: UnifiedLeak[]): UnifiedLeak[] {
    if (!Array.isArray(leaks)) return [];
    const map = new Map<string, UnifiedLeak>();

    for (const leak of leaks) {
      if (!leak || typeof leak !== 'object') continue;
      const normalized = this.normalizeLeak(leak);
      const key = `${normalized.target.toLowerCase()}:::${normalized.breachName.toLowerCase()}`;

      if (!map.has(key)) {
        map.set(key, { ...normalized });
      } else {
        const existing = map.get(key)!;
        const mergedDataClasses = Array.from(
          new Set([...existing.dataClasses, ...normalized.dataClasses])
        );
        const mergedDetails = existing.details.includes(normalized.details)
          ? existing.details
          : `${existing.details} | ${normalized.details}`;

        map.set(key, {
          ...existing,
          dataClasses: mergedDataClasses,
          details: mergedDetails,
        });
      }
    }

    return Array.from(map.values());
  }

  /**
   * Process and normalize all accounts and leaks from an array of ToolResult
   */
  static normalizeResults(results: ToolResult[]): {
    accounts: UnifiedAccount[];
    leaks: UnifiedLeak[];
  } {
    if (!Array.isArray(results)) return { accounts: [], leaks: [] };
    const rawAccounts: UnifiedAccount[] = [];
    const rawLeaks: UnifiedLeak[] = [];

    for (const res of results) {
      if (!res || typeof res !== 'object') continue;
      if (Array.isArray(res.accounts)) {
        rawAccounts.push(...res.accounts);
      }
      if (Array.isArray(res.leaks)) {
        rawLeaks.push(...res.leaks);
      }
    }

    return {
      accounts: this.deduplicateAccounts(rawAccounts),
      leaks: this.deduplicateLeaks(rawLeaks),
    };
  }

  /**
   * Merge two accounts representing the same identity on the same service
   */
  private static mergeAccounts(
    primary: UnifiedAccount,
    secondary: UnifiedAccount
  ): UnifiedAccount {
    const existingSources: string[] = primary.metadata?.sourceTools || [primary.sourceTool];
    const newSources = Array.from(
      new Set([...existingSources, secondary.sourceTool])
    );

    // Prefer richer or properly cased display name
    let serviceName = primary.serviceName;
    if (
      primary.serviceName === primary.serviceName.toLowerCase() &&
      secondary.serviceName !== secondary.serviceName.toLowerCase()
    ) {
      serviceName = secondary.serviceName;
    } else if (secondary.serviceName.length > primary.serviceName.length) {
      serviceName = secondary.serviceName;
    }

    // Prefer valid profile URL
    const profileUrl = primary.profileUrl || secondary.profileUrl;

    // Prefer valid avatar URL
    const avatarUrl = primary.avatarUrl || secondary.avatarUrl;

    // Status: claimed has highest priority, then rate_limited, then unclaimed
    let status: AccountStatus = 'unclaimed';
    if (primary.status === 'claimed' || secondary.status === 'claimed') {
      status = 'claimed';
    } else if (
      primary.status === 'rate_limited' ||
      secondary.status === 'rate_limited'
    ) {
      status = 'rate_limited';
    }

    // Domain: prefer specific domain over generic
    const domain =
      primary.domain && primary.domain !== `${primary.serviceId}.com`
        ? primary.domain
        : secondary.domain || primary.domain;

    // JDM: preserve matched JDM info if either has it
    const jdm = primary.jdm?.matched ? primary.jdm : secondary.jdm || primary.jdm;

    return {
      ...primary,
      serviceName,
      domain,
      status,
      profileUrl,
      avatarUrl,
      jdm,
      cleaned: primary.cleaned || secondary.cleaned,
      cleanedDate: primary.cleanedDate || secondary.cleanedDate,
      metadata: {
        ...secondary.metadata,
        ...primary.metadata,
        sourceTools: newSources,
      },
    };
  }

  private static normalizeDomain(raw: string): string {
    if (!raw) return '';
    try {
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        const u = new URL(raw);
        return u.hostname.replace(/^www\./i, '').toLowerCase();
      }
    } catch {
      // Fallback
    }
    return raw.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '').toLowerCase();
  }
}
