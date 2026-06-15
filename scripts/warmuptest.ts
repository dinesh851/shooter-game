// Verify the warmup -> live transition no longer teleports the player. Joins, passes
// the lobby, then samples the authoritative player position + phase every 400ms.
// A correct fix shows the position staying continuous across the warmup->live edge.
import puppeteer from "puppeteer-core";
import * as fs from "fs";

const exe = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

(async () => {
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--use-angle=default", "--window-size=1280,720"], defaultViewport: { width: 1280, height: 720 } });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("http://localhost:5173", { waitUntil: "networkidle2", timeout: 30000 });
  await page.evaluate(() => ((document.getElementById("name") as HTMLInputElement).value = "WarmBot"));
  await page.click("#play");
  await new Promise((r) => setTimeout(r, 6000));
  const domClick = (sel: string) =>
    page.evaluate((s) => { const el = document.querySelector(s) as HTMLElement | null; if (el) el.click(); return !!el; }, sel);
  // host needs a second body so the round can run; add a bot, then ready+start
  await domClick('button[data-act="bot"]');
  await new Promise((r) => setTimeout(r, 400));
  await domClick('button[data-act="ready"]');
  for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 700)); await domClick('button[data-act="start"]:not([disabled])'); }

  const samples: any[] = [];
  for (let i = 0; i < 26; i++) {
    const s = await page.evaluate(() => {
      const room = (window as any).__room;
      if (!room?.state) return null;
      const me = room.state.players.get(room.sessionId);
      return { phase: room.state.phase, t: Math.round(room.state.timeRemaining), x: me ? +me.x.toFixed(2) : null, y: me ? +me.y.toFixed(2) : null, z: me ? +me.z.toFixed(2) : null };
    });
    if (s) samples.push(s);
    await new Promise((r) => setTimeout(r, 400));
  }

  // find the warmup->live edge and report the position jump there
  let edge = -1;
  for (let i = 1; i < samples.length; i++) if (samples[i - 1].phase === "warmup" && samples[i].phase === "live") edge = i;
  let jump: number | null = null;
  if (edge > 0) {
    const a = samples[edge - 1], b = samples[edge];
    jump = +Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0), (b.z ?? 0) - (a.z ?? 0)).toFixed(3);
  }
  console.log(JSON.stringify({ phasesSeen: [...new Set(samples.map((s) => s.phase))], warmupToLiveJump: jump, edgeIndex: edge, samples }, null, 2));
  await browser.close();
})();
