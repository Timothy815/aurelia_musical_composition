export type InstrumentPreset = 'piano' | 'guitar' | 'strings' | 'brass' | 'bass' | 'flute' | 'organ' | 'synth';

export interface NoteData {
  id: string;
  pitch: string; // e.g., 'C4', 'C#4'
  start: number; // in beats
  duration: number; // in beats
  isRest?: boolean;
  voice?: 1 | 2;
}

export interface TrackData {
  id: string;
  name: string;
  instrument: InstrumentPreset;
  notes: NoteData[];
}

export interface SongData {
  title?: string;
  composer?: string;
  tempo: number;
  timeSignature: number[]; // e.g., [4, 4]
  tracks: TrackData[];
  keySignature?: string; // e.g., 'C', 'G', 'F', 'Bb'
}

export type InputMode = 'compose' | 'chord_builder';
