import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  renderNotation,
  calcLayout,
  getMeasureNoteStartX,
  PIXELS_PER_BEAT, FIRST_MEASURE_EXTRA, STAVE_Y_FIRST,
  GRID_TOP_OFFSET, GRID_SUBDIVISIONS, CELL_WIDTH, CELL_HEIGHT,
  TRACK_HEIGHT,
  ChordDiagramResult, collectUniqueChordsForTab, ChordForTab,
} from '../lib/notation';
import { SongData, NoteData, DynamicMarking, ArticulationMarking, InstrumentPreset } from '../types';
import { generateId, cn } from '../lib/utils';

const PITCHES = ['B5', 'A5', 'G5', 'F5', 'E5', 'D5', 'C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4', 'B3', 'A3', 'G3', 'F3', 'E3', 'D3', 'C3', 'B2', 'A2', 'G2', 'F2', 'E2', 'D2', 'C2', 'B1', 'A1', 'G1', 'F1', 'E1'];
const P8 = 32; // container padding (p-8 = 2rem = 32px)

// Dimensions for each chord diagram box
const DIAG_W = 66;
const DIAG_H = 88;
const DIAG_FRET_ROWS = 4;

function ChordDiagramSVG({ frets, baseFret, fg = '#F2F2F2' }: ChordDiagramResult & { fg?: string }) {
  const lPad = baseFret > 1 ? 15 : 5;
  const rPad = 4;
  const tPad = 20;
  const bPad = 6;
  const strW = DIAG_W - lPad - rPad;
  const strSpacing = strW / 5;
  const strXs = Array.from({ length: 6 }, (_, i) => lPad + i * strSpacing);
  const fretSpacing = (DIAG_H - tPad - bPad) / DIAG_FRET_ROWS;
  const fretLineYs = Array.from({ length: DIAG_FRET_ROWS + 1 }, (_, i) => tPad + i * fretSpacing);

  // Diagram left-to-right: low E (index 5) → high e (index 0)
  const diagOrder = [5, 4, 3, 2, 1, 0];

  return (
    <svg width={DIAG_W} height={DIAG_H} viewBox={`0 0 ${DIAG_W} ${DIAG_H}`}>
      {/* Horizontal fret lines */}
      {fretLineYs.map((y, i) => (
        <line key={i} x1={strXs[0]} y1={y} x2={strXs[5]} y2={y}
          stroke={fg} strokeWidth={i === 0 && baseFret === 1 ? 3 : 0.8}
          strokeOpacity={i === 0 && baseFret === 1 ? 0.85 : 0.55} />
      ))}
      {/* Vertical string lines */}
      {strXs.map((x, i) => (
        <line key={i} x1={x} y1={tPad} x2={x} y2={tPad + DIAG_FRET_ROWS * fretSpacing}
          stroke={fg} strokeWidth={0.8} strokeOpacity={0.5} />
      ))}
      {/* String indicators (x/o) and finger dots */}
      {diagOrder.map((strIdx, diagPos) => {
        const fret = frets[strIdx];
        const x = strXs[diagPos];
        const slot = fret != null && fret > 0 ? fret - baseFret : null;
        const inRange = slot !== null && slot >= 0 && slot < DIAG_FRET_ROWS;
        return (
          <g key={diagPos}>
            {fret === null && (
              <text x={x} y={tPad - 5} textAnchor="middle" fontSize={10}
                fontFamily="Arial, sans-serif" fill={fg} fillOpacity={0.45}>×</text>
            )}
            {fret === 0 && (
              <circle cx={x} cy={tPad - 7} r={3} fill="none"
                stroke={fg} strokeWidth={1} strokeOpacity={0.75} />
            )}
            {inRange && (
              <circle cx={x} cy={fretLineYs[slot!] + fretSpacing / 2}
                r={fretSpacing * 0.34} fill={fg} fillOpacity={0.88} />
            )}
          </g>
        );
      })}
      {/* Position label (e.g. "5fr") when not in open position */}
      {baseFret > 1 && (
        <text x={lPad - 3} y={fretLineYs[0] + fretSpacing * 0.65}
          textAnchor="end" fontSize={7} fontFamily="Arial, sans-serif"
          fill={fg} fillOpacity={0.65}>{baseFret}fr</text>
      )}
    </svg>
  );
}

