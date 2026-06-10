import MidiWriter from 'midi-writer-js';
import { VexFlow, RendererBackends } from 'vexflow';
import { SongData, NoteData } from '../types';

export function exportToMidi(song: SongData) {
  const tracks = song.tracks.map(t => {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 1 }));
    track.addTrackName(t.name);
    track.setTempo(song.tempo);

    const notesByStart: Record<number, { pitch: string; duration: number }[]> = {};
    t.notes.forEach(note => {
      if (!notesByStart[note.start]) notesByStart[note.start] = [];
      notesByStart[note.start].push(note);
    });

    let currentTick = 0;
    const times = Object.keys(notesByStart).map(Number).sort((a, b) => a - b);
    times.forEach(time => {
      const notes = notesByStart[time];
      const waitBeats = time - currentTick;
      const waitTicks = waitBeats > 0 ? waitBeats * 128 : 0;
      const midiPitches = notes.map(n => n.pitch);
      const durationNum = notes[0].duration;
      track.addEvent(new MidiWriter.NoteEvent({
        pitch: midiPitches,
        duration: `T${Math.round(durationNum * 128)}`,
        wait: waitTicks > 0 ? `T${waitTicks}` : 0
      }));
      currentTick = time;
    });

    return track;
  });

  const write = new MidiWriter.Writer(tracks);
  const a = document.createElement('a');
  a.href = write.dataUri();
  a.download = 'composition.mid';
  a.click();
}

export function exportToPdf(song: SongData) {
  // Render to a canvas in the MAIN window where the Bravura music font is
  // already loaded. Copying the SVG to a new window loses the font, causing
  // boxes. Canvas rasterizes glyphs using whatever fonts the window has loaded.
  const SCALE = 2; // retina-quality output

  let maxBeats = 16;
  song.tracks.forEach(track => {
    track.notes.forEach(note => {
      if (note.start + note.duration > maxBeats) maxBeats = note.start + note.duration;
    });
  });

  const logW = Math.max(900, maxBeats * 40 + 120);
  const logH = song.tracks.length * 150 + 80;

  const canvas = document.createElement('canvas');
  canvas.width = logW * SCALE;
  canvas.height = logH * SCALE;
  canvas.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(canvas);

  // White background
  const ctx2d = canvas.getContext('2d')!;
  ctx2d.fillStyle = '#ffffff';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);

  // VexFlow Canvas renderer — coordinates are in canvas pixels (already scaled)
  const VF = VexFlow;
  const renderer = new VF.Renderer(canvas, RendererBackends.CANVAS);
  renderer.resize(canvas.width, canvas.height);
  const context = renderer.getContext();
  context.setFont('Arial', 10 * SCALE);
  context.setFillStyle('#000000');
  context.setStrokeStyle('#000000');

  const pixelsPerBeat = 60 * SCALE;

  song.tracks.forEach((track, tIndex) => {
    const stave = new VF.Stave(
      10 * SCALE,
      (40 + tIndex * 150) * SCALE,
      (logW - 20) * SCALE
    );
    stave.addClef('treble');
    stave.addTimeSignature(`${song.timeSignature[0]}/${song.timeSignature[1]}`);
    stave.setContext(context).draw();

    const notesByBeat: Record<string, NoteData[]> = {};
    track.notes.forEach(note => {
      const key = note.start.toString();
      if (!notesByBeat[key]) notesByBeat[key] = [];
      notesByBeat[key].push(note);
    });

    const renderingNotes: { startBeat: number; staveNote: any }[] = [];

    Object.entries(notesByBeat).forEach(([beatStr, chordNotes]) => {
      const beat = parseFloat(beatStr);
      const isRest = chordNotes.length === 1 && chordNotes[0].isRest;

      const keys = chordNotes.map(n => {
        if (n.isRest) return 'b/4';
        const pitchClass = n.pitch.slice(0, -1).toLowerCase();
        const octave = n.pitch.slice(-1);
        return `${pitchClass}/${octave}`;
      });

      const dur = chordNotes[0].duration;
      let vfDuration =
        dur === 0.25 ? '16' :
        dur === 0.5  ? '8'  :
        dur === 0.75 ? '8d' :
        dur === 1    ? 'q'  :
        dur === 1.5  ? 'qd' :
        dur === 2    ? 'h'  :
        dur === 3    ? 'hd' :
        dur === 4    ? 'w'  : 'q';
      if (isRest) vfDuration += 'r';

      const staveNote = new VF.StaveNote({ keys, duration: vfDuration });

      if (!isRest) {
        keys.forEach((key, i) => {
          if (key.includes('#')) {
            staveNote.addModifier(new VF.Accidental('#'), i);
          } else if (key.match(/^[a-g]b\//)) {
            staveNote.addModifier(new VF.Accidental('b'), i);
          }
        });
      }

      if (dur === 1.5 || dur === 0.75 || dur === 3) {
        staveNote.addModifier(new VF.Dot(), 0);
      }

      staveNote.setStyle({ fillStyle: '#000000', strokeStyle: '#000000' });
      renderingNotes.push({ startBeat: beat, staveNote });
    });

    const startX = stave.getNoteStartX();
    renderingNotes.forEach(rn => {
      const tickContext = new VF.TickContext();
      tickContext.addTickable(rn.staveNote);
      tickContext.preFormat().setX(startX + rn.startBeat * pixelsPerBeat);
      rn.staveNote.setStave(stave);
      rn.staveNote.setContext(context).draw();
    });
  });

  const dataUrl = canvas.toDataURL('image/png');
  document.body.removeChild(canvas);

  const printWindow = window.open('', '_blank', 'width=1050,height=780');
  if (!printWindow) return;

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Aurelia Composer — Score</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #e0e0e0; font-family: serif; }
    .no-print {
      background: #222;
      color: white;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: sans-serif;
      font-size: 13px;
    }
    .no-print button {
      padding: 8px 20px;
      font-size: 13px;
      cursor: pointer;
      border: none;
      border-radius: 4px;
      font-family: sans-serif;
    }
    .btn-print { background: #D4AF37; color: #000; font-weight: bold; }
    .btn-close { background: #555; color: #fff; }
    .page {
      width: 279mm;
      min-height: 216mm;
      margin: 16px auto;
      padding: 15mm 15mm 15mm 15mm;
      background: white;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    h1 { font-size: 20pt; text-align: center; margin-bottom: 2px; }
    .meta { font-size: 10pt; text-align: center; color: #444; margin-bottom: 12px; font-family: sans-serif; }
    img { width: 100%; height: auto; display: block; }
    @media print {
      body { background: white; }
      .no-print { display: none; }
      .page {
        margin: 0;
        padding: 12mm;
        width: 100%;
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn-print" onclick="window.print()">&#128438; Print / Save as PDF</button>
    <button class="btn-close" onclick="window.close()">Close</button>
    <span style="margin-left:8px;color:#aaa;">Tip: in the print dialog choose "Save as PDF" and set Paper to Letter, Landscape</span>
  </div>
  <div class="page">
    <h1>Aurelia Composer</h1>
    <p class="meta">Tempo: ${song.tempo} BPM &nbsp;&nbsp;|&nbsp;&nbsp; ${song.timeSignature[0]}/${song.timeSignature[1]} time</p>
    <img src="${dataUrl}" alt="Score" />
  </div>
</body>
</html>`);

  printWindow.document.close();
  printWindow.focus();
}
