import os from 'node:os';
/**
 * JustDeleteMe Indexing, Matching & Difficulty Engine
 * Reconciles discovered accounts with 2,660+ deletion portals from JustDeleteMe.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JdmDifficulty, UnifiedAccount } from './types.js';

const __jdmDirname = path.dirname(fileURLToPath(import.meta.url));

export interface JustDeleteMeEntry {
  name: string;
  url: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'impossible' | 'limited' | 'unknown';
  domains: string[];
  notes?: string;
  notes_fr?: string;
  notes_de?: string;
  notes_it?: string;
  notes_ru?: string;
  notes_tr?: string;
  email?: string;
  email_subject?: string;
  email_body?: string;
  url_fr?: string;
  meta?: string[] | string;
}

export interface MatchingResult {
  entry: JustDeleteMeEntry | null;
  confidence: number;
  matchedBy: 'alias' | 'domain_exact' | 'domain_root' | 'name_exact' | 'fuzzy' | 'none';
}

export interface JdmDifficultyInfo {
  difficulty: 'easy' | 'medium' | 'hard' | 'impossible' | 'limited' | 'unknown';
  label: string;
  color: string;
  tailwindClasses: string;
  description: string;
}

/**
 * Official canonical aliases mapping varied tool identifiers or multi-brand domains
 * to official JustDeleteMe domains.
 */
export const CANONICAL_ALIASES: Record<string, string> = {
  'office365.com': 'microsoft.com',
  'office.com': 'microsoft.com',
  'live.com': 'microsoft.com',
  'outlook.com': 'microsoft.com',
  'hotmail.com': 'microsoft.com',
  'gmail.com': 'google.com',
  'googlemail.com': 'google.com',
  'fb.com': 'facebook.com',
  'x.com': 'twitter.com',
  'chatgpt.com': 'openai.com',
};

/**
 * Visual styling and metadata for the 6 difficulty categories.
 */
export const JDM_DIFFICULTY_METADATA: Record<string, JdmDifficultyInfo> = {
  easy: {
    difficulty: 'easy',
    label: 'Facile',
    color: '#10B981',
    tailwindClasses: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    description: 'Procédure automatisée directe dans les paramètres du compte'
  },
  medium: {
    difficulty: 'medium',
    label: 'Moyen',
    color: '#F59E0B',
    tailwindClasses: 'bg-amber-100 text-amber-800 border-amber-300',
    description: 'Suppression en ligne comportant des étapes intermédiaires'
  },
  hard: {
    difficulty: 'hard',
    label: 'Difficile',
    color: '#EF4444',
    tailwindClasses: 'bg-rose-100 text-rose-800 border-rose-300',
    description: 'Nécessite une prise de contact avec le support ou le DPO'
  },
  impossible: {
    difficulty: 'impossible',
    label: 'Impossible',
    color: '#1F2937',
    tailwindClasses: 'bg-slate-800 text-slate-100 border-slate-600',
    description: 'Le service refuse la suppression des comptes ou conserve indéfiniment les données'
  },
  limited: {
    difficulty: 'limited',
    label: 'Conditionnel',
    color: '#8B5CF6',
    tailwindClasses: 'bg-purple-100 text-purple-800 border-purple-300',
    description: 'Suppression accessible uniquement sous conditions légales (RGPD ou CCPA)'
  },
  unknown: {
    difficulty: 'unknown',
    label: 'Non référencé',
    color: '#6B7280',
    tailwindClasses: 'bg-gray-100 text-gray-700 border-gray-300',
    description: 'Service non répertorié dans la base JustDeleteMe'
  }
};

/**
 * Clean and normalize a web domain or URL
 */
export function cleanDomain(raw?: any): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  try {
    let d = s.toLowerCase();
    if (d.startsWith('http://') || d.startsWith('https://')) {
      d = new URL(d).hostname;
    }
    if (d.startsWith('www.')) d = d.substring(4);
    return d.split('/')[0].trim();
  } catch {
    return s.toLowerCase();
  }
}

/**
 * Build fast lookup Map indexes for domains and normalized names
 */
export function buildJdmIndexes(jdmEntries: JustDeleteMeEntry[] = []): {
  domainIndex: Map<string, JustDeleteMeEntry>;
  nameIndex: Map<string, JustDeleteMeEntry>;
} {
  const domainIndex = new Map<string, JustDeleteMeEntry>();
  const nameIndex = new Map<string, JustDeleteMeEntry>();

  const cleanStr = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const entry of jdmEntries) {
    if (Array.isArray(entry.domains)) {
      for (const d of entry.domains) {
        domainIndex.set(cleanDomain(d), entry);
      }
    }
    if (entry.name) {
      nameIndex.set(cleanStr(entry.name), entry);
    }
  }

  return { domainIndex, nameIndex };
}

/**
 * Cascade reconciliation algorithm matching an OSINT account to a JustDeleteMe entry
 */
