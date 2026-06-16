import { SongData, TrackData, InstrumentPreset } from '../types';

export const CHROMATIC_UP   = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const CHROMATIC_DOWN = ['C', 'Db', 'D', 'Eb',  'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb',  'B'];
export const KEYS_BY_PC     = ['C', 'Db', 'D', 'Eb',  'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb',  'B'];
export const KEY_TO_PC: Record<string, number> = {
  C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11
};

export function transposeNote(pitch: string, semitones: number): string {
  const m = pitch.match(/^([A-G][#b]?)(\d+)$/);
  if (!m) return pitch;
  let noteIdx = CHROMATIC_UP.indexOf(m[1]);
  if (noteIdx === -1) noteIdx = CHROMATIC_DOWN.indexOf(m[1]);
  if (noteIdx === -1) return pitch;
  const newMidi = noteIdx + (parseInt(m[2]) + 1) * 12 + semitones;
  const newPc = ((newMidi % 12) + 12) % 12;
  const newOctave = Math.floor(newMidi / 12) - 1;
  return `${(semitones >= 0 ? CHROMATIC_UP : CHROMATIC_DOWN)[newPc]}${newOctave}`;
}

export function transposeSong(song: SongData, semitones: number): SongData {
  const currentPc = KEY_TO_PC[song.keySignature ?? 'C'] ?? 0;
  const newPc = ((currentPc + semitones) % 12 + 12) % 12;
  return {
    ...song,
    keySignature: KEYS_BY_PC[newPc],
    tracks: song.tracks.map(t => ({
      ...t,
      notes: t.notes.map(n => n.isRest ? n : { ...n, pitch: transposeNote(n.pitch, semitones) })
    }))
  };
}

export const MIDI_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiNoteToString(n: number): string {
  return `${MIDI_NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

export const KEY_SIGNATURES = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'];

export const INSTRUMENT_LABELS: Record<InstrumentPreset, string> = {
  piano: 'Piano', guitar: 'Guitar', strings: 'Strings', brass: 'Brass',
  bass: 'Bass', flute: 'Flute', organ: 'Organ', synth: 'Synth', drums: 'Drums'
};

export const TRACK_COLORS = ['#D4AF37', '#4D96FF', '#FF6B6B', '#4ECDC4', '#95E06C', '#FF8C42', '#C77DFF'];

export const DEFAULT_TRACK: TrackData = {
  id: 'track-1', name: 'Piano', instrument: 'piano', notes: [], color: TRACK_COLORS[0]
};

export const DEFAULT_SONG: SongData = {
  tempo: 120, timeSignature: [4, 4], tracks: [DEFAULT_TRACK], keySignature: 'C'
};
