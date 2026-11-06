// Turns a raw recording into a finished chapter.
//   node video-tour/tour.mjs build 3
// Reads raw.webm and timeline.json from the chapter's working folder, then with ffmpeg:
//   1. finds the magenta sync frame, so timeline times line up with video times;
//   2. cuts out the page-loading waits;
//   3. adds smooth zooms (perspective filter) and the "Step n of N" counter;
//   4. mixes the sound effects into an audio track;
//   5. writes a 1920x1080 H.264 MP4 with AAC sound.
// No .srt goes next to the video (a player would show it as running subtitles); a copy of
// the callout text stays in the working folder as captions.srt, for reference only.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadChapter, loadConfig } from "./project.mjs";
import { mixTrack } from "./sfx.mjs";

const FPS = 30;
const W = 1920;
const H = 1080;
const ZOOM_IN = 0.7; // seconds

const key = process.argv[3] || "";
const config = await loadConfig();
const job = await loadChapter(config, key);
if (!job) {
  console.error("Usage: node video-tour/tour.mjs build <chapter number>");
  process.exit(1);
}
const work = job.workDir;
const raw = path.join(work, "raw.webm");
const timeline = JSON.parse(fs.readFileSync(path.join(work, "timeline.json"), "utf8"));
fs.mkdirSync(path.dirname(job.outFile), { recursive: true });

// ---- 1. find the sync marker ------------------------------------------------------
function findMarker() {
  const rate = 25;
  const res = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-t",
      "60",
      "-i",
      raw,
      "-vf",
      `fps=${rate},scale=4:4:flags=area`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 1 << 28 },
  );
  if (res.status !== 0) throw new Error(res.stderr.toString());
  const buf = res.stdout;
  const per = 4 * 4 * 3;
  let first = -1;
  let last = -1;
  for (let i = 0; i * per < buf.length; i++) {
    let r = 0,
      g = 0,
      b = 0;
    for (let p = 0; p < 16; p++) {
      r += buf[i * per + p * 3];
      g += buf[i * per + p * 3 + 1];
      b += buf[i * per + p * 3 + 2];
    }
    const magenta = r / 16 > 200 && g / 16 < 70 && b / 16 > 200;
    if (magenta && first < 0) first = i;
    if (magenta) last = i;
    if (!magenta && first >= 0) break;
  }
  if (first < 0) throw new Error("Sync marker not found in the raw video");
  return { start: first / rate, end: (last + 1) / rate };
}

const marker = findMarker();
const videoT = (ms) => marker.start + ms / 1000;
const ev = timeline.events;
const stop = ev.find((e) => e.type === "stop");
if (!stop) throw new Error("The chapter's run() must end with d.end()");
const cutStart = marker.end + 0.04;
// Jump cuts: the waits for pages to load (Director.loaded), in seconds after cutStart
const cuts = ev
  .filter((e) => e.type === "cut" && e.end > e.start)
  .map((e) => ({ a: videoT(e.start) - cutStart, b: videoT(e.end) - cutStart }))
  .sort((x, y) => x.a - y.a);
const removed = cuts.reduce((n, c) => n + (c.b - c.a), 0);
const duration = videoT(stop.start) - cutStart + 0.1 - removed;
/** Timeline ms -> seconds in the finished video, after the cuts. */
const out = (ms) => {
  const t = videoT(ms) - cutStart;
  let gone = 0;
  for (const c of cuts) {
    if (t >= c.b) gone += c.b - c.a;
    else if (t > c.a) return Math.max(0, c.a - gone);
  }
  return Math.max(0, t - gone);
};
const inCut = (ms) => {
  const t = videoT(ms) - cutStart;
  return cuts.some((c) => t > c.a && t < c.b);
};
if (cuts.length) console.log(`Cuts: ${cuts.length}, ${removed.toFixed(1)} s of loading removed`);
console.log(`Marker at ${marker.start.toFixed(2)} s; length ${duration.toFixed(1)} s`);

