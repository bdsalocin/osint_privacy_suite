/**
 * Fonctions d'assertion spécialisées pour la suite de tests E2E (ESM)
 */

import assert from 'node:assert/strict';

export function assertUnifiedAccount(account, context = '') {
  assert.ok(account, `Compte null ou indéfini ${context}`);
  assert.ok(typeof account.id === 'string' && account.id.length > 0, `account.id requis ${context}`);
  assert.ok(typeof account.serviceId === 'string' && account.serviceId.length > 0, `account.serviceId requis ${context}`);
  assert.ok(typeof account.serviceName === 'string' && account.serviceName.length > 0, `account.serviceName requis ${context}`);
  assert.ok(typeof account.domain === 'string', `account.domain requis ${context}`);
  assert.ok(typeof account.accountIdentifier === 'string', `account.accountIdentifier requis ${context}`);
  assert.ok(['holehe', 'maigret', 'ignorant', 'ghunt', 'spiderfoot', 'unknown'].includes(account.sourceTool), `sourceTool invalide : ${account.sourceTool} ${context}`);
  assert.ok(['claimed', 'unclaimed', 'rate_limited'].includes(account.status), `statut invalide : ${account.status} ${context}`);
  assert.strictEqual(typeof account.cleaned, 'boolean', `cleaned doit être un booléen ${context}`);
}

export function assertUnifiedLeak(leak, context = '') {
  assert.ok(leak, `Fuite nulle ou indéfinie ${context}`);
  assert.ok(typeof leak.id === 'string' && leak.id.length > 0, `leak.id requis ${context}`);
  assert.ok(typeof leak.target === 'string' && leak.target.length > 0, `leak.target requis ${context}`);
  assert.ok(['h8mail', 'spiderfoot'].includes(leak.sourceTool), `sourceTool de fuite invalide : ${leak.sourceTool} ${context}`);
  assert.ok(typeof leak.breachName === 'string', `breachName requis ${context}`);
  assert.ok(Array.isArray(leak.dataClasses), `dataClasses doit être un tableau ${context}`);
}

/**
 * Validation stricte de la conformité à la directive utilisateur :
 * Aucun caractère tiret dans les phrases et réponses destinées à l'utilisateur ou courriels en français !
 */
export function assertGdprEmailFrenchNoHyphens(text, context = '') {
  assert.ok(text && typeof text === 'string', `Texte vide ${context}`);
  const hasDash = text.includes('-');
  assert.strictEqual(
    hasDash,
    false,
    `Violation de la règle d'interdiction des tirets dans le texte en français ! Présence du caractère tiret '-' détectée : ${context}`
  );
}

export function assertValidMailto(uri, context = '') {
  assert.ok(typeof uri === 'string', `URI mailto non chaîne ${context}`);
  assert.ok(uri.startsWith('mailto:'), `URI doit débuter par mailto: ${context}`);
  assert.ok(uri.includes('?subject='), `Paramètre subject manquant dans mailto ${context}`);
  assert.ok(uri.includes('&body='), `Paramètre body manquant dans mailto ${context}`);
}

export function assertJdmEntry(entry, context = '') {
  assert.ok(entry, `Entrée JDM null ${context}`);
  assert.ok(typeof entry.name === 'string', `Nom JDM requis ${context}`);
  assert.ok(['easy', 'medium', 'hard', 'impossible', 'limited', 'unknown'].includes(entry.difficulty), `Difficulté JDM invalide : ${entry.difficulty} ${context}`);
  assert.ok(typeof entry.url === 'string', `URL JDM requise ${context}`);
}
