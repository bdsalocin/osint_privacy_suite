import { describe, it, expect } from 'vitest';
import {
  generateGdprArticle17Email,
  generateGdprArticle15Email,
  generateGdprMailtoUri
} from '../../src/core/gdpr-generator.js';

describe('GDPR Generator (Article 17 & Article 15)', () => {
  describe('Article 17 — French model & strict hyphen absence rule', () => {
    it('STRICT ADVERSARIAL CHECK: ensures zero hyphens (-) anywhere in French email body', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'dpo@service.com',
        serviceName: 'TestService',
        userName: 'Jean Dupont',
        userEmail: 'jean@example.com',
        accountUsername: 'jeandupont',
        userPhone: '+33699504346',
        language: 'fr'
      });

      // Strict verification of the user rule: ZERO hyphens in French text
      expect(email.body.includes('-')).toBe(false);
      expect(email.subject.includes('-')).toBe(false);

      // Verify essential CNIL legal mentions
      expect(email.body).toContain('article 17.1');
      expect(email.body).toContain('Règlement général sur la protection des données');
      expect(email.body).toContain('loi Informatique et Libertés');
      expect(email.body).toContain('sous traitants'); // without hyphen!
      expect(email.body).toContain("délai maximal d'un mois");
      expect(email.body).toContain('Commission Nationale de l\'Informatique et des Libertés (CNIL)');
      expect(email.body).toContain('Jean Dupont');
      expect(email.body).toContain('jean@example.com');
      expect(email.body).toContain('+33699504346');
    });

    it('omits phone line cleanly when phone is not provided', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'dpo@service.com',
        serviceName: 'ServiceSansTelephone',
        userName: 'Jean Dupont',
        userEmail: 'jean@example.com',
        accountUsername: 'jean',
        language: 'fr'
      });

      expect(email.body).not.toContain('Numéro de téléphone');
      expect(email.body.includes('-')).toBe(false);
    });

    it('falls back to default recipient email dpo@domain if none provided', () => {
      const email = generateGdprArticle17Email({
        serviceName: 'myservice.fr',
        userName: 'Jean',
        language: 'fr'
      });

      expect(email.recipientEmail).toBe('dpo@myservice.fr');
    });
  });

  describe('Article 17 — English model', () => {
    it('generates a compliant English GDPR erasure request', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'dpo@github.com',
        serviceName: 'GitHub',
        userName: 'Jean Dupont',
        userEmail: 'jean@example.com',
        accountUsername: 'jeandupont',
        userPhone: '+33699504346',
        language: 'en'
      });

      expect(email.language).toBe('en');
      expect(email.subject).toContain('Article 17 GDPR');
      expect(email.subject).toContain('GitHub');
      expect(email.body).toContain('Dear Data Protection Officer');
      expect(email.body).toContain('Article 17 of the General Data Protection Regulation');
      expect(email.body).toContain('third party processors');
      expect(email.body).toContain('at the latest within one month of receipt');
      expect(email.body).toContain('+33699504346');
    });
  });

  describe('RFC 3986 Mailto URI Generation', () => {
    it('produces valid mailto URIs with proper percent-encoding', () => {
      const email = generateGdprArticle17Email({
        recipientEmail: 'privacy@spotify.com',
        serviceName: 'Spotify',
        userName: 'Jean Dupont',
        userEmail: 'jean@example.com',
        language: 'fr'
      });

      expect(email.mailtoUri.startsWith('mailto:privacy%40spotify.com')).toBe(true);
      expect(email.mailtoUri).toContain('?subject=');
      expect(email.mailtoUri).toContain('&body=');

      // Ensure no raw spaces in mailto URI
      expect(email.mailtoUri.includes(' ')).toBe(false);
    });

    it('safely handles reserved characters (&, =, ?) in inputs', () => {
      const uri = generateGdprMailtoUri({
        recipientEmail: 'dpo+test@domain.com',
        subject: 'Test & Query = True ?',
        body: 'Line 1\nLine 2 & param=val'
      });

      expect(uri.startsWith('mailto:dpo%2Btest%40domain.com')).toBe(true);
      expect(uri).toContain('%26');
      expect(uri).toContain('%3D');
      expect(uri).toContain('%3F');
    });
  });

  describe('Article 15 — Right of access and data portability', () => {
    it('STRICT ADVERSARIAL CHECK: ensures zero hyphens in French Article 15 email body', () => {
      const email = generateGdprArticle15Email({
        recipientEmail: 'dpo@cloud.com',
        serviceName: 'CloudPlatform',
        userName: 'Jean Dupont',
        userEmail: 'user@cloud.com',
        accountUsername: 'usercloud',
        language: 'fr'
      });

      expect(email.body.includes('-')).toBe(false);
      expect(email.subject.includes('-')).toBe(false);
      expect(email.body).toContain('Articles 15 et 20 du RGPD');
      expect(email.body).toContain('loi Informatique et Libertés');
      expect(email.body).toContain('format structuré');
      expect(email.body).toContain("délai maximal d'un mois");
    });

    it('generates English Article 15 request properly', () => {
      const email = generateGdprArticle15Email({
        recipientEmail: 'dpo@cloud.com',
        serviceName: 'CloudPlatform',
        userName: 'Jean Dupont',
        userEmail: 'user@cloud.com',
        language: 'en'
      });

      expect(email.language).toBe('en');
      expect(email.subject).toContain('Articles 15 and 20 GDPR');
      expect(email.body).toContain('commonly used and machine-readable format');
    });
  });
});
