// Local Expo config plugin: our own Android backup rules, independent of other plugins (expo-secure-store adds its own).
// allowBackup=false already stops Google auto-backup and adb backup; these rules also cover Android 12+ device-to-device
// transfer, which uses dataExtractionRules, and older fullBackupContent. They exclude everything: the health database,
// files, shared preferences and external storage. Security review M6.
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

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

function withNoBackup(config) {
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
