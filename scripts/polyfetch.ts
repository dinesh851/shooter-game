// Dev utility: resolve the direct .glb download URL for a poly.pizza model
// page (their UI is an SPA, so we run it and read the link out of the DOM).
// Usage: npx tsx scripts/polyfetch.ts <modelUrl>
import puppeteer from "puppeteer-core";
import * as fs from "fs";

const url = process.argv[2];
const exe = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  const browser = await puppeteer.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage();
  const hits = new Set<string>();
  page.on("request", (r) => {
    const u = r.url();
    if (/\.(glb|gltf|zip|bin)(\?|$)/i.test(u) || /static\.poly|storage|cdn|download|api\.poly/i.test(u)) hits.add(u);
  });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
  // collect any anchors/buttons that look like downloads
  const links = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("a").forEach((a) => {
      const href = (a as HTMLAnchorElement).href;
      if (/\.(glb|gltf|zip)/i.test(href) || /download/i.test(href)) out.push(href);
    });
    return out;
  });
  links.forEach((l) => hits.add(l));

  // click anything labelled Download and watch what it fetches
  await page.evaluate(() => {
    const els = [...document.querySelectorAll("button, a")] as HTMLElement[];
    for (const el of els) {
      if (/download/i.test(el.textContent ?? "")) {
        el.click();
        break;
      }
    }
  });
  await new Promise((r) => setTimeout(r, 4000));
  console.log(JSON.stringify([...hits], null, 1));
  await browser.close();
})();
