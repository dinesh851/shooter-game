import { WeaponId } from "../../../shared/weapons";

// Procedural sound — synthesized with the WebAudio API so we ship zero audio
// files. Each gun gets a noise burst (the "crack") plus a low sine "thump".
export class Audio {
  private ctx: AudioContext;
  private noiseBuf: AudioBuffer;
  private master: GainNode;

  constructor() {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // 0.4s of white noise we reuse for every shot
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  // call from a user gesture (the Play click) so autoplay policies allow sound
  resume() {
    if (this.ctx.state !== "running") this.ctx.resume();
  }

  private now() {
    return this.ctx.currentTime;
  }

  shot(weapon: WeaponId) {
    const t = this.now();
    const cfg: Partial<Record<WeaponId, { gain: number; dur: number; cut: number; thump: number }>> = {
      rifle: { gain: 0.6, dur: 0.16, cut: 3200, thump: 120 },
      smg: { gain: 0.45, dur: 0.1, cut: 4200, thump: 160 },
      pistol: { gain: 0.55, dur: 0.14, cut: 2600, thump: 110 },
      sniper: { gain: 0.9, dur: 0.32, cut: 1800, thump: 70 },
    };
    const c = cfg[weapon] ?? cfg.rifle!;

    // noise crack
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = c.cut;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(c.gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + c.dur);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + c.dur + 0.02);

    // low thump
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(c.thump, t);
    osc.frequency.exponentialRampToValueAtTime(c.thump * 0.5, t + c.dur);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(c.gain * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + c.dur);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + c.dur + 0.02);
  }

  click() {
    this.blip(900, 0.04, 0.12, "square");
  }

  empty() {
    this.blip(220, 0.05, 0.15, "square");
  }

  reload() {
    // two mechanical clicks
    this.blip(420, 0.05, 0.18, "square", 0);
    this.blip(300, 0.05, 0.18, "square", 0.12);
    this.blip(620, 0.04, 0.18, "square", 0.5);
  }

  hit() {
    this.blip(1500, 0.03, 0.2, "sine");
  }

  // a soft grass rustle (or a wetter slosh) — gain pre-scaled by distance
  footstep(gain: number, water = false) {
    if (gain < 0.01) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = water ? 0.55 : 0.85 + Math.random() * 0.3;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = water ? 700 : 2200 + Math.random() * 800;
    bp.Q.value = water ? 0.8 : 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (water ? 0.22 : 0.12));
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.26);
  }

  ping() {
    this.blip(1180, 0.07, 0.22, "sine");
    this.blip(1480, 0.09, 0.18, "sine", 0.08);
  }

  // rocket launch: a sharp ignition crack + a rising whoosh as the motor lights
  rocketLaunch() {
    const t = this.now();
    // whoosh: filtered noise sweeping up
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1600, t + 0.4);
    bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.8, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.55);
    // ignition thump
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.25);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.7, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  boom() {
    const t = this.now();
    // low rumble sweep
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.5);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.95, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.62);
    // noise crack
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.85, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.34);
  }

  private blip(freq: number, dur: number, gain: number, type: OscillatorType, delay = 0) {
    const t = this.now() + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}
