import { useReducer, useCallback } from 'react';
import { SongData, NoteData } from '../types';
import { DEFAULT_SONG } from '../lib/constants';

type TrackHistory = { past: NoteData[][], future: NoteData[][] };

export type HistoryState = {
  past: SongData[];
  present: SongData;
  future: SongData[];
  trackHistories: Record<string, TrackHistory>;
};

export type HistoryAction =
  | { type: 'SET'; payload: SongData | ((s: SongData) => SongData) }
  | { type: 'SET_TRACK_NOTES'; trackId: string; notes: NoteData[] | ((prev: NoteData[]) => NoteData[]) }
  | { type: 'PATCH_META'; payload: { title?: string; composer?: string } }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'UNDO_TRACK'; trackId: string }
  | { type: 'REDO_TRACK'; trackId: string };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'SET': {
      const next = typeof action.payload === 'function' ? action.payload(state.present) : action.payload;
      if (next === state.present) return state;
      return {
        ...state,
        past: [...state.past.slice(-49), state.present],
        present: next,
        future: []
      };
    }
    case 'SET_TRACK_NOTES': {
      const trackIdx = state.present.tracks.findIndex(t => t.id === action.trackId);
      if (trackIdx === -1) return state;
      const prevNotes = state.present.tracks[trackIdx].notes;
      const nextNotes = typeof action.notes === 'function' ? action.notes(prevNotes) : action.notes;
      if (nextNotes === prevNotes) return state;
      const newTracks = [...state.present.tracks];
      newTracks[trackIdx] = { ...newTracks[trackIdx], notes: nextNotes };
      const prevHistory = state.trackHistories[action.trackId] ?? { past: [], future: [] };
      return {
        ...state,
        present: { ...state.present, tracks: newTracks },
        trackHistories: {
          ...state.trackHistories,
          [action.trackId]: { past: [...prevHistory.past.slice(-49), prevNotes], future: [] }
        }
      };
    }
    case 'PATCH_META':
      return { ...state, present: { ...state.present, ...action.payload } };
    case 'UNDO':
      if (state.past.length === 0) return state;
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future]
      };
    case 'REDO':
      if (state.future.length === 0) return state;
      return {
        ...state,
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1)
      };
    case 'UNDO_TRACK': {
      const history = state.trackHistories[action.trackId];
      if (!history || history.past.length === 0) return state;
      const trackIdx = state.present.tracks.findIndex(t => t.id === action.trackId);
      if (trackIdx === -1) return state;
      const prevNotes = history.past[history.past.length - 1];
      const currentNotes = state.present.tracks[trackIdx].notes;
      const newTracks = [...state.present.tracks];
      newTracks[trackIdx] = { ...newTracks[trackIdx], notes: prevNotes };
      return {
        ...state,
        present: { ...state.present, tracks: newTracks },
        trackHistories: {
          ...state.trackHistories,
          [action.trackId]: { past: history.past.slice(0, -1), future: [currentNotes, ...history.future] }
        }
      };
    }
    case 'REDO_TRACK': {
      const history = state.trackHistories[action.trackId];
      if (!history || history.future.length === 0) return state;
      const trackIdx = state.present.tracks.findIndex(t => t.id === action.trackId);
      if (trackIdx === -1) return state;
      const nextNotes = history.future[0];
      const currentNotes = state.present.tracks[trackIdx].notes;
      const newTracks = [...state.present.tracks];
      newTracks[trackIdx] = { ...newTracks[trackIdx], notes: nextNotes };
      return {
        ...state,
        present: { ...state.present, tracks: newTracks },
        trackHistories: {
          ...state.trackHistories,
          [action.trackId]: { past: [...history.past, currentNotes], future: history.future.slice(1) }
        }
      };
    }
  }
}

export function useHistory() {
  const [histState, dispatch] = useReducer(historyReducer, {
    past: [], present: DEFAULT_SONG, future: [], trackHistories: {}
  });

  const song = histState.present;

  const setSong = useCallback((updater: SongData | ((s: SongData) => SongData)) => {
    dispatch({ type: 'SET', payload: updater });
  }, []);

  const setTrackNotes = useCallback((trackId: string, notes: NoteData[] | ((prev: NoteData[]) => NoteData[])) => {
    dispatch({ type: 'SET_TRACK_NOTES', trackId, notes });
  }, []);

  return { histState, song, dispatch, setSong, setTrackNotes };
}
