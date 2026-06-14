import { InputCmd } from "../../../shared/phys";

// Captures keyboard + mouse. Owns the authoritative look angles (yaw/pitch),
// which it integrates from raw mouse movement while the pointer is locked.
export class Input {
  private keys = new Set<string>();
  yaw = 0;
  pitch = 0;
  firing = false;
  ads = false; // aiming down sights (right mouse held)
  pingQueued = false; // middle-click, consumed by Game once per press

  consumePing(): boolean {
    const q = this.pingQueued;
    this.pingQueued = false;
    return q;
  }
  locked = false;
  sensitivity = 0.0022;
  adsSensitivity = 0.0012; // slower turn while scoped

  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "Space" || e.code === "Tab") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("mousedown", (e) => {
      if (!this.locked) {
        el.requestPointerLock();
        return;
      }
      if (e.button === 0) this.firing = true;
      if (e.button === 1) this.pingQueued = true; // middle-click: team ping
      if (e.button === 2) this.ads = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.ads = false;
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) {
        this.firing = false;
        this.ads = false;
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      const s = this.ads ? this.adsSensitivity : this.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      const limit = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });
  }

  lock() {
    this.el.requestPointerLock();
  }

  command(seq: number, dtMs: number): InputCmd {
    return {
      seq,
      dtMs,
      forward: this.keys.has("KeyW") || this.keys.has("ArrowUp"),
      back: this.keys.has("KeyS") || this.keys.has("ArrowDown"),
      left: this.keys.has("KeyA") || this.keys.has("ArrowLeft"),
      right: this.keys.has("KeyD") || this.keys.has("ArrowRight"),
      jump: this.keys.has("Space"),
      crouch: this.keys.has("ControlLeft") || this.keys.has("KeyC") || this.keys.has("ShiftLeft"),
      yaw: this.yaw,
      pitch: this.pitch,
      lean: 0, // Game fills this in with the smoothed peek amount
    };
  }

  isDown(code: string) {
    return this.keys.has(code);
  }

  // peek/lean: -1 = lean left (Q), +1 = lean right (E)
  leanDir(): number {
    return (this.keys.has("KeyE") ? 1 : 0) - (this.keys.has("KeyQ") ? 1 : 0);
  }
}
