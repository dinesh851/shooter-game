// Pre-match lobby overlay: pick a side (BLUE / RED), ready up, and the host
// starts the match once everyone is ready. Also renders the end-of-match
// scoreboard with MVP / accuracy / longest-kill stats.

import { TEAM_NAMES } from "../../../shared/phys";

const TEAM_CSS = ["#3b82f6", "#e23b3b"];

export class Lobby {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private title: HTMLDivElement;
  private visible = false;
  private mode: "lobby" | "score" | "hidden" = "hidden";
  private sig = ""; // last rendered lobby state - rebuild only on change

  onSelectTeam?: (team: number) => void;
  onReady?: (ready: boolean) => void;
  onStart?: () => void;
  onAddBot?: () => void;
  onWeather?: (w: string) => void;

  constructor() {
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:fixed;inset:0;display:none;z-index:40;align-items:center;justify-content:center;" +
      "background:rgba(6,10,8,0.55);backdrop-filter:blur(3px);font-family:var(--ui-font);color:var(--text)";
    const panel = document.createElement("div");
    panel.style.cssText =
      "min-width:560px;max-width:720px;background:var(--panel-bg);border:1px solid var(--panel-border);" +
      "border-radius:var(--radius);padding:22px 26px;box-shadow:var(--panel-glow)";
    this.title = document.createElement("div");
    this.title.style.cssText = "font-size:22px;font-weight:800;margin-bottom:14px;letter-spacing:0.04em";
    this.body = document.createElement("div");
    panel.append(this.title, this.body);
    this.root.appendChild(panel);
    document.body.appendChild(this.root);
  }

  hide() {
    if (this.mode === "hidden") return;
    this.mode = "hidden";
    this.visible = false;
    this.sig = "";
    this.root.style.display = "none";
  }

  // ---- lobby ---------------------------------------------------------------

  showLobby(state: any, meId: string) {
    this.mode = "lobby";
    if (!this.visible) {
      this.visible = true;
      this.root.style.display = "flex";
      document.exitPointerLock?.();
    }

    const me = state.players.get(meId);
    const isHost = state.hostId === meId;
    const teams: { name: string; ready: boolean; bot: boolean; me: boolean }[][] = [[], []];
    let allReady = true;
    let sig = `${isHost}|${me?.ready}|${state.weather}`;
    state.players.forEach((p: any, id: string) => {
      teams[p.team === 1 ? 1 : 0].push({ name: p.name, ready: p.ready, bot: p.bot, me: id === meId });
      if (!p.bot && !p.ready) allReady = false;
      sig += `;${id},${p.team},${p.ready},${p.name}`;
    });
    // rebuilding the DOM detaches buttons mid-click - only do it on real change
    if (sig === this.sig) return;
    this.sig = sig;

    this.title.textContent = "MATCH LOBBY";
    this.title.style.color = "var(--text)";

    const col = (t: number) => `
      <div style="flex:1;border:2px solid ${TEAM_CSS[t]};border-radius:10px;padding:10px 12px;min-height:170px">
        <div style="font-weight:800;color:${TEAM_CSS[t]};margin-bottom:8px">${TEAM_NAMES[t]} (${teams[t].length})</div>
        ${teams[t]
          .map(
            (p) => `
          <div style="display:flex;justify-content:space-between;padding:3px 0;${p.me ? "font-weight:800" : ""}">
            <span>${esc(p.name)}${p.me ? " (you)" : ""}</span>
            <span style="color:${p.ready ? "#7ee787" : "#8b949e"}">${p.bot ? "BOT" : p.ready ? "READY" : "..."}</span>
          </div>`
          )
          .join("")}
        <button data-act="team${t}" style="${btnCss(TEAM_CSS[t])};margin-top:8px;width:100%">JOIN ${TEAM_NAMES[t]}</button>
      </div>`;

    const weatherRow = isHost
      ? `<div style="display:flex;gap:8px;margin-top:14px;align-items:center">
          <span style="color:var(--text-dim);font-size:12px;letter-spacing:1px">WEATHER</span>
          ${["sunny", "mist", "heavy", "rain"]
            .map(
              (w) => `<button data-act="wx:${w}" style="background:${
                state.weather === w ? "var(--accent)" : "rgba(255,255,255,0.08)"
              };color:${state.weather === w ? "#1a1408" : "var(--text)"};border:1px solid var(--panel-border);border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;text-transform:uppercase">${w}</button>`
            )
            .join("")}
          <span style="color:var(--text-dim);font-size:11px">(V cycles in-game)</span>
        </div>`
      : "";

    this.body.innerHTML = `
      <div style="display:flex;gap:14px">${col(0)}${col(1)}</div>
      ${weatherRow}
      <div style="display:flex;gap:10px;margin-top:16px;align-items:center">
        <button data-act="ready" style="${btnCss(me?.ready ? "#8b949e" : "#7ee787")};flex:1">
          ${me?.ready ? "UNREADY" : "READY"}
        </button>
        ${isHost ? `<button data-act="bot" style="${btnCss("#c9a24b")}">+ BOT</button>` : ""}
        ${
          isHost
            ? `<button data-act="start" ${allReady ? "" : "disabled"}
                style="${btnCss(allReady ? "#58a6ff" : "#444c44")};flex:1;${allReady ? "" : "opacity:0.5;cursor:default"}">
                START MATCH</button>`
            : `<span style="color:var(--text-dim);font-size:13px">waiting for the host to start...</span>`
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

  // ---- end-of-match scoreboard ----------------------------------------------

  showScoreboard(state: any) {
    this.mode = "score";
    if (!this.visible) {
      this.visible = true;
      this.root.style.display = "flex";
      document.exitPointerLock?.();
    }
    const winner =
      state.scoreTeam0 === state.scoreTeam1 ? -1 : state.scoreTeam0 > state.scoreTeam1 ? 0 : 1;
    this.title.textContent =
      winner < 0 ? "DRAW" : `${TEAM_NAMES[winner]} TEAM WINS  ${state.scoreTeam0} : ${state.scoreTeam1}`;
    this.title.style.color = winner < 0 ? "var(--text)" : TEAM_CSS[winner];

    const rows: any[] = [];
    state.players.forEach((p: any) => rows.push(p));
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const mvp = rows[0];

    this.body.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="color:var(--text-dim);text-align:left">
          <th style="padding:4px 6px">PLAYER</th><th>K</th><th>D</th><th>ACC</th><th>LONGEST</th>
        </tr>
        ${rows
          .map((p) => {
            const acc = p.shots > 0 ? Math.round((100 * p.hits) / p.shots) + "%" : "-";
            const isMvp = mvp && p === mvp && p.kills > 0;
            return `<tr style="border-top:1px solid rgba(255,255,255,0.08);${isMvp ? "background:rgba(201,162,75,0.15)" : ""}">
              <td style="padding:5px 6px;color:${TEAM_CSS[p.team === 1 ? 1 : 0]};font-weight:700">
                ${esc(p.name)} ${isMvp ? "&#9733; MVP" : ""}</td>
              <td>${p.kills}</td><td>${p.deaths}</td><td>${acc}</td><td>${p.longest > 0 ? p.longest + " m" : "-"}</td>
            </tr>`;
          })
          .join("")}
      </table>
      <div style="margin-top:12px;color:var(--text-dim);font-size:13px">returning to the lobby...</div>`;
  }
}

function btnCss(color: string): string {
  return (
    `background:${color};color:#0b0f0c;font-weight:800;border:none;border-radius:8px;` +
    `padding:10px 16px;cursor:pointer;font-size:14px;letter-spacing:0.03em`
  );
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}
