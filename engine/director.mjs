// Node-side "director": drives the page slowly and visibly, and records a timeline of every
// callout, card, zoom, step and sound, so build.mjs can cut the video, apply the zooms and
// mix the sound effects.
// Times in the timeline are milliseconds after the sync marker (a magenta frame shown at the
// very start of the recording, found again in the video by build.mjs).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimum time a callout stays up: at least 2.6 s, longer for longer lines. */
export function minCaptionMs(text) {
  const words = text.trim().split(/\s+/).length;
  return Math.max(2600, 700 + words * 260);
}

export class Director {
  /**
   * @param meta { kicker, title, line, endKicker, endTitle, endLine }: opening title and end card
   * @param config the project's tour.config.mjs
   */
  constructor(page, { rehearsal = false, meta, config } = {}) {
    this.page = page;
    this.rehearsal = rehearsal;
    this.meta = meta;
    this.config = config;
    this.t0 = Date.now();
    this.events = [];
    this.cap = null; // { text, start }
    this.counter = null;
    this.zoomOpen = null;
    this.warnings = [];
    this.leakOpen = null;
    // overlay.js reports when a loading state shows on camera
    page.on("console", (m) => {
      const t = m.text();
      if (t === "__tour:leak:on" && this.leakOpen == null) this.leakOpen = this.now();
      if (t === "__tour:leak:off") this.closeLeak();
    });
  }

  closeLeak() {
    if (this.leakOpen == null) return;
    this.events.push({ type: "leak", start: this.leakOpen, end: this.now() });
    this.leakOpen = null;
  }

  now() {
    return Date.now() - this.t0;
  }

  wait(ms) {
    return sleep(this.rehearsal ? Math.min(ms, 400) : ms);
  }

  /** A sound effect at this moment (mixed in by build.mjs). */
  sfx(kind, extra = {}) {
    this.events.push({ type: "sfx", kind, start: this.now(), ...extra });
  }

  async tour(fn, ...args) {
    return this.page.evaluate(([name, a]) => window.__tour[name](...a), [fn, args]);
  }

  // ---- opening and closing -------------------------------------------------

  async start() {
    const m = this.meta;
    await this.page.waitForFunction(() => window.__tour && window.__tour.ready());
    await this.tour("card", { line1: "", instant: true });
    await this.wait(400);
    await this.tour("marker", true);
    this.t0 = Date.now();
    await sleep(600);
    await this.tour("marker", false);
    // Opening title, 3 seconds, in the system's colours with its logo and colour band
    const titleStart = this.now();
    await this.tour("card", {
      kicker: m.kicker,
      line1: m.title,
      line2: m.line,
      brand: true,
      instant: true,
    });
    this.sfx("chime");
    await this.wait(3000);
    this.events.push({
      type: "title",
      text: `${m.title}\n${m.line}`,
      start: titleStart,
      end: this.now(),
    });
    await this.tour("card", null);
    await this.tour("showCursor", true, 960, 540);
    await this.wait(500);
  }

  async end() {
    await this.unfreeze();
    const m = this.meta;
    await this.endSay();
    await this.unfocus();
    if (this.counter) {
      this.counter.end = this.now();
      this.counter = null;
    }
    await this.wait(400);
    await this.tour("showCursor", false);
    const s = this.now();
    await this.tour("card", {
      kicker: m.endKicker || "Done",
      line1: m.endTitle,
      line2: m.endLine || "",
      brand: true,
    });
    this.sfx("chime", { soft: true });
    await this.wait(2300);
    this.events.push({
      type: "endcard",
      text: `${m.endTitle}\n${m.endLine || ""}`,
      start: s,
      end: this.now(),
    });
    this.closeLeak();
    this.events.push({ type: "stop", start: this.now() });
  }

  // ---- steps ---------------------------------------------------------------

  async step(n, total, title) {
    await this.endSay();
    await this.unfocus();
    if (this.counter) this.counter.end = this.now();
    this.counter = { type: "counter", n, total, title, start: this.now(), end: null };
    this.events.push(this.counter);
    this.sfx("tick");
  }

  // ---- callouts ------------------------------------------------------------

  async holdCaption() {
    if (!this.cap) return;
    const left = minCaptionMs(this.cap.text) - (this.now() - this.cap.start);
    if (left > 0) await this.wait(left);
  }

