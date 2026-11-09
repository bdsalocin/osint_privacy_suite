/**
 * Global Privacy Risk Score Engine & Remediation Recommendation Generator
 *
 * Calcule un score global de 0 a 100 base sur l exposition des comptes non assainis
 * et la gravite des fuites de securite decouvertes.
 *
 * REGLE ABSOLUE : ZERO CARACTERE TIRET (-, –, —) DANS LES TEXTES EN FRANCAIS
 */

import {
  JdmDifficulty,
  UnifiedAccount,
  UnifiedLeak,
} from './types.js';

export type RiskLevel = 'low' | 'moderate' | 'elevated' | 'critical';

export type RemediationActionType = 'delete' | 'gdpr' | 'password' | 'export';

export interface RemediationRecommendation {
  priority: number; // 1: Critique, 2: Eleve, 3: Moyen, 4: Faible
  title: string; // Zero tiret en francais
  description: string; // Zero tiret en francais
  actionType: RemediationActionType;
  targetService?: string;
}

export interface RiskScoreBreakdown {
  accountsScore: number; // Borne [0, 60]
  leaksScore: number; // Borne [0, 100]
  uncleanedCount: number;
  criticalLeaksCount: number;
}

export interface RiskScoreResult {
  score: number; // Borne [0, 100]
  level: RiskLevel;
  breakdown: RiskScoreBreakdown;
  recommendations: RemediationRecommendation[];
}

export const JDM_DIFFICULTY_WEIGHTS: Readonly<Record<JdmDifficulty, number>> = Object.freeze({
  impossible: 10,
  hard: 7,
  limited: 5,
  conditional: 5,
  medium: 4,
  easy: 2,
  unknown: 3,
});

export const MAX_ACCOUNTS_SCORE = 60;
export const MAX_LEAKS_SCORE = 100;
export const MAX_OVERALL_SCORE = 100;

export interface RiskEngineOptions {
  maxRecommendations?: number;
}

/**
 * Nettoie une chaine pour interdire formellement tout caractere tiret dans les textes francais
 */
function stripHyphens(text: string): string {
  return String(text || '').replace(/[-–—]/g, ' ');
}

/**
 * Verifie si un compte est assaini ou resolu localement
 */
export function isAccountCleaned(account: UnifiedAccount): boolean {
  if (!account || typeof account !== 'object') return false;
  if (account.cleaned === true) return true;
  const statusStr = String(account.status || '').toLowerCase();
  return statusStr === 'completed' || statusStr === 'deleted';
}

/**
 * Calcule les points de risque d un compte individuel
 */
export function getAccountRiskPoints(account: UnifiedAccount): number {
  if (!account || typeof account !== 'object' || isAccountCleaned(account)) {
    return 0;
  }
  const matched = Boolean(account.jdm?.matched);
  if (!matched) return JDM_DIFFICULTY_WEIGHTS.unknown;

  const rawDifficulty = account.jdm?.difficulty;
  if (
    typeof rawDifficulty === 'string' &&
    Object.prototype.hasOwnProperty.call(JDM_DIFFICULTY_WEIGHTS, rawDifficulty)
  ) {
    const rawWeight = (JDM_DIFFICULTY_WEIGHTS as Record<string, number>)[rawDifficulty];
    if (typeof rawWeight === 'number' && Number.isFinite(rawWeight)) {
      return rawWeight;
    }
  }

  return JDM_DIFFICULTY_WEIGHTS.unknown;
}

/**
 * Classe une fuite et retourne ses points de risque ainsi que son caractere critique
 */
