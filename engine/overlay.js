// Browser-side overlay for the training videos.
// Injected with addInitScript before any page script runs, after window.__tourTheme is set.
// It draws on top of the real system (cursor, click rings, title cards, callouts) and never
// changes the system itself. Everything sits in one fixed layer with pointer-events: none.
// All colours, fonts and corners come from window.__tourTheme (read from the system itself).
(() => {
  if (window.__tour) return;

  const T = window.__tourTheme || {};
  const C = {
    accent: T.accent || "#2563EB",
    cardBg: T.card?.bg || "#111827",
    cardTitle: T.card?.title || "#FFFFFF",
    cardText: T.card?.text || "#D1D5DB",
    kicker: T.card?.kicker || "#93C5FD",
    calloutBg: T.callout?.bg || "#111827",
    calloutText: T.callout?.text || "#FFFFFF",
    calloutEdge: T.callout?.edge || T.accent || "#2563EB",
    heading: T.fonts?.heading || "Georgia, serif",
    headingWeight: T.fonts?.headingWeight || 500,
    body: T.fonts?.body || "'Segoe UI', sans-serif",
    radius: T.radius ?? 10,
    band: T.band || [],
    logo: T.logoDataUrl || null,
    hide: T.hide || "",
    loading: T.loading || "",
  };

  const css = `
    ${C.hide ? `${C.hide} { display: none !important; }` : ""}
    #__tour { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
      width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0;
      border: 0; background: transparent; overflow: visible; }
    #__tour * { box-sizing: border-box; }
    #__tour .t-cursor { position: absolute; left: 0; top: 0; width: 32px; height: 32px;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    #__tour .t-ring { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px;
      border: 3px solid ${C.accent}; border-radius: 50%; opacity: .95;
      animation: t-ring .65s ease-out forwards; }
    @keyframes t-ring { to { transform: scale(3.4); opacity: 0; } }
    #__tour .t-fade { transition: opacity .3s ease; }
    #__tour .t-card { position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center; gap: 18px; }
    #__tour .t-card .logo { max-height: 96px; max-width: 420px; margin-bottom: 14px;
      border-radius: ${C.radius}px; }
    #__tour .t-card .l1 { font: ${C.headingWeight} 66px/1.15 ${C.heading}; color: ${C.cardTitle};
      max-width: 1600px; }
    #__tour .t-card .l2 { font: 400 30px/1.4 ${C.body}; color: ${C.cardText}; max-width: 1200px; }
    #__tour .t-card .kicker { font: 700 19px/1 ${C.body}; letter-spacing: .14em; color: ${C.kicker};
      text-transform: uppercase; }
    #__tour .t-band { position: absolute; left: 0; right: 0; bottom: 0; height: 22px; display: flex; }
    #__tour .t-band span { flex: 1; }
    #__tour .t-callout { position: absolute; max-width: 420px; padding: 14px 20px;
      border-radius: ${C.radius}px; background: ${C.calloutBg}; color: ${C.calloutText};
      font: 600 21px/1.35 ${C.body}; border-inline-start: 5px solid ${C.calloutEdge};
      box-shadow: 0 6px 18px rgba(0,0,0,.25); }
    #__tour .t-hl { position: absolute; border: 3px solid ${C.accent};
      border-radius: ${Math.max(4, C.radius - 1)}px; }
    #__tour svg.t-arrow { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; }
  `;

  // State that must survive a full page load (systems that reload on every link)
  const store = {
    get(k) {
      try {
        return sessionStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v == null) sessionStorage.removeItem(k);
        else sessionStorage.setItem(k, v);
      } catch {
        // Too large or not allowed: the cut in the video still hides the page load
      }
    },
  };

  let root = null;
  let cursor = null;
  let cursorPos = { x: 960, y: 540 };
  let cursorVisible = false;
  let card = null;
  let callout = null;
  let calloutEl = null;
  let calloutSide = "auto";
  let rafStarted = false;
  let frozenUrl = store.get("__tour_freeze");
  let leak = false;
  let lastLeakCheck = 0;
  let topLayers = 0;

  try {
    const s = JSON.parse(store.get("__tour_cursor") || "null");
    if (s) {
      cursorPos = s.pos;
      cursorVisible = s.visible;
    }
  } catch {
    // Start from the default position
  }
  const saveCursor = () =>
    store.set("__tour_cursor", JSON.stringify({ pos: cursorPos, visible: cursorVisible }));

  function drawFreeze() {
    if (!frozenUrl || !root || document.getElementById("__tour_freeze")) return null;
    const img = document.createElement("img");
    img.id = "__tour_freeze";
    img.src = frozenUrl;
    img.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;transition:opacity .25s ease;";
    root.appendChild(img);
    return img;
  }

  function ensure() {
    if (root && root.isConnected) return root;
    if (!document.body) return null;
    if (!document.getElementById("__tour_css")) {
      const st = document.createElement("style");
      st.id = "__tour_css";
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    }
    root = document.createElement("div");
    root.id = "__tour";
    root.setAttribute("popover", "manual");
    document.body.appendChild(root);
    raise();
    cursor = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    cursor.setAttribute("viewBox", "0 0 24 24");
    cursor.setAttribute("class", "t-cursor");
    cursor.innerHTML = `<path d="M3 2 L3 19.5 L7.6 15.4 L10.6 22 L13.6 20.7 L10.7 14.2 L17 14.2 Z" fill="${C.cardBg}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>`;
    cursor.style.display = cursorVisible ? "block" : "none";
    root.appendChild(cursor);
    placeCursor();
    drawFreeze();
    if (!rafStarted) {
      rafStarted = true;
      requestAnimationFrame(tick);
    }
    return root;
  }

  // A native <dialog> or popover sits in the browser's top layer, above every z-index. The
  // overlay joins that layer, and moves back to the front whenever another one opens.
  function raise() {
    try {
      if (root.matches(":popover-open")) root.hidePopover();
      root.showPopover();
    } catch {
      // Older browser: plain z-index still covers everything except native dialogs
    }
  }

  function topLayerCount() {
    return document.querySelectorAll("dialog:modal, [popover]:popover-open:not(#__tour)").length;
  }

  function placeCursor() {
    if (cursor) cursor.style.transform = `translate(${cursorPos.x - 3}px, ${cursorPos.y - 2}px)`;
  }

  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

  function rectOf(el, pad) {
    const r = el.getBoundingClientRect();
    return { x: r.left - pad, y: r.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad };
  }

  // An element that was removed or hidden (for example a Save button after saving) has no box
  function gone(el) {
    if (!el || !el.isConnected) return true;
    const r = el.getBoundingClientRect();
    return r.width === 0 && r.height === 0;
  }

  function layoutCallout() {
    if (!callout || !calloutEl) return;
    if (gone(calloutEl)) {
      callout.style.visibility = "hidden";
      return;
    }
    callout.style.visibility = "visible";
    const box = callout.querySelector(".t-callout");
    const hl = callout.querySelector(".t-hl");
    const svg = callout.querySelector("svg");
    const t = rectOf(calloutEl, 5);
    hl.style.left = t.x + "px";
    hl.style.top = t.y + "px";
    hl.style.width = t.w + "px";
    hl.style.height = t.h + "px";
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const gap = 46;
    const fits = {
      left: t.x - gap - bw > 12,
      right: t.x + t.w + gap + bw < W - 12,
      above: t.y - gap - bh > 12,
      below: t.y + t.h + gap + bh < H - 12,
    };
    let side = calloutSide;
    if (side === "auto" || !fits[side]) {
      // A target on the left (a menu) gets its callout on the right, over empty page space
      const order =
        t.x + t.w / 2 < W * 0.4
          ? ["right", "below", "above", "left"]
          : ["left", "below", "above", "right"];
      side = order.find((s) => fits[s]) || "below";
    }
    let bx;
    let by;
    if (side === "left" || side === "right") {
      bx = side === "left" ? t.x - gap - bw : t.x + t.w + gap;
      by = Math.min(Math.max(t.y + t.h / 2 - bh / 2, 12), H - bh - 12);
    } else {
      bx = Math.min(Math.max(t.x + t.w / 2 - bw / 2, 12), W - bw - 12);
      by = side === "above" ? t.y - gap - bh : t.y + t.h + gap;
    }
    box.style.left = bx + "px";
    box.style.top = by + "px";
    // Arrow from the box edge to the highlighted element's edge
    let x1, y1, x2, y2;
    if (side === "left") {
      x1 = bx + bw;
      y1 = by + bh / 2;
      x2 = t.x - 4;
      y2 = t.y + t.h / 2;
    } else if (side === "right") {
      x1 = bx;
      y1 = by + bh / 2;
      x2 = t.x + t.w + 4;
      y2 = t.y + t.h / 2;
    } else if (side === "above") {
      x1 = bx + bw / 2;
      y1 = by + bh;
      x2 = Math.min(Math.max(x1, t.x + 16), t.x + t.w - 16);
      y2 = t.y - 4;
    } else {
      x1 = bx + bw / 2;
      y1 = by;
      x2 = Math.min(Math.max(x1, t.x + 16), t.x + t.w - 16);
      y2 = t.y + t.h + 4;
    }
    const line = svg.querySelector("line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    callout.dataset.box = JSON.stringify({ x: bx, y: by, w: bw, h: bh });
  }

  /** Is a loading placeholder or spinner showing on the page right now? */
  function loadingNow() {
    if (!C.loading) return false;
    let els;
    try {
      els = document.querySelectorAll(C.loading);
    } catch {
      return false;
    }
    for (const el of els) {
      if (el.closest("#__tour")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < window.innerHeight) return true;
    }
    return false;
  }

  function tick(now) {
    if (!root || !root.isConnected) ensure();
    const layers = topLayerCount();
    if (layers !== topLayers) {
      topLayers = layers;
      raise();
    }
    layoutCallout();
    // Tell record.mjs when a loading state is on camera (not hidden by a freeze or a card)
    if (now - lastLeakCheck > 200) {
      lastLeakCheck = now;
      const covered = !!document.getElementById("__tour_freeze") || !!(card && card.isConnected);
      const on = !covered && loadingNow();
      if (on !== leak) {
        leak = on;
        console.debug(on ? "__tour:leak:on" : "__tour:leak:off");
      }
    }
    requestAnimationFrame(tick);
  }

  function fadeOut(el) {
    if (!el) return;
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 320);
  }

  function fadeIn(el) {
    el.classList.add("t-fade");
    el.style.opacity = "0";
    root.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => (el.style.opacity = "1")));
  }

  function line(cls, text) {
    const d = document.createElement("div");
    d.className = cls;
    d.dir = "auto"; // right-to-left text (Arabic) sets itself correctly
    d.textContent = text;
    return d;
  }

  window.__tour = {
    ready() {
      return !!ensure();
    },
    loading: loadingNow,
    showCursor(on, x, y) {
      ensure();
      cursorVisible = on;
      if (x != null) cursorPos = { x, y };
      cursor.style.display = on ? "block" : "none";
      placeCursor();
      saveCursor();
    },
    moveCursor(x, y, ms) {
      ensure();
      const from = { ...cursorPos };
      const start = performance.now();
      return new Promise((resolve) => {
        function step(now) {
          const u = Math.min(1, (now - start) / ms);
          const e = ease(u);
          cursorPos = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
          placeCursor();
          if (u < 1) requestAnimationFrame(step);
          else {
            saveCursor();
            resolve();
          }
        }
        requestAnimationFrame(step);
      });
    },
    ring(x, y) {
      ensure();
      const r = document.createElement("div");
      r.className = "t-ring";
      r.style.left = x + "px";
      r.style.top = y + "px";
      root.insertBefore(r, cursor);
      setTimeout(() => r.remove(), 700);
    },
    card(opts) {
      ensure();
      fadeOut(card);
      card = null;
      if (!opts) return;
      const el = document.createElement("div");
      el.className = "t-card";
      el.style.background = opts.bg || C.cardBg;
      if (opts.brand && C.logo) {
        const img = document.createElement("img");
        img.className = "logo";
        img.src = C.logo;
        el.appendChild(img);
      }
      if (opts.kicker) el.appendChild(line("kicker", opts.kicker));
      el.appendChild(line("l1", opts.line1 || ""));
      if (opts.line2) el.appendChild(line("l2", opts.line2));
      if (opts.brand && C.band.length) {
        const band = document.createElement("div");
        band.className = "t-band";
        for (const bg of C.band) {
          const s = document.createElement("span");
          s.style.background = bg;
          band.appendChild(s);
        }
        el.appendChild(band);
      }
      if (opts.instant) {
        root.insertBefore(el, cursor);
      } else {
        fadeIn(el);
        root.insertBefore(el, cursor);
      }
      card = el;
    },
    // Freeze: lay a screenshot of the page over everything while the next page loads.
    // It is kept in sessionStorage, so it comes back at once after a full page load.
    freeze(dataUrl) {
      ensure();
      document.getElementById("__tour_freeze")?.remove();
      frozenUrl = dataUrl;
      store.set("__tour_freeze", dataUrl);
      const img = drawFreeze();
      return new Promise((r) => (img.complete ? r() : (img.onload = () => r())));
    },
    unfreeze() {
      frozenUrl = null;
      store.set("__tour_freeze", null);
      const img = document.getElementById("__tour_freeze");
      if (!img) return;
      img.style.opacity = "0";
      setTimeout(() => img.remove(), 300);
    },
    marker(on) {
      ensure();
      let m = document.getElementById("__tour_marker");
      if (on && !m) {
        m = document.createElement("div");
        m.id = "__tour_marker";
        m.style.cssText = "position:absolute;inset:0;background:#FF00FF;";
        root.appendChild(m);
      } else if (!on && m) {
        m.remove();
      }
    },
    callout(el, text, side) {
      ensure();
      if (callout) fadeOut(callout);
      callout = null;
      calloutEl = null;
      if (!el) return null;
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:absolute;inset:0;";
      wrap.innerHTML =
        `<svg class="t-arrow"><defs><marker id="t-ah" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${C.accent}"/></marker></defs>` +
        `<line stroke="${C.accent}" stroke-width="3" marker-end="url(#t-ah)"/></svg><div class="t-hl"></div><div class="t-callout" dir="auto"></div>`;
      wrap.querySelector(".t-callout").textContent = text;
      calloutEl = el;
      calloutSide = side || "auto";
      fadeIn(wrap);
      root.insertBefore(wrap, cursor);
      callout = wrap;
      layoutCallout();
      const box = JSON.parse(wrap.dataset.box || "null");
      return { box, target: rectOf(el, 5) };
    },
  };

  const boot = () => ensure();
  if (frozenUrl && document.documentElement && !document.body) {
    // A page is loading under a freeze: draw it the moment <body> exists, before the first paint
    const mo = new MutationObserver(() => {
      if (document.body) {
        mo.disconnect();
        ensure();
      }
    });
    mo.observe(document.documentElement, { childList: true });
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
