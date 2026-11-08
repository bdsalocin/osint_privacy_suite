/**
 * macOS arm64 Application Bundle (.app) and Disk Image (.dmg) Builder
 * Assembles OSINT Privacy Suite.app with zero external network dependencies,
 * signs ad-hoc for Apple Silicon, verifies headless launch, and builds UDZO DMG.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const APP_NAME = 'OSINT Privacy Suite';
const APP_VERSION = '1.0.0';
const BUNDLE_ID = 'org.osint.privacysuite';

const RELEASE_DIR = path.join(ROOT_DIR, 'release');
const STAGING_DIR = path.join(RELEASE_DIR, 'dmg_staging');
const APP_BUNDLE_PATH = path.join(STAGING_DIR, `${APP_NAME}.app`);
const DMG_FILENAME = `OSINT-Privacy-Suite-${APP_VERSION}-arm64.dmg`;
const DMG_OUTPUT_PATH = path.join(RELEASE_DIR, DMG_FILENAME);

function log(step, msg) {
  console.log(`[BUILD-DMG] [${step}] ${msg}`);
}

function main() {
  log('INIT', `Préparation du packaging macOS arm64 pour ${APP_NAME} v${APP_VERSION}`);

  const electronAppSource = path.join(ROOT_DIR, 'node_modules', 'electron', 'dist', 'Electron.app');
  if (!fs.existsSync(electronAppSource)) {
    throw new Error(`Electron.app introuvable à l'emplacement : ${electronAppSource}`);
  }

  // 1. Clean and prepare release directories
  if (fs.existsSync(STAGING_DIR)) {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  // 2. Copy Electron.app preserving macOS framework symlinks via ditto
  log('BUNDLE', `Copie du bundle natif arm64 vers ${APP_BUNDLE_PATH}`);
  execFileSync('/usr/bin/ditto', [electronAppSource, APP_BUNDLE_PATH]);

  // 3. Remove default_app.asar and inject application payload into Contents/Resources/app
  const resourcesDir = path.join(APP_BUNDLE_PATH, 'Contents', 'Resources');
  const defaultAsar = path.join(resourcesDir, 'default_app.asar');
  if (fs.existsSync(defaultAsar)) {
    fs.rmSync(defaultAsar, { force: true });
  }

  const appPayloadDir = path.join(resourcesDir, 'app');
  fs.mkdirSync(appPayloadDir, { recursive: true });

  // Copy package.json (cleaned for production), dist/, and data/
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf-8'));
  const prodPkgJson = {
    name: pkgJson.name,
    productName: APP_NAME,
    version: pkgJson.version,
    description: pkgJson.description,
    type: pkgJson.type,
    main: pkgJson.main,
    author: pkgJson.author,
    license: pkgJson.license,
  };
  fs.writeFileSync(path.join(appPayloadDir, 'package.json'), JSON.stringify(prodPkgJson, null, 2));

  execFileSync('/usr/bin/ditto', [path.join(ROOT_DIR, 'dist'), path.join(appPayloadDir, 'dist')]);
  execFileSync('/usr/bin/ditto', [path.join(ROOT_DIR, 'data'), path.join(appPayloadDir, 'data')]);

  // 4. Customize Info.plist metadata
  const plistPath = path.join(APP_BUNDLE_PATH, 'Contents', 'Info.plist');
  log('PLIST', 'Mise à jour des métadonnées Info.plist macOS');
  const plistUpdates = [
    ['Set :CFBundleDisplayName', APP_NAME],
    ['Set :CFBundleName', APP_NAME],
    ['Set :CFBundleIdentifier', BUNDLE_ID],
    ['Set :CFBundleShortVersionString', APP_VERSION],
    ['Set :CFBundleVersion', APP_VERSION],
  ];

  for (const [cmd, val] of plistUpdates) {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `${cmd} "${val}"`, plistPath]);
    } catch {
      // Ignore if key doesn't exist
    }
  }

  // 5. Clear extended attributes and perform ad-hoc code signing for Apple Silicon
  log('CODESIGN', 'Signature ad-hoc Apple Silicon arm64 du paquet applicatif');
  try {
    execFileSync('/usr/bin/xattr', ['-cr', APP_BUNDLE_PATH]);
  } catch {}
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', APP_BUNDLE_PATH]);

  // 6. Verify packaged .app binary runs headless check
  const macosExecPath = path.join(APP_BUNDLE_PATH, 'Contents', 'MacOS', 'Electron');
  log('VERIFY', 'Exécution du test headless sur le binaire packagé .app');
  const verifyOutput = execFileSync(macosExecPath, ['--test-headless'], {
    encoding: 'utf-8',
    timeout: 20000,
  });
  if (!verifyOutput.includes('[HEADLESS_TEST_SUCCESS]')) {
    throw new Error(`Le binaire packagé n'a pas validé le test headless :\n${verifyOutput}`);
  }
  log('VERIFY', 'Validation headless du paquet .app réussie');

  // 7. Create symlink to /Applications for drag-and-drop installation
  const applicationsSymlink = path.join(STAGING_DIR, 'Applications');
  fs.symlinkSync('/Applications', applicationsSymlink);

  // 8. Generate compressed UDZO DMG via hdiutil
  if (fs.existsSync(DMG_OUTPUT_PATH)) {
    fs.rmSync(DMG_OUTPUT_PATH, { force: true });
  }
  log('DMG', `Création de l'image disque ${DMG_OUTPUT_PATH}`);
  execFileSync('/usr/bin/hdiutil', [
    'create',
    '-volname',
    APP_NAME,
    '-srcfolder',
    STAGING_DIR,
    '-ov',
    '-format',
    'UDZO',
    DMG_OUTPUT_PATH,
  ]);

  const stats = fs.statSync(DMG_OUTPUT_PATH);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
  log('SUCCESS', `Image disque DMG générée avec succès : ${DMG_OUTPUT_PATH} (${sizeMb} Mo)`);
}

main();
