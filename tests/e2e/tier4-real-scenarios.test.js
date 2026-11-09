/**
 * Tier 4 : Scénarios Réels d'Audit Complet de Bout en Bout
 * Validation de parcours complets d'audit de protection de la vie privée
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
  deduplicateAccounts,
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

import { calculateRiskScore } from '../../dist/src/core/risk-engine.js';
import { generateStandaloneHtmlReport } from '../../dist/src/core/report-exporter.js';
import { compareAudits } from '../../dist/src/core/audit-comparator.js';

describe('Tier 4 : Scénarios Réels d\'Audit Complet de Bout en Bout', () => {
  let jdmSample;
  let jgmdSample;
  let jdmIndexes;
  let storage;

  beforeEach(() => {
    ensureTmpDir();
    jdmSample = loadJdmSample();
    jgmdSample = loadJgmdSample();
    jdmIndexes = buildJdmIndexes(jdmSample);
    storage = createStorageEngine(':memory:');
  });

  afterEach(() => {
    storage.close();
    cleanTmpDir();
  });

  // =========================================================================
  // Scénario 1 : Audit Global Jean Dupont
  // =========================================================================
  test('T4.1 : Scénario Réel 1 — Audit Global Unifié Jean Dupont', () => {
    // 1. Saisie unifiée
    const target = normalizeTarget({
      email: 'jeandupont@icloud.com',
      username: 'jeandupont',
      phone: '+33699504346'
    });
    assert.strictEqual(target.isValid, true);

    // 2. Création de session d'audit locale
    const scanId = storage.createScan({
      title: 'Audit Global Jean Dupont',
      targetEmail: target.email,
      targetUsername: target.username,
      targetPhone: target.phone,
      toolsSelected: ['holehe', 'maigret', 'ignorant', 'h8mail', 'ghunt', 'spiderfoot']
    });
    assert.ok(scanId);

    // 3. Exécution et normalisation des 6 outils depuis les sorties authentiques
    const holeheAccounts = parseHoleheCsv(loadToolOutput('holehe_output.csv'), target.email);
    const maigretAccounts = parseMaigretJson(loadToolOutput('maigret_report_simple.json'), target.username);
    const ignorantAccounts = parseIgnorantStdout(loadToolOutput('ignorant_stdout.txt'), target.phone);
    const h8mailLeaks = parseH8mailJson(loadToolOutput('h8mail_output.json'), target.email);
    const ghuntAccounts = parseGhuntStdout(loadToolOutput('ghunt_stdout.txt'), target.email);
    const { accounts: sfAccounts, leaks: sfLeaks } = parseSpiderfootJson(loadToolOutput('spiderfoot_output.json'), target.email);

    // 4. Agrégation et dédoublonnage
    const allRawAccounts = [
      ...holeheAccounts,
      ...maigretAccounts,
      ...ignorantAccounts,
      ...ghuntAccounts,
      ...sfAccounts
    ].filter((a) => a.status === 'claimed');

    const deduplicated = deduplicateAccounts(allRawAccounts);
    assert.ok(deduplicated.length >= 5, 'Doit identifier au moins 5 comptes distincts');

    // 5. Enrichissement JustDeleteMe et JustGetMyData
    const enriched = deduplicated.map((acc) => {
      const jdmMatch = matchAccountToJDM(acc.serviceName, acc.domain, jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      const jgmdMatch = resolveJGMD(acc.serviceName, acc.domain, jgmdSample);

      return {
        ...acc,
        scanId: scanId,
        serviceName: jdmMatch.entry ? jdmMatch.entry.name : acc.serviceName,
        jdm: {
          matched: jdmMatch.confidence > 0,
          difficulty: jdmMatch.entry?.difficulty || 'unknown',
          deleteUrl: jdmMatch.entry?.url || null,
          notes: jdmMatch.entry?.notes || null,
          notes_fr: jdmMatch.entry?.notes_fr || null,
          email: jdmMatch.entry?.email || null
        },
        jgmd: {
          matched: jgmdMatch.matched,
          exportUrl: jgmdMatch.exportUrl || null,
          notes: jgmdMatch.notes || null
        }
      };
    });

    // 6. Sauvegarde en base locale SQLite
    storage.saveAccounts(enriched);
    const savedAccounts = storage.getAccountsByScan(scanId);
    assert.strictEqual(savedAccounts.length, enriched.length);

    // 7. Vérification des badges et des actions
    const spotify = savedAccounts.find((a) => a.service_name.toLowerCase().includes('spotify'));
    assert.ok(spotify, 'Spotify doit être présent');
    assert.strictEqual(spotify.jdm_difficulty, 'easy');
    assert.strictEqual(spotify.jgmd_matched, 1);

    // 8. Traitement utilisateur : Génération RGPD pour Microsoft (hard)
    const microsoft = savedAccounts.find((a) => a.service_name.toLowerCase().includes('microsoft'));
    assert.ok(microsoft, 'Microsoft doit être présent via alias office365');
    assert.strictEqual(microsoft.jdm_difficulty, 'hard');

    const gdprEmail = generateGdprArticle17Email({
      recipientEmail: microsoft.jdm_dpo_email || 'msdpo@microsoft.com',
      serviceName: microsoft.service_name,
      userName: 'Jean Dupont',
      userEmail: target.email,
      userPhone: target.phone,
      accountUsername: target.username,
      language: 'fr'
    });

    // Vérification de l'interdiction des tirets dans la version française
    assertGdprEmailFrenchNoHyphens(gdprEmail.body, 'Courriel RGPD Jean Dupont');
    assertValidMailto(gdprEmail.mailtoUri);

    // Enregistrement de la démarche RGPD avec échéance à 30 jours
    const reqId = storage.saveGdprRequest({
      scanId: scanId,
      accountId: microsoft.id,
      serviceName: microsoft.service_name,
      recipientEmail: gdprEmail.recipientEmail,
      emailSubject: gdprEmail.subject,
      emailBody: gdprEmail.body
    });
    assert.ok(reqId);

    // Marquage du statut en 'pending'
    storage.updateAccountStatus(microsoft.id, 'pending', 'Courriel RGPD Art. 17 envoyé');
    const updatedMs = storage.getAccountsByScan(scanId).find((a) => a.id === microsoft.id);
    assert.strictEqual(updatedMs.status, 'pending');

    // 9. Export complet en JSON et vérification round-trip
    const exportedJson = storage.exportScanToJson(scanId);
    const parsed = JSON.parse(exportedJson);
    assert.strictEqual(parsed.scan.id, scanId);
    assert.strictEqual(parsed.accounts.length, savedAccounts.length);
    assert.strictEqual(parsed.gdprRequests.length, 1);
  });

  // =========================================================================
  // Scénario 2 : Audit Développeur Open-Source (Profil Torvalds)
  // =========================================================================
  test('T4.2 : Scénario Réel 2 — Audit Empreinte Développeur (Torvalds)', () => {
    const target = normalizeTarget({ username: 'torvalds' });
    assert.strictEqual(target.username, 'torvalds');

    const scanId = storage.createScan({
      title: 'Audit Développeur Linus Torvalds',
      targetUsername: target.username,
      toolsSelected: ['maigret', 'spiderfoot']
    });

    const maigretAccounts = parseMaigretJson(loadToolOutput('maigret_report_simple.json'), target.username);
    const deduplicated = deduplicateAccounts(maigretAccounts);

    const enriched = deduplicated.map((acc) => {
      const jdm = matchAccountToJDM(acc.serviceName, acc.domain, jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      const jgmd = resolveJGMD(acc.serviceName, acc.domain, jgmdSample);
      return {
        ...acc,
        scanId,
        jdm: { matched: jdm.confidence > 0, difficulty: jdm.entry?.difficulty || 'unknown', deleteUrl: jdm.entry?.url },
        jgmd: { matched: jgmd.matched, exportUrl: jgmd.exportUrl }
      };
    });

    storage.saveAccounts(enriched);
    const accounts = storage.getAccountsByScan(scanId);

    const github = accounts.find((a) => a.service_name === 'GitHub');
    assert.ok(github);
    assert.strictEqual(github.jdm_difficulty, 'easy');
    assert.strictEqual(github.jgmd_matched, 1);
    assert.strictEqual(github.jgmd_export_url, 'https://github.com/settings/admin');

    // Passage du compte GitHub à 'completed' après récupération des données
    storage.updateAccountStatus(github.id, 'completed', 'Dépôts et données exportés via GitHub settings');
    const updated = storage.getAccountsByScan(scanId).find((a) => a.id === github.id);
    assert.strictEqual(updated.status, 'completed');
    assert.ok(updated.processed_at !== null);
  });

  // =========================================================================
  // Scénario 3 : Audit Fuites et Compromission (Cible Compromise)
  // =========================================================================
  test('T4.3 : Scénario Réel 3 — Audit Fuites et Compromission de Données', () => {
    const target = normalizeTarget({ email: 'victim@example.com' });
    const scanId = storage.createScan({
      title: 'Audit de Fuites',
      targetEmail: target.email,
      toolsSelected: ['holehe', 'h8mail']
    });

    const leaks = parseH8mailJson(loadToolOutput('h8mail_output.json'), target.email);
    assert.ok(leaks.length >= 2);

    const holeheAccounts = parseHoleheCsv(loadToolOutput('holehe_output.csv'), target.email);
    const activeAccounts = holeheAccounts.filter((a) => a.status === 'claimed');

    storage.saveAccounts(activeAccounts.map((a) => ({
      ...a,
      scanId,
      jdm: { matched: true, difficulty: 'medium' }
    })));

    // Priorisation de la demande RGPD pour les comptes découverts
    const spotify = storage.getAccountsByScan(scanId).find((a) => a.service_name === 'Spotify');
    assert.ok(spotify);

    const gdprEmail = generateGdprArticle17Email({
      recipientEmail: 'privacy@spotify.com',
      serviceName: 'Spotify',
      userName: 'Victime de Fuite',
      userEmail: target.email,
      accountUsername: 'victim',
      language: 'fr'
    });

    assertGdprEmailFrenchNoHyphens(gdprEmail.body);

    const reqId = storage.saveGdprRequest({
      scanId,
      accountId: spotify.id,
      serviceName: 'Spotify',
      recipientEmail: 'privacy@spotify.com',
      emailSubject: gdprEmail.subject,
      emailBody: gdprEmail.body,
      userNotes: 'Compromission identifiée dans ComboList2018'
    });

    assert.ok(reqId);
    const savedReq = storage.getGdprRequests(scanId)[0];
    assert.strictEqual(savedReq.user_notes, 'Compromission identifiée dans ComboList2018');
  });

  // =========================================================================
  // Scénario 4 : Audit Mobile et Réseaux Sociaux (Cible Téléphone)
  // =========================================================================
  test('T4.4 : Scénario Réel 4 — Audit Mobile et Réseaux Sociaux (Téléphone)', () => {
    const target = normalizeTarget({ phone: '06 99 50 43 46' });
    assert.strictEqual(target.phoneCountryCode, '33');
    assert.strictEqual(target.phoneNumber, '699504346');

    const scanId = storage.createScan({
      title: 'Audit Téléphone Mobile',
      targetPhone: target.phone,
      toolsSelected: ['ignorant']
    });

    const accounts = parseIgnorantStdout(loadToolOutput('ignorant_stdout.txt'), target.phone);
    const claimed = accounts.filter((a) => a.status === 'claimed');

    const enriched = claimed.map((a) => {
      const jdm = matchAccountToJDM(a.serviceName, a.domain, jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      const jgmd = resolveJGMD(a.serviceName, a.domain, jgmdSample);
      return {
        ...a,
        scanId,
        jdm: { matched: jdm.confidence > 0, difficulty: jdm.entry?.difficulty || 'unknown', deleteUrl: jdm.entry?.url },
        jgmd: { matched: jgmd.matched, exportUrl: jgmd.exportUrl }
      };
    });

    storage.saveAccounts(enriched);
    const saved = storage.getAccountsByScan(scanId);

    const instagram = saved.find((a) => a.service_name.toLowerCase().includes('instagram'));
    const snapchat = saved.find((a) => a.service_name.toLowerCase().includes('snapchat'));

    assert.ok(instagram);
    assert.ok(snapchat);
    assert.strictEqual(instagram.jdm_difficulty, 'medium');
    assert.strictEqual(snapchat.jdm_difficulty, 'hard');

    // Les deux plateformes ont des portails JGMD
    assert.strictEqual(instagram.jgmd_matched, 1);
    assert.strictEqual(snapchat.jgmd_matched, 1);
  });

  // =========================================================================
  // Scénario 5 : Campagne d'Effacement DPO Massive et Conformité 30 Jours
  // =========================================================================
  test('T4.5 : Scénario Réel 5 — Campagne DPO Massive et Conformité Légale (30 Jours)', () => {
    const scanId = storage.createScan({
      title: 'Campagne DPO Massive Multi-Plateformes',
      targetEmail: 'citoyen@europe.eu'
    });

    // 10 services couvrant les 5 difficultés
    const testServices = [
      { name: 'Spotify', diff: 'easy', email: 'privacy@spotify.com' },
      { name: 'GitHub', diff: 'easy', email: 'support@github.com' },
      { name: 'Amazon', diff: 'medium', email: 'cis@amazon.fr' },
      { name: 'Facebook', diff: 'medium', email: 'dpo@meta.com' },
      { name: 'Twitter', diff: 'medium', email: 'dpo@twitter.com' },
      { name: 'Microsoft Account', diff: 'hard', email: 'msdpo@microsoft.com' },
      { name: 'Netflix', diff: 'hard', email: 'privacy@netflix.com' },
      { name: 'Steam', diff: 'impossible', email: 'privacy@valvesoftware.com' },
      { name: 'PayPal', diff: 'limited', email: 'dpo@paypal.com' },
      { name: 'Google', diff: 'limited', email: 'dpo@google.com' }
    ];

    const accountsToInsert = testServices.map((s) => ({
      id: crypto.randomUUID(),
      scanId,
      serviceName: s.name,
      accountIdentifier: 'citoyen@europe.eu',
      domain: `${s.name.toLowerCase().replace(/[^a-z]/g, '')}.com`,
      jdm: { matched: true, difficulty: s.diff, email: s.email }
    }));

    storage.saveAccounts(accountsToInsert);
    const accounts = storage.getAccountsByScan(scanId);
    assert.strictEqual(accounts.length, 10);

    // Génération et enregistrement par lot de demandes RGPD
    const sentDate = new Date('2026-11-08T12:00:00Z');
    const expectedDeadline = new Date('2026-12-08T12:00:00Z').toISOString();

    for (const acc of accounts) {
      const email = generateGdprArticle17Email({
        recipientEmail: acc.jdm_dpo_email || `dpo@${acc.domain}`,
        serviceName: acc.service_name,
        userName: 'Jean Dupont',
        userEmail: 'citoyen@europe.eu',
        accountUsername: 'citoyen',
        language: 'fr'
      });

      assertGdprEmailFrenchNoHyphens(email.body, `Vérification sans tiret pour ${acc.service_name}`);

      storage.saveGdprRequest({
        scanId,
        accountId: acc.id,
        serviceName: acc.service_name,
        recipientEmail: email.recipientEmail,
        emailSubject: email.subject,
        emailBody: email.body,
        sentDate: sentDate.toISOString(),
        deadlineDate: expectedDeadline
      });

      storage.updateAccountStatus(acc.id, 'pending');
    }

    const requests = storage.getGdprRequests(scanId);
    assert.strictEqual(requests.length, 10);

    // Vérification de la conformité du délai de 30 jours
    for (const req of requests) {
      assert.strictEqual(req.deadline_date, expectedDeadline);
      assert.strictEqual(req.response_status, 'pending');
    }

    // Simulation de réponses favorables pour les comptes faciles
    const easyAccounts = accounts.filter((a) => a.jdm_difficulty === 'easy');
    for (const ea of easyAccounts) {
      storage.updateAccountStatus(ea.id, 'deleted', 'Suppression confirmée par le service');
    }

    const refreshedAccounts = storage.getAccountsByScan(scanId);
    const deletedCount = refreshedAccounts.filter((a) => a.status === 'deleted').length;
    const pendingCount = refreshedAccounts.filter((a) => a.status === 'pending').length;

    assert.strictEqual(deletedCount, 2);
    assert.strictEqual(pendingCount, 8);

    // Export et validation d'intégrité globale
    const jsonStr = storage.exportScanToJson(scanId);
    const payload = JSON.parse(jsonStr);
    assert.strictEqual(payload.accounts.length, 10);
    assert.strictEqual(payload.gdprRequests.length, 10);
  });

  // =========================================================================
  // Scénario 6 : Calcul du Score Global de Risque et Recommandations (v2)
  // =========================================================================
  test('T4.6 : Scénario Réel 6 — Score Global de Risque et Recommandations sans Tiret', () => {
    const accounts = [
      {
        id: 'acc-risk-1',
        serviceId: 'steam',
        serviceName: 'Steam',
        domain: 'steampowered.com',
        accountIdentifier: 'player_one',
        sourceTool: 'maigret',
        status: 'claimed',
        cleaned: false,
        metadata: {},
        jdm: { matched: true, difficulty: 'impossible' }
      },
      {
        id: 'acc-risk-2',
        serviceId: 'spotify',
        serviceName: 'Spotify',
        domain: 'spotify.com',
        accountIdentifier: 'player_one@example.com',
        sourceTool: 'holehe',
        status: 'claimed',
        cleaned: false,
        metadata: {},
        jdm: { matched: true, difficulty: 'easy', deleteUrl: 'https://spotify.com/delete' }
      }
    ];
    const leaks = [
      {
        id: 'leak-risk-1',
        target: 'player_one@example.com',
        sourceTool: 'h8mail',
        breachName: 'ComboBreach2024',
        dataClasses: ['passwords', 'email'],
        details: 'Password hash exposed'
      }
    ];

    const result = calculateRiskScore(accounts, leaks);
    assert.ok(result.score > 0 && result.score <= 100);
    assert.strictEqual(result.breakdown.uncleanedCount, 2);
    assert.strictEqual(result.breakdown.criticalLeaksCount, 1);
    assert.ok(result.recommendations.length >= 2);
    for (const rec of result.recommendations) {
      assert.strictEqual(/[-–—]/.test(rec.title), false, 'Titre de recommandation sans tiret');
      assert.strictEqual(/[-–—]/.test(rec.description), false, 'Description de recommandation sans tiret');
    }
  });

  // =========================================================================
  // Scénario 7 : Export de Rapport d'Audit Autonome HTML avec Jauge SVG (v2)
  // =========================================================================
  test('T4.7 : Scénario Réel 7 — Export de Rapport HTML Autonome et Jauge SVG', () => {
    const scanMeta = {
      id: 'scan-export-e2e',
      title: 'Audit Export Complet',
      target_email: 'export@example.com',
      created_at: '2026-11-09T10:00:00Z',
      tools_selected: ['holehe', 'maigret', 'h8mail']
    };
    const accounts = [
      {
        id: 'acc-exp-1',
        serviceId: 'github',
        serviceName: 'GitHub',
        domain: 'github.com',
        accountIdentifier: 'export_user',
        sourceTool: 'maigret',
        status: 'claimed',
        cleaned: false,
        metadata: {},
        jdm: { matched: true, difficulty: 'easy', deleteUrl: 'https://github.com/settings/admin' }
      }
    ];
    const leaks = [
      {
        id: 'leak-exp-1',
        target: 'export@example.com',
        sourceTool: 'h8mail',
        breachName: 'BreachArchive',
        dataClasses: ['email'],
        details: 'Email listed'
      }
    ];
    const riskScore = calculateRiskScore(accounts, leaks);
    const html = generateStandaloneHtmlReport(scanMeta, accounts, leaks, riskScore);

    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<svg'));
    assert.ok(html.includes('@media print'));
    assert.ok(html.includes('GitHub'));
    assert.ok(html.includes('BreachArchive'));
  });

  // =========================================================================
  // Scénario 8 : Comparateur Chronologique d'Audits et Persistance des Fuites (v2)
  // =========================================================================
  test('T4.8 : Scénario Réel 8 — Comparateur Chronologique entre Deux Audits Sauvegardés', () => {
    const auditA = {
      scan: { id: 'audit-t1', created_at: '2026-10-01T10:00:00Z' },
      accounts: [
        {
          id: 'a1',
          serviceId: 'twitter',
          serviceName: 'Twitter',
          domain: 'twitter.com',
          accountIdentifier: 'user_cmp',
          sourceTool: 'maigret',
          status: 'claimed',
          cleaned: false,
          metadata: {}
        },
        {
          id: 'a2',
          serviceId: 'adobe',
          serviceName: 'Adobe',
          domain: 'adobe.com',
          accountIdentifier: 'user_cmp@example.com',
          sourceTool: 'holehe',
          status: 'claimed',
          cleaned: false,
          metadata: {}
        }
      ],
      leaks: []
    };

    const auditB = {
      scan: { id: 'audit-t2', created_at: '2026-11-09T10:00:00Z' },
      accounts: [
        {
          id: 'b1',
          serviceId: 'twitter',
          serviceName: 'Twitter',
          domain: 'twitter.com',
          accountIdentifier: 'user_cmp',
          sourceTool: 'maigret',
          status: 'claimed',
          cleaned: true,
          metadata: {}
        },
        {
          id: 'b2',
          serviceId: 'adobe',
          serviceName: 'Adobe',
          domain: 'adobe.com',
          accountIdentifier: 'user_cmp@example.com',
          sourceTool: 'holehe',
          status: 'claimed',
          cleaned: false,
          metadata: {}
        },
        {
          id: 'b3',
          serviceId: 'github',
          serviceName: 'GitHub',
          domain: 'github.com',
          accountIdentifier: 'user_cmp',
          sourceTool: 'maigret',
          status: 'claimed',
          cleaned: false,
          metadata: {}
        }
      ],
      leaks: []
    };

    const diff = compareAudits(auditA, auditB);
    assert.strictEqual(diff.stats.newCount, 1);
    assert.strictEqual(diff.stats.persistentCount, 1);
    assert.strictEqual(diff.stats.resolvedCount, 1);
    assert.strictEqual(/[-–—]/.test(diff.scoreEvolution.descriptionFrench), false);
  });
});
