// Dev utility: join the running game headlessly and save screenshots so we can
// eyeball the rendered world without a real client. Usage:
//   npx tsx scripts/screenshot.ts [outDir]
import puppeteer from "puppeteer-core";
import * as fs from "fs";

const out = process.argv[2] ?? "shots";
const exe = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ["--use-angle=default", "--window-size=1920,1080", "--hide-scrollbars"],
    defaultViewport: { width: 1920, height: 1080 },
  });
  const page = await browser.newPage();
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") console.log(`[browser:${t}]`, m.text());
  });
  page.on("pageerror", (e) => console.log("[browser:pageerror]", e.message));

  await page.goto("http://localhost:5173", { waitUntil: "networkidle2", timeout: 30000 });
  await page.evaluate(() => {
    (document.getElementById("name") as HTMLInputElement).value = "ShotBot";
  });
  await page.click("#play");
  await new Promise((r) => setTimeout(r, 6000)); // connect + generate forest

  // pass the lobby: ready up and start (solo bot is the host)
  const domClick = (sel: string) =>
    page.evaluate((s) => {
      const el = document.querySelector(s) as HTMLElement | null;
      if (el) el.click();
      return !!el;
    }, sel);
  const wx = process.argv[3]; // optional weather to dial before starting
  if (wx) {
    await domClick(`button[data-act="wx:${wx}"]`);
    await new Promise((r) => setTimeout(r, 500));
  }
  await domClick('button[data-act="ready"]');
  // the start button enables only after the ready ack re-renders the lobby —
  // retry a few times instead of racing it
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 900));
    await domClick('button[data-act="start"]:not([disabled])');
  }
  await new Promise((r) => setTimeout(r, 7000)); // warmup

  await page.screenshot({ path: `${out}/spawn.png` });

  // capture each weapon's view model (1-4 switch weapons; hold the key so the
  // per-frame isDown() poll can't miss it)
  for (const k of ["2", "3", "4", "1"]) {
    await page.keyboard.down(k);
    await new Promise((r) => setTimeout(r, 150));
    await page.keyboard.up(k);
    await new Promise((r) => setTimeout(r, 1000));
    await page.screenshot({ path: `${out}/weapon${k}.png` });
  }

  // walk forward (with some strafing to slip past trees) for a second angle
  await page.keyboard.down("w");
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? "a" : "d";
    await page.keyboard.down(side);
    await new Promise((r) => setTimeout(r, 1900));
    await page.keyboard.up(side);
  }
  await page.keyboard.up("w");
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${out}/walked.png` });

  await browser.close();
  console.log(`[screenshot] saved ${out}/spawn.png and ${out}/walked.png`);
})();
