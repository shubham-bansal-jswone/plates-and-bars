/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as {
  readdirSync(p: string): string[];
  statSync(p: string): { isDirectory(): boolean };
  readFileSync(p: string, e: string): string;
};
const path = require('path') as { join(...p: string[]): string };

const walk = (dir: string): string[] =>
  fs.readdirSync(dir).flatMap((f) => (fs.statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : /\.tsx?$/.test(f) ? [path.join(dir, f)] : []));

/** Source files under `src/` and `app/` (not `components/ui.tsx`) whose text matches `pattern`. Jest runs with the app folder as cwd. */
export function sourcesMatching(pattern: RegExp): string[] {
  return [...walk(path.join(process.cwd(), 'src')), ...walk(path.join(process.cwd(), 'app'))].filter((f) => !f.endsWith('components/ui.tsx') && pattern.test(fs.readFileSync(f, 'utf8')));
}
