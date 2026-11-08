/**
 * JustGetMyData Integration & Data Export Resolver
 * Resolves direct takeout portals (Google Takeout, Meta, Apple, Spotify, etc.)
 * or entries from JustGetMyData repository.
 */

import { cleanDomain } from './jdm-matcher.js';
import { UnifiedAccount } from './types.js';

export interface JGMDRecord {
  name: string;
  url: string;
  difficulty?: 'easy' | 'medium' | 'hard' | 'limited';
  domains?: string[];
  notes?: string;
  notes_fr?: string;
  email?: string;
  email_subject?: string;
  email_body?: string;
}

export interface JGMDResolutionResult {
  matched: boolean;
  exportUrl: string | null;
  notes?: string;
  source: 'direct_portal' | 'jgmd_list' | 'none';
}

/**
 * Direct takeout portals for tech platforms and web services
 */
export const DIRECT_TAKEOUT_PORTALS: Record<string, string> = {
  'google': 'https://takeout.google.com/',
  'facebook': 'https://accountscenter.facebook.com/info_and_permissions',
  'instagram': 'https://accountscenter.instagram.com/info_and_permissions/dyi/',
  'twitter': 'https://twitter.com/settings/your_twitter_data',
  'apple': 'https://privacy.apple.com',
  'spotify': 'https://www.spotify.com/account/privacy/',
  'microsoft': 'https://account.microsoft.com/privacy',
  'amazon': 'https://www.amazon.com/hz/privacy-central/data-requests/preview.html',
  'reddit': 'https://www.reddit.com/settings/data-request',
  'linkedin': 'https://www.linkedin.com/mypreferences/d/download-my-data',
  'github': 'https://github.com/settings/admin',
  'snapchat': 'https://support.snapchat.com/en-US/a/download-my-data',
  'netflix': 'https://www.netflix.com/youraccount',
  'uber': 'https://myprivacy.uber.com/privacy/exploreyourdata/download'
};

/**
 * Resolve data takeout / export URL for a given service or domain
 */
export function resolveJGMD(
  serviceName: any = '',
  domain: any = '',
  jgmdEntries: JGMDRecord[] = []
): JGMDResolutionResult {
  if (!serviceName && !domain) {
    return { matched: false, exportUrl: null, source: 'none' };
  }

  const cleanStr = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normName = cleanStr(serviceName);
  const cDomain = cleanDomain(domain);

  if (!normName && !cDomain) {
    return { matched: false, exportUrl: null, source: 'none' };
  }

  const nameTokens = String(serviceName || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const domainParts = cDomain.split('.').filter(Boolean);

  // Check direct portals with word boundary or domain segment matching
  for (const [key, url] of Object.entries(DIRECT_TAKEOUT_PORTALS)) {
    const nameMatches = normName === key || nameTokens.includes(key);
    const domainMatches = cDomain === `${key}.com` || domainParts.includes(key);

    if (nameMatches || domainMatches) {
      return { matched: true, exportUrl: url, source: 'direct_portal' };
    }
  }

  // Check JGMD entries if available
  if (Array.isArray(jgmdEntries)) {
    for (const entry of jgmdEntries) {
      const entryNameNorm = cleanStr(entry.name || '');
      const domainMatches = Array.isArray(entry.domains) && entry.domains.some((d) => cleanDomain(d) === cDomain);

      if ((normName && entryNameNorm === normName) || domainMatches) {
        return {
          matched: true,
          exportUrl: entry.url,
          notes: entry.notes_fr || entry.notes,
          source: 'jgmd_list'
        };
      }
    }
  }

  return { matched: false, exportUrl: null, source: 'none' };
}

/**
 * JustGetMyData Resolver Service Class
 */
export class JgmdMatcher {
  private entries: JGMDRecord[] = [];

  constructor(entries: JGMDRecord[] = []) {
    this.entries = entries;
  }

  public setEntries(entries: JGMDRecord[]): void {
    this.entries = entries;
  }

  public getEntries(): JGMDRecord[] {
    return this.entries;
  }

  public resolve(serviceName: string, domain: string = ''): JGMDResolutionResult {
    return resolveJGMD(serviceName, domain, this.entries);
  }

  public enrichAccount(account: UnifiedAccount): UnifiedAccount {
    const res = this.resolve(account.serviceName || account.serviceId, account.domain || account.profileUrl);

    if (res.matched && res.exportUrl) {
      return {
        ...account,
        jdm: {
          ...account.jdm,
          matched: account.jdm?.matched ?? false,
          getDataUrl: res.exportUrl
        }
      };
    }

    return account;
  }
}
