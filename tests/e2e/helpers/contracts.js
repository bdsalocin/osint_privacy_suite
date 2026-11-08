/**
 * Contrats d'Interface et Implémentations de Référence faisant Autorité
 * Pour les tests de bout en bout (E2E) en boîte opaque.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

// Dictionnaire officiel d'alias canoniques pour la réconciliation JDM
export const CANONICAL_ALIASES = {
  'office365.com': 'microsoft.com',
  'office.com': 'microsoft.com',
  'live.com': 'microsoft.com',
  'outlook.com': 'microsoft.com',
  'hotmail.com': 'microsoft.com',
  'gmail.com': 'google.com',
  'googlemail.com': 'google.com',
  'fb.com': 'facebook.com',
  'x.com': 'twitter.com',
  'chatgpt.com': 'openai.com',
};

// Annuaires des URL directes d'exportation de données personnelles
export const DIRECT_TAKEOUT_PORTALS = {
  'google': 'https://takeout.google.com/',
  'facebook': 'https://accountscenter.facebook.com/info_and_permissions',
  'instagram': 'https://accountscenter.instagram.com/info_and_permissions/dyi/',
  'twitter': 'https://twitter.com/settings/your_twitter_data',
  'apple': 'https://privacy.apple.com',
  'spotify': 'https://www.spotify.com/account/privacy/',
  'microsoft': 'https://account.microsoft.com/privacy',
  'amazon': 'https://www.amazon.com/hz/privacy-central/data-requests/preview.html',
  'reddit': 'https://www.reddit.com/settings/data-request',
  'linkedin': 'https://www.linkedin.com/mypreferences/d/download-my-data',
  'github': 'https://github.com/settings/admin',
  'snapchat': 'https://support.snapchat.com/en-US/a/download-my-data',
  'netflix': 'https://www.netflix.com/youraccount',
  'uber': 'https://myprivacy.uber.com/privacy/exploreyourdata/download'
};

/**
 * Normalisation de la saisie unifiée
 */
export function normalizeTarget(input = {}) {
  const result = {
    email: undefined,
    username: undefined,
    phone: undefined,
    phoneCountryCode: undefined,
    phoneNumber: undefined,
    isValid: true,
    errors: []
  };

  if (input.email !== undefined && input.email !== null) {
    const rawEmail = String(input.email).trim().toLowerCase();
    if (rawEmail.length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(rawEmail)) {
        result.email = rawEmail;
      } else {
        result.isValid = false;
        result.errors.push(`Format d'email invalide : ${rawEmail}`);
      }
    }
  }

  if (input.username !== undefined && input.username !== null) {
    const rawUsername = String(input.username).trim();
    if (rawUsername.length > 0) {
      result.username = rawUsername;
    }
  }

  if (input.phone !== undefined && input.phone !== null) {
    const rawPhone = String(input.phone).trim();
    if (rawPhone.length > 0) {
      const digitsOnly = rawPhone.replace(/\D/g, '');
      if (digitsOnly.length >= 7) {
        let cc = '33';
        let num = digitsOnly;
        if (digitsOnly.startsWith('33') && digitsOnly.length > 9) {
          cc = '33';
          num = digitsOnly.substring(2);
          if (num.startsWith('0')) {
            num = num.substring(1);
          }
        } else if (digitsOnly.startsWith('1') && digitsOnly.length === 11) {
          cc = '1';
          num = digitsOnly.substring(1);
        } else if (digitsOnly.length === 10 && digitsOnly.startsWith('0')) {
          cc = '33';
          num = digitsOnly.substring(1);
        }
        result.phoneCountryCode = cc;
        result.phoneNumber = num;
        result.phone = `+${cc}${num}`;
      } else {
        result.isValid = false;
        result.errors.push(`Numéro de téléphone trop court : ${rawPhone}`);
      }
    }
  }

  return result;
}

/**
 * Nettoyage d'un domaine web
 */
export function cleanDomain(raw = '') {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';
  try {
    let d = s.toLowerCase();
    if (d.startsWith('http://') || d.startsWith('https://')) {
      d = new URL(d).hostname;
    }
    if (d.startsWith('www.')) d = d.substring(4);
    return d.split('/')[0].trim();
  } catch {
    return s.toLowerCase();
  }
}

