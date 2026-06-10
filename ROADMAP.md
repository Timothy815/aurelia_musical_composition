# Aurelia Composer — Improvement Roadmap

Items are ordered by impact-to-effort ratio. Each is a self-contained
increment: implement, verify, commit, then move to the next.

---

## Tier 1 — Quick wins (small effort, immediate payoff)

- [x] **Piece title & composer metadata**
  Store a title and composer name on `SongData`. Show them in the score
  header, use the title as the PDF `<h1>` and as the default filename
  for Save/MIDI/PDF exports.

- [x] **Measure numbers**
  Print a small measure number above the first note of each measure
  (every system, or every N measures). Standard in any printed score;
  makes rehearsal references possible.

- [x] **Chord-change-only diagrams**
  Only render a chord diagram when the chord differs from the previous
  beat. Avoids the wall-of-boxes problem on repeated chords and makes
  the tab view read like a real lead sheet.

---

## Tier 2 — Medium effort, high value

- [ ] **PDF page layout**
  Split long scores across multiple pages with correct stave continuation.
  Currently everything overflows onto one very tall page; anything beyond
  a few measures is unprintable.

- [ ] **Instrument selection per track**
  Add a simple instrument picker to each track (piano, strings, guitar,
  bass, brass stab — a handful of Tone.js-compatible sample sets).
  Every track currently sounds like piano regardless of intent.

- [ ] **Dynamics & articulations**
  Support at minimum: dynamic markings (*pp*, *mp*, *mf*, *f*, *ff*) and
  note-level articulations (staccato, accent, tenuto). Render them in the
  VexFlow stave and apply velocity/duration adjustments during playback.

---

## Tier 3 — Larger lifts, power-user features

- [ ] **Real-time MIDI input recording**
  Use the Web MIDI API to let a connected keyboard record notes directly
  into the score in Score Mode. Requires a record button, a count-in, and
  quantisation controls.

- [ ] **MusicXML export**
  Export the score as MusicXML so it can be opened in Sibelius, Finale,
  MuseScore, or Dorico for further editing. The de-facto interchange format
  for notation software.

---

## Completed

- [x] Guitar chord diagram view (SVG fretboard boxes, backtracking algorithm)
- [x] Chord diagrams included in PDF export when Tab is toggled on
- [x] Chord labels above staves
- [x] Transpose controls
- [x] Salamander piano samples bundled locally
- [x] Playing Mode / Score Mode
- [x] Loop regions
- [x] Undo / Redo
- [x] MIDI export
- [x] PDF export
