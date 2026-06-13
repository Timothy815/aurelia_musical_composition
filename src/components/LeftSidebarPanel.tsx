import React from 'react';
import { Plus, Copy } from 'lucide-react';
import { SongData, NoteData, InstrumentPreset, DynamicMarking, ArticulationMarking, EffectsSettings, HairpinData, VoltaData, SlurData, RehearsalMark, PedalMark, OttavaData } from '../types';
import { cn, generateId } from '../lib/utils';
import { audio } from '../lib/audio';
import { INSTRUMENT_LABELS, TRACK_COLORS } from '../lib/constants';

interface LeftSidebarPanelProps {
  song: SongData;
  setSong: (updater: SongData | ((s: SongData) => SongData)) => void;
  activeTrackIndex: number;
  setActiveTrackIndex: React.Dispatch<React.SetStateAction<number>>;
  selectedDuration: number;
  setSelectedDuration: (d: number) => void;
  isDotted: boolean;
  setIsDotted: React.Dispatch<React.SetStateAction<boolean>>;
  isRest: boolean;
  setIsRest: React.Dispatch<React.SetStateAction<boolean>>;
  tripletMode: boolean;
  setTripletMode: React.Dispatch<React.SetStateAction<boolean>>;
  graceMode: boolean;
  setGraceMode: React.Dispatch<React.SetStateAction<boolean>>;
  pendingGrace: { pitch: string; slash: boolean } | null;
  activeVoice: 1 | 2;
  setActiveVoice: (v: 1 | 2) => void;
  selectedDynamic: DynamicMarking | null;
  setSelectedDynamic: (value: DynamicMarking | null) => void;
  selectedArticulation: ArticulationMarking | null;
  setSelectedArticulation: (value: ArticulationMarking | null) => void;
  chordSelectMode: boolean;
  setChordSelectMode: React.Dispatch<React.SetStateAction<boolean>>;
  harmonyMode: boolean;
  setHarmonyMode: React.Dispatch<React.SetStateAction<boolean>>;
  selectedNoteIds: Set<string>;
  setSelectedNoteIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  clipboard: { notes: NoteData[]; trackIds: string[] } | null;
  setClipboard: React.Dispatch<React.SetStateAction<{ notes: NoteData[]; trackIds: string[] } | null>>;
  activeNotes: Set<string>;
  setActiveNotes: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleAppendToScore: () => void;
  playMode: boolean;
  lastChord: { pitches: string[]; isRest: boolean; duration: number; dynamic?: DynamicMarking; articulation?: ArticulationMarking; voice: 1 | 2; } | null;
  effectsSettings: EffectsSettings;
  setEffectsSettings: React.Dispatch<React.SetStateAction<EffectsSettings>>;
  showEffects: boolean;
  setShowEffects: React.Dispatch<React.SetStateAction<boolean>>;
  showSidebar: boolean;
  setShowSidebar: React.Dispatch<React.SetStateAction<boolean>>;
  showTempoChanges: boolean;
  setShowTempoChanges: React.Dispatch<React.SetStateAction<boolean>>;
  newTcMeasure: string;
  setNewTcMeasure: (v: string) => void;
  newTcBpm: string;
  setNewTcBpm: (v: string) => void;
  showRepeats: boolean;
  setShowRepeats: React.Dispatch<React.SetStateAction<boolean>>;
  newRepeatMeasure: string;
  setNewRepeatMeasure: (v: string) => void;
  newRepeatType: 'start' | 'end';
  setNewRepeatType: (v: 'start' | 'end') => void;
  showVoltas: boolean;
  setShowVoltas: React.Dispatch<React.SetStateAction<boolean>>;
  newVoltaStart: string;
  setNewVoltaStart: (v: string) => void;
  newVoltaEnd: string;
  setNewVoltaEnd: (v: string) => void;
  newVoltaNumber: 1 | 2 | 3;
  setNewVoltaNumber: (v: 1 | 2 | 3) => void;
  showRehearsalMarks: boolean;
  setShowRehearsalMarks: React.Dispatch<React.SetStateAction<boolean>>;
  newRehearsalMeasure: string;
  setNewRehearsalMeasure: (v: string) => void;
  newRehearsalText: string;
  setNewRehearsalText: (v: string) => void;
}

function FxSlider({ label, min, max, step = 0.01, value, onChange }: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 ml-10">
      <span className="text-[8px] text-[#444] w-16 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 h-0.5 accent-[#8E8E93]" />
      <span className="text-[8px] text-[#444] w-8 text-right">
        {value < 1 ? Math.round(value * 100) + '%' : Number(value.toFixed(2))}
      </span>
    </div>
  );
}

