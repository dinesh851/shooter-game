import { WEAPON_LIST, WeaponId } from "../../../shared/weapons";

interface Row {
  id: string;
  name: string;
  team: number;
  kills: number;
  deaths: number;
}

// All HUD updates are plain DOM writes — cheap and keeps the WebGL canvas clean.
export class Hud {
  private el = {
    hud: document.getElementById("hud")!,
    timer: document.getElementById("timer")!,
    score0: document.getElementById("score0")!,
    score1: document.getElementById("score1")!,
    phase: document.getElementById("phase")!,
    health: document.getElementById("health")!,
    hpfill: document.getElementById("hpfill")!,
    ammo: document.getElementById("ammo")!,
    weaponname: document.getElementById("weaponname")!,
    weaponlist: document.getElementById("weaponlist")!,
    reloading: document.getElementById("reloading")!,
    ads: document.getElementById("ads")!,
    scope: document.getElementById("scope")!,
    crosshair: document.getElementById("crosshair")!,
    reddot: document.getElementById("reddot")!,
    killfeed: document.getElementById("killfeed")!,
    hitmarker: document.getElementById("hitmarker")!,
    damage: document.getElementById("damage")!,
    scoreboard: document.getElementById("scoreboard")!,
  };
  private hitTimer = 0;

  show() {
    this.el.hud.classList.remove("hidden");
    this.el.weaponlist.innerHTML = WEAPON_LIST.map(
      (w) => `<div class="w" data-id="${w.id}"><b>${w.slot}</b>${w.name}</div>`
    ).join("");
  }

  setHealth(health: number) {
    const hp = Math.max(0, Math.ceil(health));
    this.el.health.textContent = String(hp);
    this.el.health.classList.toggle("low", health <= 30);
    this.el.hpfill.style.width = `${Math.max(0, Math.min(100, health))}%`;
    this.el.hpfill.classList.toggle("mid", health <= 60 && health > 30);
    this.el.hpfill.classList.toggle("low", health <= 30);
  }

  setWeaponHud(weapon: WeaponId, name: string, ammo: number, mag: number, reloading: boolean) {
    this.el.weaponname.textContent = name;
    this.el.ammo.innerHTML = `${ammo}<i>/${mag}</i>`;
    this.el.ammo.classList.toggle("empty", ammo === 0);
    this.el.reloading.classList.toggle("hidden", !reloading);
    for (const node of Array.from(this.el.weaponlist.children)) {
      node.classList.toggle("active", (node as HTMLElement).dataset.id === weapon);
    }
  }

  setAds(on: boolean) {
    this.el.ads.classList.toggle("on", on);
  }

  setScope(on: boolean) {
    this.el.scope.classList.toggle("on", on);
    this.el.crosshair.style.display = on ? "none" : "";
  }

  setReddot(on: boolean) {
    this.el.reddot.classList.toggle("on", on);
    this.el.crosshair.style.opacity = on ? "0.25" : "1";
  }

  setScores(t0: number, t1: number) {
    this.el.score0.textContent = String(t0);
    this.el.score1.textContent = String(t1);
  }

  setTimer(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    this.el.timer.textContent = `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  setPhase(phase: string, t0: number, t1: number) {
    if (phase === "warmup") this.el.phase.textContent = "WARMUP — get ready";
    else if (phase === "ended") {
      const msg = t0 === t1 ? "DRAW" : t0 > t1 ? "BLUE TEAM WINS" : "ORANGE TEAM WINS";
      this.el.phase.textContent = msg;
    } else this.el.phase.textContent = "";
  }

  hitmarker() {
    this.el.hitmarker.style.transition = "none";
    this.el.hitmarker.style.opacity = "1";
    this.hitTimer = 0.12;
  }

  damageFlash() {
    this.el.damage.style.opacity = "0.9";
    // let the 0.9 actually paint, then let the CSS transition fade it out
    setTimeout(() => (this.el.damage.style.opacity = "0"), 50);
  }

  killfeed(killerName: string, victimName: string, killerTeam: number, victimTeam: number, head: boolean) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML =
      `<span class="t${killerTeam}">${esc(killerName)}</span>` +
      ` <span class="head">${head ? "⊕" : "›"}</span> ` +
      `<span class="t${victimTeam}">${esc(victimName)}</span>`;
    this.el.killfeed.prepend(row);
    while (this.el.killfeed.childElementCount > 5) this.el.killfeed.lastChild!.remove();
    setTimeout(() => row.remove(), 5000);
  }

  toggleScoreboard(visible: boolean) {
    this.el.scoreboard.classList.toggle("hidden", !visible);
  }

  renderScoreboard(rows: Row[], meId: string) {
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const body = rows
      .map(
        (r) =>
          `<tr class="t${r.team} ${r.id === meId ? "me" : ""}">` +
          `<td>${esc(r.name)}</td>` +
          `<td class="num">${r.kills}</td>` +
          `<td class="num">${r.deaths}</td></tr>`
      )
      .join("");
    this.el.scoreboard.innerHTML =
      `<h2>SCOREBOARD</h2><table><tr><th>Player</th><th class="num">K</th><th class="num">D</th></tr>${body}</table>`;
  }

  update(dt: number) {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) {
        this.el.hitmarker.style.transition = "opacity 0.15s";
        this.el.hitmarker.style.opacity = "0";
      }
    }
  }
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}
