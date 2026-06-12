import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  renderNotation,
  calcLayout,
  getMeasureNoteStartX,
  rowBaseY,
  PIXELS_PER_BEAT, FIRST_MEASURE_EXTRA, STAVE_Y_FIRST,
  GRID_TOP_OFFSET, GRID_SUBDIVISIONS, CELL_WIDTH, CELL_HEIGHT,
  TRACK_HEIGHT,
  PAGE_INNER_WIDTH, PAGE_FULL_WIDTH, PAGE_FULL_HEIGHT,
  PAGE_MARGIN_TOP, PAGE_MARGIN_BOTTOM, PAGE_BETWEEN_GAP,
  ChordDiagramResult, collectUniqueChordsForTab, ChordForTab,
  DIAG_W, DIAG_H, DIAG_FRET_ROWS, analyzeChordDiagram,
} from '../lib/notation';
import { SongData, NoteData, DynamicMarking, ArticulationMarking, InstrumentPreset } from '../types';
import { generateId, cn } from '../lib/utils';

const PITCHES = ['B5', 'A5', 'G5', 'F5', 'E5', 'D5', 'C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4', 'B3', 'A3', 'G3', 'F3', 'E3', 'D3', 'C3', 'B2', 'A2', 'G2', 'F2', 'E2', 'D2', 'C2', 'B1', 'A1', 'G1', 'F1', 'E1'];
const P8 = 32; // container padding (p-8 = 2rem = 32px)

