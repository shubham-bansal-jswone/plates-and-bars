import * as fs from 'fs';
import * as path from 'path';

// The Expo module Gradle plugin turns lint abortOnError off, so every local native module must set it back on (#1023).
const modulesDir = path.join(__dirname, '..', 'modules');
const gradleFiles = fs
  .readdirSync(modulesDir)
  .map((name) => path.join(modulesDir, name, 'android', 'build.gradle'))
  .filter((file) => fs.existsSync(file));

describe('local native modules lint gate', () => {
  it('finds the local modules', () => {
    expect(gradleFiles.length).toBeGreaterThan(0);
  });

  it.each(gradleFiles.map((file) => [path.basename(path.dirname(path.dirname(file))), file]))(
    '%s sets lint { abortOnError true }',
    (_name, file) => {
      const text = fs.readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
      expect(text).toMatch(/lint\s*\{[^}]*\babortOnError\s+true\b/);
    },
  );
});
