#!/usr/bin/env node
/**
 * Test Runner E2E Unifié pour OSINT & Privacy Suite
 * Exécution autonome sans dépendances externes tierces.
 * 
 * Usage : node tests/e2e/runner.js
 */

import { run } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const suites = [
  { name: 'Tier 1 : Couverture Unitaire des Fonctionnalités', file: 'tier1-feature-coverage.test.js' },
  { name: 'Tier 2 : Limites, Cas aux Bornes et Robustesse', file: 'tier2-boundary-corner.test.js' },
  { name: 'Tier 3 : Combinaisons Croisées (Pairwise) & Dédoublonnage', file: 'tier3-pairwise-combinations.test.js' },
  { name: 'Tier 4 : Scénarios Réels d\'Audit Complet de Bout en Bout', file: 'tier4-real-scenarios.test.js' }
];

console.log('='.repeat(78));
console.log('  OSINT & PRIVACY SUITE — HARNAIS DE TEST E2E BOÎTE OPAQUE');
console.log('='.repeat(78));
console.log(`Date d'exécution : ${new Date().toISOString()}`);
console.log(`Environnement    : Node.js ${process.version} (macOS ${process.arch})`);
console.log(`Nombre de suites : ${suites.length}`);
console.log('-'.repeat(78));

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
const suiteResults = [];

const startTime = Date.now();

for (const suite of suites) {
  const filePath = path.join(__dirname, suite.file);
  let suitePassed = 0;
  let suiteFailed = 0;
  let suiteSkipped = 0;
  const failures = [];

  const stream = run({
    files: [filePath]
  });

  for await (const event of stream) {
    if (event.type === 'test:pass') {
      // Compter uniquement les tests feuilles (pas les blocs describe)
      if (event.data.name.startsWith('T1.') || event.data.name.startsWith('T2.') || event.data.name.startsWith('T3.') || event.data.name.startsWith('T4.')) {
        suitePassed++;
      }
    } else if (event.type === 'test:fail') {
      if (event.data.name.startsWith('T1.') || event.data.name.startsWith('T2.') || event.data.name.startsWith('T3.') || event.data.name.startsWith('T4.')) {
        suiteFailed++;
        failures.push({ name: event.data.name, error: event.data.details?.error?.message || 'Erreur d\'assertion' });
      }
    }
  }

  totalPassed += suitePassed;
  totalFailed += suiteFailed;
  totalSkipped += suiteSkipped;

  suiteResults.push({
    name: suite.name,
    file: suite.file,
    passed: suitePassed,
    failed: suiteFailed,
    failures
  });

  const statusSymbol = suiteFailed === 0 ? '✅ SUCCÈS' : '❌ ÉCHEC';
  console.log(`[${statusSymbol}] ${suite.name} : ${suitePassed} passés, ${suiteFailed} échoués`);
  if (failures.length > 0) {
    for (const f of failures) {
      console.log(`   └─ ❌ ${f.name} : ${f.error}`);
    }
  }
}

const duration = Date.now() - startTime;

console.log('='.repeat(78));
console.log('RÉCAPITULATIF DE COUVERTURE PAR TIERS');
console.log('='.repeat(78));
console.log('| Tier   | Intitulé de la Suite                         | Passés | Échoués | Statut  |');
console.log('|:-------|:---------------------------------------------|:------:|:-------:|:-------:|');

for (let i = 0; i < suiteResults.length; i++) {
  const s = suiteResults[i];
  const tierLabel = `Tier ${i + 1}`;
  const padName = s.name.substring(0, 43).padEnd(43, ' ');
  const padPass = String(s.passed).padStart(6, ' ');
  const padFail = String(s.failed).padStart(7, ' ');
  const statusStr = s.failed === 0 ? ' PASS  ' : ' FAIL  ';
  console.log(`| ${tierLabel.padEnd(6, ' ')} | ${padName} | ${padPass} | ${padFail} | ${statusStr} |`);
}

console.log('-'.repeat(78));
console.log(`TOTAL   : ${totalPassed} tests passés, ${totalFailed} tests échoués (${duration} ms)`);
console.log('='.repeat(78));

if (totalFailed === 0 && totalPassed > 0) {
  console.log('🎉 TOUS LES TESTS E2E ONT ÉTÉ VALIDÉS AVEC SUCCÈS (Code de sortie 0)');
  process.exit(0);
} else {
  console.error(`❌ ÉCHEC : ${totalFailed} test(s) en erreur`);
  process.exit(1);
}
