// One-off diagnostic: measure the vertical gap between each landmark model (huts,
// tents, etc.) and the terrain mesh directly beneath it. Joins headlessly, passes
// the lobby, then reads the live scene graph (window.__scene / window.__THREE) and
// raycasts straight down from each model onto the terrain ground plane.
import puppeteer from "puppeteer-core";
import * as fs from "fs";

const exe = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--use-angle=default"] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("http://localhost:5173", { waitUntil: "networkidle2", timeout: 30000 });
  await page.evaluate(() => ((document.getElementById("name") as HTMLInputElement).value = "DiagBot"));
  await page.click("#play");
  await new Promise((r) => setTimeout(r, 6000));
  const domClick = (sel: string) =>
    page.evaluate((s) => { const el = document.querySelector(s) as HTMLElement | null; if (el) el.click(); return !!el; }, sel);
  await domClick('button[data-act="ready"]');
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 900)); await domClick('button[data-act="start"]:not([disabled])'); }
  await new Promise((r) => setTimeout(r, 8000)); // let the GLB models finish loading

  const report = await page.evaluate(() => {
    const THREE = (window as any).__THREE;
    const scene = (window as any).__scene;
    if (!THREE || !scene) return { error: "missing __THREE/__scene" };
    const Box3 = THREE.Box3, V3 = THREE.Vector3;

    // terrain = the mesh with the largest XZ footprint (the displaced ground plane)
    let terrain: any = null, bestArea = 0;
    const b = new Box3();
    scene.traverse((o: any) => {
      if (!o.isMesh) return;
      b.setFromObject(o);
      const area = (b.max.x - b.min.x) * (b.max.z - b.min.z);
      if (area > bestArea) { bestArea = area; terrain = o; }
    });

    const ray = new THREE.Raycaster();
    // hut/tent-sized groups: world bbox between ~1.5 and 9 m on each axis
    const seen: any[] = [];
    scene.traverse((o: any) => {
      if (o.type !== "Group" || !o.children.length || o.parent?.type !== "Group") return;
      const box = new Box3().setFromObject(o);
      const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y, sz = box.max.z - box.min.z;
      if (sy > 1.2 && sy < 9 && sx > 1.5 && sx < 9 && sz > 1.5 && sz < 9) {
        seen.push({ sx, sy, sz, cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2, minY: box.min.y });
      }
    });

    const items = seen.map((s) => {
      let terrainY: number | null = null;
      if (terrain) {
        ray.set(new V3(s.cx, s.minY + 60, s.cz), new V3(0, -1, 0));
        const hits = ray.intersectObject(terrain, true);
        if (hits.length) terrainY = hits[0].point.y;
      }
      return {
        center: [+s.cx.toFixed(2), +s.cz.toFixed(2)],
        size: [+s.sx.toFixed(2), +s.sy.toFixed(2), +s.sz.toFixed(2)],
        modelBottomY: +s.minY.toFixed(3),
        terrainY: terrainY == null ? null : +terrainY.toFixed(3),
        gap: terrainY == null ? null : +(s.minY - terrainY).toFixed(3),
      };
    });
    return { terrainName: terrain?.name || "(unnamed)", terrainFootprint: +Math.sqrt(bestArea).toFixed(1), count: items.length, items };
  });
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
