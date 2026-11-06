// Records one chapter with Playwright.
//   node video-tour/tour.mjs record 3              raw video + timeline.json
//   node video-tour/tour.mjs record 3 --rehearsal  fast, no video (warms up a dev server)
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Director } from "./director.mjs";
import {
  TOUR,
  VIEWPORT,
  fontsReady,
  loadChapter,
  loadConfig,
  loadTheme,
  overlayContext,
  renderCounter,
  signedInState,
} from "./project.mjs";

const key = process.argv[3] || "";
const rehearsal = process.argv.includes("--rehearsal");
const config = await loadConfig();
const theme = loadTheme(config);
const job = await loadChapter(config, key);
if (!job) {
  console.error("Usage: node video-tour/tour.mjs record <chapter number> [--rehearsal]");
  process.exit(1);
}
const outDir = job.workDir;
fs.mkdirSync(outDir, { recursive: true });

// Every chapter starts from the same clean data. A reset can fail once while services restart.
if (config.reset && !process.argv.includes("--no-reset")) {
  const reset = async () => {
    if (typeof config.reset === "function") await config.reset();
    else execSync(config.reset, { cwd: path.dirname(TOUR), stdio: "inherit" });
  };
  await reset().catch(() => {
    console.log("Reset failed, trying once more.");
    return reset();
  });
  console.log("Test data reset.");
}

const browser = await chromium.launch();
try {
  // 1. Sign in without recording, and keep the session (unless the chapter shows signing in)
  const signedIn = job.meta.signedIn !== false;
  const storageState = signedIn
    ? await signedInState(browser, config, job.meta.account)
    : undefined;

  // 2. The recording context
  const ctx = await overlayContext(
    browser,
    {
      baseURL: config.baseURL,
      viewport: VIEWPORT,
      storageState,
      reducedMotion: "no-preference",
      acceptDownloads: true,
      ...(rehearsal ? {} : { recordVideo: { dir: outDir, size: VIEWPORT } }),
    },
    theme,
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(300000);
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console error: ${m.text().slice(0, 300)}`);
  });

  // Optional set-up through the system itself, before the sync frame (not in the video)
  if (job.meta.setup) {
    await job.meta.setup(page);
    console.log("Set-up done.");
  }
  await page.goto(job.meta.startPath || (signedIn ? config.homePath : config.publicPath));
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

  const d = new Director(page, { rehearsal, meta: job.meta, config });
  await fontsReady(page, theme).catch(() => {});
  try {
    await job.run(d, { page, main: page.locator("main, [role=main]").first(), browser });
  } catch (err) {
    // Keep a picture of the screen where the run stopped, to see what went wrong
    await page.screenshot({ path: path.join(outDir, "error.png") }).catch(() => {});
    for (const pr of problems) console.log("  browser: " + pr);
    console.log(`Screen at the failure: ${path.join(outDir, "error.png")}`);
    throw err;
  }

  const video = page.video();
  await ctx.close();
  if (video) {
    const raw = path.join(outDir, "raw.webm");
    fs.rmSync(raw, { force: true });
    await video.saveAs(raw);
    await video.delete();
  }
  if (!rehearsal) {
    fs.writeFileSync(
      path.join(outDir, "timeline.json"),
      JSON.stringify(
        { chapter: job.n, viewport: VIEWPORT, events: d.events, problems, warnings: d.warnings },
        null,
        2,
      ),
    );

    // The step counters, with the system's own fonts
    const pngCtx = await overlayContext(
      browser,
      { baseURL: config.baseURL, viewport: VIEWPORT, storageState },
      theme,
    );
    const p = await pngCtx.newPage();
    await p.goto(signedIn ? config.homePath : config.publicPath);
    await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await fontsReady(p, theme).catch(() => {});
    for (const c of d.events.filter((e) => e.type === "counter")) {
      await renderCounter(p, theme, c, path.join(outDir, `counter-${c.n}.png`));
    }
    await pngCtx.close();
  }
  console.log(`${rehearsal ? "Rehearsal" : "Recording"} of chapter ${job.n} done.`);
  for (const w of d.warnings) console.log("Warning: " + w);
  if (problems.length) {
    console.log("Problems seen in the browser:");
    for (const pr of problems) console.log("  " + pr);
  }
} finally {
  await browser.close();
}