// Dimensions for each chord diagram box
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
  const diagOrder = [5, 4, 3, 2, 1, 0];
  const dotR = fretSpacing * 0.34;
  const { barre, dotFingers } = analyzeChordDiagram(frets, baseFret);

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
      {/* Barre bar */}
      {barre && (() => {
        const x1 = strXs[barre.startDiagPos];
        const x2 = strXs[barre.endDiagPos];
        const cy = fretLineYs[barre.slot] + fretSpacing / 2;
        return (
          <g key="barre">
            <rect x={x1 - dotR} y={cy - dotR} width={x2 - x1 + 2 * dotR} height={2 * dotR}
              rx={dotR} fill={fg} fillOpacity={0.88} />
            <text x={(x1 + x2) / 2} y={cy} textAnchor="middle" dominantBaseline="central"
              fontSize={7} fontWeight="bold" fontFamily="Arial, sans-serif"
              fill={baseFret > 1 ? '#222' : '#fff'}>1</text>
          </g>
        );
      })()}
      {/* Individual finger dots */}
      {dotFingers.filter(d => !(barre && d.slot === barre.slot)).map(({ diagPos, slot, finger }) => {
        const x = strXs[diagPos];
        const cy = fretLineYs[slot] + fretSpacing / 2;
        return (
          <g key={diagPos}>
            <circle cx={x} cy={cy} r={dotR} fill={fg} fillOpacity={0.88} />
            <text x={x} y={cy} textAnchor="middle" dominantBaseline="central"
              fontSize={7} fontWeight="bold" fontFamily="Arial, sans-serif"
              fill={baseFret > 1 ? '#222' : '#fff'}>{finger}</text>
          </g>
        );
      })}
      {/* String open/mute indicators */}
      {diagOrder.map((strIdx, diagPos) => {
        const fret = frets[strIdx];
        const x = strXs[diagPos];
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

type NoteResizeState = {
  tIndex: number;
  noteId: string;
  noteStart: number;
  originalDuration: number;
  currentEndBeat: number;
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
  playheadBeat,
  isPlaying = false,
  onSeek,
  jumpToMeasure,
  pageView = false,
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
  playheadBeat?: number;
  isPlaying?: boolean;
  onSeek?: (beat: number) => void;
  jumpToMeasure?: { measure: number; id: number };
  pageView?: boolean;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(900);
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const [noteDrag, setNoteDrag] = useState<NoteDragState | null>(null);
  const [noteResize, setNoteResize] = useState<NoteResizeState | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubBeat, setScrubBeat] = useState<number | null>(null);
  const scrubRowRef = useRef<number>(0);

  useEffect(() => {
    if (!outerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    ro.observe(outerRef.current);
    return () => ro.disconnect();
  }, []);

  const effectiveWidth = pageView ? PAGE_INNER_WIDTH : containerWidth;
  const layout = useMemo(() => calcLayout(song, effectiveWidth, showGuitarTab), [song, effectiveWidth, showGuitarTab]);
  const { measuresPerRow, totalMeasures, numRows, beatsPerMeasure, notesWidthPerMeasure, svgHeight, svgWidth, effectiveTrackHeight, rowHeight, trackYOffsets } = layout;

  const rowsPerPage = (pageView && rowHeight > 0)
    ? Math.max(1, Math.floor((PAGE_FULL_HEIGHT - PAGE_MARGIN_TOP - PAGE_MARGIN_BOTTOM) / rowHeight))
    : 0;
  const numPages = rowsPerPage > 0 ? Math.ceil(numRows / rowsPerPage) : 0;
  const interPageGap = PAGE_MARGIN_TOP + PAGE_MARGIN_BOTTOM + GRID_TOP_OFFSET + PAGE_BETWEEN_GAP;
  const pgGap = (r: number) => rowBaseY(r, rowHeight, rowsPerPage, pageView ? interPageGap : 0) - r * rowHeight;
  const adjustedSvgHeight = svgHeight + (pageView && numPages > 1 ? (numPages - 1) * interPageGap : 0);

  useEffect(() => {
    if (!containerRef.current) return;
    renderNotation(containerRef.current, song, 'dark', effectiveWidth, showGuitarTab, rowsPerPage, pageView ? interPageGap : 0);
  }, [song, effectiveWidth, showGuitarTab, rowsPerPage, pageView, interPageGap]);

  const clientXToBeat = useCallback((clientX: number, rowIdx: number): number => {
    const container = outerRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const layoutX = clientX - rect.left + container.scrollLeft;
    for (let cIdx = 0; cIdx < measuresPerRow; cIdx++) {
      const segStart = P8 + getMeasureNoteStartX(cIdx, notesWidthPerMeasure);
      const segEnd = segStart + notesWidthPerMeasure;
      if (layoutX <= segEnd || cIdx === measuresPerRow - 1) {
        const beatInMeasure = Math.max(0, Math.min(beatsPerMeasure, (layoutX - segStart) / PIXELS_PER_BEAT));
        const mIdx = rowIdx * measuresPerRow + cIdx;
        return Math.max(0, Math.min(totalMeasures * beatsPerMeasure, mIdx * beatsPerMeasure + beatInMeasure));
      }
    }
    return 0;
  }, [measuresPerRow, notesWidthPerMeasure, beatsPerMeasure, totalMeasures]);

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

  const commitNoteResize = useCallback((resize: NoteResizeState) => {
    const minDur = 1 / GRID_SUBDIVISIONS;
    const rawDur = resize.currentEndBeat - resize.noteStart;
    const snapped = Math.max(minDur, Math.round(rawDur * GRID_SUBDIVISIONS) / GRID_SUBDIVISIONS);
    if (Math.abs(snapped - resize.originalDuration) < 0.001) return;
    onUpdateSong(prev => ({
      ...prev,
      tracks: prev.tracks.map(t => ({
        ...t,
        notes: t.notes.map(n => n.id === resize.noteId ? { ...n, duration: snapped } : n)
      }))
    }));
  }, [onUpdateSong]);

  const handleGlobalMouseUp = useCallback(() => {
    if (isScrubbing) {
      if (scrubBeat !== null) onSeek?.(scrubBeat);
      setIsScrubbing(false);
      setScrubBeat(null);
      return;
    }
    if (noteResize) {
      commitNoteResize(noteResize);
      setNoteResize(null);
      return;
    }
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
  }, [isScrubbing, scrubBeat, onSeek, dragBox, noteDrag, noteResize, commitDragBox, commitNoteDrag, commitNoteResize, handleGridClick]);

  useEffect(() => {
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleGlobalMouseUp]);

  useEffect(() => {
    if (!isScrubbing) return;
    const handleMouseMove = (e: MouseEvent) => {
      setScrubBeat(clientXToBeat(e.clientX, scrubRowRef.current));
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [isScrubbing, clientXToBeat]);

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

  // Playhead auto-scroll: only fires when the active row changes, not every RAF frame
  const prevPlayheadRowRef = useRef(-1);
  const playheadRow = (playheadBeat !== undefined && playheadBeat >= 0 && measuresPerRow > 0)
    ? Math.floor(Math.floor(playheadBeat / beatsPerMeasure) / measuresPerRow)
    : -1;

  useEffect(() => {
    if (playheadRow < 0 || !outerRef.current) {
      prevPlayheadRowRef.current = -1;
      return;
    }
    if (playheadRow === prevPlayheadRowRef.current) return;
    prevPlayheadRowRef.current = playheadRow;
    const rowY = P8 + playheadRow * rowHeight + pgGap(playheadRow) + STAVE_Y_FIRST;
    outerRef.current.scrollTo({ top: Math.max(0, rowY - 60), behavior: 'smooth' });
  }, [playheadRow, rowHeight, rowsPerPage, pageView]);

  useEffect(() => {
    if (!jumpToMeasure || !outerRef.current) return;
    const mIdx = jumpToMeasure.measure - 1;
    const rowIdx = measuresPerRow > 0 ? Math.floor(mIdx / measuresPerRow) : 0;
    const y = P8 + rowIdx * rowHeight + pgGap(rowIdx) + STAVE_Y_FIRST;
    outerRef.current.scrollTo({ top: Math.max(0, y - 60), behavior: 'smooth' });
  }, [jumpToMeasure, measuresPerRow, rowHeight, rowsPerPage, pageView]);

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
    <div ref={outerRef} className={cn("relative w-full h-full overflow-auto p-8 group", pageView ? "bg-[#111115]" : "bg-[#050506]")}>
      <div style={{ minHeight: adjustedSvgHeight + 64, minWidth: pageView ? PAGE_FULL_WIDTH : svgWidth }}>

        {/* Page card backgrounds (page view only) */}
        {pageView && Array.from({ length: numPages }, (_, pageIdx) => {
          const startRow = pageIdx * rowsPerPage;
          const endRow = Math.min((pageIdx + 1) * rowsPerPage, numRows);
          const rowsInPage = endRow - startRow;
          const rawTop = P8 + rowBaseY(startRow, rowHeight, rowsPerPage, interPageGap) + STAVE_Y_FIRST - GRID_TOP_OFFSET - PAGE_MARGIN_TOP;
          const clampedTop = Math.max(0, rawTop);
          const pageHeight = rowsInPage * rowHeight + GRID_TOP_OFFSET + PAGE_MARGIN_TOP + PAGE_MARGIN_BOTTOM;
          const clampedHeight = pageHeight - (clampedTop - rawTop);
          return (
            <div
              key={`page-${pageIdx}`}
              className="absolute"
              style={{
                left: 0,
                top: clampedTop,
                width: PAGE_FULL_WIDTH,
                height: clampedHeight,
                background: '#0C0C0F',
                border: '1px solid #1E1E24',
                boxShadow: '0 2px 16px rgba(0,0,0,0.55)',
                zIndex: 0,
                pointerEvents: 'none',
              }}
            >
              <span style={{ position: 'absolute', bottom: 10, right: 14, fontSize: 9, color: '#2E2E36', fontFamily: 'monospace', userSelect: 'none' }}>
                {pageIdx + 1}
              </span>
            </div>
          );
        })}

        {/* VexFlow SVG */}
        <div ref={containerRef} className="absolute top-8 left-8 z-[1] pointer-events-none" />

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
            const top = P8 + rowIdx * rowHeight + pgGap(rowIdx) + STAVE_Y_FIRST - GRID_TOP_OFFSET;
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
          const y = P8 + rowIdx * rowHeight + pgGap(rowIdx) + STAVE_Y_FIRST - 14;
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

        {/* Playhead line */}
        {playheadBeat !== undefined && playheadBeat >= 0 && (() => {
          const displayBeat = scrubBeat ?? playheadBeat;
          const mIdx = Math.floor(displayBeat / beatsPerMeasure);
          if (mIdx >= totalMeasures) return null;
          const cIdx = mIdx % measuresPerRow;
          const beatInMeasure = displayBeat - mIdx * beatsPerMeasure;
          const x = P8 + getMeasureNoteStartX(cIdx, notesWidthPerMeasure) + beatInMeasure * PIXELS_PER_BEAT;
          const rowIdx = Math.floor(mIdx / measuresPerRow);
          const top = P8 + rowIdx * rowHeight + pgGap(rowIdx) + STAVE_Y_FIRST - GRID_TOP_OFFSET;
          const canScrub = !isPlaying && !!onSeek;
          return (
            <div
              className={cn("absolute z-30", canScrub ? "cursor-ew-resize" : "pointer-events-none")}
              style={{
                left: x - (canScrub ? 4 : 0),
                top,
                width: canScrub ? 10 : 2,
                height: rowHeight,
                background: isScrubbing ? 'rgba(212,175,55,1)' : 'rgba(212,175,55,0.75)',
                borderRadius: canScrub ? 5 : 1,
              }}
              onMouseDown={canScrub ? e => {
                e.preventDefault();
                scrubRowRef.current = rowIdx;
                setIsScrubbing(true);
                setScrubBeat(displayBeat);
              } : undefined}
            />
          );
        })()}

        {/* Per-track, per-measure grid sections */}
        {song.tracks.map((track, tIndex) =>
          Array.from({ length: numRows }, (_, rowIdx) =>
            Array.from(
              { length: Math.min(measuresPerRow, totalMeasures - rowIdx * measuresPerRow) },
              (_, colIdx) => {
                const mIndex = rowIdx * measuresPerRow + colIdx;
                const mStart = mIndex * beatsPerMeasure;

                const sectionLeft = P8 + getMeasureNoteStartX(colIdx, notesWidthPerMeasure);
                const sectionTop = P8 + rowIdx * rowHeight + pgGap(rowIdx) + trackYOffsets[tIndex] + STAVE_Y_FIRST - GRID_TOP_OFFSET;

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

                          const nextBeat = beat + 1 / GRID_SUBDIVISIONS;
                          const isNoteEnd = isActive && !activeIsRest && !track.notes.some(n =>
                            n.pitch === pitch && nextBeat >= n.start && nextBeat < n.start + n.duration - 0.01
                          );
                          const resizeNote = isNoteEnd ? spanNotes[0] : null;
                          const isResizing = noteResize?.noteId === resizeNote?.id;

                          return (
                            <div
                              key={cIdx}
                              className={cn(
                                "relative border-r border-b border-[#D4AF37]/5 cursor-pointer transition-colors",
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
                                isResizing ? "bg-[#D4AF37]/70" : "",
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
                                if (noteResize && noteResize.tIndex === tIndex) {
                                  setNoteResize(prev => prev ? { ...prev, currentEndBeat: nextBeat } : null);
                                } else if (noteDrag && noteDrag.tIndex === tIndex) {
                                  setNoteDrag(prev => prev ? { ...prev, endBeat: beat, endRIndex: rIdx } : null);
                                } else if (dragBox && dragBox.tIndex === tIndex) {
                                  setDragBox(prev => prev ? { ...prev, endBeat: beat, endRIndex: rIdx } : null);
                                }
                              }}
                            >
                              {isNoteEnd && resizeNote && !chordMode && (
                                <div
                                  className="absolute right-0 top-0 bottom-0 w-[4px] cursor-col-resize z-20 bg-transparent hover:bg-[#D4AF37]/60"
                                  onMouseDown={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setNoteResize({
                                      tIndex,
                                      noteId: resizeNote.id,
                                      noteStart: resizeNote.start,
                                      originalDuration: resizeNote.duration,
                                      currentEndBeat: nextBeat,
                                    });
                                    setSelectedNoteIds(new Set([resizeNote.id]));
                                  }}
                                />
                              )}
                            </div>
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
