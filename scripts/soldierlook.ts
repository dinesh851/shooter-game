// Look at a remote Soldier character up close: join, add bots (they stand frozen at
// their spawns in the lobby), then free-cam onto one and screenshot. Also dumps the
// soldier's mesh/bone structure so we know whether arms can be isolated.
import puppeteer from "puppeteer-core";
import * as fs from "fs";

const exe = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  fs.mkdirSync("shots", { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: exe, headless: true,
    args: ["--use-angle=default", "--window-size=1280,720", "--hide-scrollbars"],
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("[browser:error]", m.text()); });
  await page.goto("http://localhost:5173", { waitUntil: "networkidle2", timeout: 30000 });
  await page.evaluate(() => ((document.getElementById("name") as HTMLInputElement).value = "Looker"));
  await page.click("#play");
  await new Promise((r) => setTimeout(r, 6000));
  const domClick = (sel: string) =>
    page.evaluate((s) => { const el = document.querySelector(s) as HTMLElement | null; if (el) el.click(); return !!el; }, sel);
  for (let i = 0; i < 4; i++) { await domClick('button[data-act="bot"]'); await new Promise((r) => setTimeout(r, 250)); }
  await new Promise((r) => setTimeout(r, 4000)); // let soldier models load

  const info = await page.evaluate(() => {
    const room = (window as any).__room;
    const THREE = (window as any).__THREE, scene = (window as any).__scene;
    // pick any other player (a bot)
    let target: any = null;
    room.state.players.forEach((p: any, id: string) => { if (id !== room.sessionId && !target) target = { x: p.x, y: p.y, z: p.z }; });
    // dump the structure of the first SkinnedMesh we can find
    const meshes: any[] = [];
    let bones = 0;
    scene.traverse((o: any) => {
      if (o.isSkinnedMesh) meshes.push({ name: o.name, verts: o.geometry?.attributes?.position?.count ?? 0 });
      if (o.isBone) bones++;
    });
    return { target, meshes, bones };
  });
  console.log("[structure]", JSON.stringify(info.meshes), "bones:", info.bones);

  if (info.target) {
    await page.evaluate((t) => {
      const THREE = (window as any).__THREE, cam = (window as any).__camera;
      (window as any).__freezeCam = true;
      document.querySelectorAll<HTMLElement>("div").forEach((d) => { if (d.style && d.style.zIndex === "40") d.style.display = "none"; });
      cam.position.set(t.x + 2.2, t.y + 1.5, t.z + 2.6);
      cam.up.set(0, 1, 0);
      cam.lookAt(new THREE.Vector3(t.x, t.y + 1.3, t.z));
    }, info.target);
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: "shots/soldier.png" });
    console.log("[soldierlook] saved shots/soldier.png target=", info.target);
  } else {
    console.log("[soldierlook] no remote player found");
  }
  await browser.close();
})();
