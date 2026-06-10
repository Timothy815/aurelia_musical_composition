import MidiWriter from 'midi-writer-js';
import { SongData } from '../types';
import { renderNotation } from './notation';

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
  const dataUri = write.dataUri();
  const a = document.createElement('a');
  a.href = dataUri;
  a.download = 'composition.mid';
  a.click();
}

export function exportToPdf(song: SongData) {
  // Render black-on-white notation into a hidden container
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;background:white;';
  document.body.appendChild(container);

  renderNotation(container, song, 'light');

  const svg = container.querySelector('svg');
  if (!svg) {
    document.body.removeChild(container);
    return;
  }

  // Inline all computed styles so the print window is self-contained
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.style.background = 'white';
  const svgHtml = svg.outerHTML;
  document.body.removeChild(container);

  const svgWidth = svg.getAttribute('width') || '800';
  const svgHeight = svg.getAttribute('height') || '400';

  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) return;

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Aurelia Composer — Score</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: white; font-family: serif; }
    .page {
      width: 279mm;
      min-height: 216mm;
      padding: 15mm 15mm 15mm 15mm;
      background: white;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    h1 { font-size: 18pt; text-align: center; margin-bottom: 4px; }
    .meta { font-size: 10pt; text-align: center; color: #333; margin-bottom: 12px; }
    svg { width: 100%; height: auto; display: block; }
    .no-print { text-align: center; padding: 16px; }
    button {
      padding: 10px 24px; font-size: 14px; cursor: pointer;
      background: #222; color: white; border: none; border-radius: 4px;
      margin: 0 6px;
    }
    @media print {
      .no-print { display: none; }
      body { margin: 0; }
      .page { padding: 12mm; width: 100%; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()">Print / Save as PDF</button>
    <button onclick="window.close()">Close</button>
  </div>
  <div class="page">
    <h1>Aurelia Composer</h1>
    <p class="meta">Tempo: ${song.tempo} BPM &nbsp;|&nbsp; Time: ${song.timeSignature[0]}/${song.timeSignature[1]}</p>
    ${svgHtml}
  </div>
</body>
</html>`);

  printWindow.document.close();
  printWindow.focus();
}
