import React, { useState, useEffect, useMemo, useCallback, useReducer, useRef } from 'react';
import { Chord } from '@tonaljs/tonal';
import { Play, Square, Plus, RotateCcw, RotateCw, Copy, Repeat } from 'lucide-react';
import { SongData, TrackData, NoteData, InstrumentPreset, DynamicMarking, ArticulationMarking, EffectsSettings, DEFAULT_EFFECTS, TempoChange, RepeatMarker } from './types';
import { generateId, cn } from './lib/utils';
import { audio } from './lib/audio';
import { Keyboard } from './components/Keyboard';
import { Fretboard } from './components/Fretboard';
import { Notation } from './components/Notation';
import { exportToMidi, exportToPdf, exportToMusicXML, saveFile, loadFile } from './lib/export';

// ── History reducer for undo/redo ──────────────────────────────────────────
type HistoryState = { past: SongData[]; present: SongData; future: SongData[] };
type HistoryAction =
  | { type: 'SET'; payload: SongData }
  | { type: 'PATCH_META'; payload: { title?: string; composer?: string } }
  | { type: 'UNDO' }
  | { type: 'REDO' };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'SET': {
      if (JSON.stringify(action.payload) === JSON.stringify(state.present)) return state;
      return {
        past: [...state.past.slice(-49), state.present],
        present: action.payload,
        future: []
      };
    }
    case 'PATCH_META':
      return { ...state, present: { ...state.present, ...action.payload } };
    case 'UNDO':
      if (state.past.length === 0) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future]
      };
    case 'REDO':
      if (state.future.length === 0) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1)
      };
  }
}

// ── Transpose helpers ──────────────────────────────────────────────────────
const CHROMATIC_UP   = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CHROMATIC_DOWN = ['C', 'Db', 'D', 'Eb',  'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb',  'B'];
const KEYS_BY_PC     = ['C', 'Db', 'D', 'Eb',  'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb',  'B'];
const KEY_TO_PC: Record<string, number> = {
  C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11
};

