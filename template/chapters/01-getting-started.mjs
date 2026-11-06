// Chapter 1: an example to copy. The file name gives the number and the output name.
export const meta = {
  title: "Getting started",
  line: "Find your way around in one minute.", // shown on the title and chapter cards
  endTitle: "You know your way around.",
  // startPath: "/reports",      where the chapter opens (default: homePath)
  // signedIn: false,            start signed out, to show signing in (use d.signIn())
  // account: "manager",         start as another test account
  // counterCorner: "bottom-right",   normally chosen automatically
  // async setup(page) {},       data the chapter needs, made through the system before recording
};

const TOTAL = 2;

export async function run(d, { page, main }) {
  await d.start();

  // ---- 1. The menu ---------------------------------------------------------------------------
  await d.step(1, TOTAL, "The menu");
  const menu = page.getByRole("navigation").first();
  await d.say("Everything you can open is in this menu.", menu, { side: "right" });
  await d.wait(1200);

  // A link that opens a page: after: 0 freezes the screen, d.loaded() cuts the wait
  const reports = page.getByRole("link", { name: "Reports", exact: true });
  await d.say("Reports show this month's numbers, updated every night.", reports, {
    side: "right",
  });
  await d.click(reports, { after: 0 });
  const heading = page.getByRole("heading", { level: 1, name: "Reports" });
  await d.loaded(heading, 700);

  // ---- 2. A form -----------------------------------------------------------------------------
  await d.step(2, TOTAL, "Search");
  const search = main.getByRole("searchbox");
  await d.say("Search by name, so you never scroll a long list.", search, { side: "below" });
  await d.focus([search], { maxZoom: 1.6 });
  await d.type(search, "Sample");
  await d.unfocus();

  await d.end();
}