type DragBox = {
  tIndex: number;
  startBeat: number;
  startRIndex: number;
  endBeat: number;
  endRIndex: number;
};

type NoteDragState = {
  tIndex: number;
  noteIds: string[];
  startBeat: number;
  startRIndex: number;
  endBeat: number;
  endRIndex: number;
};

export function Notation({
  song,
  onUpdateSong,
  onPlayNote,
  chordMode,
  chordNotes,
  selectedDuration,
  isDotted,
  isRest,
  chordSelectMode,
  selectedNoteIds,
  setSelectedNoteIds,
  activeVoice,
  loopEnabled,
  loopStart,
  loopEnd,
  chordLabels,
  showGuitarTab = false,
  currentDynamic,
  currentArticulation,
  activeTrackIndex = 0,
  onSetActiveTrack,
  onSetTrackNotes,
}: {
  song: SongData;
  onUpdateSong: (s: SongData | ((s: SongData) => SongData)) => void;
  onPlayNote?: (pitch: string, instrument?: InstrumentPreset) => void;
  chordMode: boolean;
  chordNotes: Set<string>;
  selectedDuration: number;
  isDotted: boolean;
  isRest: boolean;
  chordSelectMode: boolean;
  selectedNoteIds: Set<string>;
  setSelectedNoteIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  activeVoice?: 1 | 2;
  loopEnabled?: boolean;
  loopStart?: number;
  loopEnd?: number;
  chordLabels?: Map<number, string>;
  showGuitarTab?: boolean;
  currentDynamic?: DynamicMarking | null;
  currentArticulation?: ArticulationMarking | null;
  activeTrackIndex?: number;
  onSetActiveTrack?: (tIndex: number) => void;
  onSetTrackNotes?: (trackId: string, notes: NoteData[] | ((prev: NoteData[]) => NoteData[])) => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const [noteDrag, setNoteDrag] = useState<NoteDragState | null>(null);

  useEffect(() => {
    if (!outerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    ro.observe(outerRef.current);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => calcLayout(song, containerWidth, showGuitarTab), [song, containerWidth, showGuitarTab]);

  useEffect(() => {
    if (!containerRef.current) return;
    renderNotation(containerRef.current, song, 'dark', containerWidth, showGuitarTab);
  }, [song, containerWidth, showGuitarTab]);

  const handleGridClick = useCallback((tIndex: number, beat: number, pitch: string) => {
    const track = song.tracks[tIndex];
    let dur = selectedDuration;
    if (isDotted) dur *= 1.5;

    const existingIdx = track.notes.findIndex(n =>
      n.pitch === pitch && beat >= n.start && beat < n.start + n.duration - 0.01
    );

    if (existingIdx !== -1) {
      const removedId = track.notes[existingIdx].id;
      const newNotes = track.notes.filter((_, i) => i !== existingIdx);
      setSelectedNoteIds(prev => { const n = new Set(prev); n.delete(removedId); return n; });
      if (onSetTrackNotes) {
        onSetTrackNotes(track.id, newNotes);
      } else {
        const newTracks = [...song.tracks];
        newTracks[tIndex] = { ...track, notes: newNotes };
        onUpdateSong({ ...song, tracks: newTracks });
      }
      return;
    }

    setSelectedNoteIds(new Set());
    const newNotes = [...track.notes];
    const dyn = currentDynamic ?? undefined;
    const artic = currentArticulation ?? undefined;

    if (isRest) {
      newNotes.push({ id: generateId(), pitch, start: beat, duration: dur, isRest: true });
    } else if (chordNotes.size > 0) {
      Array.from(chordNotes).forEach(cp => {
        newNotes.push({ id: generateId(), pitch: cp, start: beat, duration: dur, isRest: false, voice: activeVoice ?? 1, dynamic: dyn, articulation: artic });
      });
    } else {
      newNotes.push({ id: generateId(), pitch, start: beat, duration: dur, isRest: false, voice: activeVoice ?? 1, dynamic: dyn, articulation: artic });
      if (onPlayNote) onPlayNote(pitch, song.tracks[tIndex].instrument);
    }

    if (onSetTrackNotes) {
      onSetTrackNotes(track.id, newNotes);
    } else {
      const newTracks = [...song.tracks];
      newTracks[tIndex] = { ...track, notes: newNotes };
      onUpdateSong({ ...song, tracks: newTracks });
    }
  }, [song, selectedDuration, isDotted, isRest, chordNotes, onPlayNote, onUpdateSong, onSetTrackNotes, setSelectedNoteIds, activeVoice, currentDynamic, currentArticulation]);

  const commitDragBox = useCallback((box: DragBox) => {
    const minBeat = Math.min(box.startBeat, box.endBeat);
    const maxBeat = Math.max(box.startBeat, box.endBeat) + 1 / GRID_SUBDIVISIONS;
    const minR = Math.min(box.startRIndex, box.endRIndex);
    const maxR = Math.max(box.startRIndex, box.endRIndex);
    const pitches = new Set(PITCHES.slice(minR, maxR + 1));
    const track = song.tracks[box.tIndex];
    const enclosed = track.notes.filter(n =>
      n.start < maxBeat && n.start + n.duration > minBeat && pitches.has(n.pitch)
    );
    setSelectedNoteIds(new Set(enclosed.map(n => n.id)));
  }, [song, setSelectedNoteIds]);

  const commitNoteDrag = useCallback((drag: NoteDragState) => {
    const deltaBeat = drag.endBeat - drag.startBeat;
    const deltaR = drag.endRIndex - drag.startRIndex;
    if (deltaBeat === 0 && deltaR === 0) return;
    onUpdateSong(prev => ({
      ...prev,
      tracks: prev.tracks.map(t => ({
        ...t,
        notes: t.notes.map(n => {
          if (!drag.noteIds.includes(n.id)) return n;
          const newStart = Math.max(0, n.start + deltaBeat);
          const pitchIdx = PITCHES.indexOf(n.pitch);
          const newPitchIdx = Math.max(0, Math.min(PITCHES.length - 1, pitchIdx + deltaR));
          return { ...n, start: newStart, pitch: PITCHES[newPitchIdx] };
        })
      }))
    }));
  }, [onUpdateSong]);

  const handleGlobalMouseUp = useCallback(() => {
    if (noteDrag) {
      commitNoteDrag(noteDrag);
      setNoteDrag(null);
      return;
    }
    if (dragBox) {
      const isSingleCell = dragBox.startBeat === dragBox.endBeat && dragBox.startRIndex === dragBox.endRIndex;
      if (isSingleCell) {
        handleGridClick(dragBox.tIndex, dragBox.startBeat, PITCHES[dragBox.startRIndex]);
      } else {
        commitDragBox(dragBox);
      }
      setDragBox(null);
    }
  }, [dragBox, noteDrag, commitDragBox, commitNoteDrag, handleGridClick]);

  useEffect(() => {
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleGlobalMouseUp]);

  // Arrow keys + delete (copy/paste handled in App.tsx)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey) return;

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (selectedNoteIds.size === 0) return;
      onUpdateSong(prev => {
        const selectedNotes = prev.tracks.flatMap(t => t.notes).filter(n => selectedNoteIds.has(n.id));
        // Strip accidentals to find the grid row — notes like "Eb4" live on the "E4" row
        const rowOf = (pitch: string) => PITCHES.indexOf(pitch.replace(/[#b]/, ''));
        // All notes must be able to move — if any hit the boundary, hold the whole chord
        const canAllMove = selectedNotes.every(n => {
          const idx = rowOf(n.pitch);
          if (idx === -1) return false;
          const next = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
          return next >= 0 && next < PITCHES.length;
        });
        if (!canAllMove) return prev;
        const newTracks = prev.tracks.map(t => ({
          ...t,
          notes: t.notes.map(n => {
            if (!selectedNoteIds.has(n.id)) return n;
            const idx = rowOf(n.pitch);
            if (idx === -1) return n;
            const next = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
            if (onPlayNote && !n.isRest) onPlayNote(PITCHES[next]);
            return { ...n, pitch: PITCHES[next] };
          })
        }));
        return { ...prev, tracks: newTracks };
      });
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const allNotes = song.tracks.flatMap(t => t.notes).sort((a, b) =>
        Math.abs(a.start - b.start) > 0.001 ? a.start - b.start : a.pitch.localeCompare(b.pitch)
      );
      if (allNotes.length === 0) return;

      if (selectedNoteIds.size === 0) {
        const n = e.key === 'ArrowRight' ? allNotes[0] : allNotes[allNotes.length - 1];
        const ids = chordSelectMode
          ? allNotes.filter(x => Math.abs(x.start - n.start) < 0.001).map(x => x.id)
          : [n.id];
        setSelectedNoteIds(new Set(ids));
        if (onPlayNote && !n.isRest) {
          (chordSelectMode ? allNotes.filter(x => Math.abs(x.start - n.start) < 0.001) : [n])
            .filter(x => !x.isRest).forEach(x => onPlayNote(x.pitch));
        }
        return;
      }

      const selectedId = Array.from(selectedNoteIds)[0];
      const curIdx = allNotes.findIndex(n => n.id === selectedId);
      if (curIdx === -1) return;
      const curStart = allNotes[curIdx].start;

      let nextIdx = curIdx;
      if (chordSelectMode) {
        if (e.key === 'ArrowRight') {
          const next = allNotes.find(n => n.start > curStart + 0.001);
          if (next) nextIdx = allNotes.indexOf(next);
        } else {
          const prev = [...allNotes].reverse().find(n => n.start < curStart - 0.001);
          if (prev) nextIdx = allNotes.findIndex(n => Math.abs(n.start - prev.start) < 0.001);
        }
      } else {
        nextIdx = Math.max(0, Math.min(allNotes.length - 1, curIdx + (e.key === 'ArrowRight' ? 1 : -1)));
      }

      const nextNote = allNotes[nextIdx];
      const ids = chordSelectMode
        ? allNotes.filter(n => Math.abs(n.start - nextNote.start) < 0.001).map(n => n.id)
        : [nextNote.id];
      setSelectedNoteIds(new Set(ids));
      if (onPlayNote && !nextNote.isRest) {
        (chordSelectMode ? allNotes.filter(n => Math.abs(n.start - nextNote.start) < 0.001) : [nextNote])
          .filter(n => !n.isRest).forEach(n => onPlayNote(n.pitch));
      }
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (selectedNoteIds.size > 0) {
        // Multi-track deletion — global history
        onUpdateSong(prev => {
          const allNotes = prev.tracks.flatMap(t => t.notes);
          const deletedMap = new Map<number, number>();
          allNotes.forEach(n => {
            if (!selectedNoteIds.has(n.id)) return;
            deletedMap.set(n.start, Math.max(deletedMap.get(n.start) ?? 0, n.duration));
          });
          const sorted = [...deletedMap.entries()].sort(([a], [b]) => a - b).map(([start, dur]) => ({ start, dur }));
          const shiftFor = (s: number) => sorted.reduce((acc, b) => acc + (b.start < s - 0.001 ? b.dur : 0), 0);
          let changed = false;
          const newTracks = prev.tracks.map(t => {
            const before = t.notes.length;
            const remaining = t.notes.filter(n => !selectedNoteIds.has(n.id)).map(n => ({ ...n, start: n.start - shiftFor(n.start) }));
            if (remaining.length !== before) changed = true;
            return { ...t, notes: remaining };
          });
          setSelectedNoteIds(new Set());
          return changed ? { ...prev, tracks: newTracks } : prev;
        });
      } else {
        // Pop last chord from active track — per-track history
        const tIdx = (activeTrackIndex < song.tracks.length && song.tracks[activeTrackIndex].notes.length > 0)
          ? activeTrackIndex
          : song.tracks.findIndex(t => t.notes.length > 0);
        if (tIdx === -1) return;
        const track = song.tracks[tIdx];
        const last = track.notes[track.notes.length - 1];
        const newNotes = track.notes.filter(n => Math.abs(n.start - last.start) > 0.001);
        if (onSetTrackNotes) {
          onSetTrackNotes(track.id, newNotes);
        } else {
          const newTracks = [...song.tracks];
          newTracks[tIdx] = { ...track, notes: newNotes };
          onUpdateSong({ ...song, tracks: newTracks });
        }
      }
    }
  }, [song, selectedNoteIds, onUpdateSong, onSetTrackNotes, onPlayNote, setSelectedNoteIds, chordSelectMode, activeTrackIndex]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const { measuresPerRow, totalMeasures, numRows, beatsPerMeasure, notesWidthPerMeasure, svgHeight, svgWidth, effectiveTrackHeight, rowHeight, trackYOffsets } = layout;

  const uniqueChordsForTab = useMemo<ChordForTab[]>(() => {
    if (!showGuitarTab) return [];
    return collectUniqueChordsForTab(song);
  }, [showGuitarTab, song]);

  // Compute note drag ghost positions for preview
  const dragGhostKeys = useMemo<Set<string>>(() => {
    if (!noteDrag) return new Set();
    const deltaBeat = noteDrag.endBeat - noteDrag.startBeat;
    const deltaR = noteDrag.endRIndex - noteDrag.startRIndex;
    const result = new Set<string>();
    song.tracks[noteDrag.tIndex]?.notes.forEach(n => {
      if (!noteDrag.noteIds.includes(n.id)) return;
      const newBeat = Math.max(0, n.start + deltaBeat);
      const pitchIdx = PITCHES.indexOf(n.pitch);
      const newPitchIdx = Math.max(0, Math.min(PITCHES.length - 1, pitchIdx + deltaR));
      result.add(`${newBeat.toFixed(3)}-${newPitchIdx}`);
    });
    return result;
  }, [noteDrag, song]);

  return (
    <div ref={outerRef} className="relative w-full h-full overflow-auto bg-[#050506] p-8 group">
      <div style={{ minHeight: svgHeight + 64, minWidth: svgWidth }}>
        {/* VexFlow SVG */}
        <div ref={containerRef} className="absolute top-8 left-8 z-0 pointer-events-none" />

        {/* Loop region band */}
        {loopEnabled && typeof loopStart === 'number' && typeof loopEnd === 'number' &&
          Array.from({ length: numRows }, (_, rowIdx) => {
            const rowStartBeat = rowIdx * measuresPerRow * beatsPerMeasure;
            const rowEndBeat = rowStartBeat + measuresPerRow * beatsPerMeasure;
            const overlapStart = Math.max(loopStart, rowStartBeat);
            const overlapEnd = Math.min(loopEnd, rowEndBeat);
            if (overlapStart >= overlapEnd) return null;

            const beatToX = (b: number) => {
              const mIdx = Math.floor(b / beatsPerMeasure);
              const cIdx = mIdx % measuresPerRow;
              const beatInMeasure = b - mIdx * beatsPerMeasure;
              return getMeasureNoteStartX(cIdx, notesWidthPerMeasure) + beatInMeasure * PIXELS_PER_BEAT;
            };

            const x1 = beatToX(overlapStart);
            const x2 = beatToX(overlapEnd);
            const top = P8 + rowIdx * rowHeight + STAVE_Y_FIRST - GRID_TOP_OFFSET;
            const height = rowHeight;

            return (
              <div
                key={rowIdx}
                className="absolute pointer-events-none z-5"
                style={{
                  left: P8 + x1,
                  top,
                  width: x2 - x1,
                  height,
                  background: 'rgba(212,175,55,0.07)',
                  borderLeft: '1px solid rgba(212,175,55,0.35)',
                  borderRight: '1px solid rgba(212,175,55,0.35)',
                }}
              />
            );
          })
        }

        {/* Chord labels above first track's stave */}
        {chordLabels && [...chordLabels.entries()].map(([beatPos, label]) => {
          const mIndex = Math.floor(beatPos / beatsPerMeasure);
          const rowIdx = Math.floor(mIndex / measuresPerRow);
          const colIdx = mIndex % measuresPerRow;
          if (rowIdx >= numRows) return null;
          const beatInMeasure = beatPos - mIndex * beatsPerMeasure;
          const x = P8 + getMeasureNoteStartX(colIdx, notesWidthPerMeasure) + beatInMeasure * PIXELS_PER_BEAT;
          const y = P8 + rowIdx * rowHeight + STAVE_Y_FIRST - 14;
          return (
            <div
              key={`chord-${beatPos}`}
              className="absolute z-20 pointer-events-none select-none"
              style={{ left: x, top: y, transform: 'translate(-50%, -100%)' }}
            >
              <span className="text-[10px] font-serif italic text-[#D4AF37] whitespace-nowrap leading-none">
                {label}
              </span>
            </div>
          );
        })}

        {/* Per-track, per-measure grid sections */}
        {song.tracks.map((track, tIndex) =>
          Array.from({ length: numRows }, (_, rowIdx) =>
            Array.from(
              { length: Math.min(measuresPerRow, totalMeasures - rowIdx * measuresPerRow) },
              (_, colIdx) => {
                const mIndex = rowIdx * measuresPerRow + colIdx;
                const mStart = mIndex * beatsPerMeasure;

                const sectionLeft = P8 + getMeasureNoteStartX(colIdx, notesWidthPerMeasure);
                const sectionTop = P8 + rowIdx * rowHeight + trackYOffsets[tIndex] + STAVE_Y_FIRST - GRID_TOP_OFFSET;

                return (
                  <div
                    key={`${tIndex}-${rowIdx}-${colIdx}`}
                    className={cn("absolute z-10 transition-opacity", chordMode ? "opacity-0 hover:opacity-100" : "opacity-60 hover:opacity-100")}
                    style={{
                      left: sectionLeft,
                      top: sectionTop,
                      width: notesWidthPerMeasure,
                      height: PITCHES.length * CELL_HEIGHT,
                      outline: (!chordMode && tIndex === activeTrackIndex)
                        ? `1px solid ${song.tracks[tIndex]?.color ?? '#D4AF37'}40`
                        : undefined,
                    }}
                    onMouseDown={() => { if (!chordMode) onSetActiveTrack?.(tIndex); }}
                  >
                    {PITCHES.map((pitch, rIdx) => (
                      <div key={pitch} className="flex" style={{ height: CELL_HEIGHT }}>
                        {Array.from({ length: beatsPerMeasure * GRID_SUBDIVISIONS }, (_, cIdx) => {
                          const beat = mStart + cIdx / GRID_SUBDIVISIONS;

                          const spanNotes = track.notes.filter(n =>
                            n.pitch === pitch && beat >= n.start && beat < n.start + n.duration - 0.01
                          );
                          const isActive = spanNotes.length > 0;
                          const isSelected = spanNotes.some(n => selectedNoteIds.has(n.id));
                          const activeIsRest = isActive && spanNotes.every(n => n.isRest);

                          const startNotes = track.notes.filter(n =>
                            Math.abs(n.start - beat) < 0.01 && n.pitch === pitch
                          );
                          const isStart = startNotes.length > 0;
                          const isStartSelected = startNotes.some(n => selectedNoteIds.has(n.id));
                          const startIsRest = isStart && startNotes.every(n => n.isRest);

                          const isStaged = chordNotes.has(pitch);
                          const inLoop = loopEnabled && typeof loopStart === 'number' && typeof loopEnd === 'number'
                            && beat >= loopStart && beat < loopEnd;

                          const dbOverlap = dragBox && dragBox.tIndex === tIndex
                            && beat >= Math.min(dragBox.startBeat, dragBox.endBeat)
                            && beat <= Math.max(dragBox.startBeat, dragBox.endBeat)
                            && rIdx >= Math.min(dragBox.startRIndex, dragBox.endRIndex)
                            && rIdx <= Math.max(dragBox.startRIndex, dragBox.endRIndex);

                          const isNoteDragSource = noteDrag && noteDrag.tIndex === tIndex
                            && spanNotes.some(n => noteDrag.noteIds.includes(n.id));

                          const ghostKey = `${beat.toFixed(3)}-${rIdx}`;
                          const isNoteDragGhost = noteDrag && noteDrag.tIndex === tIndex && dragGhostKeys.has(ghostKey);

                          return (
                            <div
                              key={cIdx}
                              className={cn(
                                "border-r border-b border-[#D4AF37]/5 cursor-pointer transition-colors",
                                !isActive && !isSelected && !isStaged ? "hover:bg-[#D4AF37]/20" : "",
                                isActive && !isSelected && !activeIsRest ? "bg-[#D4AF37]/40" : "",
                                isActive && !isSelected && activeIsRest ? "bg-[#8E8E93]/40" : "",
                                isStart && !isStartSelected && !startIsRest ? "border-l-2 border-l-[#D4AF37]/80 bg-[#D4AF37]/60" : "",
                                isStart && !isStartSelected && startIsRest ? "border-l-2 border-l-[#8E8E93]/80 bg-[#8E8E93]/60" : "",
                                isSelected && !isStartSelected ? "bg-[#4D96FF]/40" : "",
                                isStartSelected ? "border-l-2 border-l-[#4D96FF]/80 bg-[#4D96FF]/60" : "",
                                isStaged && !isActive ? "bg-[#D4AF37]/10" : "",
                                dbOverlap ? "bg-[#4D96FF]/25" : "",
                                isNoteDragSource ? "opacity-40" : "",
                                isNoteDragGhost && !isActive ? "bg-[#7EB7FF]/50 border-l-2 border-l-[#4D96FF]" : "",
                              )}
                              style={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
                              onMouseDown={e => {
                                e.preventDefault();
                                if (isStart && !chordMode) {
                                  const ids = startNotes.some(n => selectedNoteIds.has(n.id))
                                    ? Array.from(selectedNoteIds)
                                    : startNotes.map(n => n.id);
                                  if (!startNotes.some(n => selectedNoteIds.has(n.id))) {
                                    setSelectedNoteIds(new Set(startNotes.map(n => n.id)));
                                  }
                                  setNoteDrag({ tIndex, noteIds: ids, startBeat: beat, startRIndex: rIdx, endBeat: beat, endRIndex: rIdx });
                                } else {
                                  setDragBox({ tIndex, startBeat: beat, startRIndex: rIdx, endBeat: beat, endRIndex: rIdx });
                                }
                              }}
                              onMouseEnter={e => {
                                if (e.buttons !== 1) return;
                                if (noteDrag && noteDrag.tIndex === tIndex) {
                                  setNoteDrag(prev => prev ? { ...prev, endBeat: beat, endRIndex: rIdx } : null);
                                } else if (dragBox && dragBox.tIndex === tIndex) {
                                  setDragBox(prev => prev ? { ...prev, endBeat: beat, endRIndex: rIdx } : null);
                                }
                              }}
                            />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                );
              }
            )
          )
        )}
      </div>

      {/* Guitar chord dictionary — appears below all staves when tab view is on */}
      {showGuitarTab && uniqueChordsForTab.length > 0 && (
        <div className="mt-6 pb-4">
          <div className="text-[11px] font-sans text-[#D4AF37]/60 uppercase tracking-widest mb-3">
            Guitar Chord Dictionary
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-5">
            {uniqueChordsForTab.map(chord => (
              <div key={chord.pcKey} className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-serif italic text-[#C8C8D0]/80">
                  {chord.label}
                </span>
                <ChordDiagramSVG {...chord.diagram} fg="#C8C8D0" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
