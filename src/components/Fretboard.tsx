import { useState, useMemo } from 'react';
import { Note } from '@tonaljs/tonal';
import { cn } from '../lib/utils';

interface FretboardProps {
  activeNotes: Set<string>;
  onNoteOn: (pitch: string) => void;
  onNoteOff: (pitch: string) => void;
  latchMode: boolean; // Not strictly handled in same UX as piano if we just play, but okay
}

// 6 Strings from highest to lowest visually (top of screen to bottom)
// E4, B3, G3, D3, A2, E2
const STRINGS = [
  { tune: 64, label: 'e' }, 
  { tune: 59, label: 'B' },
  { tune: 55, label: 'G' },
  { tune: 50, label: 'D' },
  { tune: 45, label: 'A' },
  { tune: 40, label: 'E' }
];

export function Fretboard({ activeNotes, onNoteOn, onNoteOff, latchMode }: FretboardProps) {
  const [fretPosition, setFretPosition] = useState<number | 'all'>('all');
  const [fretSpan, setFretSpan] = useState<number>(4);

  // Convert active pitches down/up to a consistent standard or just use raw strings
  // but simpler to use MIDI to handle enharmonic notes
  const activeMidis = new Set(
    Array.from(activeNotes).map(n => Note.midi(n)).filter(n => n !== null)
  );
  
  // extract unique pitch classes
  const classesArray = Array.from(new Set(
    Array.from(activeNotes).map(n => Note.get(n).pc).filter(n => n)
  )).sort();
  const activeClasses = new Set(classesArray);

  const numFrets = 24;
  
  const COLORS = ['#D4AF37', '#FF6B6B', '#4D96FF', '#6BFF8E', '#B76BFF', '#FFB05C'];
  
  const getColor = (pc: string) => {
      const idx = classesArray.indexOf(pc);
      if (idx === -1) return null;
      return COLORS[idx % COLORS.length];
  };

  const isFretInPosition = (fret: number) => {
    if (fretPosition === 'all') return true;
    if (fretPosition === 0) return fret === 0;
    return fret >= fretPosition && fret < fretPosition + fretSpan;
  };

  return (
    <div className="w-full flex flex-col bg-[#0a0a0a] border-t border-[#1F1F21] shrink-0">
      <div className="flex px-4 py-2 border-b border-[#1F1F21] text-[#888] text-[10px] uppercase font-bold tracking-wider items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-[#a1a1a1]">Fretboard</span>
          <div className="flex items-center gap-2">
            <label>Position:</label>
            <select 
              className="bg-[#1A1A1C] border border-[#222] text-[#D1D1D1] rounded px-1 py-0.5 outline-none focus:border-[#D4AF37]"
              value={fretPosition}
              onChange={e => setFretPosition(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
            >
              <option value="all">All</option>
              <option value={0}>Open (0)</option>
              {Array.from({length: 21}).map((_, i) => (
                <option key={i+1} value={i+1}>Pos {i+1}</option>
              ))}
            </select>
          </div>
          {fretPosition !== 'all' && fretPosition !== 0 && (
            <div className="flex items-center gap-2">
              <label>Span (Frets):</label>
              <select 
                className="bg-[#1A1A1C] border border-[#222] text-[#D1D1D1] rounded px-1 py-0.5 outline-none focus:border-[#D4AF37]"
                value={fretSpan}
                onChange={e => setFretSpan(parseInt(e.target.value))}
              >
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
                <option value={6}>6</option>
              </select>
            </div>
          )}
        </div>
      </div>
      
      <div className="w-full flex justify-start py-6 px-4 overflow-x-auto custom-scrollbar select-none min-h-[220px]">
        <div className="relative flex flex-col pt-4 min-w-max mx-auto">
          {/* Frets / Background */}
          <div className="absolute inset-0 pointer-events-none flex z-0">
            <div className="w-[40px]"></div> {/* nut */}
            {Array.from({ length: numFrets }).map((_, i) => {
              const fret = i + 1;
              const isMarker = [3, 5, 7, 9, 15, 17, 19, 21].includes(fret);
              const isDouble = fret === 12 || fret === 24;
              const inZone = isFretInPosition(fret);
              return (
                <div key={fret} className={cn("flex-1 flex flex-col items-center justify-center relative border-[#222]", fret === numFrets ? "" : "border-r")} style={{ minWidth: '60px' }}>
                  {!inZone && fretPosition !== 'all' && (
                     <div className="absolute inset-0 bg-black/60 z-0"></div>
                  )}
                  {(isMarker || isDouble) && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-10">
                      {isDouble ? (
                        <>
                          <div className="w-3 h-3 rounded-full bg-[#2a2a2a]"></div>
                          <div className="w-3 h-3 rounded-full bg-[#2a2a2a]"></div>
                        </>
                      ) : (
                        <div className="w-3 h-3 rounded-full bg-[#2a2a2a]"></div>
                      )}
                    </div>
                  )}
                  <span className={cn("absolute -top-6 text-[10px] font-mono", inZone ? "text-[#777]" : "text-[#444]")}>{fret}</span>
                </div>
              );
            })}
          </div>

          {/* Strings & Notes */}
          <div className="flex flex-col gap-6 relative z-10 w-full mb-1 mt-1">
            {STRINGS.map((str, sIndex) => {
              const thickness = [1, 1.5, 2, 2.5, 3, 3.5][sIndex];
              const stringOpenInZone = isFretInPosition(0) || fretPosition === 'all';
              const stringOpenIsExact = activeMidis.has(str.tune);
              const stringOpenIsClass = activeClasses.has(Note.get(Note.fromMidi(str.tune)!).pc) && stringOpenInZone;

              return (
                <div key={sIndex} className="flex items-center">
                  {/* Nut/Open String */}
                  <div 
                    className="w-[40px] flex items-center justify-center cursor-pointer border-r-[4px] border-[#a1a1a1] bg-[#111] h-8 relative"
                    onMouseDown={() => {
                      const pname = Note.fromMidi(str.tune);
                      if (pname) {
                        if (latchMode && activeMidis.has(str.tune)) {
                          onNoteOff(pname);
                        } else {
                          onNoteOn(pname);
                        }
                      }
                    }}
                    onMouseUp={() => {
                      if (!latchMode) {
                        const pname = Note.fromMidi(str.tune);
                        if (pname) onNoteOff(pname);
                      }
                    }}
                    onMouseLeave={() => {
                      if (!latchMode) {
                        const pname = Note.fromMidi(str.tune);
                        if (pname) onNoteOff(pname);
                      }
                    }}
                  >
                    {!stringOpenInZone && fretPosition !== 'all' && (
                       <div className="absolute inset-0 bg-black/60 z-20 pointer-events-none"></div>
                    )}
                    <span className={cn(
                      "text-xs font-mono font-bold z-10",
                      stringOpenIsExact && stringOpenInZone ? "text-black" : stringOpenIsClass ? "" : "text-[#888]"
                    )} 
                    style={stringOpenIsExact && stringOpenInZone ? {} : { color: getColor(Note.get(Note.fromMidi(str.tune)!).pc) || undefined }}>{str.label}</span>
                    
                    {stringOpenIsExact && stringOpenInZone ? (
                      <div className="absolute w-6 h-6 rounded-full pointer-events-none" style={{ backgroundColor: getColor(Note.get(Note.fromMidi(str.tune)!).pc) || '#D4AF37' }}></div>
                    ) : stringOpenIsClass ? (
                      <div className="absolute w-6 h-6 rounded-full border pointer-events-none" style={{ borderColor: getColor(Note.get(Note.fromMidi(str.tune)!).pc) || '#D4AF37', backgroundColor: `${getColor(Note.get(Note.fromMidi(str.tune)!).pc)}33` || 'rgba(212,175,55,0.2)' }}></div>
                    ) : null}
                  </div>
                  
                  {/* Fret Buttons */}
                  {Array.from({ length: numFrets }).map((_, fIndex) => {
                    const fret = fIndex + 1;
                    const midi = str.tune + fret;
                    const pitchName = Note.fromMidi(midi);
                    const pc = Note.get(pitchName!).pc;
                    const inZone = isFretInPosition(fret);
                    const isExact = activeMidis.has(midi) && inZone;
                    const isClassMatch = activeClasses.has(pc) && inZone;
                    const pcColor = getColor(pc);

                    return (
                      <div 
                        key={fret} 
                        className={cn(
                          "flex-1 relative flex items-center justify-center cursor-pointer group",
                          (!inZone && fretPosition !== 'all') ? "opacity-30 mix-blend-luminosity hover:opacity-80" : ""
                        )}
                        style={{ minWidth: '60px', height: '32px' }}
                        onMouseDown={() => {
                          if (pitchName) {
                            if (latchMode && activeMidis.has(midi)) {
                              onNoteOff(pitchName);
                            } else {
                              onNoteOn(pitchName);
                            }
                          }
                        }}
                        onMouseEnter={(e) => {
                          if (e.buttons === 1 && pitchName) {
                            if (latchMode && activeMidis.has(midi)) onNoteOff(pitchName);
                            else if (latchMode && !activeMidis.has(midi)) onNoteOn(pitchName);
                            else if (!latchMode && !activeMidis.has(midi)) onNoteOn(pitchName);
                          }
                        }}
                        onMouseUp={() => {
                          if (!latchMode && pitchName) onNoteOff(pitchName);
                        }}
                        onMouseLeave={() => {
                          if (!latchMode && pitchName) onNoteOff(pitchName);
                        }}
                      >
                        {/* String Line */}
                        <div className="absolute left-0 right-0 bg-[#777] shadow-sm pointer-events-none z-0" style={{ height: `${thickness}px` }}></div>
                        
                        {/* Note Head */}
                        <div className={cn(
                          "relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all",
                          isExact 
                            ? "text-black opacity-100" 
                            : isClassMatch
                              ? "border opacity-100"
                              : "bg-[#222] text-[#888] opacity-0 group-hover:opacity-100"
                        )}
                        style={
                           isExact 
                             ? { backgroundColor: pcColor || '#D4AF37', boxShadow: `0 0 12px ${pcColor}99` } 
                             : isClassMatch 
                               ? { backgroundColor: `${pcColor}33`, borderColor: `${pcColor}88`, color: pcColor || '#D4AF37' }
                               : {}
                        }>
                          {pitchName?.replace(/\d/, '')}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