/**
 * Construction des index rapides JustDeleteMe
 */
export function buildJdmIndexes(jdmEntries = []) {
  const domainIndex = new Map();
  const nameIndex = new Map();

  const cleanStr = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const entry of jdmEntries) {
    if (Array.isArray(entry.domains)) {
      for (const d of entry.domains) {
        domainIndex.set(cleanDomain(d), entry);
      }
    }
    if (entry.name) {
      nameIndex.set(cleanStr(entry.name), entry);
    }
  }

  return { domainIndex, nameIndex };
}

/**
 * Moteur de réconciliation en cascade JustDeleteMe
 */
export function matchAccountToJDM(serviceQuery = '', urlOrDomain = '', jdmEntries = [], domainIndex = null, nameIndex = null) {
  if (!domainIndex || !nameIndex) {
    const indexes = buildJdmIndexes(jdmEntries);
    domainIndex = indexes.domainIndex;
    nameIndex = indexes.nameIndex;
  }

  const cleanStr = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const domainCandidate = cleanDomain(urlOrDomain || serviceQuery);
  const normalizedQuery = cleanStr(serviceQuery);

  // Early guard: if both normalizedQuery and domainCandidate are empty, return immediately
  if (!normalizedQuery && !domainCandidate) {
    return { entry: null, confidence: 0.0, matchedBy: 'none' };
  }

  // Étape 1 : Alias canoniques
  if (CANONICAL_ALIASES[domainCandidate]) {
    const canonicalDomain = CANONICAL_ALIASES[domainCandidate];
    if (domainIndex.has(canonicalDomain)) {
      return { entry: domainIndex.get(canonicalDomain), confidence: 1.0, matchedBy: 'alias' };
    }
  }

  // Étape 2 : Domaine exact
  if (domainIndex.has(domainCandidate)) {
    return { entry: domainIndex.get(domainCandidate), confidence: 1.0, matchedBy: 'domain_exact' };
  }

  // Étape 3 : Domaine racine (ex: sub.domain.com -> domain.com)
  const parts = domainCandidate.split('.');
  if (parts.length > 2) {
    const rootDomain = parts.slice(-2).join('.');
    if (domainIndex.has(rootDomain)) {
      return { entry: domainIndex.get(rootDomain), confidence: 0.9, matchedBy: 'domain_root' };
    }
  }

  // Étape 4 : Nom normalisé exact
  if (normalizedQuery && nameIndex.has(normalizedQuery)) {
    return { entry: nameIndex.get(normalizedQuery), confidence: 0.85, matchedBy: 'name_exact' };
  }

  // Étape 5 : Fuzzy match (tokens ou préfixe ancré)
  if (normalizedQuery.length >= 4) {
    const tokens = String(serviceQuery || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4);

    for (const t of tokens) {
      if (nameIndex.has(t)) {
        return { entry: nameIndex.get(t), confidence: 0.7, matchedBy: 'fuzzy' };
      }
    }

    for (const entry of jdmEntries) {
      const entryNorm = cleanStr(entry.name);
      if (entryNorm.length < 4) continue;

      if (normalizedQuery.startsWith(entryNorm)) {
        return { entry, confidence: 0.7, matchedBy: 'fuzzy' };
      }
      if (entryNorm.startsWith(normalizedQuery)) {
        return { entry, confidence: 0.7, matchedBy: 'fuzzy' };
      }
    }
  }

  return { entry: null, confidence: 0.0, matchedBy: 'none' };
}

/**
 * Résolution JustGetMyData
 */
