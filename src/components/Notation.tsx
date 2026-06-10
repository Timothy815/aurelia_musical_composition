import React, { useEffect, useRef, useState, useCallback } from 'react';
import { renderNotation } from '../lib/notation';
import { SongData, TrackData, NoteData } from '../types';
import { generateId, cn } from '../lib/utils';

const PITCHES = ['B5', 'A5', 'G5', 'F5', 'E5', 'D5', 'C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4', 'B3', 'A3', 'G3'];

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
  setSelectedNoteIds
}: { 
  song: SongData; 
  onUpdateSong: (s: SongData) => void;
  onPlayNote?: (pitch: string) => void;
  chordMode: boolean;
  chordNotes: Set<string>;
  selectedDuration: number;
  isDotted: boolean;
  isRest: boolean;
  chordSelectMode: boolean;
  selectedNoteIds: Set<string>;
  setSelectedNoteIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [dragBox, setDragBox] = useState<{
    tIndex: number;
    startCIndex: number;
    startRIndex: number;
    endCIndex: number;
    endRIndex: number;
  } | null>(null);

  // Calculate total beats for grid length
  const maxBeats = Math.max(
    16, 
    ...song.tracks.flatMap(t => t.notes.map(n => n.start + n.duration))
  );

  // Grid configuration matches lib/notation.ts
  const pixelsPerBeat = 60;
  const startX = 70; // offset in absolute positioning
  const gridSubdivisions = 4; // Support 16th notes (4 per beat)
  const cellWidth = pixelsPerBeat / gridSubdivisions; // 15px per quarter beat
  const cellHeight = 10;

  const handleGridClick = useCallback((trackIndex: number, cIndex: number, pitch: string) => {
    const beat = cIndex / gridSubdivisions;
    const track = song.tracks[trackIndex];
    
    let duration = selectedDuration;
    if (isDotted) duration *= 1.5;

    // Check if there's a note starting anywhere in this duration
    const existingIndex = track.notes.findIndex(n => 
       n.pitch === pitch && 
       beat >= n.start && 
       beat < n.start + n.duration - 0.01
    );
    
    if (existingIndex !== -1) {
      // Remove it or select it
      // For now, let's remove it if it exists (toggle behavior)
      const newNotes = [...track.notes];
      newNotes.splice(existingIndex, 1);
      
      const newTracks = [...song.tracks];
      newTracks[trackIndex] = { ...track, notes: newNotes };
      
      // Update selected set
      setSelectedNoteIds(prev => {
        const next = new Set(prev);
        next.delete(track.notes[existingIndex].id);
        return next;
      });
      
      onUpdateSong({ ...song, tracks: newTracks });
      return;
    }

    // Since we're adding a new note, deselect everything else
    setSelectedNoteIds(new Set());

    let newNotes = [...track.notes];

    if (isRest) {
      newNotes.push({ 
        id: generateId(), 
        pitch: pitch, 
        start: beat, 
        duration: duration, 
        instrument: track.instrument,
        isRest: true
      });
    } else if (chordNotes.size > 0) {
      Array.from(chordNotes).forEach(chordPitch => {
          newNotes.push({ 
            id: generateId(), 
            pitch: chordPitch, 
            start: beat, 
            duration: duration, 
            instrument: track.instrument,
            isRest: false
          });
      });
    } else {
      newNotes.push({ 
        id: generateId(), 
        pitch: pitch, 
        start: beat, 
        duration: duration, 
        instrument: track.instrument,
        isRest: false
      });
      if (onPlayNote) onPlayNote(pitch);
    }
    
    const newTracks = [...song.tracks];
    newTracks[trackIndex] = { ...track, notes: newNotes };
    onUpdateSong({ ...song, tracks: newTracks });
  }, [song, selectedDuration, isDotted, isRest, chordNotes, onPlayNote, onUpdateSong, setSelectedNoteIds]);

  const handleGlobalMouseUp = useCallback(() => {
    if (dragBox) {
      if (dragBox.startCIndex === dragBox.endCIndex && dragBox.startRIndex === dragBox.endRIndex) {
        // It was a click
        handleGridClick(dragBox.tIndex, dragBox.startCIndex, PITCHES[dragBox.startRIndex]);
      } else {
        // It was a drag selection
        const minC = Math.min(dragBox.startCIndex, dragBox.endCIndex);
        const maxC = Math.max(dragBox.startCIndex, dragBox.endCIndex);
        const minR = Math.min(dragBox.startRIndex, dragBox.endRIndex);
        const maxR = Math.max(dragBox.startRIndex, dragBox.endRIndex);

        const track = song.tracks[dragBox.tIndex];
        const startBeat = minC / gridSubdivisions;
        const endBeat = (maxC + 1) / gridSubdivisions;

        const selectedPitches = new Set<string>();
        for (let i = minR; i <= maxR; i++) {
          selectedPitches.add(PITCHES[i]);
        }

        const enclosedNotes = track.notes.filter(n => {
          const overlap = n.start < endBeat && (n.start + n.duration) > startBeat;
          return overlap && selectedPitches.has(n.pitch);
        });

        setSelectedNoteIds(new Set(enclosedNotes.map(n => n.id)));
      }
      setDragBox(null);
    }
  }, [dragBox, song, handleGridClick, setSelectedNoteIds]);

  useEffect(() => {
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleGlobalMouseUp]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (selectedNoteIds.size === 0) return;

      const newTracks = [...song.tracks];
      let didChange = false;
      
      newTracks.forEach(track => {
        const newNotes = [...track.notes];
        newNotes.forEach((n, idx) => {
          if (selectedNoteIds.has(n.id)) {
            const pitchIdx = PITCHES.indexOf(n.pitch);
            if (pitchIdx !== -1) {
              const nextIdx = e.key === 'ArrowUp' ? pitchIdx - 1 : pitchIdx + 1;
              if (nextIdx >= 0 && nextIdx < PITCHES.length) {
                newNotes[idx] = { ...n, pitch: PITCHES[nextIdx] };
                didChange = true;
                if (onPlayNote && !n.isRest) onPlayNote(PITCHES[nextIdx]);
              }
            }
          }
        });
        track.notes = newNotes;
      });

      if (didChange) {
        onUpdateSong({ ...song, tracks: newTracks });
      }
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      // Get all notes across all tracks, sorted by start time, then by pitch (for deterministic ordering)
      const allNotes = song.tracks.flatMap(t => t.notes).sort((a, b) => {
        if (Math.abs(a.start - b.start) > 0.001) return a.start - b.start;
        return a.pitch.localeCompare(b.pitch);
      });
      if (allNotes.length === 0) return;

      if (selectedNoteIds.size === 0) {
        // Select first or last note
        const noteToSelect = e.key === 'ArrowRight' ? allNotes[0] : allNotes[allNotes.length - 1];
        
        let idsToSelect = [noteToSelect.id];
        if (chordSelectMode) {
          idsToSelect = allNotes.filter(n => Math.abs(n.start - noteToSelect.start) < 0.001).map(n => n.id);
        }
        
        setSelectedNoteIds(new Set(idsToSelect));
        // Play out loud
        if (onPlayNote && !noteToSelect.isRest) {
          if (chordSelectMode) {
            allNotes.filter(n => Math.abs(n.start - noteToSelect.start) < 0.001).forEach(n => {
              if (!n.isRest) onPlayNote(n.pitch);
            });
          } else {
            onPlayNote(noteToSelect.pitch);
          }
        }
      } else {
        // Find one of the currently selected notes
        const selectedId = Array.from(selectedNoteIds)[0];
        const currentIndex = allNotes.findIndex(n => n.id === selectedId);
        if (currentIndex !== -1) {
          let nextIndex = e.key === 'ArrowRight' ? currentIndex + 1 : currentIndex - 1;
          
          if (chordSelectMode) {
            // Find the next unique start time
            const currentStart = allNotes[currentIndex].start;
            if (e.key === 'ArrowRight') {
              const nextNoteWithDifferentStart = allNotes.find(n => n.start > currentStart + 0.001);
              if (nextNoteWithDifferentStart) {
                nextIndex = allNotes.indexOf(nextNoteWithDifferentStart);
              } else {
                nextIndex = currentIndex; // stay where we are
              }
            } else {
              // ArrowLeft
              // Reverse find the note that comes before this timestamp
              const reversed = [...allNotes].reverse();
              const prevNoteWithDifferentStart = reversed.find(n => n.start < currentStart - 0.001);
              if (prevNoteWithDifferentStart) {
                // Find all notes with that start time
                const startTime = prevNoteWithDifferentStart.start;
                const firstIdWithStart = allNotes.findIndex(n => Math.abs(n.start - startTime) < 0.001);
                nextIndex = firstIdWithStart;
              } else {
                nextIndex = currentIndex;
              }
            }
          }

          if (nextIndex < 0) nextIndex = 0;
          if (nextIndex >= allNotes.length) nextIndex = allNotes.length - 1;
          const nextNote = allNotes[nextIndex];
          
          let idsToSelect = [nextNote.id];
          if (chordSelectMode) {
            idsToSelect = allNotes.filter(n => Math.abs(n.start - nextNote.start) < 0.001).map(n => n.id);
          }
          
          setSelectedNoteIds(new Set(idsToSelect));
          // Play out loud
          if (onPlayNote && !nextNote.isRest) {
            if (chordSelectMode) {
              allNotes.filter(n => Math.abs(n.start - nextNote.start) < 0.001).forEach(n => {
                if (!n.isRest) onPlayNote(n.pitch);
              });
            } else {
              onPlayNote(nextNote.pitch);
            }
          }
        }
      }
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      let newTracks = [...song.tracks];
      let didChange = false;

      if (selectedNoteIds.size > 0) {
        // Remove selected notes
        newTracks = newTracks.map(track => {
          const filtered = track.notes.filter(n => !selectedNoteIds.has(n.id));
          if (filtered.length !== track.notes.length) didChange = true;
          return { ...track, notes: filtered };
        });
        setSelectedNoteIds(new Set());
      } else {
        // Remove the most recently added note(s) (undo behavior)
        // Check finding notes with the highest insertion? They are at the end of the array.
        // If we added a chord, let's just pop the last added note.
        // Since notes are appended, we just remove the last note from the first track that has notes.
        for (let i = 0; i < newTracks.length; i++) {
          if (newTracks[i].notes.length > 0) {
            const track = newTracks[i];
            const lastNote = track.notes[track.notes.length - 1];
            // Remove all notes that start at the exact same time as the last note to pop chords cleanly
            const newNotes = track.notes.filter(n => n.start !== lastNote.start || Math.abs(n.start - lastNote.start) > 0.001);
            newTracks[i] = { ...track, notes: newNotes };
            didChange = true;
            break;
          }
        }
      }

      if (didChange) {
        onUpdateSong({ ...song, tracks: newTracks });
      }
    }
  }, [song, selectedNoteIds, onUpdateSong, onPlayNote, setSelectedNoteIds, chordSelectMode]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (!containerRef.current) return;
    renderNotation(containerRef.current, song);
  }, [song]);


  return (
    <div className="relative w-full h-full overflow-auto bg-[#050506] p-8 group">
      {/* VexFlow SVG Container */}
      <div ref={containerRef} className="absolute top-8 left-8 z-0 pointer-events-none" />
      
      {/* Interactive Grid Overlays for all tracks */}
      {/* We align this loosely with the VexFlow stave coordinate space */}
      {/* VexFlow Stave y: 40 + tIndex * 150. Stave lines spacing: 10px. */}
      {/* F5 is at relative Y=40. So B5 is at relative Y=10. */}
      {song.tracks.map((track, tIndex) => (
        <div 
          key={track.id}
          className="absolute z-10 opacity-30 hover:opacity-100 transition-opacity" 
          style={{ 
            left: `calc(2rem + ${startX}px)`, // 2rem corresponds to p-8 applied to container
            top: `calc(2rem + ${25 + tIndex * 150}px)`, 
            width: `${maxBeats * gridSubdivisions * cellWidth}px`, 
            height: `${PITCHES.length * cellHeight}px` 
          }}
        >
          {dragBox && dragBox.tIndex === tIndex && (
            <div 
              className="absolute bg-[#4D96FF]/30 border border-[#4D96FF] pointer-events-none z-50"
              style={{
                left: `${Math.min(dragBox.startCIndex, dragBox.endCIndex) * cellWidth}px`,
                top: `${Math.min(dragBox.startRIndex, dragBox.endRIndex) * cellHeight}px`,
                width: `${(Math.abs(dragBox.endCIndex - dragBox.startCIndex) + 1) * cellWidth}px`,
                height: `${(Math.abs(dragBox.endRIndex - dragBox.startRIndex) + 1) * cellHeight}px`,
              }}
            />
          )}
          {PITCHES.map((pitch, rIndex) => (
            <div key={pitch} className="flex" style={{ height: cellHeight }}>
              {Array.from({ length: maxBeats * gridSubdivisions }).map((_, cIndex) => {
                const beat = cIndex / gridSubdivisions;
                // Highlight if note spans this cell
                const spanNotes = track.notes.filter(n => 
                   n.pitch === pitch && 
                   beat >= n.start && 
                   beat < n.start + n.duration - 0.01
                );
                const isActive = spanNotes.length > 0;
                const isSelected = spanNotes.some(n => selectedNoteIds.has(n.id));
                const activeIsRest = spanNotes.length > 0 && spanNotes.every(n => n.isRest);
                
                const startNotes = track.notes.filter(n => Math.abs(n.start - beat) < 0.01 && n.pitch === pitch);
                const isStart = startNotes.length > 0;
                const isStartSelected = startNotes.some(n => selectedNoteIds.has(n.id));
                const startIsRest = startNotes.length > 0 && startNotes.every(n => n.isRest);
                
                const isStaged = chordNotes.has(pitch);
                
                return (
                  <div 
                    key={cIndex} 
                    className={cn(
                      "border-r border-b border-[#D4AF37]/5 hover:bg-[#D4AF37]/20 cursor-pointer transition-colors",
                      isActive && !isSelected && !activeIsRest ? "bg-[#D4AF37]/40 shadow-sm" : "",
                      isActive && !isSelected && activeIsRest ? "bg-[#8E8E93]/40 shadow-sm" : "",
                      isStart && !isStartSelected && !startIsRest ? "border-l-2 border-l-[#D4AF37]/80 bg-[#D4AF37]/60" : "",
                      isStart && !isStartSelected && startIsRest ? "border-l-2 border-l-[#8E8E93]/80 bg-[#8E8E93]/60" : "",
                      isSelected ? "bg-[#4D96FF]/40 shadow-sm" : "",
                      isStartSelected ? "border-l-2 border-l-[#4D96FF]/80 bg-[#4D96FF]/60" : "",
                      isStaged && !isActive && !isSelected ? "bg-[#D4AF37]/10" : ""
                    )}
                    style={{ width: cellWidth, height: cellHeight }}
                    onMouseDown={(e) => {
                       e.preventDefault(); // prevent text selection
                       setDragBox({ tIndex, startCIndex: cIndex, startRIndex: rIndex, endCIndex: cIndex, endRIndex: rIndex });
                    }}
                    onMouseEnter={(e) => {
                       if (e.buttons === 1) {
                          setDragBox(prev => prev ? { ...prev, endCIndex: cIndex, endRIndex: rIndex } : null);
                       }
                    }}
                  >
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
