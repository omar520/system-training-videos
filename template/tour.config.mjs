// Settings for this system's training videos. Replace every value marked TODO.
export default {
  system: "TODO System name", // shown on the cards
  seriesTitle: "Training for administrators", // TODO who the series is for
  seriesLine: "From signing in to the reports.", // TODO one line for the opening card
  closingLine: "You have seen the whole system.",

  // A local copy with fictional test data. Other addresses are refused unless allowRemote: true.
  baseURL: "http://localhost:3000", // TODO
  outputDir: "__OUTPUT_DIR__", // outside the repository: videos are never committed

  // Runs before every recording, from the project folder, so each chapter starts from clean
  // data. A shell command, or an async function
  reset: "npm run db:reset", // TODO

  publicPath: "/login", // TODO a page that opens without signing in
  homePath: "/", // TODO the first page after signing in
  // TODO pages with the most of the system's look: menu, tables, buttons, badges
  brandPages: ["/"],

  accounts: {
    // TODO test accounts only. Read from the environment if the password is not already public
    admin: { email: "test.admin@example.com", password: process.env.TOUR_PASSWORD },
  },
  defaultAccount: "admin",

  // Works both off camera (instant) and on camera (visible typing). Use only type() and click().
  signIn: async ({ page, type, click }, account) => {
    await type(page.getByLabel("Email"), account.email); // TODO the system's own labels
    await type(page.getByLabel("Password"), account.password);
    await click(page.getByRole("button", { name: "Sign in" }));
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 120000 });
  },
  // Needed only if a chapter uses d.switchUser()
  signOut: async ({ page, click }) => {
    await click(page.getByRole("button", { name: "Sign out" }));
  },

  // Optional additions to the built-in lists (see references/theme-and-config.md)
  // loadingExtra: [".my-loader"],
  // toastExtra: [".my-toast"],
  // hideExtra: [".cookie-banner", ".chat-widget"],

  // Optional: anything here wins over what `brand` read from the system
  theme: {
    // accent: "#0F766E",
    // card: { bg: "#102A43" },
  },
};
