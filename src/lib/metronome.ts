// Metronom: klick i låtens tempo, med betoning på taktens första slag.

/** Slag per minut från {tempo}: "96", "96 bpm", "♩=96" eller "ca 100". */
export function parseTempo(value: string | undefined): number | undefined {
  const m = /(\d{2,3}(?:[.,]\d+)?)/.exec(value ?? '');
  const bpm = m ? Number(m[1].replace(',', '.')) : NaN;
  return bpm >= 20 && bpm <= 400 ? bpm : undefined;
}

/** Slag per takt från {time}: "3/4" ger 3. Utan (eller med okänd) taktart: 4. */
export function beatsPerBar(time: string | undefined): number {
  const m = /^\s*(\d{1,2})\s*\/\s*\d{1,2}\s*$/.exec(time ?? '');
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= 16 ? n : 4;
}

/** Längsta paus mellan två knackningar (ms) innan räkningen börjar om. */
export const TAP_RESET_MS = 2000;

/**
 * Tempot från knackningar (tidpunkter i ms): medelvärdet av de senaste åtta mellanrummen,
 * avrundat till helt slag per minut. Minst två knackningar behövs.
 */
export function tapTempo(times: number[]): number | undefined {
  const recent = times.slice(-9);
  if (recent.length < 2) return undefined;
  const avg = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
  const bpm = Math.round(60000 / avg);
  return bpm >= 20 && bpm <= 400 ? bpm : undefined;
}

/** Hur långt fram klicken schemaläggs (s) och hur ofta det fylls på (ms). */
const LOOKAHEAD = 0.12;
const INTERVAL = 25;

export class Metronome {
  private ctx: AudioContext | null = null;
  private timer = 0;
  private next = 0;
  private beat = 0;
  private bpm = 100;
  private beats = 4;
  /** Slag som schemalagts men inte visats än */
  private queue: { at: number; beat: number }[] = [];
  private raf = 0;
  /** Ökar vid varje start och stopp, så att en sen start inte sätter igång en stoppad metronom */
  private run = 0;

  /** onBeat anropas när ett slag hörs (för att visa takten), med slagets nummer från 0. */
  constructor(private onBeat?: (beat: number) => void) {}

  get running(): boolean {
    return this.timer !== 0;
  }

  /** Måste anropas från ett tryck, annars får sidan inte spela ljud. */
  start(bpm: number, beats: number) {
    this.stop();
    // iPhone: spela även när ljudet är avstängt med knappen på sidan (som en musikapp)
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    const ctx = (this.ctx ??= new AudioContext());
    // iPhone: ljudet avbryts av t.ex. ett samtal; fortsätt när det går igen
    ctx.onstatechange = () => {
      if (this.timer && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => undefined);
    };
    this.bpm = bpm;
    this.beats = beats;
    this.beat = 0;
    // Räknas som igång direkt; klicken börjar när ljudet har vaknat (annars hamnar
    // blinkningen ur fas med ljudet i början)
    const run = ++this.run;
    this.timer = -1;
    void ctx.resume().then(() => {
      if (run !== this.run) return;
      this.next = ctx.currentTime + 0.05;
      this.timer = window.setInterval(() => this.schedule(), INTERVAL);
      this.schedule();
      this.raf = requestAnimationFrame(this.show);
    });
  }

  stop() {
    this.run++;
    if (this.timer > 0) window.clearInterval(this.timer);
    this.timer = 0;
    cancelAnimationFrame(this.raf);
    this.queue = [];
  }

  close() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    // Har sidan legat i bakgrunden: hoppa fram i stället för att spela ikapp
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      const beat = this.beat;
      this.click(this.next, beat === 0 && this.beats > 1);
      this.queue.push({ at: this.next, beat });
      this.next += 60 / this.bpm;
      this.beat = (beat + 1) % this.beats;
    }
  }

  /** Visar slagen när ljudets klocka når dem (samma klocka som klicken spelas efter). */
  private show = () => {
    const ctx = this.ctx;
    if (!ctx || !this.timer) return;
    let last: number | undefined;
    while (this.queue.length && this.queue[0].at <= ctx.currentTime) last = this.queue.shift()!.beat;
    if (last !== undefined) this.onBeat?.(last);
    this.raf = requestAnimationFrame(this.show);
  };

  private click(at: number, accent: boolean) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accent ? 1 : 0.6, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.06);
  }
}
