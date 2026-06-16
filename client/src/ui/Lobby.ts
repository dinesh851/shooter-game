// Pre-match lobby + end-of-match stats, styled like a modern tactical shooter
// (COD/PUBG flavour). The lobby lets you pick a side, ready up, rename, and —
// with the admin key — take host, add bots and force the match back to lobby.

import { TEAM_NAMES } from "../../../shared/phys";

const TEAM_CSS = ["#3b82f6", "#e23b3b"];
const ACCENT = "#ffd66e";

export class Lobby {
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  private body: HTMLDivElement;
  private footer: HTMLDivElement; // persistent (rename + admin) — never rebuilt
  private title: HTMLDivElement;
  private visible = false;
  private mode: "lobby" | "score" | "hidden" = "hidden";
  private sig = "";
  private footerBuilt = false;
  private isAdmin = false;

  onSelectTeam?: (team: number) => void;
  onReady?: (ready: boolean) => void;
  onStart?: () => void;
  onAddBot?: () => void;
  onWeather?: (w: string) => void;
  onSetName?: (name: string) => void;
  onClaimAdmin?: (password: string) => void;
  onEndMatch?: () => void;

  constructor() {
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:fixed;inset:0;display:none;z-index:40;align-items:center;justify-content:center;" +
      "background:radial-gradient(circle at 50% 30%,rgba(12,16,22,0.82),rgba(4,6,9,0.92));" +
      "backdrop-filter:blur(4px);font-family:var(--ui-font);color:#e8edf4";

    this.panel = document.createElement("div");
    this.panel.style.cssText =
      "position:relative;width:720px;max-width:94vw;background:linear-gradient(180deg,rgba(22,27,36,0.97),rgba(13,16,22,0.98));" +
      "border:1px solid rgba(255,214,110,0.22);border-radius:4px;padding:24px 26px 20px;" +
      "box-shadow:0 30px 90px rgba(0,0,0,0.7);" +
      "clip-path:polygon(0 0,100% 0,100% calc(100% - 20px),calc(100% - 20px) 100%,0 100%)";

    this.title = document.createElement("div");
    this.title.style.cssText = "font-size:24px;font-weight:900;letter-spacing:2px;margin-bottom:16px";
    this.body = document.createElement("div");
    this.footer = document.createElement("div");
    this.panel.append(this.title, this.body, this.footer);
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
  }

  hide() {
    if (this.mode === "hidden") return;
    this.mode = "hidden";
    this.visible = false;
    this.sig = "";
    this.root.style.display = "none";
  }

  private show() {
    if (this.visible) return;
    this.visible = true;
    this.root.style.display = "flex";
    document.exitPointerLock?.();
  }

  // ---- lobby ---------------------------------------------------------------

