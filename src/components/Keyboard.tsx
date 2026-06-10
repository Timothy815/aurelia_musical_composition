import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { cn } from '../lib/utils';

// Standard piano key layout mapping for QWERTY
const QWERTY_OFFSETS: Record<string, number> = {
  'a': 0, 'w': 1, 's': 2, 'e': 3, 'd': 4,
  'f': 5, 't': 6, 'g': 7, 'y': 8, 'h': 9,
  'u': 10, 'j': 11, 'k': 12, 'o': 13, 'l': 14,
  'p': 15, ';': 16, "'": 17
};

// Map MIDI note numbers to pitches
const MIDI_OFFSET = 12; // C0 is 12

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const pitchToMidi = (pitch: string) => {
    const p = pitch.length === 3 ? pitch.slice(0,2) : pitch[0];
    const oct = parseInt(pitch.slice(-1));
    return NOTES.indexOf(p) + (oct + 1) * 12;
}

const midiToPitch = (midi: number) => {
    const p = NOTES[midi % 12];
    const oct = Math.floor(midi / 12) - 1;
    return `${p}${oct}`;
}

const PIANO_KEYS = Array.from({ length: 88 }).map((_, i) => {
    const midi = i + 21; // A0 is 21
    const pitchStr = midiToPitch(midi);
    const isBlack = pitchStr.includes('#');
    return { pitch: pitchStr, color: isBlack ? 'black' : 'white', midi };
});

