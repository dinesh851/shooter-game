// Dev utility: screenshot the soldier-test harness page to verify the remote
// player model's facing and gun grip. Usage: npx tsx scripts/soldiershot.ts [out.png]
import puppeteer from "puppeteer-core";
import * as fs from "fs";

const out = process.argv[2] ?? "soldier.png";
const exe = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ["--use-angle=default", "--window-size=900,900"],
    defaultViewport: { width: 900, height: 900 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[browser:pageerror]", e.message));
  const query = process.argv[3] ?? ""; // e.g. "?run=1"
  await page.goto(`http://localhost:5173/soldier-test.html${query}`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3500));
  await page.screenshot({ path: out as `${string}.png` });
  await browser.close();
  console.log(`[soldiershot] saved ${out}`);
})();