export function classifyLeak(leak: UnifiedLeak): { points: number; isCritical: boolean } {
  if (!leak || typeof leak !== 'object') {
    return { points: 0, isCritical: false };
  }

  const combinedText = [
    leak.breachName || '',
    leak.details || '',
    ...(Array.isArray(leak.dataClasses) ? leak.dataClasses : []),
  ]
    .join(' ')
    .toLowerCase()
    .replace(/[_.\-\/]/g, ' ');

  const criticalPatterns = [
    /\bpasswords?\b/i,
    /\bcredentials?\b/i,
    /\bhash(es)?\b/i,
    /\bsecrets?\b/i,
    /\btokens?\b/i,
    /\bauth\b/i,
    /\bpin\b/i,
    /\bcredit[ ]?cards?\b/i,
    /\bbanking\b/i,
    /\bfinancial\b/i,
    /\bbanque\b/i,
    /\bmots? de passe\b/i,
    /\bmdp\b/i,
  ];

  if (criticalPatterns.some((pattern) => pattern.test(combinedText))) {
    return { points: 25, isCritical: true };
  }

  const personalPatterns = [
    /\btelephones?\b/i,
    /\bphones?\b/i,
    /\bmobiles?\b/i,
    /\badresse?s?\b/i,
    /\bnames?\b/i,
    /\bnoms?\b/i,
    /\bdob\b/i,
    /\bbirth\b/i,
    /\bnaissance\b/i,
    /\bip\b/i,
    /\blocation\b/i,
    /\bgeolocations?\b/i,
    /\bidentit[ey]\b/i,
    /\bssn\b/i,
    /\bcin\b/i,
    /\bpasse?ports?\b/i,
    /\bemails?\b/i,
  ];

  if (personalPatterns.some((pattern) => pattern.test(combinedText))) {
    return { points: 15, isCritical: false };
  }

  return { points: 8, isCritical: false };
}

/**
 * Determine le niveau qualitatif de risque selon le score 0 a 100
 */
export function getRiskLevel(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'elevated';
  if (score >= 25) return 'moderate';
  return 'low';
}

/**
 * Genere les recommandations d assainissement priorisees
 * GARANTIE STRICTE : ZERO CARACTERE TIRET DANS LES TEXTES GENERES
 */
