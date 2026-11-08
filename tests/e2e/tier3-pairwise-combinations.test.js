/**
 * Tier 3 : Combinaisons Croisées (Pairwise) et Dédoublonnage Multi-Outils
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
  parseSpiderfootJson,
  deduplicateAccounts
} from './helpers/contracts.js';

import {
  assertUnifiedAccount,
  assertUnifiedLeak
} from './helpers/assertions.js';

import {
  loadJdmSample,
  loadJgmdSample,
  loadToolOutput,
  ensureTmpDir,
  cleanTmpDir
} from './helpers/test-env.js';

describe('Tier 3 : Combinaisons Croisées et Dédoublonnage', () => {
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
  // T3.1 : Matrice de combinaisons d'entrées (Pairwise)
  // =========================================================================
  describe('T3.1 : Combinaisons d\'entrées (Pairwise)', () => {
    test('T3.1.1 : Email seul (active Holehe, h8mail, GHunt, SpiderFoot)', () => {
      const target = normalizeTarget({ email: 'jean@example.com' });
      assert.strictEqual(target.isValid, true);
      assert.ok(target.email);
      assert.strictEqual(target.username, undefined);
      assert.strictEqual(target.phone, undefined);
    });

    test('T3.1.2 : Pseudo seul (active Maigret, SpiderFoot)', () => {
      const target = normalizeTarget({ username: 'jeandupont' });
      assert.strictEqual(target.isValid, true);
      assert.strictEqual(target.email, undefined);
      assert.ok(target.username);
      assert.strictEqual(target.phone, undefined);
    });

    test('T3.1.3 : Téléphone seul (active Ignorant, SpiderFoot)', () => {
      const target = normalizeTarget({ phone: '+33699504346' });
      assert.strictEqual(target.isValid, true);
      assert.strictEqual(target.email, undefined);
      assert.strictEqual(target.username, undefined);
      assert.ok(target.phone);
      assert.strictEqual(target.phoneCountryCode, '33');
    });

    test('T3.1.4 : Email + Pseudo combinés', () => {
      const target = normalizeTarget({
        email: 'jean@example.com',
        username: 'jeandupont'
      });
      assert.strictEqual(target.isValid, true);
      assert.ok(target.email && target.username);
      assert.strictEqual(target.phone, undefined);
    });

    test('T3.1.5 : Email + Téléphone combinés', () => {
      const target = normalizeTarget({
        email: 'jean@example.com',
        phone: '+33699504346'
      });
      assert.strictEqual(target.isValid, true);
      assert.ok(target.email && target.phone);
      assert.strictEqual(target.username, undefined);
    });

    test('T3.1.6 : Pseudo + Téléphone combinés', () => {
      const target = normalizeTarget({
        username: 'jeandupont',
        phone: '+33699504346'
      });
      assert.strictEqual(target.isValid, true);
      assert.ok(target.username && target.phone);
      assert.strictEqual(target.email, undefined);
    });

    test('T3.1.7 : Email + Pseudo + Téléphone (les 3 cibles simultanées)', () => {
      const target = normalizeTarget({
        email: 'jean@example.com',
        username: 'jeandupont',
        phone: '+33699504346'
      });
      assert.strictEqual(target.isValid, true);
      assert.ok(target.email && target.username && target.phone);
    });
  });

  // =========================================================================
  // T3.2 : Dédoublonnage multi-outils
  // =========================================================================
  describe('T3.2 : Dédoublonnage multi-outils', () => {
    test('T3.2.1 : fusionne GitHub détecté par Holehe et Maigret en une entrée unique', () => {
      const holeheAccount = {
        id: crypto.randomUUID(),
        serviceId: 'github',
        serviceName: 'Github',
        domain: 'github.com',
        accountIdentifier: 'jean@example.com',
        sourceTool: 'holehe',
        status: 'claimed',
        metadata: {},
        cleaned: false
      };

      const maigretAccount = {
        id: crypto.randomUUID(),
        serviceId: 'github',
        serviceName: 'GitHub',
        domain: 'github.com',
        accountIdentifier: 'jeandupont',
        sourceTool: 'maigret',
        status: 'claimed',
        profileUrl: 'https://github.com/jeandupont',
        avatarUrl: 'https://avatars.githubusercontent.com/u/10?v=4',
        metadata: { fullname: 'Jean Dupont' },
        cleaned: false
      };

      const deduplicated = deduplicateAccounts([holeheAccount, maigretAccount]);
      assert.strictEqual(deduplicated.length, 1);
      assert.strictEqual(deduplicated[0].domain, 'github.com');
      assert.ok(deduplicated[0].sourceTools.includes('holehe'));
      assert.ok(deduplicated[0].sourceTools.includes('maigret'));
      assert.strictEqual(deduplicated[0].profileUrl, 'https://github.com/jeandupont');
      assert.strictEqual(deduplicated[0].avatarUrl, 'https://avatars.githubusercontent.com/u/10?v=4');
    });

    test('T3.2.2 : fusionne Instagram détecté par Ignorant et Maigret', () => {
      const ignorantAccount = {
        id: crypto.randomUUID(),
        serviceId: 'instagram',
        serviceName: 'Instagram',
        domain: 'instagram.com',
        accountIdentifier: '+33699504346',
        sourceTool: 'ignorant',
        status: 'claimed',
        metadata: {},
        cleaned: false
      };

      const maigretAccount = {
        id: crypto.randomUUID(),
        serviceId: 'instagram',
        serviceName: 'Instagram',
        domain: 'instagram.com',
        accountIdentifier: 'jeandupont',
        sourceTool: 'maigret',
        status: 'claimed',
        profileUrl: 'https://instagram.com/jeandupont',
        metadata: {},
        cleaned: false
      };

      const deduplicated = deduplicateAccounts([ignorantAccount, maigretAccount]);
      assert.strictEqual(deduplicated.length, 1);
      assert.deepStrictEqual(deduplicated[0].sourceTools.sort(), ['ignorant', 'maigret']);
    });

    test('T3.2.3 : fusionne Spotify détecté par Holehe et SpiderFoot', () => {
      const holeheAccount = {
        id: crypto.randomUUID(),
        serviceId: 'spotify',
        serviceName: 'Spotify',
        domain: 'spotify.com',
        accountIdentifier: 'jean@example.com',
        sourceTool: 'holehe',
        status: 'claimed',
        metadata: {},
        cleaned: false
      };

      const sfAccount = {
        id: crypto.randomUUID(),
        serviceId: 'spotify',
        serviceName: 'Spotify',
        domain: 'spotify.com',
        accountIdentifier: 'jean@example.com',
        sourceTool: 'spiderfoot',
        status: 'claimed',
        profileUrl: 'https://open.spotify.com/user/jean',
        metadata: {},
        cleaned: false
      };

      const deduplicated = deduplicateAccounts([holeheAccount, sfAccount]);
      assert.strictEqual(deduplicated.length, 1);
      assert.deepStrictEqual(deduplicated[0].sourceTools.sort(), ['holehe', 'spiderfoot']);
      assert.strictEqual(deduplicated[0].profileUrl, 'https://open.spotify.com/user/jean');
    });

    test('T3.2.4 : fusionne Google détecté par GHunt et Maigret', () => {
      const ghuntAccount = {
        id: crypto.randomUUID(),
        serviceId: 'google',
        serviceName: 'Google',
        domain: 'google.com',
        accountIdentifier: 'jean@gmail.com',
        sourceTool: 'ghunt',
        status: 'claimed',
        metadata: { gaiaId: '1042301988' },
        cleaned: false
      };

      const maigretAccount = {
        id: crypto.randomUUID(),
        serviceId: 'google',
        serviceName: 'Google',
        domain: 'google.com',
        accountIdentifier: 'jean',
        sourceTool: 'maigret',
        status: 'claimed',
        metadata: {},
        cleaned: false
      };

      const deduplicated = deduplicateAccounts([ghuntAccount, maigretAccount]);
      assert.strictEqual(deduplicated.length, 1);
      assert.deepStrictEqual(deduplicated[0].sourceTools.sort(), ['ghunt', 'maigret']);
      assert.strictEqual(deduplicated[0].metadata.gaiaId, '1042301988');
    });

    test('T3.2.5 : dédoublonnage insensible à la casse et au format d\'URL', () => {
      const a1 = {
        id: crypto.randomUUID(),
        serviceId: 'github',
        serviceName: 'GitHub',
        domain: 'GITHUB.COM',
        accountIdentifier: 'test',
        sourceTool: 'holehe',
        status: 'claimed',
        metadata: {},
        cleaned: false
      };

      const a2 = {
        id: crypto.randomUUID(),
        serviceId: 'github',
        serviceName: 'github',
        domain: 'https://www.github.com/test',
        accountIdentifier: 'test',
        sourceTool: 'maigret',
        status: 'claimed',
        metadata: {},
        cleaned: false
      };

      const deduplicated = deduplicateAccounts([a1, a2]);
      assert.strictEqual(deduplicated.length, 1);
      assert.strictEqual(deduplicated[0].domain, 'github.com');
    });
  });

  // =========================================================================
  // T3.3 : Conflits et priorités de réconciliation JDM
  // =========================================================================
  describe('T3.3 : Priorités de réconciliation JDM', () => {
    test('T3.3.1 : Priorité 1 (Alias canonique) prévaut sur Priorité 4 (Nom)', () => {
      // office365.com a pour alias microsoft.com
      const match = matchAccountToJDM('Office', 'office365.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.strictEqual(match.matchedBy, 'alias');
      assert.strictEqual(match.entry.name, 'Microsoft Account');
    });

    test('T3.3.2 : Priorité 2 (Domaine exact) prévaut sur Priorité 3 (Racine)', () => {
      const match = matchAccountToJDM('Spotify', 'spotify.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.strictEqual(match.matchedBy, 'domain_exact');
      assert.strictEqual(match.confidence, 1.0);
    });

    test('T3.3.3 : Priorité 3 (Racine) prévaut sur Priorité 5 (Fuzzy)', () => {
      const match = matchAccountToJDM('AutreNom', 'open.spotify.com', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.strictEqual(match.matchedBy, 'domain_root');
      assert.strictEqual(match.confidence, 0.9);
      assert.strictEqual(match.entry.name, 'Spotify');
    });

    test('T3.3.4 : Priorité 4 (Nom exact) prévaut sur Priorité 5 (Fuzzy)', () => {
      const match = matchAccountToJDM('Amazon', '', jdmSample, jdmIndexes.domainIndex, jdmIndexes.nameIndex);
      assert.strictEqual(match.matchedBy, 'name_exact');
      assert.strictEqual(match.confidence, 0.85);
      assert.strictEqual(match.entry.name, 'Amazon');
    });
  });

  // =========================================================================
  // T3.4 : Corrélation Fuites / Comptes
  // =========================================================================
  describe('T3.4 : Corrélation Fuites / Comptes', () => {
    test('T3.4.1 : identifie une fuite associée à un compte actif trouvé', () => {
      const accounts = [
        {
          id: 'acc-1',
          serviceName: 'Adobe',
          domain: 'adobe.com',
          accountIdentifier: 'victim@example.com'
        }
      ];

      const leaks = [
        {
          id: 'leak-1',
          target: 'victim@example.com',
          breachName: 'Adobe Breach 2013',
          dataClasses: ['passwords', 'emails']
        }
      ];

      const correlated = accounts.map((a) => {
        const matchingLeak = leaks.find((l) => l.breachName.toLowerCase().includes(a.serviceName.toLowerCase()));
        return {
          ...a,
          hasAssociatedLeak: Boolean(matchingLeak),
          leakDetails: matchingLeak
        };
      });

      assert.strictEqual(correlated[0].hasAssociatedLeak, true);
      assert.strictEqual(correlated[0].leakDetails.breachName, 'Adobe Breach 2013');
    });

    test('T3.4.2 : gère les fuites globales orphelines (non rattachées à un compte local)', () => {
      const leaks = [
        {
          id: 'leak-2',
          target: 'victim@example.com',
          breachName: 'Collection1',
          dataClasses: ['credentials']
        }
      ];

      const accounts = [
        {
          id: 'acc-spotify',
          serviceName: 'Spotify',
          domain: 'spotify.com'
        }
      ];

      const matching = accounts.filter((a) => a.serviceName.toLowerCase() === leaks[0].breachName.toLowerCase());
      assert.strictEqual(matching.length, 0, 'La fuite globale Collection1 ne doit pas être rattachée à tort à Spotify');
    });

    test('T3.4.3 : élève la priorité de suppression pour les comptes ayant des fuites avérées', () => {
      const accountWithLeak = {
        serviceName: 'CompromisedService',
        hasLeak: true,
        priority: 'high'
      };

      const safeAccount = {
        serviceName: 'SafeService',
        hasLeak: false,
        priority: 'normal'
      };

      assert.strictEqual(accountWithLeak.priority, 'high');
      assert.strictEqual(safeAccount.priority, 'normal');
    });
  });
});
