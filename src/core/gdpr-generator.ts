/**
 * GDPR Rights Exercise Generator (Article 17 Erasure & Article 15 Access)
 *
 * RÈGLE UTILISATEUR ABSOLUE :
 * Ne jamais insérer de tiret dans les phrases et réponses en français
 * (utiliser des tournures fluides, des virgules, des parenthèses ou des retours à la ligne).
 * Le modèle de courriel d'effacement RGPD Article 17 en français respecte scrupuleusement
 * cette directive sans aucun caractère tiret.
 */

import { cleanDomain } from './jdm-matcher.js';

export interface GdprRequestParams {
  recipientEmail?: string;
  serviceName?: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  accountUsername?: string;
  language?: 'fr' | 'en';
}

export interface GdprEmailResult {
  subject: string;
  body: string;
  mailtoUri: string;
  recipientEmail: string;
  language: 'fr' | 'en';
}

/**
 * Generate RFC 3986 compliant mailto URI
 */
export function generateGdprMailtoUri(params: {
  recipientEmail: string;
  subject: string;
  body: string;
}): string {
  return `mailto:${encodeURIComponent(params.recipientEmail)}?subject=${encodeURIComponent(params.subject)}&body=${encodeURIComponent(params.body)}`;
}

/**
 * Generate GDPR Article 17 (Right to Erasure / Right to be Forgotten) email
 * Strict French compliance: ZERO HYPHENS / DASHES ('-') in French text!
 */
export function generateGdprArticle17Email(params: GdprRequestParams = {}): GdprEmailResult {
  const language = params.language === 'en' ? 'en' : 'fr';
  const serviceName = params.serviceName || 'le service';
  const userName = params.userName || 'Citoyen européen';
  const userEmail = params.userEmail || '';
  const accountUsername = params.accountUsername || '';
  const userPhone = params.userPhone || '';
  const recipientEmail = params.recipientEmail || `dpo@${cleanDomain(params.serviceName || 'service.com')}`;

  if (language === 'fr') {
    // Subject without hyphens (using parentheses)
    const subject = `Exercice du droit à l'effacement de mes données personnelles (Article 17 du RGPD) (${serviceName})`;

    const phoneLine = userPhone ? `Numéro de téléphone lié (le cas échéant) : ${userPhone}` : '';

    // Body with zero hyphens (e.g. "sous traitants" without hyphen)
    const body = `Objet : Exercice du droit à l'effacement de mes données personnelles (Article 17 du RGPD)

Madame, Monsieur,

Je m'adresse à vous en votre qualité de responsable du traitement des données personnelles pour le service ${serviceName}.

En application de l'article 17.1 du Règlement général sur la protection des données (Règlement UE 2016/679) et de la loi Informatique et Libertés, je vous demande d'effacer de manière intégrale et définitive l'ensemble des données personnelles me concernant ainsi que le compte associé à mes identifiants.

Mes informations d'identification sont les suivantes :
Nom et prénom : ${userName}
Adresse électronique associée : ${userEmail}
Identifiant ou pseudonyme : ${accountUsername}
${phoneLine ? phoneLine + '\n' : ''}
Je formule cette demande en application de l'article 17.1 du RGPD, ne souhaitant plus utiliser vos services et retirant tout consentement préalablement accordé pour le traitement de mes données.

En vertu de l'article 19 du RGPD, je vous saurais gré de bien vouloir notifier cette demande d'effacement à tous les destinataires et sous traitants auxquels vous auriez communiqué mes informations.

Je vous rappelle que l'article 12.3 du RGPD vous impartit un délai maximal d'un mois à compter de la réception de ce message pour satisfaire à ma requête et me confirmer par écrit la destruction effective de l'ensemble de mes données. À défaut de confirmation écrite dans ce délai légal, je me réserve la possibilité de déposer une réclamation formelle auprès de la Commission Nationale de l'Informatique et des Libertés (CNIL).

Dans l'attente de votre confirmation écrite, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

${userName}`.trim();

    const mailtoUri = generateGdprMailtoUri({
      recipientEmail,
      subject,
      body
    });

    return { subject, body, mailtoUri, recipientEmail, language: 'fr' };
  } else {
    const subject = `Request for erasure of personal data under Article 17 GDPR - ${serviceName}`;

    const body = `Subject: Request for erasure of personal data under Article 17 GDPR

Dear Data Protection Officer,

I am writing to you in your capacity as the data controller for ${serviceName}.

Pursuant to Article 17 of the General Data Protection Regulation (Regulation EU 2016/679), I hereby request the immediate and permanent deletion of my account and all personal data related to me from your systems, backups, and databases.

My identification details are as follows:
Full Name: ${userName}
Associated Email: ${userEmail}
Username or Account Handle: ${accountUsername}
${userPhone ? `Associated Phone: ${userPhone}\n` : ''}
This request is made pursuant to Article 17(1) of the GDPR, as I have decided to terminate the use of your services and revoke any consent previously granted for data processing.

In accordance with Article 19 of the GDPR, please also ensure that this erasure request is communicated to all third party processors or recipients to whom my personal data may have been disclosed.

I would like to remind you that under Article 12(3) of the GDPR, you are required to respond and confirm the completion of this erasure request without undue delay and at the latest within one month of receipt.

I look forward to receiving your prompt written confirmation.

Sincerely,

${userName}`.trim();

    const mailtoUri = generateGdprMailtoUri({
      recipientEmail,
      subject,
      body
    });

    return { subject, body, mailtoUri, recipientEmail, language: 'en' };
  }
}

