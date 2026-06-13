import React, { useState } from 'react';
import { SongData, TrackData, InstrumentPreset } from '../types';
import { generateId, cn } from '../lib/utils';
import { TRACK_COLORS, KEY_SIGNATURES } from '../lib/constants';

interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  defaultTitle: string;
  defaultTempo: number;
  defaultTimeSig: [number, number];
  tracks: Array<{ name: string; instrument: InstrumentPreset }>;
  staffPreview: string; // short text depicting staves
}

const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'blank',
    name: 'Blank Score',
    description: 'Single instrument, empty canvas.',
    defaultTitle: 'Untitled',
    defaultTempo: 120,
    defaultTimeSig: [4, 4],
    tracks: [{ name: 'Piano', instrument: 'piano' }],
    staffPreview: '———————',
  },
  {
    id: 'lead-sheet',
    name: 'Lead Sheet',
    description: 'Melody line with chord symbols above.',
    defaultTitle: 'Lead Sheet',
    defaultTempo: 100,
    defaultTimeSig: [4, 4],
    tracks: [{ name: 'Melody', instrument: 'piano' }],
    staffPreview: '♩ ♩ ♩ ♩',
  },
  {
    id: 'grand-staff',
    name: 'Piano (Grand Staff)',
    description: 'Treble and bass staves for piano.',
    defaultTitle: 'Piano Piece',
    defaultTempo: 100,
    defaultTimeSig: [4, 4],
    tracks: [
      { name: 'Piano (Treble)', instrument: 'piano' },
      { name: 'Piano (Bass)', instrument: 'piano' },
    ],
    staffPreview: '═══════\n———————',
  },
  {
    id: 'string-quartet',
    name: 'String Quartet',
    description: 'Violin I & II, Viola, Cello.',
    defaultTitle: 'String Quartet',
    defaultTempo: 120,
    defaultTimeSig: [4, 4],
    tracks: [
      { name: 'Violin I', instrument: 'strings' },
      { name: 'Violin II', instrument: 'strings' },
      { name: 'Viola', instrument: 'strings' },
      { name: 'Cello', instrument: 'strings' },
    ],
    staffPreview: '— Vln I\n— Vln II\n— Vla\n— Vc',
  },
  {
    id: 'pop-band',
    name: 'Pop Band',
    description: 'Piano, guitar, bass, and strings.',
    defaultTitle: 'Pop Song',
    defaultTempo: 120,
    defaultTimeSig: [4, 4],
    tracks: [
      { name: 'Piano', instrument: 'piano' },
      { name: 'Guitar', instrument: 'guitar' },
      { name: 'Bass', instrument: 'bass' },
      { name: 'Strings', instrument: 'strings' },
    ],
    staffPreview: '— Keys\n— Guitar\n— Bass\n— Strings',
  },
  {
    id: 'jazz-trio',
    name: 'Jazz Trio',
    description: 'Piano and bass in waltz time.',
    defaultTitle: 'Jazz Waltz',
    defaultTempo: 160,
    defaultTimeSig: [3, 4],
    tracks: [
      { name: 'Piano', instrument: 'piano' },
      { name: 'Bass', instrument: 'bass' },
    ],
    staffPreview: '3/4 ♩ ♩ ♩\n——————',
  },
];

interface Props {
  onClose: () => void;
  onCreate: (song: SongData) => void;
}

