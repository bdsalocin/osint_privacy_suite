/**
 * Historical Audit Comparator Engine
 * Chronological comparison between two audits with tripartite account categorization
 * and zero-hyphen French risk evolution reporting.
 */

import { UnifiedAccount, UnifiedLeak } from './types.js';
import { ScanRecord, DiscoveredAccountRecord } from '../storage/database.js';
import { calculateRiskScore } from './risk-engine.js';

export interface AuditSnapshot {
  scan?: Partial<ScanRecord> | null;
  accounts: (UnifiedAccount | DiscoveredAccountRecord | any)[];
  leaks?: UnifiedLeak[];
  riskScore?: number;
}

export interface ScoreEvolution {
  scoreA: number;
  scoreB: number;
  delta: number;
  descriptionFrench: string;
}

export interface ComparisonStats {
  totalA: number;
  totalB: number;
  newCount: number;
  persistentCount: number;
  resolvedCount: number;
}

export interface AuditComparisonResult {
  newlyExposed: UnifiedAccount[];
  persistentlyExposed: UnifiedAccount[];
  resolvedAccounts: UnifiedAccount[];
  scoreEvolution: ScoreEvolution;
  stats: ComparisonStats;
}

/**
 * Derives the canonical unique key for an account across audits
 */
export function getCanonicalAccountKey(account: Partial<UnifiedAccount> | Record<string, any>): string {
  if (!account || typeof account !== 'object') return 'unknown:::unknown';
  const a = account as any;
  const service = (a.serviceName || a.service_name || a.serviceId || 'unknown_service')
    .toString()
    .toLowerCase()
    .trim();
  const identifier = (a.accountIdentifier || a.account_identifier || '')
    .toString()
    .toLowerCase()
    .trim();
  return `${service}:::${identifier}`;
}

/**
 * Checks whether an account is resolved (cleaned or completed/deleted)
 */
export function isAccountResolved(account: Partial<UnifiedAccount> | Record<string, any>): boolean {
  if (!account || typeof account !== 'object') return false;
  if (account.cleaned === true) return true;
  const status = (account.status || '').toString().toLowerCase().trim();
  return status === 'completed' || status === 'deleted';
}

/**
 * Normalizes an account record into UnifiedAccount format for comparator return values
 */
function normalizeToUnifiedAccount(acc: any): UnifiedAccount {
  const serviceName = acc.serviceName || acc.service_name || 'Service Inconnu';
  const serviceId = acc.serviceId || serviceName.toLowerCase().replace(/[^a-z0-9_\-]/g, '_');
  const domain = acc.domain || `${serviceId}.com`;
  const accountIdentifier = acc.accountIdentifier || acc.account_identifier || '';
  const cleaned = isAccountResolved(acc);

  return {
    id: acc.id || `acc_${serviceId}_${Buffer.from(`${domain}_${accountIdentifier}`).toString('hex').slice(0, 10)}`,
    serviceId,
    serviceName,
    domain,
    accountIdentifier,
    sourceTool: (acc.sourceTool || (Array.isArray(acc.source_tools) ? acc.source_tools[0] : 'holehe')) as any,
    status: cleaned ? 'unclaimed' : (acc.status === 'claimed' ? 'claimed' : 'claimed'),
    profileUrl: acc.profileUrl || acc.profile_url || undefined,
    avatarUrl: acc.avatarUrl || acc.avatar_url || undefined,
    metadata: acc.metadata || {},
    jdm: acc.jdm,
    cleaned,
    cleanedDate: acc.cleanedDate || acc.processed_at || undefined,
  };
}

/**
 * Generates the French description of risk score evolution without any hyphen characters
 */
