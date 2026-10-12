/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as {
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
  readFileSync(p: string, e: string): string;
};
const path = require('path') as { join(...p: string[]): string };

const walk = (dir: string): string[] =>
  fs.readdirSync(dir).flatMap((f) => (fs.statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : /\.tsx?$/.test(f) ? [path.join(dir, f)] : []));

const withoutComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** The two helpers that own the raw props are the only code allowed to set them. */
const withoutHelpers = (s: string) => s.replace(/export function (Heading|a11yState)\([\s\S]*?\n}\n/g, '');

/** Source files under `src/` and `app/` whose code (comments and the `Heading` and `a11yState` functions removed) matches `pattern`. Jest runs with the app folder as cwd. */
export function sourcesMatching(pattern: RegExp): string[] {
  return [...walk(path.join(process.cwd(), 'src')), ...walk(path.join(process.cwd(), 'app'))].filter((f) => pattern.test(withoutHelpers(withoutComments(fs.readFileSync(f, 'utf8')))));
}
