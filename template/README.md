# Training videos

Scripts that record this system's training videos. They drive a local copy of the system, draw the teaching layer on top of the page (slow cursor, click rings, callouts with arrows, title cards), and finish each video with ffmpeg (cuts, zooms, step counter, sound effects).

They never change the system. The finished videos are written outside the repository, to the folder set in `tour.config.mjs`.

| File | What it is |
|---|---|
| `tour.config.mjs` | This system's settings: address, test accounts, sign-in |
| `theme.json`, `theme-logo.png` | The look, read from the system by `brand`. Run it again after a redesign |
| `chapters/` | One script per chapter. The file name gives the number |
| `tour.mjs` | The one command to run |
| `engine/` | The recording and video code. Same in every project: change it in the skill, not here |

## How to make the videos again

Start the system with its test data, then from the project folder:

```
cd video-tour && npm install && npx playwright install chromium && cd ..
node video-tour/tour.mjs brand
node video-tour/tour.mjs record 1 --rehearsal
node video-tour/tour.mjs make 1
node video-tour/tour.mjs join
```

Reset the test data before each chapter, so every chapter starts from the same state.