export function generateRemediationRecommendations(
  accounts: UnifiedAccount[] = [],
  leaks: UnifiedLeak[] = [],
  maxRecommendations: number = 8
): RemediationRecommendation[] {
  const recommendations: RemediationRecommendation[] = [];
  const handledServices = new Set<string>();

  const safeAccounts = (Array.isArray(accounts) ? accounts : []).filter(
    (acc): acc is UnifiedAccount => Boolean(acc && typeof acc === 'object')
  );
  const safeLeaks = (Array.isArray(leaks) ? leaks : []).filter(
    (l): l is UnifiedLeak => Boolean(l && typeof l === 'object')
  );
  const safeMaxRecs =
    typeof maxRecommendations === 'number' &&
    Number.isFinite(maxRecommendations) &&
    maxRecommendations >= 0
      ? Math.floor(maxRecommendations)
      : 8;

  const uncleanedAccounts = safeAccounts.filter((acc) => !isAccountCleaned(acc));

  // 1. Priorite 1 Critique : Mots de passe ou identifiants compromis
  const criticalLeaks = safeLeaks.filter((l) => classifyLeak(l).isCritical);
  if (criticalLeaks.length > 0) {
    const rawLeakNames = criticalLeaks
      .map((l) => l.breachName)
      .filter(Boolean)
      .slice(0, 3)
      .join(', ');
    const leakNames = stripHyphens(rawLeakNames);

    recommendations.push({
      priority: 1,
      title: 'Changement immediat des mots de passe compromis',
      description: stripHyphens(
        `Des identifiants ou mots de passe ont ete detectes dans des fuites de donnees (${criticalLeaks.length} fuite(s) critique(s) identifiee(s) : ${leakNames || 'Sources multiples'}). Modifiez sans attendre vos mots de passe et activez la double authentification sur chaque compte concerne.`
      ),
      actionType: 'password',
      targetService: leakNames || 'Fuites de securite',
    });
  }

  // 2. Priorite 2 Eleve : Comptes impossible a supprimer (Demande RGPD Article 17)
  for (const acc of uncleanedAccounts) {
    const serviceKey = (acc.serviceName || acc.serviceId || 'unknown').toLowerCase();
    if (handledServices.has(serviceKey)) continue;

    if (acc.jdm?.matched && acc.jdm.difficulty === 'impossible') {
      const cleanService = stripHyphens(acc.serviceName || acc.serviceId || 'Service');
      recommendations.push({
        priority: 2,
        title: stripHyphens(`Demande RGPD Article 17 pour ${cleanService}`),
        description: stripHyphens(
          'La suppression autonome est impossible sur cette plateforme. Utilisez le generateur de courriel pour adresser une demande formelle d effacement au delegue a la protection des donnees en application de l article 17 du RGPD.'
        ),
        actionType: 'gdpr',
        targetService: cleanService,
      });
      handledServices.add(serviceKey);
    }
  }

  // 3. Priorite 2 Eleve : Suppression facile et directe (Gains rapides)
  for (const acc of uncleanedAccounts) {
    const serviceKey = (acc.serviceName || acc.serviceId || 'unknown').toLowerCase();
    if (handledServices.has(serviceKey)) continue;

    if (acc.jdm?.matched && acc.jdm.difficulty === 'easy' && acc.jdm.deleteUrl) {
      const cleanService = stripHyphens(acc.serviceName || acc.serviceId || 'Service');
      recommendations.push({
        priority: 2,
        title: stripHyphens(`Suppression directe du compte ${cleanService}`),
        description: stripHyphens(
          'Ce service offre un acces direct a sa page de cloture. Suivez le lien direct de suppression pour effacer votre profil et neutraliser immediatement cette exposition.'
        ),
        actionType: 'delete',
        targetService: cleanService,
      });
      handledServices.add(serviceKey);
    }
  }

  // 4. Priorite 3 Moyen : Recuperation des donnees JustGetMyData avant suppression
  for (const acc of uncleanedAccounts) {
    const serviceKey = (acc.serviceName || acc.serviceId || 'unknown').toLowerCase();
    const hasDataExport = Boolean(acc.metadata?.jgmdMatched || acc.jdm?.getDataUrl);

    if (hasDataExport && !handledServices.has(serviceKey)) {
      const cleanService = stripHyphens(acc.serviceName || acc.serviceId || 'Service');
      recommendations.push({
        priority: 3,
        title: stripHyphens(`Recuperation prealable des donnees sur ${cleanService}`),
        description: stripHyphens(
          'Une archive de vos donnees peut etre exportee via le portail du service. Telechargez vos informations personnelles avant de proceder a la suppression definitive du compte.'
        ),
        actionType: 'export',
        targetService: cleanService,
      });
      handledServices.add(serviceKey);
    }
  }

  // 5. Priorite 3 Moyen : Cloture des comptes a difficulte moyenne ou difficile
  for (const acc of uncleanedAccounts) {
    const serviceKey = (acc.serviceName || acc.serviceId || 'unknown').toLowerCase();
    if (handledServices.has(serviceKey)) continue;

    if (acc.jdm?.matched && (acc.jdm.difficulty === 'medium' || acc.jdm.difficulty === 'hard')) {
      const isHard = acc.jdm.difficulty === 'hard';
      const cleanService = stripHyphens(acc.serviceName || acc.serviceId || 'Service');
      recommendations.push({
        priority: 3,
        title: isHard
          ? stripHyphens(`Suppression assistee ou recours RGPD pour ${cleanService}`)
          : stripHyphens(`Cloture du compte ${cleanService}`),
        description: isHard
          ? stripHyphens(
              'La procedure de suppression est complexe sur ce service. Consultez les consignes JustDeleteMe ou preparez une demande RGPD Article 17 pour exiger l effacement de vos donnees.'
            )
          : stripHyphens(
              'Suivez les etapes de desactivation dans les reglages du profil pour fermer ce compte non utilise.'
            ),
        actionType: isHard ? 'gdpr' : 'delete',
        targetService: cleanService,
      });
      handledServices.add(serviceKey);
    }
  }

  // 6. Priorite 4 Faible : Services non repertories dans JustDeleteMe
  for (const acc of uncleanedAccounts) {
    const serviceKey = (acc.serviceName || acc.serviceId || 'unknown').toLowerCase();
    if (handledServices.has(serviceKey)) continue;

    const cleanService = stripHyphens(acc.serviceName || acc.serviceId || 'Service');
    recommendations.push({
      priority: 4,
      title: stripHyphens(`Verification et assainissement du compte ${cleanService}`),
      description: stripHyphens(
        'Ce service ne figure pas dans la base JustDeleteMe. Accedez aux parametres de confidentialite du site pour supprimer le profil ou contactez leur support dedie.'
      ),
      actionType: 'delete',
      targetService: cleanService,
    });
    handledServices.add(serviceKey);
  }

  // 7. Conseil general de securite si au moins un compte non assaini et peu de recs
  if (uncleanedAccounts.length > 0 && recommendations.length < 3) {
    recommendations.push({
      priority: 4,
      title: 'Revue periodique des acces et mots de passe',
      description:
        'Utilisez un gestionnaire de mots de passe pour generer des identifiants distincts et robustes pour chaque plateforme enregistree.',
      actionType: 'password',
      targetService: 'Hygiene numerique globale',
    });
  }

  // Tri par priorite croissante (1 d abord, puis 2, 3, 4)
  recommendations.sort((a, b) => a.priority - b.priority);

  return recommendations.slice(0, safeMaxRecs);
}