  /** Show an explanation: a callout with an arrow, at the element it talks about. */
  async say(text, target, { side } = {}) {
    await this.unfreeze();
    await this.holdCaption();
    // Let the old callout finish fading before anything scrolls, so it never drifts
    const hadCaption = !!this.cap;
    await this.endSay();
    if (hadCaption) await this.wait(330);
    await this.noSkeleton();
    if (target) await this.reveal(target);
    const start = this.now();
    const handle = target ? await target.elementHandle() : null;
    const placed = await this.page.evaluate(
      ([el, t, sd]) => window.__tour.callout(el, t, sd),
      [handle, text, side || "auto"],
    );
    if (placed?.box) this.events.push({ type: "spot", ...placed.box, start });
    this.sfx("pop");
    this.cap = { text, start };
    await this.wait(300);
  }

  async endSay() {
    if (!this.cap) return;
    await this.holdCaption();
    await this.tour("callout", null);
    this.events.push({
      type: "caption",
      text: this.cap.text,
      start: this.cap.start,
      end: this.now(),
    });
    this.cap = null;
  }

  /** Point the current callout at another element, without a new text. */
  async repoint(target, { side } = {}) {
    if (!this.cap) return;
    await this.reveal(target);
    const handle = await target.elementHandle();
    await this.page.evaluate(
      ([el, t, sd]) => window.__tour.callout(el, t, sd),
      [handle, this.cap.text, side || "auto"],
    );
    this.sfx("pop", { soft: true });
  }

  // ---- zoom (recorded as events, applied by ffmpeg in build.mjs) -------------

