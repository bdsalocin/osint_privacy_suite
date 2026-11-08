/**
 * Advanced Adversarial Re-verification Oracle — Jalon 2 Itération 2
 * Privacy Adversarial Challenger (teamwork_challenger_m2_it2_1)
 */

import assert from 'node:assert';
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

import { createStorageEngine } from '../dist/src/storage/database.js';

console.log('='.repeat(78));
console.log('  CHALLENGER M2.IT2 — CONTRE-ÉPREUVE ADVERSARIALE AVANCÉE');
console.log('='.repeat(78));

let passed = 0;
let total = 0;
const failures = [];

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name} -> ${err.message}`);
    failures.push({ name, error: err.message, stack: err.stack });
  }
}

const matcher = new JdmMatcher();

// ============================================================================
// PART 1 : Re-verification of the 6 Initial Vulnerabilities
// ============================================================================
console.log('\n--- PARTIE 1 : Re-vérification des 6 anomalies initiales ---');

test('Anomaly 1 Fix: cleanDomain(null) and cleanDomain(undefined) return empty string', () => {
  assert.strictEqual(cleanDomain(null), '');
  assert.strictEqual(cleanDomain(undefined), '');
  assert.strictEqual(cleanDomain(''), '');
});

test('Anomaly 2 Fix: empty and whitespace queries return entry null and confidence 0', () => {
  const empty = matcher.match('', '');
  assert.strictEqual(empty.entry, null);
  assert.strictEqual(empty.confidence, 0.0);
  assert.strictEqual(empty.matchedBy, 'none');

  const spaces = matcher.match('     ', '    ');
  assert.strictEqual(spaces.entry, null);
  assert.strictEqual(spaces.confidence, 0.0);
  assert.strictEqual(spaces.matchedBy, 'none');
});

test('Anomaly 3 Fix: unreferenced/empty accounts are NOT enriched as 123RF', () => {
  const account = {
    id: 'anon_1',
    serviceId: '',
    serviceName: '',
    accountIdentifier: 'victim@target.org',
    sourceTool: 'holehe',
    status: 'claimed',
    cleaned: false,
    metadata: {}
  };
  const enriched = matcher.enrichAccount(account);
  assert.strictEqual(enriched.jdm?.matched, false);
  assert.strictEqual(enriched.jdm?.difficulty, 'unknown');
  assert.strictEqual(enriched.jdm?.deleteUrl, undefined);
});

test('Anomaly 4 Fix: Distance, Constant, ServiceInexistant9999 do not match Stan', () => {
  const r1 = matcher.match('Distance', 'distance.fr');
  assert.strictEqual(r1.entry, null);
  assert.strictEqual(r1.confidence, 0.0);

  const r2 = matcher.match('Constant', 'constant.fr');
  assert.strictEqual(r2.entry, null);
  assert.strictEqual(r2.confidence, 0.0);

  const r3 = matcher.match('ServiceInexistant9999', 'inexistant.com');
  assert.strictEqual(r3.entry, null);
  assert.strictEqual(r3.confidence, 0.0);
});

test('Anomaly 5 Fix: Pineapple does NOT match Apple Takeout in JGMD', () => {
  const res = resolveJGMD('Pineapple', 'pineapple.com');
  assert.strictEqual(res.matched, false);
  assert.strictEqual(res.exportUrl, null);
  assert.strictEqual(res.source, 'none');
});

test('Anomaly 6 Fix: French GDPR templates contain zero hyphens', () => {
  const r17 = generateGdprArticle17Email({ language: 'fr' });
  const r15 = generateGdprArticle15Email({ language: 'fr' });
  assert.strictEqual(r17.subject.includes('-'), false);
  assert.strictEqual(r17.body.includes('-'), false);
  assert.strictEqual(r15.subject.includes('-'), false);
  assert.strictEqual(r15.body.includes('-'), false);
});

// ============================================================================
// PART 2 : Extreme Boundary Cases on jdm-matcher
// ============================================================================
console.log('\n--- PARTIE 2 : Cas limites extrêmes et Fuzzing JDM ---');

test('Ultra-short 1-character queries (non-existent) return entry null and 0 confidence', () => {
  const singleChars = ['a', 'b', 'c', '1', '9', 'z', '!', '?', '#', '@', '\n', '\t'];
  for (const c of singleChars) {
    const res = matcher.match(c, '');
    assert.strictEqual(res.entry, null, `Single char "${c}" should not match any service`);
    assert.strictEqual(res.confidence, 0.0);
    assert.strictEqual(res.matchedBy, 'none');
  }
});

test('Ultra-short 1-character queries (existing in JDM, e.g. "X") match accurately', () => {
  const res = matcher.match('X', 'x.com');
  assert.ok(res.entry !== null);
  assert.strictEqual(res.entry?.name, 'X');
});

test('Ultra-short 2-letter queries: legitimate services (e.g. "QQ", "HP") match, non-existent return null', () => {
  // Real services in JDM
  const qqRes = matcher.match('QQ', 'qq.com');
  assert.ok(qqRes.entry !== null);
  assert.strictEqual(qqRes.entry?.name, 'QQ');

  const hpRes = matcher.match('HP', 'hp.com');
  assert.ok(hpRes.entry !== null);
  assert.strictEqual(hpRes.entry?.name, 'HP');

  // Truly non-existent 2-letter strings
  const nonExistent = ['zz', 'jj', 'ww', 'xy', '99', 'qx', 'zx'];
  for (const s of nonExistent) {
    const res = matcher.match(s, `${s}.biz`);
    assert.strictEqual(res.entry, null, `Two-char "${s}" should not match`);
    assert.strictEqual(res.confidence, 0.0);
  }
});

test('Non-breaking spaces (NBSP \\u00A0, narrow NBSP \\u202F, ideographic \\u3000) tokenization', () => {
  // Should properly isolate known brand tokens despite non-breaking spaces
  const resNbsp = matcher.match('Spotify\u00A0Premium', '');
  assert.ok(resNbsp.entry !== null, 'Should match Spotify token with NBSP');
  assert.strictEqual(resNbsp.entry?.name.toLowerCase(), 'spotify');

  const resNarrow = matcher.match('Spotify\u202FMusic', '');
  assert.ok(resNarrow.entry !== null, 'Should match Spotify with narrow NBSP');

  const resIdeo = matcher.match('Spotify\u3000Service', '');
  assert.ok(resIdeo.entry !== null, 'Should match Spotify with ideographic space');
});

test('Unicode characters, accents and composite French service names', () => {
  // Should not crash and should return safe results
  const unicodeList = [
    'Société Générale',
    'Crédit Agricole',
    'Électricité de France',
    'Pôle Emploi',
    'Über Eats',
    'Яндекс Почта',
    '百度云盘',
    'Last.fm (Audioscrobbler)',
    'Mercedes-Benz Me'
  ];
  for (const name of unicodeList) {
    const res = matcher.match(name, 'custom-domain.fr');
    assert.strictEqual(typeof res.confidence, 'number');
    assert.ok(res.confidence >= 0.0 && res.confidence <= 1.0);
  }
});

test('Adversarial injections, null bytes, prototype pollution and huge inputs', () => {
  const hostile = [
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'valueOf',
    '\x00\x00\x00',
    '../../../etc/shadow',
    '{"$gt": ""}',
    '<svg/onload=alert(1)>',
    'A'.repeat(50000)
  ];
  for (const h of hostile) {
    const res = matcher.match(h, h);
    assert.strictEqual(typeof res.confidence, 'number');
    assert.ok(res.confidence >= 0.0 && res.confidence <= 1.0);
  }
});

// ============================================================================
// PART 3 : Deep Adversarial Stress on jgmd-matcher
// ============================================================================
console.log('\n--- PARTIE 3 : Cas limites et Stress Test JGMD ---');

test('Sub-word false positive immunity: words containing portal names do NOT match', () => {
  const subwords = [
    { service: 'Snapple', domain: 'snapple.com' },
    { service: 'Applesauce', domain: 'applesauce.org' },
    { service: 'PineappleExpress', domain: 'pineappleexpress.net' },
    { service: 'Superuber', domain: 'superuber.com' },
    { service: 'Microstrategy', domain: 'microstrategy.com' },
    { service: 'Facebooker', domain: 'facebooker.net' },
    { service: 'Bookface', domain: 'bookface.io' },
    { service: 'Flixbus', domain: 'flixbus.fr' },
    { service: 'ChitChat', domain: 'chitchat.com' },
    { service: 'Snapchatting', domain: 'snapchatting.com' },
    { service: 'Dooogle', domain: 'dooogle.com' }
  ];
  for (const item of subwords) {
    const res = resolveJGMD(item.service, item.domain);
    assert.strictEqual(res.matched, false, `Faux positif détecté pour ${item.service}`);
    assert.strictEqual(res.exportUrl, null);
  }
});

test('Legitimate brand variations of direct portals match correctly', () => {
  const legit = [
    { service: 'Google Workspace', domain: 'workspace.google.com', expected: DIRECT_TAKEOUT_PORTALS.google },
    { service: 'Apple Music', domain: 'music.apple.com', expected: DIRECT_TAKEOUT_PORTALS.apple },
    { service: 'Spotify Premium', domain: 'spotify.com', expected: DIRECT_TAKEOUT_PORTALS.spotify },
    { service: 'Microsoft 365', domain: 'office.com', expected: DIRECT_TAKEOUT_PORTALS.microsoft },
    { service: 'Amazon Prime', domain: 'amazon.com', expected: DIRECT_TAKEOUT_PORTALS.amazon },
    { service: 'GitHub Enterprise', domain: 'github.com', expected: DIRECT_TAKEOUT_PORTALS.github },
    { service: 'Reddit Gold', domain: 'reddit.com', expected: DIRECT_TAKEOUT_PORTALS.reddit }
  ];
  for (const item of legit) {
    const res = resolveJGMD(item.service, item.domain);
    assert.strictEqual(res.matched, true, `Should match legitimate portal for ${item.service}`);
    assert.strictEqual(res.exportUrl, item.expected);
    assert.strictEqual(res.source, 'direct_portal');
  }
});

test('International ccTLD matching for major platforms', () => {
  const intl = [
    { service: 'Google', domain: 'google.fr', expected: DIRECT_TAKEOUT_PORTALS.google },
    { service: 'Amazon', domain: 'amazon.co.uk', expected: DIRECT_TAKEOUT_PORTALS.amazon },
    { service: 'Spotify', domain: 'spotify.de', expected: DIRECT_TAKEOUT_PORTALS.spotify }
  ];
  for (const item of intl) {
    const res = resolveJGMD(item.service, item.domain);
    assert.strictEqual(res.matched, true);
    assert.strictEqual(res.exportUrl, item.expected);
  }
});

// ============================================================================
// PART 4 : Absolute Zero-Hyphen Compliance in French GDPR Generator
// ============================================================================
console.log('\n--- PARTIE 4 : Règle absolue Zéro Tiret dans les modèles RGPD ---');

test('Comprehensive matrix of French Article 17 and Article 15 emails contains ZERO hyphens', () => {
  const names = ['Jean Dupont', 'Jean Paul Dupont', 'Marie Curie'];
  const services = ['Spotify', 'Google', 'Le Figaro', 'Societe Generale'];
  const emails = ['jean@example.com', 'test.user@domain.fr'];
  const phones = ['0699504346', '+33699504346'];

  for (const name of names) {
    for (const service of services) {
      for (const email of emails) {
        for (const phone of phones) {
          const params = {
            language: 'fr',
            userName: name,
            serviceName: service,
            userEmail: email,
            userPhone: phone,
            accountUsername: 'citoyen'
          };

          const r17 = generateGdprArticle17Email(params);
          const r15 = generateGdprArticle15Email(params);

          assert.strictEqual(
            r17.subject.includes('-'),
            false,
            `Hyphen detected in Art 17 subject: ${r17.subject}`
          );
          assert.strictEqual(
            r17.body.includes('-'),
            false,
            `Hyphen detected in Art 17 body for service ${service}`
          );

          assert.strictEqual(
            r15.subject.includes('-'),
            false,
            `Hyphen detected in Art 15 subject: ${r15.subject}`
          );
          assert.strictEqual(
            r15.body.includes('-'),
            false,
            `Hyphen detected in Art 15 body for service ${service}`
          );
        }
      }
    }
  }
});

test('Default text strings in GDPR generator do not contain "sous-traitants" or hyphens', () => {
  const r17 = generateGdprArticle17Email({ language: 'fr' });
  assert.ok(r17.body.includes('sous traitants'), 'Must use "sous traitants" without hyphen');
  assert.strictEqual(r17.body.includes('sous-traitants'), false, 'Must not use "sous-traitants" with hyphen');
});

// ============================================================================
// PART 5 : Storage Engine Reliability & Invariant Verification
// ============================================================================
console.log('\n--- PARTIE 5 : Vérification de la persistance locale SQLite ---');

test('StorageEngine default deadline is sent_date + 30 days', () => {
  const storage = createStorageEngine(':memory:');
  const scanId = storage.createScan({ title: 'Test 30 days' });
  const customSent = '2026-05-01T10:00:00.000Z';
  const reqId = storage.saveGdprRequest({
    scanId,
    serviceName: 'TestService',
    recipientEmail: 'dpo@test.com',
    sentDate: customSent
  });

  const requests = storage.getGdprRequests(scanId);
  assert.strictEqual(requests.length, 1);
  const expectedDeadline = new Date(new Date(customSent).getTime() + 30 * 24 * 3600 * 1000).toISOString();
  assert.strictEqual(requests[0].deadline_date, expectedDeadline);
  storage.close();
});

test('StorageEngine close() is strictly idempotent and safe against multiple invocations', () => {
  const storage = createStorageEngine(':memory:');
  storage.createScan({ title: 'Idempotent close test' });
  storage.close();
  // Call multiple times: should not throw
  storage.close();
  storage.close();
});

test('StorageEngine saveAccounts runs in atomic transaction and handles mass insertion', () => {
  const storage = createStorageEngine(':memory:');
  const scanId = storage.createScan({ title: 'Mass insertion' });
  const accounts = [];
  for (let i = 0; i < 500; i++) {
    accounts.push({
      scanId,
      serviceName: `Service_${i}`,
      domain: `service${i}.com`,
      accountIdentifier: `user_${i}@example.com`,
      sourceTools: ['holehe'],
      jdm: { matched: false, difficulty: 'unknown' }
    });
  }
  storage.saveAccounts(accounts);
  const fetched = storage.getAccountsByScan(scanId);
  assert.strictEqual(fetched.length, 500);
  storage.close();
});

// ============================================================================
// SUMMARY
// ============================================================================
console.log('\n' + '='.repeat(78));
console.log(`RÉSULTAT TOTAL : ${passed} / ${total} assertions contradictoires validées`);
console.log('='.repeat(78));

if (failures.length > 0) {
  console.error(`\nNombre d'échecs : ${failures.length}`);
  for (const f of failures) {
    console.error(` - ÉCHEC : ${f.name} -> ${f.error}`);
  }
  process.exit(1);
} else {
  console.log('\n✅ SUCCÈS TOTAL : AUCUNE ANOMALIE NI RÉGRESSION DÉTECTÉE');
  process.exit(0);
}
