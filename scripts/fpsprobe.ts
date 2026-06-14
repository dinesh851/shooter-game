// Dev utility: join the running game headlessly and report average FPS and
// which network requests fail. Usage: npx tsx scripts/fpsprobe.ts
import puppeteer from "puppeteer-core";
import * as fs from "fs";

const exe = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: [
      "--use-angle=default",
      "--window-size=1280,720",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-frame-rate-limit",
    ],
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
  page.on("response", (r) => {
    if (r.status() >= 400) console.log(`[probe] HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto("http://localhost:5173", { waitUntil: "networkidle2", timeout: 30000 });
  await page.type("#name", "FpsBot");
  await page.click("#play");
  // optionally switch weapon first (e.g. `npx tsx scripts/fpsprobe.ts 3` for pistol)
  const slot = process.argv[2];
  if (slot) {
    await page.keyboard.down(slot);
    await new Promise((r) => setTimeout(r, 150));
    await page.keyboard.up(slot);
  }
  // wait past the loading window (shadow bakes + adaptive resolution settle)
  await new Promise((r) => setTimeout(r, 14000));

  // string form: tsx's esbuild transform would inject helpers into a function
  // argument that don't exist in the page context
  const fps = (await page.evaluate(`new Promise((resolve) => {
    let frames = 0;
    const t0 = performance.now();
    const tick = () => {
      frames++;
      if (performance.now() - t0 > 5000) resolve((frames * 1000) / (performance.now() - t0));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`)) as number;
  console.log(`[probe] average FPS over 5s: ${fps.toFixed(1)}`);
  const info = (await page.evaluate(
    `(() => { const r = window.__renderer; return r ? JSON.stringify({ calls: r.info.render.calls, tris: r.info.render.triangles, geoms: r.info.memory.geometries, tex: r.info.memory.textures, gpu: (() => { const gl = r.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; })() }) : 'no renderer'; })()`
  )) as string;
  console.log(`[probe] render info: ${info}`);
  await browser.close();
})();
