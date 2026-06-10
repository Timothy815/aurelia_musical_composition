import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Chord } from '@tonaljs/tonal';
import { Play, Square, Timer, Download, Keyboard as KeyboardIcon, FileMusic, Plus } from 'lucide-react';
import { SongData, TrackData } from './types';
import { generateId, cn } from './lib/utils';
import { audio } from './lib/audio';
import { Keyboard } from './components/Keyboard';
import { Fretboard } from './components/Fretboard';
import { Notation } from './components/Notation';
import { exportToMidi, exportToPdf } from './lib/export';

const DEFAULT_TRACK: TrackData = {
  id: 'track-1',
  name: 'Piano',
  instrument: 'piano',
  notes: []
};

const DEFAULT_SONG: SongData = {
  tempo: 120,
  timeSignature: [4, 4],
  tracks: [DEFAULT_TRACK]
};

export default function App() {
  const [song, setSong] = useState<SongData>(DEFAULT_SONG);
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

  useEffect(() => {
    // Only init audio on first user mount if possible, or wait for interaction
    const initFn = async () => {
      await audio.init();
    };
    window.addEventListener('click', initFn, { once: true });
    
    audio.onNotePlay = (pitch) => {
      setPlayingNotes(prev => {
        const next = new Set(prev);
        next.add(pitch);
        return next;
      });
    };

    audio.onNoteStop = (pitch) => {
      setPlayingNotes(prev => {
        const next = new Set(prev);
        next.delete(pitch);
        return next;
      });
    };

    return () => window.removeEventListener('click', initFn);
  }, []);

  // Merge active notes (user input) and playing notes (playback) for UI displays
  const combinedNotes = useMemo(() => {
    const combined = new Set(activeNotes);
    playingNotes.forEach(note => combined.add(note));
    return combined;
  }, [activeNotes, playingNotes]);

  const togglePlay = async () => {
    await audio.init();
    if (isPlaying) {
      audio.stop();
      setIsPlaying(false);
      setPlayingNotes(new Set());
    } else {
      audio.play(song);
      setIsPlaying(true);
    }
  };

  const toggleMetronome = async () => {
    await audio.init();
    const nextState = !metronomeStatus;
    setMetronomeStatus(nextState);
    audio.setMetronome(nextState, song.timeSignature);
  };

  const handleNoteOn = async (pitch: string) => {
    await audio.init();
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.add(pitch);
      return next;
    });
    audio.playNoteRealtime(pitch);
  };

  const handleNoteOff = (pitch: string) => {
    setActiveNotes(prev => {
      const next = new Set(prev);
      next.delete(pitch);
      return next;
    });
    audio.stopNoteRealtime(pitch);
  };

  const handleTempoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setSong(s => ({ ...s, tempo: val }));
    audio.setTempo(val);
  };

  const handleAppendToScore = useCallback(() => {
    if (activeNotes.size === 0 && !isRest) return;
    
    let duration = selectedDuration;
    if (isDotted) duration *= 1.5;

    setSong(prev => {
      const newTracks = [...prev.tracks];
      const track = newTracks[0]; // just use first track for now
      
      // Calculate append position
      let appendBeat = 0;
      if (track.notes.length > 0) {
        appendBeat = Math.max(...track.notes.map(n => n.start + n.duration));
      }

      const newNotes = [...track.notes];
      
      if (isRest) {
        newNotes.push({
          id: generateId(),
          pitch: 'B4',
          start: appendBeat,
          duration: duration,
          instrument: track.instrument,
          isRest: true
        });
      } else {
        Array.from(activeNotes).forEach(pitch => {
          newNotes.push({
            id: generateId(),
            pitch: pitch,
            start: appendBeat,
            duration: duration,
            instrument: track.instrument,
            isRest: false
          });
        });
      }
      
      newTracks[0] = { ...track, notes: newNotes };
      return { ...prev, tracks: newTracks };
    });

    activeNotes.forEach(pitch => audio.stopNoteRealtime(pitch));
    setActiveNotes(new Set());
  }, [activeNotes, isRest, selectedDuration, isDotted]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAppendToScore();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAppendToScore]);

  // Identify chord
  const detectedChords = useMemo(() => {
    if (activeNotes.size === 0) return [];
    const notesArray = Array.from(activeNotes).map(n => n.replace(/[0-9]/g, ''));
    return Chord.detect(notesArray);
  }, [activeNotes]);

  return (
    <div className="flex flex-col h-screen bg-[#0A0A0B] text-[#D1D1D1] font-sans overflow-hidden">
      
      {/* Header / Toolbar */}
      <header className="h-14 border-b border-[#1F1F21] px-6 flex items-center justify-between bg-[#0F0F10] shrink-0">
        <div className="flex items-center gap-8">
          <h1 className="font-serif italic text-xl text-[#F2F2F2] tracking-wide">Aurelia Composer</h1>
          <div className="flex gap-6 text-[11px] uppercase tracking-[0.15em] text-[#8E8E93]">
            <span 
              className={cn("cursor-pointer", !playMode ? "text-[#D4AF37] border-b border-[#D4AF37] pb-1" : "hover:text-white")} 
              onClick={() => {
                activeNotes.forEach(pitch => audio.stopNoteRealtime(pitch));
                setPlayMode(false);
                setActiveNotes(new Set());
              }}
            >Score Mode</span>
            <span
              className={cn("cursor-pointer", playMode ? "text-[#D4AF37] border-b border-[#D4AF37] pb-1" : "hover:text-white")}
              onClick={() => {
                activeNotes.forEach(pitch => audio.stopNoteRealtime(pitch));
                setPlayMode(true);
                setActiveNotes(new Set());
              }}
            >Playing Mode</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={togglePlay}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-[#1A1A1C] hover:bg-[#2A2A2D] text-[#D4AF37] border border-[#D4AF37]/30 transition-colors"
            title="Play/Stop Score"
          >
            {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <div className="flex bg-black/40 rounded px-3 py-1.5 border border-[#1F1F21] items-center gap-4">
            <div className="flex items-center gap-2">
              <span className={cn("w-2 h-2 rounded-full", isPlaying ? "bg-[#D4AF37] shadow-[0_0_8px_rgba(212,175,55,0.4)]" : "bg-[#333]")}></span>
              <input 
                type="number" 
                value={song.tempo}
                onChange={(e) => setSong({...song, tempo: parseInt(e.target.value) || 120})}
                className="bg-transparent border-none outline-none focus:ring-0 text-[10px] font-mono text-center w-10 text-inherit p-0"
                min="40" max="240"
              />
              <span className="text-[10px] font-mono">BPM</span>
            </div>
            <div className="w-px h-3 bg-[#1F1F21]"></div>
            <div className="flex items-center gap-1">
              <input 
                type="number"
                value={song.timeSignature[0]}
                onChange={(e) => setSong({...song, timeSignature: [parseInt(e.target.value) || 4, song.timeSignature[1]]})}
                className="bg-transparent border-none outline-none focus:ring-0 text-[10px] font-mono text-center w-4 text-inherit p-0"
              />
              <span className="text-[10px] font-mono">/</span>
              <select 
                value={song.timeSignature[1]}
                onChange={(e) => setSong({...song, timeSignature: [song.timeSignature[0], parseInt(e.target.value)]})}
                className="bg-transparent border-none outline-none focus:ring-0 text-[10px] font-mono text-center text-inherit p-0 appearance-none cursor-pointer"
              >
                <option value={2}>2</option>
                <option value={4}>4</option>
                <option value={8}>8</option>
              </select>
            </div>
            <div className="w-px h-3 bg-[#1F1F21]"></div>
            <span 
              className={cn("text-[10px] font-mono uppercase cursor-pointer transition-colors", metronomeStatus ? "text-[#D4AF37]" : "hover:text-white")}
              onClick={toggleMetronome}
              title="Toggle Metronome"
            >
              {metronomeStatus ? 'Click ON' : 'Click OFF'}
            </span>
          </div>
          <button 
            onClick={() => exportToPdf(song)}
            className="px-4 py-1.5 bg-[#1F1F21] hover:bg-[#2A2A2D] text-[10px] uppercase tracking-widest text-[#D1D1D1] border border-[#333] transition-colors"
          >
            Export PDF
          </button>
          <button 
            onClick={() => exportToMidi(song)}
            className="px-4 py-1.5 bg-[#D4AF37] hover:bg-[#C19E30] text-[#0A0A0B] text-[10px] font-bold uppercase tracking-widest transition-colors"
          >
            Export MIDI
          </button>
        </div>
      </header>
      
      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar - Tracks */}
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
                        let didChange = false;
                        const newTracks = prev.tracks.map(t => {
                          const newNotes = t.notes.map(n => {
                            if (selectedNoteIds.has(n.id)) {
                              didChange = true;
                              let d = dur.value;
                              if (isDotted) d *= 1.5;
                              return { ...n, duration: d, isRest };
                            }
                            return n;
                          });
                          return { ...t, notes: newNotes };
                        });
                        return didChange ? { ...prev, tracks: newTracks } : prev;
                      });
                    }
                  }}
                  className={cn(
                    "bg-[#151517] border p-2 flex flex-col items-center justify-center cursor-pointer transition-colors select-none rounded",
                    selectedDuration === dur.value ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                  )}
                  title={`Duration: ${dur.value} beat${dur.value !== 1 ? 's' : ''}`}
                >
                  <span className="font-bold text-sm tracking-widest">{dur.fraction}</span>
                  <span className="text-[9px] uppercase tracking-wider opacity-60 mt-1">{dur.label}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-2">
               <div
                  onClick={() => {
                    const nextVal = !isDotted;
                    setIsDotted(nextVal);
                    if (selectedNoteIds.size > 0 && !playMode) {
                      setSong(prev => {
                        let didChange = false;
                        const newTracks = prev.tracks.map(t => {
                          const newNotes = t.notes.map(n => {
                            if (selectedNoteIds.has(n.id)) {
                              didChange = true;
                              let d = selectedDuration;
                              if (nextVal) d *= 1.5;
                              return { ...n, duration: d };
                            }
                            return n;
                          });
                          return { ...t, notes: newNotes };
                        });
                        return didChange ? { ...prev, tracks: newTracks } : prev;
                      });
                    }
                  }}
                  className={cn(
                    "flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
                    isDotted ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                  )}
               >
                 Dotted (.)
               </div>
               <div
                  onClick={() => {
                    const nextVal = !isRest;
                    setIsRest(nextVal);
                    if (selectedNoteIds.size > 0 && !playMode) {
                      setSong(prev => {
                        let didChange = false;
                        const newTracks = prev.tracks.map(t => {
                          const newNotes = t.notes.map(n => {
                            if (selectedNoteIds.has(n.id)) {
                              didChange = true;
                              return { ...n, isRest: nextVal };
                            }
                            return n;
                          });
                          return { ...t, notes: newNotes };
                        });
                        return didChange ? { ...prev, tracks: newTracks } : prev;
                      });
                    }
                  }}
                  className={cn(
                    "flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
                    isRest ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                  )}
               >
                 Rest
               </div>
            </div>
            <div className="flex gap-2 mt-2">
               <div
                  onClick={() => setChordSelectMode(!chordSelectMode)}
                  className={cn(
                    "flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
                    chordSelectMode ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                  )}
               >
                 Select Chords
               </div>
            </div>
             <div className="mt-6">
               <div className="flex justify-between items-center mb-3">
                 <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Active Notes</h2>
                 {activeNotes.size > 0 && (
                   <button
                     onClick={() => {
                       activeNotes.forEach(pitch => audio.stopNoteRealtime(pitch));
                       setActiveNotes(new Set());
                     }}
                     className="text-[10px] text-red-500 hover:text-red-400 uppercase tracking-wider font-bold"
                   >
                     Clear
                   </button>
                 )}
               </div>
               <div className="bg-[#151517] rounded border border-[#222] p-2 flex flex-wrap justify-start gap-1">
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
                className="w-full mt-4 bg-[#D4AF37] hover:bg-[#C19E30] text-[#0A0A0B] font-bold uppercase tracking-wider text-[10px] py-2 flex items-center justify-center rounded transition-colors shadow-sm cursor-pointer z-50"
              >
                Add to Score (Enter)
              </button>
            )}
          </div>

          <div className="p-4 border-t border-[#1F1F21] flex flex-col shrink-0 max-h-64">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Instruments</h2>
              <button 
                className="p-1 hover:text-[#D4AF37] hover:bg-[#1A1A1C] rounded text-[#8E8E93] transition-colors"
                onClick={() => {
                  const num = song.tracks.length + 1;
                  setSong(s => ({
                    ...s,
                    tracks: [...s.tracks, { id: generateId(), name: `Instrument ${num}`, instrument: 'piano', notes: [] }]
                  }));
                }}
                title="Add Instrument"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-1 overflow-y-auto custom-scrollbar">
              {song.tracks.map((track, i) => (
                <div 
                  key={track.id} 
                  className={cn(
                    "group relative text-xs py-1.5 px-3 rounded cursor-pointer transition-colors flex justify-between items-center", 
                    i === 0 ? "bg-[#1A1A1C] text-[#D4AF37] border-l-2 border-[#D4AF37]" : "text-[#8E8E93] hover:text-white border-l-2 border-transparent"
                  )}
                >
                  <input 
                    value={track.name}
                    onChange={(e) => {
                      const newTracks = [...song.tracks];
                      newTracks[i] = { ...track, name: e.target.value };
                      setSong({ ...song, tracks: newTracks });
                    }}
                    className="bg-transparent border-none outline-none focus:ring-0 w-32 truncate text-inherit"
                  />
                  <div className="flex items-center space-x-2">
                    <span className="opacity-50 text-[10px] uppercase group-hover:hidden">{track.notes.length} n</span>
                    <button 
                      className="hidden group-hover:block text-red-400 hover:text-red-500 hover:bg-black/20 p-1 rounded -mr-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (song.tracks.length > 1) {
                          setSong(s => ({ ...s, tracks: s.tracks.filter(t => t.id !== track.id) }));
                        }
                      }}
                      title="Remove Instrument"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  </div>
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
          />
        </main>

        {/* Right Sidebar - Harmonics */}
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

      <div className="flex flex-col border-t border-[#1F1F21] bg-[#0A0A0C] relative shrink-0">
        <div className="absolute top-0 right-4 -translate-y-full flex bg-[#0A0A0C] border border-b-0 border-[#1F1F21] rounded-t overflow-hidden z-20 shadow-[-4px_-4px_10px_rgba(0,0,0,0.2)]">
          <button 
            onClick={() => setInstrumentView('keyboard')}
            className={cn("px-4 py-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors", instrumentView === 'keyboard' ? "bg-[#D4AF37] text-black" : "text-[#8E8E93] hover:text-white hover:bg-[#1A1A1C]")}
          >
            Keys
          </button>
          <div className="w-px bg-[#1F1F21]"></div>
          <button 
            onClick={() => setInstrumentView('fretboard')}
            className={cn("px-4 py-1.5 text-[10px] uppercase tracking-wider font-bold transition-colors", instrumentView === 'fretboard' ? "bg-[#D4AF37] text-black" : "text-[#8E8E93] hover:text-white hover:bg-[#1A1A1C]")}
          >
            Guitar
          </button>
        </div>
        
        {instrumentView === 'keyboard' ? (
          <Keyboard 
            activeNotes={combinedNotes}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            latchMode={!playMode}
          />
        ) : (
          <Fretboard 
            activeNotes={combinedNotes}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            latchMode={!playMode}
          />
        )}
      </div>
    </div>
  );
}