  async focus(targets, { pad = 36, maxZoom = 1.9 } = {}) {
    if (this.zoomOpen) await this.unfocus();
    const rects = [];
    for (const t of targets) {
      const b = await t.boundingBox();
      if (b) rects.push(b);
    }
    const box = await this.page.evaluate(() => {
      const el = document.querySelector("#__tour .t-callout");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    if (box) rects.push(box);
    if (!rects.length) return;
    const x1 = Math.min(...rects.map((r) => r.x)) - pad;
    const y1 = Math.min(...rects.map((r) => r.y)) - pad;
    const x2 = Math.max(...rects.map((r) => r.x + r.width)) + pad;
    const y2 = Math.max(...rects.map((r) => r.y + r.height)) + pad;
    this.zoomOpen = {
      type: "zoom",
      rect: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 },
      maxZoom,
      start: this.now(),
      end: null,
    };
    this.events.push(this.zoomOpen);
    this.sfx("whooshIn");
    await this.wait(700); // the zoom-in happens now
  }

  async unfocus() {
    if (!this.zoomOpen) return;
    await this.wait(200);
    this.zoomOpen.end = this.now();
    this.zoomOpen = null;
    this.sfx("whooshOut");
    await this.wait(700); // the zoom-out happens now
  }

  // ---- cursor and actions --------------------------------------------------

  /** Scroll the element into the middle of its scroll area smoothly, if it is not fully visible. */
  async reveal(target) {
    await target.waitFor({ state: "visible" });
    const moved = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // Inside a dialog or panel, check against that scroll area
      let area = el.parentElement;
      while (area && area !== document.body) {
        const s = getComputedStyle(area);
        if (/(auto|scroll)/.test(s.overflowY) && area.scrollHeight > area.clientHeight + 2) break;
        area = area.parentElement;
      }
      let top = 0;
      let bottom = vh;
      if (area && area !== document.body) {
        const ar = area.getBoundingClientRect();
        top = ar.top;
        bottom = ar.bottom;
      }
      if (r.top >= top + 8 && r.bottom <= bottom - 8) return false;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    });
    if (moved) {
      this.sfx("swish");
      await this.wait(650);
    }
  }

  /** Scroll back to the top, smoothly, whichever area of the page scrolls. */
  async scrollTop() {
    const moved = await this.page.evaluate(() => {
      const areas = [...document.querySelectorAll("html, body, body *")].filter(
        (e) => e.scrollTop > 4 && !e.closest("#__tour"),
      );
      areas.forEach((e) => e.scrollTo({ top: 0, behavior: "smooth" }));
      return areas.length > 0;
    });
    if (!moved) return;
    this.sfx("swish");
    await this.wait(700);
  }

  async moveTo(target, { dx = 0, dy = 0 } = {}) {
    await this.unfreeze();
    await this.reveal(target);
    const b = await target.boundingBox();
    if (!b) throw new Error("No bounding box for target");
    const x = Math.round(b.x + Math.min(b.width / 2, 60) + dx);
    const y = Math.round(b.y + b.height / 2 + dy);
    this.events.push({ type: "spot", x, y, w: 1, h: 1, start: this.now() });
    const from = await this.page.evaluate(() => {
      const c = document.querySelector("#__tour .t-cursor");
      const m = c && /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(c.style.transform);
      return m ? { x: +m[1] + 3, y: +m[2] + 2 } : { x: 760, y: 470 };
    });
    const dist = Math.hypot(x - from.x, y - from.y);
    const ms = this.rehearsal ? 50 : Math.round(Math.min(850, 380 + dist * 0.45));
    await this.page.evaluate(([a, b2, c]) => window.__tour.moveCursor(a, b2, c), [x, y, ms]);
    await this.page.mouse.move(x, y, { steps: 4 });
    return { x, y };
  }

  /**
   * after: 0 marks a click that opens a page or saves. The callout showing now gets its full
   * time first, and the screen freezes, because the page changes (and is cut) right after.
   */
  async click(target, { after = 300 } = {}) {
    if (after === 0 && this.cap) {
      const left = 2700 - (this.now() - this.cap.start);
      if (left > 0) await this.wait(left);
    }
    const { x, y } = await this.moveTo(target);
    await this.wait(160);
    await this.tour("ring", x, y);
    if (after === 0 && !this.rehearsal) await this.freeze();
    this.sfx("click");
    this.urlAtClick = this.page.url();
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
    this.lastClick = this.now();
    await this.wait(after);
  }

  /** Type text visibly, with a key sound for each letter. */
  async keys(text) {
    // While video is recorded, each browser call is slow. When a call takes long, the next
    // one sends 2 to 4 letters at once, so typing keeps a natural pace. Each letter still
    // gets its own key sound, spaced 45 ms apart.
    let chunk = 1;
    let i = 0;
    while (i < text.length) {
      if (text[i] === "\n") {
        this.sfx("key", { big: true });
        await this.page.keyboard.press("Enter");
        i += 1;
        continue;
      }
      let part = text.slice(i, i + chunk);
      const nl = part.indexOf("\n");
      if (nl > 0) part = part.slice(0, nl);
      const t0 = this.now();
      for (let k = 0; k < part.length; k++)
        this.events.push({ type: "sfx", kind: "key", start: t0 + k * 45 });
      const started = Date.now();
      await this.page.keyboard.insertText(part);
      const took = Date.now() - started;
      if (took > 110) chunk = Math.min(4, chunk + 1);
      else if (took < 45 && chunk > 1) chunk -= 1;
      i += part.length;
      await sleep(this.rehearsal ? 0 : Math.max(15, part.length * 45 - took));
    }
  }

  async type(target, text, { clear = false } = {}) {
    await this.click(target, { after: 150 });
    if (clear) {
      await this.page.keyboard.press("Control+A");
      this.sfx("key", { big: true });
      await this.page.keyboard.press("Backspace");
      await this.wait(150);
    }
    await this.keys(text);
    await this.wait(300);
  }

  /** After a save, the system may refresh the page; wait for that before the next action. */
  async settle(ms = 1500) {
    await sleep(ms);
    await this.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await sleep(300);
  }

  /**
   * After a click that opens another page: wait until it has loaded, and mark the wait as a
   * cut, so the finished video jumps from the click to the loaded page.
   * sameUrl: the view changes without the address changing (a tab, a single-page view).
   */
  async loaded(locator, ms = 600, { sameUrl = false } = {}) {
    const s = this.lastClick ?? this.now();
    // Wait for the new page to take over (the address changes), then for its loading to clear.
    // Without this, the old page can still match the locator.
    if (!sameUrl && this.urlAtClick && this.page.url() === this.urlAtClick) {
      await this.page
        .waitForURL((u) => u.toString() !== this.urlAtClick, { timeout: 10000 })
        .catch(() => {});
    }
    this.urlAtClick = null;
    await sleep(350);
    await this.noSkeleton();
    await locator.first().waitFor();
    await this.noSkeleton();
    await this.settle(ms);
    await this.noSkeleton();
    const e = this.now();
    // The still covers the whole wait, so the cut can be generous on both sides
    if (e - s > 1200) this.events.push({ type: "cut", start: s + 500, end: e - 300 });
    await this.unfreeze();
  }

  /** Show a still of the current screen over the page (hides the next page's loading). */
  async freeze() {
    await sleep(120); // let the click ring show in the still
    const shot = await this.page.screenshot({ type: "jpeg", quality: 85 });
    await this.page.evaluate(
      (u) => window.__tour.freeze(u),
      "data:image/jpeg;base64," + shot.toString("base64"),
    );
    this.frozen = true;
  }

  async unfreeze() {
    if (!this.frozen) return;
    this.frozen = false;
    await this.page.evaluate(() => window.__tour && window.__tour.unfreeze()).catch(() => {});
    await sleep(300);
  }

  /** Wait until no loading placeholder or spinner is left on the page. */
  async noSkeleton() {
    for (let tries = 0; tries < 3; tries++) {
      try {
        await this.page.waitForFunction(() => window.__tour && !window.__tour.loading(), null, {
          timeout: 15000,
        });
        return;
      } catch (e) {
        // A page load during the wait ends it early: look again
        if (/timeout/i.test(e.message)) {
          this.warnings.push(
            `A "loading" element stayed on ${this.page.url()} for 15 s. If it is not a real ` +
              "loading state, narrow `loading` in tour.config.mjs.",
          );
          return;
        }
      }
    }
  }

  /** An action that reloads the page (a search, a filter, going back): freeze, act, wait. */
  async navAction(fn, ready, ms = 600) {
    const url = this.page.url();
    if (!this.rehearsal) await this.freeze();
    this.lastClick = this.now();
    this.urlAtClick = url;
    await fn();
    await this.loaded(ready, ms);
  }

  /** Wait for a confirmation message (toast), then for the refresh that follows a save. */
  async saved(text) {
    await this.unfreeze();
    await this.page
      .locator(this.config.toast.join(","), { hasText: text })
      .or(this.page.getByText(text))
      .first()
      .waitFor();
    await this.settle();
  }

  /** Fill a field that can't be typed into letter by letter (dates), with key sounds. */
  async fill(target, value) {
    await this.click(target, { after: 150 });
    for (let i = 0; i < Math.min(8, value.length); i++) {
      this.sfx("key");
      await sleep(this.rehearsal ? 0 : 45);
    }
    await target.fill(value);
    await this.wait(300);
  }

  /** Press one key (Enter, Escape, Tab ...) with its sound. */
  async press(key) {
    this.sfx("key", { big: true });
    await this.page.keyboard.press(key);
    await this.wait(250);
  }

  /** A custom drop-down drawn by the system: open it and pick an option, on screen. */
  async choose(trigger, optionName) {
    await this.click(trigger, { after: 350 });
    const option = this.page.getByRole("option", { name: optionName, exact: true });
    await option.waitFor({ state: "visible" });
    await option.scrollIntoViewIfNeeded();
    await this.wait(150);
    await this.click(option, { after: 400 });
  }

  /**
   * A native <select>: its open list is drawn by the operating system, not the page, so it
   * never shows in a recording. Show the click on it, then set the option whose text matches.
   */
  async pick(select, match) {
    const { x, y } = await this.moveTo(select);
    await this.wait(160);
    await this.tour("ring", x, y);
    this.sfx("click");
    const value = await select.evaluate((el, m) => {
      const re = new RegExp(m, "i");
      const o = [...el.options].find((op) => re.test(op.textContent || ""));
      return o ? o.value : null;
    }, match);
    if (value == null) throw new Error(`No option matching ${match}`);
    await this.wait(250);
    await select.selectOption(value);
    await this.wait(450);
  }

  /** Click a button that opens the file picker, and give it a fictional file. */
  async upload(button, filePath) {
    const chooser = this.page.waitForEvent("filechooser");
    await this.click(button, { after: 100 });
    const fc = await chooser;
    await fc.setFiles(filePath);
    await this.wait(500);
  }

  /** Sign in on screen, with the system's own form. Password fields show dots only. */
  async signIn(accountKey) {
    const c = this.config;
    const account = c.accounts[accountKey || c.defaultAccount];
    await c.signIn(
      {
        page: this.page,
        type: (loc, text) => this.type(loc, text),
        click: (loc) => this.click(loc, { after: 0 }),
      },
      account,
    );
    this.lastClick = this.lastClick ?? this.now();
    this.urlAtClick = null;
    await this.loaded(this.page.locator("body"), 600, { sameUrl: true });
  }

  /** Sign out, then sign in as another test account, on screen. */
  async switchUser(accountKey) {
    await this.endSay();
    await this.unfocus();
    await this.config.signOut({
      page: this.page,
      click: (loc) => this.click(loc, { after: 200 }),
    });
    await this.signIn(accountKey);
  }

  /** Navigate with the system's menu: open a group if needed, then click the link. */
  async nav(group, link) {
    const page = this.page;
    const l = page.getByRole("link", { name: link, exact: true }).first();
    if (group && !(await l.isVisible().catch(() => false))) {
      await this.click(page.getByRole("button", { name: group, exact: true }), { after: 400 });
    }
    await this.click(l, { after: 0 });
  }
}
