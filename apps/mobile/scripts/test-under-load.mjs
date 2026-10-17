// Runs the mobile jest suite while the machine is busy, to catch tests that depend on wall-clock time (#660).
//
//   node scripts/test-under-load.mjs [--burners N] [--stall-ms MS] [--dry-run] [jest args...]
//
//   --burners N    CPU burner processes running for the whole run (default: one per CPU, so the jest workers share
//                  the machine with as many busy loops as there are cores)
//   --stall-ms MS  also block the event loop for MS milliseconds on every turn inside each test file
//                  (scripts/load-stall-setup.cjs): a slow machine on demand, even on an idle runner. It slows a
//                  file many times over, so use it on single files, not the whole suite (default: off)
//   --dry-run      print the plan as JSON and exit without running anything
//
// Everything else goes to jest; with none, `--maxWorkers=2` is used. The exit code is jest's. It is meant to be run by
// hand or nightly, not on every pull request: a loaded run is slow and only useful when something is suspect.
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export function plan(argv, cpus = availableParallelism()) {
  let burners = cpus;
  let stallMs = 0;
  let dryRun = false;
  const jest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const num = (name) => {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 0) throw new Error(`${name} needs a whole number of 0 or more`);
      return v;
    };
    if (a === '--burners') burners = num(a);
    else if (a === '--stall-ms') stallMs = num(a);
    else if (a === '--dry-run') dryRun = true;
    else jest.push(a);
  }
  if (jest.length === 0) jest.push('--maxWorkers=2');
  // The setup file is a variadic jest option, so it goes last to leave the user's test patterns alone.
  if (stallMs > 0) jest.push('--setupFilesAfterEnv', join(here, 'load-stall-setup.cjs'));
  return { burners, stallMs, jest, dryRun };
}

function main() {
  let p;
  try {
    p = plan(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (p.dryRun) {
    console.log(JSON.stringify({ burners: p.burners, stallMs: p.stallMs, jest: p.jest }));
    return;
  }
  const burners = Array.from({ length: p.burners }, () => spawn(process.execPath, ['-e', 'for (;;) {}'], { stdio: 'ignore' }));
  const stop = () => burners.forEach((b) => b.kill('SIGKILL'));
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
  console.log(`test-under-load: ${p.burners} CPU burners, stall ${p.stallMs} ms per event-loop turn, jest ${p.jest.join(' ')}`);
  const jest = spawn(process.execPath, [join(root, 'node_modules/jest/bin/jest.js'), ...p.jest], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, STALL_MS: String(p.stallMs) },
  });
  jest.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