export function resolveJGMD(serviceName = '', domain = '', jgmdEntries = []) {
  if (!serviceName && !domain) {
    return { matched: false, exportUrl: null, source: 'none' };
  }

  const cleanStr = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normName = cleanStr(serviceName);
  const cDomain = cleanDomain(domain);

  if (!normName && !cDomain) {
    return { matched: false, exportUrl: null, source: 'none' };
  }

  const nameTokens = String(serviceName || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const domainParts = cDomain.split('.').filter(Boolean);

  // Vérification de l'annuaire direct
  for (const [key, url] of Object.entries(DIRECT_TAKEOUT_PORTALS)) {
    const nameMatches = normName === key || nameTokens.includes(key);
    const domainMatches = cDomain === `${key}.com` || domainParts.includes(key);

    if (nameMatches || domainMatches) {
      return { matched: true, exportUrl: url, source: 'direct_portal' };
    }
  }

  // Vérification de la liste JGMD
  for (const entry of jgmdEntries) {
    const entryNameNorm = cleanStr(entry.name || '');
    const domainMatches = Array.isArray(entry.domains) && entry.domains.some((d) => cleanDomain(d) === cDomain);

    if ((normName && entryNameNorm === normName) || domainMatches) {
      return { matched: true, exportUrl: entry.url, notes: entry.notes_fr || entry.notes, source: 'jgmd_list' };
    }
  }

  return { matched: false, exportUrl: null, source: 'none' };
}

/**
 * Parseurs de sorties brutes pour chaque outil OSINT
 */
export function parseHoleheCsv(csvContent = '', accountIdentifier = '') {
  const accounts = [];
  const lines = csvContent.trim().split('\n');
  if (lines.length <= 1) return accounts;

  const headers = lines[0].split(',').map((h) => h.trim());
  const nameIdx = headers.indexOf('name');
  const domainIdx = headers.indexOf('domain');
  const existsIdx = headers.indexOf('exists');
  const rateLimitIdx = headers.indexOf('rateLimit');

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    if (cols.length < headers.length) continue;

    const name = cols[nameIdx];
    const domain = cols[domainIdx];
    const exists = cols[existsIdx] === 'True';
    const rateLimit = cols[rateLimitIdx] === 'True';

    let status = 'unclaimed';
    if (rateLimit) status = 'rate_limited';
    else if (exists) status = 'claimed';

    accounts.push({
      id: crypto.randomUUID(),
      serviceId: name.toLowerCase(),
      serviceName: name.charAt(0).toUpperCase() + name.slice(1),
      domain: domain,
      accountIdentifier: accountIdentifier,
      sourceTool: 'holehe',
      status: status,
      metadata: { rawExists: exists, rawRateLimit: rateLimit },
      cleaned: false
    });
  }

  return accounts;
}

export function parseMaigretJson(jsonContent, accountIdentifier = '') {
  const rawObj = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
  const accounts = [];

  for (const [siteName, data] of Object.entries(rawObj)) {
    const statusObj = data.status || {};
    const isClaimed = statusObj.status === 'Claimed' || data.http_status === 200;

    let domain = '';
    if (data.url_main) {
      domain = cleanDomain(data.url_main);
    }

    accounts.push({
      id: crypto.randomUUID(),
      serviceId: siteName.toLowerCase(),
      serviceName: siteName,
      domain: domain,
      accountIdentifier: accountIdentifier,
      sourceTool: 'maigret',
      status: isClaimed ? 'claimed' : 'unclaimed',
      profileUrl: data.url_user || statusObj.url,
      avatarUrl: statusObj.ids?.image,
      metadata: {
        rank: data.rank,
        tags: statusObj.tags || [],
        fullname: statusObj.ids?.fullname,
        uid: statusObj.ids?.uid
      },
      cleaned: false
    });
  }

  return accounts;
}

export function parseIgnorantStdout(stdoutContent = '', accountIdentifier = '') {
  const accounts = [];
  const lines = stdoutContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    let status = null;
    let domain = null;

    if (trimmed.startsWith('[+] ')) {
      status = 'claimed';
      domain = trimmed.substring(4).trim();
    } else if (trimmed.startsWith('[-] ')) {
      status = 'unclaimed';
      domain = trimmed.substring(4).trim();
    } else if (trimmed.startsWith('[x] ')) {
      status = 'rate_limited';
      domain = trimmed.substring(4).trim();
    }

    if (domain) {
      const serviceId = domain.split('.')[0].toLowerCase();
      accounts.push({
        id: crypto.randomUUID(),
        serviceId: serviceId,
        serviceName: serviceId.charAt(0).toUpperCase() + serviceId.slice(1),
        domain: domain,
        accountIdentifier: accountIdentifier,
        sourceTool: 'ignorant',
        status: status,
        metadata: {},
        cleaned: false
      });
    }
  }

  return accounts;
}

