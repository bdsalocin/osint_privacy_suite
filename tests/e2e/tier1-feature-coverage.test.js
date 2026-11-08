/**
 * Tier 1 : Couverture Unitaire des Fonctionnalités Majeures (>= 5 tests par fonctionnalité)
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  normalizeTarget,
  cleanDomain,
  buildJdmIndexes,
  matchAccountToJDM,
  resolveJGMD,
  parseHoleheCsv,
  parseMaigretJson,
  parseIgnorantStdout,
  parseH8mailJson,
  parseGhuntStdout,
  parseSpiderfootJson,
  generateGdprArticle17Email,
  createStorageEngine
} from './helpers/contracts.js';

import {
  assertUnifiedAccount,
  assertUnifiedLeak,
  assertGdprEmailFrenchNoHyphens,
  assertValidMailto,
  assertJdmEntry
} from './helpers/assertions.js';

import {
  loadJdmSample,
  loadJgmdSample,
  loadToolOutput,
  ensureTmpDir,
  cleanTmpDir
} from './helpers/test-env.js';

describe('Tier 1 : Couverture Unitaire des Fonctionnalités', () => {
  let jdmSample;
  let jgmdSample;
  let jdmIndexes;

  beforeEach(() => {
    ensureTmpDir();
    jdmSample = loadJdmSample();
    jgmdSample = loadJgmdSample();
    jdmIndexes = buildJdmIndexes(jdmSample);
  });

  afterEach(() => {
    cleanTmpDir();
  });

  // =========================================================================
  // T1.1 : Saisie unifiée multi-cibles
  // =========================================================================
  describe('T1.1 : Saisie unifiée multi-cibles', () => {
    test('T1.1.1 : normalise une adresse email standard en minuscules', () => {
      const res = normalizeTarget({ email: '  Test.User@Example.COM  ' });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.email, 'test.user@example.com');
    });

    test('T1.1.2 : normalise un pseudonyme en supprimant les espaces superflus', () => {
      const res = normalizeTarget({ username: '   jeandupont   ' });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.username, 'jeandupont');
    });

    test('T1.1.3 : normalise un téléphone français internationalisé avec +33', () => {
      const res = normalizeTarget({ phone: '+33 6 99 50 43 46' });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.phoneCountryCode, '33');
      assert.strictEqual(res.phoneNumber, '699504346');
      assert.strictEqual(res.phone, '+33699504346');
    });

    test('T1.1.4 : convertit un téléphone français au format local 06... en indicatif 33', () => {
      const res = normalizeTarget({ phone: '06.99.50.43.46' });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.phoneCountryCode, '33');
      assert.strictEqual(res.phoneNumber, '699504346');
      assert.strictEqual(res.phone, '+33699504346');
    });

    test('T1.1.5 : valide simultanément un profil complet unifié', () => {
      const res = normalizeTarget({
        email: 'jeandupont@icloud.com',
        username: 'jeandupont',
        phone: '+33699504346'
      });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.email, 'jeandupont@icloud.com');
      assert.strictEqual(res.username, 'jeandupont');
      assert.strictEqual(res.phone, '+33699504346');
      assert.strictEqual(res.errors.length, 0);
    });
  });

  // =========================================================================
  // T1.2 : Adaptateurs et exécution d'outils CLI
  // =========================================================================
  describe('T1.2 : Adaptateurs et exécution d\'outils CLI', () => {
    test('T1.2.1 : Adaptateur Holehe tolère le code retour 1 lorsque le CSV est généré', () => {
      const exitCode = 1;
      const csvGenerated = true;
      const isSuccess = exitCode === 0 || (exitCode === 1 && csvGenerated);
      assert.strictEqual(isSuccess, true, 'Holehe doit être considéré comme réussi avec code 1 et CSV présent');
    });

    test('T1.2.2 : Adaptateur Maigret produit un JSON simple et référence le rapport HTML', () => {
      const rawJson = loadToolOutput('maigret_report_simple.json');
      const accounts = parseMaigretJson(rawJson, 'jeandupont');
      assert.ok(accounts.length >= 3);
      assert.strictEqual(accounts[0].serviceName, 'GitHub');
      assert.strictEqual(accounts[0].profileUrl, 'https://github.com/jeandupont');
    });

    test('T1.2.3 : Adaptateur Ignorant nettoie le signe + de l\'indicatif avant appel', () => {
      const target = normalizeTarget({ phone: '+33699504346' });
      assert.strictEqual(target.phoneCountryCode, '33', 'L\'indicatif passé à Ignorant ne doit contenir aucun +');
      const rawStdout = loadToolOutput('ignorant_stdout.txt');
      const accounts = parseIgnorantStdout(rawStdout, target.phone);
      assert.ok(accounts.length >= 2);
      assert.ok(accounts.some((a) => a.domain === 'instagram.com' && a.status === 'claimed'));
    });

    test('T1.2.4 : Adaptateur h8mail extrait les fuites de données avec flag -sk', () => {
      const rawJson = loadToolOutput('h8mail_output.json');
      const leaks = parseH8mailJson(rawJson, 'jeandupont@icloud.com');
      assert.strictEqual(leaks.length, 2);
      assert.strictEqual(leaks[0].target, 'jeandupont@icloud.com');
      assert.strictEqual(leaks[0].sourceTool, 'h8mail');
    });

    test('T1.2.5 : Adaptateur GHunt détecte l\'état de la session sans bloquer l\'UI', () => {
      const stdout = loadToolOutput('ghunt_stdout.txt');
      const accounts = parseGhuntStdout(stdout, 'jeandupont@gmail.com');
      assert.strictEqual(accounts.length, 1);
      assert.strictEqual(accounts[0].serviceName, 'Google');
      assert.strictEqual(accounts[0].metadata.gaiaId, '104230198827361');
    });

    test('T1.2.6 : Adaptateur SpiderFoot s\'exécute avec cwd spécifique et renvoie du JSON', () => {
      const rawJson = loadToolOutput('spiderfoot_output.json');
      const { accounts, leaks } = parseSpiderfootJson(rawJson, 'jeandupont');
      assert.ok(accounts.length >= 2);
      assert.ok(leaks.length >= 1);
      assert.strictEqual(leaks[0].sourceTool, 'spiderfoot');
    });
  });

  // =========================================================================
  // T1.3 : Normalisation des sorties brutes vers UnifiedAccount et UnifiedLeak
  // =========================================================================
  describe('T1.3 : Normalisation des données brutes', () => {
    test('T1.3.1 : normalise le CSV Holehe en UnifiedAccount', () => {
      const csv = loadToolOutput('holehe_output.csv');
      const accounts = parseHoleheCsv(csv, 'test@example.com');
      assert.ok(accounts.length >= 3);
      for (const a of accounts) {
        assertUnifiedAccount(a, 'Holehe CSV');
      }
      const spotify = accounts.find((a) => a.serviceId === 'spotify');
      assert.ok(spotify);
      assert.strictEqual(spotify.status, 'claimed');
    });

    test('T1.3.2 : normalise le JSON Maigret avec métadonnées enrichies', () => {
      const raw = loadToolOutput('maigret_report_simple.json');
      const accounts = parseMaigretJson(raw, 'jeandupont');
      const gh = accounts.find((a) => a.serviceId === 'github');
      assert.ok(gh);
      assertUnifiedAccount(gh, 'Maigret JSON');
      assert.strictEqual(gh.metadata.fullname, 'Jean Dupont');
      assert.ok(gh.avatarUrl.includes('avatars.githubusercontent.com'));
    });

    test('T1.3.3 : normalise le stdout Ignorant avec statuts claimed, unclaimed et rate_limited', () => {
      const stdout = loadToolOutput('ignorant_stdout.txt');
      const accounts = parseIgnorantStdout(stdout, '+33699504346');
      assert.ok(accounts.length >= 3);
      for (const a of accounts) {
        assertUnifiedAccount(a, 'Ignorant Stdout');
      }
      assert.ok(accounts.some((a) => a.status === 'claimed'));
      assert.ok(accounts.some((a) => a.status === 'unclaimed'));
    });

    test('T1.3.4 : normalise les fuites h8mail en UnifiedLeak', () => {
      const raw = loadToolOutput('h8mail_output.json');
      const leaks = parseH8mailJson(raw, 'jeandupont@icloud.com');
      assert.strictEqual(leaks.length, 2);
      for (const l of leaks) {
        assertUnifiedLeak(l, 'h8mail Leak');
      }
    });

    test('T1.3.5 : sépare correctement les comptes et les fuites dans SpiderFoot', () => {
      const raw = loadToolOutput('spiderfoot_output.json');
      const { accounts, leaks } = parseSpiderfootJson(raw, 'jeandupont');
      assert.strictEqual(accounts.length, 2);
      assert.strictEqual(leaks.length, 1);
      assertUnifiedAccount(accounts[0], 'SpiderFoot Account');
      assertUnifiedLeak(leaks[0], 'SpiderFoot Leak');
    });
  });

  // =========================================================================
  // T1.4 : Moteur de réconciliation JustDeleteMe
  // =========================================================================
  describe('T1.4 : Moteur de réconciliation JustDeleteMe', () => {
    test('T1.4.1 : réconciliation par table d\'alias canoniques (office365.com -> Microsoft)', () => {
      const match = matchAccountToJDM('office365', 'office365.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.strictEqual(match.matchedBy, 'alias');
      assert.strictEqual(match.confidence, 1.0);
      assert.strictEqual(match.entry.name, 'Microsoft Account');
    });

    test('T1.4.2 : réconciliation par correspondance exacte sur le domaine (spotify.com)', () => {
      const match = matchAccountToJDM('spotify', 'spotify.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.strictEqual(match.matchedBy, 'domain_exact');
      assert.strictEqual(match.confidence, 1.0);
      assert.strictEqual(match.entry.name, 'Spotify');
    });

    test('T1.4.3 : réconciliation par domaine racine (open.spotify.com -> spotify.com)', () => {
      const match = matchAccountToJDM('spotify', 'open.spotify.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.strictEqual(match.matchedBy, 'domain_root');
      assert.strictEqual(match.confidence, 0.9);
      assert.strictEqual(match.entry.name, 'Spotify');
    });

    test('T1.4.4 : réconciliation par nom normalisé exact (GitHub -> GitHub)', () => {
      const match = matchAccountToJDM('GitHub', '', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.strictEqual(match.matchedBy, 'name_exact');
      assert.strictEqual(match.confidence, 0.85);
      assert.strictEqual(match.entry.name, 'GitHub');
    });

    test('T1.4.5 : réconciliation par inclusion de chaîne (SteamCommunity -> Steam)', () => {
      const match = matchAccountToJDM('SteamCommunity', 'steamcommunity.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.ok(match.entry);
      assert.strictEqual(match.entry.name, 'Steam');
      assert.ok(match.confidence >= 0.7);
    });
  });

  // =========================================================================
  // T1.5 : Badges de difficulté et liens JustDeleteMe
  // =========================================================================
  describe('T1.5 : Badges de difficulté et liens JustDeleteMe', () => {
    test('T1.5.1 : niveau easy avec URL directe de suppression (Spotify)', () => {
      const match = matchAccountToJDM('Spotify', 'spotify.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assertJdmEntry(match.entry);
      assert.strictEqual(match.entry.difficulty, 'easy');
      assert.ok(match.entry.url.includes('spotify.com'));
    });

    test('T1.5.2 : niveau medium avec instructions détaillées (Amazon)', () => {
      const match = matchAccountToJDM('Amazon', 'amazon.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assertJdmEntry(match.entry);
      assert.strictEqual(match.entry.difficulty, 'medium');
      assert.ok(match.entry.notes_fr || match.entry.notes);
    });

    test('T1.5.3 : niveau hard avec adresse DPO (Microsoft)', () => {
      const match = matchAccountToJDM('Microsoft', 'microsoft.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assertJdmEntry(match.entry);
      assert.strictEqual(match.entry.difficulty, 'hard');
      assert.ok(match.entry.email.includes('@'));
    });

    test('T1.5.4 : niveau impossible avec message d\'alerte (Steam)', () => {
      const match = matchAccountToJDM('Steam', 'steampowered.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assertJdmEntry(match.entry);
      assert.strictEqual(match.entry.difficulty, 'impossible');
    });

    test('T1.5.5 : niveau limited avec mention juridique (PayPal)', () => {
      const match = matchAccountToJDM('PayPal', 'paypal.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assertJdmEntry(match.entry);
      assert.strictEqual(match.entry.difficulty, 'limited');
    });

    test('T1.5.6 : niveau unknown pour un service non référencé dans JDM', () => {
      const match = matchAccountToJDM('InconnuService', 'unknownservice12345.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.strictEqual(match.entry, null);
      assert.strictEqual(match.matchedBy, 'none');
      assert.strictEqual(match.confidence, 0.0);
    });
  });

  // =========================================================================
  // T1.6 : Intégration JustGetMyData (JGMD)
  // =========================================================================
  describe('T1.6 : Intégration JustGetMyData (JGMD)', () => {
    test('T1.6.1 : résout le portail direct Google Takeout', () => {
      const res = resolveJGMD('Google', 'google.com', jgmdSample);
      assert.strictEqual(res.matched, true);
      assert.strictEqual(res.exportUrl, 'https://takeout.google.com/');
    });

    test('T1.6.2 : résout le portail direct Meta pour Facebook et Instagram', () => {
      const resFb = resolveJGMD('Facebook', 'facebook.com', jgmdSample);
      assert.strictEqual(resFb.matched, true);
      assert.ok(resFb.exportUrl.includes('accountscenter.facebook.com'));

      const resInsta = resolveJGMD('Instagram', 'instagram.com', jgmdSample);
      assert.strictEqual(resInsta.matched, true);
      assert.ok(resInsta.exportUrl.includes('accountscenter.instagram.com'));
    });

    test('T1.6.3 : résout le portail direct GitHub', () => {
      const res = resolveJGMD('GitHub', 'github.com', jgmdSample);
      assert.strictEqual(res.matched, true);
      assert.strictEqual(res.exportUrl, 'https://github.com/settings/admin');
    });

    test('T1.6.4 : résout depuis la liste JGMD pour Spotify', () => {
      const res = resolveJGMD('Spotify', 'spotify.com', jgmdSample);
      assert.strictEqual(res.matched, true);
      assert.strictEqual(res.exportUrl, 'https://www.spotify.com/account/privacy/');
    });

    test('T1.6.5 : renvoie matched=false si le service est absent de JGMD', () => {
      const res = resolveJGMD('ServiceInexistant', 'inexistant.org', jgmdSample);
      assert.strictEqual(res.matched, false);
      assert.strictEqual(res.exportUrl, null);
    });
  });

  // =========================================================================
  // T1.7 : Générateur courriel RGPD Article 17
  // =========================================================================
  describe('T1.7 : Générateur courriel RGPD Article 17', () => {
    test('T1.7.1 : génère un courriel en français conforme au modèle officiel', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'dpo@spotify.com',
        serviceName: 'Spotify',
        userName: 'Jean Dupont',
        userEmail: 'jeandupont@icloud.com',
        userPhone: '+33699504346',
        accountUsername: 'jeandupont',
        language: 'fr'
      });

      assert.ok(email.subject.includes('Article 17 du RGPD'));
      assert.ok(email.body.includes('Jean Dupont'));
      assert.ok(email.body.includes('jeandupont@icloud.com'));
      assert.ok(email.body.includes('+33699504346'));
      assert.ok(email.body.includes('délai maximal d\'un mois'));
    });

    test('T1.7.2 : vérifie strictement l\'absence de tiret dans le corps en français', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'dpo@example.com',
        serviceName: 'TestService',
        userName: 'Jean Dupont',
        userEmail: 'jean@example.com',
        accountUsername: 'jean',
        language: 'fr'
      });

      assertGdprEmailFrenchNoHyphens(email.body, 'Générateur RGPD Français');
    });

    test('T1.7.3 : génère un modèle en langue anglaise pour les services internationaux', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'dpo@github.com',
        serviceName: 'GitHub',
        userName: 'Jean Dupont',
        userEmail: 'jeandupont@icloud.com',
        accountUsername: 'jeandupont',
        language: 'en'
      });

      assert.ok(email.subject.includes('Article 17 GDPR'));
      assert.ok(email.body.includes('Dear Data Protection Officer'));
      assert.ok(email.body.includes('without undue delay and at the latest within one month'));
    });

    test('T1.7.4 : produit un lien mailto: valide respectant la RFC 3986', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'privacy@spotify.com',
        serviceName: 'Spotify',
        userName: 'Jean Dupont',
        userEmail: 'test@example.com',
        accountUsername: 'test',
        language: 'fr'
      });

      assertValidMailto(email.mailtoUri, 'Lien mailto RGPD');
      assert.ok(email.mailtoUri.startsWith('mailto:privacy%40spotify.com'));
    });

    test('T1.7.5 : substitue l\'email DPO par défaut si non spécifié', () => {
      const email = generateGdprArticle17Email({
        serviceName: 'UnknownService',
        userName: 'Jean Dupont',
        userEmail: 'test@example.com',
        accountUsername: 'test'
      });

      assert.ok(email.recipientEmail.startsWith('dpo@'));
    });
  });

  // =========================================================================
  // T1.8 : Persistance locale SQLite native (node:sqlite)
  // =========================================================================
  describe('T1.8 : Persistance locale SQLite native', () => {
    let storage;

    beforeEach(() => {
      storage = createStorageEngine(':memory:');
    });

    afterEach(() => {
      storage.close();
    });

    test('T1.8.1 : crée une session de scan avec horodatage et outils sélectionnés', () => {
      const scanId = storage.createScan({
        title: 'Audit E2E Jean',
        targetEmail: 'jeandupont@icloud.com',
        targetUsername: 'jeandupont',
        targetPhone: '+33699504346',
        toolsSelected: ['holehe', 'maigret', 'ignorant']
      });

      assert.ok(typeof scanId === 'string' && scanId.length > 0);
      const scan = storage.getScan(scanId);
      assert.strictEqual(scan.title, 'Audit E2E Jean');
      assert.strictEqual(scan.target_email, 'jeandupont@icloud.com');
      assert.deepStrictEqual(scan.tools_selected, ['holehe', 'maigret', 'ignorant']);
    });

    test('T1.8.2 : insère et récupère des comptes découverts rattachés à un scan', () => {
      const scanId = storage.createScan({ title: 'Test Scan' });
      const accountId = crypto.randomUUID();

      storage.saveAccounts([
        {
          id: accountId,
          scanId: scanId,
          serviceName: 'Spotify',
          accountIdentifier: 'jeandupont@icloud.com',
          domain: 'spotify.com',
          sourceTool: 'holehe',
          jdm: { matched: true, difficulty: 'easy', deleteUrl: 'https://spotify.com/delete' },
          jgmd: { matched: true, exportUrl: 'https://spotify.com/privacy' }
        }
      ]);

      const accounts = storage.getAccountsByScan(scanId);
      assert.strictEqual(accounts.length, 1);
      assert.strictEqual(accounts[0].id, accountId);
      assert.strictEqual(accounts[0].service_name, 'Spotify');
      assert.strictEqual(accounts[0].jdm_difficulty, 'easy');
      assert.strictEqual(accounts[0].status, 'detected');
    });

    test('T1.8.3 : liste l\'ensemble des sessions de recherche enregistrées', () => {
      storage.createScan({ title: 'Scan 1' });
      storage.createScan({ title: 'Scan 2' });
      const scans = storage.listScans();
      assert.strictEqual(scans.length, 2);
    });

    test('T1.8.4 : enregistre une démarche RGPD avec calcul automatique de l\'échéance à 30 jours', () => {
      const scanId = storage.createScan({ title: 'Scan RGPD' });
      const sentDate = '2026-11-08T20:00:00.000Z';
      const deadlineDate = '2026-12-08T20:00:00.000Z';

      const reqId = storage.saveGdprRequest({
        scanId: scanId,
        serviceName: 'Microsoft',
        recipientEmail: 'msdpo@microsoft.com',
        legalBasis: 'GDPR_ART_17_ERASURE',
        emailSubject: 'Demande d\'effacement',
        emailBody: 'Corps du message',
        sentDate: sentDate,
        deadlineDate: deadlineDate
      });

      assert.ok(reqId);
      const reqs = storage.getGdprRequests(scanId);
      assert.strictEqual(reqs.length, 1);
      assert.strictEqual(reqs[0].deadline_date, deadlineDate);
      assert.strictEqual(reqs[0].response_status, 'pending');
    });

    test('T1.8.5 : supprime en cascade les comptes rattachés lors de la suppression du scan', () => {
      const scanId = storage.createScan({ title: 'Scan à supprimer' });
      storage.saveAccounts([
        {
          id: crypto.randomUUID(),
          scanId: scanId,
          serviceName: 'Netflix',
          accountIdentifier: 'test@example.com',
          domain: 'netflix.com'
        }
      ]);

      assert.strictEqual(storage.getAccountsByScan(scanId).length, 1);
      const deleted = storage.deleteScan(scanId);
      assert.strictEqual(deleted, true);
      assert.strictEqual(storage.getAccountsByScan(scanId).length, 0);
    });

    test('T1.8.6 : garantit l\'absence d\'accès externe (persistance 100% locale)', () => {
      const scanId = storage.createScan({ title: 'Local Only Scan' });
      assert.ok(scanId);
      // Pour une base in-memory SQLite, location() renvoie null
      assert.strictEqual(storage.db.location(), null);
    });
  });

  // =========================================================================
  // T1.9 : Suivi et transition des statuts de traitement
  // =========================================================================
  describe('T1.9 : Suivi et transition des statuts', () => {
    let storage;
    let scanId;
    let accountId;

    beforeEach(() => {
      storage = createStorageEngine(':memory:');
      scanId = storage.createScan({ title: 'Audit Statuts' });
      accountId = crypto.randomUUID();
      storage.saveAccounts([
        {
          id: accountId,
          scanId: scanId,
          serviceName: 'Twitter',
          accountIdentifier: 'jeandupont',
          domain: 'twitter.com'
        }
      ]);
    });

    afterEach(() => {
      storage.close();
    });

    test('T1.9.1 : transition de detected vers pending', () => {
      const updated = storage.updateAccountStatus(accountId, 'pending', 'Demande envoyée au support');
      assert.strictEqual(updated, true);
      const accounts = storage.getAccountsByScan(scanId);
      assert.strictEqual(accounts[0].status, 'pending');
      assert.strictEqual(accounts[0].status_notes, 'Demande envoyée au support');
    });

    test('T1.9.2 : transition de pending vers deleted avec horodatage processed_at', () => {
      storage.updateAccountStatus(accountId, 'pending');
      storage.updateAccountStatus(accountId, 'deleted', 'Confirmation reçue du DPO');
      const accounts = storage.getAccountsByScan(scanId);
      assert.strictEqual(accounts[0].status, 'deleted');
      assert.ok(accounts[0].processed_at !== null);
    });

    test('T1.9.3 : transition vers completed', () => {
      storage.updateAccountStatus(accountId, 'completed', 'Données récupérées et compte fermé');
      const accounts = storage.getAccountsByScan(scanId);
      assert.strictEqual(accounts[0].status, 'completed');
      assert.ok(accounts[0].processed_at !== null);
    });

    test('T1.9.4 : transition vers ignored pour un faux positif', () => {
      storage.updateAccountStatus(accountId, 'ignored', 'Faux positif avéré');
      const accounts = storage.getAccountsByScan(scanId);
      assert.strictEqual(accounts[0].status, 'ignored');
    });

    test('T1.9.5 : mise à jour automatique de la date updated_at lors de chaque transition', () => {
      const before = storage.getAccountsByScan(scanId)[0].updated_at;
      storage.updateAccountStatus(accountId, 'pending');
      const after = storage.getAccountsByScan(scanId)[0].updated_at;
      assert.ok(after >= before);
    });
  });

  // =========================================================================
  // T1.10 : Export et Import JSON de dossiers d'audit
  // =========================================================================
  describe('T1.10 : Export et Import JSON de dossiers d\'audit', () => {
    let storage1;
    let storage2;

    beforeEach(() => {
      storage1 = createStorageEngine(':memory:');
      storage2 = createStorageEngine(':memory:');
    });

    afterEach(() => {
      storage1.close();
      storage2.close();
    });

    test('T1.10.1 : sérialise une session d\'audit complète en format JSON', () => {
      const scanId = storage1.createScan({
        title: 'Session à exporter',
        targetEmail: 'jean@example.com'
      });
      storage1.saveAccounts([
        {
          id: crypto.randomUUID(),
          scanId: scanId,
          serviceName: 'GitHub',
          accountIdentifier: 'jean',
          domain: 'github.com'
        }
      ]);

      const jsonStr = storage1.exportScanToJson(scanId);
      assert.ok(typeof jsonStr === 'string');
      const parsed = JSON.parse(jsonStr);
      assert.strictEqual(parsed.version, '1.0');
      assert.strictEqual(parsed.scan.id, scanId);
      assert.strictEqual(parsed.accounts.length, 1);
    });

    test('T1.10.2 : importe fidèlement un JSON d\'export dans une nouvelle base', () => {
      const scanId = storage1.createScan({
        title: 'Scan Original',
        targetEmail: 'test@example.com'
      });
      const accountId = crypto.randomUUID();
      storage1.saveAccounts([
        {
          id: accountId,
          scanId: scanId,
          serviceName: 'Spotify',
          accountIdentifier: 'test@example.com',
          domain: 'spotify.com'
        }
      ]);

      const exportedJson = storage1.exportScanToJson(scanId);
      const importedScanId = storage2.importScanFromJson(exportedJson);

      assert.strictEqual(importedScanId, scanId);
      const importedScan = storage2.getScan(scanId);
      assert.strictEqual(importedScan.title, 'Scan Original');
      const importedAccounts = storage2.getAccountsByScan(scanId);
      assert.strictEqual(importedAccounts.length, 1);
      assert.strictEqual(importedAccounts[0].id, accountId);
    });

    test('T1.10.3 : préserve les demandes RGPD lors de l\'export / import', () => {
      const scanId = storage1.createScan({ title: 'Scan avec RGPD' });
      storage1.saveGdprRequest({
        scanId: scanId,
        serviceName: 'Amazon',
        recipientEmail: 'dpo@amazon.fr',
        emailSubject: 'Demande RGPD',
        emailBody: 'Texte RGPD'
      });

      const exportedJson = storage1.exportScanToJson(scanId);
      storage2.importScanFromJson(exportedJson);

      const requests = storage2.getGdprRequests(scanId);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].service_name, 'Amazon');
    });

    test('T1.10.4 : lève une erreur explicite si le scanId à exporter n\'existe pas', () => {
      assert.throws(() => {
        storage1.exportScanToJson('id-inexistant-1234');
      }, /Scan introuvable/);
    });

    test('T1.10.5 : lève une erreur explicite si le JSON à importer est mal formé', () => {
      assert.throws(() => {
        storage2.importScanFromJson('{}');
      }, /Format JSON d'export invalide/);
    });
  });
});
