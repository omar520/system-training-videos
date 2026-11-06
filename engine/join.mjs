// Joins the finished chapters into one training video.
//   node video-tour/tour.mjs join
// Needs every chapter built, and the system running (the cards use its own fonts).
// - an opening card, then for each chapter a black card followed by the chapter without its
//   own title and end card, then a closing card;
// - chapter markers inside the MP4;
// - chapters.txt with the start of each chapter, as "00:00 Title" lines (YouTube format).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  VIEWPORT,
  fontsReady,
  listChapters,
  loadChapter,
  loadConfig,
  loadTheme,
  overlayContext,
  pad2,
  paths,
  signedInState,
} from "./project.mjs";
import { mixTrack } from "./sfx.mjs";

const config = await loadConfig();
const theme = loadTheme(config);
const P = paths(config);
const work = path.join(P.work, "full");
fs.mkdirSync(work, { recursive: true });
const FPS = 30;
const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
const probe = (f) =>
  +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])
    .toString()
    .trim();

// ---- 1. Cards, rendered with the overlay in the system's own fonts ----------------------
const jobs = [];
for (const c of listChapters()) jobs.push(await loadChapter(config, c.n));
const seriesName = `${config.system} · ${config.seriesTitle || "Training"}`;

const cards = [
  {
    file: "card-open.png",
    seconds: 4,
    brand: true,
    opts: {
      kicker: config.seriesTitle || "Training",
      line1: seriesName,
      line2: config.seriesLine || `${jobs.length} chapters.`,
      brand: true,
    },
  },
  ...jobs.map((j) => ({
    file: `card-${pad2(j.n)}.png`,
    seconds: 3.5,
    opts: {
      bg: theme.chapterCardBg,
      kicker: `Chapter ${j.n} of ${jobs.length}`,
      line1: j.meta.title,
      line2: j.meta.line,
    },
  })),
  {
    file: "card-close.png",
    seconds: 4,
    brand: true,
    opts: {
      kicker: "The end",
      line1: config.closingLine || "You have seen the whole system.",
      line2: seriesName,
      brand: true,
    },
  },
];

const browser = await chromium.launch();
try {
  const storageState = await signedInState(browser, config);
  const ctx = await overlayContext(
    browser,
    { baseURL: config.baseURL, viewport: VIEWPORT, storageState },
    theme,
  );
  const page = await ctx.newPage();
  await page.goto(storageState ? config.homePath : config.publicPath);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => window.__tour && window.__tour.ready());
  await fontsReady(page, theme).catch(() => {});
  for (const c of cards) {
    await page.evaluate((o) => window.__tour.card({ ...o, instant: true }), c.opts);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(work, c.file) });
  }
} finally {
  await browser.close();
}
console.log("Cards rendered.");

// ---- 2. Segments ------------------------------------------------------------------------
const enc = [
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "18",
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
  "-ac",
  "1",
];
const segments = [];
const marks = []; // { title, start }
let clock = 0;

function cardSegment(c, title) {
  const wav = path.join(work, c.file.replace(".png", ".wav"));
  mixTrack([{ kind: "chime", at: 0.35, soft: !c.brand }], c.seconds, wav);
  const out = path.join(work, c.file.replace(".png", ".mp4"));
  const fo = (c.seconds - 0.45).toFixed(2);
  ff([
    "-loop",
    "1",
    "-framerate",
    String(FPS),
    "-t",
    String(c.seconds),
    "-i",
    path.join(work, c.file),
    "-i",
    wav,
    "-vf",
    `fade=t=in:st=0:d=0.4,fade=t=out:st=${fo}:d=0.45,format=yuv420p`,
    "-t",
    String(c.seconds),
    ...enc,
    out,
  ]);
  if (title) marks.push({ title, start: clock });
  segments.push(out);
  clock += probe(out);
}

cardSegment(cards[0], "Introduction");
for (const j of jobs) {
  const c = cards.find((x) => x.file === `card-${pad2(j.n)}.png`);
  cardSegment(c, `Chapter ${j.n} · ${j.meta.title}`);
  const info = JSON.parse(fs.readFileSync(path.join(j.workDir, "info.json"), "utf8"));
  const out = path.join(work, `chapter-${pad2(j.n)}.mp4`);
  ff([
    "-ss",
    info.titleEnd.toFixed(3),
    "-to",
    info.endcardStart.toFixed(3),
    "-i",
    j.outFile,
    "-vf",
    "fade=t=in:st=0:d=0.3,format=yuv420p",
    "-af",
    "afade=t=in:st=0:d=0.2",
    ...enc,
    out,
  ]);
  segments.push(out);
  clock += probe(out);
  console.log(`Chapter ${j.n} added.`);
}
cardSegment(cards[cards.length - 1], "The end");

// ---- 3. Join, with chapter markers ------------------------------------------------------
const list = path.join(work, "list.txt");
fs.writeFileSync(
  list,
  segments.map((s) => `file '${s.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
);
const joined = path.join(work, "joined.mp4");
ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);
const total = probe(joined);

const esc = (s) => s.replace(/[=;#\\\n]/g, (c) => `\\${c}`);
const meta = [";FFMETADATA1", `title=${esc(seriesName)}`, ""];
marks.forEach((m, i) => {
  const end = i + 1 < marks.length ? marks[i + 1].start : total;
  meta.push(
    "[CHAPTER]",
    "TIMEBASE=1/1000",
    `START=${Math.round(m.start * 1000)}`,
    `END=${Math.round(end * 1000)}`,
    `title=${esc(m.title)}`,
    "",
  );
});
const metaFile = path.join(work, "chapters.ffmeta");
fs.writeFileSync(metaFile, meta.join("\n"));
ff([
  "-i",
  joined,
  "-i",
  metaFile,
  "-map",
  "0",
  "-map_metadata",
  "1",
  "-map_chapters",
  "1",
  "-c",
  "copy",
  "-movflags",
  "+faststart",
  P.full,
]);

const stamp = (s) => {
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
fs.writeFileSync(P.chaptersTxt, marks.map((m) => `${stamp(m.start)} ${m.title}`).join("\n") + "\n");
console.log(`Wrote ${P.full} (${stamp(total)})`);
console.log(`Wrote ${P.chaptersTxt}`);
console.log(fs.readFileSync(P.chaptersTxt, "utf8"));
