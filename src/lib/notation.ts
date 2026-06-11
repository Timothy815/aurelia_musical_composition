import { VexFlow, RendererBackends } from 'vexflow';
import { SongData, NoteData } from '../types';
import { Chord } from '@tonaljs/tonal';

// Shared layout constants — also imported by Notation.tsx for grid overlay alignment
export const PIXELS_PER_BEAT = 60;
export const FIRST_MEASURE_EXTRA = 110; // px reserved for clef + key sig + time sig (col=0)
export const BARLINE_PADDING = 10;     // px between left barline and first note in col>0 staves
// VexFlow adds stave.getNoteStartX() + this value to tc.getX() when rendering notes
const VEXFLOW_NOTE_OFFSET = 12; // Metrics.get('Stave.padding') = 12
export const TRACK_HEIGHT = 290;
export const STAVE_Y_FIRST = 40;
export const GRID_TOP_OFFSET = 25; // grid overlay starts this many px above stave Y
export const GRID_SUBDIVISIONS = 4;
export const CELL_WIDTH = PIXELS_PER_BEAT / GRID_SUBDIVISIONS; // 15
export const CELL_HEIGHT = 10;
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
}

export function calcLayout(song: SongData, availableWidth: number, showGuitarTab = false, trackHeightOverride?: number): NotationLayout {
  const beatsPerMeasure = song.timeSignature[0];
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
  const svgHeight = numRows * song.tracks.length * effectiveTrackHeight + STAVE_Y_FIRST + 20;

  return { measuresPerRow, totalMeasures, numRows, beatsPerMeasure, notesWidthPerMeasure, svgWidth, svgHeight, effectiveTrackHeight };
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

function buildStaveNote(VF: any, chordNotes: NoteData[], fg: string): any {
  const isRest = chordNotes.length === 1 && !!chordNotes[0].isRest;
  const dur = chordNotes[0].duration;

  const keys = chordNotes.map(n => {
    if (n.isRest) return 'b/4';
    return `${n.pitch.slice(0, -1).toLowerCase()}/${n.pitch.slice(-1)}`;
  });

  let vfDur = durToVF(dur);
  if (isRest) vfDur += 'r';

  const sn = new VF.StaveNote({ keys, duration: vfDur });

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

function renderTrackMeasure(
  VF: any,
  context: any,
  track: { notes: NoteData[] },
  song: SongData,
  mIndex: number,
  layout: NotationLayout,
  stave: any,
  fg: string
) {
  const { beatsPerMeasure, notesWidthPerMeasure, measuresPerRow } = layout;
  const colIdx = mIndex % measuresPerRow;
  const mStart = mIndex * beatsPerMeasure;
  const mEnd = (mIndex + 1) * beatsPerMeasure;

  const notesInMeasure = track.notes.filter(n =>
    n.start >= mStart - 0.001 && n.start < mEnd - 0.001
  );

  const byBeat = new Map<number, NoteData[]>();
  notesInMeasure.forEach(n => {
    const k = Math.round(n.start * 100) / 100;
    if (!byBeat.has(k)) byBeat.set(k, []);
    byBeat.get(k)!.push(n);
  });

  const hasMultiVoice = track.notes.some(n => n.voice === 2);
  const noteStartX = getMeasureNoteStartX(colIdx, notesWidthPerMeasure);

  const v1Beamable: any[] = [];
  const v2Beamable: any[] = [];

  [...byBeat.entries()].sort(([a], [b]) => a - b).forEach(([beat, chord]) => {
    const beatInMeasure = beat - mStart;
    const v1 = chord.filter(n => (n.voice ?? 1) === 1);
    const v2 = chord.filter(n => n.voice === 2);

    const renderGroup = (notes: NoteData[], stemDir: number | null) => {
      if (notes.length === 0) return null;
      const sn = buildStaveNote(VF, notes, fg);
      if (stemDir !== null) {
        try { sn.setStemDirection(stemDir); } catch (_) {}
      }
      const tc = new VF.TickContext();
      tc.addTickable(sn);
      // VexFlow adds stave.getNoteStartX() + VEXFLOW_NOTE_OFFSET to tc.getX() when rendering,
      // so subtract that to land at our desired absolute position.
      const desiredX = noteStartX + beatInMeasure * PIXELS_PER_BEAT;
      tc.preFormat().setX(desiredX - stave.getNoteStartX() - VEXFLOW_NOTE_OFFSET);
      sn.setStave(stave);
      sn.setContext(context).draw();
      return sn;
    };

    const sn1 = renderGroup(v1, hasMultiVoice ? 1 : null);
    const sn2 = renderGroup(v2, -1);

    if (sn1 && !v1[0]?.isRest && v1[0]?.duration <= 0.5) v1Beamable.push(sn1);
    if (sn2 && !v2[0]?.isRest && v2[0]?.duration <= 0.5) v2Beamable.push(sn2);
  });

  for (const group of [v1Beamable, v2Beamable]) {
    if (group.length >= 2) {
      try {
        const beams = VF.Beam.generateBeams(group);
        beams.forEach((b: any) => b.setContext(context).draw());
      } catch (_) {}
    }
  }
}

export function renderNotation(
  container: HTMLElement,
  song: SongData,
  theme: 'dark' | 'light' = 'dark',
  availableWidth?: number,
  showGuitarTab = false
) {
  container.innerHTML = '';
  const VF = VexFlow;
  const fg = theme === 'light' ? '#000000' : '#F2F2F2';

  const width = availableWidth ?? Math.max(300, (container.parentElement?.clientWidth ?? 900) - 64);
  const layout = calcLayout(song, width, showGuitarTab);
  const { measuresPerRow, totalMeasures, notesWidthPerMeasure, effectiveTrackHeight, beatsPerMeasure } = layout;

  const renderer = new VF.Renderer(container as HTMLDivElement, RendererBackends.SVG);
  renderer.resize(layout.svgWidth, layout.svgHeight);

  const context = renderer.getContext();
  context.setFont('Arial', 10);
  context.setFillStyle(fg);
  context.setStrokeStyle(fg);

  if (theme === 'light') {
    const svg = container.querySelector('svg');
    if (svg) svg.style.background = '#ffffff';
  }

  song.tracks.forEach((track, tIndex) => {
    for (let mIndex = 0; mIndex < totalMeasures; mIndex++) {
      const rowIdx = Math.floor(mIndex / measuresPerRow);
      const colIdx = mIndex % measuresPerRow;

      const staveX = getMeasureStaveX(colIdx, notesWidthPerMeasure);
      const staveWidth = colIdx === 0
        ? FIRST_MEASURE_EXTRA + notesWidthPerMeasure
        : BARLINE_PADDING + notesWidthPerMeasure;
      const staveY = rowIdx * song.tracks.length * effectiveTrackHeight + tIndex * effectiveTrackHeight + STAVE_Y_FIRST;

      const stave = new VF.Stave(staveX, staveY, staveWidth);

      if (colIdx === 0) {
        stave.addClef('treble');
        const ks = song.keySignature;
        if (ks && ks !== 'C') stave.addKeySignature(ks);
        if (mIndex === 0) {
          stave.addTimeSignature(`${song.timeSignature[0]}/${song.timeSignature[1]}`);
        }
      }

      stave.setContext(context).draw();

      renderTrackMeasure(VF, context, track, song, mIndex, layout, stave, fg);

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
      const staveY = rowIdx * song.tracks.length * effectiveTrackHeight + tIndex * effectiveTrackHeight + STAVE_Y_FIRST;
      context.setFont('Times New Roman', 11, 'italic');
      context.setFillStyle(fg);
      try { (context as any).fillText(dyn, noteX, staveY + 58); } catch (_) {}
    });
  });
  context.setFont('Arial', 10);
  context.setFillStyle(fg);
  context.setStrokeStyle(fg);
}

// ── Canvas chord diagram drawing ─────────────────────────────────────────────
const DIAG_W = 66;
const DIAG_H = 88;
const DIAG_FRET_ROWS = 4;

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

  // Diagram left-to-right: low E (index 5) → high e (index 0)
  const diagOrder = [5, 4, 3, 2, 1, 0];

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

  // String indicators and finger dots
  diagOrder.forEach((strIdx, diagPos) => {
    const fret = frets[strIdx];
    const sx = strXs[diagPos];
    const slot = fret != null && fret > 0 ? fret - baseFret : null;
    const inRange = slot !== null && slot >= 0 && slot < DIAG_FRET_ROWS;

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

    if (inRange) {
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(sx, fretLineYs[slot!] + fretSpacing / 2, fretSpacing * 0.34, 0, Math.PI * 2);
      ctx.fill();
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
  const { measuresPerRow, totalMeasures, numRows, notesWidthPerMeasure, beatsPerMeasure, effectiveTrackHeight } = layout;

  const endRow = rowsPerPage !== undefined ? Math.min(startRow + rowsPerPage, numRows) : numRows;
  const rowsOnPage = endRow - startRow;

  canvas.width = layout.svgWidth * scale;
  canvas.height = (STAVE_Y_FIRST + rowsOnPage * song.tracks.length * effectiveTrackHeight + 20) * scale;

  const ctx2d = canvas.getContext('2d')!;
  ctx2d.fillStyle = '#ffffff';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  const renderer = new VF.Renderer(canvas, RendererBackends.CANVAS);
  renderer.resize(canvas.width, canvas.height);
  const context = renderer.getContext();
  context.setFont('Arial', 10 * scale);
  context.setFillStyle('#000000');
  context.setStrokeStyle('#000000');

  song.tracks.forEach((track, tIndex) => {
    for (let mIndex = 0; mIndex < totalMeasures; mIndex++) {
      const rowIdx = Math.floor(mIndex / measuresPerRow);
      if (rowIdx < startRow || rowIdx >= endRow) continue;
      const adjustedRowIdx = rowIdx - startRow;
      const colIdx = mIndex % measuresPerRow;

      const staveX = getMeasureStaveX(colIdx, notesWidthPerMeasure) * scale;
      const staveWidth = (colIdx === 0
        ? FIRST_MEASURE_EXTRA + notesWidthPerMeasure
        : BARLINE_PADDING + notesWidthPerMeasure) * scale;
      const staveY = (adjustedRowIdx * song.tracks.length * effectiveTrackHeight + tIndex * effectiveTrackHeight + STAVE_Y_FIRST) * scale;

      const stave = new VF.Stave(staveX, staveY, staveWidth);

      if (colIdx === 0) {
        stave.addClef('treble');
        const ks = song.keySignature;
        if (ks && ks !== 'C') stave.addKeySignature(ks);
        if (mIndex === 0) {
          stave.addTimeSignature(`${song.timeSignature[0]}/${song.timeSignature[1]}`);
        }
      }

      stave.setContext(context).draw();

      if (tIndex === 0) {
        ctx2d.save();
        ctx2d.font = `${8 * scale}px Arial, sans-serif`;
        ctx2d.fillStyle = '#777777';
        ctx2d.textAlign = 'left';
        ctx2d.textBaseline = 'alphabetic';
        ctx2d.fillText(String(mIndex + 1), staveX + 2 * scale, staveY - 4 * scale);
        ctx2d.restore();
      }

      // Inline note rendering at scale
      const mStart = mIndex * beatsPerMeasure;
      const mEnd = (mIndex + 1) * beatsPerMeasure;
      const notesInMeasure = track.notes.filter(n =>
        n.start >= mStart - 0.001 && n.start < mEnd - 0.001
      );

      const byBeat = new Map<number, NoteData[]>();
      notesInMeasure.forEach(n => {
        const k = Math.round(n.start * 100) / 100;
        if (!byBeat.has(k)) byBeat.set(k, []);
        byBeat.get(k)!.push(n);
      });

      const noteStartX = getMeasureNoteStartX(colIdx, notesWidthPerMeasure) * scale;
      const beamable: any[] = [];

      [...byBeat.entries()].sort(([a], [b]) => a - b).forEach(([beat, chord]) => {
        const beatInMeasure = beat - mStart;
        const sn = buildStaveNote(VF, chord, '#000000');
        const tc = new VF.TickContext();
        tc.addTickable(sn);
        const desiredX = noteStartX + beatInMeasure * PIXELS_PER_BEAT * scale;
        tc.preFormat().setX(desiredX - stave.getNoteStartX() - VEXFLOW_NOTE_OFFSET);
        sn.setStave(stave);
        sn.setContext(context).draw();
        if (!chord[0]?.isRest && chord[0]?.duration <= 0.5) beamable.push(sn);
      });

      if (beamable.length >= 2) {
        try {
          const beams = VF.Beam.generateBeams(beamable);
          beams.forEach((b: any) => b.setContext(context).draw());
        } catch (_) {}
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
      const staveY = adjustedRowIdx * song.tracks.length * effectiveTrackHeight + tIndex * effectiveTrackHeight + STAVE_Y_FIRST;
      ctx2d.save();
      ctx2d.font = `italic ${10 * scale}px Times New Roman, serif`;
      ctx2d.fillStyle = '#000000';
      ctx2d.textAlign = 'left';
      ctx2d.textBaseline = 'top';
      ctx2d.fillText(dyn, noteX * scale, (staveY + 58) * scale);
      ctx2d.restore();
    });
  });

  return layout;
}