function transposeNote(pitch: string, semitones: number): string {
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

function transposeSong(song: SongData, semitones: number): SongData {
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

// ── MIDI helpers ──────────────────────────────────────────────────────────
const MIDI_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiNoteToString(n: number): string {
  return `${MIDI_NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

// ── Constants ──────────────────────────────────────────────────────────────
const KEY_SIGNATURES = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'];
const INSTRUMENT_LABELS: Record<InstrumentPreset, string> = {
  piano: 'Piano', guitar: 'Guitar', strings: 'Strings', brass: 'Brass',
  bass: 'Bass', flute: 'Flute', organ: 'Organ', synth: 'Synth'
};

const DEFAULT_TRACK: TrackData = {
  id: 'track-1', name: 'Piano', instrument: 'piano', notes: []
};

const DEFAULT_SONG: SongData = {
  tempo: 120, timeSignature: [4, 4], tracks: [DEFAULT_TRACK], keySignature: 'C'
};

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [histState, dispatch] = useReducer(historyReducer, {
    past: [], present: DEFAULT_SONG, future: []
  });
  const song = histState.present;

  const setSong = useCallback((updater: SongData | ((s: SongData) => SongData)) => {
    dispatch({
      type: 'SET',
      payload: typeof updater === 'function' ? updater(histState.present) : updater
    });
  }, [histState.present]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayMode] = useState(true);
  const [metronomeStatus, setMetronomeStatus] = useState(false);
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const [playingNotes, setPlayingNotes] = useState<Set<string>>(new Set());
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [isDotted, setIsDotted] = useState(false);
  const [isRest, setIsRest] = useState(false);
  const [chordSelectMode, setChordSelectMode] = useState(false);
  const [harmonyMode, setHarmonyMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [instrumentView, setInstrumentView] = useState<'keyboard' | 'fretboard'>('keyboard');
  const [activeVoice, setActiveVoice] = useState<1 | 2>(1);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(8);
  const [showGuitarTab, setShowGuitarTab] = useState(false);
  const [clipboard, setClipboard] = useState<{ notes: NoteData[]; trackIds: string[] } | null>(null);
  const [pianoReady, setPianoReady] = useState(false);
  const [selectedDynamic, setSelectedDynamic] = useState<DynamicMarking | null>(null);
  const [selectedArticulation, setSelectedArticulation] = useState<ArticulationMarking | null>(null);
  const [effectsSettings, setEffectsSettings] = useState<EffectsSettings>(DEFAULT_EFFECTS);
  const [showEffects, setShowEffects] = useState(false);
  const recordingClickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showTempoChanges, setShowTempoChanges] = useState(false);
  const [showRepeats, setShowRepeats] = useState(false);
  const [newTcMeasure, setNewTcMeasure] = useState('1');
  const [newTcBpm, setNewTcBpm] = useState('120');
  const [newRepeatMeasure, setNewRepeatMeasure] = useState('1');
  const [newRepeatType, setNewRepeatType] = useState<'start' | 'end'>('start');

  // MIDI recording state
  const [midiEnabled, setMidiEnabled] = useState(false);
  const [midiDeviceName, setMidiDeviceName] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [countInDisplay, setCountInDisplay] = useState(0);
  const [quantGrid, setQuantGrid] = useState(4); // 4 = 16th note, 2 = 8th, 8 = 32nd
  // Refs for MIDI handler (avoids stale closures — refs always hold latest values)
  const isRecordingRef = useRef(false);
  const recordingStartTimeRef = useRef<number | null>(null);
  const quantGridRef = useRef(4);
  const songTempoRef = useRef(song.tempo);
  const pendingMidiNotes = useRef<Map<number, number>>(new Map()); // midiNum → startMs
  const recordedMidiNotes = useRef<NoteData[]>([]);
  const handleNoteOnRef = useRef<(p: string) => void>(() => {});
  const handleNoteOffRef = useRef<(p: string) => void>(() => {});
  const midiAccessRef = useRef<MIDIAccess | null>(null);

  useEffect(() => {
    const initFn = () => {
      audio.init().then(() => {
        if (audio.sampler?.loaded) setPianoReady(true);
      }).catch(console.error);
    };
    // Start init on any user gesture so audio is ready before the first note
    window.addEventListener('mousedown', initFn, { once: true });
    window.addEventListener('keydown', initFn, { once: true });
    window.addEventListener('touchstart', initFn, { once: true });
    audio.onNotePlay = (p) => setPlayingNotes(prev => { const n = new Set(prev); n.add(p); return n; });
    audio.onNoteStop = (p) => setPlayingNotes(prev => { const n = new Set(prev); n.delete(p); return n; });
    audio.onSamplerLoad = () => setPianoReady(true);
    // Catch the case where the sampler already finished loading before this
    // effect ran (e.g. hot-reload keeps the audio singleton but resets state)
    if (audio.sampler?.loaded) setPianoReady(true);
    return () => {
      window.removeEventListener('mousedown', initFn);
      window.removeEventListener('keydown', initFn);
      window.removeEventListener('touchstart', initFn);
    };
  }, []);

  // Keep MIDI refs in sync with latest render state
  useEffect(() => { songTempoRef.current = song.tempo; }, [song.tempo]);
  useEffect(() => { audio.setEffects(effectsSettings); }, [effectsSettings]);
  useEffect(() => { quantGridRef.current = quantGrid; }, [quantGrid]);

  // Stable MIDI message handler — reads mutable state from refs
  const midiMessageHandler = useCallback((e: MIDIMessageEvent) => {
    const data = e.data;
    if (data.length < 3) return; // clock / active-sensing messages have no note/velocity bytes
    const status = data[0] & 0xF0;
    const midiNote = data[1];
    const velocity = data[2];
    const pitch = midiNoteToString(midiNote);
    const isOn = status === 0x90 && velocity > 0;
    const isOff = status === 0x80 || (status === 0x90 && velocity === 0);

    if (isOn) {
      handleNoteOnRef.current(pitch);
      if (isRecordingRef.current && recordingStartTimeRef.current !== null) {
        pendingMidiNotes.current.set(midiNote, performance.now());
      }
    } else if (isOff) {
      handleNoteOffRef.current(pitch);
      if (isRecordingRef.current && recordingStartTimeRef.current !== null) {
        const startMs = pendingMidiNotes.current.get(midiNote);
        if (startMs !== undefined) {
          pendingMidiNotes.current.delete(midiNote);
          const tempo = songTempoRef.current;
          const grid = quantGridRef.current;
          const startBeats = ((startMs - recordingStartTimeRef.current!) / 1000) * (tempo / 60);
          const endBeats = ((performance.now() - recordingStartTimeRef.current!) / 1000) * (tempo / 60);
          const qStart = Math.round(startBeats * grid) / grid;
          const qDur = Math.max(1 / grid, Math.round((endBeats - startBeats) * grid) / grid);
          recordedMidiNotes.current.push({
            id: generateId(), pitch, start: qStart, duration: qDur, isRest: false, voice: 1
          });
        }
      }
    }
  }, []); // stable — all mutable values read from refs

  const combinedNotes = useMemo(() => {
    const c = new Set(activeNotes);
    playingNotes.forEach(n => c.add(n));
    if (selectedNoteIds.size > 0) {
      song.tracks.forEach(t => t.notes.forEach(n => {
        if (selectedNoteIds.has(n.id) && !n.isRest) c.add(n.pitch);
      }));
    }
    return c;
  }, [activeNotes, playingNotes, selectedNoteIds, song]);

  const togglePlay = async () => {
    await audio.init();
    if (isPlaying) {
      audio.stop();
      setIsPlaying(false);
      setPlayingNotes(new Set());
    } else {
      audio.play(song, loopEnabled, loopStart, loopEnd);
      setIsPlaying(true);
    }
  };

  const toggleMetronome = async () => {
    await audio.init();
    const next = !metronomeStatus;
    setMetronomeStatus(next);
    audio.setMetronome(next, song.timeSignature);
  };

  const handleNoteOn = async (pitch: string) => {
    await audio.init();
    // Guard against stale-state double-press: if note is already playing, stop it instead
    if (audio.realtimeNotes.has(pitch)) {
      handleNoteOff(pitch);
      return;
    }
    setActiveNotes(prev => { const n = new Set(prev); n.add(pitch); return n; });
    audio.playNoteRealtime(pitch);
  };

  const handleNoteOff = (pitch: string) => {
    setActiveNotes(prev => { const n = new Set(prev); n.delete(pitch); return n; });
    audio.stopNoteRealtime(pitch);
  };
  // MIDI path uses dedicated methods (isolated state, proper lookahead scheduling)
  handleNoteOnRef.current = (pitch: string) => {
    setActiveNotes(prev => { const n = new Set(prev); n.add(pitch); return n; });
    audio.playMidiNote(pitch);
  };
  handleNoteOffRef.current = (pitch: string) => {
    setActiveNotes(prev => { const n = new Set(prev); n.delete(pitch); return n; });
    audio.stopMidiNote(pitch);
  };

  const handleAppendToScore = useCallback(() => {
    if (activeNotes.size === 0 && !isRest) return;
    let fallbackDuration = selectedDuration;
    if (isDotted) fallbackDuration *= 1.5;

    const pitchList = Array.from(activeNotes);
    const newIds = (isRest ? ['_'] : pitchList).map(() => generateId());

    // In harmony mode, insert into the selected chord instead of appending to end.
    // If harmony mode is on but nothing is selected, do nothing.
    // Use the existing chord's duration so the rhythm stays intact.
    let insertTarget: { trackIdx: number; beat: number; duration: number } | null = null;
    if (harmonyMode) {
      if (selectedNoteIds.size === 0) return;
      for (let ti = 0; ti < song.tracks.length; ti++) {
        const selected = song.tracks[ti].notes.filter(n => selectedNoteIds.has(n.id));
        if (selected.length > 0) {
          const beat = Math.min(...selected.map(n => n.start));
          const duration = selected[0].duration;
          insertTarget = { trackIdx: ti, beat, duration };
          break;
        }
      }
    }

    setSong(prev => {
      const newTracks = [...prev.tracks];
      const dyn = selectedDynamic ?? undefined;
      const artic = selectedArticulation ?? undefined;

      if (insertTarget) {
        const { trackIdx, beat, duration } = insertTarget;
        const track = newTracks[trackIdx];
        const newNotes = [...track.notes];
        if (isRest) {
          newNotes.push({ id: newIds[0], pitch: 'B4', start: beat, duration, isRest: true });
        } else {
          pitchList.forEach((pitch, i) => {
            newNotes.push({ id: newIds[i], pitch, start: beat, duration, isRest: false, voice: activeVoice, dynamic: dyn, articulation: artic });
          });
        }
        newTracks[trackIdx] = { ...track, notes: newNotes };
      } else {
        const track = newTracks[0];
        let appendBeat = 0;
        if (track.notes.length > 0) {
          appendBeat = Math.max(...track.notes.map(n => n.start + n.duration));
        }
        const newNotes = [...track.notes];
        if (isRest) {
          newNotes.push({ id: newIds[0], pitch: 'B4', start: appendBeat, duration: fallbackDuration, isRest: true });
        } else {
          pitchList.forEach((pitch, i) => {
            newNotes.push({ id: newIds[i], pitch, start: appendBeat, duration: fallbackDuration, isRest: false, voice: activeVoice, dynamic: dyn, articulation: artic });
          });
        }
        newTracks[0] = { ...track, notes: newNotes };
      }

      return { ...prev, tracks: newTracks };
    });

    activeNotes.forEach(p => audio.stopNoteRealtime(p));
    setActiveNotes(new Set());

    if (insertTarget) {
      // Advance selection to the next beat so you can chain edits chord-by-chord
      const nextBeat = insertTarget.beat + insertTarget.duration;
      const nextNotes = song.tracks[insertTarget.trackIdx].notes.filter(
        n => Math.abs(n.start - nextBeat) < 0.01
      );
      setSelectedNoteIds(nextNotes.length > 0 ? new Set(nextNotes.map(n => n.id)) : new Set());
    } else {
      setSelectedNoteIds(new Set(newIds));
    }
  }, [activeNotes, isRest, selectedDuration, isDotted, activeVoice, selectedDynamic, selectedArticulation, setSong, setSelectedNoteIds, selectedNoteIds, song, harmonyMode]);

  const initMidi = useCallback(async () => {
    if (!('requestMIDIAccess' in navigator)) {
      alert('Web MIDI is not supported in this browser. Use Chrome or Edge.');
      return;
    }
    try {
      await audio.init();
      const access = await navigator.requestMIDIAccess({ sysex: false });
      midiAccessRef.current = access;
      for (const input of access.inputs.values()) {
        await input.open();
        input.addEventListener('midimessage', midiMessageHandler);
      }
      access.onstatechange = async (e) => {
        const port = (e as MIDIConnectionEvent).port;
        if (port.type === 'input' && port.state === 'connected') {
          const inp = port as MIDIInput;
          await inp.open();
          inp.addEventListener('midimessage', midiMessageHandler);
          setMidiDeviceName(port.name ?? 'Unknown');
        }
      };
      const inputs: MIDIInput[] = [];
      access.inputs.forEach(i => inputs.push(i));
      setMidiEnabled(true);
      setMidiDeviceName(inputs[0]?.name ?? (inputs.length === 0 ? 'No device found' : 'Connected'));
    } catch {
      alert('MIDI access denied. Allow MIDI access in browser settings and try again.');
    }
  }, [midiMessageHandler]);

  const disableMidi = useCallback(() => {
    if (midiAccessRef.current) {
      midiAccessRef.current.inputs.forEach(input => {
        input.removeEventListener('midimessage', midiMessageHandler);
      });
      midiAccessRef.current.onstatechange = null;
      midiAccessRef.current = null;
    }
    audio.releaseAllMidiNotes();
    setActiveNotes(new Set());
    isRecordingRef.current = false;
    recordingStartTimeRef.current = null;
    setIsRecording(false);
    setCountInDisplay(0);
    setMidiEnabled(false);
    setMidiDeviceName(null);
  }, [midiMessageHandler]);

  const startRecording = useCallback(async () => {
    if (!midiEnabled) return;
    await audio.init();
    recordedMidiNotes.current = [];
    pendingMidiNotes.current.clear();
    isRecordingRef.current = false;

    const COUNT_IN = 2;
    const beatMs = (60 / song.tempo) * 1000;

    let remaining = COUNT_IN;
    setCountInDisplay(remaining);
    audio.playCountInBeat(true);

    const tick = () => {
      remaining--;
      if (remaining > 0) {
        setCountInDisplay(remaining);
        audio.playCountInBeat(false);
        setTimeout(tick, beatMs);
      } else {
        setCountInDisplay(0);
        recordingStartTimeRef.current = performance.now();
        isRecordingRef.current = true;
        setIsRecording(true);
        // Keep click going during recording
        let clickBeat = 0;
        const timeSigBeats = song.timeSignature[0];
        recordingClickRef.current = setInterval(() => {
          audio.playCountInBeat(clickBeat % timeSigBeats === 0);
          clickBeat++;
        }, beatMs);
      }
    };
    setTimeout(tick, beatMs);
  }, [midiEnabled, song.tempo]);

  const stopRecording = useCallback(() => {
    const now = performance.now();
    const startTime = recordingStartTimeRef.current;
    isRecordingRef.current = false;
    setIsRecording(false);
    setCountInDisplay(0);
    recordingStartTimeRef.current = null;

    // Flush any notes still held at stop time
    if (startTime !== null) {
      pendingMidiNotes.current.forEach((startMs, midiNote) => {
        const pitch = midiNoteToString(midiNote);
        const tempo = songTempoRef.current;
        const grid = quantGridRef.current;
        const startBeats = ((startMs - startTime) / 1000) * (tempo / 60);
        const endBeats = ((now - startTime) / 1000) * (tempo / 60);
        const qStart = Math.round(startBeats * grid) / grid;
        const qDur = Math.max(1 / grid, Math.round((endBeats - startBeats) * grid) / grid);
        recordedMidiNotes.current.push({
          id: generateId(), pitch, start: qStart, duration: qDur, isRest: false, voice: 1
        });
        audio.stopMidiNote(pitch);
      });
    }
    pendingMidiNotes.current.clear();

    // Stop click interval started during recording
    if (recordingClickRef.current !== null) {
      clearInterval(recordingClickRef.current);
      recordingClickRef.current = null;
    }
    // Stop transport; restore metronome to its pre-recording state
    audio.stop();
    audio.setMetronome(metronomeStatus, song.timeSignature);

    // Append recorded notes to first track after existing content
    if (recordedMidiNotes.current.length > 0) {
      const notes = [...recordedMidiNotes.current].sort((a, b) => a.start - b.start);
      setSong(prev => {
        const track = prev.tracks[0];
        const existingMax = track.notes.length > 0
          ? Math.max(...track.notes.map(n => n.start + n.duration)) : 0;
        const shifted = notes.map(n => ({ ...n, id: generateId(), start: n.start + existingMax }));
        const newTracks = [...prev.tracks];
        newTracks[0] = { ...track, notes: [...track.notes, ...shifted] };
        return { ...prev, tracks: newTracks };
      });
      recordedMidiNotes.current = [];
    }
  }, [metronomeStatus, song.timeSignature, setSong]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const isMod = e.metaKey || e.ctrlKey;

      // Undo / Redo
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
        return;
      }
      if (isMod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }

      // Copy
      if (isMod && e.key === 'c') {
        e.preventDefault();
        if (selectedNoteIds.size === 0) return;
        const items: { note: NoteData; trackId: string }[] = [];
        song.tracks.forEach(t => t.notes.forEach(n => {
          if (selectedNoteIds.has(n.id)) items.push({ note: n, trackId: t.id });
        }));
        if (items.length > 0) {
          const minStart = Math.min(...items.map(i => i.note.start));
          setClipboard({
            notes: items.map(i => ({ ...i.note, start: i.note.start - minStart })),
            trackIds: items.map(i => i.trackId)
          });
        }
        return;
      }

      // Paste
      if (isMod && e.key === 'v') {
        e.preventDefault();
        if (!clipboard) return;
        let pasteStart = 0;
        song.tracks.forEach(t => t.notes.forEach(n => {
          if (n.start + n.duration > pasteStart) pasteStart = n.start + n.duration;
        }));
        const pasted = clipboard.notes.map((n, i) => ({
          note: { ...n, id: generateId(), start: pasteStart + n.start },
          trackId: clipboard.trackIds[i]
        }));
        const newTracks = song.tracks.map(t => ({
          ...t,
          notes: [
            ...t.notes,
            ...pasted.filter(p => p.trackId === t.id).map(p => p.note)
          ]
        }));
        setSong({ ...song, tracks: newTracks });
        setSelectedNoteIds(new Set(pasted.map(p => p.note.id)));
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedNoteIds(new Set());
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        handleAppendToScore();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAppendToScore, selectedNoteIds, song, clipboard, setSong, setSelectedNoteIds]);

  const detectedChords = useMemo(() => {
    if (combinedNotes.size === 0) return [];
    return Chord.detect([...combinedNotes].map((n: string) => n.replace(/[0-9]/g, '')));
  }, [combinedNotes]);

  const chordLabels = useMemo(() => {
    const map = new Map<number, string>();
    const positions = new Set<number>();
    song.tracks.forEach(t => t.notes.forEach(n => {
      if (!n.isRest) positions.add(Math.round(n.start * 100) / 100);
    }));
    positions.forEach(beat => {
      const pcs = new Set<string>();
      song.tracks.forEach(t => t.notes.forEach(n => {
        if (!n.isRest && n.start <= beat + 0.001 && n.start + n.duration > beat + 0.001)
          pcs.add(n.pitch.replace(/[0-9]/g, ''));
      }));
      if (pcs.size >= 2) {
        const detected = Chord.detect([...pcs]);
        if (detected.length > 0) map.set(beat, detected[0]);
      }
    });
    return map;
  }, [song]);

  return (
    <div className="flex flex-col h-screen bg-[#0A0A0B] text-[#D1D1D1] font-sans overflow-hidden">

      {/* Header */}
      <header className="h-14 border-b border-[#1F1F21] px-6 flex items-center justify-between bg-[#0F0F10] shrink-0">
        <div className="flex items-center gap-8">
          <div className="flex flex-col leading-none gap-0.5">
              <input
                value={song.title ?? ''}
                onChange={e => dispatch({ type: 'PATCH_META', payload: { title: e.target.value } })}
                placeholder="Untitled"
                className="bg-transparent font-serif italic text-xl text-[#F2F2F2] tracking-wide outline-none border-b border-transparent focus:border-[#D4AF37]/40 w-44 placeholder:text-[#2A2A2A]"
              />
              <input
                value={song.composer ?? ''}
                onChange={e => dispatch({ type: 'PATCH_META', payload: { composer: e.target.value } })}
                placeholder="Composer"
                className="bg-transparent text-[10px] text-[#555] outline-none border-b border-transparent focus:border-[#D4AF37]/40 w-44 placeholder:text-[#1E1E1E] tracking-wider"
              />
            </div>
          <div className="flex gap-6 text-[11px] uppercase tracking-[0.15em] text-[#8E8E93]">
            <span
              className={cn("cursor-pointer", !playMode ? "text-[#D4AF37] border-b border-[#D4AF37] pb-1" : "hover:text-white")}
              onClick={() => { activeNotes.forEach(p => audio.stopNoteRealtime(p)); setPlayMode(false); setActiveNotes(new Set()); }}
            >Score Mode</span>
            <span
              className={cn("cursor-pointer", playMode ? "text-[#D4AF37] border-b border-[#D4AF37] pb-1" : "hover:text-white")}
              onClick={() => { activeNotes.forEach(p => audio.stopNoteRealtime(p)); setPlayMode(true); setActiveNotes(new Set()); }}
            >Playing Mode</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!pianoReady && (
            <div className="flex items-center gap-1.5 text-[10px] text-[#8E8E93] uppercase tracking-wider mr-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-pulse" />
              Loading piano...
            </div>
          )}
          {/* Undo / Redo */}
          <button
            onClick={() => dispatch({ type: 'UNDO' })}
            disabled={histState.past.length === 0}
            className="flex items-center justify-center w-7 h-7 rounded bg-[#1A1A1C] hover:bg-[#2A2A2D] text-[#8E8E93] hover:text-white disabled:opacity-30 transition-colors"
            title="Undo (Cmd+Z)"
          ><RotateCcw className="w-3.5 h-3.5" /></button>
          <button
            onClick={() => dispatch({ type: 'REDO' })}
            disabled={histState.future.length === 0}
            className="flex items-center justify-center w-7 h-7 rounded bg-[#1A1A1C] hover:bg-[#2A2A2D] text-[#8E8E93] hover:text-white disabled:opacity-30 transition-colors"
            title="Redo (Cmd+Shift+Z)"
          ><RotateCw className="w-3.5 h-3.5" /></button>

          <div className="w-px h-5 bg-[#1F1F21] mx-1" />

          {/* Transport */}
          <button
            onClick={togglePlay}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-[#1A1A1C] hover:bg-[#2A2A2D] text-[#D4AF37] border border-[#D4AF37]/30 transition-colors"
            title="Play/Stop"
          >
            {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          {/* BPM / Time Sig / Metronome */}
          <div className="flex bg-black/40 rounded px-3 py-1.5 border border-[#1F1F21] items-center gap-3">
            <div className="flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full", isPlaying ? "bg-[#D4AF37]" : "bg-[#333]")} />
              <input
                type="number" value={song.tempo}
                onChange={e => { const v = parseInt(e.target.value) || 120; setSong({ ...song, tempo: v }); audio.setTempo(v); }}
                className="bg-transparent border-none outline-none focus:ring-0 text-[10px] font-mono text-center w-10 text-inherit p-0"
                min="40" max="240"
              />
              <span className="text-[10px] font-mono">BPM</span>
            </div>
            <div className="w-px h-3 bg-[#1F1F21]" />
            <div className="flex items-center gap-1">
              <input
                type="number" value={song.timeSignature[0]}
                onChange={e => setSong({ ...song, timeSignature: [parseInt(e.target.value) || 4, song.timeSignature[1]] })}
                className="bg-transparent border-none outline-none focus:ring-0 text-[10px] font-mono text-center w-4 text-inherit p-0"
              />
              <span className="text-[10px] font-mono">/</span>
              <select
                value={song.timeSignature[1]}
                onChange={e => setSong({ ...song, timeSignature: [song.timeSignature[0], parseInt(e.target.value)] })}
                className="bg-transparent border-none outline-none focus:ring-0 text-[10px] font-mono text-center text-inherit p-0 appearance-none cursor-pointer"
              >
                <option value={2}>2</option>
                <option value={4}>4</option>
                <option value={8}>8</option>
              </select>
            </div>
            <div className="w-px h-3 bg-[#1F1F21]" />
            {/* Key signature */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-[#8E8E93]">Key</span>
              <select
                value={song.keySignature ?? 'C'}
                onChange={e => setSong({ ...song, keySignature: e.target.value })}
                className="bg-transparent border-none outline-none focus:ring-0 text-[10px] font-mono text-center text-inherit p-0 appearance-none cursor-pointer"
              >
                {KEY_SIGNATURES.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="w-px h-3 bg-[#1F1F21]" />
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-mono text-[#8E8E93]">Transp</span>
              <button
                onClick={() => setSong(s => transposeSong(s, -1))}
                className="w-5 h-5 flex items-center justify-center text-[#8E8E93] hover:text-white hover:bg-[#1A1A1C] rounded transition-colors text-[10px]"
                title="Transpose down 1 semitone"
              >▼</button>
              <button
                onClick={() => setSong(s => transposeSong(s, 1))}
                className="w-5 h-5 flex items-center justify-center text-[#8E8E93] hover:text-white hover:bg-[#1A1A1C] rounded transition-colors text-[10px]"
                title="Transpose up 1 semitone"
              >▲</button>
            </div>
            <div className="w-px h-3 bg-[#1F1F21]" />
            <span
              className={cn("text-[10px] font-mono uppercase cursor-pointer transition-colors", metronomeStatus ? "text-[#D4AF37]" : "hover:text-white")}
              onClick={toggleMetronome}
            >
              {metronomeStatus ? 'Click ON' : 'Click OFF'}
            </span>
          </div>

          {/* Loop */}
          <button
            onClick={() => setLoopEnabled(v => !v)}
            className={cn("flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition-colors",
              loopEnabled ? "border-[#D4AF37] text-[#D4AF37] bg-[#D4AF37]/10" : "border-[#333] text-[#8E8E93] hover:text-white hover:border-[#555]"
            )}
            title="Toggle Loop"
          >
            <Repeat className="w-3 h-3" />
            <span className="uppercase tracking-wider">Loop</span>
          </button>
          {loopEnabled && (
            <div className="flex items-center gap-1 text-[10px] font-mono text-[#8E8E93]">
              <input
                type="number" value={loopStart} min={0}
                onChange={e => setLoopStart(Math.max(0, parseInt(e.target.value) || 0))}
                className="bg-[#1A1A1C] border border-[#333] rounded w-10 px-1 py-0.5 text-center text-inherit outline-none"
              />
              <span>—</span>
              <input
                type="number" value={loopEnd} min={1}
                onChange={e => setLoopEnd(Math.max(1, parseInt(e.target.value) || 8))}
                className="bg-[#1A1A1C] border border-[#333] rounded w-10 px-1 py-0.5 text-center text-inherit outline-none"
              />
            </div>
          )}

          {/* Guitar Tab */}
          <button
            onClick={() => setShowGuitarTab(v => !v)}
            className={cn("flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition-colors",
              showGuitarTab ? "border-[#D4AF37] text-[#D4AF37] bg-[#D4AF37]/10" : "border-[#333] text-[#8E8E93] hover:text-white hover:border-[#555]"
            )}
            title="Toggle Guitar Tab"
          >
            <span className="uppercase tracking-wider">Tab</span>
          </button>

          <div className="w-px h-5 bg-[#1F1F21] mx-1" />

          {/* MIDI Recording */}
          {!midiEnabled ? (
            <button
              onClick={initMidi}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-[#333] text-[#8E8E93] hover:text-white hover:border-[#555] transition-colors uppercase tracking-wider"
              title="Connect MIDI keyboard"
            >MIDI</button>
          ) : (
            <div className="flex items-center gap-1">
              {countInDisplay > 0 ? (
                <span className="text-[13px] font-bold text-[#D4AF37] w-5 text-center">{countInDisplay}</span>
              ) : isRecording ? (
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-red-500 text-red-400 bg-red-500/10 animate-pulse uppercase tracking-wider"
                >&#9632; Stop</button>
              ) : (
                <>
                  <button
                    onClick={startRecording}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-red-700 text-red-400 hover:border-red-500 hover:text-red-300 uppercase tracking-wider transition-colors"
                    title="Record MIDI (2-beat count-in)"
                  >&#9679; Rec</button>
                  <select
                    value={quantGrid}
                    onChange={e => setQuantGrid(Number(e.target.value))}
                    className="bg-[#1A1A1C] border border-[#333] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none cursor-pointer"
                    title="Quantization"
                  >
                    <option value={2}>1/8</option>
                    <option value={4}>1/16</option>
                    <option value={8}>1/32</option>
                  </select>
                </>
              )}
              <button
                onClick={disableMidi}
                className="w-5 h-5 flex items-center justify-center text-[#555] hover:text-white rounded transition-colors text-[11px] leading-none"
                title="Disconnect MIDI"
              >×</button>
            </div>
          )}

          <div className="w-px h-5 bg-[#1F1F21] mx-1" />
          <button
            onClick={() => saveFile(song)}
            className="px-3 py-1.5 bg-[#1F1F21] hover:bg-[#2A2A2D] text-[10px] uppercase tracking-widest text-[#D1D1D1] border border-[#333] transition-colors rounded"
            title="Save composition (.aurelia)"
          >
            Save
          </button>
          <button
            onClick={() => loadFile().then(data => { dispatch({ type: 'SET', payload: data }); setSelectedNoteIds(new Set()); })}
            className="px-3 py-1.5 bg-[#1F1F21] hover:bg-[#2A2A2D] text-[10px] uppercase tracking-widest text-[#D1D1D1] border border-[#333] transition-colors rounded"
            title="Open composition (.aurelia or .json)"
          >
            Open
          </button>
          <div className="w-px h-5 bg-[#1F1F21] mx-1" />
          <button onClick={() => exportToPdf(song, showGuitarTab)} className="px-3 py-1.5 bg-[#1F1F21] hover:bg-[#2A2A2D] text-[10px] uppercase tracking-widest text-[#D1D1D1] border border-[#333] transition-colors rounded">
            PDF
          </button>
          <button onClick={() => exportToMusicXML(song)} className="px-3 py-1.5 bg-[#1F1F21] hover:bg-[#2A2A2D] text-[10px] uppercase tracking-widest text-[#D1D1D1] border border-[#333] transition-colors rounded" title="Export MusicXML for Sibelius, MuseScore, Dorico">
            MXL
          </button>
          <button onClick={() => exportToMidi(song)} className="px-3 py-1.5 bg-[#D4AF37] hover:bg-[#C19E30] text-[#0A0A0B] text-[10px] font-bold uppercase tracking-widest transition-colors rounded">
            MIDI
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left Sidebar */}
        <div className="w-64 border-r border-[#1F1F21] bg-[#0F0F10] flex flex-col z-10 shrink-0">
          <div className="p-4 flex flex-col flex-1 overflow-y-auto custom-scrollbar">
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-4">Notation Elements</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 4, label: 'Whole', fraction: '1' },
                { value: 2, label: 'Half', fraction: '1/2' },
                { value: 1, label: 'Quarter', fraction: '1/4' },
                { value: 0.5, label: '8th', fraction: '1/8' },
                { value: 0.25, label: '16th', fraction: '1/16' }
              ].map(dur => (
                <div
                  key={dur.value}
                  onClick={() => {
                    setSelectedDuration(dur.value);
                    if (selectedNoteIds.size > 0 && !playMode) {
                      setSong(prev => {
                        let changed = false;
                        const newTracks = prev.tracks.map(t => ({
                          ...t,
                          notes: t.notes.map(n => {
                            if (!selectedNoteIds.has(n.id)) return n;
                            changed = true;
                            let d = dur.value;
                            if (isDotted) d *= 1.5;
                            return { ...n, duration: d, isRest };
                          })
                        }));
                        return changed ? { ...prev, tracks: newTracks } : prev;
                      });
                    }
                  }}
                  className={cn(
                    "bg-[#151517] border p-2 flex flex-col items-center justify-center cursor-pointer transition-colors select-none rounded",
                    selectedDuration === dur.value ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                  )}
                >
                  <span className="font-bold text-sm tracking-widest">{dur.fraction}</span>
                  <span className="text-[9px] uppercase tracking-wider opacity-60 mt-1">{dur.label}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-2">
              <div
                onClick={() => {
                  const next = !isDotted;
                  setIsDotted(next);
                  if (selectedNoteIds.size > 0 && !playMode) {
                    setSong(prev => ({
                      ...prev,
                      tracks: prev.tracks.map(t => ({
                        ...t,
                        notes: t.notes.map(n => selectedNoteIds.has(n.id)
                          ? { ...n, duration: next ? selectedDuration * 1.5 : selectedDuration }
                          : n)
                      }))
                    }));
                  }
                }}
                className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
                  isDotted ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                )}
              >Dotted (.)</div>
              <div
                onClick={() => {
                  const next = !isRest;
                  setIsRest(next);
                  if (selectedNoteIds.size > 0 && !playMode) {
                    setSong(prev => ({
                      ...prev,
                      tracks: prev.tracks.map(t => ({
                        ...t,
                        notes: t.notes.map(n => selectedNoteIds.has(n.id) ? { ...n, isRest: next } : n)
                      }))
                    }));
                  }
                }}
                className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
                  isRest ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                )}
              >Rest</div>
            </div>

            {/* Voice toggle */}
            <div className="flex gap-2 mt-2">
              <div
                onClick={() => setActiveVoice(1)}
                className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
                  activeVoice === 1 ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                )}
              >Voice 1</div>
              <div
                onClick={() => setActiveVoice(2)}
                className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
                  activeVoice === 2 ? "border-[#4D96FF] text-[#4D96FF]" : "border-[#222] hover:border-[#4D96FF] text-[#D1D1D1]"
                )}
              >Voice 2</div>
            </div>

            {/* Dynamics */}
            <div className="mt-4">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-2">Dynamics</h2>
              <div className="flex flex-wrap gap-1">
                {(['pp', 'p', 'mp', 'mf', 'f', 'ff'] as DynamicMarking[]).map(d => (
                  <div
                    key={d}
                    onClick={() => setSelectedDynamic(prev => prev === d ? null : d)}
                    className={cn(
                      "flex-1 min-w-[28px] bg-[#151517] border p-1 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] font-bold italic",
                      selectedDynamic === d ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                    )}
                  >{d}</div>
                ))}
              </div>
            </div>

            {/* Articulations */}
            <div className="mt-3">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-2">Articulation</h2>
              <div className="flex gap-1">
                {([['staccato', '·'], ['accent', '>'], ['tenuto', '—']] as [ArticulationMarking, string][]).map(([a, sym]) => (
                  <div
                    key={a}
                    onClick={() => setSelectedArticulation(prev => prev === a ? null : a)}
                    className={cn(
                      "flex-1 bg-[#151517] border p-1.5 flex flex-col items-center justify-center cursor-pointer transition-colors select-none rounded",
                      selectedArticulation === a ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                    )}
                  >
                    <span className="text-base leading-none font-bold">{sym}</span>
                    <span className="text-[8px] uppercase tracking-wide mt-0.5 opacity-60">{a}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 mt-3">
              <div
                onClick={() => setChordSelectMode(!chordSelectMode)}
                className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
                  chordSelectMode ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                )}
              >Select Chords</div>
              <div
                onClick={() => setHarmonyMode(!harmonyMode)}
                className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
                  harmonyMode ? "border-[#A78BFA] text-[#A78BFA]" : "border-[#222] hover:border-[#A78BFA] text-[#D1D1D1]"
                )}
              >Add Harmony</div>
            </div>

            {/* Copy hint */}
            {selectedNoteIds.size > 0 && (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    const items: { note: NoteData; trackId: string }[] = [];
                    song.tracks.forEach(t => t.notes.forEach(n => {
                      if (selectedNoteIds.has(n.id)) items.push({ note: n, trackId: t.id });
                    }));
                    if (items.length > 0) {
                      const minStart = Math.min(...items.map(i => i.note.start));
                      setClipboard({
                        notes: items.map(i => ({ ...i.note, start: i.note.start - minStart })),
                        trackIds: items.map(i => i.trackId)
                      });
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-1 bg-[#151517] border border-[#222] hover:border-[#D4AF37] rounded p-2 text-[10px] uppercase tracking-wider font-bold text-[#D1D1D1] hover:text-[#D4AF37] cursor-pointer transition-colors"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
                {clipboard && (
                  <button
                    onClick={() => {
                      let pasteStart = 0;
                      song.tracks.forEach(t => t.notes.forEach(n => {
                        if (n.start + n.duration > pasteStart) pasteStart = n.start + n.duration;
                      }));
                      const pasted = clipboard.notes.map((n, i) => ({
                        note: { ...n, id: generateId(), start: pasteStart + n.start },
                        trackId: clipboard.trackIds[i]
                      }));
                      setSong({
                        ...song,
                        tracks: song.tracks.map(t => ({
                          ...t,
                          notes: [...t.notes, ...pasted.filter(p => p.trackId === t.id).map(p => p.note)]
                        }))
                      });
                      setSelectedNoteIds(new Set(pasted.map(p => p.note.id)));
                    }}
                    className="flex-1 flex items-center justify-center gap-1 bg-[#151517] border border-[#222] hover:border-[#D4AF37] rounded p-2 text-[10px] uppercase tracking-wider font-bold text-[#D1D1D1] hover:text-[#D4AF37] cursor-pointer transition-colors"
                  >
                    Paste
                  </button>
                )}
              </div>
            )}

            <div className="mt-6">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Active Notes</h2>
                {activeNotes.size > 0 && (
                  <button
                    onClick={() => { activeNotes.forEach(p => audio.stopNoteRealtime(p)); setActiveNotes(new Set()); }}
                    className="text-[10px] text-red-500 hover:text-red-400 uppercase tracking-wider font-bold"
                  >Clear</button>
                )}
              </div>
              <div className="bg-[#151517] rounded border border-[#222] p-2 flex flex-wrap gap-1">
                {activeNotes.size > 0 ? Array.from(activeNotes).map(n => (
                  <span key={n} className="text-[10px] text-[#D4AF37] font-mono py-1 px-1.5 bg-[#050506] border border-[#222] rounded">{n}</span>
                )) : (
                  <span className="text-[10px] text-[#555] uppercase p-1">None</span>
                )}
              </div>
            </div>

            {(activeNotes.size > 0 || isRest) && (
              <button
                onClick={handleAppendToScore}
                className="w-full mt-4 bg-[#D4AF37] hover:bg-[#C19E30] text-[#0A0A0B] font-bold uppercase tracking-wider text-[10px] py-2 flex items-center justify-center rounded transition-colors"
              >
                Add to Score (Enter)
              </button>
            )}
          </div>

          {/* Instruments */}
          <div className="p-4 border-t border-[#1F1F21] flex flex-col shrink-0 max-h-72">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Instruments</h2>
              <button
                className="p-1 hover:text-[#D4AF37] hover:bg-[#1A1A1C] rounded text-[#8E8E93] transition-colors"
                onClick={() => {
                  const num = song.tracks.length + 1;
                  setSong(s => ({
                    ...s,
                    tracks: [...s.tracks, { id: generateId(), name: `Track ${num}`, instrument: 'piano' as InstrumentPreset, notes: [] }]
                  }));
                }}
                title="Add Track"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-2 overflow-y-auto custom-scrollbar">
              {song.tracks.map((track, i) => (
                <div key={track.id} className={cn(
                  "group relative rounded px-2 py-1.5 transition-colors border-l-2",
                  i === 0 ? "bg-[#1A1A1C] border-[#D4AF37]" : "border-transparent hover:bg-[#151517]"
                )}>
                  <div className="flex justify-between items-center">
                    <input
                      value={track.name}
                      onChange={e => {
                        const newTracks = [...song.tracks];
                        newTracks[i] = { ...track, name: e.target.value };
                        setSong({ ...song, tracks: newTracks });
                      }}
                      className="bg-transparent border-none outline-none focus:ring-0 text-xs w-28 truncate text-inherit"
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-[#555] group-hover:hidden">{track.notes.length}n</span>
                      <button
                        className="hidden group-hover:block text-red-400 hover:text-red-500 p-0.5 rounded"
                        onClick={e => { e.stopPropagation(); if (song.tracks.length > 1) setSong(s => ({ ...s, tracks: s.tracks.filter(t => t.id !== track.id) })); }}
                        title="Remove"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    </div>
                  </div>
                  <select
                    value={track.instrument}
                    onChange={e => {
                      const newPreset = e.target.value as InstrumentPreset;
                      const newTracks = [...song.tracks];
                      newTracks[i] = { ...track, instrument: newPreset };
                      setSong({ ...song, tracks: newTracks });
                    }}
                    className="mt-0.5 w-full bg-[#0F0F10] border border-[#222] rounded text-[10px] text-[#8E8E93] px-1 py-0.5 outline-none cursor-pointer"
                  >
                    {Object.entries(INSTRUMENT_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <button
                    onClick={e => { e.stopPropagation(); const nt = [...song.tracks]; nt[i] = { ...track, grandStaff: !track.grandStaff }; setSong({ ...song, tracks: nt }); }}
                    className={cn("mt-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors cursor-pointer",
                      track.grandStaff ? "border-[#D4AF37] text-[#D4AF37] bg-[#D4AF37]/10" : "border-[#222] text-[#555] hover:border-[#555] hover:text-[#8E8E93]"
                    )}
                    title="Toggle Grand Staff (treble + bass clef)"
                  >Grand Staff</button>
                  {/* Volume / Mute / Solo */}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-[8px] text-[#444] shrink-0">Vol</span>
                    <input
                      type="range" min={0} max={100}
                      value={Math.round((track.volume ?? 1) * 100)}
                      onChange={e => { const nt = [...song.tracks]; nt[i] = { ...track, volume: Number(e.target.value) / 100 }; setSong({ ...song, tracks: nt }); }}
                      className="flex-1 h-0.5 accent-[#D4AF37]"
                    />
                    <button
                      onClick={e => { e.stopPropagation(); const nt = [...song.tracks]; nt[i] = { ...track, muted: !track.muted }; setSong({ ...song, tracks: nt }); }}
                      className={cn("text-[8px] px-1.5 py-0.5 rounded border font-bold transition-colors", track.muted ? "border-[#D4AF37] text-[#D4AF37] bg-[#D4AF37]/10" : "border-[#222] text-[#555] hover:border-[#555] hover:text-[#8E8E93]")}
                      title="Mute"
                    >M</button>
                    <button
                      onClick={e => { e.stopPropagation(); const nt = [...song.tracks]; nt[i] = { ...track, solo: !track.solo }; setSong({ ...song, tracks: nt }); }}
                      className={cn("text-[8px] px-1.5 py-0.5 rounded border font-bold transition-colors", track.solo ? "border-[#4488FF] text-[#4488FF] bg-[#4488FF]/10" : "border-[#222] text-[#555] hover:border-[#555] hover:text-[#8E8E93]")}
                      title="Solo"
                    >S</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Effects Chain */}
          <div className="border-t border-[#1F1F21] shrink-0">
            <div className="px-4 pt-3 pb-2">
              <button
                className="flex justify-between items-center w-full"
                onClick={() => setShowEffects(v => !v)}
              >
                <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Effects Chain</h2>
                <span className="text-[#555] text-[10px]">{showEffects ? '▲' : '▼'}</span>
              </button>
            </div>
            {showEffects && (() => {
              const updateFx = <K extends keyof EffectsSettings>(key: K, patch: Partial<EffectsSettings[K]>) =>
                setEffectsSettings(s => ({ ...s, [key]: { ...s[key], ...patch } }));
              const FxSlider = ({ label, min, max, step = 0.01, value, onChange }: { label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void }) => (
                <div className="flex items-center gap-1 ml-10">
                  <span className="text-[8px] text-[#444] w-16 shrink-0">{label}</span>
                  <input type="range" min={min} max={max} step={step} value={value}
                    onChange={e => onChange(Number(e.target.value))}
                    className="flex-1 h-0.5 accent-[#8E8E93]" />
                  <span className="text-[8px] text-[#444] w-8 text-right">{value < 1 ? Math.round(value * 100) + '%' : Number(value.toFixed(2))}</span>
                </div>
              );
              const FxRow = ({ fxKey, label, children }: { fxKey: keyof EffectsSettings; label: string; children?: React.ReactNode }) => {
                const fx = effectsSettings[fxKey];
                return (
                  <div className="space-y-1 py-1 border-b border-[#151517] last:border-0">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateFx(fxKey, { enabled: !fx.enabled } as any)}
                        className={cn("w-8 h-4 rounded-full transition-colors relative shrink-0 overflow-hidden", fx.enabled ? "bg-[#D4AF37]" : "bg-[#2A2A2D]")}
                      >
                        <span className={cn("absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm", fx.enabled ? "translate-x-4" : "translate-x-0")} />
                      </button>
                      <span className={cn("text-[9px] uppercase tracking-wider w-14 shrink-0 font-medium", fx.enabled ? "text-[#D1D1D1]" : "text-[#444]")}>{label}</span>
                      <input type="range" min={0} max={100} value={Math.round(fx.wet * 100)}
                        onChange={e => updateFx(fxKey, { wet: Number(e.target.value) / 100 } as any)}
                        disabled={!fx.enabled}
                        className="flex-1 h-0.5 accent-[#D4AF37] disabled:opacity-30" />
                      <span className="text-[8px] text-[#444] w-7 text-right">{Math.round(fx.wet * 100)}%</span>
                    </div>
                    {fx.enabled && children}
                  </div>
                );
              };
              return (
                <div className="px-4 pb-3 max-h-72 overflow-y-auto custom-scrollbar">
                  <FxRow fxKey="reverb" label="Reverb">
                    <FxSlider label="Room" min={0} max={1} value={effectsSettings.reverb.roomSize} onChange={v => updateFx('reverb', { roomSize: v })} />
                  </FxRow>
                  <FxRow fxKey="delay" label="Delay">
                    <FxSlider label="Time" min={0.05} max={1} value={effectsSettings.delay.time} onChange={v => updateFx('delay', { time: v })} />
                    <FxSlider label="Feedback" min={0} max={0.95} value={effectsSettings.delay.feedback} onChange={v => updateFx('delay', { feedback: v })} />
                  </FxRow>
                  <FxRow fxKey="chorus" label="Chorus">
                    <FxSlider label="Depth" min={0} max={1} value={effectsSettings.chorus.depth} onChange={v => updateFx('chorus', { depth: v })} />
                    <FxSlider label="Rate" min={0.1} max={8} value={effectsSettings.chorus.frequency} onChange={v => updateFx('chorus', { frequency: v })} />
                  </FxRow>
                  <FxRow fxKey="flanger" label="Flanger">
                    <FxSlider label="Depth" min={0} max={1} value={effectsSettings.flanger.depth} onChange={v => updateFx('flanger', { depth: v })} />
                    <FxSlider label="Rate" min={0.05} max={4} value={effectsSettings.flanger.frequency} onChange={v => updateFx('flanger', { frequency: v })} />
                  </FxRow>
                  <FxRow fxKey="phaser" label="Phaser">
                    <FxSlider label="Rate" min={0.05} max={4} value={effectsSettings.phaser.frequency} onChange={v => updateFx('phaser', { frequency: v })} />
                  </FxRow>
                  <FxRow fxKey="tremolo" label="Tremolo">
                    <FxSlider label="Rate" min={0.5} max={20} value={effectsSettings.tremolo.frequency} onChange={v => updateFx('tremolo', { frequency: v })} />
                    <FxSlider label="Depth" min={0} max={1} value={effectsSettings.tremolo.depth} onChange={v => updateFx('tremolo', { depth: v })} />
                  </FxRow>
                  <FxRow fxKey="overdrive" label="Overdrive">
                    <FxSlider label="Drive" min={0} max={1} value={effectsSettings.overdrive.amount} onChange={v => updateFx('overdrive', { amount: v })} />
                  </FxRow>
                  <FxRow fxKey="fuzz" label="Fuzz">
                    <FxSlider label="Order" min={1} max={100} step={1} value={effectsSettings.fuzz.order} onChange={v => updateFx('fuzz', { order: Math.round(v) })} />
                  </FxRow>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Tempo Changes */}
        <div className="border-t border-[#1F1F21] shrink-0">
          <div className="px-4 pt-3 pb-2">
            <button className="flex justify-between items-center w-full" onClick={() => setShowTempoChanges(v => !v)}>
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Tempo Changes</h2>
              <span className="text-[#555] text-[10px]">{showTempoChanges ? '▲' : '▼'}</span>
            </button>
          </div>
          {showTempoChanges && (
            <div className="px-4 pb-3 space-y-2">
              {(song.tempoChanges ?? []).length === 0 && (
                <p className="text-[9px] text-[#444] italic">No tempo changes added.</p>
              )}
              {(song.tempoChanges ?? []).sort((a, b) => a.beat - b.beat).map((tc, idx) => {
                const measure = Math.floor(tc.beat / song.timeSignature[0]) + 1;
                return (
                  <div key={idx} className="flex items-center justify-between gap-2 text-[9px] text-[#8E8E93]">
                    <span>M{measure} → <span className="text-[#D4AF37] font-bold">{Math.round(tc.bpm)} BPM</span></span>
                    <button
                      onClick={() => setSong(s => ({ ...s, tempoChanges: (s.tempoChanges ?? []).filter((_, i) => i !== idx) }))}
                      className="text-red-500 hover:text-red-400 px-1"
                    >✕</button>
                  </div>
                );
              })}
              <div className="flex items-center gap-1 pt-1 border-t border-[#151517]">
                <span className="text-[8px] text-[#444] shrink-0">M</span>
                <input
                  type="number" min={1} value={newTcMeasure}
                  onChange={e => setNewTcMeasure(e.target.value)}
                  className="w-10 bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none"
                />
                <input
                  type="number" min={20} max={300} value={newTcBpm}
                  onChange={e => setNewTcBpm(e.target.value)}
                  className="w-12 bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none"
                  placeholder="BPM"
                />
                <span className="text-[8px] text-[#444] shrink-0">BPM</span>
                <button
                  onClick={() => {
                    const measure = Math.max(1, parseInt(newTcMeasure) || 1);
                    const bpm = Math.max(20, Math.min(300, parseInt(newTcBpm) || 120));
                    const beat = (measure - 1) * song.timeSignature[0];
                    setSong(s => ({
                      ...s,
                      tempoChanges: [...(s.tempoChanges ?? []).filter(tc => tc.beat !== beat), { beat, bpm }]
                        .sort((a, b) => a.beat - b.beat)
                    }));
                  }}
                  className="ml-auto text-[9px] px-2 py-0.5 rounded bg-[#1A1A1C] border border-[#2A2A2D] text-[#8E8E93] hover:text-white hover:border-[#444] transition-colors"
                >Add</button>
              </div>
            </div>
          )}
        </div>

        {/* Repeat Signs */}
        <div className="border-t border-[#1F1F21] shrink-0">
          <div className="px-4 pt-3 pb-2">
            <button className="flex justify-between items-center w-full" onClick={() => setShowRepeats(v => !v)}>
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Repeat Signs</h2>
              <span className="text-[#555] text-[10px]">{showRepeats ? '▲' : '▼'}</span>
            </button>
          </div>
          {showRepeats && (
            <div className="px-4 pb-3 space-y-2">
              {(song.repeats ?? []).length === 0 && (
                <p className="text-[9px] text-[#444] italic">No repeat signs added.</p>
              )}
              {(song.repeats ?? []).sort((a, b) => a.measure - b.measure || (a.type === 'start' ? -1 : 1)).map((r, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 text-[9px] text-[#8E8E93]">
                  <span>M{r.measure} <span className={r.type === 'start' ? 'text-[#4488FF]' : 'text-[#D4AF37]'}>
                    {r.type === 'start' ? '|:' : ':|'}
                  </span></span>
                  <button
                    onClick={() => setSong(s => ({ ...s, repeats: (s.repeats ?? []).filter((_, i) => i !== idx) }))}
                    className="text-red-500 hover:text-red-400 px-1"
                  >✕</button>
                </div>
              ))}
              <div className="flex items-center gap-1 pt-1 border-t border-[#151517]">
                <span className="text-[8px] text-[#444] shrink-0">M</span>
                <input
                  type="number" min={1} value={newRepeatMeasure}
                  onChange={e => setNewRepeatMeasure(e.target.value)}
                  className="w-10 bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none"
                />
                <select
                  value={newRepeatType}
                  onChange={e => setNewRepeatType(e.target.value as 'start' | 'end')}
                  className="bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none cursor-pointer"
                >
                  <option value="start">Start (|:)</option>
                  <option value="end">End (:|)</option>
                </select>
                <button
                  onClick={() => {
                    const measure = Math.max(1, parseInt(newRepeatMeasure) || 1);
                    setSong(s => ({
                      ...s,
                      repeats: [...(s.repeats ?? []).filter(r => !(r.measure === measure && r.type === newRepeatType)), { measure, type: newRepeatType }]
                        .sort((a, b) => a.measure - b.measure)
                    }));
                  }}
                  className="ml-auto text-[9px] px-2 py-0.5 rounded bg-[#1A1A1C] border border-[#2A2A2D] text-[#8E8E93] hover:text-white hover:border-[#444] transition-colors"
                >Add</button>
              </div>
            </div>
          )}
        </div>

        {/* Notation View */}
        <main className="flex-1 overflow-auto bg-[#050506] relative" id="notation-render-container">
          <Notation
            song={song}
            onUpdateSong={setSong}
            onPlayNote={(p, inst) => audio.playNotePreview(p, inst)}
            chordMode={playMode}
            chordNotes={activeNotes}
            selectedDuration={selectedDuration}
            isDotted={isDotted}
            isRest={isRest}
            chordSelectMode={chordSelectMode}
            selectedNoteIds={selectedNoteIds}
            setSelectedNoteIds={setSelectedNoteIds}
            activeVoice={activeVoice}
            loopEnabled={loopEnabled}
            loopStart={loopStart}
            loopEnd={loopEnd}
            chordLabels={chordLabels}
            showGuitarTab={showGuitarTab}
            currentDynamic={selectedDynamic}
            currentArticulation={selectedArticulation}
          />
        </main>

        {/* Right Sidebar */}
        {!playMode && (
          <aside className="w-64 border-l border-[#1F1F21] bg-[#0F0F10] p-4 flex flex-col z-10 shrink-0 overflow-y-auto custom-scrollbar">
            <div className="mb-8">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-4">Harmonic Analysis</h2>
              <div className="bg-[#050506] p-4 rounded border border-[#1F1F21]">
                {detectedChords.length > 0 ? (
                  <>
                    <div className="text-2xl font-serif text-[#D4AF37] mb-1">{detectedChords[0]}</div>
                    {detectedChords.length > 1 && (
                      <div className="text-[10px] text-[#555] uppercase tracking-widest mt-2">{detectedChords.slice(1).join(', ')}</div>
                    )}
                  </>
                ) : (
                  <div className="text-sm italic text-[#555]">Play notes to identify...</div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Instrument Panel */}
      <div className="flex flex-col border-t border-[#1F1F21] bg-[#0A0A0C] relative shrink-0">
        <div className="absolute top-0 right-4 -translate-y-full flex bg-[#0A0A0C] border border-b-0 border-[#1F1F21] rounded-t overflow-hidden z-20">
          <button
            onClick={() => setInstrumentView('keyboard')}
            className={cn("px-4 py-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors", instrumentView === 'keyboard' ? "bg-[#D4AF37] text-black" : "text-[#8E8E93] hover:text-white hover:bg-[#1A1A1C]")}
          >Keys</button>
          <div className="w-px bg-[#1F1F21]" />
          <button
            onClick={() => setInstrumentView('fretboard')}
            className={cn("px-4 py-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors", instrumentView === 'fretboard' ? "bg-[#D4AF37] text-black" : "text-[#8E8E93] hover:text-white hover:bg-[#1A1A1C]")}
          >Guitar</button>
        </div>

        {/* Both always mounted so QWERTY/MIDI listeners stay active; CSS hides the inactive one */}
        <div className={instrumentView === 'keyboard' ? '' : 'hidden'}>
          <Keyboard activeNotes={combinedNotes} onNoteOn={handleNoteOn} onNoteOff={handleNoteOff} latchMode={!playMode} />
        </div>
        <div className={instrumentView === 'fretboard' ? '' : 'hidden'}>
          <Fretboard activeNotes={combinedNotes} onNoteOn={handleNoteOn} onNoteOff={handleNoteOff} latchMode={!playMode} />
        </div>
      </div>
    </div>
  );
}
