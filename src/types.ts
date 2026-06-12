export type InstrumentPreset = 'piano' | 'guitar' | 'strings' | 'brass' | 'bass' | 'flute' | 'organ' | 'synth';

export type DynamicMarking = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';
export type ArticulationMarking = 'staccato' | 'accent' | 'tenuto';

export interface NoteData {
  id: string;
  pitch: string; // e.g., 'C4', 'C#4'
  start: number; // in beats
  duration: number; // in beats
  isRest?: boolean;
  voice?: 1 | 2;
  dynamic?: DynamicMarking;
  articulation?: ArticulationMarking;
}

export interface TrackData {
  id: string;
  name: string;
  instrument: InstrumentPreset;
  notes: NoteData[];
  grandStaff?: boolean;
  volume?: number;  // 0–1, default 1
  muted?: boolean;
  solo?: boolean;
  color?: string;   // hex accent color for this track
}

export interface TempoChange {
  beat: number; // same units as NoteData.start (quarter-note beats from start)
  bpm: number;
}

export interface RepeatMarker {
  measure: number; // 1-based
  type: 'start' | 'end';
}

export interface SongData {
  title?: string;
  composer?: string;
  tempo: number;
  timeSignature: number[]; // e.g., [4, 4]
  tracks: TrackData[];
  keySignature?: string; // e.g., 'C', 'G', 'F', 'Bb'
  tempoChanges?: TempoChange[];
  repeats?: RepeatMarker[];
}

export type InputMode = 'compose' | 'chord_builder';

// ── Effects chain ──────────────────────────────────────────────────────────

export interface EffectParam {
  enabled: boolean;
  wet: number; // 0–1
}

export interface EffectsSettings {
  reverb:    EffectParam & { roomSize: number; };
  delay:     EffectParam & { time: number; feedback: number; };
  chorus:    EffectParam & { depth: number; frequency: number; };
  phaser:    EffectParam & { frequency: number; };
  tremolo:   EffectParam & { frequency: number; depth: number; };
  overdrive: EffectParam & { amount: number; };
  fuzz:      EffectParam & { order: number; };
  flanger:   EffectParam & { depth: number; frequency: number; };
}

export const DEFAULT_EFFECTS: EffectsSettings = {
  reverb:    { enabled: false, wet: 0.40, roomSize: 0.7 },
  delay:     { enabled: false, wet: 0.30, time: 0.375, feedback: 0.40 },
  chorus:    { enabled: false, wet: 0.50, depth: 0.7,  frequency: 1.5 },
  phaser:    { enabled: false, wet: 0.50, frequency: 0.5 },
  tremolo:   { enabled: false, wet: 0.80, frequency: 4,  depth: 0.8 },
  overdrive: { enabled: false, wet: 0.60, amount: 0.4 },
  fuzz:      { enabled: false, wet: 0.50, order: 50 },
  flanger:   { enabled: false, wet: 0.50, depth: 0.5,  frequency: 0.3 },
};
