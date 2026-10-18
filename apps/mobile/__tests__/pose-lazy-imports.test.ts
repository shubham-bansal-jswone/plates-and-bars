import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// The camera view and the TensorFlow.js model are separate web chunks (loaded by `import()` only when the sheet opens, and the
// camera starts). A static import anywhere in src would pull all of TF.js into the main bundle and the service worker's precache.
const SRC = join(__dirname, '..', 'src');
const files = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : []));

describe('pose chunks are reached only through import()', () => {
  const all = files(SRC).map((f) => ({ f, text: readFileSync(f, 'utf8') }));
  it.each(['pose-session', 'pose-detector'])('%s has no static import', (name) => {
    const staticImport = new RegExp(`(^|\\n)\\s*(import|export)\\b[^;\\n]*from\\s*['"][^'"]*/${name}['"]`);
    const bad = all.filter(({ f, text }) => !f.endsWith(`${name}.tsx`) && !f.endsWith(`${name}.ts`) && staticImport.test(text.replace(/import type[^\n]*\n/g, '')));
    expect(bad.map((b) => b.f)).toEqual([]);
  });
  it('nothing outside the two chunks imports TensorFlow.js', () => {
    const bad = all.filter(({ f, text }) => !/pose-detector\.ts$/.test(f) && /@tensorflow/.test(text));
    expect(bad.map((b) => b.f)).toEqual([]);
  });
  it('the dynamic imports exist where expected', () => {
    expect(readFileSync(join(SRC, 'pose', 'load.ts'), 'utf8')).toMatch(/import\('\.\/pose-session'\)/);
    expect(readFileSync(join(SRC, 'pose', 'pose-session.tsx'), 'utf8')).toMatch(/import\('\.\/pose-detector'\)/);
  });
});
