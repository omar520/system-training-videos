// Everything the other scripts share: the project's settings, its chapters, its theme, its
// folders, and the safety check that keeps recordings away from live systems.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ENGINE = path.dirname(fileURLToPath(import.meta.url));
export const TOUR = path.dirname(ENGINE); // the project's video-tour folder
export const VIEWPORT = { width: 1920, height: 1080 };
export const pad2 = (n) => String(n).padStart(2, "0");

const DEFAULTS = {
  allowRemote: false,
  homePath: "/",
  publicPath: "/",
  brandPages: [],
  // Loading placeholders and spinners of the common UI kits
  loading: [
    ".animate-pulse",
    ".animate-spin",
    ".skeleton",
    '[class*="skeleton" i]',
    ".spinner",
    '[class*="spinner" i]',
    '[aria-busy="true"]',
    ".MuiSkeleton-root",
    ".MuiCircularProgress-root",
    ".ant-spin-spinning",
    ".ant-skeleton",
    ".v-skeleton-loader",
  ],
  toast: [
    '[role="status"]',
    '[role="alert"]',
    ".toast",
    ".toast-message",
    "[data-sonner-toast]",
    ".Toastify__toast",
    ".MuiSnackbar-root",
    ".ant-message-notice",
    ".notification",
  ],
  // Developer tools that must not show on camera
  hide: [
    "nextjs-portal",
    "#webpack-dev-server-client-overlay",
    "vite-error-overlay",
    "vite-plugin-checker-error-overlay",
    "#__next-build-watcher",
    ".tsqd-parent-container",
    "#djDebug",
    ".phpdebugbar",
  ],
  theme: {},
};

export async function loadConfig() {
  const file = path.join(TOUR, "tour.config.mjs");
  if (!fs.existsSync(file)) throw new Error(`No tour.config.mjs in ${TOUR}`);
  const user = (await import(pathToFileURL(file).href)).default;
  const c = { ...DEFAULTS, ...user };
  for (const k of ["loading", "toast", "hide"]) {
    if (user[`${k}Extra`]) c[k] = [...c[k], ...user[`${k}Extra`]];
  }
  c.outputDir = path.resolve(TOUR, c.outputDir || "../../training-videos");
  c.slug = (c.fileName || c.system).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-");
  guard(c);
  return c;
}

/** Recording drives real clicks and saves real changes, so stay on a local copy by default. */
function guard(c) {
  const host = new URL(c.baseURL).hostname;
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (!local && !c.allowRemote) {
    throw new Error(
      `${c.baseURL} is not a local address. The scripts click and save for real. Use a local ` +
        "copy with test data. For a test server that holds only fictional data, the owner can " +
        "set allowRemote: true in tour.config.mjs.",
    );
  }
}

export function paths(c) {
  return {
    chapters: path.join(c.outputDir, "chapters"),
    stills: path.join(c.outputDir, "stills"),
    work: path.join(c.outputDir, "_work"),
    full: path.join(c.outputDir, `${c.slug}-training.mp4`),
    chaptersTxt: path.join(c.outputDir, "chapters.txt"),
  };
}

export function listChapters() {
  const dir = path.join(TOUR, "chapters");
  return fs
    .readdirSync(dir)
    .map((f) => /^(\d+)-(.+)\.mjs$/.exec(f))
    .filter(Boolean)
    .map((m) => ({ n: +m[1], slug: m[2], file: path.join(dir, m[0]) }))
    .sort((a, b) => a.n - b.n);
}

export async function loadChapter(c, key) {
  const all = listChapters();
  const ch = all.find((x) => x.n === Number(key));
  if (!ch) return null;
  const mod = await import(pathToFileURL(ch.file).href);
  const p = paths(c);
  const name = `${pad2(ch.n)}-${ch.slug}`;
  return {
    ...ch,
    name,
    workDir: path.join(p.work, "chapters", name),
    outFile: path.join(p.chapters, `${name}.mp4`),
    still: path.join(p.stills, `${name}.png`),
    meta: {
      kicker: `Chapter ${ch.n} of ${all.length}`,
      endKicker: `End of chapter ${ch.n}`,
      endLine: `${c.system} · ${c.seriesTitle || "Training"}`,
      ...mod.meta,
    },
    run: mod.run,
  };
}

