import { VexFlow, RendererBackends } from 'vexflow';
import { SongData, TrackData, NoteData } from '../types';

export function renderNotation(container: HTMLElement, song: SongData) {
  container.innerHTML = '';
  
  const VF = VexFlow;
  
  // Calculate total beats to determine staff width
  let maxBeats = 16; // default 4 bars of 4/4
  song.tracks.forEach(track => {
    track.notes.forEach(note => {
      if (note.start + note.duration > maxBeats) {
        maxBeats = note.start + note.duration;
      }
    });
  });

  const renderer = new VF.Renderer(container, RendererBackends.SVG);
  
  const width = Math.max(800, maxBeats * 40 + 100);
  renderer.resize(width, song.tracks.length * 150 + 50);
  
  const context = renderer.getContext();
  context.setFont('Arial', 10);
  
  // Set stroke and fill to white for dark theme
  context.setFillStyle('#F2F2F2');
  context.setStrokeStyle('#F2F2F2');

  // For each track, draw a stave
  song.tracks.forEach((track, tIndex) => {
    const stave = new VF.Stave(10, 40 + tIndex * 150, width - 20);
    stave.addClef('treble');
    stave.addTimeSignature(`${song.timeSignature[0]}/${song.timeSignature[1]}`);
    stave.setContext(context).draw();
    
    // Group notes by exact start time
    const notesByBeat: Record<string, NoteData[]> = {};
    track.notes.forEach(note => {
      const key = note.start.toString();
      if (!notesByBeat[key]) notesByBeat[key] = [];
      notesByBeat[key].push(note);
    });

    const renderingNotes: { startBeat: number; staveNote: any }[] = [];

    Object.entries(notesByBeat).forEach(([beatStr, chordNotes]) => {
        const beat = parseFloat(beatStr);
        
        // Filter out rests from chords if there are multiple, or handle uniquely
        const isRest = chordNotes.length === 1 && chordNotes[0].isRest;
        
        const keys = chordNotes.map(n => {
           if (n.isRest) return 'b/4'; 
           const pitchClass = n.pitch.slice(0, -1).toLowerCase().replace('#', '#');
           const octave = n.pitch.slice(-1);
           return `${pitchClass}/${octave}`;
        });
        
        const durationNum = chordNotes[0].duration;
        let vfDuration = 'q';
        if (durationNum === 0.25) vfDuration = '16';
        else if (durationNum === 0.5) vfDuration = '8';
        else if (durationNum === 1.5) vfDuration = 'qd';
        else if (durationNum === 0.75) vfDuration = '8d';
        else if (durationNum === 1) vfDuration = 'q';
        else if (durationNum === 2) vfDuration = 'h';
        else if (durationNum === 3) vfDuration = 'hd';
        else if (durationNum === 4) vfDuration = 'w';
        else vfDuration = 'q';
        
        if (isRest) {
            vfDuration += 'r';
        }

        const staveNote = new VF.StaveNote({
            keys: keys,
            duration: vfDuration,
        });
        
        if (!isRest) {
            keys.forEach((key, i) => {
              if (key.includes('#')) {
                staveNote.addModifier(new VF.Accidental('#'), i);
              } else if (key.includes('b')) {
                staveNote.addModifier(new VF.Accidental('b'), i);
              }
            });
        }
        
        if (durationNum === 1.5 || durationNum === 0.75 || durationNum === 3) {
            staveNote.addModifier(new VF.Dot(), 0);
        }

        staveNote.setStyle({ fillStyle: '#F2F2F2', strokeStyle: '#F2F2F2' });
        
        renderingNotes.push({ startBeat: beat, staveNote });
    });

    // Draw notes with absolute positioning
    const pixelsPerBeat = 60;
    const startX = stave.getNoteStartX();
    renderingNotes.forEach(rn => {
        const tickContext = new VF.TickContext();
        tickContext.addTickable(rn.staveNote);
        tickContext.preFormat().setX(startX + rn.startBeat * pixelsPerBeat); 
        rn.staveNote.setStave(stave);
        rn.staveNote.setContext(context).draw();
    });
  });
}
