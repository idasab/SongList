// Uppspelning av noter (ABC) med abcjs. Ljuden (pianot) hämtas från nätet första gången.
import type { MidiBuffer } from 'abcjs';
import { loadAbcjs } from './abc';

export class AbcPlayer {
  private synth: MidiBuffer | null = null;
  private ctx: AudioContext | null = null;

  /**
   * Spelar noterna transponerade (i halvtoner). Anropas direkt från ett tryck: iOS tillåter
   * bara ljud som startas så. onEnded anropas när noterna spelats klart.
   */
  async play(abc: string, transpose: number, onEnded: () => void): Promise<void> {
    this.stop();
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    const lib = await loadAbcjs();
    const [tune] = lib.renderAbc('*', abc);
    if (!tune) throw new Error('Hittade inga noter att spela');
    const synth = new lib.synth.CreateSynth();
    this.synth = synth;
    await synth.init({
      visualObj: tune,
      audioContext: this.ctx,
      millisecondsPerMeasure: tune.millisecondsPerMeasure(),
      options: {
        midiTranspose: transpose,
        // Stämmorna utan ackordkomp, så att de hörs tydligt
        chordsOff: true,
        // abcjs läser onEnded här (inte bredvid options)
        onEnded: () => {
          if (this.synth === synth) this.synth = null;
          onEnded();
        },
      },
    });
    // Stoppad medan ljuden laddades
    if (this.synth !== synth) return;
    await synth.prime();
    if (this.synth !== synth) return;
    synth.start();
  }

  stop() {
    this.synth?.stop();
    this.synth = null;
  }

  close() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
