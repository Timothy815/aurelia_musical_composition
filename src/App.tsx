import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Chord } from '@tonaljs/tonal';
import { Play, Square, Plus, RotateCcw, RotateCw, Repeat, SkipBack } from 'lucide-react';
import { SongData, NoteData, InstrumentPreset, DynamicMarking, ArticulationMarking, EffectsSettings, DEFAULT_EFFECTS } from './types';
import { generateId, cn } from './lib/utils';
import { audio } from './lib/audio';
import { KEY_SIGNATURES, transposeSong, midiNoteToString } from './lib/constants';
import { useHistory } from './hooks/useHistory';
import { Keyboard } from './components/Keyboard';
import { Fretboard } from './components/Fretboard';
import { Notation } from './components/Notation';
import { LeftSidebarPanel } from './components/LeftSidebarPanel';
import { exportToMidi, exportToPdf, exportToMusicXML, saveFile, loadFile } from './lib/export';

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const { histState, song, dispatch, setSong, setTrackNotes } = useHistory();

  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayMode] = useState(true);
  const [activeTrackIndex, setActiveTrackIndex] = useState(0);
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
  const [pageView, setPageView] = useState(false);
  const [clipboard, setClipboard] = useState<{ notes: NoteData[]; trackIds: string[] } | null>(null);
  const [pianoReady, setPianoReady] = useState(false);
  const [selectedDynamic, setSelectedDynamic] = useState<DynamicMarking | null>(null);
  const [selectedArticulation, setSelectedArticulation] = useState<ArticulationMarking | null>(null);
  const [lastChord, setLastChord] = useState<{
    pitches: string[]; isRest: boolean; duration: number;
    dynamic?: DynamicMarking; articulation?: ArticulationMarking; voice: 1 | 2;
  } | null>(null);
  const [effectsSettings, setEffectsSettings] = useState<EffectsSettings>(DEFAULT_EFFECTS);
  const [showEffects, setShowEffects] = useState(false);
  const recordingClickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showTempoChanges, setShowTempoChanges] = useState(false);
  const [showRepeats, setShowRepeats] = useState(false);
  const [newTcMeasure, setNewTcMeasure] = useState('1');
  const [newTcBpm, setNewTcBpm] = useState('120');
  const [newRepeatMeasure, setNewRepeatMeasure] = useState('1');
  const [newRepeatType, setNewRepeatType] = useState<'start' | 'end'>('start');

  const [playheadBeat, setPlayheadBeat] = useState(-1);
  const [seekBeat, setSeekBeat] = useState(-1);
  const playheadRafRef = useRef<number | null>(null);
  const [jumpMeasure, setJumpMeasure] = useState<{ measure: number; id: number } | null>(null);
  const jumpMeasureIdRef = useRef(0);

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

  useEffect(() => {
    if (!isPlaying) {
      setPlayheadBeat(-1);
      if (playheadRafRef.current !== null) { cancelAnimationFrame(playheadRafRef.current); playheadRafRef.current = null; }
      return;
    }
    const tick = () => { setPlayheadBeat(audio.currentBeat); playheadRafRef.current = requestAnimationFrame(tick); };
    playheadRafRef.current = requestAnimationFrame(tick);
    return () => { if (playheadRafRef.current !== null) { cancelAnimationFrame(playheadRafRef.current); playheadRafRef.current = null; } };
  }, [isPlaying]);
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
      const stoppedAt = audio.currentBeat;
      audio.stop();
      setIsPlaying(false);
      setPlayingNotes(new Set());
      if (stoppedAt >= 0) setSeekBeat(stoppedAt);
    } else {
      audio.play(song, loopEnabled, loopStart, loopEnd, Math.max(0, seekBeat));
      setIsPlaying(true);
    }
  };

  const returnToStart = () => {
    if (isPlaying) {
      audio.stop();
      setIsPlaying(false);
      setPlayingNotes(new Set());
    }
    setSeekBeat(0);
    setPlayheadBeat(0);
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
    const repeating = activeNotes.size === 0 && !isRest;
    if (repeating && !lastChord) return;

    let fallbackDuration = selectedDuration;
    if (isDotted) fallbackDuration *= 1.5;

    const effectivePitches  = repeating ? lastChord!.pitches        : Array.from(activeNotes);
    const effectiveIsRest   = repeating ? lastChord!.isRest         : isRest;
    const effectiveDuration = repeating ? lastChord!.duration        : fallbackDuration;
    const effectiveDynamic  = repeating ? lastChord!.dynamic         : (selectedDynamic ?? undefined);
    const effectiveArtic    = repeating ? lastChord!.articulation    : (selectedArticulation ?? undefined);
    const effectiveVoice    = repeating ? lastChord!.voice           : activeVoice;

    const newIds = (effectiveIsRest ? ['_'] : effectivePitches).map(() => generateId());

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

    if (insertTarget) {
      const { trackIdx, beat, duration } = insertTarget;
      const trackId = song.tracks[trackIdx].id;
      dispatch({ type: 'SET_TRACK_NOTES', trackId, notes: prevNotes => {
        const newNotes = [...prevNotes];
        if (effectiveIsRest) {
          newNotes.push({ id: newIds[0], pitch: 'B4', start: beat, duration, isRest: true });
        } else {
          effectivePitches.forEach((pitch, i) => {
            newNotes.push({ id: newIds[i], pitch, start: beat, duration, isRest: false, voice: effectiveVoice, dynamic: effectiveDynamic, articulation: effectiveArtic });
          });
        }
        return newNotes;
      }});
    } else {
      const tIdx = Math.min(activeTrackIndex, song.tracks.length - 1);
      const trackId = song.tracks[tIdx].id;
      dispatch({ type: 'SET_TRACK_NOTES', trackId, notes: prevNotes => {
        let appendBeat = 0;
        if (prevNotes.length > 0) {
          appendBeat = Math.max(...prevNotes.map(n => n.start + n.duration));
        }
        const newNotes = [...prevNotes];
        if (effectiveIsRest) {
          newNotes.push({ id: newIds[0], pitch: 'B4', start: appendBeat, duration: effectiveDuration, isRest: true });
        } else {
          effectivePitches.forEach((pitch, i) => {
            newNotes.push({ id: newIds[i], pitch, start: appendBeat, duration: effectiveDuration, isRest: false, voice: effectiveVoice, dynamic: effectiveDynamic, articulation: effectiveArtic });
          });
        }
        return newNotes;
      }});
    }

    if (!repeating) {
      activeNotes.forEach(p => audio.stopNoteRealtime(p));
      setActiveNotes(new Set());
      setLastChord({ pitches: effectivePitches, isRest: effectiveIsRest, duration: effectiveDuration, dynamic: effectiveDynamic, articulation: effectiveArtic, voice: effectiveVoice });
    }

    if (insertTarget) {
      // Advance selection to the next beat so you can chain edits chord-by-chord
      const nextBeat = insertTarget.beat + insertTarget.duration;
      const nextNotes = song.tracks[insertTarget.trackIdx].notes.filter(
        n => Math.abs(n.start - nextBeat) < 0.01
      );
      setSelectedNoteIds(nextNotes.length > 0 ? new Set(nextNotes.map(n => n.id)) : new Set());
    } else {
      setSelectedNoteIds(new Set());
    }
  }, [activeNotes, isRest, selectedDuration, isDotted, activeVoice, selectedDynamic, selectedArticulation, setSelectedNoteIds, selectedNoteIds, song, harmonyMode, lastChord, activeTrackIndex]);

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

    // Append recorded notes to active track after existing content
    if (recordedMidiNotes.current.length > 0) {
      const notes = [...recordedMidiNotes.current].sort((a, b) => a.start - b.start);
      const tIdx = activeTrackIndex;
      setSong(prev => {
        const resolvedIdx = Math.min(tIdx, prev.tracks.length - 1);
        const track = prev.tracks[resolvedIdx];
        const existingMax = track.notes.length > 0
          ? Math.max(...track.notes.map(n => n.start + n.duration)) : 0;
        const shifted = notes.map(n => ({ ...n, id: generateId(), start: n.start + existingMax }));
        const newTracks = [...prev.tracks];
        newTracks[resolvedIdx] = { ...track, notes: [...track.notes, ...shifted] };
        return { ...prev, tracks: newTracks };
      });
      recordedMidiNotes.current = [];
    }
  }, [metronomeStatus, song.timeSignature, setSong, activeTrackIndex]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const isMod = e.metaKey || e.ctrlKey;

      // Undo / Redo — per-track in Score Mode, global otherwise
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const activeTrackId = song.tracks[activeTrackIndex]?.id;
        if (activeTrackId && (histState.trackHistories[activeTrackId]?.past.length ?? 0) > 0) {
          dispatch({ type: 'UNDO_TRACK', trackId: activeTrackId });
        } else {
          dispatch({ type: 'UNDO' });
        }
        return;
      }
      if (isMod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const activeTrackId = song.tracks[activeTrackIndex]?.id;
        if (activeTrackId && (histState.trackHistories[activeTrackId]?.future.length ?? 0) > 0) {
          dispatch({ type: 'REDO_TRACK', trackId: activeTrackId });
        } else {
          dispatch({ type: 'REDO' });
        }
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

      if (e.key === 'Home') {
        e.preventDefault();
        returnToStart();
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        handleAppendToScore();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAppendToScore, selectedNoteIds, song, clipboard, setSong, setSelectedNoteIds, histState.trackHistories, activeTrackIndex, playMode, returnToStart]);

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
              className="bg-transparent border-none outline-none focus:ring-0 text-sm font-semibold text-[#D1D1D1] placeholder-[#555] w-36 tracking-wide"
            />
            <input
              value={song.composer ?? ''}
              onChange={e => dispatch({ type: 'PATCH_META', payload: { composer: e.target.value } })}
              placeholder="Composer"
              className="bg-transparent border-none outline-none focus:ring-0 text-[10px] text-[#8E8E93] placeholder-[#555] w-36 uppercase tracking-widest"
            />
          </div>
          <div className="h-8 w-px bg-[#1F1F21]" />

          {/* Mode Toggle */}
          <div className="flex items-center gap-0.5 bg-[#0A0A0B] rounded border border-[#1F1F21] p-0.5">
            <button
              onClick={() => setPlayMode(false)}
              className={cn("px-3 py-1 text-[10px] uppercase tracking-wider font-bold rounded transition-colors",
                !playMode ? "bg-[#4D96FF] text-white" : "text-[#8E8E93] hover:text-white"
              )}
            >Score</button>
            <button
              onClick={() => setPlayMode(true)}
              className={cn("px-3 py-1 text-[10px] uppercase tracking-wider font-bold rounded transition-colors",
                playMode ? "bg-[#D4AF37] text-black" : "text-[#8E8E93] hover:text-white"
              )}
            >Play</button>
          </div>
        </div>

        <div className="flex items-center gap-3">

          {/* Undo / Redo */}
          {(() => {
            const activeTrackId = song.tracks[activeTrackIndex]?.id;
            const trackHist = activeTrackId ? histState.trackHistories[activeTrackId] : undefined;
            const canUndoTrack = (trackHist?.past.length ?? 0) > 0;
            const canRedoTrack = (trackHist?.future.length ?? 0) > 0;
            return (<>
              <button
                onClick={() => {
                  if (canUndoTrack && activeTrackId) dispatch({ type: 'UNDO_TRACK', trackId: activeTrackId });
                  else dispatch({ type: 'UNDO' });
                }}
                disabled={!canUndoTrack && histState.past.length === 0}
                className="w-7 h-7 flex items-center justify-center text-[#8E8E93] hover:text-white hover:bg-[#1A1A1C] rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Undo (⌘Z)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  if (canRedoTrack && activeTrackId) dispatch({ type: 'REDO_TRACK', trackId: activeTrackId });
                  else dispatch({ type: 'REDO' });
                }}
                disabled={!canRedoTrack && histState.future.length === 0}
                className="w-7 h-7 flex items-center justify-center text-[#8E8E93] hover:text-white hover:bg-[#1A1A1C] rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Redo (⌘⇧Z)"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            </>);
          })()}

          <div className="w-px h-5 bg-[#1F1F21]" />

          {/* Transport */}
          <button
            onClick={returnToStart}
            title="Return to start (Home)"
            className="flex items-center justify-center w-7 h-7 rounded text-[#8E8E93] hover:text-white hover:bg-[#222] transition-colors"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={togglePlay}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold rounded transition-colors",
              isPlaying ? "bg-[#D4AF37] text-black hover:bg-[#C19E30]" : "bg-[#1A1A1C] text-[#8E8E93] hover:text-white hover:bg-[#222]"
            )}
          >
            {isPlaying ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
            {isPlaying ? 'Stop' : 'Play'}
            {!pianoReady && !isPlaying && <span className="ml-1 text-[8px] text-[#D4AF37] opacity-70 animate-pulse">loading…</span>}
          </button>

          <div className="w-px h-5 bg-[#1F1F21]" />

          {/* BPM */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-mono text-[#8E8E93]">BPM</span>
            <input
              type="number"
              value={song.tempo}
              min={20} max={300}
              onChange={e => setSong({ ...song, tempo: Math.max(20, Math.min(300, parseInt(e.target.value) || 120)) })}
              className="bg-transparent border-none outline-none focus:ring-0 text-[10px] font-mono text-center text-inherit w-10 p-0"
            />
          </div>
          <div className="w-px h-3 bg-[#1F1F21]" />
          {/* Time signature */}
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={song.timeSignature[0]}
              min={1} max={16}
              onChange={e => setSong({ ...song, timeSignature: [parseInt(e.target.value) || 4, song.timeSignature[1]] })}
              className="bg-transparent border-none outline-none focus:ring-0 text-[10px] font-mono text-center text-inherit w-6 p-0"
            />
            <span className="text-[10px] font-mono text-[#8E8E93]">/</span>
            <select
              value={song.timeSignature[1]}
              onChange={e => setSong({ ...song, timeSignature: [song.timeSignature[0], parseInt(e.target.value)] })}
              className="bg-transparent border-none outline-none focus:ring-0 text-[10px] font-mono text-center text-inherit p-0 appearance-none cursor-pointer"
            >
              {[2, 4, 8, 16].map(d => <option key={d} value={d}>{d}</option>)}
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
          <div className="w-px h-3 bg-[#1F1F21]" />
          {/* Measure jump */}
          <div className="flex items-center gap-1" title="Jump to measure (Enter)">
            <span className="text-[10px] font-mono text-[#8E8E93]">M</span>
            <input
              type="number"
              min={1}
              placeholder="—"
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                const m = parseInt((e.target as HTMLInputElement).value);
                if (!isNaN(m) && m >= 1) {
                  jumpMeasureIdRef.current++;
                  setJumpMeasure({ measure: m, id: jumpMeasureIdRef.current });
                  const beat = (m - 1) * song.timeSignature[0];
                  setSeekBeat(beat);
                  setPlayheadBeat(beat);
                }
                (e.target as HTMLInputElement).value = '';
                (e.target as HTMLInputElement).blur();
              }}
              className="bg-transparent border-none outline-none focus:ring-0 text-[10px] font-mono text-center text-inherit w-10 p-0"
            />
          </div>
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
            <span className="text-[#555]">bar</span>
            <input
              type="number"
              value={Math.floor(loopStart / song.timeSignature[0]) + 1}
              min={1}
              onChange={e => setLoopStart(Math.max(0, (parseInt(e.target.value) - 1 || 0) * song.timeSignature[0]))}
              className="bg-[#1A1A1C] border border-[#333] rounded w-10 px-1 py-0.5 text-center text-inherit outline-none"
            />
            <span>—</span>
            <input
              type="number"
              value={Math.ceil(loopEnd / song.timeSignature[0])}
              min={1}
              onChange={e => setLoopEnd(Math.max(song.timeSignature[0], (parseInt(e.target.value) || 1) * song.timeSignature[0]))}
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

        {/* Page View */}
        <button
          onClick={() => setPageView(v => !v)}
          className={cn("flex items-center gap-1 px-2 py-1 text-[10px] rounded border transition-colors",
            pageView ? "border-[#D4AF37] text-[#D4AF37] bg-[#D4AF37]/10" : "border-[#333] text-[#8E8E93] hover:text-white hover:border-[#555]"
          )}
          title="Toggle page view (letter-size pages)"
        >
          <span className="uppercase tracking-wider">Pages</span>
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
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left Sidebar */}
        <LeftSidebarPanel
          song={song}
          setSong={setSong}
          activeTrackIndex={activeTrackIndex}
          setActiveTrackIndex={setActiveTrackIndex}
          selectedDuration={selectedDuration}
          setSelectedDuration={setSelectedDuration}
          isDotted={isDotted}
          setIsDotted={setIsDotted}
          isRest={isRest}
          setIsRest={setIsRest}
          activeVoice={activeVoice}
          setActiveVoice={setActiveVoice}
          selectedDynamic={selectedDynamic}
          setSelectedDynamic={setSelectedDynamic}
          selectedArticulation={selectedArticulation}
          setSelectedArticulation={setSelectedArticulation}
          chordSelectMode={chordSelectMode}
          setChordSelectMode={setChordSelectMode}
          harmonyMode={harmonyMode}
          setHarmonyMode={setHarmonyMode}
          selectedNoteIds={selectedNoteIds}
          setSelectedNoteIds={setSelectedNoteIds}
          clipboard={clipboard}
          setClipboard={setClipboard}
          activeNotes={activeNotes}
          setActiveNotes={setActiveNotes}
          handleAppendToScore={handleAppendToScore}
          playMode={playMode}
          lastChord={lastChord}
          effectsSettings={effectsSettings}
          setEffectsSettings={setEffectsSettings}
          showEffects={showEffects}
          setShowEffects={setShowEffects}
          showSidebar={showSidebar}
          setShowSidebar={setShowSidebar}
          showTempoChanges={showTempoChanges}
          setShowTempoChanges={setShowTempoChanges}
          newTcMeasure={newTcMeasure}
          setNewTcMeasure={setNewTcMeasure}
          newTcBpm={newTcBpm}
          setNewTcBpm={setNewTcBpm}
          showRepeats={showRepeats}
          setShowRepeats={setShowRepeats}
          newRepeatMeasure={newRepeatMeasure}
          setNewRepeatMeasure={setNewRepeatMeasure}
          newRepeatType={newRepeatType}
          setNewRepeatType={setNewRepeatType}
        />

        {!showSidebar && (
          <button
            onClick={() => setShowSidebar(true)}
            className="shrink-0 self-start mt-3 bg-[#0F0F10] border border-l-0 border-[#1F1F21] text-[#555] hover:text-white text-[10px] px-1.5 py-4 rounded-r z-10 transition-colors"
            title="Expand panel"
          >▶</button>
        )}

        {/* Notation View */}
        <main className="flex-1 overflow-auto bg-[#050506] relative" id="notation-render-container">
          <div className={cn(
            "absolute top-2 right-2 z-20 text-[9px] uppercase tracking-[0.2em] px-2 py-1 rounded border pointer-events-none select-none",
            playMode
              ? "text-[#D4AF37]/70 border-[#D4AF37]/20 bg-[#D4AF37]/5"
              : "text-[#4D96FF]/70 border-[#4D96FF]/20 bg-[#4D96FF]/5"
          )}>
            {playMode ? 'Playing Mode' : 'Score Mode'}
          </div>
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
            activeTrackIndex={activeTrackIndex}
            onSetActiveTrack={setActiveTrackIndex}
            onSetTrackNotes={setTrackNotes}
            playheadBeat={seekBeat >= 0 && !isPlaying ? seekBeat : playheadBeat}
            isPlaying={isPlaying}
            onSeek={beat => { setSeekBeat(beat); setPlayheadBeat(beat); }}
            jumpToMeasure={jumpMeasure ?? undefined}
            pageView={pageView}
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