export function matchAccountToJDM(
  serviceQuery: string = '',
  urlOrDomain: string = '',
  jdmEntries: JustDeleteMeEntry[] = [],
  domainIndex: Map<string, JustDeleteMeEntry> | null = null,
  nameIndex: Map<string, JustDeleteMeEntry> | null = null
): MatchingResult {
  if (!domainIndex || !nameIndex) {
    const indexes = buildJdmIndexes(jdmEntries);
    domainIndex = indexes.domainIndex;
    nameIndex = indexes.nameIndex;
  }

  const cleanStr = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const domainCandidate = cleanDomain(urlOrDomain || serviceQuery);
  const normalizedQuery = cleanStr(serviceQuery);

  // Early guard: if both normalizedQuery and domainCandidate are empty, return immediately
  if (!normalizedQuery && !domainCandidate) {
    return { entry: null, confidence: 0.0, matchedBy: 'none' };
  }

  // Step 1: Canonical Aliases
  if (CANONICAL_ALIASES[domainCandidate]) {
    const canonicalDomain = CANONICAL_ALIASES[domainCandidate];
    if (domainIndex.has(canonicalDomain)) {
      return { entry: domainIndex.get(canonicalDomain)!, confidence: 1.0, matchedBy: 'alias' };
    }
  }

  // Step 2: Exact Domain match
  if (domainIndex.has(domainCandidate)) {
    return { entry: domainIndex.get(domainCandidate)!, confidence: 1.0, matchedBy: 'domain_exact' };
  }

  // Step 3: Root Domain match (e.g. sub.domain.com -> domain.com)
  const parts = domainCandidate.split('.');
  if (parts.length > 2) {
    const rootDomain = parts.slice(-2).join('.');
    if (domainIndex.has(rootDomain)) {
      return { entry: domainIndex.get(rootDomain)!, confidence: 0.9, matchedBy: 'domain_root' };
    }
  }

  // Step 4: Normalized Name exact match
  if (normalizedQuery && nameIndex.has(normalizedQuery)) {
    return { entry: nameIndex.get(normalizedQuery)!, confidence: 0.85, matchedBy: 'name_exact' };
  }

  // Step 5: Fuzzy match (tokens or anchored prefix)
  if (normalizedQuery.length >= 4) {
    const tokens = String(serviceQuery || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4);

    // Vérification rapide si un mot de la requête correspond exactement à un service indexé
    for (const t of tokens) {
      if (nameIndex.has(t)) {
        return { entry: nameIndex.get(t)!, confidence: 0.7, matchedBy: 'fuzzy' };
      }
    }

    for (const entry of jdmEntries) {
      const entryNorm = cleanStr(entry.name);
      if (entryNorm.length < 4) continue;

      // Ancrage par préfixe : la requête commence par le nom officiel ou l'inverse
      if (normalizedQuery.startsWith(entryNorm)) {
        return { entry, confidence: 0.7, matchedBy: 'fuzzy' };
      }
      if (entryNorm.startsWith(normalizedQuery)) {
        return { entry, confidence: 0.7, matchedBy: 'fuzzy' };
      }
    }
  }

  return { entry: null, confidence: 0.0, matchedBy: 'none' };
}

/**
 * Retrieve difficulty styling metadata with fallback to 'unknown'
 */
export function getDifficultyMetadata(difficulty?: string): JdmDifficultyInfo {
  const diffKey = String(difficulty || '').toLowerCase();
  return JDM_DIFFICULTY_METADATA[diffKey] || JDM_DIFFICULTY_METADATA.unknown;
}

/**
 * JustDeleteMe Matcher Service class
 */
export class JdmMatcher {
  private entries: JustDeleteMeEntry[] = [];
  private domainIndex: Map<string, JustDeleteMeEntry> = new Map();
  private nameIndex: Map<string, JustDeleteMeEntry> = new Map();

  constructor(sitesOrPath?: string | JustDeleteMeEntry[]) {
    if (Array.isArray(sitesOrPath)) {
      this.setEntries(sitesOrPath);
    } else if (typeof sitesOrPath === 'string') {
      this.loadFromFile(sitesOrPath);
    } else {
      this.loadDefault();
    }
  }

  public loadDefault(): void {
    const candidatePaths = [
      path.resolve(__jdmDirname, '../../../data/jdm_sites.json'),
      path.resolve(__jdmDirname, '../../data/jdm_sites.json'),
      path.resolve(process.cwd(), 'data/jdm_sites.json'),
      path.resolve(process.cwd(), '../data/jdm_sites.json'),
      `${os.homedir()}/osint-perso/jdm_sites.json`
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          this.loadFromFile(p);
          return;
        } catch {
          // Continue to next candidate
        }
      }
    }
  }

  public loadFromFile(filePath: string): void {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      this.setEntries(parsed);
    }
  }

  public setEntries(entries: JustDeleteMeEntry[]): void {
    this.entries = entries;
    const { domainIndex, nameIndex } = buildJdmIndexes(this.entries);
    this.domainIndex = domainIndex;
    this.nameIndex = nameIndex;
  }

  public getAllSites(): JustDeleteMeEntry[] {
    return this.entries;
  }

  public getSiteCount(): number {
    return this.entries.length;
  }

  public getSiteByName(name: string): JustDeleteMeEntry | null {
    const cleanStr = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    return this.nameIndex.get(cleanStr(name)) || null;
  }

  public getSiteByDomain(domain: string): JustDeleteMeEntry | null {
    return this.domainIndex.get(cleanDomain(domain)) || null;
  }

  public match(serviceQuery: string, urlOrDomain: string = ''): MatchingResult {
    return matchAccountToJDM(
      serviceQuery,
      urlOrDomain,
      this.entries,
      this.domainIndex,
      this.nameIndex
    );
  }

  /**
   * Enriches a UnifiedAccount with JDM metadata and deletion details
   */
  public enrichAccount(account: UnifiedAccount): UnifiedAccount {
    const match = this.match(account.serviceName || account.serviceId, account.domain || account.profileUrl);

    if (match.entry) {
      const e = match.entry;
      const difficulty = (e.difficulty === 'limited' ? 'limited' : e.difficulty) as JdmDifficulty;
      return {
        ...account,
        jdm: {
          matched: true,
          difficulty,
          deleteUrl: e.url,
          notes: e.notes,
          notesFr: e.notes_fr,
          notes_fr: e.notes_fr,
          email: e.email,
          emailBody: e.email_body,
          email_body: e.email_body
        }
      };
    }

    return {
      ...account,
      jdm: {
        matched: false,
        difficulty: 'unknown'
      }
    };
  }
}
