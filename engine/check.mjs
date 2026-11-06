// Checks a finished chapter without a person watching it.
//   node video-tour/tour.mjs check 3
// Prints what must be fixed, and writes a contact sheet (a grid of frames) and one still, so
// the frames can be looked at. Exits with an error when something must be fixed.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadChapter, loadConfig } from "./project.mjs";

const key = process.argv[3] || "";
const config = await loadConfig();
const job = await loadChapter(config, key);
if (!job) {
  console.error("Usage: node video-tour/tour.mjs check <chapter number>");
  process.exit(1);
}
const info = JSON.parse(fs.readFileSync(path.join(job.workDir, "info.json"), "utf8"));
const timeline = JSON.parse(fs.readFileSync(path.join(job.workDir, "timeline.json"), "utf8"));

const fix = [];
const note = [];
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const probe = JSON.parse(
  execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height:format=duration",
    "-of",
    "json",
    job.outFile,
  ]).toString(),
);
const v = probe.streams.find((s) => s.codec_type === "video");
const a = probe.streams.find((s) => s.codec_type === "audio");
if (v?.width !== 1920 || v?.height !== 1080) fix.push(`Video is ${v?.width}x${v?.height}`);
if (!a) fix.push("No sound track");

for (const c of info.cues.filter((x) => x.type === "caption")) {
  if (c.b - c.a < 2.5)
    fix.push(`Callout on screen only ${(c.b - c.a).toFixed(1)} s at ${clock(c.a)}: "${c.text}"`);
  if (c.text.split(/\s+/).length > 13) note.push(`Long callout at ${clock(c.a)}: "${c.text}"`);
}
for (const l of info.leaks)
  fix.push(`Loading state on screen at ${clock(l.at)} for ${l.seconds.toFixed(1)} s`);
for (const p of timeline.problems) fix.push(`Browser ${p}`);
for (const w of timeline.warnings) note.push(w);

// Sound level: effects should be heard, never clip
const vol = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-i", job.outFile, "-af", "volumedetect", "-vn", "-f", "null", "-"],
  { encoding: "utf8" },
).stderr;
const peak = /max_volume: (-?[\d.]+) dB/.exec(vol)?.[1];
if (peak != null && +peak > -1) fix.push(`Sound peak ${peak} dB is too loud`);
if (peak != null && +peak < -30) note.push(`Sound peak ${peak} dB is very quiet`);

// Contact sheet: about 24 frames, enough to see every page the chapter passes through
const sheet = path.join(job.workDir, "contact-sheet.png");
const step = Math.max(1, info.duration / 24);
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-i",
  job.outFile,
  "-vf",
  `fps=1/${step.toFixed(2)},scale=480:-1,tile=6x4:padding=4`,
  "-frames:v",
  "1",
  sheet,
]);

// One still: the middle of the first zoom that has a callout, else the first callout
const callouts = info.cues.filter((c) => c.type === "caption");
const zoomed = info.zooms
  .map((z) => ({ ...z, a: z.a + 0.8 }))
  .find((z) => callouts.some((c) => c.a < z.b && c.b > z.a));
const at = zoomed
  ? (zoomed.a + zoomed.b) / 2
  : callouts[0]
    ? (callouts[0].a + callouts[0].b) / 2
    : info.titleEnd + 2;
fs.mkdirSync(path.dirname(job.still), { recursive: true });
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-ss",
  at.toFixed(2),
  "-i",
  job.outFile,
  "-frames:v",
  "1",
  job.still,
]);

console.log(`Chapter ${job.n}: ${clock(info.duration)}, ${callouts.length} callouts, peak ${peak} dB`);
console.log(`Contact sheet: ${sheet}`);
console.log(`Still: ${job.still}`);
for (const n of note) console.log(`Note: ${n}`);
if (fix.length) {
  console.log("\nFix before using:");
  for (const x of fix) console.log(`  - ${x}`);
  process.exit(2);
}
console.log("No automatic problems. Now look at the contact sheet and the still.");
