# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Production build
npm run lint         # Type-check only (tsc --noEmit), no test runner
npm run clean        # Remove dist/ and server.js
```

Requires `GEMINI_API_KEY` in `.env.local` (used by the original AI Studio scaffold; not currently wired into the app logic).

## Architecture

Single-page React app (`src/App.tsx`) — a music composition tool called **Aurelia Composer**. No routing, no backend, no state management library.

### Core data model (`src/types.ts`)
- `SongData` → `TrackData[]` → `NoteData[]`
- `NoteData.start` and `NoteData.duration` are in **beats** (quarter notes = 1 beat). This is the canonical unit throughout the codebase — audio scheduling, grid rendering, and MIDI export all convert from beats.

### Key modules
| File | Role |
|------|------|
| `src/App.tsx` | All app state lives here. Owns `SongData`, playback state, active/playing note sets, and selected note IDs. |
| `src/lib/audio.ts` | Singleton `AudioEngine` wrapping Tone.js. Loads Salamander piano samples from tonejs.github.io. Falls back to a `PolySynth` triangle oscillator when samples aren't loaded yet. |
| `src/lib/notation.ts` | Pure rendering function `renderNotation(container, song)` — clears and redraws VexFlow SVG on every call. Uses absolute pixel positioning (60px/beat). |
| `src/components/Notation.tsx` | Renders the VexFlow SVG (via `renderNotation`) plus an **invisible interactive grid overlay** layered on top. The grid handles click/drag-select/keyboard navigation and writes back to `onUpdateSong`. |
| `src/lib/export.ts` | MIDI export via `midi-writer-js`; PDF export via `html2canvas` + `jsPDF`. |

### Two editing modes
- **Score Mode** (`playMode=false`): notes latch on the keyboard/fretboard; pressing Enter or the sidebar button appends them to the score. Clicking the notation grid places/removes notes.
- **Playing Mode** (`playMode=true`): keyboard/fretboard works like a live instrument (no latching).

### Notation grid coordinate system
The interactive grid in `Notation.tsx` must stay pixel-aligned with the VexFlow stave:
- `startX = 70px` (note start offset inside the stave)
- `pixelsPerBeat = 60px`, `gridSubdivisions = 4` → `cellWidth = 15px` (each cell = 1 sixteenth note)
- `cellHeight = 10px`; pitches mapped top-to-bottom in `PITCHES` array (B5 → G3)
- Track stave Y positions: `40 + tIndex * 150` in VexFlow; grid overlay adds `p-8` (32px) container padding, so grid top = `2rem + (25 + tIndex*150)px`

### Keyboard shortcuts (Score Mode)
- `Enter` — append active notes to score
- `Backspace/Delete` — remove selected notes, or pop the last chord
- `Arrow keys` — navigate/transpose selected notes (Up/Down = pitch, Left/Right = time position)

### Audio initialization
`AudioEngine.init()` must be called from a user gesture (browser autoplay policy). The first `click` event on the window triggers it. All playback methods check `this.initialized` and are safe to call before init.
