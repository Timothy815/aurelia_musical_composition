import * as Tone from 'tone';
import { SongData } from '../types';

class AudioEngine {
  initialized = false;
  sampler: Tone.Sampler | null = null;
  synth: Tone.PolySynth | null = null;
  metronomeSynth: Tone.Synth | null = null;
  metronomeLoop: Tone.Loop | null = null;
  isMetronomeEnabled = false;

  onNotePlay?: (pitch: string) => void;
  onNoteStop?: (pitch: string) => void;

  async init() {
    if (this.initialized) return;
    await Tone.start();
    
    // Setup fallback synth
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 1 }
    }).toDestination();

    // Setup high quality sampler
    this.sampler = new Tone.Sampler({
      urls: {
        A0: "A0.mp3",
        C1: "C1.mp3",
        "D#1": "Ds1.mp3",
        "F#1": "Fs1.mp3",
        A1: "A1.mp3",
        C2: "C2.mp3",
        "D#2": "Ds2.mp3",
        "F#2": "Fs2.mp3",
        A2: "A2.mp3",
        C3: "C3.mp3",
        "D#3": "Ds3.mp3",
        "F#3": "Fs3.mp3",
        A3: "A3.mp3",
        C4: "C4.mp3",
        "D#4": "Ds4.mp3",
        "F#4": "Fs4.mp3",
        A4: "A4.mp3",
        C5: "C5.mp3",
        "D#5": "Ds5.mp3",
        "F#5": "Fs5.mp3",
        A5: "A5.mp3",
        C6: "C6.mp3",
        "D#6": "Ds6.mp3",
        "F#6": "Fs6.mp3",
        A6: "A6.mp3",
        C7: "C7.mp3",
        "D#7": "Ds7.mp3",
        "F#7": "Fs7.mp3",
        A7: "A7.mp3",
        C8: "C8.mp3"
      },
      release: 1,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
    }).toDestination();

    // Metronome track
    this.metronomeSynth = new Tone.Synth({
      oscillator: { type: "square" },
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 }
    }).toDestination();
    this.metronomeSynth.volume.value = -10;

    this.initialized = true;
  }

  playNoteRealtime(pitch: string) {
    if (!this.initialized) return;
    if (this.sampler && this.sampler.loaded) {
      this.sampler.triggerAttack(pitch);
    } else if (this.synth) {
      this.synth.triggerAttack(pitch);
    }
  }

  stopNoteRealtime(pitch: string) {
    if (!this.initialized) return;
    if (this.sampler && this.sampler.loaded) {
      this.sampler.triggerRelease(pitch);
    } else if (this.synth) {
      this.synth.triggerRelease(pitch);
    }
  }

  playNotePreview(pitch: string) {
    if (!this.initialized) return;
    if (this.sampler && this.sampler.loaded) {
      this.sampler.triggerAttackRelease(pitch, "8n");
    } else if (this.synth) {
      this.synth.triggerAttackRelease(pitch, "8n");
    }
  }
  
  playChordRealtime(pitches: string[]) {
    if (!this.initialized) return;
    if (this.sampler && this.sampler.loaded) {
      this.sampler.triggerAttackRelease(pitches, "2n");
    } else if (this.synth) {
      this.synth.triggerAttackRelease(pitches, "2n");
    }
  }

  setMetronome(enabled: boolean, timeSignature: number[]) {
    this.isMetronomeEnabled = enabled;
    if (this.metronomeLoop) {
      this.metronomeLoop.dispose();
      this.metronomeLoop = null;
    }
    
    if (enabled && this.metronomeSynth) {
      const beatsPerBar = timeSignature[0];
      let currentBeat = 0;
      this.metronomeLoop = new Tone.Loop((time) => {
        if (currentBeat % beatsPerBar === 0) {
          this.metronomeSynth!.triggerAttackRelease("C6", "32n", time, 1);
        } else {
          this.metronomeSynth!.triggerAttackRelease("G5", "32n", time, 0.5);
        }
        currentBeat++;
      }, "4n");
      this.metronomeLoop.start(0);
    }
  }

  scheduleSong(song: SongData) {
    Tone.Transport.cancel(0);
    Tone.Transport.bpm.value = song.tempo;
    Tone.Transport.timeSignature = song.timeSignature;

    this.setMetronome(this.isMetronomeEnabled, song.timeSignature);

    const instrument = (this.sampler && this.sampler.loaded) ? this.sampler : this.synth;
    if (!instrument) return;

    song.tracks.forEach(track => {
      track.notes.forEach(note => {
        if (note.isRest) return;
        
        // Schedule using Transport time format (e.g., "0:2:0" = bar 0, beat 2, 16th 0)
        // Note.start is in beats. 
        const bars = Math.floor(note.start / song.timeSignature[0]);
        const beats = Math.floor(note.start % song.timeSignature[0]);
        const sixteenths = Math.round((note.start % 1) * 4);
        
        const startTime = `${bars}:${beats}:${sixteenths}`;
        
        // duration in seconds for calculation
        const durationBeats = note.duration;
        const durationSecs = durationBeats * (60 / song.tempo);
        
        Tone.Transport.schedule((time) => {
          instrument.triggerAttackRelease(note.pitch, durationSecs, time);
          Tone.Draw.schedule(() => {
            if (this.onNotePlay) this.onNotePlay(note.pitch);
          }, time);
          Tone.Draw.schedule(() => {
            if (this.onNoteStop) this.onNoteStop(note.pitch);
          }, time + durationSecs);
        }, startTime);
      });
    });
    
    // Better way to schedule using Part
    // To do this properly, we clear previous schedules.
  }

  play(song: SongData) {
    if (!this.initialized) return;
    if (Tone.Transport.state !== 'started') {
      this.scheduleSong(song);
      Tone.Transport.start();
    }
  }

  stop() {
    if (!this.initialized) return;
    Tone.Transport.stop();
    Tone.Transport.cancel(0);
  }

  setTempo(tempo: number) {
    Tone.Transport.bpm.value = tempo;
  }
}

export const audio = new AudioEngine();
