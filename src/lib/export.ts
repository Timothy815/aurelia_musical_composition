import MidiWriter from 'midi-writer-js';
import { unzipSync, strFromU8 } from 'fflate';
import { SongData, NoteData, TrackData, DynamicMarking } from '../types';
import { renderNotationToCanvas, calcLayout, renderChordSectionToCanvas } from './notation';

// ── MusicXML helpers ───────────────────────────────────────────────────────

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const KEY_FIFTHS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6,
};

function parseMusicXMLPitch(pitch: string): { step: string; alter: number; octave: number } {
  const m = pitch.match(/^([A-G])(#|b)?(\d+)$/);
  if (!m) return { step: 'C', alter: 0, octave: 4 };
  return { step: m[1], alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: parseInt(m[3]) };
}

function beatsToType(beats: number): { type: string; dots: number } {
  const MAP: [number, string][] = [
    [4, 'whole'], [2, 'half'], [1, 'quarter'],
    [0.5, 'eighth'], [0.25, '16th'], [0.125, '32nd'],
  ];
  for (const [d, t] of MAP) {
    if (Math.abs(beats - d) < 0.02) return { type: t, dots: 0 };
    if (Math.abs(beats - d * 1.5) < 0.02) return { type: t, dots: 1 };
  }
  let best = MAP[0];
  for (const [d, t] of MAP) {
    if (Math.abs(beats - d) < Math.abs(beats - best[0])) best = [d, t];
  }
  return { type: best[1], dots: 0 };
}

function noteLines(
  note: NoteData | null,
  beats: number,
  divisions: number,
  isChord: boolean,
  slurStart?: boolean,
  slurStop?: boolean,
): string[] {
  const dur = Math.max(1, Math.round(beats * divisions));
  const { type, dots } = beatsToType(beats);
  const out: string[] = [];
  out.push('      <note>');
  if (isChord) out.push('        <chord/>');
  if (!note || note.isRest) {
    out.push('        <rest/>');
  } else {
    const { step, alter, octave } = parseMusicXMLPitch(note.pitch);
    out.push('        <pitch>');
    out.push(`          <step>${step}</step>`);
    if (alter !== 0) out.push(`          <alter>${alter}</alter>`);
    out.push(`          <octave>${octave}</octave>`);
    out.push('        </pitch>');
  }
  out.push(`        <duration>${dur}</duration>`);
  out.push(`        <voice>${note?.voice ?? 1}</voice>`);
  out.push(`        <type>${type}</type>`);
  for (let i = 0; i < dots; i++) out.push('        <dot/>');
  out.push('        <staff>1</staff>');

  // Notations block: articulations + slurs
  const notationParts: string[] = [];
  if (note?.articulation) {
    const tag = note.articulation === 'staccato' ? '<staccato/>'
      : note.articulation === 'accent' ? '<accent/>'
      : '<tenuto/>';
    notationParts.push('<articulations>' + tag + '</articulations>');
  }
  if (slurStart) notationParts.push('<slur type="start" number="1"/>');
  if (slurStop)  notationParts.push('<slur type="stop" number="1"/>');
  if (notationParts.length > 0) {
    out.push('        <notations>' + notationParts.join('') + '</notations>');
  }

  if (note?.lyric && !note.isRest) {
    const text = note.lyric.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const syllabic = text.endsWith('-') ? 'begin' : 'single';
    const displayText = syllabic === 'begin' ? text.slice(0, -1) : text;
    out.push(`        <lyric number="1"><syllabic>${syllabic}</syllabic><text>${displayText}</text></lyric>`);
  }
  out.push('      </note>');
  return out;
}

function fillRestsXML(from: number, to: number, divisions: number, out: string[]) {
  const REST_DURS = [4, 2, 1, 0.5, 0.25, 0.125];
  let remaining = to - from;
  while (remaining > 0.02) {
    const dur = REST_DURS.find(d => d <= remaining + 0.02) ?? REST_DURS[REST_DURS.length - 1];
    out.push(...noteLines(null, Math.min(dur, remaining), divisions, false));
    remaining -= dur;
  }
}

export function exportToMusicXML(song: SongData) {
  const DIVISIONS = 4;
  const bpm = song.timeSignature[0] * (4 / song.timeSignature[1]);
  const out: string[] = [];

  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="3.1">');
  if (song.title) out.push(`  <work><work-title>${xmlEsc(song.title)}</work-title></work>`);
  if (song.composer) {
    out.push('  <identification>');
    out.push(`    <creator type="composer">${xmlEsc(song.composer)}</creator>`);
    out.push('    <encoding><software>Aurelia Composer</software></encoding>');
    out.push('  </identification>');
  }
  out.push('  <part-list>');
  song.tracks.forEach((t, i) =>
    out.push(`    <score-part id="P${i + 1}"><part-name>${xmlEsc(t.name)}</part-name></score-part>`)
  );
  out.push('  </part-list>');

  const rehearsalMarks = song.rehearsalMarks ?? [];
  const ottavaList     = song.ottava ?? [];
  const pedalMarks     = song.pedalMarks ?? [];
  const slurs          = song.slurs ?? [];

  song.tracks.forEach((track, tIdx) => {
    out.push(`  <part id="P${tIdx + 1}">`);
    const maxBeat = track.notes.length > 0
      ? Math.max(...track.notes.map(n => n.start + n.duration)) : bpm;
    const numMeasures = Math.max(1, Math.ceil(maxBeat / bpm));

    for (let m = 0; m < numMeasures; m++) {
      const mStart = m * bpm;
      const mEnd = mStart + bpm;
      const measureNumber = m + 1;
      out.push(`    <measure number="${measureNumber}">`);
      if (m === 0) {
        out.push('      <attributes>');
        out.push(`        <divisions>${DIVISIONS}</divisions>`);
        out.push(`        <key><fifths>${KEY_FIFTHS[song.keySignature ?? 'C'] ?? 0}</fifths></key>`);
        out.push(`        <time><beats>${song.timeSignature[0]}</beats><beat-type>${song.timeSignature[1]}</beat-type></time>`);
        out.push('        <clef><sign>G</sign><line>2</line></clef>');
        out.push('      </attributes>');
        out.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${song.tempo}</per-minute></metronome></direction-type><sound tempo="${song.tempo}"/></direction>`);
      }

      // Rehearsal marks — only emit in first part (tIdx === 0)
      if (tIdx === 0) {
        rehearsalMarks
          .filter(rm => rm.measure === measureNumber)
          .forEach(rm => {
            out.push(`      <direction placement="above"><direction-type><rehearsal enclosure="square">${xmlEsc(rm.text)}</rehearsal></direction-type></direction>`);
          });
      }

      const mNotes = track.notes
        .filter(n => n.start >= mStart - 0.01 && n.start < mEnd - 0.01)
        .sort((a, b) => a.start - b.start);

      // Group simultaneous notes into chords
      const groups: NoteData[][] = [];
      for (let i = 0; i < mNotes.length; ) {
        const grp: NoteData[] = [mNotes[i]];
        while (i + 1 < mNotes.length && Math.abs(mNotes[i + 1].start - mNotes[i].start) < 0.02) {
          grp.push(mNotes[++i]);
        }
        groups.push(grp);
        i++;
      }

      let cursor = mStart;
      let lastDynamic = '';
      for (const grp of groups) {
        const gStart = grp[0].start;
        if (gStart > cursor + 0.02) fillRestsXML(cursor, gStart, DIVISIONS, out);
        const dyn = grp.find(n => !n.isRest && n.dynamic)?.dynamic ?? '';
        if (dyn && dyn !== lastDynamic) {
          out.push(`      <direction placement="below"><direction-type><dynamics><${dyn}/></dynamics></direction-type></direction>`);
          lastDynamic = dyn;
        }

        // Ottava directions — only emit in first part (tIdx === 0)
        if (tIdx === 0) {
          ottavaList
            .filter(o => Math.abs(o.startBeat - gStart) < 0.02)
            .forEach(o => {
              const shiftType = o.type === '8va' ? 'up' : 'down';
              out.push(`      <direction placement="above"><direction-type><octave-shift type="${shiftType}" size="8"/></direction-type></direction>`);
            });
          ottavaList
            .filter(o => Math.abs(o.endBeat - gStart) < 0.02)
            .forEach(() => {
              out.push('      <direction placement="above"><direction-type><octave-shift type="stop" size="8"/></direction-type></direction>');
            });
        }

        // Pedal marks — only emit in first part (tIdx === 0)
        if (tIdx === 0) {
          pedalMarks
            .filter(p => Math.abs(p.startBeat - gStart) < 0.02)
            .forEach(() => {
              out.push('      <direction placement="below"><direction-type><pedal type="start" line="yes"/></direction-type></direction>');
            });
          pedalMarks
            .filter(p => Math.abs(p.endBeat - gStart) < 0.02)
            .forEach(() => {
              out.push('      <direction placement="below"><direction-type><pedal type="stop" line="yes"/></direction-type></direction>');
            });
        }

        // Determine slur start/stop for this track at this beat
        const trackSlurs = slurs.filter(s => s.trackIndex === tIdx);
        const slurStart = trackSlurs.some(s => Math.abs(s.startBeat - gStart) < 0.02);
        const slurStop  = trackSlurs.some(s => Math.abs(s.endBeat - gStart) < 0.02);

        grp.forEach((note, idx) => out.push(...noteLines(
          note, note.duration, DIVISIONS, idx > 0,
          idx === 0 && slurStart,
          idx === 0 && slurStop,
        )));
        cursor = gStart + grp[0].duration;
      }
      if (cursor < mEnd - 0.02) fillRestsXML(cursor, mEnd, DIVISIONS, out);

      out.push('    </measure>');
    }
    out.push('  </part>');
  });

  out.push('</score-partwise>');

  const blob = new Blob([out.join('\n')], { type: 'application/vnd.recordare.musicxml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename(song.title, 'musicxml');
  a.click();
  URL.revokeObjectURL(url);
}

function safeFilename(title: string | undefined, ext: string): string {
  const base = (title ?? 'composition')
    .trim()
    .replace(/[^a-zA-Z0-9\-_ ]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '') || 'composition';
  return `${base}.${ext}`;
}

export function saveFile(song: SongData) {
  const json = JSON.stringify(song, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename(song.title, 'aurelia');
  a.click();
  URL.revokeObjectURL(url);
}

export function loadFile(): Promise<SongData> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.aurelia,.json,.musicxml,.mxl';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('No file selected'));
      const fileName = file.name.toLowerCase();
      const reader = new FileReader();

      if (fileName.endsWith('.mxl')) {
        // .mxl is a ZIP archive — must read as binary
        reader.onload = () => {
          try {
            const bytes = new Uint8Array(reader.result as ArrayBuffer);
            const unzipped = unzipSync(bytes);

            // Try META-INF/container.xml to find rootfile path
            let xmlString: string | null = null;
            if (unzipped['META-INF/container.xml']) {
              const containerXml = strFromU8(unzipped['META-INF/container.xml']);
              const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
              const rootPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
              if (rootPath && unzipped[rootPath]) {
                xmlString = strFromU8(unzipped[rootPath]);
              }
            }
            // Fallback: first .xml or .musicxml not in META-INF
            if (!xmlString) {
              const entry = Object.entries(unzipped).find(
                ([name]) => !name.startsWith('META-INF') && (name.endsWith('.xml') || name.endsWith('.musicxml'))
              );
              if (entry) xmlString = strFromU8(entry[1]);
            }
            if (!xmlString) throw new Error('No XML content found in .mxl archive');
            resolve(importMusicXML(xmlString));
          } catch (e) {
            reject(new Error('Failed to read .mxl: ' + (e as Error).message));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsArrayBuffer(file);
      } else {
        // Plain text: .musicxml, .json, .aurelia
        reader.onload = () => {
          try {
            if (fileName.endsWith('.musicxml')) {
              resolve(importMusicXML(reader.result as string));
            } else {
              resolve(JSON.parse(reader.result as string) as SongData);
            }
          } catch (e) {
            reject(new Error('Invalid file format: ' + (e as Error).message));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      }
    };
    input.click();
  });
}

const GM_PROGRAMS: Record<string, number> = {
  piano:   1,   // Acoustic Grand Piano
  guitar:  25,  // Acoustic Guitar (nylon)
  strings: 49,  // String Ensemble 1
  brass:   57,  // Trumpet
  bass:    33,  // Acoustic Bass
  flute:   74,  // Flute
  organ:   20,  // Church Organ
  synth:   81,  // Lead 1 (square)
};

const KEY_FIFTHS_MIDI: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6,
};

const TICKS_PER_BEAT = 128;

export function exportToMidi(song: SongData) {
  const tracks = song.tracks.map(t => {
    const track = new MidiWriter.Track();
    track.addTrackName(t.name);
    track.setTempo(song.tempo);

    // Time signature and key signature metadata
    track.addEvent(new MidiWriter.TimeSignatureEvent(
      song.timeSignature[0],
      song.timeSignature[1],
      24, 8
    ));
    const sf = KEY_FIFTHS_MIDI[song.keySignature ?? 'C'] ?? 0;
    track.addEvent(new MidiWriter.KeySignatureEvent(sf, 0));

    // Map instrument to General MIDI program number
    const program = GM_PROGRAMS[t.instrument] ?? 1;
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: program }));

    const DVEL: Record<string, number> = {
      ppp: 8, pp: 18, p: 32, mp: 50, mf: 65, f: 80, ff: 92, fff: 100,
    };
    const trackVol = t.volume ?? 1;

    const notesByStart: Record<number, typeof t.notes> = {};
    t.notes.filter(n => !n.isRest).forEach(note => {
      if (!notesByStart[note.start]) notesByStart[note.start] = [];
      notesByStart[note.start].push(note);
    });

    let currentTick = 0;
    const times = Object.keys(notesByStart).map(Number).sort((a, b) => a - b);
    times.forEach(time => {
      const notes = notesByStart[time];
      const waitTicks = Math.round((time - currentTick) * TICKS_PER_BEAT);
      // Use first note's dynamic for the chord; scale by track volume
      const dynVel = DVEL[notes[0].dynamic ?? 'mf'] ?? 65;
      const velocity = Math.max(1, Math.min(100, Math.round(dynVel * trackVol)));
      track.addEvent(new MidiWriter.NoteEvent({
        pitch: notes.map(n => n.pitch),
        duration: `T${Math.round(notes[0].duration * TICKS_PER_BEAT)}`,
        wait: waitTicks > 0 ? `T${waitTicks}` : 0,
        velocity,
      }));
      currentTick = time;
    });

    return track;
  });

  const write = new MidiWriter.Writer(tracks);
  const a = document.createElement('a');
  a.href = write.dataUri();
  a.download = safeFilename(song.title, 'mid');
  a.click();
}

export function exportToPdf(song: SongData, showGuitarTab = false) {
  const SCALE = 2;
  const PAGE_WIDTH = 900;
  // Compact track height for PDF — tighter than the browser view (290) so more rows fit per page
  const PDF_TRACK_HEIGHT = 150;
  // How many layout-pixels of score content fit on one printed page (landscape letter minus margins)
  const PAGE_CONTENT_HEIGHT = 600;

  const layout = calcLayout(song, PAGE_WIDTH, showGuitarTab, PDF_TRACK_HEIGHT);
  const { numRows, rowHeight } = layout;
  const rowsPerPage = Math.max(1, Math.floor(PAGE_CONTENT_HEIGHT / rowHeight));

  const pageDataUrls: string[] = [];
  for (let startRow = 0; startRow < numRows; startRow += rowsPerPage) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(canvas);
    renderNotationToCanvas(canvas, song, SCALE, PAGE_WIDTH, showGuitarTab, startRow, rowsPerPage, PDF_TRACK_HEIGHT);
    pageDataUrls.push(canvas.toDataURL('image/png'));
    document.body.removeChild(canvas);
  }

  if (showGuitarTab) {
    const chordCanvas = document.createElement('canvas');
    chordCanvas.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(chordCanvas);
    const hasChords = renderChordSectionToCanvas(chordCanvas, song, SCALE, PAGE_WIDTH);
    if (hasChords) pageDataUrls.push(chordCanvas.toDataURL('image/png'));
    document.body.removeChild(chordCanvas);
  }

  const printWindow = window.open('', '_blank', 'width=1050,height=780');
  if (!printWindow) return;

  const scoreTitle = song.title || 'Untitled';
  const composerLine = song.composer ? `<p class="meta by">by ${song.composer}</p>` : '';
  const metaLine = `<p class="meta">Tempo: ${song.tempo} BPM &nbsp;|&nbsp; ${song.timeSignature[0]}/${song.timeSignature[1]}${song.keySignature && song.keySignature !== 'C' ? ` &nbsp;|&nbsp; Key: ${song.keySignature}` : ''}</p>`;

  const pageBlocks = pageDataUrls.map((url, i) => {
    const header = i === 0
      ? `<h1>${scoreTitle}</h1>${composerLine}${metaLine}`
      : '';
    return `<div class="page">${header}<img src="${url}" alt="Score page ${i + 1}" /></div>`;
  }).join('\n');

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${scoreTitle}</title>
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
    .meta { font-size: 10pt; text-align: center; color: #444; margin-bottom: 4px; font-family: sans-serif; }
    .meta.by { font-style: italic; margin-bottom: 8px; }
    img { width: 100%; height: auto; display: block; }
    @media print {
      body { background: white; }
      .no-print { display: none; }
      .page {
        margin: 0; padding: 12mm; width: 100%; box-shadow: none;
        page-break-after: always; break-after: page;
      }
      .page:last-child { page-break-after: auto; break-after: auto; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button class="btn-print" onclick="window.print()">&#128438; Print / Save as PDF</button>
    <button class="btn-close" onclick="window.close()">Close</button>
    <span style="margin-left:8px;color:#aaa;">Tip: in print dialog choose "Save as PDF", Paper: Letter, Landscape</span>
  </div>
  ${pageBlocks}
</body>
</html>`);

  printWindow.document.close();
  printWindow.focus();
}

export function importMusicXML(xmlString: string): SongData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('Invalid MusicXML: ' + parseError.textContent);

  // Title / Composer
  const title = doc.querySelector('movement-title, work-title')?.textContent?.trim() ?? 'Imported Score';
  const composer = doc.querySelector('creator[type="composer"]')?.textContent?.trim() ?? '';

  // Time signature — read from first measure's attributes
  let timeSig: number[] = [4, 4];
  const timeEl = doc.querySelector('time');
  if (timeEl) {
    const beats = parseInt(timeEl.querySelector('beats')?.textContent ?? '4');
    const beatType = parseInt(timeEl.querySelector('beat-type')?.textContent ?? '4');
    timeSig = [beats, beatType];
  }

  // Key signature
  let keySignature = 'C';
  const keyEl = doc.querySelector('key');
  if (keyEl) {
    const fifths = parseInt(keyEl.querySelector('fifths')?.textContent ?? '0');
    const KEY_BY_FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
    keySignature = KEY_BY_FIFTHS[((fifths % 12) + 12) % 12];
  }

  // Tempo — look for <sound tempo="..."> or <metronome>
  let tempo = 120;
  const soundTempo = doc.querySelector('sound[tempo]');
  if (soundTempo) tempo = parseFloat(soundTempo.getAttribute('tempo') ?? '120');

  // Parse divisions (MusicXML uses divisions per quarter note for durations)
  let divisions = 1;
  const divEl = doc.querySelector('divisions');
  if (divEl) divisions = parseInt(divEl.textContent ?? '1');

  // Parse notes per part
  const parts = Array.from(doc.querySelectorAll('part'));
  const tracks: TrackData[] = [];

  parts.forEach((part, partIdx) => {
    const partId = part.getAttribute('id') ?? `P${partIdx + 1}`;
    // Get part name from part-list
    const partName = doc.querySelector(`score-part[id="${partId}"] part-name`)?.textContent?.trim() ?? `Track ${partIdx + 1}`;

    const notes: NoteData[] = [];
    let currentBeat = 0;
    let currentDivisions = divisions;
    let currentTimeSig = [...timeSig];

    const measures = Array.from(part.querySelectorAll('measure'));
    measures.forEach(measure => {
      // Update divisions if redefined
      const newDiv = measure.querySelector('attributes > divisions');
      if (newDiv) currentDivisions = parseInt(newDiv.textContent ?? String(currentDivisions));

      // Update time sig if redefined
      const newTime = measure.querySelector('attributes > time');
      if (newTime) {
        const b = parseInt(newTime.querySelector('beats')?.textContent ?? String(currentTimeSig[0]));
        const bt = parseInt(newTime.querySelector('beat-type')?.textContent ?? String(currentTimeSig[1]));
        currentTimeSig = [b, bt];
      }

      const beatsPerMeasure = currentTimeSig[0] * (4 / currentTimeSig[1]);
      const measureStartBeat = currentBeat;
      let measureOffset = 0; // in divisions

      // Handle backup/forward/note elements
      Array.from(measure.children).forEach(el => {
        if (el.tagName === 'note') {
          const isChord = !!el.querySelector('chord');
          if (isChord) {
            // Chord: back up duration of previous note
            const prevDur = notes.length > 0 ? notes[notes.length - 1].duration : 0;
            measureOffset -= Math.round(prevDur * currentDivisions);
          }
          const isRest = !!el.querySelector('rest');
          const dur = parseInt(el.querySelector('duration')?.textContent ?? '1');
          const durationBeats = dur / currentDivisions;

          let pitch = 'C4';
          if (!isRest) {
            const step = el.querySelector('pitch > step')?.textContent ?? 'C';
            const alter = parseInt(el.querySelector('pitch > alter')?.textContent ?? '0');
            const octave = el.querySelector('pitch > octave')?.textContent ?? '4';
            const accidental = alter === 1 ? '#' : alter === -1 ? 'b' : '';
            pitch = `${step}${accidental}${octave}`;
          }

          const voiceNum = parseInt(el.querySelector('voice')?.textContent ?? '1');
          const voice: 1 | 2 = voiceNum === 2 ? 2 : 1;

          // Dynamic
          let dynamic: DynamicMarking | undefined;
          const dynEl = el.querySelector('dynamics');
          if (dynEl && dynEl.children.length > 0) {
            dynamic = dynEl.children[0].tagName as DynamicMarking;
          }

          // Tied
          const tieEl = el.querySelector('tie[type="start"]');
          const tied = !!tieEl || undefined;

          const noteBeat = measureStartBeat + measureOffset / currentDivisions;

          notes.push({
            id: `imp-${partIdx}-${notes.length}`,
            pitch,
            start: Math.round(noteBeat * 1000) / 1000,
            duration: Math.round(durationBeats * 1000) / 1000,
            isRest: isRest || undefined,
            voice,
            dynamic,
            tied,
          });

          if (!isChord) measureOffset += dur;
        } else if (el.tagName === 'backup') {
          const dur = parseInt(el.querySelector('duration')?.textContent ?? '0');
          measureOffset -= dur;
        } else if (el.tagName === 'forward') {
          const dur = parseInt(el.querySelector('duration')?.textContent ?? '0');
          measureOffset += dur;
        }
      });

      currentBeat = measureStartBeat + beatsPerMeasure;
    });

    tracks.push({
      id: `imp-track-${partIdx}`,
      name: partName,
      instrument: 'piano',
      notes,
    });
  });

  return {
    title,
    composer: composer || undefined,
    tempo,
    timeSignature: timeSig,
    keySignature,
    tracks,
  };
}
