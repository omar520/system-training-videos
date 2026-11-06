# Problems seen before, and their fixes

A failed run saves `error.png` in the chapter's `_work/chapters/<name>/` folder. Look at it first.

## The recording stops

| What happened | Cause and fix |
|---|---|
| `strict mode violation: resolved to N elements` | The locator matches several things. Often the data wasn't reset, so an item exists twice: set `reset`. Otherwise make the locator exact, or add `.first()` |
| Timeout on a locator after a save | The page refreshed. Add `await d.saved("Text")` or `await d.settle()` before the next action |
| A change disappears after saving | A refresh after the save overwrote it. Wait with `d.settle()` before changing anything else |
| Timeout on a toast text | The real wording differs. Wait for the changed row or value on the page instead |
| A name matches something else ("Board" and "Portfolio Board") | Use `exact: true`, or match by role inside a smaller area |
| Sign-in fails during `brand` | Fix `signIn` in the config. Check the labels in the running system |
| `Sync marker not found` | The first 60 s of the video had no magenta frame: `d.start()` must run early, before any long work |
| `The chapter's run() must end with d.end()` | Add it |
| A database or service fails between chapters | Local services can stop on their own. Check they're running, then run again. A failed reset is tried once automatically |

## A frame looks wrong

| What you see | Cause and fix |
|---|---|
| A loading placeholder on screen | `check` reports these. Use `after: 0` with `d.loaded()`, or `d.navAction()`. If the system's loader isn't detected, add it to `loadingExtra` |
| `check` says a loading state shows, but nothing is loading | A permanent pulsing dot or similar matches the list. Replace `loading` in the config with narrower selectors |
| Run takes 15 s longer at each page | Same cause: a "loading" element never goes away. The run prints a warning naming the page |
| A short callout (`check` reports under 2.5 s) | A cut shortened it. Mark the click that follows it `after: 0`, which holds the callout first |
| A callout covers a popup or the content | Choose another `side`, or `d.repoint()` into the popup |
| A callout is left pointing at something behind a popup | Start a new `say()` inside the popup |
| The counter covers a button | It moves to the bottom right by itself when clicks or callouts happen near the top right. Force it with `meta.counterCorner` |
| A drop-down never opens on camera | Native `<select>` lists are drawn by the operating system, so they don't appear. Use `d.pick()`, which shows the click and sets the value |
| The page jumps on click with no cursor | The element was off-screen. `d.click()` scrolls by itself; if an inner area scrolls, add `d.reveal(target)` first |
| Typing looks too fast or in bursts | Normal while recording. `d.keys()` sends 2 to 4 letters at a time and keeps the sound steady |
| Text looks small | Add `d.focus()` around it |
| A cookie banner or chat bubble on screen | Add it to `hideExtra` |
| Blurry page at the edges of a zoom | Lower `maxZoom`. Above about 1.9 the picture softens |

## Decisions already made, so don't try them again

| Don't | Because |
|---|---|
| Use `deviceScaleFactor` for a bigger recording | Playwright's video ignores it, and the result is a small picture in a grey frame |
| Use CSS zoom to enlarge the page | It puts the system's popups in the wrong place |
| Zoom with the browser | Zooms are made afterwards with ffmpeg's `perspective` filter, which is smooth and leaves the page undisturbed |
| Put a `.srt` next to a video | Players show it as running subtitles over the callouts. A copy stays in `_work` for reference |
| Add a running caption bar | Tested and rejected: callouts at the element teach better, and a bar covers the page |
| Rely on cuts alone to hide loading | Timing drifts, so placeholders leak through. The freeze is what guarantees it |
| Run recordings at the same time | Each one slows the others, and cursor and typing timing suffers |

## What the engine already handles

These cost real debugging, so don't remove them when changing the engine:

- **Native `<dialog>` and popovers** sit above every z-index. The overlay joins the browser's top layer and comes back to the front whenever one opens.
- **Full page reloads** wipe the overlay. The cursor and the freeze are kept in `sessionStorage` and redrawn at once on the new page. The overlay is injected before any page script runs.
- **A slow recording browser** makes typing four times slower, so `keys()` adapts its chunk size.
- **Callouts drifting** during a scroll: `say()` waits for the old one to fade first.
- **Long ffmpeg filters** don't fit on a command line, so they go through a file. The flag for that changed in ffmpeg 7, and `build` picks the right one.

## Changing the engine

The master copy is in the skill's `engine/` folder. After changing it, refresh a project with:

```bash
node ~/.claude/skills/system-training-videos/scripts/init.mjs <project folder> --update
```
