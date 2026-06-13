import { VexFlow, RendererBackends } from 'vexflow';
import { SongData, NoteData } from '../types';
import { Chord } from '@tonaljs/tonal';

// Shared layout constants — also imported by Notation.tsx for grid overlay alignment
export const PIXELS_PER_BEAT = 60;
export const FIRST_MEASURE_EXTRA = 110; // px reserved for clef + key sig + time sig (col=0)
export const BARLINE_PADDING = 10;     // px between left barline and first note in col>0 staves
// VexFlow adds stave.getNoteStartX() + this value to tc.getX() when rendering notes
const VEXFLOW_NOTE_OFFSET = 12; // Metrics.get('Stave.padding') = 12
export const TRACK_HEIGHT = 290;       // compact height used for PDF / page-view print
export const SCREEN_TRACK_HEIGHT = 360; // editing height — fits the 330px interactive grid with clearance
export const STAVE_Y_FIRST = 40;
export const GRID_TOP_OFFSET = 25; // grid overlay starts this many px above stave Y
export const GRID_SUBDIVISIONS = 4;
export const CELL_WIDTH = PIXELS_PER_BEAT / GRID_SUBDIVISIONS; // 15
export const CELL_HEIGHT = 10;

// Page view constants (letter-size at 96 dpi)
export const PAGE_MARGIN_X = 32;    // horizontal margin each side; equals P8 so pages start at x=0
export const PAGE_INNER_WIDTH = 752; // content width passed to calcLayout (816 − 2×32)
export const PAGE_FULL_WIDTH = PAGE_INNER_WIDTH + PAGE_MARGIN_X * 2; // 816 ≈ letter width
export const PAGE_FULL_HEIGHT = Math.round(PAGE_FULL_WIDTH * 11 / 8.5); // 1056 = letter height
export const PAGE_MARGIN_TOP = 40;
export const PAGE_MARGIN_BOTTOM = 48;
export const PAGE_BETWEEN_GAP = 24; // visual gap between page cards
export const CHORD_SECTION_HEADER_H = 28;
export const CHORD_DIAG_COL_W = 80;  // px per diagram column including gap
export const CHORD_DIAG_ROW_H = 116; // px per diagram row: label (14) + diagram (88) + gap (14)

// ── Guitar chord diagram helpers ─────────────────────────────────────────────
// String indices: 0 = high e (E4=64), 1 = B3, 2 = G3, 3 = D3, 4 = A2, 5 = low E (E2=40)
const GUITAR_OPEN_MIDI = [64, 59, 55, 50, 45, 40];

export interface ChordDiagramResult {
  frets: Array<number | null>; // index 0=high e … 5=low E; null=muted, 0=open, 1+=fret
  baseFret: number;            // fret number shown at top of diagram
}

export interface ChordForTab {
  pitches: string[];
  label: string;
  pcKey: string;
  diagram: ChordDiagramResult;
}

