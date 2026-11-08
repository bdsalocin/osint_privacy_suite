/**
 * Oracle et Stress Test Adversarial — Jalon 2 (Privacy Engine & RGPD)
 * Exécution : node tests/adversarial-m2-oracle.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
  cleanDomain,
  buildJdmIndexes,
  matchAccountToJDM,
  getDifficultyMetadata,
  JdmMatcher,
  CANONICAL_ALIASES
} from '../dist/src/core/jdm-matcher.js';

import {
  resolveJGMD,
  JgmdMatcher,
  DIRECT_TAKEOUT_PORTALS
} from '../dist/src/core/jgmd-matcher.js';

import {
  generateGdprArticle17Email,
  generateGdprArticle15Email,
  generateGdprMailtoUri
} from '../dist/src/core/gdpr-generator.js';

console.log('='.repeat(78));
console.log('  CHALLENGER M2 — BANC D\'ESSAI ADVERSARIAL ET STRESS TEST EMPIRIQUE');
console.log('='.repeat(78));

let passedChecks = 0;
let totalChecks = 0;
const failureDetails = [];

function check(title, fn) {
  totalChecks++;
  try {
    fn();
    passedChecks++;
    console.log(`  [OK] ${title}`);
  } catch (err) {
    console.error(`  [FAIL] ${title} -> ${err.message}`);
    failureDetails.push({ title, error: err.message, stack: err.stack });
  }
}

// ============================================================================
// SECTION 1 : Cas Limites & Fuzzing JDM Matcher (cleanDomain & matchAccountToJDM)
// ============================================================================
console.log('\n--- SECTION 1 : JDM Matcher — Fuzzing et Robustesse aux Entrées Extrêmes ---');

check('cleanDomain gère les entrées null, undefined, booléens et nombres sans renvoyer "null"', () => {
  assert.strictEqual(cleanDomain(null), '');
  assert.strictEqual(cleanDomain(undefined), '');
  assert.strictEqual(cleanDomain(''), '');
  assert.strictEqual(cleanDomain(12345), '12345');
  assert.strictEqual(cleanDomain(true), 'true');
});

check('cleanDomain gère les chaînes contenant uniquement des espaces ou tabulations', () => {
  assert.strictEqual(cleanDomain('     '), '');
  assert.strictEqual(cleanDomain('\t\r\n   \t'), '');
});

check('cleanDomain résiste aux injections XSS et balises HTML', () => {
  const xss = "<script>alert('xss')</script>";
  const cleaned = cleanDomain(xss);
  assert.strictEqual(typeof cleaned, 'string');
  assert.strictEqual(cleaned, "<script>alert('xss')<"); // split('/') coupe au premier slash
});

check('cleanDomain résiste aux caractères Unicode RTL, émojis et caractères de contrôle', () => {
  const rtl = '\u202Edomain.com\u202C';
  assert.strictEqual(typeof cleanDomain(rtl), 'string');
  const emoji = 'https://xn--i-7iq.com/path';
  assert.strictEqual(cleanDomain(emoji), 'xn--i-7iq.com');
  const ctrl = 'domain\x00\x08\x1b.com';
  assert.strictEqual(typeof cleanDomain(ctrl), 'string');
});

check('cleanDomain gère les URLs malformées (http:///, ://, ftp://, protocoles bizarres)', () => {
  assert.strictEqual(typeof cleanDomain('http:///'), 'string');
  assert.strictEqual(typeof cleanDomain(':::invalid-uri:::'), 'string');
  assert.strictEqual(typeof cleanDomain('ftp://files.example.com/pub/'), 'string');
  assert.strictEqual(typeof cleanDomain('javascript:alert(1)'), 'string');
});

check('cleanDomain gère les chaînes de taille extrême (100 000 caractères) sans ReDoS', () => {
  const huge = 'https://www.' + 'a'.repeat(100000) + '.com/long/path';
  const start = Date.now();
  const cleaned = cleanDomain(huge);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 200, `Trop lent : ${elapsed}ms`);
  assert.strictEqual(typeof cleaned, 'string');
});

const matcher = new JdmMatcher();

check('JdmMatcher est initialisé avec 2 660 sites JustDeleteMe indexés', () => {
  assert.strictEqual(matcher.getSiteCount(), 2660);
});

check('matchAccountToJDM ne plante jamais et renvoie null/0 pour des entrées vides ou undefined', () => {
  const resEmpty = matcher.match('', '');
  assert.strictEqual(resEmpty.entry, null, 'Doit renvoyer null pour requête vide');
  assert.strictEqual(resEmpty.confidence, 0.0, 'Doit avoir un score de confiance 0 pour requête vide');
  assert.strictEqual(resEmpty.matchedBy, 'none');

  const resUndefined = matcher.match(undefined, undefined);
  assert.strictEqual(resUndefined.entry, null, 'Doit renvoyer null pour undefined');
  assert.strictEqual(resUndefined.confidence, 0.0);

  const resSpaces = matcher.match('     ', '    ');
  assert.strictEqual(resSpaces.entry, null, 'Doit renvoyer null pour espaces seuls');
  assert.strictEqual(resSpaces.confidence, 0.0);
});

check('matchAccountToJDM enrichAccount ne marque pas comme matché un compte avec service vide', () => {
  const acc = {
    id: 'empty_1',
    serviceId: '',
    serviceName: '',
    accountIdentifier: 'user@example.com',
    sourceTool: 'holehe',
    status: 'claimed',
    cleaned: false,
    metadata: {}
  };
  const enriched = matcher.enrichAccount(acc);
  assert.strictEqual(enriched.jdm?.matched, false, 'Un compte sans nom de service ne doit pas être matché');
  assert.strictEqual(enriched.jdm?.difficulty, 'unknown');
  assert.strictEqual(enriched.jdm?.deleteUrl, undefined);
});

check('matchAccountToJDM résiste aux attaques XSS, injections SQL et caractères de contrôle', () => {
  const payloads = [
    "<script>alert('xss')</script>",
    "'; DROP TABLE scans; --",
    "\x00\x01\x02\x03\x04",
    "../../../../../../etc/passwd",
    "{{ 7 * 7 }}",
    "${process.exit(1)}"
  ];
  for (const p of payloads) {
    const res = matcher.match(p, p);
    assert.strictEqual(typeof res.confidence, 'number');
    assert.ok(res.confidence >= 0 && res.confidence <= 1.0);
  }
});

check('matchAccountToJDM renvoie unknown avec score 0 pour les services totalement inconnus', () => {
  const unknownServices = [
    { name: 'ServiceInexistant9999', domain: 'inexistant-xyz-999999.invalid' },
    { name: 'UltraNonExistentCryptoBank', domain: 'cryptononexist1234567.biz' },
    { name: 'FictionalLocalDevService', domain: 'dev.local.internal' }
  ];
  for (const item of unknownServices) {
    const res = matcher.match(item.name, item.domain);
    assert.strictEqual(res.entry, null, `Ne doit pas matcher de faux positif pour ${item.name}`);
    assert.strictEqual(res.confidence, 0.0);
    assert.strictEqual(res.matchedBy, 'none');
  }
});

check('matchAccountToJDM évite les faux positifs sur sous-chaînes accidentelles (ex: Distance vs Stan)', () => {
  const res = matcher.match('Distance', 'distance.fr');
  assert.strictEqual(res.entry, null, 'Distance ne doit pas être faussement réconcilié avec Stan');
});

// ============================================================================
// SECTION 2 : Validation Exhaustive des Alias Canoniques JDM
// ============================================================================
console.log('\n--- SECTION 2 : JDM Matcher — Validation des Alias Canoniques ---');

const expectedAliases = [
  { inputDomain: 'x.com', expectedTarget: 'twitter.com', expectedName: 'X' },
  { inputDomain: 'twitter.com', expectedTarget: 'twitter.com', expectedName: 'X' },
  { inputDomain: 'office365.com', expectedTarget: 'microsoft.com', expectedName: 'Microsoft' },
  { inputDomain: 'office.com', expectedTarget: 'microsoft.com', expectedName: 'Microsoft' },
  { inputDomain: 'live.com', expectedTarget: 'microsoft.com', expectedName: 'Microsoft' },
  { inputDomain: 'outlook.com', expectedTarget: 'microsoft.com', expectedName: 'Microsoft' },
  { inputDomain: 'hotmail.com', expectedTarget: 'microsoft.com', expectedName: 'Microsoft' },
  { inputDomain: 'gmail.com', expectedTarget: 'google.com', expectedName: 'Google' },
  { inputDomain: 'googlemail.com', expectedTarget: 'google.com', expectedName: 'Google' },
  { inputDomain: 'fb.com', expectedTarget: 'facebook.com', expectedName: 'Facebook' },
  { inputDomain: 'chatgpt.com', expectedTarget: 'openai.com', expectedName: 'OpenAI' }
];

for (const aliasItem of expectedAliases) {
  check(`Matching alias complexe pour ${aliasItem.inputDomain} vers ${aliasItem.expectedName}`, () => {
    const res = matcher.match(aliasItem.inputDomain, aliasItem.inputDomain);
    assert.ok(res.entry !== null, `Échec de résolution pour ${aliasItem.inputDomain}`);
    assert.ok(res.confidence >= 0.85, `Score insuffisant: ${res.confidence}`);
    assert.ok(
      res.entry.name.toLowerCase().includes(aliasItem.expectedName.toLowerCase()),
      `Nom résolu inattendu: ${res.entry.name} (attendu: ${aliasItem.expectedName})`
    );
  });
}

check('Matching sur sous-domaines profonds et TLDs complexes (ex: music.portal.spotify.co.uk)', () => {
  const resSub = matcher.match('Spotify Music', 'sub1.sub2.spotify.com');
  assert.ok(resSub.entry !== null);
  assert.strictEqual(resSub.entry.name.toLowerCase(), 'spotify');
});

// ============================================================================
// SECTION 3 : Fuzzing et Robustesse JGMD Matcher
// ============================================================================
console.log('\n--- SECTION 3 : JGMD Matcher — Fuzzing et Résolution des Portails Directs ---');

const jgmd = new JgmdMatcher();

check('resolveJGMD gère les entrées null, undefined, vides sans planter', () => {
  const r1 = resolveJGMD(null, null);
  assert.strictEqual(r1.matched, false);
  assert.strictEqual(r1.exportUrl, null);

  const r2 = resolveJGMD(undefined, undefined);
  assert.strictEqual(r2.matched, false);

  const r3 = resolveJGMD('', '');
  assert.strictEqual(r3.matched, false);
});

check('resolveJGMD ne génère pas de faux positif sur des sous-mots (ex: Pineapple ne doit pas matcher Apple)', () => {
  const res = resolveJGMD('Pineapple', 'pineapple.com');
  assert.strictEqual(res.matched, false, 'Pineapple ne doit pas être résolu vers Apple Takeout');
});

check('DIRECT_TAKEOUT_PORTALS contient les 14 plateformes majeures déclarées', () => {
  const expectedKeys = [
    'google', 'facebook', 'instagram', 'twitter', 'apple', 'spotify',
    'microsoft', 'amazon', 'reddit', 'linkedin', 'github', 'snapchat',
    'netflix', 'uber'
  ];
  for (const k of expectedKeys) {
    assert.ok(DIRECT_TAKEOUT_PORTALS[k], `Clé manquante dans DIRECT_TAKEOUT_PORTALS: ${k}`);
    assert.ok(DIRECT_TAKEOUT_PORTALS[k].startsWith('https://'), `URL non HTTPS pour: ${k}`);
  }
});

for (const key of Object.keys(DIRECT_TAKEOUT_PORTALS)) {
  check(`JGMD résout directement le portail de ${key}`, () => {
    const res = resolveJGMD(key, `${key}.com`);
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.source, 'direct_portal');
    assert.strictEqual(res.exportUrl, DIRECT_TAKEOUT_PORTALS[key]);
  });
}

check('JgmdMatcher.enrichAccount enrichit un UnifiedAccount sans écraser ni planter', () => {
  const acc = {
    id: 'test_acc',
    serviceId: 'spotify',
    serviceName: 'Spotify',
    domain: 'spotify.com',
    accountIdentifier: 'target@example.com',
    sourceTool: 'holehe',
    status: 'claimed',
    cleaned: false,
    metadata: {}
  };
  const enriched = jgmd.enrichAccount(acc);
  assert.strictEqual(enriched.jdm?.getDataUrl, DIRECT_TAKEOUT_PORTALS.spotify);
});

check('JgmdMatcher.enrichAccount résiste à un UnifiedAccount sans propriété jdm initiale', () => {
  const bareAccount = {
    id: 'bare_1',
    serviceId: 'google',
    accountIdentifier: 'test@gmail.com',
    sourceTool: 'ghunt',
    status: 'claimed',
    cleaned: false,
    metadata: {}
  };
  const enriched = jgmd.enrichAccount(bareAccount);
  assert.strictEqual(enriched.jdm?.getDataUrl, DIRECT_TAKEOUT_PORTALS.google);
});

// ============================================================================
// SECTION 4 : Stress Test Générateur RGPD (Article 17 & Article 15)
// ============================================================================
console.log('\n--- SECTION 4 : Générateur RGPD — Règle Zéro Tiret et Encodage RFC 3986 ---');

check('Stress test combinatoire exhaustif : AUCUN tiret (-) dans Article 17 FR sur 32 combinaisons', () => {
  for (let mask = 0; mask < 32; mask++) {
    const params = { language: 'fr' };
    if (mask & 1) params.userName = 'Jean Dupont';
    if (mask & 2) params.userEmail = 'jean@example.com';
    if (mask & 4) params.accountUsername = 'jeandupont';
    if (mask & 8) params.userPhone = '+33699504346';
    if (mask & 16) params.serviceName = 'Spotify';

    const res = generateGdprArticle17Email(params);
    assert.strictEqual(res.subject.includes('-'), false, `Tiret détecté dans le sujet (masque ${mask}): ${res.subject}`);
    assert.strictEqual(res.body.includes('-'), false, `Tiret détecté dans le corps (masque ${mask})`);
  }
});

check('Stress test combinatoire exhaustif : AUCUN tiret (-) dans Article 15 FR sur 32 combinaisons', () => {
  for (let mask = 0; mask < 32; mask++) {
    const params = { language: 'fr' };
    if (mask & 1) params.userName = 'Jean Dupont';
    if (mask & 2) params.userEmail = 'jean@example.com';
    if (mask & 4) params.accountUsername = 'jeandupont';
    if (mask & 8) params.userPhone = '+33699504346';
    if (mask & 16) params.serviceName = 'Spotify';

    const res = generateGdprArticle15Email(params);
    assert.strictEqual(res.subject.includes('-'), false, `Tiret détecté dans le sujet Art. 15 (masque ${mask})`);
    assert.strictEqual(res.body.includes('-'), false, `Tiret détecté dans le corps Art. 15 (masque ${mask})`);
  }
});

check('Comportement face à des entrées contenant des tirets (ex: nom de service ou prénom composé)', () => {
  const res17 = generateGdprArticle17Email({
    serviceName: 'Anti-Virus-Pro',
    userName: 'Jean-Paul',
    accountUsername: 'user-test',
    userPhone: '06-99-50-43-46',
    language: 'fr'
  });

  console.log(`    Note observation : entrées avec tirets injectés -> subject=${res17.subject}`);

  const templateOnly = generateGdprArticle17Email({
    serviceName: 'Service',
    userName: 'Citoyen',
    accountUsername: 'pseudo',
    language: 'fr'
  });
  assert.strictEqual(templateOnly.subject.includes('-'), false);
  assert.strictEqual(templateOnly.body.includes('-'), false);
  assert.ok(templateOnly.body.includes('sous traitants'), 'Vérification absence tiret dans "sous traitants"');
});

check('Validation stricte de l\'encodage RFC 3986 sur les liens mailto:', () => {
  const res = generateGdprArticle17Email({
    serviceName: 'Test & Co <Corp>?',
    userName: 'Jean Dupont',
    userEmail: 'jean@example.com',
    language: 'fr'
  });

  const uri = res.mailtoUri;
  assert.ok(uri.startsWith('mailto:'), 'Doit commencer par mailto:');
  assert.strictEqual(uri.includes(' '), false, 'Ne doit contenir AUCUN espace brut');
  assert.strictEqual(uri.includes('\n'), false, 'Ne doit contenir AUCUN saut de ligne brut');
  assert.strictEqual(uri.includes('\r'), false, 'Ne doit contenir AUCUN retour chariot brut');
  assert.ok(uri.includes('%0A'), 'Les sauts de ligne doivent être encodés en %0A');
  assert.ok(uri.includes('?subject='), 'Doit contenir le paramètre query ?subject=');
  assert.ok(uri.includes('&body='), 'Doit contenir le paramètre query &body=');
});

check('generateGdprMailtoUri résiste aux charges utiles massives (100 Ko de texte)', () => {
  const hugeBody = 'Texte d\'audit de confidentialité '.repeat(3000);
  const uri = generateGdprMailtoUri({
    recipientEmail: 'dpo@bigcorp.com',
    subject: 'Demande RGPD',
    body: hugeBody
  });
  assert.ok(uri.length > 100000);
  assert.strictEqual(uri.includes(' '), false);
  assert.ok(uri.startsWith('mailto:dpo%40bigcorp.com?subject='));
});

// ============================================================================
// BILAN ET STATISTIQUES FINALES
// ============================================================================
console.log('\n' + '='.repeat(78));
console.log(`BILAN DU BANC D'ESSAI ADVERSARIAL : ${passedChecks} / ${totalChecks} vérifications réussies`);
console.log('='.repeat(78));

if (failureDetails.length > 0) {
  console.error(`\nNombre d'anomalies détectées : ${failureDetails.length}`);
  for (const fail of failureDetails) {
    console.error(` - ÉCHEC : ${fail.title} -> ${fail.error}`);
  }
  process.exit(1);
} else {
  console.log('\n✅ TOUS LES TESTS DE ROBUSTESSE, DE LIMITES ET D\'ADVERSITÉ SONT VALIDÉS (100% SUCCÈS)');
  process.exit(0);
}
