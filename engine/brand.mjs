// Reads the system's own look from its running pages and writes theme.json.
//   node video-tour/tour.mjs brand
// It samples real colours, fonts, corners and the logo, then renders three preview pictures,
// so the theme can be checked by eye before anything is recorded.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import {
  TOUR,
  VIEWPORT,
  fontsReady,
  loadConfig,
  loadTheme,
  overlayContext,
  paths,
  renderCounter,
  signedInState,
} from "./project.mjs";
import { deriveTheme, themeWarnings } from "./theme.mjs";

const config = await loadConfig();
const outDir = path.join(paths(config).work, "brand");
fs.mkdirSync(outDir, { recursive: true });

/** Runs in the page. Colours go through a canvas, so oklch(), lab() and hsl() all become RGB. */
function sample() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const g = cv.getContext("2d", { willReadFrequently: true });
  const toRGB = (css) => {
    if (!css || css === "transparent") return null;
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = "#010203";
    g.fillStyle = css;
    if (g.fillStyle === "#010203" && !/^#0?10?20?3/i.test(css)) return null; // not a colour
    g.fillRect(0, 0, 1, 1);
    const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data;
    return a < 150 ? null : [r, gr, b];
  };
  const W = innerWidth;
  const H = innerHeight;
  const visibleArea = (r) =>
    Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) *
    Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));

  const out = { url: location.pathname, surfaces: [], buttons: [], badges: [], links: [], vars: [] };
  const linkCount = new Map();
  const danger = /delete|remove|danger|destructive|error|cancel|حذف/i;
  const els = [...document.querySelectorAll("body, body *")].slice(0, 6000);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const area = visibleArea(r);
    if (area < 30) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity < 0.5) continue;
    const bg = toRGB(cs.backgroundColor);
    const tag = el.tagName;
    const isButton =
      tag === "BUTTON" ||
      el.getAttribute("role") === "button" ||
      (tag === "INPUT" && /submit|button/.test(el.type)) ||
      (tag === "A" && /btn|button/i.test(el.className?.toString?.() || ""));
    if (bg) {
      if (isButton) {
        const words = `${el.textContent} ${el.className?.toString?.() || ""}`;
        if (!danger.test(words))
          out.buttons.push({ rgb: bg, area, radius: parseFloat(cs.borderTopLeftRadius) || 0 });
      } else if (el.closest("aside, nav, header, [role=navigation], [class*=sidebar i]")) {
        out.surfaces.push({ rgb: bg, area, kind: area > 15000 ? "nav" : "other" });
      } else if (area < 9000 && r.height < 44 && parseFloat(cs.borderTopLeftRadius) >= 3) {
        out.badges.push({ rgb: bg, area });
      } else {
        out.surfaces.push({ rgb: bg, area, kind: "other" });
      }
    }
    if (tag === "A" && el.textContent.trim()) {
      const c = toRGB(cs.color);
      if (c) linkCount.set(c.join(), (linkCount.get(c.join()) || 0) + 1);
    }
  }
  out.links = [...linkCount].map(([k, count]) => ({ rgb: k.split(",").map(Number), count }));

  const bodyBg = toRGB(getComputedStyle(document.body).backgroundColor);
  const htmlBg = toRGB(getComputedStyle(document.documentElement).backgroundColor);
  const main = document.querySelector("main, [role=main]");
  const mainBg = main && toRGB(getComputedStyle(main).backgroundColor);
  out.pageBg = mainBg || bodyBg || htmlBg || [255, 255, 255];
  out.pageBgArea = W * H;
  const bs = getComputedStyle(document.body);
  out.textColor = toRGB(bs.color) || [17, 24, 39];
  out.body = { family: bs.fontFamily };
  const h = document.querySelector("h1, h2, h3");
  if (h) {
    const hs = getComputedStyle(h);
    out.heading = { family: hs.fontFamily, weight: hs.fontWeight };
  }

  // CSS variables named like a brand colour. shadcn stores bare numbers: "222 47% 11%"
  const names = new Set();
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules) walk(rule.cssRules);
      if (!rule.style) continue;
      for (const p of rule.style) {
        if (/^--(.*-)?(primary|brand|accent)(-\d+|-color|-500|-600)?$/i.test(p)) names.add(p);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // A stylesheet from another address cannot be read
    }
  }
  const rootStyle = getComputedStyle(document.documentElement);
  for (const name of names) {
    const v = rootStyle.getPropertyValue(name).trim();
    if (!v || v.startsWith("var(")) continue;
    const c = toRGB(v) || toRGB(`hsl(${v})`) || toRGB(`oklch(${v})`);
    if (c) out.vars.push({ name, rgb: c });
  }
  return out;
}

/** Most common strong colours in a picture of the page: catches gradients and images. */
async function pixelPalette(page) {
  const shot = await page.screenshot({ type: "png" });
  return page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 135;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, 240, 135);
    const d = g.getImageData(0, 0, 240, 135).data;
    const n = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = [d[i] >> 4, d[i + 1] >> 4, d[i + 2] >> 4].join();
      n.set(k, (n.get(k) || 0) + 1);
    }
    return [...n]
      .map(([k, count]) => ({ rgb: k.split(",").map((v) => +v * 16 + 8), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 24);
  }, "data:image/png;base64," + shot.toString("base64"));
}

