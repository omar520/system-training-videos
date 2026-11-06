// One command for everything. Run from the project folder:
//   node video-tour/tour.mjs brand              read the system's look, write theme.json + previews
//   node video-tour/tour.mjs record 3           record chapter 3 (add --rehearsal for a fast dry run)
//   node video-tour/tour.mjs build 3            finish chapter 3 (cuts, zooms, counter, sound)
//   node video-tour/tour.mjs check 3            automatic checks, contact sheet and one still
//   node video-tour/tour.mjs make 3             rehearse, record, build and check
//   node video-tour/tour.mjs join               the full video, chapter markers, chapters.txt
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const run = (name, ...extra) =>
  execFileSync(
    process.execPath,
    [path.join(here, "engine", `${name}.mjs`), name, ...rest, ...extra],
    { stdio: "inherit" },
  );

try {
  if (cmd === "make") {
    run("record", "--rehearsal");
    run("record");
    run("build");
    run("check");
  } else if (["brand", "record", "build", "check", "join"].includes(cmd)) {
    run(cmd);
  } else {
    console.error("Commands: brand, record <n>, build <n>, check <n>, make <n>, join");
    process.exit(1);
  }
} catch (e) {
  process.exit(e.status || 1);
}
