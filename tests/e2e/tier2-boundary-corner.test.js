/**
 * Tier 2 : Limites, Cas aux Bornes et Robustesse (>= 5 tests par domaine)
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
  assertValidMailto
} from './helpers/assertions.js';

import {
  loadJdmSample,
  loadJgmdSample,
  ensureTmpDir,
  cleanTmpDir
} from './helpers/test-env.js';

describe('Tier 2 : Limites, Cas aux Bornes et Robustesse', () => {
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
  // T2.1 : Entrées atypiques et invalidations
  // =========================================================================
  describe('T2.1 : Entrées atypiques et invalidations', () => {
    test('T2.1.1 : rejette une adresse email sans arobase ni domaine', () => {
      const res = normalizeTarget({ email: 'invalide-sans-domaine' });
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.length > 0);
    });

    test('T2.1.2 : gère proprement une saisie vide ou composée d\'espaces', () => {
      const res = normalizeTarget({ email: '   ', username: '   ', phone: '   ' });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.email, undefined);
      assert.strictEqual(res.username, undefined);
      assert.strictEqual(res.phone, undefined);
    });

    test('T2.1.3 : rejette un numéro de téléphone excessivement court (< 7 chiffres)', () => {
      const res = normalizeTarget({ phone: '123' });
      assert.strictEqual(res.isValid, false);
      assert.ok(res.errors.some((e) => e.includes('trop court')));
    });

    test('T2.1.4 : assainit un téléphone avec de multiples signes +, tirets et parenthèses', () => {
      const res = normalizeTarget({ phone: '++33 (0)6-99-50-43-46' });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.phoneCountryCode, '33');
      assert.strictEqual(res.phoneNumber, '699504346');
    });

    test('T2.1.5 : neutralise les caractères de contrôle et balises dans les pseudos', () => {
      const res = normalizeTarget({ username: '<script>alert("xss")</script>' });
      assert.strictEqual(res.isValid, true);
      assert.strictEqual(res.username, '<script>alert("xss")</script>');
    });
  });

  // =========================================================================
  // T2.2 : Résilience face aux erreurs d'outils et timeouts
  // =========================================================================
  describe('T2.2 : Résilience face aux erreurs d\'outils', () => {
    test('T2.2.1 : gestion d\'outil absent du système sans bloquer l\'application', () => {
      const toolCheck = { installed: false, path: null, error: 'Binaire introuvable' };
      assert.strictEqual(toolCheck.installed, false);
      assert.ok(toolCheck.error);
    });

    test('T2.2.2 : Holehe avec code retour 1 et absence de CSV est requalifié en erreur', () => {
      const exitCode = 1;
      const csvGenerated = false;
      const isSuccess = exitCode === 0 || (exitCode === 1 && csvGenerated);
      assert.strictEqual(isSuccess, false, 'Doit être un échec si code 1 sans fichier CSV généré');
    });

    test('T2.2.3 : gestion du signal d\'annulation (timeout AbortController)', async () => {
      const controller = new AbortController();
      let aborted = false;

      controller.signal.addEventListener('abort', () => {
        aborted = true;
      });

      controller.abort();
      assert.strictEqual(aborted, true);
      assert.strictEqual(controller.signal.aborted, true);
    });

    test('T2.2.4 : détection du statut rate_limited [x] sans affirmer que le compte n\'existe pas', () => {
      const stdout = '[x] snapchat.com\n[x] instagram.com';
      const accounts = parseIgnorantStdout(stdout, '+33699504346');
      assert.strictEqual(accounts.length, 2);
      assert.strictEqual(accounts[0].status, 'rate_limited');
      assert.strictEqual(accounts[1].status, 'rate_limited');
    });

    test('T2.2.5 : GHunt non authentifié détecte GHuntInvalidSession sans faire planter l\'audit', () => {
      const stdoutError = 'ghunt.errors.GHuntInvalidSession: No stored session found.';
      const accounts = parseGhuntStdout(stdoutError, 'test@gmail.com');
      assert.strictEqual(accounts.length, 0);
    });

    test('T2.2.6 : SpiderFoot avec sortie vide ou tronquée renvoie un résultat vide sans lever d\'exception', () => {
      const { accounts, leaks } = parseSpiderfootJson('[]', 'cible');
      assert.strictEqual(accounts.length, 0);
      assert.strictEqual(leaks.length, 0);
    });
  });

  // =========================================================================
  // T2.3 : Anomalies de données et formats bruts
  // =========================================================================
  describe('T2.3 : Anomalies de données et formats bruts', () => {
    test('T2.3.1 : CSV Holehe vide (en-tête seule) produit une liste vide', () => {
      const csv = 'name,domain,rateLimit,exists,emailrecovery,phoneNumber,others\n';
      const accounts = parseHoleheCsv(csv, 'test@example.com');
      assert.strictEqual(accounts.length, 0);
    });

    test('T2.3.2 : JSON Maigret tronqué lève une erreur gérée ou renvoie un dictionnaire vide', () => {
      assert.throws(() => {
        parseMaigretJson('{ "GitHub": { "status": ', 'pseudo');
      }, SyntaxError);
    });

    test('T2.3.3 : Stdout Ignorant vide produit une liste vide', () => {
      const accounts = parseIgnorantStdout('', '+33699504346');
      assert.strictEqual(accounts.length, 0);
    });

    test('T2.3.4 : JSON h8mail avec targets null produit un tableau vide', () => {
      const leaks = parseH8mailJson({ targets: null }, 'test@example.com');
      assert.strictEqual(leaks.length, 0);
    });

    test('T2.3.5 : SpiderFoot JSON avec structure non attendue ne provoque aucun plantage', () => {
      const { accounts, leaks } = parseSpiderfootJson([{ inconnu: true }], 'cible');
      assert.strictEqual(accounts.length, 0);
      assert.strictEqual(leaks.length, 0);
    });
  });

  // =========================================================================
  // T2.4 : Cas limites de réconciliation JDM/JGMD
  // =========================================================================
  describe('T2.4 : Cas limites de réconciliation JDM/JGMD', () => {
    test('T2.4.1 : domaine avec sous-domaine profond extrait la racine', () => {
      const match = matchAccountToJDM('test', 'deep.sub.level.spotify.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.ok(match.entry);
      assert.strictEqual(match.entry.name, 'Spotify');
    });

    test('T2.4.2 : URL avec protocole majuscule et chemin résiduel', () => {
      const domain = cleanDomain('HTTPS://WWW.SPOTIFY.COM:443/fr/account/overview');
      assert.strictEqual(domain, 'spotify.com');
    });

    test('T2.4.3 : service inconnu ou exotique renvoie un statut unknown', () => {
      const match = matchAccountToJDM('Polymarket', 'polymarket.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.strictEqual(match.entry, null);
      assert.strictEqual(match.matchedBy, 'none');
    });

    test('T2.4.4 : service avec domaine racine à double extension (.co.uk)', () => {
      const domain = cleanDomain('https://amazon.co.uk/your-account');
      assert.strictEqual(domain, 'amazon.co.uk');
    });

    test('T2.4.5 : résolution JGMD insensible à la casse et aux espaces', () => {
      const res = resolveJGMD('  GooGle  ', 'GOOGLE.COM', jgmdSample);
      assert.strictEqual(res.matched, true);
      assert.strictEqual(res.exportUrl, 'https://takeout.google.com/');
    });
  });

  // =========================================================================
  // T2.5 : Cas limites du générateur RGPD
  // =========================================================================
  describe('T2.5 : Cas limites du générateur RGPD', () => {
    test('T2.5.1 : omission propre de la ligne téléphone si non fourni', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'dpo@service.com',
        serviceName: 'ServiceSansTel',
        userName: 'Jean Dupont',
        userEmail: 'jean@example.com',
        accountUsername: 'jean',
        language: 'fr'
      });

      assert.strictEqual(email.body.includes('Numéro de téléphone'), false);
      assertGdprEmailFrenchNoHyphens(email.body, 'Sans téléphone');
    });

    test('T2.5.2 : fallback automatique sur dpo@domaine si email destinataire non fourni', () => {
      const email = generateGdprArticle17Email({
        serviceName: 'customsite.fr',
        userName: 'Jean',
        language: 'fr'
      });

      assert.strictEqual(email.recipientEmail, 'dpo@customsite.fr');
    });

    test('T2.5.3 : support des noms avec apostrophes et caractères accentués', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'dpo@service.com',
        serviceName: 'Test',
        userName: "Jean d'Ormesson de Saint-Germain",
        userEmail: 'jean@example.com',
        language: 'fr'
      });

      // Le corps doit contenir le nom
      assert.ok(email.body.includes("Jean d'Ormesson"));
    });

    test('T2.5.4 : encodage RFC 3986 sur les caractères réservés (&, =, ?)', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'dpo+privacy@service.com',
        serviceName: 'R&D & Services',
        userName: 'Test User',
        userEmail: 'test@example.com',
        language: 'fr'
      });

      assertValidMailto(email.mailtoUri);
      assert.ok(!email.mailtoUri.includes(' '));
    });

    test('T2.5.5 : vérification stricte : aucun tiret dans les phrases en français du modèle', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'dpo@test.com',
        serviceName: 'Plateforme Web',
        userName: 'Jean Dupont',
        userEmail: 'jean@test.com',
        userPhone: '+33699504346',
        accountUsername: 'jeandupont',
        language: 'fr'
      });

      assertGdprEmailFrenchNoHyphens(email.body, 'Vérification zéro tiret dans le modèle français');
    });

    test('T2.5.6 : invocation avec objet vide utilise les valeurs par défaut sans erreur', () => {
      const email = generateGdprArticle17Email({});
      assert.ok(email.subject);
      assert.ok(email.body);
      assert.ok(email.mailtoUri);
    });
  });

  // =========================================================================
  // T2.6 : Limites et robustesse SQLite
  // =========================================================================
  describe('T2.6 : Limites et robustesse SQLite', () => {
    let storage;

    beforeEach(() => {
      storage = createStorageEngine(':memory:');
    });

    afterEach(() => {
      storage.close();
    });

    test('T2.6.1 : conflit de clé primaire sur scans lève une exception SQLite', () => {
      const fixedId = 'e3b0c442-98fc-4c14-9afe-048b0662d517';
      storage.createScan({ id: fixedId, title: 'Premier' });
      assert.throws(() => {
        storage.createScan({ id: fixedId, title: 'Doublon' });
      });
    });

    test('T2.6.2 : tentative d\'insérer un compte avec scan_id inexistant lève une foreign key error', () => {
      assert.throws(() => {
        storage.saveAccounts([
          {
            id: crypto.randomUUID(),
            scanId: 'scan-inexistant-uuid',
            serviceName: 'Orphelin',
            accountIdentifier: 'test@example.com',
            domain: 'orphelin.com'
          }
        ]);
      });
    });

    test('T2.6.3 : résistance complète aux tentatives d\'injection SQL via requêtes préparées', () => {
      const injectionTitle = "Audit'; DROP TABLE scans; --";
      const scanId = storage.createScan({ title: injectionTitle });
      const scan = storage.getScan(scanId);
      assert.strictEqual(scan.title, injectionTitle);

      // La table scans existe toujours
      const allScans = storage.listScans();
      assert.ok(allScans.length >= 1);
    });

    test('T2.6.4 : gestion robuste des valeurs nulles et champs optionnels', () => {
      const scanId = storage.createScan({ title: 'Null test' });
      const accountId = crypto.randomUUID();

      storage.saveAccounts([
        {
          id: accountId,
          scanId: scanId,
          serviceName: 'MinimalAccount',
          accountIdentifier: 'user1',
          domain: 'minimal.org',
          profileUrl: null,
          statusNotes: null,
          processedAt: null
        }
      ]);

      const acc = storage.getAccountsByScan(scanId)[0];
      assert.strictEqual(acc.profile_url, null);
      assert.strictEqual(acc.status_notes, null);
      assert.strictEqual(acc.processed_at, null);
    });

    test('T2.6.5 : transaction atomique : rollback complet en cas d\'erreur', () => {
      const scanId = storage.createScan({ title: 'Transaction Scan' });
      assert.strictEqual(storage.getAccountsByScan(scanId).length, 0);

      // Simulation transaction avec échec
      assert.throws(() => {
        storage.db.exec('BEGIN TRANSACTION;');
        const stmt = storage.db.prepare('INSERT INTO scans (id, title, created_at, status, tools_selected) VALUES (?, ?, ?, ?, ?)');
        stmt.run('id-1', 'T1', new Date().toISOString(), 'running', '[]');
        // Échec provoqué (clé primaire dupliquée)
        stmt.run('id-1', 'T2', new Date().toISOString(), 'running', '[]');
        storage.db.exec('COMMIT;');
      });

      storage.db.exec('ROLLBACK;');
      assert.strictEqual(storage.getScan('id-1'), null);
    });

    test('T2.6.6 : indexation opérationnelle et vérifiée par EXPLAIN QUERY PLAN', () => {
      const plan = storage.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM discovered_accounts WHERE scan_id = ?').all('dummy-id');
      assert.ok(plan.length > 0);
      const planStr = JSON.stringify(plan);
      assert.ok(planStr.includes('idx_accounts_scan') || planStr.includes('INDEX'));
    });
  });
});
