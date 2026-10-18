// Local Expo config plugin: our own Android backup rules, independent of other plugins (expo-secure-store adds its own).
// allowBackup=false already stops Google auto-backup and adb backup; these rules also cover Android 12+ device-to-device
// transfer, which uses dataExtractionRules, and older fullBackupContent. They exclude everything: the health database,
// files, shared preferences and external storage. Security review M6.
// iOS: the SQLite folder and the photo vault folder are marked NSURLIsExcludedFromBackupKey at every launch (see
// EXCLUDE_FROM_BACKUP_SWIFT), so neither iCloud nor an iTunes or Finder backup carries them. #948.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withAppDelegate, withDangerousMod } = require('expo/config-plugins');

const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external'];
const excludes = (indent) => DOMAINS.map((d) => `${indent}<exclude domain="${d}" path="." />`).join('\n');

const FULL_BACKUP_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${excludes('  ')}
</full-backup-content>
`;

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excludes('    ')}
  </cloud-backup>
  <device-transfer>
${excludes('    ')}
  </device-transfer>
</data-extraction-rules>
`;

/** Folders under Documents that hold the health data: expo-sqlite's default directory and the encrypted photo vault. */
const IOS_EXCLUDED_FOLDERS = ['SQLite', 'photos'];

const EXCLUDE_CALL = 'excludeAppDataFromBackup()';
const EXCLUDE_FROM_BACKUP_SWIFT = `
// Added by plugins/with-no-backup.js: keep the health database and the photo vault out of iCloud and device backups.
// The flag sticks to a folder, so files created later inside it are excluded too. Documents itself is flagged as well,
// because the vault deletes and recreates its folder on a wipe and the new folder would start without the flag.
func excludeAppDataFromBackup() {
  guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
  var folders = [documents]
  for name in [${IOS_EXCLUDED_FOLDERS.map((n) => `"${n}"`).join(', ')}] {
    let folder = documents.appendingPathComponent(name, isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    folders.append(folder)
  }
  for var url in folders {
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
  }
}
`;
const LAUNCH_ANCHOR = 'return super.application(application, didFinishLaunchingWithOptions: launchOptions)';

/** Adds the call before the launch return, and the function at the end. Idempotent; fails loudly if the template changed. */
function addExcludeFromBackup(source) {
  if (source.includes(EXCLUDE_CALL)) return source;
  if (!source.includes(LAUNCH_ANCHOR)) throw new Error('with-no-backup: AppDelegate.swift has no launch return to hook; update the plugin.');
  return source.replace(LAUNCH_ANCHOR, `${EXCLUDE_CALL}\n    ${LAUNCH_ANCHOR}`) + EXCLUDE_FROM_BACKUP_SWIFT;
}

function withNoBackup(config) {
  config = withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') throw new Error('with-no-backup: expected a Swift AppDelegate.');
    c.modResults.contents = addExcludeFromBackup(c.modResults.contents);
    return c;
  });
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:allowBackup'] = 'false';
      app.$['android:fullBackupContent'] = '@xml/plate_and_bar_backup_rules';
      app.$['android:dataExtractionRules'] = '@xml/plate_and_bar_data_extraction_rules';
    }
    return c;
  });
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'plate_and_bar_backup_rules.xml'), FULL_BACKUP_CONTENT);
      fs.writeFileSync(path.join(dir, 'plate_and_bar_data_extraction_rules.xml'), DATA_EXTRACTION_RULES);
      return c;
    },
  ]);
}

module.exports = withNoBackup;
module.exports.DOMAINS = DOMAINS;
module.exports.FULL_BACKUP_CONTENT = FULL_BACKUP_CONTENT;
module.exports.DATA_EXTRACTION_RULES = DATA_EXTRACTION_RULES;
module.exports.IOS_EXCLUDED_FOLDERS = IOS_EXCLUDED_FOLDERS;
module.exports.addExcludeFromBackup = addExcludeFromBackup;
