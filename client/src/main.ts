import { Connection } from "./net/Connection";
import { Game } from "./game/Game";
delete document.body.dataset.theme; // single fixed theme
localStorage.removeItem("uiTheme");

const menu = document.getElementById("menu")!;
const nameInput = document.getElementById("name") as HTMLInputElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const status = document.getElementById("status")!;

nameInput.value = localStorage.getItem("callsign") || "";

async function start() {
  const name = nameInput.value.trim() || "Player";
  localStorage.setItem("callsign", name);
  playBtn.disabled = true;
  status.textContent = "Connecting…";

  try {
    const conn = new Connection();
    const room = await conn.connect(name);
    status.textContent = "";
    menu.classList.add("hidden");
    new Game(room, conn.sessionId);
  } catch (err) {
    console.error(err);
    status.textContent = "Could not reach the server. Is it running?";
    playBtn.disabled = false;
  }
}

playBtn.addEventListener("click", start);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") start();
});
