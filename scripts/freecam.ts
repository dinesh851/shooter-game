// Dev free-cam: join headlessly, freeze the game camera, then orbit/point it at a
// world target and screenshot. Usage:
//   npx tsx scripts/freecam.ts <outName> <tx> <ty> <tz> [dist] [height] [angDeg]
import puppeteer from "puppeteer-core";
import * as fs from "fs";

const [outName = "free", txs = "12", tys = "-2", tzs = "-50", dists = "11", heights = "4", angs = "30"] = process.argv.slice(2);
const tx = +txs, ty = +tys, tz = +tzs, dist = +dists, height = +heights, ang = (+angs * Math.PI) / 180;
const exe = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  fs.mkdirSync("shots", { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: exe, headless: true,
    args: ["--use-angle=default", "--window-size=1920,1080", "--hide-scrollbars"],
    defaultViewport: { width: 1920, height: 1080 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("http://localhost:5173", { waitUntil: "networkidle2", timeout: 30000 });
  await page.evaluate(() => ((document.getElementById("name") as HTMLInputElement).value = "FreeCam"));
  await page.click("#play");
  await new Promise((r) => setTimeout(r, 6000));
  const domClick = (sel: string) =>
    page.evaluate((s) => { const el = document.querySelector(s) as HTMLElement | null; if (el) el.click(); return !!el; }, sel);
  await domClick('button[data-act="ready"]');
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 900)); await domClick('button[data-act="start"]:not([disabled])'); }
  await new Promise((r) => setTimeout(r, 8000));

  await page.evaluate((t) => {
    const THREE = (window as any).__THREE;
    const cam = (window as any).__camera;
    (window as any).__freezeCam = true;
    // hide the lobby overlay (z-index 40) so we can see the world behind it
    document.querySelectorAll<HTMLElement>("div").forEach((d) => {
      if (d.style && d.style.zIndex === "40") d.style.display = "none";
    });
    const cx = t.tx + Math.sin(t.ang) * t.dist;
    const cz = t.tz + Math.cos(t.ang) * t.dist;
    cam.position.set(cx, t.ty + t.height, cz);
    cam.up.set(0, 1, 0);
    cam.lookAt(new THREE.Vector3(t.tx, t.ty + 1, t.tz));
  }, { tx, ty, tz, dist, height, ang });

  await new Promise((r) => setTimeout(r, 600));
  const path = `shots/${outName}.png`;
  await page.screenshot({ path });
  console.log(`[freecam] saved ${path}`);
  await browser.close();
})();