export function Keyboard({
  activeNotes,
  onNoteOn,
  onNoteOff,
  latchMode = false
}: {
  activeNotes: Set<string>;
  onNoteOn: (pitch: string) => void;
  onNoteOff: (pitch: string) => void;
  latchMode?: boolean;
}) {
  const [qwertyOctave, setQwertyOctave] = useState(4);

  const keyToPitch = useCallback((key: string) => {
    const offset = QWERTY_OFFSETS[key.toLowerCase()];
    if (offset !== undefined) {
      // C of the selected octave is midi base
      const baseMidi = (qwertyOctave + 1) * 12;
      return midiToPitch(baseMidi + offset);
    }
    return null;
  }, [qwertyOctave]);

  const callbacksRef = React.useRef({ onNoteOn, onNoteOff, latchMode, activeNotes, keyToPitch });
  useEffect(() => {
    callbacksRef.current = { onNoteOn, onNoteOff, latchMode, activeNotes, keyToPitch };
  }, [onNoteOn, onNoteOff, latchMode, activeNotes, keyToPitch]);

  // Handle QWERTY input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      const { onNoteOn, onNoteOff, latchMode, activeNotes, keyToPitch } = callbacksRef.current;
      const pitch = keyToPitch(e.key);
      if (pitch) {
        if (latchMode) {
          if (activeNotes.has(pitch)) onNoteOff(pitch);
          else onNoteOn(pitch);
        } else {
          onNoteOn(pitch);
        }
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      const { onNoteOff, latchMode, keyToPitch } = callbacksRef.current;
      if (latchMode) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const pitch = keyToPitch(e.key);
      if (pitch) {
        onNoteOff(pitch);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Handle WebMIDI
  useEffect(() => {
    let midiAccess: WebMidi.MIDIAccess | null = null;
    let cleanupFuncs: (() => void)[] = [];

    const onMIDIMessage = (event: WebMidi.MIDIMessageEvent) => {
        if (!event.data) return;
        const [status, data1, data2] = event.data;
        const command = status >> 4;
        const note = data1;
        const velocity = data2 || 0;
        
        const pitch = midiToPitch(note);
        const { onNoteOn, onNoteOff, latchMode, activeNotes } = callbacksRef.current;
        
        // Note on
        if (command === 9 && velocity > 0) {
            if (latchMode) {
                if (activeNotes.has(pitch)) onNoteOff(pitch);
                else onNoteOn(pitch);
            } else {
                onNoteOn(pitch);
            }
        }
        // Note off
        else if (command === 8 || (command === 9 && velocity === 0)) {
            if (!latchMode) {
                onNoteOff(pitch);
            }
        }
    };

    if (navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess().then((access) => {
            midiAccess = access;
            for (let input of access.inputs.values()) {
                input.onmidimessage = onMIDIMessage;
                cleanupFuncs.push(() => {
                   input.onmidimessage = null;
                });
            }
            
            access.onstatechange = (e) => {
                // Re-bind when devices connect
                for (let input of access.inputs.values()) {
                    input.onmidimessage = onMIDIMessage;
                }
            }
        }).catch((err) => console.log('MIDI access failed', err));
    }

    return () => {
        cleanupFuncs.forEach(fn => fn());
        if (midiAccess) {
            midiAccess.onstatechange = null;
        }
    }
  }, []);

  return (
    <div className="flex flex-col bg-[#0A0A0B] border-t border-[#1F1F21] shrink-0 h-44 relative z-20">
      <div className="flex px-4 py-2 border-b border-[#1F1F21] text-[#888] text-[10px] uppercase font-bold tracking-wider items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-[#a1a1a1]">Keyboard</span>
          <div className="flex items-center gap-2">
            <label>QWERTY Octave:</label>
            <select 
              className="bg-[#1A1A1C] border border-[#222] text-[#D1D1D1] rounded px-1 py-0.5 outline-none focus:border-[#D4AF37]"
              value={qwertyOctave}
              onChange={e => setQwertyOctave(parseInt(e.target.value))}
            >
              {[1,2,3,4,5,6].map(o => (
                <option key={o} value={o}>C{o}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="flex-1 flex overflow-x-auto w-full custom-scrollbar pb-2">
        <div className="relative flex min-w-max h-full px-2 mt-2">
          {PIANO_KEYS.map((key, i) => {
            const isWhite = key.color === 'white';
            const isActive = activeNotes.has(key.pitch);
            
            return (
              <div
                key={key.pitch}
                onMouseDown={() => {
                    if (latchMode && isActive) {
                        onNoteOff(key.pitch);
                    } else {
                        onNoteOn(key.pitch);
                    }
                }}
                onMouseEnter={(e) => {
                    if (e.buttons === 1) {
                        if (latchMode && isActive) onNoteOff(key.pitch);
                        else if (latchMode && !isActive) onNoteOn(key.pitch);
                        else if (!latchMode && !isActive) onNoteOn(key.pitch);
                    }
                }}
                onMouseUp={() => {
                    if (!latchMode) onNoteOff(key.pitch);
                }}
                onMouseLeave={() => {
                    if (!latchMode && isActive) onNoteOff(key.pitch);
                }}
                className={cn(
                  "relative flex justify-center items-end pb-2 cursor-pointer transition-colors duration-75 shrink-0",
                  isWhite 
                    ? "w-[40px] border-r border-t border-b border-[#1F1F21] z-0 rounded-b" 
                    : "-ml-[12px] -mr-[12px] h-[65%] w-[24px] rounded-b border border-t-0 border-[#111] z-10 shadow-sm",
                  isWhite && !isActive && "bg-white hover:bg-[#e0e0e0]",
                  isWhite && isActive && "bg-[#D4AF37]",
                  !isWhite && !isActive && "bg-[#111] hover:bg-[#333]",
                  !isWhite && isActive && "bg-[#C19E30]"
                )}
              >
                  {isWhite && <span className={cn("text-[10px] font-bold select-none pointer-events-none mb-1 text-center", isActive ? "text-black" : "text-[#555]")}>{key.pitch}</span>}
              </div>
            );
          })}
        </div>
      </div>
      
      <div className="h-8 bg-[#0F0F10] border-t border-[#1F1F21] flex items-center justify-between px-6 shrink-0">
        <div className="flex gap-4 text-[9px] uppercase tracking-widest text-[#555]">
          <span>MIDI: Ready</span>
          <span>QWERTY: {latchMode ? 'Latch' : 'On'}</span>
        </div>
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <div className="w-32 h-1 bg-[#1F1F21] rounded-full overflow-hidden">
              <div className="w-[65%] h-full bg-[#D4AF37]"></div>
            </div>
            <span className="text-[9px] text-[#8E8E93]">Volume</span>
          </div>
        </div>
      </div>
    </div>
  );
}