function noteToMidi(pitch: string): number {
  const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const FLAT  = ['C','Db','D','Eb', 'E','F','Gb','G','Ab','A','Bb', 'B'];
  const m = pitch.match(/^([A-G][#b]?)(\d+)$/);
  if (!m) return -1;
  let pc = SHARP.indexOf(m[1]);
  if (pc === -1) pc = FLAT.indexOf(m[1]);
  return pc < 0 ? -1 : pc + (parseInt(m[2]) + 1) * 12;
}

// Find the best string/fret assignment for a set of pitches using backtracking.
// Tries every 4-fret window, maximises note coverage, then minimises fret position.
export function pitchesToChordDiagram(pitches: string[]): ChordDiagramResult {
  const empty: ChordDiagramResult = { frets: Array(6).fill(null) as Array<number|null>, baseFret: 1 };
  const midiNotes = [...new Set(pitches.map(noteToMidi).filter(m => m >= 0))].sort((a, b) => a - b);
  if (midiNotes.length === 0) return empty;

  // All playable (string, fret) options for each note, across the whole neck
  const allOpts: Array<Array<{s: number; f: number}>> = midiNotes.map(midi => {
    const opts: Array<{s: number; f: number}> = [];
    for (let s = 0; s < 6; s++) {
      const f = midi - GUITAR_OPEN_MIDI[s];
      if (f >= 0 && f <= 22) opts.push({ s, f });
    }
    return opts;
  });

  let best = { coverage: 0, score: Infinity, frets: empty.frets, baseFret: 1 };

  for (let win = 0; win <= 14; win++) {
    const lo = win === 0 ? 1 : win;
    const hi = win + 4;

    const winOpts = allOpts.map(opts =>
      opts.filter(o => o.f === 0 || (o.f >= lo && o.f <= hi))
    );

    let localBest: Array<{s: number; f: number}> | null = null;
    let localCov = 0;
    let localScore = Infinity;

    const bt = (i: number, used: Set<number>, cur: Array<{s: number; f: number}>) => {
      if (i === midiNotes.length) {
        const nzF = cur.filter(p => p.f > 0).map(p => p.f);
        const span = nzF.length > 1 ? Math.max(...nzF) - Math.min(...nzF) : 0;
        if (span > 4) return;
        const minF = nzF.length > 0 ? Math.min(...nzF) : 0;
        const score = minF * 10 + span;
        if (cur.length > localCov || (cur.length === localCov && score < localScore)) {
          localCov = cur.length; localScore = score; localBest = [...cur];
        }
        return;
      }
      // skip this note
      bt(i + 1, used, cur);
      // place this note
      for (const o of winOpts[i]) {
        if (!used.has(o.s)) {
          used.add(o.s); cur.push(o);
          bt(i + 1, used, cur);
          cur.pop(); used.delete(o.s);
        }
      }
    };
    bt(0, new Set(), []);

    if (localBest) {
      const nzF = (localBest as Array<{s:number;f:number}>).filter(p => p.f > 0).map(p => p.f);
      const minFret = nzF.length > 0 ? Math.min(...nzF) : 0;
      const overall = -localCov * 1000 + localScore + win * 2;
      if (localCov > best.coverage || (localCov === best.coverage && overall < best.score)) {
        const frets: Array<number|null> = Array(6).fill(null);
        for (const p of localBest as Array<{s:number;f:number}>) frets[p.s] = p.f;
        best = { coverage: localCov, score: overall, frets, baseFret: minFret <= 2 ? 1 : minFret };
      }
    }
  }

  return { frets: best.frets, baseFret: best.baseFret };
}

export interface NotationLayout {
  measuresPerRow: number;
  totalMeasures: number;
  numRows: number;
  beatsPerMeasure: number;
  notesWidthPerMeasure: number;
  svgWidth: number;
  svgHeight: number;
  effectiveTrackHeight: number;
  rowHeight: number;       // total px per row (grand staff tracks count double)
  trackYOffsets: number[]; // cumulative Y offset of each track within a row
}

export function calcLayout(song: SongData, availableWidth: number, showGuitarTab = false, trackHeightOverride?: number): NotationLayout {
  const beatsPerMeasure = song.timeSignature[0] * (4 / song.timeSignature[1]);
  const notesWidthPerMeasure = beatsPerMeasure * PIXELS_PER_BEAT;
  const firstMeasureWidth = FIRST_MEASURE_EXTRA + notesWidthPerMeasure;
  const laterMeasureWidth = BARLINE_PADDING + notesWidthPerMeasure;

  let maxBeats = beatsPerMeasure * 4;
  song.tracks.forEach(t => t.notes.forEach(n => {
    const end = n.start + n.duration;
    if (end > maxBeats) maxBeats = end;
  }));

  const totalMeasures = Math.ceil(maxBeats / beatsPerMeasure);
  const minWidth = 20 + firstMeasureWidth;
  const usableWidth = Math.max(availableWidth, minWidth);
  const measuresPerRow = Math.max(1, 1 + Math.floor((usableWidth - 20 - firstMeasureWidth) / laterMeasureWidth));
  const numRows = Math.ceil(totalMeasures / measuresPerRow);

  const svgWidth = 10 + firstMeasureWidth + Math.max(0, measuresPerRow - 1) * laterMeasureWidth + 10;
  const effectiveTrackHeight = trackHeightOverride ?? TRACK_HEIGHT;

  const trackYOffsets: number[] = [];
  let cumTrackY = 0;
  song.tracks.forEach(t => {
    trackYOffsets.push(cumTrackY);
    cumTrackY += t.grandStaff ? 2 * effectiveTrackHeight : effectiveTrackHeight;
  });
  const rowHeight = cumTrackY || effectiveTrackHeight;
  const svgHeight = numRows * rowHeight + STAVE_Y_FIRST + 20;

  return { measuresPerRow, totalMeasures, numRows, beatsPerMeasure, notesWidthPerMeasure, svgWidth, svgHeight, effectiveTrackHeight, rowHeight, trackYOffsets };
}

// staveX in SVG coords for a given column index within a row
export function getMeasureStaveX(colIdx: number, notesWidthPerMeasure: number): number {
  if (colIdx === 0) return 10;
  // col 0 has width FIRST_MEASURE_EXTRA+notesWidthPerMeasure; subsequent cols have width BARLINE_PADDING+notesWidthPerMeasure
  return 10 + (FIRST_MEASURE_EXTRA + notesWidthPerMeasure) + (colIdx - 1) * (BARLINE_PADDING + notesWidthPerMeasure);
}

// X where notes begin for a given column index (shared between SVG render and grid overlay)
export function getMeasureNoteStartX(colIdx: number, notesWidthPerMeasure: number): number {
  return getMeasureStaveX(colIdx, notesWidthPerMeasure) + (colIdx === 0 ? FIRST_MEASURE_EXTRA : BARLINE_PADDING);
}

function durToVF(beats: number): string {
  if (beats >= 4) return 'w';
  if (beats >= 3) return 'hd';
  if (beats >= 2) return 'h';
  if (beats >= 1.5) return 'qd';
  if (beats >= 1) return 'q';
  if (beats >= 0.75) return '8d';
  if (beats >= 0.5) return '8';
  return '16';
}

function buildStaveNote(VF: any, chordNotes: NoteData[], fg: string, clef = 'treble'): any {
  const isRest = chordNotes.length === 1 && !!chordNotes[0].isRest;
  const dur = chordNotes[0].duration;

  const keys = chordNotes.map(n => {
    if (n.isRest) return clef === 'bass' ? 'd/3' : 'b/4';
    return `${n.pitch.slice(0, -1).toLowerCase()}/${n.pitch.slice(-1)}`;
  });

  let vfDur = durToVF(dur);
  if (isRest) vfDur += 'r';

  const sn = new VF.StaveNote({ keys, duration: vfDur, clef });

  if (!isRest) {
    keys.forEach((key: string, i: number) => {
      if (key.includes('#')) sn.addModifier(new VF.Accidental('#'), i);
      else if (key.match(/^[a-g]b\//)) sn.addModifier(new VF.Accidental('b'), i);
    });
  }

  if (dur === 1.5 || dur === 0.75 || dur === 3) sn.addModifier(new VF.Dot(), 0);

  if (!isRest) {
    const articulation = chordNotes[0]?.articulation;
    if (articulation) {
      try {
        const code = articulation === 'staccato' ? 'a.' : articulation === 'accent' ? 'a>' : 'a-';
        sn.addModifier(new VF.Articulation(code).setPosition(3), 0);
      } catch (_) {}
    }
  }

  sn.setStyle({ fillStyle: fg, strokeStyle: fg });
  return sn;
}

// ── Note pre-processing for fidelity rendering ───────────────────────────────

interface RenderSeg {
  notes: NoteData[];
  start: number;
  duration: number;
  chainId: string;
  tieFromPrev: boolean;
  tieToNext: boolean;
}

const STD_DURS = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25];

function splitToStandardDurations(beats: number): number[] {
  const result: number[] = [];
  let rem = Math.round(beats * 1000) / 1000;
  while (rem > 0.001) {
    const d = STD_DURS.find(s => s <= rem + 0.001);
    if (d == null) break;
    result.push(d);
    rem = Math.round((rem - d) * 1000) / 1000;
  }
  return result.length > 0 ? result : [0.25];
}

function buildTrackSegments(notes: NoteData[], beatsPerMeasure: number): Map<number, RenderSeg[]> {
  const byMeasure = new Map<number, RenderSeg[]>();
  const addSeg = (mIdx: number, seg: RenderSeg) => {
    if (!byMeasure.has(mIdx)) byMeasure.set(mIdx, []);
    byMeasure.get(mIdx)!.push(seg);
  };

  // Group simultaneous notes into chords
  const chords = new Map<number, NoteData[]>();
  notes.forEach(n => {
    const k = Math.round(n.start * 1000) / 1000;
    if (!chords.has(k)) chords.set(k, []);
    chords.get(k)!.push(n);
  });

  chords.forEach((chord, beatKey) => {
    const totalDur = chord[0].duration;
    const chainId = chord.map(n => n.id).join('|');
    let remaining = totalDur;
    let pos = beatKey;
    let prevSegExists = false;

    while (remaining > 0.001) {
      const mIdx = Math.floor(pos / beatsPerMeasure);
      const mEnd = (mIdx + 1) * beatsPerMeasure;
      const availInMeasure = Math.min(mEnd - pos, remaining);
      const stdDurs = splitToStandardDurations(availInMeasure);
      const crossesMeasure = remaining > availInMeasure + 0.001;

      for (let i = 0; i < stdDurs.length; i++) {
        const dur = stdDurs[i];
        addSeg(mIdx, {
          notes: chord,
          start: Math.round(pos * 1000) / 1000,
          duration: dur,
          chainId,
          tieFromPrev: prevSegExists || i > 0,
          tieToNext: i < stdDurs.length - 1 || crossesMeasure,
        });
        pos = Math.round((pos + dur) * 1000) / 1000;
        prevSegExists = true;
      }
      remaining = Math.round((remaining - availInMeasure) * 1000) / 1000;
    }
  });

  // Second pass: wire explicit user-placed ties (note.tied === true)
  const allSegs: RenderSeg[] = [];
  byMeasure.forEach(segs => allSegs.push(...segs));

  const tiedNotes = [...notes].filter(n => n.tied && !n.isRest).sort((a, b) => a.start - b.start);
  tiedNotes.forEach(noteB => {
    const bStart = Math.round(noteB.start * 1000) / 1000;
    const noteA = notes.find(n =>
      !n.isRest &&
      n.pitch === noteB.pitch &&
      Math.abs(Math.round((n.start + n.duration) * 1000) / 1000 - bStart) < 0.005
    );
    if (!noteA) return;

    const aSegs = allSegs
      .filter(s => s.chainId.split('|').includes(noteA.id))
      .sort((a, b) => a.start - b.start);
    const bSegs = allSegs
      .filter(s => s.chainId.split('|').includes(noteB.id))
      .sort((a, b) => a.start - b.start);
    if (!aSegs.length || !bSegs.length) return;

    const lastASeg = aSegs[aSegs.length - 1];
    const firstBSeg = bSegs[0];
    lastASeg.tieToNext = true;
    firstBSeg.tieFromPrev = true;

    // Give B's segments the same chainId as A's last segment so tieState connects them
    const aChainId = lastASeg.chainId;
    bSegs.forEach(s => { s.chainId = aChainId; });
  });

  return byMeasure;
}

// tieState maps `chainId|vKey` → the StaveNote awaiting a tie to the next segment
function renderTrackMeasure(
  VF: any,
  context: any,
  segments: RenderSeg[],
  beatsPerMeasure: number,
  mIndex: number,
  layout: NotationLayout,
  stave: any,
  fg: string,
  clef: string,
  tieState: Map<string, any>
) {
  const { notesWidthPerMeasure, measuresPerRow } = layout;
  const colIdx = mIndex % measuresPerRow;
  const mStart = mIndex * beatsPerMeasure;
  const noteStartX = getMeasureNoteStartX(colIdx, notesWidthPerMeasure);
  const halfMeasure = beatsPerMeasure / 2;
  const hasMultiVoice = segments.some(s => s.notes.some(n => n.voice === 2));
  const beamGroups = new Map<string, any[]>(); // `vKey|halfGroup` → StaveNotes

  [...segments].sort((a, b) => a.start - b.start).forEach(seg => {
    const beatInMeasure = seg.start - mStart;
    const desiredX = noteStartX + beatInMeasure * PIXELS_PER_BEAT;
    const isRest = seg.notes[0]?.isRest ?? false;
    const v1Notes = hasMultiVoice ? seg.notes.filter(n => (n.voice ?? 1) === 1) : seg.notes;
    const v2Notes = hasMultiVoice ? seg.notes.filter(n => n.voice === 2) : [];

    const renderVoice = (voiceNotes: NoteData[], stemDir: number | null, vKey: string) => {
      if (voiceNotes.length === 0) return null;
      const overridden = voiceNotes.map(n => ({ ...n, duration: seg.duration }));
      const sn = buildStaveNote(VF, overridden, fg, clef);
      if (stemDir !== null) { try { sn.setStemDirection(stemDir); } catch (_) {} }
      const tc = new VF.TickContext();
      tc.addTickable(sn);
      // VexFlow adds stave.getNoteStartX() + VEXFLOW_NOTE_OFFSET to tc.getX() when rendering
      tc.preFormat().setX(desiredX - stave.getNoteStartX() - VEXFLOW_NOTE_OFFSET);
      sn.setStave(stave);
      sn.setContext(context).draw();

      const tieKey = `${seg.chainId}|${vKey}`;
      if (seg.tieFromPrev && !isRest && tieState.has(tieKey)) {
        try {
          const prev = tieState.get(tieKey)!;
          const idxs = Array.from({ length: overridden.length }, (_, i) => i);
          new VF.StaveTie({ firstNote: prev, lastNote: sn, firstIndexes: idxs, lastIndexes: idxs })
            .setContext(context).draw();
        } catch (_) {}
        tieState.delete(tieKey);
      }
      if (seg.tieToNext && !isRest) tieState.set(tieKey, sn);

      return sn;
    };

    const sn1 = renderVoice(v1Notes, hasMultiVoice ? 1 : null, 'v1');
    const sn2 = renderVoice(v2Notes, -1, 'v2');

    const collectBeam = (sn: any, vKey: string) => {
      if (sn && !isRest && seg.duration <= 0.5) {
        const g = `${vKey}|${Math.floor(beatInMeasure / halfMeasure)}`;
        if (!beamGroups.has(g)) beamGroups.set(g, []);
        beamGroups.get(g)!.push(sn);
      }
    };
    collectBeam(sn1, 'v1');
    collectBeam(sn2, 'v2');
  });

  beamGroups.forEach(group => {
    if (group.length >= 2) {
      try {
        const beams = VF.Beam.generateBeams(group);
        beams.forEach((b: any) => b.setContext(context).draw());
      } catch (_) {}
    }
  });
}

// Returns the base Y offset for a row, accounting for inter-page gaps in page view.
export function rowBaseY(rowIdx: number, rowHeight: number, rowsPerPage: number, interPageGap: number): number {
  if (rowsPerPage <= 0 || interPageGap <= 0) return rowIdx * rowHeight;
  return rowIdx * rowHeight + Math.floor(rowIdx / rowsPerPage) * interPageGap;
}

export function renderNotation(
  container: HTMLElement,
  song: SongData,
  theme: 'dark' | 'light' = 'dark',
  availableWidth?: number,
  showGuitarTab = false,
  rowsPerPage = 0,
  interPageGap = 0,
  trackHeightOverride?: number,
) {
  container.innerHTML = '';
  const VF = VexFlow;
  const fg = theme === 'light' ? '#000000' : '#F2F2F2';

  const width = availableWidth ?? Math.max(300, (container.parentElement?.clientWidth ?? 900) - 64);
  const layout = calcLayout(song, width, showGuitarTab, trackHeightOverride);
  const { measuresPerRow, totalMeasures, notesWidthPerMeasure, effectiveTrackHeight, beatsPerMeasure, rowHeight, trackYOffsets, numRows } = layout;

  const numPages = rowsPerPage > 0 ? Math.ceil(numRows / rowsPerPage) : 1;
  const adjustedSvgHeight = layout.svgHeight + (numPages - 1) * interPageGap;
  const rby = (r: number) => rowBaseY(r, rowHeight, rowsPerPage, interPageGap);

  const renderer = new VF.Renderer(container as HTMLDivElement, RendererBackends.SVG);
  renderer.resize(layout.svgWidth, adjustedSvgHeight);

  const context = renderer.getContext();
  context.setFont('Arial', 10);
  context.setFillStyle(fg);
  context.setStrokeStyle(fg);

  if (theme === 'light') {
    const svg = container.querySelector('svg');
    if (svg) svg.style.background = '#ffffff';
  }

  song.tracks.forEach((track, tIndex) => {
    const trebleNotes = track.grandStaff
      ? track.notes.filter(n => n.isRest || noteToMidi(n.pitch) >= 60)
      : track.notes;
    const bassNotes = track.grandStaff
      ? track.notes.filter(n => !n.isRest && noteToMidi(n.pitch) < 60)
      : [];
    const trebleSegs = buildTrackSegments(trebleNotes, beatsPerMeasure);
    const bassSegs   = buildTrackSegments(bassNotes, beatsPerMeasure);
    const trebleTies = new Map<string, any>();
    const bassTies   = new Map<string, any>();

    for (let mIndex = 0; mIndex < totalMeasures; mIndex++) {
      const rowIdx = Math.floor(mIndex / measuresPerRow);
      const colIdx = mIndex % measuresPerRow;

      const staveX = getMeasureStaveX(colIdx, notesWidthPerMeasure);
      const staveWidth = colIdx === 0
        ? FIRST_MEASURE_EXTRA + notesWidthPerMeasure
        : BARLINE_PADDING + notesWidthPerMeasure;
      const staveY = rby(rowIdx) + trackYOffsets[tIndex] + STAVE_Y_FIRST;

      const stave = new VF.Stave(staveX, staveY, staveWidth);

      if (colIdx === 0) {
        stave.addClef('treble');
        const ks = song.keySignature;
        if (ks && ks !== 'C') stave.addKeySignature(ks);
        if (mIndex === 0) {
          stave.addTimeSignature(`${song.timeSignature[0]}/${song.timeSignature[1]}`);
        }
      }

      // Repeat barlines
      const hasRepStart = song.repeats?.some(r => r.type === 'start' && r.measure - 1 === mIndex);
      const hasRepEnd   = song.repeats?.some(r => r.type === 'end'   && r.measure - 1 === mIndex);
      if (hasRepStart) { try { stave.setBegBarType((VF.Barline as any).type.REPEAT_BEGIN); } catch (_) {} }
      if (hasRepEnd)   { try { stave.setEndBarType((VF.Barline as any).type.REPEAT_END); } catch (_) {} }

      stave.setContext(context).draw();

      // Grand staff: add bass clef stave and brace connector
      let bassStave: any = null;
      if (track.grandStaff) {
        bassStave = new VF.Stave(staveX, staveY + effectiveTrackHeight, staveWidth);
        if (colIdx === 0) {
          bassStave.addClef('bass');
          const ks = song.keySignature;
          if (ks && ks !== 'C') bassStave.addKeySignature(ks);
        }
        if (hasRepStart) { try { bassStave.setBegBarType((VF.Barline as any).type.REPEAT_BEGIN); } catch (_) {} }
        if (hasRepEnd)   { try { bassStave.setEndBarType((VF.Barline as any).type.REPEAT_END); } catch (_) {} }
        bassStave.setContext(context).draw();
        if (colIdx === 0) {
          try { const b = new VF.StaveConnector(stave, bassStave); b.setType((VF.StaveConnector as any).type.BRACE); b.setContext(context).draw(); } catch (_) {}
        }
        try { const l = new VF.StaveConnector(stave, bassStave); l.setType((VF.StaveConnector as any).type.SINGLE_LEFT); l.setContext(context).draw(); } catch (_) {}
      }

      renderTrackMeasure(VF, context, trebleSegs.get(mIndex) ?? [], beatsPerMeasure, mIndex, layout, stave, fg, 'treble', trebleTies);
      if (track.grandStaff && bassStave) {
        renderTrackMeasure(VF, context, bassSegs.get(mIndex) ?? [], beatsPerMeasure, mIndex, layout, bassStave, fg, 'bass', bassTies);
      }

      if (tIndex === 0) {
        context.setFont('Arial', 8);
        context.setFillStyle('#777777');
        try { (context as any).fillText(String(mIndex + 1), staveX + 2, staveY - 4); } catch (_) {}
        context.setFont('Arial', 10);
        context.setFillStyle(fg);
        context.setStrokeStyle(fg);
      }
    }
  });

  // Dynamic markings (second pass — change-only per track, below stave)
  song.tracks.forEach((track, tIndex) => {
    const beatDynamics = new Map<number, string>();
    track.notes.forEach(n => {
      if (!n.isRest && n.dynamic) {
        const k = Math.round(n.start * 100) / 100;
        if (!beatDynamics.has(k)) beatDynamics.set(k, n.dynamic);
      }
    });
    const sorted = [...beatDynamics.entries()].sort(([a], [b]) => a - b);
    let lastDyn = '';
    sorted.forEach(([beatPos, dyn]) => {
      if (dyn === lastDyn) return;
      lastDyn = dyn;
      const mIdx = Math.floor(beatPos / beatsPerMeasure);
      const rowIdx = Math.floor(mIdx / measuresPerRow);
      const colIdx = mIdx % measuresPerRow;
      const beatInM = beatPos - mIdx * beatsPerMeasure;
      const noteX = getMeasureNoteStartX(colIdx, notesWidthPerMeasure) + beatInM * PIXELS_PER_BEAT;
      const staveY = rby(rowIdx) + trackYOffsets[tIndex] + STAVE_Y_FIRST;
      context.setFont('Times New Roman', 11, 'italic');
      context.setFillStyle(fg);
      try { (context as any).fillText(dyn, noteX, staveY + 58); } catch (_) {}
    });
  });
  // Tempo change labels above first track stave
  if (song.tempoChanges?.length) {
    song.tempoChanges.forEach(tc => {
      const mIdx = Math.floor(tc.beat / beatsPerMeasure);
      const beatInM = tc.beat - mIdx * beatsPerMeasure;
      const rowIdx = Math.floor(mIdx / measuresPerRow);
      const colIdx = mIdx % measuresPerRow;
      const x = getMeasureNoteStartX(colIdx, notesWidthPerMeasure) + beatInM * PIXELS_PER_BEAT;
      const y = rby(rowIdx) + STAVE_Y_FIRST - 10;
      context.setFont('Arial', 9, 'bold');
      context.setFillStyle('#999999');
      try { (context as any).fillText(`♩=${Math.round(tc.bpm)}`, x, y); } catch (_) {}
    });
  }
  context.setFont('Arial', 10);
  context.setFillStyle(fg);
  context.setStrokeStyle(fg);
}

// ── Chord diagram analysis (shared by SVG + canvas renderers) ────────────────
export const DIAG_W = 66;
export const DIAG_H = 88;
export const DIAG_FRET_ROWS = 4;
const DIAG_ORDER = [5, 4, 3, 2, 1, 0]; // diagPos → strIdx (low E first in diagram)

export interface ChordAnalysis {
  barre: { slot: number; startDiagPos: number; endDiagPos: number } | null;
  dotFingers: Array<{ diagPos: number; slot: number; finger: number }>;
}

export function analyzeChordDiagram(frets: Array<number | null>, baseFret: number): ChordAnalysis {
  const fretted: Array<{ diagPos: number; fret: number; slot: number }> = [];
  DIAG_ORDER.forEach((strIdx, diagPos) => {
    const f = frets[strIdx];
    if (f != null && f > 0) {
      const slot = f - baseFret;
      if (slot >= 0 && slot < DIAG_FRET_ROWS) fretted.push({ diagPos, fret: f, slot });
    }
  });

  if (fretted.length === 0) return { barre: null, dotFingers: [] };

  const minFret = Math.min(...fretted.map(n => n.fret));
  const barreNotes = fretted.filter(n => n.fret === minFret);
  const barre = barreNotes.length >= 2
    ? { slot: minFret - baseFret, startDiagPos: barreNotes[0].diagPos, endDiagPos: barreNotes[barreNotes.length - 1].diagPos }
    : null;

  const sorted = [...fretted].sort((a, b) => a.fret !== b.fret ? a.fret - b.fret : a.diagPos - b.diagPos);
  let fingerNum = 1;
  const fingerMap = new Map<number, number>();
  if (barre) {
    barreNotes.forEach(n => fingerMap.set(n.diagPos, 1));
    fingerNum = 2;
    sorted.filter(n => n.fret !== minFret).forEach(n => { fingerMap.set(n.diagPos, Math.min(4, fingerNum++)); });
  } else {
    sorted.forEach(n => { fingerMap.set(n.diagPos, Math.min(4, fingerNum++)); });
  }

  const dotFingers = fretted.map(n => ({ diagPos: n.diagPos, slot: n.slot, finger: fingerMap.get(n.diagPos) ?? 1 }));
  return { barre, dotFingers };
}

// ── Canvas chord diagram drawing ─────────────────────────────────────────────

function drawChordDiagramOnCanvas(
  ctx: CanvasRenderingContext2D,
  diagram: ChordDiagramResult,
  originX: number,  // top-left x, already scaled
  originY: number,  // top-left y, already scaled
  scale: number
) {
  const { frets, baseFret } = diagram;
  const lPad = (baseFret > 1 ? 15 : 5) * scale;
  const rPad = 4 * scale;
  const tPad = 20 * scale;
  const strW = DIAG_W * scale - lPad - rPad;
  const strSpacing = strW / 5;
  const strXs = Array.from({ length: 6 }, (_, i) => originX + lPad + i * strSpacing);
  const fretSpacing = (DIAG_H * scale - tPad - 6 * scale) / DIAG_FRET_ROWS;
  const fretLineYs = Array.from({ length: DIAG_FRET_ROWS + 1 }, (_, i) => originY + tPad + i * fretSpacing);

  ctx.save();

  // Fret lines
  fretLineYs.forEach((fy, i) => {
    ctx.beginPath();
    ctx.lineWidth = (i === 0 && baseFret === 1 ? 3 : 0.8) * scale;
    ctx.globalAlpha = i === 0 && baseFret === 1 ? 0.85 : 0.55;
    ctx.strokeStyle = '#000';
    ctx.moveTo(strXs[0], fy);
    ctx.lineTo(strXs[5], fy);
    ctx.stroke();
  });

  // String lines
  strXs.forEach(sx => {
    ctx.beginPath();
    ctx.lineWidth = 0.8 * scale;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#000';
    ctx.moveTo(sx, originY + tPad);
    ctx.lineTo(sx, fretLineYs[DIAG_FRET_ROWS]);
    ctx.stroke();
  });

  ctx.globalAlpha = 1;

  const { barre, dotFingers } = analyzeChordDiagram(frets, baseFret);
  const dotR = fretSpacing * 0.34;

  // Barre bar (rounded rectangle spanning barre strings)
  if (barre) {
    const x1 = strXs[barre.startDiagPos];
    const x2 = strXs[barre.endDiagPos];
    const cy = fretLineYs[barre.slot] + fretSpacing / 2;
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    const r = dotR;
    ctx.moveTo(x1 + r, cy - r);
    ctx.arcTo(x2 + r, cy - r, x2 + r, cy + r, r);
    ctx.arcTo(x2 + r, cy + r, x1 - r, cy + r, r);
    ctx.arcTo(x1 - r, cy + r, x1 - r, cy - r, r);
    ctx.arcTo(x1 - r, cy - r, x2 + r, cy - r, r);
    ctx.closePath();
    ctx.fill();
    // Finger number "1" centered in bar
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${7 * scale}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1', (x1 + x2) / 2, cy);
  }

  // Individual finger dots (non-barre notes)
  dotFingers.filter(d => !(barre && d.slot === barre.slot)).forEach(({ diagPos, slot, finger }) => {
    const sx = strXs[diagPos];
    const cy = fretLineYs[slot] + fretSpacing / 2;
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(sx, cy, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${7 * scale}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(finger), sx, cy);
  });

  // String open/mute indicators
  DIAG_ORDER.forEach((strIdx, diagPos) => {
    const fret = frets[strIdx];
    const sx = strXs[diagPos];
    ctx.font = `${10 * scale}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    if (fret === null) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#000';
      ctx.fillText('×', sx, originY + tPad - 5 * scale);
    } else if (fret === 0) {
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = scale;
      ctx.beginPath();
      ctx.arc(sx, originY + tPad - 7 * scale, 3 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  // Position label (e.g. "5fr")
  if (baseFret > 1) {
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#000';
    ctx.font = `${7.5 * scale}px Arial, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${baseFret}fr`, originX + lPad - 3 * scale, originY + tPad + fretSpacing * 0.65);
  }

  ctx.restore();
}

// Collect all unique chord formations across all tracks (deduplicated by pitch-class set).
export function collectUniqueChordsForTab(song: SongData): ChordForTab[] {
  const allByBeat = new Map<number, string[]>();
  song.tracks.forEach(track => {
    track.notes.forEach(n => {
      if (n.isRest) return;
      const k = Math.round(n.start * 100) / 100;
      if (!allByBeat.has(k)) allByBeat.set(k, []);
      allByBeat.get(k)!.push(n.pitch);
    });
  });

  const sortedBeats = [...allByBeat.entries()].sort(([a], [b]) => a - b);
  const seen = new Set<string>();
  const result: ChordForTab[] = [];
  let lastPCKey = '';

  sortedBeats.forEach(([, pitches]) => {
    const pcKey = [...new Set(pitches.map(p => p.replace(/\d+$/, '')))].sort().join(',');
    if (pcKey === lastPCKey) return;
    lastPCKey = pcKey;
    if (seen.has(pcKey)) return;
    seen.add(pcKey);

    const pcs = [...new Set(pitches.map(p => p.replace(/[0-9]/g, '')))];
    const detected = Chord.detect(pcs);
    const label = detected.length > 0 ? detected[0] : pcs.join('/');
    result.push({ pitches, label, pcKey, diagram: pitchesToChordDiagram(pitches) });
  });

  return result;
}

// Render a standalone chord dictionary page to a canvas (for PDF export).
// Returns true if any chords were drawn, false if the song has no chord content.
export function renderChordSectionToCanvas(
  canvas: HTMLCanvasElement,
  song: SongData,
  scale: number,
  pageWidth: number
): boolean {
  const chords = collectUniqueChordsForTab(song);
  if (chords.length === 0) return false;

  const margin = 20;
  const diagramsPerRow = Math.max(1, Math.floor((pageWidth - margin * 2) / CHORD_DIAG_COL_W));
  const numChordRows = Math.ceil(chords.length / diagramsPerRow);
  const totalH = CHORD_SECTION_HEADER_H + numChordRows * CHORD_DIAG_ROW_H + 20;

  canvas.width = pageWidth * scale;
  canvas.height = totalH * scale;

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.font = `bold ${11 * scale}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Guitar Chord Dictionary', margin * scale, 18 * scale);
  ctx.restore();

  chords.forEach((chord, i) => {
    const row = Math.floor(i / diagramsPerRow);
    const col = i % diagramsPerRow;
    const x = margin + col * CHORD_DIAG_COL_W;
    const y = CHORD_SECTION_HEADER_H + row * CHORD_DIAG_ROW_H;

    ctx.save();
    ctx.font = `${9 * scale}px Arial, sans-serif`;
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(chord.label, (x + DIAG_W / 2) * scale, (y + 11) * scale);
    ctx.restore();

    drawChordDiagramOnCanvas(ctx, chord.diagram, x * scale, (y + 14) * scale, scale);
  });

  return true;
}

// Canvas-based render for export (same logic, scaled).
// startRow / rowsPerPage enable pagination: only the rows in [startRow, startRow+rowsPerPage) are drawn.
export function renderNotationToCanvas(
  canvas: HTMLCanvasElement,
  song: SongData,
  scale: number,
  pageWidth: number,
  showGuitarTab = false,
  startRow = 0,
  rowsPerPage?: number,
  trackHeightOverride?: number
) {
  const VF = VexFlow;
  const layout = calcLayout(song, pageWidth, showGuitarTab, trackHeightOverride);
  const { measuresPerRow, totalMeasures, numRows, notesWidthPerMeasure, beatsPerMeasure, effectiveTrackHeight, rowHeight, trackYOffsets } = layout;

  const endRow = rowsPerPage !== undefined ? Math.min(startRow + rowsPerPage, numRows) : numRows;
  const rowsOnPage = endRow - startRow;

  canvas.width = layout.svgWidth * scale;
  canvas.height = (STAVE_Y_FIRST + rowsOnPage * rowHeight + 20) * scale;

  const ctx2d = canvas.getContext('2d')!;
  ctx2d.fillStyle = '#ffffff';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  // Title / composer — only on the first page (startRow === 0)
  if (startRow === 0) {
    const cx = canvas.width / 2;
    if (song.title) {
      ctx2d.save();
      ctx2d.font = `bold ${14 * scale}px Times New Roman, serif`;
      ctx2d.fillStyle = '#111111';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'alphabetic';
      ctx2d.fillText(song.title, cx, 18 * scale);
      ctx2d.restore();
    }
    if (song.composer) {
      ctx2d.save();
      ctx2d.font = `${10 * scale}px Times New Roman, serif`;
      ctx2d.fillStyle = '#444444';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'alphabetic';
      ctx2d.fillText(song.composer, cx, (song.title ? 30 : 20) * scale);
      ctx2d.restore();
    }
  }

  const renderer = new VF.Renderer(canvas, RendererBackends.CANVAS);
  renderer.resize(canvas.width, canvas.height);
  const context = renderer.getContext();
  context.setFont('Arial', 10 * scale);
  context.setFillStyle('#000000');
  context.setStrokeStyle('#000000');

  song.tracks.forEach((track, tIndex) => {
    const ctNotes = track.grandStaff
      ? track.notes.filter(n => n.isRest || noteToMidi(n.pitch) >= 60)
      : track.notes;
    const cbNotes = track.grandStaff
      ? track.notes.filter(n => !n.isRest && noteToMidi(n.pitch) < 60)
      : [];
    const ctSegs = buildTrackSegments(ctNotes, beatsPerMeasure);
    const cbSegs = buildTrackSegments(cbNotes, beatsPerMeasure);
    const ctTies = new Map<string, any>();
    const cbTies = new Map<string, any>();

    for (let mIndex = 0; mIndex < totalMeasures; mIndex++) {
      const rowIdx = Math.floor(mIndex / measuresPerRow);
      if (rowIdx < startRow || rowIdx >= endRow) continue;
      const adjustedRowIdx = rowIdx - startRow;
      const colIdx = mIndex % measuresPerRow;

      const staveX = getMeasureStaveX(colIdx, notesWidthPerMeasure) * scale;
      const staveWidth = (colIdx === 0
        ? FIRST_MEASURE_EXTRA + notesWidthPerMeasure
        : BARLINE_PADDING + notesWidthPerMeasure) * scale;
      const staveY = (adjustedRowIdx * rowHeight + trackYOffsets[tIndex] + STAVE_Y_FIRST) * scale;

      const stave = new VF.Stave(staveX, staveY, staveWidth);

      if (colIdx === 0) {
        stave.addClef('treble');
        const ks = song.keySignature;
        if (ks && ks !== 'C') stave.addKeySignature(ks);
        if (mIndex === 0) {
          stave.addTimeSignature(`${song.timeSignature[0]}/${song.timeSignature[1]}`);
        }
      }

      const hasRepStartC = song.repeats?.some(r => r.type === 'start' && r.measure - 1 === mIndex);
      const hasRepEndC   = song.repeats?.some(r => r.type === 'end'   && r.measure - 1 === mIndex);
      if (hasRepStartC) { try { stave.setBegBarType((VF.Barline as any).type.REPEAT_BEGIN); } catch (_) {} }
      if (hasRepEndC)   { try { stave.setEndBarType((VF.Barline as any).type.REPEAT_END); } catch (_) {} }

      stave.setContext(context).draw();

      // Grand staff: add bass clef stave
      let bassStave: any = null;
      if (track.grandStaff) {
        const bassStaveY = staveY + effectiveTrackHeight * scale;
        bassStave = new VF.Stave(staveX, bassStaveY, staveWidth);
        if (colIdx === 0) {
          bassStave.addClef('bass');
          const ks = song.keySignature;
          if (ks && ks !== 'C') bassStave.addKeySignature(ks);
        }
        if (hasRepStartC) { try { bassStave.setBegBarType((VF.Barline as any).type.REPEAT_BEGIN); } catch (_) {} }
        if (hasRepEndC)   { try { bassStave.setEndBarType((VF.Barline as any).type.REPEAT_END); } catch (_) {} }
        bassStave.setContext(context).draw();
        if (colIdx === 0) {
          try { const b = new VF.StaveConnector(stave, bassStave); b.setType((VF.StaveConnector as any).type.BRACE); b.setContext(context).draw(); } catch (_) {}
        }
        try { const l = new VF.StaveConnector(stave, bassStave); l.setType((VF.StaveConnector as any).type.SINGLE_LEFT); l.setContext(context).draw(); } catch (_) {}
      }

      if (tIndex === 0) {
        ctx2d.save();
        ctx2d.font = `${8 * scale}px Arial, sans-serif`;
        ctx2d.fillStyle = '#777777';
        ctx2d.textAlign = 'left';
        ctx2d.textBaseline = 'alphabetic';
        ctx2d.fillText(String(mIndex + 1), staveX + 2 * scale, staveY - 4 * scale);
        ctx2d.restore();
      }

      const mStart = mIndex * beatsPerMeasure;
      const noteStartX = getMeasureNoteStartX(colIdx, notesWidthPerMeasure) * scale;
      const halfMeasure = beatsPerMeasure / 2;

      const renderMeasureOnCanvas = (segs: RenderSeg[], targetStave: any, noteClef: string, tieState: Map<string, any>) => {
        const beamGroups = new Map<string, any[]>();
        [...segs].sort((a, b) => a.start - b.start).forEach(seg => {
          const beatInMeasure = seg.start - mStart;
          const isRest = seg.notes[0]?.isRest ?? false;
          const overridden = seg.notes.map(n => ({ ...n, duration: seg.duration }));
          const sn = buildStaveNote(VF, overridden, '#000000', noteClef);
          const tc = new VF.TickContext();
          tc.addTickable(sn);
          const desiredX = noteStartX + beatInMeasure * PIXELS_PER_BEAT * scale;
          tc.preFormat().setX(desiredX - targetStave.getNoteStartX() - VEXFLOW_NOTE_OFFSET);
          sn.setStave(targetStave);
          sn.setContext(context).draw();

          const tieKey = `${seg.chainId}|v1`;
          if (seg.tieFromPrev && !isRest && tieState.has(tieKey)) {
            try {
              const prev = tieState.get(tieKey)!;
              const idxs = Array.from({ length: overridden.length }, (_, i) => i);
              new VF.StaveTie({ firstNote: prev, lastNote: sn, firstIndexes: idxs, lastIndexes: idxs })
                .setContext(context).draw();
            } catch (_) {}
            tieState.delete(tieKey);
          }
          if (seg.tieToNext && !isRest) tieState.set(tieKey, sn);

          if (!isRest && seg.duration <= 0.5) {
            const g = `${Math.floor(beatInMeasure / halfMeasure)}`;
            if (!beamGroups.has(g)) beamGroups.set(g, []);
            beamGroups.get(g)!.push(sn);
          }
        });
        beamGroups.forEach(group => {
          if (group.length >= 2) {
            try {
              const beams = VF.Beam.generateBeams(group);
              beams.forEach((b: any) => b.setContext(context).draw());
            } catch (_) {}
          }
        });
      };

      renderMeasureOnCanvas(ctSegs.get(mIndex) ?? [], stave, 'treble', ctTies);
      if (track.grandStaff && bassStave) {
        renderMeasureOnCanvas(cbSegs.get(mIndex) ?? [], bassStave, 'bass', cbTies);
      }
    }
  });

  // Dynamic markings (change-only per track, below stave)
  song.tracks.forEach((track, tIndex) => {
    const beatDynamics = new Map<number, string>();
    track.notes.forEach(n => {
      if (!n.isRest && n.dynamic) {
        const k = Math.round(n.start * 100) / 100;
        if (!beatDynamics.has(k)) beatDynamics.set(k, n.dynamic);
      }
    });
    const sorted = [...beatDynamics.entries()].sort(([a], [b]) => a - b);
    let lastDyn = '';
    sorted.forEach(([beatPos, dyn]) => {
      if (dyn === lastDyn) return;
      lastDyn = dyn;
      const mIdx = Math.floor(beatPos / beatsPerMeasure);
      const rowIdx = Math.floor(mIdx / measuresPerRow);
      if (rowIdx < startRow || rowIdx >= endRow) return;
      const adjustedRowIdx = rowIdx - startRow;
      const colIdx = mIdx % measuresPerRow;
      const beatInM = beatPos - mIdx * beatsPerMeasure;
      const noteX = getMeasureNoteStartX(colIdx, notesWidthPerMeasure) + beatInM * PIXELS_PER_BEAT;
      const staveY = adjustedRowIdx * rowHeight + trackYOffsets[tIndex] + STAVE_Y_FIRST;
      ctx2d.save();
      ctx2d.font = `italic ${10 * scale}px Times New Roman, serif`;
      ctx2d.fillStyle = '#000000';
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'top';
      ctx2d.fillText(dyn, noteX * scale, (staveY + 58) * scale);
      ctx2d.restore();
    });
  });

  // Lyrics below each track's stave
  song.tracks.forEach((track, tIndex) => {
    const seen = new Set<number>();
    track.notes.forEach(note => {
      if (note.isRest || !note.lyric || seen.has(note.start)) return;
      seen.add(note.start);
      const mIdx = Math.floor(note.start / beatsPerMeasure);
      const rowIdx = Math.floor(mIdx / measuresPerRow);
      if (rowIdx < startRow || rowIdx >= endRow) return;
      const adjustedRowIdx = rowIdx - startRow;
      const colIdx = mIdx % measuresPerRow;
      const beatInM = note.start - mIdx * beatsPerMeasure;
      const noteX = getMeasureNoteStartX(colIdx, notesWidthPerMeasure) + beatInM * PIXELS_PER_BEAT;
      const staveY = adjustedRowIdx * rowHeight + trackYOffsets[tIndex] + STAVE_Y_FIRST;
      ctx2d.save();
      ctx2d.font = `italic ${10 * scale}px Times New Roman, serif`;
      ctx2d.fillStyle = '#333333';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'top';
      ctx2d.fillText(note.lyric, noteX * scale, (staveY + 85) * scale);
      ctx2d.restore();
    });
  });

  // Tempo change labels
  if (song.tempoChanges?.length) {
    song.tempoChanges.forEach(tc => {
      const mIdx = Math.floor(tc.beat / beatsPerMeasure);
      const rowIdx = Math.floor(mIdx / measuresPerRow);
      if (rowIdx < startRow || rowIdx >= endRow) return;
      const adjustedRowIdx = rowIdx - startRow;
      const colIdx = mIdx % measuresPerRow;
      const beatInM = tc.beat - mIdx * beatsPerMeasure;
      const x = getMeasureNoteStartX(colIdx, notesWidthPerMeasure) + beatInM * PIXELS_PER_BEAT;
      const y = adjustedRowIdx * rowHeight + STAVE_Y_FIRST - 10;
      ctx2d.save();
      ctx2d.font = `bold ${9 * scale}px Arial, sans-serif`;
      ctx2d.fillStyle = '#777777';
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'alphabetic';
      ctx2d.fillText(`♩=${Math.round(tc.bpm)}`, x * scale, y * scale);
      ctx2d.restore();
    });
  }

  // Hairpin markings
  if (song.hairpins?.length) {
    const beatToXRow = (beat: number) => {
      const mIdx = Math.floor(beat / beatsPerMeasure);
      const colIdx = mIdx % measuresPerRow;
      const beatInM = beat - mIdx * beatsPerMeasure;
      return {
        x: getMeasureNoteStartX(colIdx, notesWidthPerMeasure) + beatInM * PIXELS_PER_BEAT,
        rowIdx: Math.floor(mIdx / measuresPerRow),
      };
    };
    song.hairpins.forEach(hairpin => {
      const { rowIdx: r1 } = beatToXRow(hairpin.startBeat);
      const { rowIdx: r2 } = beatToXRow(hairpin.endBeat);
      const rows = Array.from({ length: r2 - r1 + 1 }, (_, i) => r1 + i);
      rows.forEach(rowIdx => {
        if (rowIdx < startRow || rowIdx >= endRow) return;
        const adjRowIdx = rowIdx - startRow;
        const rowStartBeat = rowIdx * measuresPerRow * beatsPerMeasure;
        const rowEndBeat = rowStartBeat + measuresPerRow * beatsPerMeasure;
        const clampedStart = Math.max(hairpin.startBeat, rowStartBeat);
        const clampedEnd = Math.min(hairpin.endBeat, rowEndBeat);
        if (clampedStart >= clampedEnd) return;
        const { x: sx } = beatToXRow(clampedStart);
        const { x: ex } = beatToXRow(clampedEnd);
        const baseY = adjRowIdx * rowHeight + STAVE_Y_FIRST + 62;
        const halfH = 5;
        ctx2d.save();
        ctx2d.strokeStyle = '#888888';
        ctx2d.lineWidth = 1 * scale;
        ctx2d.globalAlpha = 0.8;
        ctx2d.beginPath();
        if (hairpin.type === 'cresc') {
          ctx2d.moveTo(sx * scale, baseY * scale);
          ctx2d.lineTo(ex * scale, (baseY - halfH) * scale);
          ctx2d.moveTo(sx * scale, baseY * scale);
          ctx2d.lineTo(ex * scale, (baseY + halfH) * scale);
        } else {
          ctx2d.moveTo(sx * scale, (baseY - halfH) * scale);
          ctx2d.lineTo(ex * scale, baseY * scale);
          ctx2d.moveTo(sx * scale, (baseY + halfH) * scale);
          ctx2d.lineTo(ex * scale, baseY * scale);
        }
        ctx2d.stroke();
        ctx2d.restore();
      });
    });
  }

  return layout;
}