// ---- 2. callout text, for reference, and the numbers check.mjs and join.mjs need ----
const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const hh = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${hh}:${mm}:${ss},${String(ms % 1000).padStart(3, "0")}`;
};
const cues = ev
  .filter((e) => ["title", "caption", "endcard"].includes(e.type))
  .map((e) => ({ a: out(e.start), b: Math.min(out(e.end), duration), text: e.text, type: e.type }))
  .sort((x, y) => x.a - y.a);
fs.writeFileSync(
  path.join(work, "captions.srt"),
  cues.map((c, i) => `${i + 1}\n${srtTime(c.a)} --> ${srtTime(c.b)}\n${c.text}\n`).join("\n"),
);

const title = ev.find((e) => e.type === "title");
const endcard = ev.find((e) => e.type === "endcard");
// Loading states seen on camera that no cut removes
const leaks = ev
  .filter((e) => e.type === "leak" && e.end - e.start >= 120)
  .filter((e) => !(inCut(e.start) && inCut(e.end)))
  .map((e) => ({ at: out(e.start), seconds: (e.end - e.start) / 1000 }));

// ---- 3. sound effects --------------------------------------------------------------
const wav = path.join(work, "sfx.wav");
mixTrack(
  ev.filter((e) => e.type === "sfx" && !inCut(e.start)).map((e) => ({ ...e, at: out(e.start) })),
  duration,
  wav,
);

// ---- 4. zooms ----------------------------------------------------------------------
const f = (n) => n.toFixed(3);
const filters = [`fps=${FPS}`];
if (cuts.length)
  filters.push(
    `select='not(${cuts.map((c) => `between(t,${f(c.a)},${f(c.b)})`).join("+")})'`,
    `setpts=N/${FPS}/TB`,
  );
const inputs = ["-ss", f(cutStart), "-i", raw];

const zooms = ev
  .filter((e) => e.type === "zoom" && e.end != null)
  .map((e) => {
    const r = e.rect;
    const z = Math.min(e.maxZoom || 1.9, W / r.w, H / r.h);
    if (z < 1.12) return null;
    const cw = W / z;
    const ch = H / z;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const left = Math.min(Math.max(cx - cw / 2, 0), W - cw);
    const top = Math.min(Math.max(cy - ch / 2, 0), H - ch);
    return { a: out(e.start), b: out(e.end), left, top, cw, ch, z };
  })
  .filter(Boolean);
const T = `(in/${FPS})`;
const S = (u) => `((${u})*(${u})*(3-2*(${u})))`;
const env = (z) =>
  `if(between(${T},${f(z.a)},${f(z.a + ZOOM_IN)}),${S(`(${T}-${f(z.a)})/${ZOOM_IN}`)},` +
  `if(between(${T},${f(z.a + ZOOM_IN)},${f(z.b)}),1,` +
  `if(between(${T},${f(z.b)},${f(z.b + ZOOM_IN)}),${S(`1-(${T}-${f(z.b)})/${ZOOM_IN}`)},0)))`;
const sum = (fn) => zooms.map((z) => `${env(z)}*(${fn(z)})`).join("+") || "0";
if (zooms.length) {
  const left = sum((z) => f(z.left));
  const top = sum((z) => f(z.top));
  const right = `${W}+${sum((z) => f(z.left + z.cw - W))}`;
  const bottom = `${H}+${sum((z) => f(z.top + z.ch - H))}`;
  const enable = zooms.map((z) => `between(t,${f(z.a)},${f(z.b + ZOOM_IN)})`).join("+");
  filters.push(
    `perspective=x0='${left}':y0='${top}':x1='${right}':y1='${top}':x2='${left}':y2='${bottom}':x3='${right}':y3='${bottom}':interpolation=cubic:eval=frame:enable='${enable}'`,
  );
}

// ---- 5. step counter ---------------------------------------------------------------
// Top right, unless something the viewer must see happens under it: then bottom right
const spots = ev.filter((e) => e.type === "spot");
const underTopRight = spots.some((s) => s.x + s.w > W - 520 && s.y < 130);
const corner = job.meta.counterCorner || (underTopRight ? "bottom-right" : "top-right");
if (corner === "bottom-right" && !job.meta.counterCorner)
  console.log("Counter moved to the bottom right: the top-right corner is in use.");

const counters = ev.filter((e) => e.type === "counter");
const parts = [`[0:v]${filters.join(",")}[z0]`];
counters.forEach((c, i) => {
  const png = path.join(work, `counter-${c.n}.png`);
  inputs.push("-loop", "1", "-framerate", String(FPS), "-i", png);
  const a = out(c.start);
  const b = c.end != null ? out(c.end) : duration;
  parts.push(
    `[${i + 1}:v]format=rgba,fade=t=in:st=${f(a)}:d=0.3:alpha=1,fade=t=out:st=${f(Math.max(a, b - 0.3))}:d=0.3:alpha=1[c${i}]`,
  );
  parts.push(
    `[z${i}][c${i}]overlay=x=W-w-36:y=${corner === "bottom-right" ? "H-h-32" : "32"}:shortest=0:eof_action=pass:enable='between(t,${f(a)},${f(b)})'[z${i + 1}]`,
  );
});
parts.push(`[z${counters.length}]format=yuv420p[v]`);
const graph = parts.join(";\n");
const audioIndex = inputs.filter((x) => x === "-i").length;
inputs.push("-i", wav);

// A long filter does not fit on a command line; the flag for reading it from a file changed in ffmpeg 7
const graphFile = path.join(work, "filter.txt");
fs.writeFileSync(graphFile, graph);
const major = +/version n?(\d+)/.exec(execFileSync("ffmpeg", ["-version"]).toString())?.[1] || 7;
const graphFlag = major >= 7 ? "-/filter_complex" : "-filter_complex_script";

execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-y",
    ...inputs,
    graphFlag,
    graphFile,
    "-map",
    "[v]",
    "-map",
    `${audioIndex}:a`,
    "-t",
    f(duration),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "17",
    "-tune",
    "animation",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    job.outFile,
  ],
  { stdio: "inherit" },
);

fs.writeFileSync(
  path.join(work, "info.json"),
  JSON.stringify(
    {
      duration,
      titleEnd: out(title.end) + 0.35,
      endcardStart: out(endcard.start),
      cues,
      leaks,
      zooms: zooms.map((z) => ({ a: z.a, b: z.b })),
      corner,
    },
    null,
    2,
  ),
);
console.log(`Wrote ${job.outFile} (${duration.toFixed(1)} s)`);
