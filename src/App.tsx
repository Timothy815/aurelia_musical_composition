import React, { useState, useEffect, useMemo, useCallback, useReducer } from 'react';
import { Chord } from '@tonaljs/tonal';
import { Play, Square, Plus, RotateCcw, RotateCw, Copy, Repeat } from 'lucide-react';
import { SongData, TrackData, NoteData, InstrumentPreset } from './types';
import { generateId, cn } from './lib/utils';
import { audio } from './lib/audio';
import { Keyboard } from './components/Keyboard';
import { Fretboard } from './components/Fretboard';
import { Notation } from './components/Notation';
import { exportToMidi, exportToPdf, saveFile, loadFile } from './lib/export';

// ── History reducer for undo/redo ──────────────────────────────────────────
type HistoryState = { past: SongData[]; present: SongData; future: SongData[] };
type HistoryAction =
  | { type: 'SET'; payload: SongData }
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
  const [playMode, setPlayMode] = useState(false);
  const [metronomeStatus, setMetronomeStatus] = useState(false);
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const [playingNotes, setPlayingNotes] = useState<Set<string>>(new Set());
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [isDotted, setIsDotted] = useState(false);
  const [isRest, setIsRest] = useState(false);
  const [chordSelectMode, setChordSelectMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [instrumentView, setInstrumentView] = useState<'keyboard' | 'fretboard'>('keyboard');
  const [activeVoice, setActiveVoice] = useState<1 | 2>(1);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, setLoopStart] = useState(0);
  const [loopEnd, setLoopEnd] = useState(8);
  const [clipboard, setClipboard] = useState<{ notes: NoteData[]; trackIds: string[] } | null>(null);
  const [pianoReady, setPianoReady] = useState(false);

  useEffect(() => {
    const initFn = () => { audio.init().catch(console.error); };
    // Start init on any user gesture so audio is ready before the first note
    window.addEventListener('mousedown', initFn, { once: true });
    window.addEventListener('keydown', initFn, { once: true });
    window.addEventListener('touchstart', initFn, { once: true });
    audio.onNotePlay = (p) => setPlayingNotes(prev => { const n = new Set(prev); n.add(p); return n; });
    audio.onNoteStop = (p) => setPlayingNotes(prev => { const n = new Set(prev); n.delete(p); return n; });
    audio.onSamplerLoad = () => setPianoReady(true);
    return () => {
      window.removeEventListener('mousedown', initFn);
      window.removeEventListener('keydown', initFn);
      window.removeEventListener('touchstart', initFn);
    };
  }, []);

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

  const handleAppendToScore = useCallback(() => {
    if (activeNotes.size === 0 && !isRest) return;
    let duration = selectedDuration;
    if (isDotted) duration *= 1.5;

    const pitchList = Array.from(activeNotes);
    const newIds = (isRest ? ['_'] : pitchList).map(() => generateId());

    setSong(prev => {
      const newTracks = [...prev.tracks];
      const track = newTracks[0];
      let appendBeat = 0;
      if (track.notes.length > 0) {
        appendBeat = Math.max(...track.notes.map(n => n.start + n.duration));
      }
      const newNotes = [...track.notes];
      if (isRest) {
        newNotes.push({ id: newIds[0], pitch: 'B4', start: appendBeat, duration, isRest: true });
      } else {
        pitchList.forEach((pitch, i) => {
          newNotes.push({ id: newIds[i], pitch, start: appendBeat, duration, isRest: false, voice: activeVoice });
        });
      }
      newTracks[0] = { ...track, notes: newNotes };
      return { ...prev, tracks: newTracks };
    });

    activeNotes.forEach(p => audio.stopNoteRealtime(p));
    setActiveNotes(new Set());
    setSelectedNoteIds(new Set(newIds));
  }, [activeNotes, isRest, selectedDuration, isDotted, activeVoice, setSong, setSelectedNoteIds]);

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

      if (e.key === 'Enter') {
        e.preventDefault();
        handleAppendToScore();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAppendToScore, selectedNoteIds, song, clipboard, setSong]);

  const detectedChords = useMemo(() => {
    if (combinedNotes.size === 0) return [];
    return Chord.detect([...combinedNotes].map((n: string) => n.replace(/[0-9]/g, '')));
  }, [combinedNotes]);

  return (
    <div className="flex flex-col h-screen bg-[#0A0A0B] text-[#D1D1D1] font-sans overflow-hidden">

      {/* Header */}
      <header className="h-14 border-b border-[#1F1F21] px-6 flex items-center justify-between bg-[#0F0F10] shrink-0">
        <div className="flex items-center gap-8">
          <h1 className="font-serif italic text-xl text-[#F2F2F2] tracking-wide">Aurelia Composer</h1>
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
          <button onClick={() => exportToPdf(song)} className="px-3 py-1.5 bg-[#1F1F21] hover:bg-[#2A2A2D] text-[10px] uppercase tracking-widest text-[#D1D1D1] border border-[#333] transition-colors rounded">
            PDF
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

            <div className="flex gap-2 mt-2">
              <div
                onClick={() => setChordSelectMode(!chordSelectMode)}
                className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
                  chordSelectMode ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                )}
              >Select Chords</div>
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
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Notation View */}
        <main className="flex-1 overflow-auto bg-[#050506] relative" id="notation-render-container">
          <Notation
            song={song}
            onUpdateSong={setSong}
            onPlayNote={(p) => audio.playNotePreview(p)}
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
