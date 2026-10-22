// Self-check for outputFrames (trim, cuts, fps, delays). Run: npm test
const assert = require("assert");
const Module = require("module");
const { buildSync } = require("esbuild");

const outputText = buildSync({ entryPoints: ["src/pipeline.ts"], bundle: true, format: "cjs", platform: "node", write: false }).outputFiles[0].text;
const mod = new Module("pipeline");
mod._compile(outputText, "pipeline.js");
const { outputFrames } = mod.exports;

const frameLength = 83;
const frames = Array.from({ length: 13 }, (_, i) => ({ timestamp: Math.round((i * 1000) / 12) })); // ~1.08 s
const options = (extra) => ({ trim: { start: 0, end: 12 }, cuts: [], fps: 12, ...extra });
const duration = (out) => out.reduce((sum, f) => sum + f.delay, 0);

// no cuts: every frame, delays are the gaps, last lasts frameLength (same as before cuts existed)
let out = outputFrames(frames, options(), frameLength);
assert.deepStrictEqual(out.map((f) => f.index), [...Array(13).keys()]);
out.forEach((f, i) => assert.strictEqual(f.delay, (i < 12 ? frames[i + 1].timestamp : frames[12].timestamp + frameLength) - frames[i].timestamp));

// a cut removes its frames and its time, and later frames close the gap
out = outputFrames(frames, options({ cuts: [{ start: 167, end: 417 }] }), frameLength);
assert.deepStrictEqual(out.map((f) => f.index), [0, 1, 5, 6, 7, 8, 9, 10, 11, 12]);
assert.strictEqual(duration(out), frames[12].timestamp + frameLength - 250);
assert.ok(out.every((f) => f.delay > 0));

// lower fps keeps the total duration, with or without cuts
out = outputFrames(frames, options({ fps: 5, cuts: [{ start: 167, end: 417 }] }), frameLength);
assert.strictEqual(duration(out), frames[12].timestamp + frameLength - 250);
assert.ok(out.length < 10);

// trim plus a cut past the trim end only removes what's inside the trim
out = outputFrames(frames, options({ trim: { start: 2, end: 8 }, cuts: [{ start: 600, end: 5000 }] }), frameLength);
assert.deepStrictEqual(out.map((f) => f.index), [2, 3, 4, 5, 6, 7]); // frame 7 is at 583 ms
assert.strictEqual(duration(out), 600 - frames[2].timestamp);

// everything cut: nothing to render
assert.strictEqual(outputFrames(frames, options({ cuts: [{ start: 0, end: 5000 }] }), frameLength).length, 0);

console.log("pipeline ok");
