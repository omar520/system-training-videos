#!/usr/bin/env node
// Sets up training videos in a project. Run from anywhere:
//   node <skill>/scripts/init.mjs <project folder> [--out <video folder>] [--dir video-tour]
//   node <skill>/scripts/init.mjs <project folder> --update     refresh engine/ only
// Copies the engine into <project>/video-tour, so the project can re-make its videos without
// the skill. It touches nothing else in the project. Existing chapters and settings are kept.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skill = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const project = path.resolve(args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) || ".");
const target = path.join(project, flag("--dir") || "video-tour");
const update = args.includes("--update");

// Tools the videos need
const tool = (cmd) => {
  try {
    return execFileSync(cmd, ["-version"], { encoding: "utf8", stdio: "pipe" }).split("\n")[0];
  } catch {
    return null;
  }
};
const missing = ["ffmpeg", "ffprobe"].filter((t) => !tool(t));
if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}. Install ffmpeg first (winget install ffmpeg).`);
  process.exit(1);
}
if (+process.versions.node.split(".")[0] < 18) {
  console.error("Node 18 or newer is needed.");
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });
fs.cpSync(path.join(skill, "engine"), path.join(target, "engine"), { recursive: true });
fs.cpSync(path.join(skill, "template", "tour.mjs"), path.join(target, "tour.mjs"));
console.log(`Engine copied to ${path.join(target, "engine")}`);
if (update) process.exit(0);

// The default video folder sits beside the project, outside its repository
const out = flag("--out") || path.join(path.dirname(project), `${path.basename(project)} videos`);
const rel = path.relative(target, out).replace(/\\/g, "/");
for (const f of ["package.json", ".gitignore", "README.md"]) {
  const to = path.join(target, f);
  if (!fs.existsSync(to)) fs.cpSync(path.join(skill, "template", f), to);
}
const cfg = path.join(target, "tour.config.mjs");
if (!fs.existsSync(cfg)) {
  const text = fs.readFileSync(path.join(skill, "template", "tour.config.mjs"), "utf8");
  fs.writeFileSync(cfg, text.replace("__OUTPUT_DIR__", rel));
}
const chapters = path.join(target, "chapters");
if (!fs.existsSync(chapters)) {
  fs.cpSync(path.join(skill, "template", "chapters"), chapters, { recursive: true });
}
console.log(`Ready: ${target}`);
console.log(`Videos will go to: ${out}`);
console.log("Next:");
console.log(`  cd "${target}" && npm install && npx playwright install chromium`);
