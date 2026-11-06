# Settings and the system's look

## tour.config.mjs

| Setting | Meaning |
|---|---|
| `system` | The system's name, on the cards |
| `seriesTitle`, `seriesLine`, `closingLine` | Words on the opening and closing cards |
| `fileName` | Name of the full video. Default: from `system` |
| `baseURL` | Address of the local copy |
| `allowRemote` | `true` allows a non-local address. Owner's decision only, for fictional data only |
| `outputDir` | Where videos go, relative to `video-tour/`. Keep it outside the repository |
| `reset` | Shell command or async function that restores clean test data. Runs before every recording. A failed reset is tried once more. `--no-reset` skips it |
| `publicPath` | A page that opens without signing in |
| `homePath` | First page after signing in |
| `signInPath` | Where the sign-in form is, if not `publicPath` |
| `brandPages` | Pages `brand` reads. Choose ones rich in the system's look: menu, tables, buttons, badges |
| `accounts`, `defaultAccount` | Test accounts. Never real ones |
| `signIn`, `signOut` | How to sign in and out. Use only the given `type()` and `click()`, so the same code works on and off camera |
| `loadingExtra` | More selectors for loading placeholders and spinners |
| `toastExtra` | More selectors for confirmation messages |
| `hideExtra` | More things to hide on camera: cookie banners, chat widgets, debug bars |
| `theme` | Corrections to the look; these win over what `brand` read |

The built-in lists cover Tailwind, MUI, Ant Design, Vuetify, Sonner and Toastify, and hide the developer tools of Next.js, webpack, Vite, Django and Laravel. To replace a list instead of adding to it, set `loading`, `toast` or `hide` directly.

If a sign-in uses single sign-on or a code by email, the local copy needs a test sign-in route. If it has none, ask the owner. Don't weaken the app to get one.

## What `brand` reads

It opens `publicPath` and each of `brandPages` at 1920 × 1080 and collects:

- **Colours**: CSS variables named like `--primary`, `--brand`, `--accent`; button backgrounds (leaving out delete and cancel buttons); the menu's surfaces; link colours; and the most common colours in a picture of the page, which catches gradients and images. Modern formats (`oklch`, `lab`, shadcn's bare numbers) are converted.
- **Fonts**: the real heading and body fonts, including web fonts.
- **Corners**: the usual roundness of its buttons.
- **Logo**: the first image or SVG that looks like one, with a little of its own background, saved as `theme-logo.png`.

It then decides:

| In `theme.json` | Rule |
|---|---|
| `card.bg` | A dark surface the system really uses, else a deep shade of its brand colour |
| `accent` | The brand colour. If that is the card colour itself, the next colour used on buttons or links, never a status badge colour. Adjusted to reach 3:1 contrast with the page |
| `callout.bg`, `callout.text` | The card colour on a light system. On a dark system, where that would blend in, a light surface |
| `card.text`, `card.kicker` | Tints of the card and accent colours, adjusted to be readable |
| `band` | The accent, other strong colours the system uses, then tints of the accent |
| `chapterCardBg` | Black, as the pause between chapters |
| `fonts`, `radius` | As read |

`brand` prints a `WARNING` for any pair of colours a viewer would struggle to read.

## Correcting the look

`theme.json` is rewritten by every `brand` run, so corrections go in the config:

```js
theme: {
  accent: "#0F766E",
  card: { bg: "#102A43" },
  callout: { bg: "#102A43", text: "#FFFFFF" },
  fonts: { heading: "'Playfair Display', serif" },
  radius: 4,
  band: ["#0F766E", "#14B8A6", "#FBBF24"],
  chapterCardBg: "#0B1220",
  useLogo: false,
},
```

Common corrections:

- **Wrong logo, or a poor crop**: replace `theme-logo.png` by hand with a clean export after `brand`, or set `useLogo: false`.
- **Accent is a status colour**: the system uses red or green heavily. Set `accent` to the real brand colour.
- **A black-and-white system**: it may have no brand colour at all. A plain dark card with a dark highlight is honest to the system; set `accent` only if the owner wants one.
- **Fonts fall back on the cards**: the font loads only on some pages. Add such a page to `brandPages` and set `homePath` to one that loads it.

After a redesign of the system, run `brand` again and re-make the chapters.
