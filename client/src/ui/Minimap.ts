import { MAP } from "../../../shared/mapdata";
import { terrainHeight } from "../../../shared/terrain";
import { TEAM_COLORS } from "../../../shared/phys";

// Top-down 2D minimap: hillshaded terrain + tree dots rendered once (cached),
// live player dots overlaid each frame. North-up, fixed orientation.
export class Minimap {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement; // pre-rendered static map layer
  private size = 188;
  private pings: { x: number; z: number; until: number }[] = [];

  addPing(x: number, z: number) {
    this.pings.push({ x, z, until: performance.now() + 5000 });
  }

  constructor() {
    this.cv = document.createElement("canvas");
    this.cv.id = "minimap";
    this.cv.width = this.size;
    this.cv.height = this.size;
    document.getElementById("hud")!.appendChild(this.cv);
    this.ctx = this.cv.getContext("2d")!;
    this.base = this.renderBase();
  }

  private w2c(x: number, z: number): [number, number] {
    const hx = MAP.bounds.halfX;
    const hz = MAP.bounds.halfZ;
    return [((x + hx) / (2 * hx)) * this.size, ((z + hz) / (2 * hz)) * this.size];
  }

  private renderBase(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = this.size;
    const ctx = c.getContext("2d")!;
    const n = this.size;
    const hx = MAP.bounds.halfX;

    // sample the heightfield once, then shade by height + NW hillshade
    const grid = new Float32Array((n + 1) * (n + 1));
    for (let py = 0; py <= n; py++) {
      for (let px = 0; px <= n; px++) {
        const x = (px / n) * 2 * hx - hx;
        const z = (py / n) * 2 * hx - hx;
        grid[py * (n + 1) + px] = terrainHeight(x, z);
      }
    }
    const img = ctx.createImageData(n, n);
    for (let py = 0; py < n; py++) {
      for (let px = 0; px < n; px++) {
        const h = grid[py * (n + 1) + px];
        const t = Math.max(0, Math.min(1, (h + 8) / 36));
        const shade = Math.max(-1, Math.min(1, (h - grid[py * (n + 1) + px + 1]) * 0.6 + (h - grid[(py + 1) * (n + 1) + px]) * 0.6));
        let r = 28 + t * 70 + shade * 22;
        let g = 52 + t * 80 + shade * 26;
        let b = 26 + t * 48 + shade * 16;
        const i = (py * n + px) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 235;
      }
    }
    ctx.putImageData(img, 0, 0);

    // trees as tiny dark dots, rocks as grey
    for (const blk of MAP.blocks) {
      const [cx, cz] = this.w2c(blk.x, blk.z);
      if (cx < 0 || cz < 0 || cx > n || cz > n) continue;
      ctx.fillStyle =
        blk.prop === "rock" ? "rgba(150,153,158,0.9)" : blk.prop === "log" ? "rgba(105,80,50,0.9)" : "rgba(12,26,10,0.75)";
      ctx.beginPath();
      ctx.arc(cx, cz, blk.prop === "tree" ? 1.2 : 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  }

  update(state: any, meId: string) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.drawImage(this.base, 0, 0);

    // team pings: pulsing yellow diamonds
    const now = performance.now();
    this.pings = this.pings.filter((p) => p.until > now);
    for (const p of this.pings) {
      const [cx, cz] = this.w2c(p.x, p.z);
      const r = 4 + Math.sin(now * 0.012) * 1.2;
      ctx.fillStyle = "#ffd34d";
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cz - r);
      ctx.lineTo(cx + r, cz);
      ctx.lineTo(cx, cz + r);
      ctx.lineTo(cx - r, cz);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    state.players.forEach((p: any, id: string) => {
      if (!p.alive) return;
      const [cx, cz] = this.w2c(p.x, p.z);
      if (id === meId) {
        // self: white triangle pointing where you face
        const dx = -Math.sin(p.yaw);
        const dz = -Math.cos(p.yaw);
        const px = -dz;
        const pz = dx;
        ctx.fillStyle = "#eafff2";
        ctx.beginPath();
        ctx.moveTo(cx + dx * 7, cz + dz * 7);
        ctx.lineTo(cx - dx * 4 + px * 4, cz - dz * 4 + pz * 4);
        ctx.lineTo(cx - dx * 4 - px * 4, cz - dz * 4 - pz * 4);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = "#" + ((TEAM_COLORS[p.team] ?? 0xffffff) >>> 0).toString(16).padStart(6, "0");
        ctx.beginPath();
        ctx.arc(cx, cz, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.stroke();
      }
    });
  }
}
