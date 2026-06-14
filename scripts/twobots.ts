// Dev utility: two headless clients join (auto-balanced onto opposite teams),
// walk toward the centre, and screenshot what each sees — the only way to
// verify remote-player rendering (soldier pose, gun grip) in the real game.
// Usage: npx tsx scripts/twobots.ts [outDir]
import puppeteer from "puppeteer-core";
import * as fs from "fs";

const out = process.argv[2] ?? "bots";
const exe = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

async function join(browser: puppeteer.Browser, name: string) {
  const page = await browser.newPage();
  await page.goto("http://localhost:5173", { waitUntil: "networkidle2", timeout: 30000 });
  // the input prefills from localStorage — replace, don't append
  await page.evaluate((n) => {
    (document.getElementById("name") as HTMLInputElement).value = n;
  }, name);
  await page.click("#play");
  return page;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    protocolTimeout: 120000, // two heavy WebGL tabs make CDP slow
    args: ["--use-angle=default", "--window-size=960,540"],
    defaultViewport: { width: 960, height: 540 },
  });
  const a = await join(browser, "BotA");
  const b = await join(browser, "BotB");
  await new Promise((r) => setTimeout(r, 6000)); // load world + lobby

  // lobby: capture it, ready both, host starts
  await a.screenshot({ path: `${out}/lobby.png` });
  // single-CDP-call clicks (page.click needs several round-trips)
  const domClick = (p: puppeteer.Page, sel: string, tag: string) =>
    p
      .evaluate((s) => {
        const el = document.querySelector(s) as HTMLElement | null;
        if (el) el.click();
        return !!el;
      }, sel)
      .then((ok) => console.log(`[twobots] click ${tag}: ${ok}`))
      .catch((e) => console.log(`[twobots] click ${tag} failed:`, e.message));
  await domClick(a, 'button[data-act="ready"]', "ready A");
  await domClick(b, 'button[data-act="ready"]', "ready B");
  await new Promise((r) => setTimeout(r, 900));
  await a.screenshot({ path: `${out}/lobby-ready.png` });
  await domClick(a, 'button[data-act="start"]', "start");
  await new Promise((r) => setTimeout(r, 7500)); // warmup

  // both walk forward (spawns face the map centre) to close the fog gap
  await a.keyboard.down("w");
  await b.keyboard.down("w");
  await new Promise((r) => setTimeout(r, 5200));
  await a.keyboard.up("w");
  await b.keyboard.up("w");
  await new Promise((r) => setTimeout(r, 800));

  await a.screenshot({ path: `${out}/botA.png` });
  await b.screenshot({ path: `${out}/botB.png` });
  await browser.close();
  console.log(`[twobots] saved lobby + in-game shots to ${out}`);
})();