/** A picture of the logo with a little of its own background around it. */
async function grabLogo(page, file) {
  const box = await page.evaluate(() => {
    const sel =
      'img[alt*="logo" i], img[src*="logo" i], img[class*="logo" i], [class*="logo" i] img, ' +
      '[class*="logo" i] svg, svg[aria-label*="logo" i], svg[class*="logo" i], ' +
      'a[href="/"] img, a[href="/"] svg, header img, aside img, nav img';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width >= 20 && r.height >= 16 && r.width <= 460 && r.height <= 180 && r.top < 500) {
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      }
    }
    return null;
  });
  if (!box) return false;
  const m = 10;
  await page.screenshot({
    path: file,
    clip: {
      x: Math.max(0, box.x - m),
      y: Math.max(0, box.y - m),
      width: box.width + 2 * m,
      height: box.height + 2 * m,
    },
  });
  return true;
}

const browser = await chromium.launch();
try {
  const state = await signedInState(browser, config);
  const logoFile = path.join(TOUR, "theme-logo.png");
  fs.rmSync(logoFile, { force: true });
  let logo = false;
  const samples = [];

  async function visit(ctx, url) {
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(300000);
    await page.goto(url);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const s = await page.evaluate(sample);
    s.pixels = await pixelPalette(page);
    samples.push(s);
    if (!logo) logo = await grabLogo(page, logoFile);
    await page.close();
    console.log(`Read ${url}`);
  }

  // Sharp logo: twice the pixels
  const opts = { baseURL: config.baseURL, viewport: VIEWPORT, deviceScaleFactor: 2 };
  const pub = await browser.newContext(opts);
  await visit(pub, config.publicPath);
  await pub.close();
  const inside = await browser.newContext({ ...opts, storageState: state });
  const pages = config.brandPages.length ? config.brandPages : [config.homePath];
  for (const p of pages) await visit(inside, p);
  await inside.close();

  const theme = deriveTheme(samples, config.theme);
  fs.writeFileSync(path.join(TOUR, "theme.json"), JSON.stringify(theme, null, 2) + "\n");

  // ---- preview pictures ------------------------------------------------------------------
  const t = loadTheme(config);
  const ctx = await overlayContext(
    browser,
    { baseURL: config.baseURL, viewport: VIEWPORT, storageState: state },
    t,
  );
  const page = await ctx.newPage();
  await page.goto(pages[0]);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => window.__tour && window.__tour.ready());
  await fontsReady(page, t);
  const shots = [
    [
      "title-card.png",
      {
        kicker: "Chapter 1 of 8",
        line1: "Getting started",
        line2: `${config.system}: how a title card will look.`,
        brand: true,
      },
    ],
    [
      "chapter-card.png",
      {
        bg: t.chapterCardBg,
        kicker: "Chapter 2 of 8",
        line1: "A chapter card",
        line2: "These sit between chapters in the full video.",
      },
    ],
  ];
  for (const [name, card] of shots) {
    await page.evaluate((o) => window.__tour.card({ ...o, instant: true }), card);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(outDir, name) });
  }
  await page.evaluate(() => window.__tour.card(null));
  await page.waitForTimeout(450);
  const target = page
    .locator("main a, main button, a, button, h1")
    .filter({ visible: true })
    .first();
  await page.evaluate(() => window.__tour.showCursor(true, 760, 470));
  const handle = await target.elementHandle();
  await page.evaluate(
    (el) => window.__tour.callout(el, "A callout explains why this matters.", "auto"),
    handle,
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, "callout.png") });
  await ctx.close();

  const cctx = await overlayContext(
    browser,
    { baseURL: config.baseURL, viewport: VIEWPORT, storageState: state },
    t,
  );
  const cp = await cctx.newPage();
  await cp.goto(pages[0]);
  await cp.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await fontsReady(cp, t);
  await renderCounter(
    cp,
    t,
    { n: 2, total: 5, title: "Step counter" },
    path.join(outDir, "counter.png"),
  );
  await cctx.close();

  console.log("\ntheme.json:");
  console.log(`  page ${theme.pageBg} (${theme.scheme})   accent ${theme.accent}`);
  console.log(`  cards ${theme.card.bg}   callouts ${theme.callout.bg} / ${theme.callout.text}`);
  console.log(`  heading font ${theme.fonts.heading}`);
  console.log(`  body font    ${theme.fonts.body}`);
  console.log(`  corners ${theme.radius}px   logo ${logo ? "found" : "not found"}`);
  for (const n of theme.notes) console.log(`  ${n}`);
  const w = themeWarnings(theme);
  for (const x of w) console.log(`  WARNING ${x}`);
  console.log(`\nLook at the previews in ${outDir}`);
} finally {
  await browser.close();
}