export function loadTheme(c) {
  const file = path.join(TOUR, "theme.json");
  if (!fs.existsSync(file)) throw new Error("No theme.json yet. Run: node video-tour/tour.mjs brand");
  const t = JSON.parse(fs.readFileSync(file, "utf8"));
  const logo = path.join(TOUR, "theme-logo.png");
  const logoDataUrl =
    t.useLogo !== false && fs.existsSync(logo)
      ? "data:image/png;base64," + fs.readFileSync(logo).toString("base64")
      : null;
  return { ...t, logoDataUrl, hide: c.hide.join(","), loading: c.loading.join(",") };
}

/** A browser context with the overlay and the system's theme loaded into every page. */
export async function overlayContext(browser, options, theme) {
  const ctx = await browser.newContext(options);
  await ctx.addInitScript(`window.__tourTheme = ${JSON.stringify(theme)};`);
  await ctx.addInitScript({ path: path.join(ENGINE, "overlay.js") });
  return ctx;
}

/** Sign in without showing it, and return the session for a recording to start from. */
export async function signedInState(browser, c, accountKey) {
  const account = c.accounts?.[accountKey || c.defaultAccount];
  if (!c.signIn || !account) return undefined;
  const ctx = await browser.newContext({ baseURL: c.baseURL, viewport: VIEWPORT });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(300000); // a dev server can compile for minutes on first use
  await page.goto(c.signInPath || c.publicPath);
  await c.signIn(
    {
      page,
      type: (loc, text) => loc.fill(text),
      click: (loc) => loc.click(),
    },
    account,
  );
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/** Wait until the system's own fonts are ready, so cards never render in a fallback font. */
export async function fontsReady(page, theme) {
  await page.evaluate(
    async ([h, w, b]) => {
      await Promise.all([
        document.fonts.load(`${w} 66px ${h}`).catch(() => {}),
        document.fonts.load(`400 30px ${b}`).catch(() => {}),
        document.fonts.load(`700 19px ${b}`).catch(() => {}),
      ]);
      await document.fonts.ready;
    },
    [theme.fonts.heading, theme.fonts.headingWeight, theme.fonts.body],
  );
}

/** The transparent "Step n of N" image. ffmpeg lays it on after the zoom, so it stays still. */
export async function renderCounter(page, theme, step, file) {
  await page.evaluate(
    ({ n, total, title, t }) => {
      document.getElementById("__counter")?.remove();
      for (const child of document.body.children) child.style.visibility = "hidden";
      for (const el of [document.documentElement, document.body]) {
        el.style.setProperty("background", "transparent", "important");
      }
      const el = document.createElement("div");
      el.id = "__counter";
      el.dir = "auto";
      el.style.cssText =
        "position:fixed;left:40px;top:40px;z-index:2147483647;display:inline-flex;flex-direction:column;gap:6px;" +
        `padding:14px 22px 16px;border-radius:${t.radius}px;background:${t.callout.bg}F0;` +
        `border-inline-start:6px solid ${t.callout.edge};color:${t.callout.text};`;
      const a = document.createElement("div");
      a.style.cssText = `font:700 17px/1 ${t.fonts.body};letter-spacing:.12em;text-transform:uppercase;opacity:.82`;
      a.textContent = `Step ${n} of ${total}`;
      const b = document.createElement("div");
      b.style.cssText = `font:600 24px/1.2 ${t.fonts.body}`;
      b.textContent = title;
      el.append(a, b);
      document.body.appendChild(el);
    },
    { ...step, t: theme },
  );
  await page.locator("#__counter").screenshot({ path: file, omitBackground: true });
}