export function formatScoreEvolutionFrench(scoreA: number, scoreB: number): ScoreEvolution {
  const roundedA = Math.max(0, Math.min(100, Math.round(scoreA)));
  const roundedB = Math.max(0, Math.min(100, Math.round(scoreB)));
  const delta = roundedB - roundedA;
  const absDelta = Math.abs(delta);

  let descriptionFrench: string;
  if (delta < 0) {
    const pointWord = absDelta === 1 ? 'point' : 'points';
    descriptionFrench = `Baisse de ${absDelta} ${pointWord}`;
  } else if (delta > 0) {
    const pointWord = absDelta === 1 ? 'point' : 'points';
    descriptionFrench = `Hausse de ${absDelta} ${pointWord}`;
  } else {
    descriptionFrench = 'Score stable';
  }

  return {
    scoreA: roundedA,
    scoreB: roundedB,
    delta,
    descriptionFrench,
  };
}

/**
 * Resolves the numerical risk score for an audit snapshot
 */
function resolveSnapshotScore(snapshot: AuditSnapshot): number {
  if (typeof snapshot.riskScore === 'number' && !Number.isNaN(snapshot.riskScore)) {
    return snapshot.riskScore;
  }
  const summary = snapshot.scan?.summary_counts;
  if (summary && typeof summary.riskScore === 'number') {
    return summary.riskScore;
  }
  if (summary && typeof summary.score === 'number') {
    return summary.score;
  }
  try {
    const unifiedAccounts = (snapshot.accounts || []).map(normalizeToUnifiedAccount);
    const leaks = snapshot.leaks || [];
    const calculated = calculateRiskScore(unifiedAccounts, leaks);
    return calculated.score;
  } catch {
    return 0;
  }
}

/**
 * Compares two audits (Audit A = baseline, Audit B = comparison)
 */
export function compareAudits(auditA: AuditSnapshot, auditB: AuditSnapshot): AuditComparisonResult {
  const accountsA = Array.isArray(auditA?.accounts) ? auditA.accounts : [];
  const accountsB = Array.isArray(auditB?.accounts) ? auditB.accounts : [];

  // Build canonical maps with deduplication
  const mapA = new Map<string, any>();
  for (const acc of accountsA) {
    const key = getCanonicalAccountKey(acc);
    if (!mapA.has(key)) {
      mapA.set(key, acc);
    }
  }

  const mapB = new Map<string, any>();
  for (const acc of accountsB) {
    const key = getCanonicalAccountKey(acc);
    if (!mapB.has(key)) {
      mapB.set(key, acc);
    }
  }

  const newlyExposed: UnifiedAccount[] = [];
  const persistentlyExposed: UnifiedAccount[] = [];
  const resolvedAccounts: UnifiedAccount[] = [];

  // 1. Process accounts in Audit B
  for (const [key, accB] of mapB.entries()) {
    if (!mapA.has(key)) {
      // Present in B, absent in A => newly exposed
      newlyExposed.push(normalizeToUnifiedAccount(accB));
    } else {
      // Present in both A and B
      if (isAccountResolved(accB)) {
        // Marked resolved/cleaned in B
        resolvedAccounts.push(normalizeToUnifiedAccount(accB));
      } else {
        // Still uncleaned in B => persistent
        persistentlyExposed.push(normalizeToUnifiedAccount(accB));
      }
    }
  }

  // 2. Process accounts in Audit A no longer present in Audit B
  for (const [key, accA] of mapA.entries()) {
    if (!mapB.has(key)) {
      // Present in A, absent in B => successfully resolved/removed
      const normalizedA = normalizeToUnifiedAccount(accA);
      normalizedA.cleaned = true;
      resolvedAccounts.push(normalizedA);
    }
  }

  // 3. Compute risk score evolution
  const scoreA = resolveSnapshotScore(auditA);
  const scoreB = resolveSnapshotScore(auditB);
  const scoreEvolution = formatScoreEvolutionFrench(scoreA, scoreB);

  // 4. Compute statistics
  const stats: ComparisonStats = {
    totalA: mapA.size,
    totalB: mapB.size,
    newCount: newlyExposed.length,
    persistentCount: persistentlyExposed.length,
    resolvedCount: resolvedAccounts.length,
  };

  return {
    newlyExposed,
    persistentlyExposed,
    resolvedAccounts,
    scoreEvolution,
    stats,
  };
}
