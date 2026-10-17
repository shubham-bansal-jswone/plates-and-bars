/* global beforeAll, afterAll */
// Jest setup file used by `scripts/test-under-load.mjs --stall-ms`: while a test file runs, every event-loop turn
// blocks for STALL_MS milliseconds (a CPU-bound wait, as on a machine under heavy load), so timers fire late and
// work queued behind them is slow. Tests that count turns or poll state are unaffected apart from running longer.
const ms = Number(process.env.STALL_MS || 0);
const cell = new Int32Array(new SharedArrayBuffer(4));
let on = false;
function tick() {
  if (!on) return;
  Atomics.wait(cell, 0, 0, ms);
  setImmediate(tick);
}
if (ms > 0) {
  beforeAll(() => {
    on = true;
    setImmediate(tick);
  });
  afterAll(() => {
    on = false;
  });
}
