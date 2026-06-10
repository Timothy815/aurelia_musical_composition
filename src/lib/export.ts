import MidiWriter from 'midi-writer-js';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { SongData } from '../types';

export function exportToMidi(song: SongData) {
  const tracks = song.tracks.map(t => {
    const track = new MidiWriter.Track();
    track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 1 }));
    track.addTrackName(t.name);
    // Setting tempo
    track.setTempo(song.tempo);
    
    // Group notes by start time to create chords
    const notesByStart: Record<number, { pitch: string; duration: number }[]> = {};
    t.notes.forEach(note => {
      if (!notesByStart[note.start]) notesByStart[note.start] = [];
      notesByStart[note.start].push(note);
    });

    let currentTick = 0;
    
    // Process chronologically
    const times = Object.keys(notesByStart).map(Number).sort((a, b) => a - b);
    
    times.forEach(time => {
      const notes = notesByStart[time];
      const waitBeats = time - currentTick;
      const waitTicks = waitBeats > 0 ? waitBeats * 128 : 0; // MidiWriter uses 128 ticks per quarter
      
      const midiPitches = notes.map(n => n.pitch);
      const durationNum = notes[0].duration; // Assuming uniform duration for simplicity
      
      // Convert our quarter beats to MidiWriter durations
      const mappedDuration = Math.round(durationNum * 128).toString(); // Wait, MidiWriter string representation: '4'=quarter, '8'=eighth... 
      // Actually we can use Ticks string like `T${durationNum * 128}`
      
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
  
  // Download file
  const a = document.createElement("a");
  a.href = dataUri;
  a.download = "composition.mid";
  a.click();
}

export async function exportToPdf(containerId: string) {
  const elem = document.getElementById(containerId);
  if (!elem) return;
  
  const canvas = await html2canvas(elem);
  const imgData = canvas.toDataURL('image/png');
  
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [canvas.width, canvas.height]
  });
  
  pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
  pdf.save("composition.pdf");
}
