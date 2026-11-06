---
name: system-training-videos
description: Make a series of narrated-by-callout training videos for any web system, recorded from the running system with a slow cursor, click rings, arrow callouts, smooth zooms, a step counter, sound effects (clicks, typing, whooshes), chapter videos and one full video with chapter markers. The colours, fonts, corners and logo are read from the system itself, so every system gets its own look in the same proven layout. Use this whenever someone wants training videos, a video tour, a walkthrough, screen-recorded tutorials, how-to or onboarding videos for an app, portal, dashboard or internal system, even if they only say "make videos for this system", "record how it works", or "فيديوهات تدريب للنظام". Not for editing existing footage, marketing promos, or desktop apps.
---

# System training videos

Records real use of a web system and turns it into finished training videos: one short video per chapter, and one full video with chapter markers. There is no voice. Short callouts explain what is happening and why.

The method is fixed because each part solves a real recording problem. Only the look changes from one system to the next.

| Stays the same in every system | Comes from the system itself |
|---|---|
| 1920 × 1080 video, 30 frames a second, MP4 | Card and callout colours, read from its pages |
| Title card: logo, kicker, title, one line, colour band | Highlight, arrow and click-ring colour |
| Callout box with arrow, and a highlight on the element | Heading and body fonts, including web fonts |
| "Step n of N" counter in a corner | Corner roundness, from its buttons |
| Slow cursor, click rings, smooth zooms, jump cuts over loading | Logo |
| Sound effects, made in code | Light or dark callouts, by its background |
| Black chapter cards and markers in the full video | Language, and right-to-left text |

## Rules, and why they exist

- **A local copy with fictional data only.** The scripts click and save for real, and a video can be shared with anyone. The engine refuses non-local addresses. Only the system's owner may set `allowRemote: true`, and only for a test server that holds no real data. Never point it at a live system, and never show real people's names, emails or documents.
- **The application is not changed.** Everything lives in the project's `video-tour/` folder, which has its own packages. If a job can't be shown without changing the app, leave it out and report it.
- **Videos stay out of the repository.** They go to a folder outside it.
- **Follow the project's own rules.** Read its `CLAUDE.md` or similar first. If it says the owner runs git, don't run git. On a small machine, run one heavy job at a time.
- **Don't fake what the system can't do.** A job that depends on today's date, an outside service, or a feature with changing answers (a chatbot) is left out and reported. Any data prepared before recording is disclosed in the report.

## Step 1: Gather what you need, once

Look in the project first: README, `package.json`, docs, seed data, test accounts. Then ask for whatever is still missing in one list, and don't stop to ask again until the first still.

- How to start the system locally, and its address.
- How to reset the test data. Without a reset, chapters collide with each other's data.
- Test accounts, one for each role the videos need.
- Who the videos are for. This sets which jobs matter and the words on the cards.
- The language of the callouts. Default: the language of the system's screens.
- Where the videos should go. Default: a folder beside the project.

## Step 2: Learn the system, and plan the chapters

Read its routes, menu and any user documentation, and open the pages in the running system. Then write a chapter plan: one chapter for each area a person really works in, each built around jobs ("create an order and send it for approval"), not a tour of the screens. A chapter usually has 2 to 6 steps and runs 1 to 4 minutes. Start with a "Getting started" chapter. List what you plan to leave out, with the reason.

## Step 3: Set up, and read the system's look

```bash
node ~/.claude/skills/system-training-videos/scripts/init.mjs <project folder> --out "<video folder>"
cd <project folder>/video-tour && npm install && npx playwright install chromium
```

Fill in every `TODO` in `video-tour/tour.config.mjs`. Check the sign-in works by running the next command, which uses it:

```bash
node video-tour/tour.mjs brand
```

This visits the system, reads its look, writes `theme.json` and the logo, and saves four previews in `<video folder>/_work/brand/`: `title-card.png`, `chapter-card.png`, `callout.png` and `counter.png`. **Look at all four.** Colour detection is a good guess, not a fact, so judge them as a viewer would: does this look like the system? Is the right logo there? Is the heading in its real font? Correct anything with `theme` in the config, then run `brand` again. See `references/theme-and-config.md`.

## Step 4: Chapter 1, then one approval

Write chapter 1 (read `references/writing-chapters.md` first), then:

```bash
node video-tour/tour.mjs make 1
```

`make` resets the data, does a fast rehearsal, resets again, records, builds and checks. Look at the still and the contact sheet it prints.

Then stop, and show the owner the chapter plan, the jobs left out, and the still. This is the one approval. It's cheap to change the look or the plan now, and expensive after a full series. After the OK, finish the series without stopping.

## Step 5: The other chapters

For each chapter: write it, run `make`, and look at its contact sheet. `check` catches what can be measured: callouts on screen under 2.5 s, loading screens on camera, browser errors, sound levels. It can't see meaning, so read the frames yourself for:

- a callout on the wrong element, or cut off at the screen edge;
- a callout, counter or popup covering what the viewer needs to see;
- an error message, an empty page, or anything that isn't fictional;
- a zoom that cuts off what it should show.

If something is doubtful in the sheet, pull one full frame: `ffmpeg -ss 20 -i chapter.mp4 -frames:v 1 frame.png`.

If a chapter still fails after two rounds of fixes, skip it, report it, and go on. Problems seen before are in `references/troubleshooting.md`.

## Step 6: The full video

With all chapters built and the system running:

```bash
node video-tour/tour.mjs join
```

This writes `<name>-training.mp4` with an opening card, a black card before each chapter, a closing card, chapter markers, and `chapters.txt` ("00:00 Title" lines, ready for YouTube). Check the length and the markers:

```bash
ffprobe -v error -show_entries chapter=start_time:chapter_tags=title -of csv=p=0 <full video>
```

## Step 7: Report

Write for someone who isn't technical, in short sentences:

1. The path and length of every chapter and of the full video, in a table.
2. The folder with one still per chapter.
3. The chapter list with start times.
4. What was left out or skipped, and why.
5. Data prepared before recording, which the video doesn't show.
6. Small visual flaws you saw and accepted.
7. That you checked the sound by measuring it, not by hearing it, so a person should listen to one chapter before sharing.

Then stop the servers you started.

## Reference files

- `references/writing-chapters.md`: read before writing a chapter. Every action, the patterns that keep a video clean, and how to write callouts.
- `references/theme-and-config.md`: the settings, what `brand` reads, and how to correct the look.
- `references/troubleshooting.md`: read when a recording fails or a frame looks wrong.