  showLobby(state: any, meId: string) {
    if (this.mode !== "lobby") this.sig = ""; // force rebuild when switching in
    this.mode = "lobby";
    this.show();
    this.footer.style.display = "";

    const me = state.players.get(meId);
    this.isAdmin = !!me?.admin;
    const isHost = state.hostId === meId;
    const teams: { name: string; ready: boolean; bot: boolean; me: boolean; admin: boolean }[][] = [[], []];
    let allReady = true;
    let sig = `${isHost}|${this.isAdmin}|${me?.ready}|${state.weather}`;
    state.players.forEach((p: any, id: string) => {
      teams[p.team === 1 ? 1 : 0].push({ name: p.name, ready: p.ready, bot: p.bot, me: id === meId, admin: p.admin });
      if (!p.bot && !p.ready) allReady = false;
      sig += `;${id},${p.team},${p.ready},${p.name},${p.admin}`;
    });

    this.buildFooter(me, state); // persistent bar (built once; values refreshed)

    if (sig === this.sig) return;
    this.sig = sig;

    this.title.innerHTML = `<span style="color:${ACCENT}">▮</span> MATCH LOBBY`;

    const col = (t: number) => `
      <div style="flex:1;background:rgba(255,255,255,0.025);border:1px solid ${TEAM_CSS[t]}55;border-top:3px solid ${TEAM_CSS[t]};border-radius:3px;padding:12px 14px;min-height:180px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-weight:900;letter-spacing:1px;color:${TEAM_CSS[t]}">${TEAM_NAMES[t]}</span>
          <span style="font-size:12px;color:#8b97a8">${teams[t].length} OP${teams[t].length === 1 ? "" : "S"}</span>
        </div>
        ${teams[t]
          .map(
            (p) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px;${p.me ? "font-weight:800" : ""}">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:62%">
              ${p.admin ? `<span style="color:${ACCENT}">★</span> ` : ""}${esc(p.name)}${p.me ? ' <span style="color:#8b97a8;font-weight:400">(you)</span>' : ""}</span>
            <span style="font-size:11px;letter-spacing:1px;color:${p.bot ? "#8b97a8" : p.ready ? "#7ee787" : "#c98b4b"}">
              ${p.bot ? "BOT" : p.ready ? "● READY" : "○ ..."}</span>
          </div>`
          )
          .join("")}
        <button data-act="team${t}" style="${ghostBtn(TEAM_CSS[t])};margin-top:10px;width:100%">JOIN ${TEAM_NAMES[t]}</button>
      </div>`;

    const weatherRow = isHost
      ? `<div style="display:flex;gap:6px;margin-top:14px;align-items:center;flex-wrap:wrap">
          <span style="color:#8b97a8;font-size:11px;letter-spacing:1px">WEATHER</span>
          ${["sunny", "mist", "heavy", "rain"]
            .map(
              (w) => `<button data-act="wx:${w}" style="background:${
                state.weather === w ? ACCENT : "rgba(255,255,255,0.06)"
              };color:${state.weather === w ? "#120d02" : "#e8edf4"};border:1px solid rgba(255,255,255,0.1);border-radius:3px;padding:5px 11px;cursor:pointer;font-size:11px;letter-spacing:1px;text-transform:uppercase">${w}</button>`
            )
            .join("")}
        </div>`
      : "";

    this.body.innerHTML = `
      <div style="display:flex;gap:14px">${col(0)}${col(1)}</div>
      ${weatherRow}
      <div style="display:flex;gap:10px;margin-top:16px;align-items:center">
        <button data-act="ready" style="${solidBtn(me?.ready ? "#8b949e" : "#7ee787")};flex:1">
          ${me?.ready ? "STAND DOWN" : "READY UP"}</button>
        ${isHost ? `<button data-act="bot" style="${solidBtn("#c9a24b")}">+ BOT</button>` : ""}
        ${
          isHost
            ? `<button data-act="start" ${allReady ? "" : "disabled"}
                style="${solidBtn(allReady ? ACCENT : "#3a4048")};flex:1;${allReady ? "" : "opacity:0.5;cursor:default"}">
                START MATCH</button>`
            : `<span style="color:#8b97a8;font-size:12px;letter-spacing:1px">⌛ WAITING FOR HOST…</span>`
        }
      </div>`;

    this.body.querySelectorAll("button[data-act]").forEach((b) => {
      b.addEventListener("click", (e) => {
        const act = (e.currentTarget as HTMLElement).dataset.act!;
        if (act === "team0") this.onSelectTeam?.(0);
        else if (act === "team1") this.onSelectTeam?.(1);
        else if (act === "ready") this.onReady?.(!me?.ready);
        else if (act === "bot") this.onAddBot?.();
        else if (act === "start") this.onStart?.();
        else if (act.startsWith("wx:")) this.onWeather?.(act.slice(3));
      });
    });
  }

  // persistent footer: rename + admin. Built once so inputs keep focus/value.
  private buildFooter(me: any, _state: any) {
    if (!this.footerBuilt) {
      this.footerBuilt = true;
      this.footer.style.cssText = "margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:10px;flex-wrap:wrap;align-items:center";
      this.footer.innerHTML = `
        <div style="display:flex;gap:6px;align-items:center">
          <span style="font-size:11px;letter-spacing:1px;color:#8b97a8">NAME</span>
          <input id="lb-name" maxlength="16" style="${inputCss()};width:140px" />
          <button id="lb-rename" style="${ghostBtn(ACCENT)}">SET</button>
        </div>
        <div style="flex:1"></div>
        <div id="lb-adminbox" style="display:flex;gap:6px;align-items:center"></div>`;
      const nameInput = this.footer.querySelector("#lb-name") as HTMLInputElement;
      nameInput.value = me?.name ?? "";
      const submit = () => {
        const v = nameInput.value.trim();
        if (v) this.onSetName?.(v);
      };
      this.footer.querySelector("#lb-rename")!.addEventListener("click", submit);
      nameInput.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") submit(); });
    }
    // refresh admin area each call (cheap, no inputs to clobber unless re-rendered)
    const box = this.footer.querySelector("#lb-adminbox") as HTMLDivElement;
    if (this.isAdmin && box.dataset.state !== "admin") {
      box.dataset.state = "admin";
      box.innerHTML = `
        <span style="font-size:11px;letter-spacing:2px;color:${ACCENT}">★ ADMIN</span>
        <button id="lb-end" style="${solidBtn("#e23b3b")}">END MATCH</button>`;
      box.querySelector("#lb-end")!.addEventListener("click", () => this.onEndMatch?.());
    } else if (!this.isAdmin && box.dataset.state !== "guest") {
      box.dataset.state = "guest";
      box.innerHTML = `
        <input id="lb-pw" type="password" placeholder="admin key" style="${inputCss()};width:120px" />
        <button id="lb-admin" style="${ghostBtn(ACCENT)}">ADMIN</button>`;
      const pw = box.querySelector("#lb-pw") as HTMLInputElement;
      const claim = () => { if (pw.value) this.onClaimAdmin?.(pw.value); };
      box.querySelector("#lb-admin")!.addEventListener("click", claim);
      pw.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") claim(); });
    }
  }

  adminDenied() {
    const pw = this.footer.querySelector("#lb-pw") as HTMLInputElement | null;
    if (pw) { pw.value = ""; pw.placeholder = "wrong key"; pw.style.borderLeftColor = "#e23b3b"; }
  }

  // ---- end-of-match scoreboard (modern stat card) --------------------------

  showScoreboard(state: any) {
    this.mode = "score";
    this.show();
    this.footer.style.display = "none";

    const winner = state.scoreTeam0 === state.scoreTeam1 ? -1 : state.scoreTeam0 > state.scoreTeam1 ? 0 : 1;
    this.title.innerHTML =
      winner < 0
        ? `<span style="color:${ACCENT}">DRAW</span>`
        : `<span style="color:${TEAM_CSS[winner]}">${TEAM_NAMES[winner]} VICTORY</span>
           <span style="color:#8b97a8;font-weight:600;font-size:18px;margin-left:10px">${state.scoreTeam0} : ${state.scoreTeam1}</span>`;

    const rows: any[] = [];
    state.players.forEach((p: any) => rows.push(p));
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const mvp = rows[0] && rows[0].kills > 0 ? rows[0] : null;

    const mvpCard = mvp
      ? `<div style="display:flex;align-items:center;gap:14px;background:linear-gradient(90deg,rgba(255,214,110,0.16),transparent);border-left:3px solid ${ACCENT};padding:12px 16px;margin-bottom:14px;border-radius:3px">
          <div style="font-size:28px">🏆</div>
          <div>
            <div style="font-size:11px;letter-spacing:3px;color:${ACCENT}">MATCH MVP</div>
            <div style="font-size:20px;font-weight:900;color:${TEAM_CSS[mvp.team === 1 ? 1 : 0]}">${esc(mvp.name)}</div>
          </div>
          <div style="margin-left:auto;text-align:right;font-size:13px;color:#c7d0db">
            <b style="color:#fff;font-size:18px">${mvp.kills}</b> KILLS · ${mvp.deaths} DEATHS</div>
        </div>`
      : "";

    this.body.innerHTML = `
      ${mvpCard}
      <div style="display:grid;grid-template-columns:1fr 48px 48px 56px 72px;gap:0;font-size:11px;letter-spacing:1px;color:#8b97a8;padding:0 10px 6px">
        <span>OPERATOR</span><span style="text-align:center">K</span><span style="text-align:center">D</span><span style="text-align:center">ACC</span><span style="text-align:right">LONGEST</span>
      </div>
      ${rows
        .map((p, i) => {
          const acc = p.shots > 0 ? Math.round((100 * p.hits) / p.shots) + "%" : "–";
          const isMvp = p === mvp;
          return `<div style="display:grid;grid-template-columns:1fr 48px 48px 56px 72px;align-items:center;padding:8px 10px;border-radius:3px;${
            i % 2 ? "background:rgba(255,255,255,0.025)" : ""
          };${isMvp ? `box-shadow:inset 2px 0 0 ${ACCENT}` : ""}">
            <span style="color:${TEAM_CSS[p.team === 1 ? 1 : 0]};font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${p.admin ? `<span style="color:${ACCENT}">★</span> ` : ""}${esc(p.name)}</span>
            <span style="text-align:center;font-weight:800;font-size:15px">${p.kills}</span>
            <span style="text-align:center;color:#c7d0db">${p.deaths}</span>
            <span style="text-align:center;color:#c7d0db">${acc}</span>
            <span style="text-align:right;color:#c7d0db">${p.longest > 0 ? p.longest + " m" : "–"}</span>
          </div>`;
        })
        .join("")}
      <div style="margin-top:14px;color:#8b97a8;font-size:12px;letter-spacing:1px">↻ RETURNING TO LOBBY…</div>`;
  }
}

function solidBtn(color: string): string {
  return (
    `background:${color};color:#0b0f0c;font-weight:900;border:none;border-radius:3px;` +
    `padding:11px 16px;cursor:pointer;font-size:13px;letter-spacing:1.5px;` +
    `clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)`
  );
}

function ghostBtn(color: string): string {
  return (
    `background:transparent;color:${color};font-weight:800;border:1px solid ${color}88;border-radius:3px;` +
    `padding:8px 14px;cursor:pointer;font-size:12px;letter-spacing:1px`
  );
}

function inputCss(): string {
  return (
    `background:#0a0d12;border:1px solid #2b3340;border-left:2px solid ${ACCENT};border-radius:3px;` +
    `color:#fff;font-size:13px;padding:7px 9px;outline:none;font-family:var(--ui-font)`
  );
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}
