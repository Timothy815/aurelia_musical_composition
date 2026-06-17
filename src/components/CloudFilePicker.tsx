import React, { useEffect, useState, useCallback } from 'react';
import { cn } from '../lib/utils';
import { DriveFile, listDriveFiles, deleteFromDrive } from '../lib/googleDrive';

interface Props {
  onOpen: (fileId: string, fileName: string) => void;
  onClose: () => void;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function CloudFilePicker({ onOpen, onClose }: Props) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFiles(await listDriveFiles());
    } catch (e: any) {
      setError(e.message === 'auth' ? 'Session expired — please reconnect Google Drive.' : `Failed to load files: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDelete = async (file: DriveFile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${file.name}" from Google Drive?`)) return;
    setDeleting(file.id);
    try {
      await deleteFromDrive(file.id);
      setFiles(prev => prev.filter(f => f.id !== file.id));
    } catch (e: any) {
      alert(`Could not delete: ${e.message}`);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-[#0F0F10] border border-[#2A2A2D] rounded-lg shadow-2xl w-[480px] max-h-[70vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1F1F21]">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 48 48" className="shrink-0">
              <path fill="#4285F4" d="M16.2 31.7l8-13.9L30.8 31.7z"/>
              <path fill="#34A853" d="M16.2 31.7h15.6l-3.2-5.6H19.4z"/>
              <path fill="#EA4335" d="M24.2 17.8l-8 13.9h5.2l8-13.9z"/>
            </svg>
            <span className="text-[11px] uppercase tracking-widest text-[#D1D1D1] font-bold">Open from Google Drive</span>
          </div>
          <button onClick={onClose} className="text-[#555] hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[#555] text-sm">Loading…</div>
          ) : error ? (
            <div className="py-8 text-center">
              <div className="text-red-400 text-sm mb-3">{error}</div>
              <button onClick={refresh} className="px-3 py-1.5 text-[10px] uppercase tracking-widest border border-[#333] text-[#8E8E93] hover:text-white rounded transition-colors">Retry</button>
            </div>
          ) : files.length === 0 ? (
            <div className="py-12 text-center text-[#555] text-sm">No saved compositions found.</div>
          ) : (
            <ul className="space-y-1">
              {files.map(file => (
                <li
                  key={file.id}
                  onClick={() => onOpen(file.id, file.name)}
                  className="flex items-center justify-between px-3 py-2.5 rounded hover:bg-[#1A1A1C] cursor-pointer group transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-[12px] text-[#D1D1D1] truncate">{file.name.replace(/\.aurelia$/, '')}</div>
                    <div className="text-[10px] text-[#555] mt-0.5">{formatDate(file.modifiedTime)}</div>
                  </div>
                  <button
                    onClick={e => handleDelete(file, e)}
                    disabled={deleting === file.id}
                    className={cn(
                      "ml-3 shrink-0 w-6 h-6 flex items-center justify-center rounded text-[#444] hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all text-sm",
                      deleting === file.id && "opacity-100 animate-pulse"
                    )}
                    title="Delete from Drive"
                  >
                    {deleting === file.id ? '…' : '🗑'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1F1F21] flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-[10px] uppercase tracking-widest border border-[#333] text-[#8E8E93] hover:text-white rounded transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}
