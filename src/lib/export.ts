import MidiWriter from 'midi-writer-js';
import { SongData } from '../types';
import { renderNotationToCanvas } from './notation';

export function saveFile(song: SongData) {
  const json = JSON.stringify(song, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'composition.aurelia';
  a.click();
  URL.revokeObjectURL(url);
}

export function loadFile(): Promise<SongData> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.aurelia,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('No file selected'));
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string) as SongData;
          resolve(data);
        } catch {
          reject(new Error('Invalid file format'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    };
    input.click();
  });
}

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
      track.addEvent(new MidiWriter.NoteEvent({
        pitch: notes.map(n => n.pitch),
        duration: `T${Math.round(notes[0].duration * 128)}`,
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
  const SCALE = 2;
  const PAGE_WIDTH = 900;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(canvas);

  const layout = renderNotationToCanvas(canvas, song, SCALE, PAGE_WIDTH);

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
      background: #222; color: white; padding: 12px 20px;
      display: flex; align-items: center; gap: 12px;
      font-family: sans-serif; font-size: 13px;
    }
    .no-print button {
      padding: 8px 20px; font-size: 13px; cursor: pointer;
      border: none; border-radius: 4px; font-family: sans-serif;
    }
    .btn-print { background: #D4AF37; color: #000; font-weight: bold; }
    .btn-close { background: #555; color: #fff; }
    .page {
      width: 279mm; min-height: 216mm; margin: 16px auto;
      padding: 15mm; background: white;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      display: flex; flex-direction: column; gap: 8px;
    }
    h1 { font-size: 20pt; text-align: center; margin-bottom: 2px; }
    .meta { font-size: 10pt; text-align: center; color: #444; margin-bottom: 12px; font-family: sans-serif; }
    img { width: 100%; height: auto; display: block; }
    @media print {
      body { background: white; }
      .no-print { display: none; }
      .page { margin: 0; padding: 12mm; width: 100%; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn-print" onclick="window.print()">&#128438; Print / Save as PDF</button>
    <button class="btn-close" onclick="window.close()">Close</button>
    <span style="margin-left:8px;color:#aaa;">Tip: in print dialog choose "Save as PDF", Paper: Letter, Landscape</span>
  </div>
  <div class="page">
    <h1>Aurelia Composer</h1>
    <p class="meta">Tempo: ${song.tempo} BPM &nbsp;|&nbsp; ${song.timeSignature[0]}/${song.timeSignature[1]}${song.keySignature && song.keySignature !== 'C' ? ` &nbsp;|&nbsp; Key: ${song.keySignature}` : ''}</p>
    <img src="${dataUrl}" alt="Score" />
  </div>
</body>
</html>`);

  printWindow.document.close();
  printWindow.focus();
}