export function TemplatePickerModal({ onClose, onCreate }: Props) {
  const [selected, setSelected] = useState<string>('blank');
  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [tempo, setTempo] = useState<string>('');
  const [timeSigTop, setTimeSigTop] = useState<string>('');
  const [timeSigBottom, setTimeSigBottom] = useState<string>('');
  const [keySignature, setKeySignature] = useState<string>('C');

  const tpl = TEMPLATES.find(t => t.id === selected)!;

  const handleCreate = () => {
    const resolvedTitle = title.trim() || tpl.defaultTitle;
    const resolvedTempo = parseInt(tempo) || tpl.defaultTempo;
    const resolvedTop = parseInt(timeSigTop) || tpl.defaultTimeSig[0];
    const resolvedBottom = parseInt(timeSigBottom) || tpl.defaultTimeSig[1];

    const tracks: TrackData[] = tpl.tracks.map((t, i) => ({
      id: generateId(),
      name: t.name,
      instrument: t.instrument,
      notes: [],
      color: TRACK_COLORS[i % TRACK_COLORS.length],
    }));

    const song: SongData = {
      title: resolvedTitle,
      composer: composer.trim() || undefined,
      tempo: Math.max(20, Math.min(300, resolvedTempo)),
      timeSignature: [Math.max(1, Math.min(12, resolvedTop)), resolvedBottom],
      keySignature,
      tracks,
    };

    onCreate(song);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#0F0F10] border border-[#2A2A2D] rounded-lg shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#1F1F21] shrink-0">
          <span className="text-[13px] font-bold uppercase tracking-widest text-[#D1D1D1]">New Score</span>
          <button
            onClick={onClose}
            className="text-[#555] hover:text-[#D1D1D1] text-lg leading-none transition-colors"
          >×</button>
        </div>

        {/* Template Grid */}
        <div className="px-6 pt-5 pb-2">
          <p className="text-[10px] uppercase tracking-widest text-[#555] mb-3">Choose a template</p>
          <div className="grid grid-cols-3 gap-3">
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => {
                  setSelected(t.id);
                  setTempo(String(t.defaultTempo));
                  setTimeSigTop(String(t.defaultTimeSig[0]));
                  setTimeSigBottom(String(t.defaultTimeSig[1]));
                }}
                className={cn(
                  'text-left p-3 rounded border transition-colors group',
                  selected === t.id
                    ? 'border-[#D4AF37] bg-[#D4AF37]/10'
                    : 'border-[#2A2A2D] hover:border-[#3A3A3D] bg-[#111113]',
                )}
              >
                {/* Staff preview */}
                <div className="font-mono text-[9px] whitespace-pre leading-tight mb-2 text-[#555] group-hover:text-[#888] min-h-[2.5rem]"
                  style={{ color: selected === t.id ? '#D4AF3799' : undefined }}>
                  {t.staffPreview}
                </div>
                <div className={cn('text-[11px] font-bold mb-0.5', selected === t.id ? 'text-[#D4AF37]' : 'text-[#C8C8D0]')}>
                  {t.name}
                </div>
                <div className="text-[10px] text-[#555] leading-snug">{t.description}</div>
                {/* Track pills */}
                <div className="flex flex-wrap gap-1 mt-2">
                  {t.tracks.map((tr, i) => (
                    <span
                      key={i}
                      className="text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wide font-bold"
                      style={{
                        backgroundColor: `${TRACK_COLORS[i % TRACK_COLORS.length]}22`,
                        color: TRACK_COLORS[i % TRACK_COLORS.length],
                      }}
                    >{tr.name}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Settings */}
        <div className="px-6 pt-4 pb-5 border-t border-[#1F1F21] mt-4">
          <p className="text-[10px] uppercase tracking-widest text-[#555] mb-3">Settings <span className="normal-case text-[#333]">(optional — leave blank to use template defaults)</span></p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest text-[#555]">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={tpl.defaultTitle}
                className="bg-[#1A1A1C] border border-[#2A2A2D] rounded px-2 py-1 text-[11px] text-[#D1D1D1] outline-none focus:border-[#D4AF37] placeholder-[#333]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest text-[#555]">Composer</label>
              <input
                type="text"
                value={composer}
                onChange={e => setComposer(e.target.value)}
                placeholder="Optional"
                className="bg-[#1A1A1C] border border-[#2A2A2D] rounded px-2 py-1 text-[11px] text-[#D1D1D1] outline-none focus:border-[#D4AF37] placeholder-[#333]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest text-[#555]">Tempo (BPM)</label>
              <input
                type="number"
                value={tempo}
                onChange={e => setTempo(e.target.value)}
                placeholder={String(tpl.defaultTempo)}
                min={20} max={300}
                className="bg-[#1A1A1C] border border-[#2A2A2D] rounded px-2 py-1 text-[11px] text-[#D1D1D1] outline-none focus:border-[#D4AF37] placeholder-[#333]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest text-[#555]">Key</label>
              <select
                value={keySignature}
                onChange={e => setKeySignature(e.target.value)}
                className="bg-[#1A1A1C] border border-[#2A2A2D] rounded px-2 py-1 text-[11px] text-[#D1D1D1] outline-none focus:border-[#D4AF37] cursor-pointer"
              >
                {KEY_SIGNATURES.map(k => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest text-[#555]">Time Signature</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={timeSigTop}
                  onChange={e => setTimeSigTop(e.target.value)}
                  placeholder={String(tpl.defaultTimeSig[0])}
                  min={1} max={12}
                  className="w-16 bg-[#1A1A1C] border border-[#2A2A2D] rounded px-2 py-1 text-[11px] text-[#D1D1D1] outline-none focus:border-[#D4AF37] placeholder-[#333]"
                />
                <span className="text-[#555] text-[13px]">/</span>
                <select
                  value={timeSigBottom}
                  onChange={e => setTimeSigBottom(e.target.value)}
                  className="w-16 bg-[#1A1A1C] border border-[#2A2A2D] rounded px-2 py-1 text-[11px] text-[#D1D1D1] outline-none focus:border-[#D4AF37] cursor-pointer"
                >
                  {['2', '4', '8', '16'].map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 pb-5 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[11px] uppercase tracking-widest text-[#8E8E93] hover:text-[#D1D1D1] border border-[#2A2A2D] hover:border-[#3A3A3D] rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="px-5 py-2 text-[11px] uppercase tracking-widest font-bold bg-[#D4AF37] hover:bg-[#C19E30] text-[#0A0A0B] rounded transition-colors"
          >
            Create Score
          </button>
        </div>
      </div>
    </div>
  );
}
