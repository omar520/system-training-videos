# Writing a chapter

A chapter is one file in `video-tour/chapters/`, named `NN-short-name.mjs`. The number sets the order and the name sets the output file. `chapters/01-getting-started.mjs` is an example to copy.

```js
export const meta = {
  title: "Requests",                     // title card and chapter marker
  line: "Send a request and follow it.", // one line under the title
  endTitle: "You can send and approve requests.",
  // startPath: "/requests",   where the chapter opens (default: homePath)
  // signedIn: false,          start signed out, then call d.signIn()
  // account: "manager",       start as another test account
  // counterCorner: "bottom-right",  normally chosen automatically
  // async setup(page) {},     data the chapter needs, made through the system, before recording
};

const TOTAL = 3;

export async function run(d, { page, main }) {
  await d.start();
  await d.step(1, TOTAL, "Send a request");
  // ...
  await d.end();
}
```

`d` is the director. `page` is a Playwright page. `main` is the page's `<main>` element. Every run starts with `d.start()` and ends with `d.end()`.

## Writing callouts

A callout says **why**, not just what. The viewer can already see that a button exists.

- Weak: "Click the Save button."
- Strong: "Saving sends it to your lead for approval."

Keep each to about 12 words, in plain language, with one idea. `say()` holds it on screen long enough to read, at least 2.6 s. Keep the writing consistent with the words on the system's own screens.

When a chapter must change account, say so in a callout, so the viewer isn't lost.

## Actions

| Call | What it does |
|---|---|
| `d.step(n, total, title)` | Starts a step: the counter changes |
| `d.say(text, target, { side })` | Callout with arrow and highlight. `side`: `left`, `right`, `above`, `below`, or leave it out for automatic |
| `d.repoint(target, { side })` | Moves the current callout to another element, keeping its text |
| `d.focus([targets], { maxZoom })` | Smooth zoom on the targets and the callout. Use 1.4 to 1.9 |
| `d.unfocus()` | Zooms back out |
| `d.wait(ms)` | Holds, so the viewer can look |
| `d.moveTo(target)` | Moves the cursor without clicking |
| `d.click(target, { after })` | Moves, shows the ring, clicks with a sound, then waits `after` ms |
| `d.type(target, text, { clear })` | Clicks and types with key sounds. `clear: true` empties it first |
| `d.keys(text)` | Types into the field that already has focus |
| `d.press("Enter")` | One key, with its sound |
| `d.fill(target, value)` | For fields that can't be typed into letter by letter, like dates |
| `d.pick(select, "regex")` | A native `<select>` |
| `d.choose(trigger, "Option")` | A custom drop-down with `role="option"` items |
| `d.upload(button, file)` | Gives the file picker a fictional file |
| `d.loaded(locator, ms, { sameUrl })` | After a click marked `after: 0`: waits for the new view, cuts the wait |
| `d.navAction(fn, ready)` | Something that reloads without a click: freezes, runs `fn`, waits, cuts |
| `d.saved("Text")` | Waits for the confirmation message, then for any refresh |
| `d.settle(ms)` | Waits until the page goes quiet |
| `d.reveal(target)`, `d.scrollTop()` | Smooth scrolling, with a soft sound |
| `d.signIn(account)` | Signs in on screen with `signIn` from the config |
| `d.switchUser(account)` | Signs out and in again as another test account, on screen |
| `d.nav(group, link)` | Opens a menu group if needed, clicks the link. Follow with `d.loaded()` |

For uploads, use fictional files made by the engine, never real ones:

```js
import { assets } from "../engine/assets.mjs";

const { photo, pdf } = await assets();
await d.upload(button, photo);                 // a plain silhouette
await d.upload(button, pdf("Plan (sample)"));  // a one-page PDF
```

## The three patterns that keep a video clean

**1. A click that opens a page or saves: `after: 0`, then `loaded()`.** This is the most important pattern. `after: 0` gives the current callout its full time, then lays a still of the screen over the page. `loaded()` waits behind that still and marks the wait as a cut, so the viewer never sees loading.

```js
await d.say("Reports show this month's numbers.", link, { side: "right" });
await d.click(link, { after: 0 });
await d.loaded(page.getByRole("heading", { level: 1, name: "Reports" }), 700);
```

Wait for something that exists only on the new view. If the view changes without the address changing (tabs, a single-page view), pass `{ sameUrl: true }`, or it waits 10 s for an address that never changes.

**2. Popups: wait for them, then point inside them.** Opening a popup isn't a page load, so use a normal `after`:

```js
await d.click(add, { after: 500 });
const name = page.getByLabel("Name");
await d.say("Use a name your team will recognise.", name, { side: "right" });
```

A callout left pointing at something behind a popup looks wrong, so start a new `say()` inside the popup straight away.

**3. Zoom on small things.** Text at 1920 wide is small on a phone or a shared screen. Zoom in on anything the viewer must read, after the callout appears so both fit. Always `unfocus()` before moving elsewhere.

```js
await d.say("The status shows who acts next.", badge, { side: "right" });
await d.focus([badge], { maxZoom: 1.7 });
await d.wait(1200);
await d.unfocus();
```

## Finding elements

Prefer what the viewer reads: `getByRole("button", { name: "Save" })`, `getByLabel("Email")`. Add `exact: true` when one name contains another ("Board" also matches "Portfolio Board"). A table row: `page.getByRole("row").filter({ hasText: "Sample name" })`.

Elements are checked when used, so when a script fails, `error.png` in the chapter's `_work` folder shows the screen at that moment.

## Data for a chapter

Each recording starts from reset data, so a chapter can't rely on what an earlier chapter created. If it needs something to exist:

- Best: use the system's own test data, or create the thing on screen as part of the job.
- Otherwise: make it in `meta.setup(page)`, through the system's pages, and disclose it in the report.

Use fictional names that are clearly samples, and values that don't look like anyone's real details.
