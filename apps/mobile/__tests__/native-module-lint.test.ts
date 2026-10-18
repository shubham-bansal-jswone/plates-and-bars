import * as fs from 'fs';
import * as path from 'path';

// The Expo module Gradle plugin turns lint abortOnError off, so every local native module must set it back on (#1023).
function setsAbortOnError(gradle: string): boolean {
  const text = gradle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return /lint\s*\{[^}]*\babortOnError\s+true\b/.test(text);
}

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
      expect(setsAbortOnError(fs.readFileSync(file, 'utf8'))).toBe(true);
    },
  );
});

describe('setsAbortOnError', () => {
  it('accepts a real lint block', () => {
    expect(setsAbortOnError("android {\n  lint {\n    abortOnError true\n  }\n}")).toBe(true);
  });
  it.each([
    ['a // commented block', "android {\n  // lint {\n  //   abortOnError true\n  // }\n}"],
    ['a multi-line block comment', "android {\n  /*\n  lint {\n    abortOnError true\n  }\n  */\n}"],
    ['an inline block comment', "android {\n  /* lint { abortOnError true } */\n}"],
  ])('counts %s as missing', (_name, gradle) => {
    expect(setsAbortOnError(gradle)).toBe(false);
  });
});
