/**
 * OSINT & Privacy Suite — Storage & SQLite Concurrency Stress Harness
 * Adversarial Challenger 2 (Storage & SQLite Concurrency Challenger)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createStorageEngine } from '../dist/src/storage/database.js';
import {
  exportScanToJson,
  importScanFromJson,
  exportScanToFile,
  importScanFromFile,
  validateAuditCaseJson
} from '../dist/src/storage/json-store.js';

console.log('='.repeat(78));
console.log('  CHALLENGER 2 — STORAGE & SQLITE CONCURRENCY STRESS HARNESS');
console.log('='.repeat(78));
console.log(`Date : ${new Date().toISOString()}`);
console.log(`Node : ${process.version} (${process.platform} ${process.arch})`);
console.log('-'.repeat(78));

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;
const failures = [];

function assert(condition, message) {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
  } else {
    failedAssertions++;
    failures.push(message);
    console.error(`  ❌ [ÉCHEC] ${message}`);
  }
}

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger-storage-stress-'));

try {
  // =========================================================================
  // 1. TENTATIVES D'INJECTION SQL ADVERSARIALES
  // =========================================================================
  console.log('\n[TEST 1] Tentatives d\'Injection SQL & Robustesse des Requêtes Préparées');

  const sqlEngine = createStorageEngine(':memory:');

  const maliciousPayloads = [
    "' OR '1'='1",
    "'; DROP TABLE scans; --",
    "'; DROP TABLE discovered_accounts; --",
    "'; DROP TABLE gdpr_requests; --",
    "admin' UNION SELECT 'x','y','z','w','v','u','t','s','r' --",
    "\"><script>alert('xss')</script>'; DELETE FROM scans; --",
    "``test`` OR 1=1 --",
    "\" OR \"1\"=\"1",
    "/* comment */ ' OR 1=1 --",
    "’ OR 1=1 --",
    "test\\0' OR 1=1 --"
  ];

  // Test 1.1 : Injection dans createScan
  for (const payload of maliciousPayloads) {
    const scanId = sqlEngine.createScan({
      title: payload,
      targetEmail: `user_${payload}@example.com`,
      targetUsername: payload,
      targetPhone: payload,
      toolsSelected: [payload],
      summaryCounts: { [payload]: 123 }
    });

    const retrieved = sqlEngine.getScan(scanId);
    assert(retrieved !== null, `Scan créé avec payload SQL injection '${payload}' doit être récupérable`);
    assert(retrieved.title === payload, `Le titre doit contenir le payload littéral exact sans exécution SQL`);
    assert(retrieved.target_username === payload, `Le username doit être préservé littéralement`);
  }

  // Vérifier que la table scans existe toujours
  const scanCountBefore = sqlEngine.listScans().length;
  assert(scanCountBefore === maliciousPayloads.length, `La table scans doit contenir exactement ${maliciousPayloads.length} scans`);

  // Test 1.2 : Injection dans getScan et deleteScan
  for (const payload of maliciousPayloads) {
    const res = sqlEngine.getScan(payload);
    assert(res === null, `getScan('${payload}') ne doit rien retourner sans faire d'injection SQL`);

    const deleted = sqlEngine.deleteScan(payload);
    assert(deleted === false, `deleteScan('${payload}') ne doit pas supprimer de scan arbitraire`);
  }
  assert(sqlEngine.listScans().length === scanCountBefore, `Le nombre de scans ne doit pas avoir changé suite aux deleteScan malveillants`);

  // Test 1.3 : Injection dans saveAccounts
  const validScanId = sqlEngine.createScan({ title: 'Scan pour test injection comptes' });
  for (let i = 0; i < maliciousPayloads.length; i++) {
    const payload = maliciousPayloads[i];
    sqlEngine.saveAccounts([
      {
        id: `acc_inj_${i}_${crypto.randomUUID()}`,
        scanId: validScanId,
        serviceName: payload,
        accountIdentifier: payload,
        domain: `domain_${i}.com`,
        sourceTools: [payload],
        profileUrl: `https://${payload}`,
        jdm: {
          matched: true,
          difficulty: 'medium',
          notes: payload,
          notes_fr: payload,
          deleteUrl: payload
        },
        jgmd: {
          matched: true,
          exportUrl: payload,
          notes: payload
        },
        status: 'detected',
        statusNotes: payload
      }
    ]);
  }

  const injectedAccounts = sqlEngine.getAccountsByScan(validScanId);
  assert(injectedAccounts.length === maliciousPayloads.length, `Tous les comptes avec payloads malveillants doivent être insérés littéralement (${injectedAccounts.length}/${maliciousPayloads.length})`);
  const foundPayload = injectedAccounts.some(a => a.service_name === maliciousPayloads[0]);
  assert(foundPayload, `Le serviceName contenant '${maliciousPayloads[0]}' doit être conservé littéralement`);

  // Test 1.4 : Injection dans updateAccountStatus
  for (const payload of maliciousPayloads) {
    const updated = sqlEngine.updateAccountStatus(payload, 'completed', payload);
    assert(updated === false, `updateAccountStatus avec id malveillant doit retourner false et ne rien modifier`);
  }

  // Test 1.5 : Injection dans saveGdprRequest et getGdprRequests
  for (let i = 0; i < maliciousPayloads.length; i++) {
    const payload = maliciousPayloads[i];
    const reqId = sqlEngine.saveGdprRequest({
      scanId: validScanId,
      serviceName: payload,
      recipientEmail: `dpo_${i}@example.com`,
      legalBasis: 'GDPR_ART_17_ERASURE',
      emailSubject: payload,
      emailBody: payload,
      userNotes: payload
    });
    assert(typeof reqId === 'string', `saveGdprRequest doit supporter sans encombre le payload SQL`);
  }

  const maliciousRequests = sqlEngine.getGdprRequests(validScanId);
  assert(maliciousRequests.length === maliciousPayloads.length, `Toutes les demandes RGPD doivent être enregistrées sans altération de table`);

  // Vérifier qu'une recherche par scan_id malveillant ne retourne rien
  const leakCheck = sqlEngine.getGdprRequests("' OR '1'='1");
  assert(leakCheck.length === 0, `getGdprRequests avec payload d'injection ne doit retourner aucun résultat`);

  // Vérifier que toutes les tables SQLite de la base sont toujours intègres et fonctionnelles
  const tableCheck = sqlEngine.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tableNames = tableCheck.map(t => t.name);
  assert(tableNames.includes('scans'), 'Table scans toujours présente');
  assert(tableNames.includes('discovered_accounts'), 'Table discovered_accounts toujours présente');
  assert(tableNames.includes('gdpr_requests'), 'Table gdpr_requests toujours présente');

  sqlEngine.close();
  console.log('  -> Résultat Injection SQL : 100% des requêtes préparées neutralisent les tentatives');

  // =========================================================================
  // 2. ÉPREUVES DE VOLUME MASSIF (5 000 COMPTES) ET CONCURRENCE
  // =========================================================================
  console.log('\n[TEST 2] Épreuve de Volume Massif (5 000 comptes) & Benchmark de Performance');

  // Génération de 5 000 comptes distincts
  const VOLUME_COUNT = 5000;
  const accountsBatch = [];
  const testScanId = 'scan_volume_stress_5000';

  for (let i = 0; i < VOLUME_COUNT; i++) {
    accountsBatch.push({
      id: `acc_bulk_${i}`,
      scanId: testScanId,
      serviceName: `Service_${i % 250}`,
      serviceCategory: i % 2 === 0 ? 'Social' : 'Tech',
      accountIdentifier: `user_${i}@bulk-test.org`,
      profileUrl: `https://service${i % 250}.com/users/user_${i}`,
      domain: `service${i % 250}.com`,
      sourceTools: ['holehe', 'maigret'],
      jdm: {
        matched: i % 2 === 0,
        difficulty: (['easy', 'medium', 'hard', 'impossible', 'limited', 'unknown'])[i % 6],
        deleteUrl: `https://service${i % 250}.com/delete`,
        notes: `Note de suppression pour ${i}`
      },
      jgmd: {
        matched: i % 3 === 0,
        exportUrl: `https://service${i % 250}.com/takeout`
      },
      status: 'detected',
      firstSeenAt: new Date().toISOString()
    });
  }

  // Test 2.1 : Insertion massive sous transaction explicite (In-Memory)
  const memEngine = createStorageEngine(':memory:');
  memEngine.createScan({ id: testScanId, title: 'Massive Volume In-Memory' });

  const tStartMemTx = performance.now();
  memEngine.db.exec('BEGIN TRANSACTION');
  memEngine.saveAccounts(accountsBatch);
  memEngine.db.exec('COMMIT');
  const tDurationMemTx = performance.now() - tStartMemTx;

  const memCount = memEngine.getAccountsByScan(testScanId).length;
  assert(memCount === VOLUME_COUNT, `Insertion massive mémoire sous transaction : ${memCount} / ${VOLUME_COUNT} comptes`);
  console.log(`  -> Volume In-Memory sous transaction (5 000 comptes) : ${tDurationMemTx.toFixed(2)} ms (soit ${(VOLUME_COUNT / (tDurationMemTx / 1000)).toFixed(0)} comptes/sec)`);

  // Test 2.2 : Test de lecture et d'export JSON des 5 000 comptes
  const tStartExport = performance.now();
  const exportedJson = memEngine.exportScanToJson(testScanId);
  const tDurationExport = performance.now() - tStartExport;
  assert(typeof exportedJson === 'string' && exportedJson.length > 500000, 'Export JSON des 5 000 comptes généré avec succès');
  console.log(`  -> Sérialisation JSON (5 000 comptes, ${(exportedJson.length / 1024 / 1024).toFixed(2)} Mo) : ${tDurationExport.toFixed(2)} ms`);

  // Test 2.3 : Réimportation complète des 5 000 comptes dans une base vierge
  const memEngine2 = createStorageEngine(':memory:');
  const tStartImport = performance.now();
  memEngine2.db.exec('BEGIN TRANSACTION');
  const reimportedScanId = memEngine2.importScanFromJson(exportedJson);
  memEngine2.db.exec('COMMIT');
  const tDurationImport = performance.now() - tStartImport;

  const reimportedCount = memEngine2.getAccountsByScan(reimportedScanId).length;
  assert(reimportedCount === VOLUME_COUNT, `Réimportation JSON : ${reimportedCount} / ${VOLUME_COUNT} comptes récupérés`);
  console.log(`  -> Désérialisation & Importation JSON (5 000 comptes) : ${tDurationImport.toFixed(2)} ms`);

  memEngine.close();
  memEngine2.close();

  // Test 2.4 : Volume massif sur disque réel (Fichier SQLite physique)
  const diskDbPath = path.join(tmpBase, 'volume_stress.db');
  const diskEngine = createStorageEngine(diskDbPath);
  diskEngine.createScan({ id: testScanId, title: 'Massive Volume Disk' });

  const tStartDiskTx = performance.now();
  diskEngine.db.exec('BEGIN TRANSACTION');
  diskEngine.saveAccounts(accountsBatch);
  diskEngine.db.exec('COMMIT');
  const tDurationDiskTx = performance.now() - tStartDiskTx;

  const diskCount = diskEngine.getAccountsByScan(testScanId).length;
  assert(diskCount === VOLUME_COUNT, `Insertion massive disque sous transaction : ${diskCount} / ${VOLUME_COUNT} comptes`);
  const dbFileSize = fs.statSync(diskDbPath).size;
  console.log(`  -> Volume sur fichier disque sous transaction (5 000 comptes) : ${tDurationDiskTx.toFixed(2)} ms (Taille fichier : ${(dbFileSize / 1024 / 1024).toFixed(2)} Mo)`);
  diskEngine.close();

  // Test 2.5 : Accès concurrents (Lectures & Écritures rapides successives)
  console.log('\n[TEST 2.5] Épreuves de Concurrence & Entrelacement d\'Opérations Rapides');
  const concurDbPath = path.join(tmpBase, 'concurrency_test.db');
  const concurEngine = createStorageEngine(concurDbPath);

  const scanIds = [];
  for (let s = 0; s < 5; s++) {
    scanIds.push(concurEngine.createScan({ title: `Concur Scan ${s}` }));
  }

  const concurrentOperations = 100;
  const tStartConcur = performance.now();

  const tasks = [];
  for (let i = 0; i < concurrentOperations; i++) {
    const scanId = scanIds[i % scanIds.length];
    tasks.push(async () => {
      // Entrelacement lecture, insertion compte, mise à jour statut, création requête RGPD
      concurEngine.saveAccounts([{
        id: `concur_acc_${i}`,
        scanId,
        serviceName: `ServiceConcur_${i}`,
        accountIdentifier: `user_${i}@example.com`,
        domain: `concur${i}.com`
      }]);

      concurEngine.updateAccountStatus(`concur_acc_${i}`, 'completed', `Clôturé par worker ${i}`);

      concurEngine.saveGdprRequest({
        scanId,
        accountId: `concur_acc_${i}`,
        serviceName: `ServiceConcur_${i}`,
        recipientEmail: `dpo@concur${i}.com`,
        emailSubject: `Demande ${i}`,
        emailBody: `Corps ${i}`
      });

      const accounts = concurEngine.getAccountsByScan(scanId);
      const requests = concurEngine.getGdprRequests(scanId);
      return { accountsCount: accounts.length, requestsCount: requests.length };
    });
  }

  // Exécution asynchrone concurrente
  const results = await Promise.all(tasks.map(t => t()));
  const tDurationConcur = performance.now() - tStartConcur;

  assert(results.length === concurrentOperations, `Toutes les ${concurrentOperations} opérations concurrentes doivent aboutir`);
  const finalScans = concurEngine.listScans();
  assert(finalScans.length === 5, 'Tous les 5 scans sont préservés');
  console.log(`  -> ${concurrentOperations} opérations complexes concurrentes exécutées en ${tDurationConcur.toFixed(2)} ms sans aucun blocage ni deadlock`);
  concurEngine.close();

  // =========================================================================
  // 3. RÉSILIENCE, FICHIER CORROMPU, VERROUILLÉ ET CASCADE
  // =========================================================================
  console.log('\n[TEST 3] Résilience : Fichier Corrompu, Verrouillage & Intégrité Cascade');

  // Test 3.1 : Fichier de base SQLite complètement corrompu
  const corruptDbPath = path.join(tmpBase, 'corrupt.db');
  fs.writeFileSync(corruptDbPath, Buffer.from('NOT A SQLITE FILE HEADER GIBBERISH DATA CORRUPTED 0123456789\x00\xFF\xFE'));

  let corruptErrorCaught = false;
  let corruptErrorMessage = '';
  try {
    const corruptEngine = createStorageEngine(corruptDbPath);
    // Tenter une opération
    corruptEngine.createScan({ title: 'Test Corrupt' });
  } catch (err) {
    corruptErrorCaught = true;
    corruptErrorMessage = err.message;
  }
  assert(corruptErrorCaught === true, 'Une tentative d\'accès à une base corrompue DOIT lever une exception explicite');
  assert(/not a database|malformed|corrupt/i.test(corruptErrorMessage), `Le message d'erreur doit être explicite (obtenu : "${corruptErrorMessage}")`);
  console.log(`  -> Base corrompue : Erreur explicite levée sans crash silencieux ("${corruptErrorMessage}")`);

  // Test 3.2 : Base de données verrouillée en lecture seule (chmod 0400)
  const readonlyDbPath = path.join(tmpBase, 'readonly.db');
  // Créer une base valide d'abord
  const initialEngine = createStorageEngine(readonlyDbPath);
  initialEngine.createScan({ title: 'Scan Readonly Pre-fill' });
  initialEngine.close();

  // Appliquer le verrouillage lecture seule
  fs.chmodSync(readonlyDbPath, 0o400);

  let readonlyErrorCaught = false;
  let readonlyErrorMessage = '';
  try {
    const roEngine = createStorageEngine(readonlyDbPath);
    roEngine.createScan({ title: 'Should fail' });
  } catch (err) {
    readonlyErrorCaught = true;
    readonlyErrorMessage = err.message;
  }
  // Rétablir permissions pour nettoyage futur
  fs.chmodSync(readonlyDbPath, 0o600);

  assert(readonlyErrorCaught === true, 'Une tentative d\'écriture sur une base en lecture seule DOIT lever une erreur explicite');
  assert(/readonly|denied|read-only/i.test(readonlyErrorMessage), `Erreur de verrouillage explicite (obtenu : "${readonlyErrorMessage}")`);
  console.log(`  -> Base verrouillée : Erreur explicite levée ("${readonlyErrorMessage}")`);

  // Test 3.3 : Intégrité référentielle et suppression en cascade rigoureuse
  console.log('\n[TEST 3.3] Validation de la Suppression en Cascade (Multi-Scans)');
  const cascadeEngine = createStorageEngine(':memory:');

  const scanAlpha = cascadeEngine.createScan({ title: 'Scan Alpha' });
  const scanBeta = cascadeEngine.createScan({ title: 'Scan Beta' });

  // Insérer 50 comptes et 20 requêtes RGPD pour Alpha
  const alphaAccounts = [];
  for (let i = 0; i < 50; i++) {
    alphaAccounts.push({
      id: `acc_alpha_${i}`,
      scanId: scanAlpha,
      serviceName: `AlphaService_${i}`,
      accountIdentifier: `alpha_${i}@test.com`,
      domain: `alpha${i}.com`
    });
  }
  cascadeEngine.saveAccounts(alphaAccounts);

  for (let i = 0; i < 20; i++) {
    cascadeEngine.saveGdprRequest({
      scanId: scanAlpha,
      accountId: `acc_alpha_${i}`,
      serviceName: `AlphaService_${i}`,
      recipientEmail: `dpo@alpha${i}.com`,
      emailSubject: `Effacement ${i}`,
      emailBody: `Corps Alpha ${i}`
    });
  }

  // Insérer 30 comptes et 10 requêtes RGPD pour Beta
  const betaAccounts = [];
  for (let i = 0; i < 30; i++) {
    betaAccounts.push({
      id: `acc_beta_${i}`,
      scanId: scanBeta,
      serviceName: `BetaService_${i}`,
      accountIdentifier: `beta_${i}@test.com`,
      domain: `beta${i}.com`
    });
  }
  cascadeEngine.saveAccounts(betaAccounts);

  for (let i = 0; i < 10; i++) {
    cascadeEngine.saveGdprRequest({
      scanId: scanBeta,
      accountId: `acc_beta_${i}`,
      serviceName: `BetaService_${i}`,
      recipientEmail: `dpo@beta${i}.com`,
      emailSubject: `Effacement ${i}`,
      emailBody: `Corps Beta ${i}`
    });
  }

  // Vérifier l'état initial
  assert(cascadeEngine.getAccountsByScan(scanAlpha).length === 50, 'Alpha a 50 comptes');
  assert(cascadeEngine.getAccountsByScan(scanBeta).length === 30, 'Beta a 30 comptes');
  assert(cascadeEngine.getGdprRequests(scanAlpha).length === 20, 'Alpha a 20 requêtes RGPD');
  assert(cascadeEngine.getGdprRequests(scanBeta).length === 10, 'Beta a 10 requêtes RGPD');

  // Supprimer Scan Alpha
  const alphaDeleted = cascadeEngine.deleteScan(scanAlpha);
  assert(alphaDeleted === true, 'Scan Alpha supprimé');

  // Vérifier que Scan Alpha n'a plus rien
  assert(cascadeEngine.getScan(scanAlpha) === null, 'Scan Alpha introuvable');
  assert(cascadeEngine.getAccountsByScan(scanAlpha).length === 0, 'Comptes de Scan Alpha supprimés par cascade');
  assert(cascadeEngine.getGdprRequests(scanAlpha).length === 0, 'Requêtes RGPD de Scan Alpha supprimées par cascade');

  // Vérifier que Scan Beta est STRICTEMENT INTACT
  assert(cascadeEngine.getScan(scanBeta) !== null, 'Scan Beta intact');
  assert(cascadeEngine.getAccountsByScan(scanBeta).length === 30, 'Les 30 comptes de Scan Beta sont toujours présents');
  assert(cascadeEngine.getGdprRequests(scanBeta).length === 10, 'Les 10 requêtes RGPD de Scan Beta sont toujours présentes');

  // Test 3.4 : Suppression d'un compte individuel -> account_id mis à NULL (SET NULL) sans supprimer la requête RGPD
  const singleAccToDelete = 'acc_beta_0';
  cascadeEngine.db.prepare('DELETE FROM discovered_accounts WHERE id = ?').run(singleAccToDelete);

  const betaAccountsAfterSingleDelete = cascadeEngine.getAccountsByScan(scanBeta);
  assert(betaAccountsAfterSingleDelete.length === 29, 'Il reste 29 comptes dans Beta');

  const betaRequests = cascadeEngine.getGdprRequests(scanBeta);
  assert(betaRequests.length === 10, 'Les 10 requêtes RGPD de Beta existent toujours');
  const orphanedRequest = betaRequests.find(r => r.service_name === 'BetaService_0');
  assert(orphanedRequest !== undefined, 'La requête pour BetaService_0 existe toujours');
  assert(orphanedRequest.account_id === null, 'La clé account_id a bien été passée à NULL (SET NULL) sans fuite ni suppression');

  // Test 3.5 : Insertion d'un compte avec un scan_id inexistant -> Violation de clé étrangère
  let fkErrorCaught = false;
  try {
    cascadeEngine.saveAccounts([{
      id: 'ghost_acc',
      scanId: 'non_existent_scan_xyz',
      serviceName: 'GhostService',
      accountIdentifier: 'ghost',
      domain: 'ghost.com'
    }]);
  } catch (err) {
    fkErrorCaught = true;
    assert(/FOREIGN KEY/i.test(err.message), 'L\'erreur doit être une violation de clé étrangère');
  }
  assert(fkErrorCaught === true, 'L\'insertion avec scan_id inexistant doit être rejetée par contrainte de clé étrangère');

  cascadeEngine.close();
  console.log('  -> Cascade et Intégrité référentielle SQLite validées à 100%');

  // =========================================================================
  // 4. ROBUSTESSE & INTÉGRITÉ DU MAGASIN JSON (json-store.ts)
  // =========================================================================
  console.log('\n[TEST 4] Robustesse & Intégrité du Magasin JSON (Validation & Rejet)');

  const jsonEngine = createStorageEngine(':memory:');

  const invalidJsonTestCases = [
    { name: 'JSON syntaxiquement invalide (tronqué)', content: '{"version": "1.0", "scan": { "id": "sc_1", "title": ' },
    { name: 'Chaîne vide', content: '' },
    { name: 'Chaîne non-JSON', content: 'Ceci n\'est pas du JSON' },
    { name: 'Objet vide', content: '{}' },
    { name: 'Objet sans scan', content: JSON.stringify({ version: '1.0', accounts: [] }) },
    { name: 'Scan sans id', content: JSON.stringify({ scan: { title: 'Sans id' }, accounts: [] }) },
    { name: 'Accounts n\'est pas un tableau (chaîne)', content: JSON.stringify({ scan: { id: 's_1' }, accounts: 'invalid' }) },
    { name: 'Accounts n\'est pas un tableau (objet)', content: JSON.stringify({ scan: { id: 's_1' }, accounts: { test: 1 } }) },
    { name: 'Accounts n\'est pas un tableau (nombre)', content: JSON.stringify({ scan: { id: 's_1' }, accounts: 42 }) },
    { name: 'Valeur null', content: 'null' },
    { name: 'Nombre au lieu d\'objet', content: '12345' },
    { name: 'Booléen au lieu d\'objet', content: 'true' }
  ];

  for (const tc of invalidJsonTestCases) {
    let rejected = false;
    try {
      importScanFromJson(jsonEngine, tc.content);
    } catch (err) {
      rejected = true;
    }
    assert(rejected === true, `Import de ${tc.name} doit être rejeté sans crash`);
  }

  // Vérifier que la base est toujours vide et non corrompue
  assert(jsonEngine.listScans().length === 0, 'La base reste propre après tous les rejets JSON malformés');

  // Test 4.2 : Écriture atomique et gestion des chemins inexistants
  const nonExistentFile = path.join(tmpBase, 'non_existent_folder', 'file.json');
  let fileNotFoundError = false;
  try {
    importScanFromFile(jsonEngine, nonExistentFile);
  } catch (err) {
    fileNotFoundError = true;
    assert(err.message.includes('Fichier introuvable'), 'Erreur explicite sur fichier introuvable');
  }
  assert(fileNotFoundError === true, 'importScanFromFile sur chemin inexistant doit lever une exception');

  // Test 4.3 : Écriture atomique avec création automatique des sous-dossiers
  const testExportScanId = jsonEngine.createScan({ title: 'Scan Atomique Test' });
  const deepFilePath = path.join(tmpBase, 'deeply', 'nested', 'export_case.json');
  exportScanToFile(jsonEngine, testExportScanId, deepFilePath);
  assert(fs.existsSync(deepFilePath), 'Le fichier exporté dans des sous-dossiers imbriqués doit être créé');

  // Tentative de réimport dans la même base : doit lever une contrainte UNIQUE (pas d'écrasement sauvage)
  let duplicateScanCaught = false;
  try {
    importScanFromFile(jsonEngine, deepFilePath);
  } catch (err) {
    duplicateScanCaught = true;
    assert(/UNIQUE constraint failed/i.test(err.message), 'La réimportation dans la même base lève une erreur de contrainte UNIQUE');
  }
  assert(duplicateScanCaught === true, 'Import d\'un scan déjà existant dans la même base lève une contrainte UNIQUE explicite');

  // Importation dans une base fraîche : succès attendu
  const jsonEngineFresh = createStorageEngine(':memory:');
  const reloadedId = importScanFromFile(jsonEngineFresh, deepFilePath);
  assert(reloadedId === testExportScanId, 'Rechargement du fichier exporté identique au scan source dans une base cible');
  jsonEngineFresh.close();
  jsonEngine.close();
  console.log('  -> Validation et Intégrité JSON : 100% des cas d\'erreur et d\'import malformé rejetés proprement');

  // =========================================================================
  // 5. ATOMICITÉ ACID, ROLLBACK, RÉENTRANCE & IDEMPOTENCE (JALON 2 ITÉRATION 2)
  // =========================================================================
  console.log('\n[TEST 5] Atomicité ACID, Rollback, Réentrance & Idempotence de Fermeture');

  // Test 5.1 : Rollback atomique de saveAccounts lors d'une erreur runtime au milieu du batch
  const acidEngine = createStorageEngine(':memory:');
  const acidScanId = acidEngine.createScan({ title: 'Scan ACID Rollback' });

  let saveAccountsRuntimeErrorCaught = false;
  try {
    acidEngine.saveAccounts([
      { id: 'acc_acid_1', scanId: acidScanId, serviceName: 'ValidService1', domain: 'valid1.com' },
      { id: 'acc_acid_2', scanId: acidScanId, serviceName: 'ValidService2', domain: 'valid2.com' },
      {
        id: 'acc_acid_fail',
        scanId: acidScanId,
        get serviceName() { throw new Error('Erreur simulée au milieu de saveAccounts'); }
      }
    ]);
  } catch (err) {
    saveAccountsRuntimeErrorCaught = true;
    assert(err.message.includes('Erreur simulée au milieu de saveAccounts'), 'Erreur attendue capturée');
  }
  assert(saveAccountsRuntimeErrorCaught === true, 'saveAccounts doit lever l\'exception levée par le batch');
  const accountsAfterRuntimeRollback = acidEngine.getAccountsByScan(acidScanId);
  assert(accountsAfterRuntimeRollback.length === 0, 'Rollback ACID : aucun compte partiel ne doit subsister après erreur runtime');

  // Test 5.2 : Rollback atomique de saveAccounts lors d'une violation de clé étrangère
  let saveAccountsFkErrorCaught = false;
  try {
    acidEngine.saveAccounts([
      { id: 'acc_acid_valid', scanId: acidScanId, serviceName: 'ValidService3', domain: 'valid3.com' },
      { id: 'acc_acid_bad_fk', scanId: 'non_existent_scan_id_xyz', serviceName: 'BadFkService', domain: 'badfk.com' }
    ]);
  } catch (err) {
    saveAccountsFkErrorCaught = true;
    assert(/FOREIGN KEY/i.test(err.message), 'Violation FK SQLite capturée');
  }
  assert(saveAccountsFkErrorCaught === true, 'saveAccounts doit échouer sur violation FK');
  const accountsAfterFkRollback = acidEngine.getAccountsByScan(acidScanId);
  assert(accountsAfterFkRollback.length === 0, 'Rollback ACID : aucun compte persistant après échec de clé étrangère');

  // Test 5.3 : Reprise immédiate des écritures sur le même moteur après rollback
  acidEngine.saveAccounts([
    { id: 'acc_acid_recovered', scanId: acidScanId, serviceName: 'RecoveredService', domain: 'recovered.com' }
  ]);
  const recoveredAccounts = acidEngine.getAccountsByScan(acidScanId);
  assert(recoveredAccounts.length === 1 && recoveredAccounts[0].id === 'acc_acid_recovered', 'Le moteur SQLite reste opérationnel et transactionnel après un rollback');

  // Test 5.4 : Rollback atomique total de importScanFromJson lors d'un échec de contrainte RGPD
  const badGdprImportPayload = {
    version: '1.0',
    scan: { id: 'scan_acid_gdpr_fail', title: 'Scan avec RGPD Invalide' },
    accounts: [
      { id: 'acc_imp_1', service_name: 'ImpService1', domain: 'imp1.com' },
      { id: 'acc_imp_2', service_name: 'ImpService2', domain: 'imp2.com' }
    ],
    gdprRequests: [
      {
        id: 'req_imp_bad',
        service_name: 'ImpService1',
        recipient_email: 'dpo@imp1.com',
        legal_basis: 'INVALID_BASIS_FOR_CHECK_CONSTRAINT'
      }
    ]
  };

  let importGdprErrorCaught = false;
  try {
    acidEngine.importScanFromJson(badGdprImportPayload);
  } catch (err) {
    importGdprErrorCaught = true;
    assert(/CHECK constraint failed/i.test(err.message), 'Violation CHECK constraint sur legal_basis');
  }
  assert(importGdprErrorCaught === true, 'importScanFromJson doit rejeter le payload avec requête RGPD non conforme');
  assert(acidEngine.getScan('scan_acid_gdpr_fail') === null, 'Rollback ACID : le scan ne doit pas être créé en cas d\'échec RGPD');
  assert(acidEngine.getAccountsByScan('scan_acid_gdpr_fail').length === 0, 'Rollback ACID : aucun compte du scan échoué ne doit subsister');
  assert(acidEngine.getGdprRequests('scan_acid_gdpr_fail').length === 0, 'Rollback ACID : aucune requête RGPD ne doit subsister');

  // Test 5.5 : Rollback atomique total de importScanFromJson lors d'un crash au 51ème compte
  const fiftyAccounts = [];
  for (let i = 0; i < 50; i++) {
    fiftyAccounts.push({
      id: `acc_fifty_${i}`,
      service_name: `FiftyService_${i}`,
      domain: `fifty${i}.com`
    });
  }
  fiftyAccounts.push({
    id: 'acc_fifty_crash',
    get domain() { throw new Error('Crash getter au 51eme compte'); }
  });

  let importAccountsErrorCaught = false;
  try {
    acidEngine.importScanFromJson({
      version: '1.0',
      scan: { id: 'scan_fifty_crash', title: 'Crash Comptes Mid-Stream' },
      accounts: fiftyAccounts
    });
  } catch (err) {
    importAccountsErrorCaught = true;
    assert(err.message.includes('Crash getter au 51eme compte'), 'Crash miroir capturé');
  }
  assert(importAccountsErrorCaught === true, 'importScanFromJson propage l\'exception du compte défaillant');
  assert(acidEngine.getScan('scan_fifty_crash') === null, 'Rollback ACID : scan annulé après échec mi-parcours');
  assert(acidEngine.getAccountsByScan('scan_fifty_crash').length === 0, 'Rollback ACID : l\'ensemble des 50 comptes créés avant le crash sont annulés');

  // Test 5.6 : Rollback atomique sur collision UNIQUE de scan id déjà existant
  const existingScanForDup = acidEngine.createScan({ title: 'Scan Original Non Écrasable' });
  let dupScanErrorCaught = false;
  try {
    acidEngine.importScanFromJson({
      version: '1.0',
      scan: { id: existingScanForDup, title: 'Tentative d\'écrasement illégitime' },
      accounts: [{ id: 'acc_dup_bad', service_name: 'DupService' }]
    });
  } catch (err) {
    dupScanErrorCaught = true;
    assert(/UNIQUE constraint failed/i.test(err.message), 'Violation contrainte UNIQUE sur id');
  }
  assert(dupScanErrorCaught === true, 'Collision d\'ID rejetée avec contrainte UNIQUE');
  const scanUnchanged = acidEngine.getScan(existingScanForDup);
  assert(scanUnchanged.title === 'Scan Original Non Écrasable', 'Le scan préexistant conserve son intégrité');
  assert(acidEngine.getAccountsByScan(existingScanForDup).length === 0, 'Aucun compte parasitaire n\'a été injecté');

  // Test 5.7 : Non-collision transactionnelle (Réentrance avec BEGIN TRANSACTION manuel)
  acidEngine.db.exec('BEGIN TRANSACTION;');
  acidEngine.saveAccounts([
    { id: 'acc_reent_1', scanId: acidScanId, serviceName: 'Reentrant1', domain: 'reent1.com' }
  ]);
  acidEngine.saveAccounts([
    { id: 'acc_reent_2', scanId: acidScanId, serviceName: 'Reentrant2', domain: 'reent2.com' }
  ]);
  acidEngine.db.exec('COMMIT;');
  const reentrantAccounts = acidEngine.getAccountsByScan(acidScanId);
  assert(reentrantAccounts.some(a => a.id === 'acc_reent_1'), 'Compte 1 validé sous transaction réentrante externe');
  assert(reentrantAccounts.some(a => a.id === 'acc_reent_2'), 'Compte 2 validé sous transaction réentrante externe');

  // Test 5.8 : Réentrance avec importScanFromJson imbriqué dans une transaction externe
  acidEngine.db.exec('BEGIN TRANSACTION;');
  const nestedScanId = acidEngine.importScanFromJson({
    version: '1.0',
    scan: { id: 'scan_nested_outer_tx', title: 'Nested Outer Tx' },
    accounts: [{ id: 'acc_nested_1', service_name: 'NestedService' }],
    gdprRequests: [{ id: 'req_nested_1', service_name: 'NestedService', recipient_email: 'dpo@nested.com' }]
  });
  acidEngine.db.exec('COMMIT;');
  assert(acidEngine.getScan(nestedScanId) !== null, 'Scan importé avec succès sous transaction externe parente');
  assert(acidEngine.getAccountsByScan(nestedScanId).length === 1, 'Compte importé avec succès sous transaction externe parente');
  assert(acidEngine.getGdprRequests(nestedScanId).length === 1, 'Requête RGPD importée sous transaction externe parente');

  // Test 5.9 : Annulation globale via ROLLBACK externe
  acidEngine.db.exec('BEGIN TRANSACTION;');
  const scanToRollbackOuter = acidEngine.importScanFromJson({
    version: '1.0',
    scan: { id: 'scan_outer_rollback', title: 'Outer Rollback Test' },
    accounts: [{ id: 'acc_outer_rb', service_name: 'OuterRb' }]
  });
  acidEngine.db.exec('ROLLBACK;');
  assert(acidEngine.getScan(scanToRollbackOuter) === null, 'Scan entièrement annulé par le ROLLBACK externe');
  assert(acidEngine.getAccountsByScan(scanToRollbackOuter).length === 0, 'Comptes entièrement annulés par le ROLLBACK externe');

  // Test 5.10 : Idempotence de close()
  acidEngine.close();
  // Appels répétés consécutifs sans exception
  for (let i = 0; i < 50; i++) {
    acidEngine.close();
  }
  assert(true, 'Fermeture idempotente : 50 appels consécutifs à close() sans aucune exception');

  // Fermeture pendant une transaction ouverte : aucune exception
  const engineTxClose = createStorageEngine(':memory:');
  engineTxClose.db.exec('BEGIN TRANSACTION;');
  engineTxClose.close();
  engineTxClose.close();
  assert(true, 'Fermeture pendant une transaction active exécutée sans crash');

  console.log('  -> Atomicité ACID & Idempotence : 100% des tests de rollback et de réentrance validés');

} finally {
  // Nettoyage des fichiers temporaires
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {}
}

// =========================================================================
// BILAN DES TESTS
// =========================================================================
console.log('\n' + '='.repeat(78));
console.log(`BILAN DU BANC D'ÉPREUVES CONTRADICTOIRES :`);
console.log(`Assertions totales : ${totalAssertions}`);
console.log(`Assertions réussies : ${passedAssertions}`);
console.log(`Assertions échouées : ${failedAssertions}`);
console.log('='.repeat(78));

if (failedAssertions > 0) {
  console.error(`\n🚨 ÉCHEC : ${failedAssertions} assertion(s) ont échoué !`);
  process.exit(1);
} else {
  console.log(`\n🎉 TOUTES LES ÉPREUVES DE ROBUSTESSE ET DE STRESS ONT ÉTÉ VALIDÉES AVEC SUCCÈS !`);
  process.exit(0);
}