export function parseH8mailJson(jsonContent, targetEmail = '') {
  const rawObj = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
  const leaks = [];

  if (Array.isArray(rawObj.targets)) {
    for (const t of rawObj.targets) {
      const target = t.target || targetEmail;
      if (Array.isArray(t.data)) {
        for (const item of t.data) {
          leaks.push({
            id: crypto.randomUUID(),
            target: target,
            sourceTool: 'h8mail',
            breachName: item.breach || item.source || 'Fuite de données',
            breachDate: item.date || null,
            dataClasses: [item.type || 'credentials'],
            details: `Source: ${item.source || 'inconnue'}, type: ${item.type || 'inconnu'}`
          });
        }
      }
    }
  }

  return leaks;
}

export function parseGhuntStdout(stdoutContent = '', accountIdentifier = '') {
  const accounts = [];
  if (stdoutContent.includes('Google Account Found') || stdoutContent.includes('[+] Target :')) {
    const nameMatch = stdoutContent.match(/Name:\s*(.+)/);
    const gaiaMatch = stdoutContent.match(/Gaia ID:\s*(\d+)/);
    const photoMatch = stdoutContent.match(/Profile Picture:\s*(https?:\/\/\S+)/);

    accounts.push({
      id: crypto.randomUUID(),
      serviceId: 'google',
      serviceName: 'Google',
      domain: 'google.com',
      accountIdentifier: accountIdentifier,
      sourceTool: 'ghunt',
      status: 'claimed',
      profileUrl: gaiaMatch ? `https://myaccount.google.com/?gaia_id=${gaiaMatch[1]}` : undefined,
      avatarUrl: photoMatch ? photoMatch[1] : undefined,
      metadata: {
        fullname: nameMatch ? nameMatch[1].trim() : undefined,
        gaiaId: gaiaMatch ? gaiaMatch[1] : undefined,
        hasMapsReviews: stdoutContent.includes('Google Maps:'),
        hasYoutube: stdoutContent.includes('YouTube Channel:')
      },
      cleaned: false
    });
  }

  return accounts;
}

export function parseSpiderfootJson(jsonContent, target = '') {
  const rawList = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
  const accounts = [];
  const leaks = [];

  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (item.type === 'ACCOUNT_EXTERNAL_OWNED') {
        const domain = cleanDomain(item.source);
        const serviceName = domain.split('.')[0];
        accounts.push({
          id: crypto.randomUUID(),
          serviceId: serviceName.toLowerCase(),
          serviceName: serviceName.charAt(0).toUpperCase() + serviceName.slice(1),
          domain: domain,
          accountIdentifier: target,
          sourceTool: 'spiderfoot',
          status: 'claimed',
          profileUrl: item.data.match(/https?:\/\/[^\s\)]+/)?.[0],
          metadata: { module: item.module, rawData: item.data },
          cleaned: false
        });
      } else if (item.type === 'EMAILADDR_COMPROMISED') {
        leaks.push({
          id: crypto.randomUUID(),
          target: target,
          sourceTool: 'spiderfoot',
          breachName: item.source || 'Compromission SpiderFoot',
          breachDate: null,
          dataClasses: ['email_exposure'],
          details: item.data
        });
      }
    }
  }

  return { accounts, leaks };
}

/**
 * Moteur de dédoublonnage unifié multi-outils
 */
