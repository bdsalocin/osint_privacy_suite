import { describe, it, expect } from 'vitest';
import {
  cleanDomain,
  buildJdmIndexes,
  matchAccountToJDM,
  getDifficultyMetadata,
  JdmMatcher,
  CANONICAL_ALIASES,
  JustDeleteMeEntry
} from '../../src/core/jdm-matcher.js';
import {
  resolveJGMD,
  JgmdMatcher,
  DIRECT_TAKEOUT_PORTALS,
  JGMDRecord
} from '../../src/core/jgmd-matcher.js';
import { UnifiedAccount } from '../../src/core/types.js';

describe('JdmMatcher & JgmdMatcher', () => {
  const sampleEntries: JustDeleteMeEntry[] = [
    {
      name: 'Spotify',
      url: 'https://support.spotify.com/close-account',
      difficulty: 'medium',
      domains: ['spotify.com'],
      notes: 'Contact support via chat to close account.',
      notes_fr: 'Contacter le support par chat pour fermer le compte.',
      email: 'privacy@spotify.com'
    },
    {
      name: 'Microsoft Account',
      url: 'https://account.live.com/closeaccount.aspx',
      difficulty: 'medium',
      domains: ['microsoft.com', 'live.com', 'office.com'],
      notes: 'Follow wizard to delete account.'
    },
    {
      name: 'Google',
      url: 'https://myaccount.google.com/delete-services-or-account',
      difficulty: 'easy',
      domains: ['google.com'],
      notes: 'Delete directly from settings.'
    },
    {
      name: 'Twitter',
      url: 'https://twitter.com/settings/deactivate',
      difficulty: 'easy',
      domains: ['twitter.com']
    },
    {
      name: 'Impossible Service',
      url: 'https://example.com/no-delete',
      difficulty: 'impossible',
      domains: ['impossible.org'],
      notes: 'Account cannot be deleted.'
    },
    {
      name: 'Limited Service',
      url: 'https://example.com/gdpr-only',
      difficulty: 'limited',
      domains: ['limited.eu'],
      notes: 'GDPR residents only.'
    }
  ];

  describe('cleanDomain', () => {
    it('strips protocol, www and trailing paths', () => {
      expect(cleanDomain('https://www.spotify.com/account/')).toBe('spotify.com');
      expect(cleanDomain('http://login.live.com/test')).toBe('login.live.com');
      expect(cleanDomain('amazon.co.uk')).toBe('amazon.co.uk');
      expect(cleanDomain('   OPEN.SPOTIFY.COM  ')).toBe('open.spotify.com');
      expect(cleanDomain('')).toBe('');
    });
  });

  describe('buildJdmIndexes & matchAccountToJDM', () => {
    const { domainIndex, nameIndex } = buildJdmIndexes(sampleEntries);

    it('matches canonical aliases accurately (Tier 1)', () => {
      // office365.com is aliased to microsoft.com
      const res = matchAccountToJDM('Office 365', 'office365.com', sampleEntries, domainIndex, nameIndex);
      expect(res.matchedBy).toBe('alias');
      expect(res.confidence).toBe(1.0);
      expect(res.entry?.name).toBe('Microsoft Account');

      // x.com aliased to twitter.com
      const resTwitter = matchAccountToJDM('X', 'x.com', sampleEntries, domainIndex, nameIndex);
      expect(resTwitter.matchedBy).toBe('alias');
      expect(resTwitter.entry?.name).toBe('Twitter');
    });

    it('matches exact domain (Tier 2)', () => {
      const res = matchAccountToJDM('Spotify', 'spotify.com', sampleEntries, domainIndex, nameIndex);
      expect(res.matchedBy).toBe('domain_exact');
      expect(res.confidence).toBe(1.0);
      expect(res.entry?.name).toBe('Spotify');
    });

    it('matches root domain for subdomains (Tier 3)', () => {
      const res = matchAccountToJDM('My Service', 'music.spotify.com', sampleEntries, domainIndex, nameIndex);
      expect(res.matchedBy).toBe('domain_root');
      expect(res.confidence).toBe(0.9);
      expect(res.entry?.name).toBe('Spotify');
    });

    it('matches normalized service name (Tier 4)', () => {
      const res = matchAccountToJDM('  Google  ', 'some-unknown-domain.io', sampleEntries, domainIndex, nameIndex);
      expect(res.matchedBy).toBe('name_exact');
      expect(res.confidence).toBe(0.85);
      expect(res.entry?.name).toBe('Google');
    });

    it('matches fuzzy partial string inclusion (Tier 5)', () => {
      const res = matchAccountToJDM('Spotify Premium Subscriptions', 'unknown.net', sampleEntries, domainIndex, nameIndex);
      expect(res.matchedBy).toBe('fuzzy');
      expect(res.confidence).toBe(0.7);
      expect(res.entry?.name).toBe('Spotify');
    });

    it('returns none and confidence 0 for unreferenced services', () => {
      const res = matchAccountToJDM('Polymarket', 'polymarket.com', sampleEntries, domainIndex, nameIndex);
      expect(res.matchedBy).toBe('none');
      expect(res.confidence).toBe(0.0);
      expect(res.entry).toBeNull();
    });
  });

  describe('getDifficultyMetadata', () => {
    it('provides correct labels and Tailwind badges for all difficulties', () => {
      const easy = getDifficultyMetadata('easy');
      expect(easy.label).toBe('Facile');
      expect(easy.color).toBe('#10B981');
      expect(easy.tailwindClasses).toContain('emerald');

      const medium = getDifficultyMetadata('medium');
      expect(medium.label).toBe('Moyen');
      expect(medium.color).toBe('#F59E0B');

      const hard = getDifficultyMetadata('hard');
      expect(hard.label).toBe('Difficile');
      expect(hard.color).toBe('#EF4444');

      const impossible = getDifficultyMetadata('impossible');
      expect(impossible.label).toBe('Impossible');
      expect(impossible.color).toBe('#1F2937');

      const limited = getDifficultyMetadata('limited');
      expect(limited.label).toBe('Conditionnel');
      expect(limited.color).toBe('#8B5CF6');

      const unknown = getDifficultyMetadata('unknown');
      expect(unknown.label).toBe('Non référencé');
      expect(unknown.color).toBe('#6B7280');
    });
  });

  describe('JdmMatcher full database verification', () => {
    it('loads the full local database of 2,660 sites', () => {
      const matcher = new JdmMatcher();
      expect(matcher.getSiteCount()).toBe(2660);

      const spotify = matcher.getSiteByName('Spotify');
      expect(spotify).not.toBeNull();
      expect(spotify?.domains).toContain('spotify.com');

      const github = matcher.getSiteByName('GitHub');
      expect(github).not.toBeNull();
      expect(github?.difficulty).toBe('easy');
    });

    it('enriches a UnifiedAccount with JDM info', () => {
      const matcher = new JdmMatcher();
      const rawAccount: UnifiedAccount = {
        id: 'acc_1',
        serviceId: 'spotify',
        serviceName: 'Spotify',
        domain: 'spotify.com',
        accountIdentifier: 'user@example.com',
        sourceTool: 'holehe',
        status: 'claimed',
        cleaned: false,
        metadata: {}
      };

      const enriched = matcher.enrichAccount(rawAccount);
      expect(enriched.jdm?.matched).toBe(true);
      expect(enriched.jdm?.deleteUrl).toBeDefined();
      expect(enriched.jdm?.difficulty).toBeDefined();
    });

    it('handles unknown accounts with difficulty unknown', () => {
      const matcher = new JdmMatcher();
      const rawAccount: UnifiedAccount = {
        id: 'acc_2',
        serviceId: 'nonexistent_service_123',
        serviceName: 'Nonexistent Service 123',
        domain: 'nonexistentservice123xyz.com',
        accountIdentifier: 'user@example.com',
        sourceTool: 'holehe',
        status: 'claimed',
        cleaned: false,
        metadata: {}
      };

      const enriched = matcher.enrichAccount(rawAccount);
      expect(enriched.jdm?.matched).toBe(false);
      expect(enriched.jdm?.difficulty).toBe('unknown');
    });
  });

  describe('resolveJGMD & JgmdMatcher', () => {
    const sampleJgmd: JGMDRecord[] = [
      {
        name: 'Custom Service',
        url: 'https://custom.com/download-data',
        domains: ['custom.com'],
        notes: 'Download via profile settings.'
      }
    ];

    it('resolves direct takeout portals (Google, Meta, Apple, Spotify, GitHub, etc.)', () => {
      const gRes = resolveJGMD('Google', 'google.com');
      expect(gRes.matched).toBe(true);
      expect(gRes.exportUrl).toBe(DIRECT_TAKEOUT_PORTALS.google);
      expect(gRes.source).toBe('direct_portal');

      const sRes = resolveJGMD('Spotify', 'spotify.com');
      expect(sRes.matched).toBe(true);
      expect(sRes.exportUrl).toBe(DIRECT_TAKEOUT_PORTALS.spotify);

      const ghRes = resolveJGMD('GitHub', 'github.com');
      expect(ghRes.matched).toBe(true);
      expect(ghRes.exportUrl).toBe(DIRECT_TAKEOUT_PORTALS.github);
    });

    it('resolves entries from JGMD records array', () => {
      const res = resolveJGMD('Custom Service', 'custom.com', sampleJgmd);
      expect(res.matched).toBe(true);
      expect(res.exportUrl).toBe('https://custom.com/download-data');
      expect(res.source).toBe('jgmd_list');
    });

    it('returns unmatched for unknown services', () => {
      const res = resolveJGMD('Unknown Platform', 'unknownplatformxyz.com', sampleJgmd);
      expect(res.matched).toBe(false);
      expect(res.exportUrl).toBeNull();
      expect(res.source).toBe('none');
    });

    it('enriches account with getDataUrl', () => {
      const matcher = new JgmdMatcher(sampleJgmd);
      const acc: UnifiedAccount = {
        id: 'acc_3',
        serviceId: 'google',
        serviceName: 'Google',
        domain: 'google.com',
        accountIdentifier: 'user@gmail.com',
        sourceTool: 'ghunt',
        status: 'claimed',
        cleaned: false,
        metadata: {}
      };

      const enriched = matcher.enrichAccount(acc);
      expect(enriched.jdm?.getDataUrl).toBe(DIRECT_TAKEOUT_PORTALS.google);
    });
  });
});
