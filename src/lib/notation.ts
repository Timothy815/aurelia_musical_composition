import { VexFlow, RendererBackends } from 'vexflow';
import { SongData, NoteData } from '../types';

// Shared layout constants — also imported by Notation.tsx for grid overlay alignment
export const PIXELS_PER_BEAT = 60;
export const FIRST_MEASURE_EXTRA = 90; // px reserved for clef + key sig + time sig (col=0)
export const BARLINE_PADDING = 10;     // px between left barline and first note in col>0 staves
export const TRACK_HEIGHT = 150;
export const STAVE_Y_FIRST = 40;
export const GRID_TOP_OFFSET = 25; // grid overlay starts this many px above stave Y
export const GRID_SUBDIVISIONS = 4;
export const CELL_WIDTH = PIXELS_PER_BEAT / GRID_SUBDIVISIONS; // 15
export const CELL_HEIGHT = 10;

export interface NotationLayout {
  measuresPerRow: number;
  totalMeasures: number;
  numRows: number;
  beatsPerMeasure: number;
  notesWidthPerMeasure: number;
  svgWidth: number;
  svgHeight: number;
}

export function calcLayout(song: SongData, availableWidth: number): NotationLayout {
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
  const svgHeight = numRows * song.tracks.length * TRACK_HEIGHT + STAVE_Y_FIRST + 20;

  return { measuresPerRow, totalMeasures, numRows, beatsPerMeasure, notesWidthPerMeasure, svgWidth, svgHeight };
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
      tc.preFormat().setX(noteStartX + beatInMeasure * PIXELS_PER_BEAT);
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
  availableWidth?: number
) {
  container.innerHTML = '';
  const VF = VexFlow;
  const fg = theme === 'light' ? '#000000' : '#F2F2F2';

  const width = availableWidth ?? Math.max(300, (container.parentElement?.clientWidth ?? 900) - 64);
  const layout = calcLayout(song, width);
  const { measuresPerRow, totalMeasures, notesWidthPerMeasure } = layout;

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
      const staveY = rowIdx * song.tracks.length * TRACK_HEIGHT + tIndex * TRACK_HEIGHT + STAVE_Y_FIRST;

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
    }
  });
}

// Canvas-based render for export (same logic, scaled)
export function renderNotationToCanvas(
  canvas: HTMLCanvasElement,
  song: SongData,
  scale: number,
  pageWidth: number
) {
  const VF = VexFlow;
  const layout = calcLayout(song, pageWidth);
  const { measuresPerRow, totalMeasures, notesWidthPerMeasure, beatsPerMeasure } = layout;

  canvas.width = layout.svgWidth * scale;
  canvas.height = layout.svgHeight * scale;

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
      const colIdx = mIndex % measuresPerRow;

      const staveX = getMeasureStaveX(colIdx, notesWidthPerMeasure) * scale;
      const staveWidth = (colIdx === 0
        ? FIRST_MEASURE_EXTRA + notesWidthPerMeasure
        : BARLINE_PADDING + notesWidthPerMeasure) * scale;
      const staveY = (rowIdx * song.tracks.length * TRACK_HEIGHT + tIndex * TRACK_HEIGHT + STAVE_Y_FIRST) * scale;

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
        tc.preFormat().setX(noteStartX + beatInMeasure * PIXELS_PER_BEAT * scale);
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

  return layout;
}