function FxRow({ fxKey, label, fx, onToggle, onWetChange, children }: {
  fxKey: string; label: string;
  fx: { enabled: boolean; wet: number };
  onToggle: () => void;
  onWetChange: (v: number) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1 py-1 border-b border-[#151517] last:border-0">
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className={cn("w-8 h-4 rounded-full transition-colors relative shrink-0 overflow-hidden", fx.enabled ? "bg-[#D4AF37]" : "bg-[#2A2A2D]")}
        >
          <span className={cn("absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm", fx.enabled ? "translate-x-4" : "translate-x-0")} />
        </button>
        <span className={cn("text-[9px] uppercase tracking-wider w-14 shrink-0 font-medium", fx.enabled ? "text-[#D1D1D1]" : "text-[#444]")}>{label}</span>
        <input type="range" min={0} max={100} value={Math.round(fx.wet * 100)}
          onChange={e => onWetChange(Number(e.target.value) / 100)}
          disabled={!fx.enabled}
          className="flex-1 h-0.5 accent-[#D4AF37] disabled:opacity-30" />
        <span className="text-[8px] text-[#444] w-7 text-right">{Math.round(fx.wet * 100)}%</span>
      </div>
      {fx.enabled && children}
    </div>
  );
}

export function LeftSidebarPanel({
  song, setSong,
  activeTrackIndex, setActiveTrackIndex,
  selectedDuration, setSelectedDuration,
  isDotted, setIsDotted,
  isRest, setIsRest,
  tripletMode, setTripletMode,
  graceMode, setGraceMode,
  pendingGrace,
  activeVoice, setActiveVoice,
  selectedDynamic, setSelectedDynamic,
  selectedArticulation, setSelectedArticulation,
  chordSelectMode, setChordSelectMode,
  harmonyMode, setHarmonyMode,
  selectedNoteIds, setSelectedNoteIds,
  clipboard, setClipboard,
  activeNotes, setActiveNotes,
  handleAppendToScore, playMode, lastChord,
  effectsSettings, setEffectsSettings, showEffects, setShowEffects,
  showSidebar, setShowSidebar,
  showTempoChanges, setShowTempoChanges, newTcMeasure, setNewTcMeasure, newTcBpm, setNewTcBpm,
  showRepeats, setShowRepeats, newRepeatMeasure, setNewRepeatMeasure, newRepeatType, setNewRepeatType,
  showVoltas, setShowVoltas, newVoltaStart, setNewVoltaStart, newVoltaEnd, setNewVoltaEnd, newVoltaNumber, setNewVoltaNumber,
  showRehearsalMarks, setShowRehearsalMarks, newRehearsalMeasure, setNewRehearsalMeasure, newRehearsalText, setNewRehearsalText,
}: LeftSidebarPanelProps) {
  const updateFx = <K extends keyof EffectsSettings>(key: K, patch: Partial<EffectsSettings[K]>) =>
    setEffectsSettings(s => ({ ...s, [key]: { ...s[key], ...patch } }));

  return (
    <div className={`shrink-0 border-r border-[#1F1F21] bg-[#0F0F10] flex flex-col z-10 overflow-hidden transition-[width] duration-200 relative ${showSidebar ? 'w-64' : 'w-0'}`}>
      <div className="p-4 flex flex-col flex-1 overflow-y-auto custom-scrollbar">
        <div className="flex justify-end -mt-1 -mr-1 mb-2">
          <button
            onClick={() => setShowSidebar(false)}
            className="text-[#444] hover:text-white text-[10px] rounded hover:bg-[#1A1A1C] px-1.5 py-0.5 transition-colors"
            title="Collapse panel"
          >◀</button>
        </div>
        <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-4">Notation Elements</h2>
        {/* Compound meter info banner */}
        {song.timeSignature[1] === 8 && song.timeSignature[0] % 3 === 0 && (
          <div className="mb-3 px-2 py-1.5 rounded bg-[#1A1A1C] border border-[#2A2A2D] text-[9px] text-[#8E8E93]">
            <span className="text-[#D4AF37] font-bold">{song.timeSignature[0]}/{song.timeSignature[1]}</span>
            {' '}compound — felt beat = dotted ♩ (1.5×).
            Use <span className="text-[#D4AF37]">Dotted</span> + 8th for one beat, + Quarter for a beat‑and‑half.
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 4, label: 'Whole', fraction: '1' },
            { value: 2, label: 'Half', fraction: '1/2' },
            { value: 1, label: 'Quarter', fraction: '1/4' },
            { value: 0.5, label: '8th', fraction: '1/8' },
            { value: 0.25, label: '16th', fraction: '1/16' },
            { value: 0.125, label: '32nd', fraction: '1/32' },
          ].map(dur => (
            <div
              key={dur.value}
              onClick={() => {
                setSelectedDuration(dur.value);
                if (selectedNoteIds.size > 0 && !playMode) {
                  setSong(prev => {
                    let changed = false;
                    const newTracks = prev.tracks.map(t => ({
                      ...t,
                      notes: t.notes.map(n => {
                        if (!selectedNoteIds.has(n.id)) return n;
                        changed = true;
                        let d = dur.value;
                        if (isDotted) d *= 1.5;
                        return { ...n, duration: d, isRest };
                      })
                    }));
                    return changed ? { ...prev, tracks: newTracks } : prev;
                  });
                }
              }}
              className={cn(
                "bg-[#151517] border p-2 flex flex-col items-center justify-center cursor-pointer transition-colors select-none rounded",
                selectedDuration === dur.value ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
              )}
            >
              <span className="font-bold text-sm tracking-widest">{dur.fraction}</span>
              <span className="text-[9px] uppercase tracking-wider opacity-60 mt-1">{dur.label}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-2">
          <div
            onClick={() => {
              const next = !isDotted;
              setIsDotted(next);
              if (selectedNoteIds.size > 0 && !playMode) {
                setSong(prev => ({
                  ...prev,
                  tracks: prev.tracks.map(t => ({
                    ...t,
                    notes: t.notes.map(n => selectedNoteIds.has(n.id)
                      ? { ...n, duration: next ? selectedDuration * 1.5 : selectedDuration }
                      : n)
                  }))
                }));
              }
            }}
            className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
              isDotted ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
            )}
          >Dotted (.)</div>
          <div
            onClick={() => {
              const next = !isRest;
              setIsRest(next);
              if (selectedNoteIds.size > 0 && !playMode) {
                setSong(prev => ({
                  ...prev,
                  tracks: prev.tracks.map(t => ({
                    ...t,
                    notes: t.notes.map(n => selectedNoteIds.has(n.id) ? { ...n, isRest: next } : n)
                  }))
                }));
              }
            }}
            className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
              isRest ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
            )}
          >Rest</div>
          <div
            onClick={() => setTripletMode(v => !v)}
            className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
              tripletMode ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
            )}
          >3:2</div>
          <div
            onClick={() => setGraceMode(v => !v)}
            title={pendingGrace ? `Grace: ${pendingGrace.pitch} captured — press Enter for main note` : 'Grace Note: press Enter to capture grace pitch, then Enter again for main note'}
            className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
              graceMode ? (pendingGrace ? "border-[#4D96FF] text-[#4D96FF]" : "border-[#D4AF37] text-[#D4AF37]") : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
            )}
          >{pendingGrace ? `♩→` : `Grace`}</div>
        </div>

        {/* Voice toggle */}
        <div className="flex gap-2 mt-2">
          <div
            onClick={() => setActiveVoice(1)}
            className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
              activeVoice === 1 ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
            )}
          >Voice 1</div>
          <div
            onClick={() => setActiveVoice(2)}
            className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
              activeVoice === 2 ? "border-[#4D96FF] text-[#4D96FF]" : "border-[#222] hover:border-[#4D96FF] text-[#D1D1D1]"
            )}
          >Voice 2</div>
        </div>

        {/* Dynamics */}
        <div className="mt-4">
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-2">Dynamics</h2>
          <div className="flex flex-wrap gap-1">
            {(['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'] as DynamicMarking[]).map(d => (
              <div
                key={d}
                onClick={() => {
                  const next = selectedDynamic === d ? null : d;
                  setSelectedDynamic(next);
                  if (selectedNoteIds.size > 0 && !playMode) {
                    setSong(prev => ({
                      ...prev,
                      tracks: prev.tracks.map(t => ({
                        ...t,
                        notes: t.notes.map(n => selectedNoteIds.has(n.id) ? { ...n, dynamic: next ?? undefined } : n)
                      }))
                    }));
                  }
                }}
                className={cn(
                  "flex-1 min-w-[28px] bg-[#151517] border p-1 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] font-bold italic",
                  selectedDynamic === d ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                )}
              >{d}</div>
            ))}
          </div>
        </div>

        {/* Articulations */}
        <div className="mt-3">
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-2">Articulation</h2>
          <div className="flex gap-1">
            {([['staccato', '·'], ['accent', '>'], ['tenuto', '—']] as [ArticulationMarking, string][]).map(([a, sym]) => (
              <div
                key={a}
                onClick={() => {
                  const next = selectedArticulation === a ? null : a;
                  setSelectedArticulation(next);
                  if (selectedNoteIds.size > 0 && !playMode) {
                    setSong(prev => ({
                      ...prev,
                      tracks: prev.tracks.map(t => ({
                        ...t,
                        notes: t.notes.map(n => selectedNoteIds.has(n.id) ? { ...n, articulation: next ?? undefined } : n)
                      }))
                    }));
                  }
                }}
                className={cn(
                  "flex-1 bg-[#151517] border p-1.5 flex flex-col items-center justify-center cursor-pointer transition-colors select-none rounded",
                  selectedArticulation === a ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                )}
              >
                <span className="text-base leading-none font-bold">{sym}</span>
                <span className="text-[8px] uppercase tracking-wide mt-0.5 opacity-60">{a}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Hairpins — only in score mode when notes are selected */}
        {!playMode && selectedNoteIds.size > 0 && (() => {
          const selectedNotes = song.tracks.flatMap(t => t.notes).filter(n => selectedNoteIds.has(n.id) && !n.isRest);
          if (selectedNotes.length === 0) return null;
          const minBeat = Math.min(...selectedNotes.map(n => n.start));
          const maxBeat = Math.max(...selectedNotes.map(n => n.start + n.duration));
          const existingHairpin = (song.hairpins ?? []).find(h =>
            Math.abs(h.startBeat - minBeat) < 0.01 && Math.abs(h.endBeat - maxBeat) < 0.01
          );
          const addHairpin = (type: HairpinData['type']) => {
            setSong(prev => {
              const filtered = (prev.hairpins ?? []).filter(h =>
                !(Math.abs(h.startBeat - minBeat) < 0.01 && Math.abs(h.endBeat - maxBeat) < 0.01)
              );
              return { ...prev, hairpins: [...filtered, { id: generateId(), startBeat: minBeat, endBeat: maxBeat, type }] };
            });
          };
          const removeHairpin = () => {
            setSong(prev => ({
              ...prev,
              hairpins: (prev.hairpins ?? []).filter(h =>
                !(Math.abs(h.startBeat - minBeat) < 0.01 && Math.abs(h.endBeat - maxBeat) < 0.01)
              )
            }));
          };
          return (
            <div className="mt-3">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-1.5">Hairpin</h2>
              <div className="flex gap-1 items-center">
                <button
                  onClick={() => addHairpin('cresc')}
                  className={cn("flex-1 bg-[#151517] border p-1.5 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-xs",
                    existingHairpin?.type === 'cresc' ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                  )}
                  title="Crescendo"
                >﹤ cresc</button>
                <button
                  onClick={() => addHairpin('decresc')}
                  className={cn("flex-1 bg-[#151517] border p-1.5 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-xs",
                    existingHairpin?.type === 'decresc' ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                  )}
                  title="Decrescendo"
                >decresc ﹥</button>
                {existingHairpin && (
                  <button
                    onClick={removeHairpin}
                    className="px-1.5 py-1.5 text-red-500 hover:text-red-400 text-[10px] rounded border border-[#222] hover:border-red-800 bg-[#151517] transition-colors"
                    title="Remove hairpin"
                  >✕</button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Slurs — only in score mode when notes are selected */}
        {!playMode && selectedNoteIds.size > 0 && (() => {
          const selectedNotes = song.tracks.flatMap(t => t.notes).filter(n => selectedNoteIds.has(n.id) && !n.isRest);
          if (selectedNotes.length === 0) return null;
          const minBeat = Math.min(...selectedNotes.map(n => n.start));
          const maxBeat = Math.max(...selectedNotes.map(n => n.start + n.duration));
          const existingSlur = (song.slurs ?? []).find(s =>
            s.trackIndex === activeTrackIndex &&
            Math.abs(s.startBeat - minBeat) < 0.01 && Math.abs(s.endBeat - maxBeat) < 0.01
          );
          const addSlur = () => {
            setSong(prev => {
              const filtered = (prev.slurs ?? []).filter(s =>
                !(s.trackIndex === activeTrackIndex && Math.abs(s.startBeat - minBeat) < 0.01 && Math.abs(s.endBeat - maxBeat) < 0.01)
              );
              return { ...prev, slurs: [...filtered, { id: generateId(), startBeat: minBeat, endBeat: maxBeat, trackIndex: activeTrackIndex }] };
            });
          };
          const removeSlur = () => {
            setSong(prev => ({
              ...prev,
              slurs: (prev.slurs ?? []).filter(s =>
                !(s.trackIndex === activeTrackIndex && Math.abs(s.startBeat - minBeat) < 0.01 && Math.abs(s.endBeat - maxBeat) < 0.01)
              )
            }));
          };
          return (
            <div className="mt-3">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-1.5">Slur</h2>
              <div className="flex gap-1 items-center">
                <button
                  onClick={addSlur}
                  className={cn("flex-1 bg-[#151517] border p-1.5 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-xs",
                    existingSlur ? "border-[#88AABB] text-[#88AABB]" : "border-[#222] hover:border-[#88AABB] text-[#D1D1D1]"
                  )}
                  title="Add slur"
                >Slur</button>
                {existingSlur && (
                  <button
                    onClick={removeSlur}
                    className="px-1.5 py-1.5 text-red-500 hover:text-red-400 text-[10px] rounded border border-[#222] hover:border-red-800 bg-[#151517] transition-colors"
                    title="Remove slur"
                  >✕</button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Pedal — only for piano tracks in score mode when notes are selected */}
        {!playMode && selectedNoteIds.size > 0 && song.tracks[activeTrackIndex]?.instrument === 'piano' && (() => {
          const selectedNotes = song.tracks.flatMap(t => t.notes).filter(n => selectedNoteIds.has(n.id) && !n.isRest);
          if (selectedNotes.length === 0) return null;
          const minBeat = Math.min(...selectedNotes.map(n => n.start));
          const maxBeat = Math.max(...selectedNotes.map(n => n.start + n.duration));
          const existingPedal = (song.pedalMarks ?? []).find(p =>
            Math.abs(p.startBeat - minBeat) < 0.01 && Math.abs(p.endBeat - maxBeat) < 0.01
          );
          const addPedal = () => {
            setSong(prev => {
              const filtered = (prev.pedalMarks ?? []).filter(p =>
                !(Math.abs(p.startBeat - minBeat) < 0.01 && Math.abs(p.endBeat - maxBeat) < 0.01)
              );
              return { ...prev, pedalMarks: [...filtered, { id: generateId(), startBeat: minBeat, endBeat: maxBeat }] };
            });
          };
          const removePedal = () => {
            setSong(prev => ({
              ...prev,
              pedalMarks: (prev.pedalMarks ?? []).filter(p =>
                !(Math.abs(p.startBeat - minBeat) < 0.01 && Math.abs(p.endBeat - maxBeat) < 0.01)
              )
            }));
          };
          return (
            <div className="mt-3">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-1.5">Pedal</h2>
              <div className="flex gap-1 items-center">
                <button
                  onClick={addPedal}
                  className={cn("flex-1 bg-[#151517] border p-1.5 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-xs",
                    existingPedal ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                  )}
                  title="Add pedal mark"
                >Ped ↓</button>
                {existingPedal && (
                  <button
                    onClick={removePedal}
                    className="px-1.5 py-1.5 text-red-500 hover:text-red-400 text-[10px] rounded border border-[#222] hover:border-red-800 bg-[#151517] transition-colors"
                    title="Remove pedal mark"
                  >✕</button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Ottava — only in score mode when notes are selected */}
        {!playMode && selectedNoteIds.size > 0 && (() => {
          const selectedNotes = song.tracks.flatMap(t => t.notes).filter(n => selectedNoteIds.has(n.id) && !n.isRest);
          if (selectedNotes.length === 0) return null;
          const minBeat = Math.min(...selectedNotes.map(n => n.start));
          const maxBeat = Math.max(...selectedNotes.map(n => n.start + n.duration));
          const existing8va = (song.ottava ?? []).find(o => o.type === '8va' && Math.abs(o.startBeat - minBeat) < 0.01 && Math.abs(o.endBeat - maxBeat) < 0.01);
          const existing8vb = (song.ottava ?? []).find(o => o.type === '8vb' && Math.abs(o.startBeat - minBeat) < 0.01 && Math.abs(o.endBeat - maxBeat) < 0.01);
          const existingOttava = existing8va ?? existing8vb;
          const addOttava = (type: OttavaData['type']) => {
            setSong(prev => {
              const filtered = (prev.ottava ?? []).filter(o =>
                !(Math.abs(o.startBeat - minBeat) < 0.01 && Math.abs(o.endBeat - maxBeat) < 0.01)
              );
              return { ...prev, ottava: [...filtered, { id: generateId(), startBeat: minBeat, endBeat: maxBeat, type }] };
            });
          };
          const removeOttava = () => {
            setSong(prev => ({
              ...prev,
              ottava: (prev.ottava ?? []).filter(o =>
                !(Math.abs(o.startBeat - minBeat) < 0.01 && Math.abs(o.endBeat - maxBeat) < 0.01)
              )
            }));
          };
          return (
            <div className="mt-3">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-1.5">Ottava</h2>
              <div className="flex gap-1 items-center">
                <button
                  onClick={() => addOttava('8va')}
                  className={cn("flex-1 bg-[#151517] border p-1.5 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-xs",
                    existing8va ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                  )}
                  title="8va (octave up)"
                >8va</button>
                <button
                  onClick={() => addOttava('8vb')}
                  className={cn("flex-1 bg-[#151517] border p-1.5 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-xs",
                    existing8vb ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
                  )}
                  title="8vb (octave down)"
                >8vb</button>
                {existingOttava && (
                  <button
                    onClick={removeOttava}
                    className="px-1.5 py-1.5 text-red-500 hover:text-red-400 text-[10px] rounded border border-[#222] hover:border-red-800 bg-[#151517] transition-colors"
                    title="Remove ottava"
                  >✕</button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Lyric entry — only visible in score mode when notes are selected */}
        {!playMode && selectedNoteIds.size > 0 && (() => {
          const selectedNotes = song.tracks.flatMap(t => t.notes).filter(n => selectedNoteIds.has(n.id) && !n.isRest);
          if (selectedNotes.length === 0) return null;
          const currentLyric = selectedNotes[0].lyric ?? '';
          const beatPos = selectedNotes[0].start;
          return (
            <div className="mt-3">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-1.5">Lyric</h2>
              <input
                type="text"
                value={currentLyric}
                onChange={e => {
                  const lyric = e.target.value || undefined;
                  setSong(prev => ({
                    ...prev,
                    tracks: prev.tracks.map(t => ({
                      ...t,
                      notes: t.notes.map(n => selectedNoteIds.has(n.id) ? { ...n, lyric } : n),
                    }))
                  }));
                }}
                onKeyDown={e => {
                  if (e.key !== ' ' && e.key !== 'Tab') return;
                  e.preventDefault();
                  // Advance selection to next note beat
                  const allNotes = song.tracks.flatMap(t => t.notes)
                    .filter(n => !n.isRest)
                    .sort((a, b) => a.start - b.start);
                  const nextNote = allNotes.find(n => n.start > beatPos + 0.001);
                  if (!nextNote) return;
                  const atBeat = allNotes.filter(n => Math.abs(n.start - nextNote.start) < 0.001);
                  setSelectedNoteIds(new Set(atBeat.map(n => n.id)));
                }}
                placeholder="Type syllable, Space → next note"
                className="w-full bg-[#151517] border border-[#222] focus:border-[#D4AF37] rounded px-2 py-1.5 text-[11px] text-[#D1D1D1] outline-none placeholder-[#333] transition-colors"
              />
              <p className="text-[9px] text-[#333] mt-1">Space or Tab advances to next note</p>
            </div>
          );
        })()}

        {/* Chord Symbol override — only in score mode when notes are selected */}
        {!playMode && selectedNoteIds.size > 0 && (() => {
          const selectedNotes = song.tracks.flatMap(t => t.notes).filter(n => selectedNoteIds.has(n.id) && !n.isRest);
          if (selectedNotes.length === 0) return null;
          const beatPos = Math.min(...selectedNotes.map(n => n.start));
          const key = beatPos.toFixed(3);
          const manualSymbol = song.chordSymbols?.[key] ?? '';
          return (
            <div className="mt-3">
              <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666] mb-1.5">
                Chord Symbol
                {!manualSymbol && <span className="ml-1 text-[#333] normal-case not-italic">(auto)</span>}
              </h2>
              <input
                type="text"
                value={manualSymbol}
                onChange={e => {
                  const val = e.target.value;
                  setSong(prev => {
                    const existing = { ...(prev.chordSymbols ?? {}) };
                    if (val) {
                      existing[key] = val;
                    } else {
                      delete existing[key];
                    }
                    return { ...prev, chordSymbols: existing };
                  });
                }}
                placeholder="e.g. Cmaj7, Am, G/B"
                className="w-full bg-[#151517] border border-[#222] focus:border-[#D4AF37] rounded px-2 py-1.5 text-[11px] text-[#D1D1D1] outline-none placeholder-[#333] transition-colors"
              />
            </div>
          );
        })()}

        <div className="flex gap-2 mt-3">
          <div
            onClick={() => setChordSelectMode(!chordSelectMode)}
            className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
              chordSelectMode ? "border-[#D4AF37] text-[#D4AF37]" : "border-[#222] hover:border-[#D4AF37] text-[#D1D1D1]"
            )}
          >Select Chords</div>
          <div
            onClick={() => setHarmonyMode(!harmonyMode)}
            className={cn("flex-1 bg-[#151517] border p-2 flex items-center justify-center cursor-pointer transition-colors select-none rounded text-[10px] uppercase tracking-wider font-bold",
              harmonyMode ? "border-[#A78BFA] text-[#A78BFA]" : "border-[#222] hover:border-[#A78BFA] text-[#D1D1D1]"
            )}
          >Add Harmony</div>
        </div>

        {/* Copy / Paste */}
        {selectedNoteIds.size > 0 && (
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                const items: { note: NoteData; trackId: string }[] = [];
                song.tracks.forEach(t => t.notes.forEach(n => {
                  if (selectedNoteIds.has(n.id)) items.push({ note: n, trackId: t.id });
                }));
                if (items.length > 0) {
                  const minStart = Math.min(...items.map(i => i.note.start));
                  setClipboard({
                    notes: items.map(i => ({ ...i.note, start: i.note.start - minStart })),
                    trackIds: items.map(i => i.trackId)
                  });
                }
              }}
              className="flex-1 flex items-center justify-center gap-1 bg-[#151517] border border-[#222] hover:border-[#D4AF37] rounded p-2 text-[10px] uppercase tracking-wider font-bold text-[#D1D1D1] hover:text-[#D4AF37] cursor-pointer transition-colors"
            >
              <Copy className="w-3 h-3" /> Copy
            </button>
            {clipboard && (
              <button
                onClick={() => {
                  let pasteStart = 0;
                  song.tracks.forEach(t => t.notes.forEach(n => {
                    if (n.start + n.duration > pasteStart) pasteStart = n.start + n.duration;
                  }));
                  const pasted = clipboard.notes.map((n, i) => ({
                    note: { ...n, id: generateId(), start: pasteStart + n.start },
                    trackId: clipboard.trackIds[i]
                  }));
                  setSong({
                    ...song,
                    tracks: song.tracks.map(t => ({
                      ...t,
                      notes: [...t.notes, ...pasted.filter(p => p.trackId === t.id).map(p => p.note)]
                    }))
                  });
                  setSelectedNoteIds(new Set(pasted.map(p => p.note.id)));
                }}
                className="flex-1 flex items-center justify-center gap-1 bg-[#151517] border border-[#222] hover:border-[#D4AF37] rounded p-2 text-[10px] uppercase tracking-wider font-bold text-[#D1D1D1] hover:text-[#D4AF37] cursor-pointer transition-colors"
              >
                Paste
              </button>
            )}
          </div>
        )}

        {/* Active Notes */}
        <div className="mt-6">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Active Notes</h2>
            {activeNotes.size > 0 && (
              <button
                onClick={() => { activeNotes.forEach(p => audio.stopNoteRealtime(p)); setActiveNotes(new Set()); }}
                className="text-[10px] text-red-500 hover:text-red-400 uppercase tracking-wider font-bold"
              >Clear</button>
            )}
          </div>
          <div className="bg-[#151517] rounded border border-[#222] p-2 flex flex-wrap gap-1">
            {activeNotes.size > 0 ? Array.from(activeNotes).map(n => (
              <span key={n} className="text-[10px] text-[#D4AF37] font-mono py-1 px-1.5 bg-[#050506] border border-[#222] rounded">{n}</span>
            )) : (
              <span className="text-[10px] text-[#555] uppercase p-1">None</span>
            )}
          </div>
        </div>

        {(activeNotes.size > 0 || isRest || (lastChord !== null && !playMode)) && (
          <button
            onClick={handleAppendToScore}
            className="w-full mt-4 bg-[#D4AF37] hover:bg-[#C19E30] text-[#0A0A0B] font-bold uppercase tracking-wider text-[10px] py-2 flex items-center justify-center rounded transition-colors"
          >
            {activeNotes.size > 0 || isRest ? 'Add to Score (Enter)' : 'Repeat Last (Enter)'}
          </button>
        )}
      </div>

      {/* Instruments */}
      <div className="p-4 border-t border-[#1F1F21] flex flex-col shrink-0 max-h-48">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Instruments</h2>
          <button
            className="p-1 hover:text-[#D4AF37] hover:bg-[#1A1A1C] rounded text-[#8E8E93] transition-colors"
            onClick={() => {
              setSong(s => {
                const num = s.tracks.length + 1;
                const color = TRACK_COLORS[s.tracks.length % TRACK_COLORS.length];
                return { ...s, tracks: [...s.tracks, { id: generateId(), name: `Track ${num}`, instrument: 'piano' as InstrumentPreset, notes: [], color }] };
              });
              setActiveTrackIndex(song.tracks.length);
            }}
            title="Add Track"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        <div className="space-y-2 overflow-y-auto custom-scrollbar flex-1 min-h-0">
          {song.tracks.map((track, i) => (
            <div
              key={track.id}
              onClick={() => setActiveTrackIndex(i)}
              className={cn(
                "group relative rounded px-2 py-1.5 transition-colors border-l-2 cursor-pointer",
                i === activeTrackIndex ? "bg-[#1A1A1C]" : "border-transparent hover:bg-[#151517]"
              )}
              style={{ borderLeftColor: i === activeTrackIndex ? (track.color ?? '#D4AF37') : 'transparent' }}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: track.color ?? '#D4AF37' }} />
                  <input
                    value={track.name}
                    onChange={e => {
                      const newTracks = [...song.tracks];
                      newTracks[i] = { ...track, name: e.target.value };
                      setSong({ ...song, tracks: newTracks });
                    }}
                    onClick={e => e.stopPropagation()}
                    className="bg-transparent border-none outline-none focus:ring-0 text-xs w-24 truncate text-inherit"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-[#555] group-hover:hidden">{track.notes.length}n</span>
                  <button
                    className="hidden group-hover:block text-red-400 hover:text-red-500 p-0.5 rounded"
                    onClick={e => { e.stopPropagation(); if (song.tracks.length > 1) { setSong(s => ({ ...s, tracks: s.tracks.filter(t => t.id !== track.id) })); setActiveTrackIndex(a => Math.min(a, song.tracks.length - 2)); } }}
                    title="Remove"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
              </div>
              <select
                value={track.instrument}
                onChange={e => {
                  const newPreset = e.target.value as InstrumentPreset;
                  const newTracks = [...song.tracks];
                  newTracks[i] = { ...track, instrument: newPreset };
                  setSong({ ...song, tracks: newTracks });
                }}
                className="mt-0.5 w-full bg-[#0F0F10] border border-[#222] rounded text-[10px] text-[#8E8E93] px-1 py-0.5 outline-none cursor-pointer"
              >
                {Object.entries(INSTRUMENT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button
                onClick={e => { e.stopPropagation(); const nt = [...song.tracks]; nt[i] = { ...track, grandStaff: !track.grandStaff }; setSong({ ...song, tracks: nt }); }}
                className={cn("mt-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors cursor-pointer",
                  track.grandStaff ? "border-[#D4AF37] text-[#D4AF37] bg-[#D4AF37]/10" : "border-[#222] text-[#555] hover:border-[#555] hover:text-[#8E8E93]"
                )}
                title="Toggle Grand Staff (treble + bass clef)"
              >Grand Staff</button>
              {/* Volume / Mute / Solo */}
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="text-[8px] text-[#444] shrink-0">Vol</span>
                <input
                  type="range" min={0} max={100}
                  value={Math.round((track.volume ?? 1) * 100)}
                  onChange={e => { const nt = [...song.tracks]; nt[i] = { ...track, volume: Number(e.target.value) / 100 }; setSong({ ...song, tracks: nt }); }}
                  className="flex-1 h-0.5 accent-[#D4AF37]"
                />
                <button
                  onClick={e => { e.stopPropagation(); const nt = [...song.tracks]; nt[i] = { ...track, muted: !track.muted }; setSong({ ...song, tracks: nt }); }}
                  className={cn("text-[8px] px-1.5 py-0.5 rounded border font-bold transition-colors", track.muted ? "border-[#D4AF37] text-[#D4AF37] bg-[#D4AF37]/10" : "border-[#222] text-[#555] hover:border-[#555] hover:text-[#8E8E93]")}
                  title="Mute"
                >M</button>
                <button
                  onClick={e => { e.stopPropagation(); const nt = [...song.tracks]; nt[i] = { ...track, solo: !track.solo }; setSong({ ...song, tracks: nt }); }}
                  className={cn("text-[8px] px-1.5 py-0.5 rounded border font-bold transition-colors", track.solo ? "border-[#4488FF] text-[#4488FF] bg-[#4488FF]/10" : "border-[#222] text-[#555] hover:border-[#555] hover:text-[#8E8E93]")}
                  title="Solo"
                >S</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Effects Chain */}
      <div className="border-t border-[#1F1F21] shrink-0">
        <div className="px-4 pt-3 pb-2">
          <button
            className="flex justify-between items-center w-full"
            onClick={() => setShowEffects(v => !v)}
          >
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Effects Chain</h2>
            <span className="text-[#555] text-[10px]">{showEffects ? '▲' : '▼'}</span>
          </button>
        </div>
        {showEffects && (
          <div className="px-4 pb-3 max-h-72 overflow-y-auto custom-scrollbar">
            <FxRow fxKey="reverb" label="Reverb" fx={effectsSettings.reverb}
              onToggle={() => updateFx('reverb', { enabled: !effectsSettings.reverb.enabled })}
              onWetChange={v => updateFx('reverb', { wet: v })}>
              <FxSlider label="Room" min={0} max={1} value={effectsSettings.reverb.roomSize} onChange={v => updateFx('reverb', { roomSize: v })} />
            </FxRow>
            <FxRow fxKey="delay" label="Delay" fx={effectsSettings.delay}
              onToggle={() => updateFx('delay', { enabled: !effectsSettings.delay.enabled })}
              onWetChange={v => updateFx('delay', { wet: v })}>
              <FxSlider label="Time" min={0.05} max={1} value={effectsSettings.delay.time} onChange={v => updateFx('delay', { time: v })} />
              <FxSlider label="Feedback" min={0} max={0.95} value={effectsSettings.delay.feedback} onChange={v => updateFx('delay', { feedback: v })} />
            </FxRow>
            <FxRow fxKey="chorus" label="Chorus" fx={effectsSettings.chorus}
              onToggle={() => updateFx('chorus', { enabled: !effectsSettings.chorus.enabled })}
              onWetChange={v => updateFx('chorus', { wet: v })}>
              <FxSlider label="Depth" min={0} max={1} value={effectsSettings.chorus.depth} onChange={v => updateFx('chorus', { depth: v })} />
              <FxSlider label="Rate" min={0.1} max={8} value={effectsSettings.chorus.frequency} onChange={v => updateFx('chorus', { frequency: v })} />
            </FxRow>
            <FxRow fxKey="flanger" label="Flanger" fx={effectsSettings.flanger}
              onToggle={() => updateFx('flanger', { enabled: !effectsSettings.flanger.enabled })}
              onWetChange={v => updateFx('flanger', { wet: v })}>
              <FxSlider label="Depth" min={0} max={1} value={effectsSettings.flanger.depth} onChange={v => updateFx('flanger', { depth: v })} />
              <FxSlider label="Rate" min={0.05} max={4} value={effectsSettings.flanger.frequency} onChange={v => updateFx('flanger', { frequency: v })} />
            </FxRow>
            <FxRow fxKey="phaser" label="Phaser" fx={effectsSettings.phaser}
              onToggle={() => updateFx('phaser', { enabled: !effectsSettings.phaser.enabled })}
              onWetChange={v => updateFx('phaser', { wet: v })}>
              <FxSlider label="Rate" min={0.05} max={4} value={effectsSettings.phaser.frequency} onChange={v => updateFx('phaser', { frequency: v })} />
            </FxRow>
            <FxRow fxKey="tremolo" label="Tremolo" fx={effectsSettings.tremolo}
              onToggle={() => updateFx('tremolo', { enabled: !effectsSettings.tremolo.enabled })}
              onWetChange={v => updateFx('tremolo', { wet: v })}>
              <FxSlider label="Rate" min={0.5} max={20} value={effectsSettings.tremolo.frequency} onChange={v => updateFx('tremolo', { frequency: v })} />
              <FxSlider label="Depth" min={0} max={1} value={effectsSettings.tremolo.depth} onChange={v => updateFx('tremolo', { depth: v })} />
            </FxRow>
            <FxRow fxKey="overdrive" label="Overdrive" fx={effectsSettings.overdrive}
              onToggle={() => updateFx('overdrive', { enabled: !effectsSettings.overdrive.enabled })}
              onWetChange={v => updateFx('overdrive', { wet: v })}>
              <FxSlider label="Drive" min={0} max={1} value={effectsSettings.overdrive.amount} onChange={v => updateFx('overdrive', { amount: v })} />
            </FxRow>
            <FxRow fxKey="fuzz" label="Fuzz" fx={effectsSettings.fuzz}
              onToggle={() => updateFx('fuzz', { enabled: !effectsSettings.fuzz.enabled })}
              onWetChange={v => updateFx('fuzz', { wet: v })}>
              <FxSlider label="Order" min={1} max={100} step={1} value={effectsSettings.fuzz.order} onChange={v => updateFx('fuzz', { order: Math.round(v) })} />
            </FxRow>
          </div>
        )}
      </div>

      {/* Tempo Changes */}
      <div className="border-t border-[#1F1F21] shrink-0">
        <div className="px-4 pt-3 pb-2">
          <button className="flex justify-between items-center w-full" onClick={() => setShowTempoChanges(v => !v)}>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Tempo Changes</h2>
            <span className="text-[#555] text-[10px]">{showTempoChanges ? '▲' : '▼'}</span>
          </button>
        </div>
        {showTempoChanges && (
          <div className="px-4 pb-3 space-y-2">
            {(song.tempoChanges ?? []).length === 0 && (
              <p className="text-[9px] text-[#444] italic">No tempo changes added.</p>
            )}
            {(song.tempoChanges ?? []).sort((a, b) => a.beat - b.beat).map((tc, idx) => {
              const measure = Math.floor(tc.beat / song.timeSignature[0]) + 1;
              return (
                <div key={idx} className="flex items-center justify-between gap-2 text-[9px] text-[#8E8E93]">
                  <span>M{measure} → <span className="text-[#D4AF37] font-bold">{Math.round(tc.bpm)} BPM</span></span>
                  <button
                    onClick={() => setSong(s => ({ ...s, tempoChanges: (s.tempoChanges ?? []).filter((_, i) => i !== idx) }))}
                    className="text-red-500 hover:text-red-400 px-1"
                  >✕</button>
                </div>
              );
            })}
            <div className="flex items-center gap-1 pt-1 border-t border-[#151517]">
              <span className="text-[8px] text-[#444] shrink-0">M</span>
              <input
                type="number" min={1} value={newTcMeasure}
                onChange={e => setNewTcMeasure(e.target.value)}
                className="w-10 bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none"
              />
              <input
                type="number" min={20} max={300} value={newTcBpm}
                onChange={e => setNewTcBpm(e.target.value)}
                className="w-12 bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none"
                placeholder="BPM"
              />
              <span className="text-[8px] text-[#444] shrink-0">BPM</span>
              <button
                onClick={() => {
                  const measure = Math.max(1, parseInt(newTcMeasure) || 1);
                  const bpm = Math.max(20, Math.min(300, parseInt(newTcBpm) || 120));
                  const beat = (measure - 1) * song.timeSignature[0];
                  setSong(s => ({
                    ...s,
                    tempoChanges: [...(s.tempoChanges ?? []).filter(tc => tc.beat !== beat), { beat, bpm }]
                      .sort((a, b) => a.beat - b.beat)
                  }));
                }}
                className="ml-auto text-[9px] px-2 py-0.5 rounded bg-[#1A1A1C] border border-[#2A2A2D] text-[#8E8E93] hover:text-white hover:border-[#444] transition-colors"
              >Add</button>
            </div>
          </div>
        )}
      </div>

      {/* Repeat Signs */}
      <div className="border-t border-[#1F1F21] shrink-0">
        <div className="px-4 pt-3 pb-2">
          <button className="flex justify-between items-center w-full" onClick={() => setShowRepeats(v => !v)}>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Repeat Signs</h2>
            <span className="text-[#555] text-[10px]">{showRepeats ? '▲' : '▼'}</span>
          </button>
        </div>
        {showRepeats && (
          <div className="px-4 pb-3 space-y-2">
            {(song.repeats ?? []).length === 0 && (
              <p className="text-[9px] text-[#444] italic">No repeat signs added.</p>
            )}
            {(song.repeats ?? []).sort((a, b) => a.measure - b.measure || (a.type === 'start' ? -1 : 1)).map((r, idx) => (
              <div key={idx} className="flex items-center justify-between gap-2 text-[9px] text-[#8E8E93]">
                <span>M{r.measure} <span className={r.type === 'start' ? 'text-[#4488FF]' : 'text-[#D4AF37]'}>
                  {r.type === 'start' ? '|:' : ':|'}
                </span></span>
                <button
                  onClick={() => setSong(s => ({ ...s, repeats: (s.repeats ?? []).filter((_, i) => i !== idx) }))}
                  className="text-red-500 hover:text-red-400 px-1"
                >✕</button>
              </div>
            ))}
            <div className="flex items-center gap-1 pt-1 border-t border-[#151517]">
              <span className="text-[8px] text-[#444] shrink-0">M</span>
              <input
                type="number" min={1} value={newRepeatMeasure}
                onChange={e => setNewRepeatMeasure(e.target.value)}
                className="w-10 bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none"
              />
              <select
                value={newRepeatType}
                onChange={e => setNewRepeatType(e.target.value as 'start' | 'end')}
                className="bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none cursor-pointer"
              >
                <option value="start">Start (|:)</option>
                <option value="end">End (:|)</option>
              </select>
              <button
                onClick={() => {
                  const measure = Math.max(1, parseInt(newRepeatMeasure) || 1);
                  setSong(s => ({
                    ...s,
                    repeats: [...(s.repeats ?? []).filter(r => !(r.measure === measure && r.type === newRepeatType)), { measure, type: newRepeatType }]
                      .sort((a, b) => a.measure - b.measure)
                  }));
                }}
                className="ml-auto text-[9px] px-2 py-0.5 rounded bg-[#1A1A1C] border border-[#2A2A2D] text-[#8E8E93] hover:text-white hover:border-[#444] transition-colors"
              >Add</button>
            </div>
          </div>
        )}
      </div>

      {/* Volta Brackets */}
      <div className="border-t border-[#1F1F21] shrink-0">
        <div className="px-4 pt-3 pb-2">
          <button className="flex justify-between items-center w-full" onClick={() => setShowVoltas(v => !v)}>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Volta Brackets</h2>
            <span className="text-[#555] text-[10px]">{showVoltas ? '▲' : '▼'}</span>
          </button>
        </div>
        {showVoltas && (
          <div className="px-4 pb-3 space-y-2">
            {(song.voltas ?? []).length === 0 && (
              <p className="text-[9px] text-[#444] italic">No volta brackets added.</p>
            )}
            {(song.voltas ?? []).sort((a, b) => a.startMeasure - b.startMeasure).map((v, idx) => (
              <div key={v.id} className="flex items-center justify-between gap-2 text-[9px] text-[#8E8E93]">
                <span>
                  <span className="text-[#D4AF37]">{v.number}.</span>
                  {' '}M{v.startMeasure + 1}–M{v.endMeasure + 1}
                </span>
                <button
                  onClick={() => setSong(s => ({ ...s, voltas: (s.voltas ?? []).filter((_, i) => i !== idx) }))}
                  className="text-red-500 hover:text-red-400 px-1"
                >✕</button>
              </div>
            ))}
            <div className="flex items-center gap-1 pt-1 border-t border-[#151517] flex-wrap">
              <span className="text-[8px] text-[#444] shrink-0">M</span>
              <input
                type="number" min={1} value={newVoltaStart}
                onChange={e => setNewVoltaStart(e.target.value)}
                className="w-10 bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none"
              />
              <span className="text-[8px] text-[#444] shrink-0">–</span>
              <input
                type="number" min={1} value={newVoltaEnd}
                onChange={e => setNewVoltaEnd(e.target.value)}
                className="w-10 bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none"
              />
              <select
                value={newVoltaNumber}
                onChange={e => setNewVoltaNumber(Number(e.target.value) as 1 | 2 | 3)}
                className="bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none cursor-pointer"
              >
                <option value={1}>1st</option>
                <option value={2}>2nd</option>
                <option value={3}>3rd</option>
              </select>
              <button
                onClick={() => {
                  const start = Math.max(0, (parseInt(newVoltaStart) || 1) - 1);
                  const end = Math.max(start, (parseInt(newVoltaEnd) || 1) - 1);
                  setSong(s => ({
                    ...s,
                    voltas: [...(s.voltas ?? []), { id: generateId(), startMeasure: start, endMeasure: end, number: newVoltaNumber }]
                      .sort((a, b) => a.startMeasure - b.startMeasure)
                  }));
                }}
                className="ml-auto text-[9px] px-2 py-0.5 rounded bg-[#1A1A1C] border border-[#2A2A2D] text-[#8E8E93] hover:text-white hover:border-[#444] transition-colors"
              >Add</button>
            </div>
          </div>
        )}
      </div>

      {/* Rehearsal Marks */}
      <div className="border-t border-[#1F1F21] shrink-0">
        <div className="px-4 pt-3 pb-2">
          <button className="flex justify-between items-center w-full" onClick={() => setShowRehearsalMarks(v => !v)}>
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Rehearsal Marks</h2>
            <span className="text-[#555] text-[10px]">{showRehearsalMarks ? '▲' : '▼'}</span>
          </button>
        </div>
        {showRehearsalMarks && (
          <div className="px-4 pb-3 space-y-2">
            {(song.rehearsalMarks ?? []).length === 0 && (
              <p className="text-[9px] text-[#444] italic">No rehearsal marks added.</p>
            )}
            {(song.rehearsalMarks ?? []).sort((a, b) => a.measure - b.measure).map((rm, idx) => (
              <div key={rm.id} className="flex items-center justify-between gap-2 text-[9px] text-[#8E8E93]">
                <span>M{rm.measure} <span className="text-[#E8E8F0] font-bold font-mono">[{rm.text}]</span></span>
                <button
                  onClick={() => setSong(s => ({ ...s, rehearsalMarks: (s.rehearsalMarks ?? []).filter((_, i) => i !== idx) }))}
                  className="text-red-500 hover:text-red-400 px-1"
                >✕</button>
              </div>
            ))}
            <div className="flex items-center gap-1 pt-1 border-t border-[#151517]">
              <span className="text-[8px] text-[#444] shrink-0">M</span>
              <input
                type="number" min={1} value={newRehearsalMeasure}
                onChange={e => setNewRehearsalMeasure(e.target.value)}
                className="w-10 bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none"
              />
              <input
                type="text" value={newRehearsalText}
                onChange={e => setNewRehearsalText(e.target.value)}
                placeholder="A, Verse…"
                className="flex-1 bg-[#0F0F10] border border-[#222] rounded text-[9px] text-[#8E8E93] px-1 py-0.5 outline-none"
              />
              <button
                onClick={() => {
                  const measure = Math.max(1, parseInt(newRehearsalMeasure) || 1);
                  const text = newRehearsalText.trim();
                  if (!text) return;
                  setSong(s => ({
                    ...s,
                    rehearsalMarks: [...(s.rehearsalMarks ?? []).filter(rm => rm.measure !== measure), { id: generateId(), measure, text }]
                      .sort((a, b) => a.measure - b.measure)
                  }));
                }}
                className="ml-auto text-[9px] px-2 py-0.5 rounded bg-[#1A1A1C] border border-[#2A2A2D] text-[#8E8E93] hover:text-white hover:border-[#444] transition-colors"
              >Add</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
