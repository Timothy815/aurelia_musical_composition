export interface NoteData {
  id: string; // unique
  pitch: string; // e.g., 'C4', 'C#4', 'D4'
  start: number; // in beats
  duration: number; // in beats
  isRest?: boolean;
}

export interface TrackData {
  id: string;
  name: string;
  instrument: string;
  notes: NoteData[];
}

export interface SongData {
  tempo: number;
  timeSignature: number[]; // e.g., [4, 4]
  tracks: TrackData[];
}

export type InputMode = 'compose' | 'chord_builder';
