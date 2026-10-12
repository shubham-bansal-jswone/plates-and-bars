import appJson from '../app.json';

// The local SQLite file holds health data unencrypted; Android auto-backup and adb backup would copy it off the device
// (Expo's default is allowBackup=true). Security review M6.
describe('app.json', () => {
  it('turns Android backup off', () => {
    expect((appJson.expo.android as { allowBackup?: boolean }).allowBackup).toBe(false);
  });
});