/**
 * Point d entree principal : Calcule le Score Global de Risque de Confidentialite
 */
export function calculateRiskScore(
  accounts: UnifiedAccount[] = [],
  leaks: UnifiedLeak[] = [],
  options: RiskEngineOptions = {}
): RiskScoreResult {
  const safeAccounts = (Array.isArray(accounts) ? accounts : []).filter(
    (acc): acc is UnifiedAccount => Boolean(acc && typeof acc === 'object')
  );
  const safeLeaks = (Array.isArray(leaks) ? leaks : []).filter(
    (l): l is UnifiedLeak => Boolean(l && typeof l === 'object')
  );
  const safeOptions = options && typeof options === 'object' ? options : {};

  const uncleanedAccounts = safeAccounts.filter((acc) => !isAccountCleaned(acc));
  const uncleanedCount = uncleanedAccounts.length;

  // Calcul composante comptes
  const rawAccountsScore = uncleanedAccounts.reduce(
    (sum, acc) => sum + getAccountRiskPoints(acc),
    0
  );
  const accountsScore = Math.min(MAX_ACCOUNTS_SCORE, Math.max(0, rawAccountsScore));

  // Calcul composante fuites
  let criticalLeaksCount = 0;
  let rawLeaksScore = 0;

  for (const leak of safeLeaks) {
    const { points, isCritical } = classifyLeak(leak);
    rawLeaksScore += typeof points === 'number' && Number.isFinite(points) ? points : 0;
    if (isCritical) {
      criticalLeaksCount++;
    }
  }

  const leaksScore = Math.min(MAX_LEAKS_SCORE, Math.max(0, rawLeaksScore));

  // Score global borne [0, 100]
  const rawOverall = accountsScore + leaksScore;
  const score = Math.min(
    MAX_OVERALL_SCORE,
    Math.max(0, Math.round(Number.isFinite(rawOverall) ? rawOverall : 0))
  );

  const level = getRiskLevel(score);

  const breakdown: RiskScoreBreakdown = {
    accountsScore,
    leaksScore,
    uncleanedCount,
    criticalLeaksCount,
  };

  const maxRecs = safeOptions.maxRecommendations ?? 8;
  const recommendations = generateRemediationRecommendations(safeAccounts, safeLeaks, maxRecs);

  return {
    score,
    level,
    breakdown,
    recommendations,
  };
}
