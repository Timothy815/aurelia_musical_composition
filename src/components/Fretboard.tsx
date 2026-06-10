import { useState, useMemo } from 'react';
import { Note } from '@tonaljs/tonal';
import { cn } from '../lib/utils';

interface FretboardProps {
  activeNotes: Set<string>;
  onNoteOn: (pitch: string) => void;
  onNoteOff: (pitch: string) => void;
  latchMode: boolean;
}

// 6 strings highest (top) to lowest (bottom)
const STRINGS = [
  { tune: 64, label: 'e' },
  { tune: 59, label: 'B' },
  { tune: 55, label: 'G' },
  { tune: 50, label: 'D' },
  { tune: 45, label: 'A' },
  { tune: 40, label: 'E' },
];

const COLORS = ['#D4AF37', '#FF6B6B', '#4D96FF', '#6BFF8E', '#B76BFF', '#FFB05C'];

export function Fretboard({ activeNotes, onNoteOn, onNoteOff, latchMode }: FretboardProps) {
  const [fretPosition, setFretPosition] = useState<number | 'all'>('all');
  const [fretSpan, setFretSpan] = useState<number>(4);

  const activeMidis = useMemo(
    () => new Set(Array.from(activeNotes).map(n => Note.midi(n)).filter((n): n is number => n !== null)),
    [activeNotes]
  );

  const classesArray = useMemo<string[]>(
    () => Array.from(new Set(Array.from(activeNotes).map(n => Note.get(n).pc).filter((pc): pc is string => !!pc))).sort(),
    [activeNotes]
  );
  const activeClasses = useMemo(() => new Set<string>(classesArray), [classesArray]);

  const getColor = (pc: string) => {
    const idx = classesArray.indexOf(pc);
    return idx === -1 ? null : COLORS[idx % COLORS.length];
  };

  const isFretInPosition = (fret: number) => {
    if (fretPosition === 'all') return true;
    if (fretPosition === 0) return fret === 0;
    return fret >= (fretPosition as number) && fret < (fretPosition as number) + fretSpan;
  };

  // When 2+ chord tones are active, compute one suggested fret per string.
  // Greedy: lowest fret within current position range that hits a chord tone.
  // Returns null per string if muted (no chord tone in range).
  const suggestedVoicing = useMemo<(number | null)[]>(() => {
    if (activeClasses.size < 2) return STRINGS.map(() => null);

    const startFret = fretPosition === 'all' ? 0 : (fretPosition as number);
    const endFret   = fretPosition === 'all' ? 5 : (fretPosition as number) + fretSpan - 1;

    const voicing = STRINGS.map(str => {
      for (let fret = startFret; fret <= endFret; fret++) {
        const pc = Note.get(Note.fromMidi(str.tune + fret)!).pc;
        if (activeClasses.has(pc)) return fret;
      }
      return null;
    });

    // Only show voicing when every chord tone is covered by at least one string
    const covered = new Set(
      voicing.flatMap((f, i) => {
        if (f === null) return [];
        const pc = Note.get(Note.fromMidi(STRINGS[i].tune + f)!).pc;
        return pc ? [pc] : [];
      })
    );
    return Array.from(activeClasses).every((pc: string) => (covered as Set<string>).has(pc))
      ? voicing
      : STRINGS.map(() => null);
  }, [activeClasses, fretPosition, fretSpan]);

  const hasVoicing = suggestedVoicing.some(f => f !== null);

  const numFrets = 24;

  return (
    <div className="w-full flex flex-col bg-[#0a0a0a] border-t border-[#1F1F21] shrink-0">
      <div className="flex px-4 py-2 border-b border-[#1F1F21] text-[#888] text-[10px] uppercase font-bold tracking-wider items-center justify-between flex-wrap gap-2">
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
              {Array.from({ length: 21 }).map((_, i) => (
                <option key={i + 1} value={i + 1}>Pos {i + 1}</option>
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

        {/* Legend */}
        <div className="flex items-center gap-3 text-[9px] normal-case tracking-normal font-normal text-[#666]">
          {hasVoicing ? (
            <>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full bg-[#D4AF37]" />
                chord voicing
              </span>
              <span className="flex items-center gap-1 text-[#f44]">
                <span className="font-bold">×</span>
                muted string
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full bg-[#D4AF37]" />
                exact note
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full border border-[#D4AF37] bg-[#D4AF37]/20" />
                same note, other octave
              </span>
            </>
          )}
          <span className="text-[#444]">click nut to play open string</span>
        </div>
      </div>

      <div className="w-full flex justify-start py-6 px-4 overflow-x-auto custom-scrollbar select-none min-h-[220px]">
        <div className="relative flex flex-col pt-4 min-w-max mx-auto">
          {/* Fret lines & markers */}
          <div className="absolute inset-0 pointer-events-none flex z-0">
            <div className="w-[44px]" />
            {Array.from({ length: numFrets }).map((_, i) => {
              const fret = i + 1;
              const isMarker = [3, 5, 7, 9, 15, 17, 19, 21].includes(fret);
              const isDouble = fret === 12 || fret === 24;
              const inZone = isFretInPosition(fret);
              return (
                <div
                  key={fret}
                  className={cn('flex-1 flex flex-col items-center justify-center relative border-[#222]', fret === numFrets ? '' : 'border-r')}
                  style={{ minWidth: '60px' }}
                >
                  {!inZone && fretPosition !== 'all' && (
                    <div className="absolute inset-0 bg-black/60 z-0" />
                  )}
                  {(isMarker || isDouble) && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-10">
                      {isDouble ? (
                        <>
                          <div className="w-3 h-3 rounded-full bg-[#2a2a2a]" />
                          <div className="w-3 h-3 rounded-full bg-[#2a2a2a]" />
                        </>
                      ) : (
                        <div className="w-3 h-3 rounded-full bg-[#2a2a2a]" />
                      )}
                    </div>
                  )}
                  <span className={cn('absolute -top-6 text-[10px] font-mono', inZone ? 'text-[#777]' : 'text-[#444]')}>{fret}</span>
                </div>
              );
            })}
          </div>

          {/* Strings & notes */}
          <div className="flex flex-col gap-6 relative z-10 w-full mb-1 mt-1">
            {STRINGS.map((str, sIndex) => {
              const thickness = [1, 1.5, 2, 2.5, 3, 3.5][sIndex];
              const voicingFret = suggestedVoicing[sIndex];
              const isMuted = hasVoicing && voicingFret === null;

              const openPc = Note.get(Note.fromMidi(str.tune)!).pc;
              const openIsVoicing = voicingFret === 0;
              const openIsExact = activeMidis.has(str.tune);
              const openIsClass = !hasVoicing && activeClasses.has(openPc) && isFretInPosition(0);
              const openColor = getColor(openPc);

              return (
                <div key={sIndex} className="flex items-center">
                  {/* Nut / open string — click to play */}
                  <div
                    className={cn(
                      'w-[44px] flex items-center justify-center cursor-pointer border-r-[4px] border-[#a1a1a1] h-8 relative shrink-0',
                      'hover:bg-[#1e1e20] transition-colors',
                      isMuted ? 'bg-[#110000]' : 'bg-[#111]',
                    )}
                    onMouseDown={() => {
                      const pname = Note.fromMidi(str.tune);
                      if (!pname) return;
                      if (latchMode && activeMidis.has(str.tune)) onNoteOff(pname);
                      else onNoteOn(pname);
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
                    {isMuted ? (
                      <span className="text-[#ff4444] text-base font-bold leading-none z-10 select-none">×</span>
                    ) : openIsVoicing ? (
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center pointer-events-none z-10"
                        style={{ backgroundColor: openColor || '#D4AF37', boxShadow: `0 0 10px ${openColor || '#D4AF37'}99` }}
                      >
                        <span className="text-[9px] font-bold text-black">0</span>
                      </div>
                    ) : openIsExact ? (
                      <>
                        <div
                          className="absolute w-6 h-6 rounded-full pointer-events-none"
                          style={{ backgroundColor: openColor || '#D4AF37' }}
                        />
                        <span className="text-[10px] font-mono font-bold text-black z-10">{str.label}</span>
                      </>
                    ) : openIsClass ? (
                      <>
                        <div
                          className="absolute w-6 h-6 rounded-full border pointer-events-none"
                          style={{ borderColor: openColor || '#D4AF37', backgroundColor: `${openColor || '#D4AF37'}33` }}
                        />
                        <span className="text-[10px] font-mono font-bold z-10" style={{ color: openColor || '#D4AF37' }}>{str.label}</span>
                      </>
                    ) : (
                      <span className="text-[10px] font-mono font-bold text-[#555] z-10 group-hover:text-[#888]">{str.label}</span>
                    )}
                  </div>

                  {/* Fret cells */}
                  {Array.from({ length: numFrets }).map((_, fIndex) => {
                    const fret = fIndex + 1;
                    const midi = str.tune + fret;
                    const pitchName = Note.fromMidi(midi);
                    const pc = Note.get(pitchName!).pc;
                    const inZone = isFretInPosition(fret);
                    const isVoicing = voicingFret === fret;
                    const isExact = activeMidis.has(midi) && inZone;
                    // Show class-match dots only when there's no chord voicing active
                    const isClassMatch = !hasVoicing && activeClasses.has(pc) && inZone;
                    const pcColor = getColor(pc);

                    return (
                      <div
                        key={fret}
                        className={cn(
                          'flex-1 relative flex items-center justify-center cursor-pointer group',
                          !inZone && fretPosition !== 'all' ? 'opacity-30 mix-blend-luminosity hover:opacity-80' : '',
                        )}
                        style={{ minWidth: '60px', height: '32px' }}
                        onMouseDown={() => {
                          if (!pitchName) return;
                          if (latchMode && activeMidis.has(midi)) onNoteOff(pitchName);
                          else onNoteOn(pitchName);
                        }}
                        onMouseEnter={e => {
                          if (e.buttons !== 1 || !pitchName) return;
                          if (latchMode && activeMidis.has(midi)) onNoteOff(pitchName);
                          else if (latchMode && !activeMidis.has(midi)) onNoteOn(pitchName);
                          else if (!latchMode && !activeMidis.has(midi)) onNoteOn(pitchName);
                        }}
                        onMouseUp={() => { if (!latchMode && pitchName) onNoteOff(pitchName); }}
                        onMouseLeave={() => { if (!latchMode && pitchName) onNoteOff(pitchName); }}
                      >
                        {/* String line */}
                        <div
                          className="absolute left-0 right-0 bg-[#777] pointer-events-none z-0"
                          style={{ height: `${thickness}px` }}
                        />

                        {/* Note head */}
                        <div
                          className={cn(
                            'relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all',
                            isVoicing || isExact
                              ? 'opacity-100 text-black'
                              : isClassMatch
                                ? 'border opacity-100'
                                : 'bg-[#222] text-[#888] opacity-0 group-hover:opacity-100',
                          )}
                          style={
                            isVoicing || isExact
                              ? { backgroundColor: pcColor || '#D4AF37', boxShadow: `0 0 12px ${pcColor || '#D4AF37'}99` }
                              : isClassMatch
                                ? { backgroundColor: `${pcColor}33`, borderColor: `${pcColor}88`, color: pcColor || '#D4AF37' }
                                : {}
                          }
                        >
                          {pitchName?.replace(/\d/, '')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
