// Turns what brand.mjs saw on the system's own pages into theme.json: the colours, fonts and
// corners of the title cards, callouts, cursor and step counter. The layout never changes;
// only this skin does, so each video looks as if it belongs to the system it teaches.

// ---- colour helpers ---------------------------------------------------------------------------
export const hex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

export function rgb(h) {
  const s = h.replace("#", "");
  const f = s.length === 3 ? [...s].map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
}

export function hsl([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function fromHsl([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h / 60) % 6];
  return seg.map((v) => Math.round((v + m) * 255));
}

export function lum(c) {
  const f = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}

export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hueGap = (a, b) => {
  const d = Math.abs(hsl(a)[0] - hsl(b)[0]);
  return Math.min(d, 360 - d);
};
const chromatic = (c) => {
  const [, s, l] = hsl(c);
  return s >= 0.28 && l >= 0.1 && l <= 0.9;
};

/** Move a colour lighter or darker, keeping its hue, until it reads against the background. */
export function readable(color, against, ratio) {
  if (contrast(color, against) >= ratio) return color;
  const [h, s, l0] = hsl(color);
  const lighter = lum(against) < 0.3;
  for (let i = 1; i <= 50; i++) {
    const l = Math.min(1, Math.max(0, l0 + (lighter ? i : -i) * 0.02));
    const c = fromHsl([h, s, l]);
    if (contrast(c, against) >= ratio) return c;
  }
  return lighter ? [255, 255, 255] : [0, 0, 0];
}

// ---- reading the samples ----------------------------------------------------------------------
function merge(items) {
  // Near-identical colours count as one
  const out = [];
  for (const it of items) {
    const hit = out.find((o) => dist(o.rgb, it.rgb) < 26);
    if (hit) hit.score += it.score;
    else out.push({ ...it });
  }
  return out.sort((a, b) => b.score - a.score);
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

function topFont(list) {
  const n = new Map();
  for (const f of list) if (f?.family) n.set(f.family, (n.get(f.family) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * @param samples one object per page, from brand.mjs
 * @param overrides config.theme: any value here wins
 */
export function deriveTheme(samples, overrides = {}) {
  const notes = [];

  // The page behind everything: decides whether callouts are dark or light
  const pageBg =
    merge(samples.map((s) => ({ rgb: s.pageBg, score: s.pageBgArea || 1 })))[0]?.rgb || [
      255, 255, 255,
    ];
  const scheme = lum(pageBg) < 0.2 ? "dark" : "light";

  // Brand colour candidates, strongest evidence first
  const weighted = [];
  for (const s of samples) {
    for (const v of s.vars) weighted.push({ rgb: v.rgb, score: 60000, from: `CSS ${v.name}` });
    for (const b of s.buttons) weighted.push({ rgb: b.rgb, score: b.area * 3, from: "button" });
    for (const n of s.surfaces) {
      if (n.kind === "nav") weighted.push({ rgb: n.rgb, score: n.area * 0.08, from: "navigation" });
    }
    for (const l of s.links) weighted.push({ rgb: l.rgb, score: l.count * 800, from: "link" });
    for (const p of s.pixels) weighted.push({ rgb: p.rgb, score: p.count * 2, from: "screen" });
  }
  const candidates = merge(weighted.filter((w) => chromatic(w.rgb)));
  const brand = candidates[0]?.rgb || null;

  // Card background: a dark surface the system really uses, else a deep shade of its brand colour
  const darkSurfaces = merge(
    samples.flatMap((s) =>
      s.surfaces
        .concat(s.buttons.map((b) => ({ ...b, kind: "button" })))
        .filter((x) => (x.kind === "nav" || x.kind === "button") && lum(x.rgb) < 0.07)
        .map((x) => ({ rgb: x.rgb, score: x.area })),
    ),
  );
  let cardBg;
  let cardFrom;
  if (darkSurfaces.length) {
    cardBg = darkSurfaces[0].rgb;
    cardFrom = "a dark surface in the system";
  } else if (brand) {
    const [h, s] = hsl(brand);
    cardBg = fromHsl([h, Math.min(s, 0.62), 0.16]);
    cardFrom = "a deep shade of the brand colour";
  } else {
    const text = merge(samples.map((s) => ({ rgb: s.textColor, score: 1 })))[0]?.rgb;
    cardBg = text && lum(text) < 0.1 ? text : [17, 24, 39];
    cardFrom = "the system's text colour (no brand colour found)";
  }

  // Accent: the brand colour; when that is the card colour itself, the next colour the system
  // really uses on buttons, links or in its CSS (never a badge: those carry status meanings)
  let accent = brand;
  if (accent && (dist(accent, cardBg) < 60 || lum(accent) < 0.05)) {
    const other = candidates.find(
      (c) => c.from !== "screen" && dist(c.rgb, cardBg) >= 60 && lum(c.rgb) >= 0.05,
    );
    if (other) accent = other.rgb;
    else {
      const [h, s] = hsl(cardBg);
      accent = fromHsl([h, Math.max(s, 0.55), 0.48]);
    }
  }
  if (!accent) accent = scheme === "light" ? cardBg : [226, 232, 240];
  const accentOnPage = readable(accent, pageBg, 3);

  // Callouts stand out from the page: dark on a light system, and on a dark system whichever
  // of the card colour or a light surface is further from the page
  let calloutBg = cardBg;
  let calloutText = readable([255, 255, 255], cardBg, 7);
  if (contrast(cardBg, pageBg) < 2.2) {
    const text = merge(samples.map((s) => ({ rgb: s.textColor, score: 1 })))[0]?.rgb;
    calloutBg = text && lum(text) > 0.5 ? text : [241, 245, 249];
    calloutText = readable(pageBg, calloutBg, 7);
  }

  // Card text: tints of the card colour, always readable
  const [ch, cs] = hsl(cardBg);
  const cardText = readable(fromHsl([ch, Math.min(cs, 0.3), 0.84]), cardBg, 7);
  const kicker = readable(accentOnPage, cardBg, 4.5);

  // The band on title cards: colours the system uses, by hue; tints of the accent fill the rest
  const palette = merge(
    samples.flatMap((s) => [
      ...s.badges.map((b) => ({ rgb: b.rgb, score: b.area + 500 })),
      ...s.buttons.map((b) => ({ rgb: b.rgb, score: b.area })),
    ]),
  )
    .map((p) => p.rgb)
    .filter((c) => chromatic(c) && hsl(c)[2] <= 0.75); // pale badge tints clash on a dark card
  const band = [accentOnPage];
  for (const c of palette) {
    if (band.length >= 6) break;
    if (band.every((b) => dist(b, c) > 50)) band.push(c);
  }
  const [ah, as] = hsl(accentOnPage);
  for (const l of [0.82, 0.68, 0.55, 0.4, 0.28]) {
    if (band.length >= 6) break;
    band.push(fromHsl([ah, Math.min(as, 0.7), l]));
  }

  const radii = samples.flatMap((s) => s.buttons.map((b) => b.radius)).filter((r) => r != null);
  const r = radii.length ? median(radii) : 8;
  const radius = Math.round(Math.min(12, Math.max(0, r > 24 ? 12 : r + 2)));

  const headingFont = topFont(samples.map((s) => s.heading));
  const bodyFont = topFont(samples.map((s) => s.body));
  const headingWeights = samples.map((s) => +s.heading?.weight).filter(Boolean);

  if (!brand) notes.push("No brand colour found: the system looks black and white.");
  if (!headingFont) notes.push("No heading found: the heading font falls back to the body font.");
  notes.push(`Card colour comes from ${cardFrom}.`);
  if (brand) notes.push(`Brand colour ${hex(brand)} found in: ${candidates[0].from}.`);

  const theme = {
    scheme,
    pageBg: hex(pageBg),
    accent: hex(accentOnPage),
    card: {
      bg: hex(cardBg),
      title: hex(readable([255, 255, 255], cardBg, 7)),
      text: hex(cardText),
      kicker: hex(kicker),
    },
    chapterCardBg: "#000000",
    callout: { bg: hex(calloutBg), text: hex(calloutText), edge: hex(accentOnPage) },
    fonts: {
      heading: headingFont || bodyFont || "Georgia, serif",
      headingWeight: headingWeights.length ? median(headingWeights) : 500,
      body: bodyFont || "'Segoe UI', sans-serif",
    },
    radius,
    band: band.map(hex),
    notes,
  };
  return deepMerge(theme, overrides);
}

export function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(a[k] || {}, v) : v;
  }
  return out;
}

/** Contrast problems a viewer would notice. Empty when the theme is safe. */
export function themeWarnings(t) {
  const w = [];
  const check = (name, a, b, min) => {
    const c = contrast(rgb(a), rgb(b));
    if (c < min) w.push(`${name}: contrast ${c.toFixed(1)}, needs ${min}`);
  };
  check("Title on card", t.card.title, t.card.bg, 7);
  check("Line on card", t.card.text, t.card.bg, 4.5);
  check("Kicker on card", t.card.kicker, t.card.bg, 4.5);
  check("Callout text", t.callout.text, t.callout.bg, 4.5);
  check("Highlight on page", t.accent, t.pageBg, 3);
  check("Callout on page", t.callout.bg, t.pageBg, 1.6);
  return w;
}
