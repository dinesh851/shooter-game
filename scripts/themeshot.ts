// Dev utility: screenshot the entry menu in each UI theme (Ctrl+K cycles).
// Usage: npx tsx scripts/themeshot.ts [outDir]
import puppeteer from "puppeteer-core";
import * as fs from "fs";

const out = process.argv[2] ?? "themes";
const exe = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ["--window-size=900,640"],
    defaultViewport: { width: 900, height: 640 },
  });
  const page = await browser.newPage();
  await page.goto("http://localhost:5173", { waitUntil: "networkidle2", timeout: 30000 });
  for (let i = 0; i < 5; i++) {
    await page.screenshot({ path: `${out}/theme${i}.png` });
    await page.keyboard.down("ControlLeft");
    await page.keyboard.press("KeyK");
    await page.keyboard.up("ControlLeft");
    await new Promise((r) => setTimeout(r, 400));
  }
  await browser.close();
  console.log(`[themeshot] saved 5 themes to ${out}`);
})();