export function deduplicateAccounts(accounts = []) {
  const map = new Map();

  for (const acc of accounts) {
    const key = cleanDomain(acc.domain || acc.serviceName || acc.serviceId);
    if (!map.has(key)) {
      map.set(key, {
        ...acc,
        domain: cleanDomain(acc.domain || key),
        sourceTools: [acc.sourceTool || 'unknown']
      });
    } else {
      const existing = map.get(key);
      const tool = acc.sourceTool || 'unknown';
      if (!existing.sourceTools.includes(tool)) {
        existing.sourceTools.push(tool);
      }
      // Priorité au statut claimed
      if (acc.status === 'claimed') {
        existing.status = 'claimed';
      }
      // Fusion des métadonnées
      existing.metadata = { ...existing.metadata, ...acc.metadata };
      if (!existing.profileUrl && acc.profileUrl) {
        existing.profileUrl = acc.profileUrl;
      }
      if (!existing.avatarUrl && acc.avatarUrl) {
        existing.avatarUrl = acc.avatarUrl;
      }
      if (!existing.jdm && acc.jdm) {
        existing.jdm = acc.jdm;
      }
      if (!existing.jgmd && acc.jgmd) {
        existing.jgmd = acc.jgmd;
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Générateur de courriel RGPD Article 17 (Droit à l'effacement)
 * Respecte scrupuleusement la règle : AUCUN TIRETS dans la version française !
 */
export function generateGdprArticle17Email(params = {}) {
  const language = params.language === 'en' ? 'en' : 'fr';
  const serviceName = params.serviceName || 'le service';
  const userName = params.userName || 'Citoyen européen';
  const userEmail = params.userEmail || '';
  const accountUsername = params.accountUsername || '';
  const userPhone = params.userPhone || '';
  const recipientEmail = params.recipientEmail || `dpo@${cleanDomain(params.serviceName || 'service.com')}`;

  if (language === 'fr') {
    const subject = `Exercice du droit à l'effacement de mes données personnelles (Article 17 du RGPD) (${serviceName})`;

    const phoneLine = userPhone ? `Numéro de téléphone lié (le cas échéant) : ${userPhone}` : '';

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

    const mailtoUri = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

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

    const mailtoUri = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    return { subject, body, mailtoUri, recipientEmail, language: 'en' };
  }
}

/**
 * Moteur de Persistance SQLite local via le module standard natif node:sqlite
 */
export function createStorageEngine(dbPath = ':memory:') {
  const db = new DatabaseSync(dbPath);

  // Initialisation du schéma DDL
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS scans (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        target_email TEXT,
        target_username TEXT,
        target_phone TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        tools_selected TEXT NOT NULL,
        summary_counts TEXT
    );

    CREATE TABLE IF NOT EXISTS discovered_accounts (
        id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
        service_name TEXT NOT NULL,
        service_category TEXT,
        account_identifier TEXT NOT NULL,
        profile_url TEXT,
        domain TEXT NOT NULL,
        source_tools TEXT NOT NULL,
        jdm_matched INTEGER NOT NULL DEFAULT 0,
        jdm_difficulty TEXT NOT NULL CHECK (jdm_difficulty IN ('easy', 'medium', 'hard', 'impossible', 'limited', 'unknown')),
        jdm_deletion_url TEXT,
        jdm_notes TEXT,
        jdm_notes_fr TEXT,
        jdm_dpo_email TEXT,
        jgmd_matched INTEGER NOT NULL DEFAULT 0,
        jgmd_export_url TEXT,
        jgmd_notes TEXT,
        status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'pending', 'completed', 'deleted', 'ignored')),
        status_notes TEXT,
        first_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS gdpr_requests (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES discovered_accounts(id) ON DELETE SET NULL,
        scan_id TEXT REFERENCES scans(id) ON DELETE CASCADE,
        service_name TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        legal_basis TEXT NOT NULL CHECK (legal_basis IN ('GDPR_ART_17_ERASURE', 'GDPR_ART_15_ACCESS', 'GDPR_ART_20_PORTABILITY')),
        email_subject TEXT NOT NULL,
        email_body TEXT NOT NULL,
        sent_date TEXT NOT NULL,
        deadline_date TEXT NOT NULL,
        response_status TEXT NOT NULL DEFAULT 'pending' CHECK (response_status IN ('pending', 'favorable', 'refusal', 'no_response')),
        response_date TEXT,
        user_notes TEXT,
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_scan ON discovered_accounts(scan_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_status ON discovered_accounts(status);
    CREATE INDEX IF NOT EXISTS idx_accounts_difficulty ON discovered_accounts(jdm_difficulty);
    CREATE INDEX IF NOT EXISTS idx_gdpr_account ON gdpr_requests(account_id);
  `);

  let inTransaction = false;
  let isOpen = true;

  function withTransaction(fn) {
    const alreadyInTransaction = inTransaction || db.isTransaction === true;
    if (alreadyInTransaction) {
      return fn();
    }
    inTransaction = true;
    db.exec('BEGIN TRANSACTION;');
    try {
      const res = fn();
      db.exec('COMMIT;');
      return res;
    } catch (err) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        // Rollback failed or already aborted
      }
      throw err;
    } finally {
      inTransaction = false;
    }
  }

  return {
    db,

    createScan(scan) {
      const id = scan.id || crypto.randomUUID();
      const stmt = db.prepare(`
        INSERT INTO scans (id, title, target_email, target_username, target_phone, created_at, status, tools_selected, summary_counts)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        scan.title || 'Scan sans titre',
        scan.targetEmail || null,
        scan.targetUsername || null,
        scan.targetPhone || null,
        scan.createdAt || new Date().toISOString(),
        scan.status || 'running',
        JSON.stringify(scan.toolsSelected || []),
        JSON.stringify(scan.summaryCounts || {})
      );
      return id;
    },

    getScan(scanId) {
      const stmt = db.prepare('SELECT * FROM scans WHERE id = ?');
      const row = stmt.get(scanId);
      if (!row) return null;
      return {
        ...row,
        tools_selected: JSON.parse(row.tools_selected),
        summary_counts: JSON.parse(row.summary_counts || '{}')
      };
    },

    listScans() {
      const stmt = db.prepare('SELECT * FROM scans ORDER BY created_at DESC');
      const rows = stmt.all();
      return rows.map((r) => ({
        ...r,
        tools_selected: JSON.parse(r.tools_selected),
        summary_counts: JSON.parse(r.summary_counts || '{}')
      }));
    },

    deleteScan(scanId) {
      const stmt = db.prepare('DELETE FROM scans WHERE id = ?');
      const info = stmt.run(scanId);
      return info.changes > 0;
    },

    saveAccounts(accounts) {
      if (!Array.isArray(accounts) || accounts.length === 0) return;

      withTransaction(() => {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO discovered_accounts (
            id, scan_id, service_name, service_category, account_identifier, profile_url, domain,
            source_tools, jdm_matched, jdm_difficulty, jdm_deletion_url, jdm_notes, jdm_notes_fr,
            jdm_dpo_email, jgmd_matched, jgmd_export_url, jgmd_notes, status, status_notes,
            first_seen_at, updated_at, processed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const a of accounts) {
          stmt.run(
            a.id || crypto.randomUUID(),
            a.scanId,
            a.serviceName,
            a.serviceCategory || null,
            a.accountIdentifier,
            a.profileUrl || null,
            a.domain,
            JSON.stringify(Array.isArray(a.sourceTools) ? a.sourceTools : [a.sourceTool || 'unknown']),
            a.jdm?.matched ? 1 : 0,
            a.jdm?.difficulty || 'unknown',
            a.jdm?.deleteUrl || null,
            a.jdm?.notes || null,
            a.jdm?.notes_fr || null,
            a.jdm?.email || null,
            a.jgmd?.matched ? 1 : 0,
            a.jgmd?.exportUrl || null,
            a.jgmd?.notes || null,
            ['detected', 'pending', 'completed', 'deleted', 'ignored'].includes(a.status) ? a.status : 'detected',
            a.statusNotes || null,
            a.firstSeenAt || new Date().toISOString(),
            a.updatedAt || new Date().toISOString(),
            a.processedAt || null
          );
        }
      });
    },

    getAccountsByScan(scanId) {
      const stmt = db.prepare('SELECT * FROM discovered_accounts WHERE scan_id = ? ORDER BY service_name ASC');
      const rows = stmt.all(scanId);
      return rows.map((r) => ({
        ...r,
        source_tools: JSON.parse(r.source_tools)
      }));
    },

    updateAccountStatus(accountId, status, notes = null) {
      const stmt = db.prepare(`
        UPDATE discovered_accounts
        SET status = ?, status_notes = ?, updated_at = ?, processed_at = CASE WHEN ? IN ('completed', 'deleted') THEN ? ELSE processed_at END
        WHERE id = ?
      `);
      const now = new Date().toISOString();
      const info = stmt.run(status, notes, now, status, now, accountId);
      return info.changes > 0;
    },

    saveGdprRequest(request) {
      const id = request.id || crypto.randomUUID();
      const stmt = db.prepare(`
        INSERT INTO gdpr_requests (
          id, account_id, scan_id, service_name, recipient_email, legal_basis,
          email_subject, email_body, sent_date, deadline_date, response_status,
          response_date, user_notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = new Date().toISOString();
      const sentDate = request.sentDate || now;
      const sentTime = new Date(sentDate).getTime();
      const defaultDeadline = new Date(sentTime + 30 * 24 * 3600 * 1000).toISOString();
      const deadlineDate = request.deadlineDate || defaultDeadline;

      stmt.run(
        id,
        request.accountId || null,
        request.scanId || null,
        request.serviceName,
        request.recipientEmail,
        request.legalBasis || 'GDPR_ART_17_ERASURE',
        request.emailSubject,
        request.emailBody,
        sentDate,
        deadlineDate,
        request.responseStatus || 'pending',
        request.responseDate || null,
        request.userNotes || null,
        now
      );
      return id;
    },

    getGdprRequests(scanId = null) {
      if (scanId) {
        const stmt = db.prepare('SELECT * FROM gdpr_requests WHERE scan_id = ? ORDER BY sent_date DESC');
        return stmt.all(scanId);
      }
      const stmt = db.prepare('SELECT * FROM gdpr_requests ORDER BY sent_date DESC');
      return stmt.all();
    },

    exportScanToJson(scanId) {
      const scan = this.getScan(scanId);
      if (!scan) throw new Error(`Scan introuvable : ${scanId}`);
      const accounts = this.getAccountsByScan(scanId);
      const gdprRequests = this.getGdprRequests(scanId);

      const exportPayload = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        scan,
        accounts,
        gdprRequests
      };

      return JSON.stringify(exportPayload, null, 2);
    },

    importScanFromJson(jsonContent) {
      const payload = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
      if (!payload.scan || !payload.scan.id) {
        throw new Error("Format JSON d'export invalide : objet scan manquant");
      }

      return withTransaction(() => {
        this.createScan({
          id: payload.scan.id,
          title: payload.scan.title,
          targetEmail: payload.scan.target_email,
          targetUsername: payload.scan.target_username,
          targetPhone: payload.scan.target_phone,
          createdAt: payload.scan.created_at,
          status: payload.scan.status,
          toolsSelected: payload.scan.tools_selected,
          summaryCounts: payload.scan.summary_counts
        });

        if (Array.isArray(payload.accounts) && payload.accounts.length > 0) {
          const mapped = payload.accounts.map((a) => ({
            id: a.id,
            scanId: payload.scan.id,
            serviceName: a.service_name,
            serviceCategory: a.service_category,
            accountIdentifier: a.account_identifier,
            profileUrl: a.profile_url,
            domain: a.domain,
            sourceTools: a.source_tools,
            jdm: {
              matched: a.jdm_matched === 1,
              difficulty: a.jdm_difficulty,
              deleteUrl: a.jdm_deletion_url,
              notes: a.jdm_notes,
              notes_fr: a.jdm_notes_fr,
              email: a.jdm_dpo_email
            },
            jgmd: {
              matched: a.jgmd_matched === 1,
              exportUrl: a.jgmd_export_url,
              notes: a.jgmd_notes
            },
            status: a.status,
            statusNotes: a.status_notes,
            firstSeenAt: a.first_seen_at,
            updatedAt: a.updated_at,
            processedAt: a.processed_at
          }));
          this.saveAccounts(mapped);
        }

        if (Array.isArray(payload.gdprRequests)) {
          for (const req of payload.gdprRequests) {
            this.saveGdprRequest({
              id: req.id,
              accountId: req.account_id,
              scanId: payload.scan.id,
              serviceName: req.service_name,
              recipientEmail: req.recipient_email,
              legalBasis: req.legal_basis,
              emailSubject: req.email_subject,
              emailBody: req.email_body,
              sentDate: req.sent_date,
              deadlineDate: req.deadline_date,
              responseStatus: req.response_status,
              responseDate: req.response_date,
              userNotes: req.user_notes
            });
          }
        }

        return payload.scan.id;
      });
    },

    close() {
      if (!isOpen || db.isOpen === false) return;
      try {
        db.close();
      } catch {
        // safe fallback
      }
      isOpen = false;
    }
  };
}