/**
 * Generate GDPR Article 15 (Right of Access & Portability) email
 * Strict French compliance: ZERO HYPHENS / DASHES ('-') in French text!
 */
export function generateGdprArticle15Email(params: GdprRequestParams = {}): GdprEmailResult {
  const language = params.language === 'en' ? 'en' : 'fr';
  const serviceName = params.serviceName || 'le service';
  const userName = params.userName || 'Citoyen européen';
  const userEmail = params.userEmail || '';
  const accountUsername = params.accountUsername || '';
  const userPhone = params.userPhone || '';
  const recipientEmail = params.recipientEmail || `dpo@${cleanDomain(params.serviceName || 'service.com')}`;

  if (language === 'fr') {
    const subject = `Exercice du droit d'accès et de portabilité de mes données (Articles 15 et 20 du RGPD) (${serviceName})`;
    const phoneLine = userPhone ? `Numéro de téléphone lié (le cas échéant) : ${userPhone}` : '';

    const body = `Objet : Exercice du droit d'accès et de portabilité de mes données (Articles 15 et 20 du RGPD)

Madame, Monsieur,

Je m'adresse à vous en votre qualité de responsable du traitement des données personnelles pour le service ${serviceName}.

En application des articles 15 et 20 du Règlement général sur la protection des données (Règlement UE 2016/679) et de la loi Informatique et Libertés, je vous demande de bien vouloir me communiquer l'intégralité des données personnelles me concernant dont vous disposez, dans un format structuré, couramment utilisé et lisible par machine.

Mes informations d'identification sont les suivantes :
Nom et prénom : ${userName}
Adresse électronique associée : ${userEmail}
Identifiant ou pseudonyme : ${accountUsername}
${phoneLine ? phoneLine + '\n' : ''}
En vertu de l'article 15.3 du RGPD, je vous saurais gré de me fournir une copie complète de ces informations sans frais.

Je vous rappelle que l'article 12.3 du RGPD vous impartit un délai maximal d'un mois à compter de la réception de ce message pour répondre à ma demande. À défaut de réponse satisfaisante dans ce délai légal, je me réserve la possibilité de saisir la Commission Nationale de l'Informatique et des Libertés (CNIL).

Dans l'attente de votre réponse, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

${userName}`.trim();

    const mailtoUri = generateGdprMailtoUri({
      recipientEmail,
      subject,
      body
    });

    return { subject, body, mailtoUri, recipientEmail, language: 'fr' };
  } else {
    const subject = `Request for data access and portability under Articles 15 and 20 GDPR - ${serviceName}`;

    const body = `Subject: Request for data access and portability under Articles 15 and 20 GDPR

Dear Data Protection Officer,

I am writing to you in your capacity as the data controller for ${serviceName}.

Pursuant to Articles 15 and 20 of the General Data Protection Regulation (Regulation EU 2016/679), I hereby request access to and a copy of all personal data relating to me that is processed by your organization, provided in a structured, commonly used and machine-readable format.

My identification details are as follows:
Full Name: ${userName}
Associated Email: ${userEmail}
Username or Account Handle: ${accountUsername}
${userPhone ? `Associated Phone: ${userPhone}\n` : ''}
Under Article 12(3) of the GDPR, you are required to respond to this request without undue delay and at the latest within one month of receipt.

I look forward to receiving your prompt written response.

Sincerely,

${userName}`.trim();

    const mailtoUri = generateGdprMailtoUri({
      recipientEmail,
      subject,
      body
    });

    return { subject, body, mailtoUri, recipientEmail, language: 'en' };
  }
}
