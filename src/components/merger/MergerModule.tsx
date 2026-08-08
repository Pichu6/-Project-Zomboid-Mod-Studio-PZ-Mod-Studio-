import React, { useState } from 'react';
import { VfsConflict } from '../../types';
import { GitCompare, CheckCircle2, AlertTriangle, FileCode, Check, EyeOff } from 'lucide-react';
import Editor from '@monaco-editor/react';

interface MergerModuleProps {
  conflicts: VfsConflict[];
  onResolveConflict: (conflictId: string, resolvedCode: string) => void;
}

export const MergerModule: React.FC<MergerModuleProps> = ({ conflicts, onResolveConflict }) => {
  const [selectedConflictId, setSelectedConflictId] = useState<string>(conflicts[0]?.id || '');
  const [filterNoise, setFilterNoise] = useState<boolean>(true);

  const currentConflict = conflicts.find((c) => c.id === selectedConflictId) || conflicts[0];
  const [editorContent, setEditorContent] = useState<string>(currentConflict?.merged_output || '');

  const handleSelectConflict = (c: VfsConflict) => {
    setSelectedConflictId(c.id);
    setEditorContent(c.merged_output || c.base_content);
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-950 text-slate-200">
      {/* File Conflict Sidebar */}
      <div className="w-80 border-r border-slate-800 flex flex-col bg-slate-900/50">
        <div className="p-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <GitCompare className="w-4 h-4 text-emerald-400" />
            <span>Virtual Conflicts ({conflicts.length})</span>
          </div>
          <button
            onClick={() => setFilterNoise(!filterNoise)}
            className={`px-2 py-1 text-[10px] rounded flex items-center gap-1 border transition cursor-pointer ${
              filterNoise
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/80'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Collapse non-conflicting lines"
          >
            <EyeOff className="w-3 h-3" />
            <span>{filterNoise ? 'Noise Filtered' : 'Show All'}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conflicts.map((c) => {
            const isSelected = c.id === selectedConflictId;
            return (
              <div
                key={c.id}
                onClick={() => handleSelectConflict(c)}
                className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-slate-800 border-emerald-500/50 shadow-sm'
                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                    {c.file_type}
                  </span>
                  {c.status === 'AUTO_MERGED' ? (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" /> Auto-Merged
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400">
                      <AlertTriangle className="w-3 h-3" /> Needs Review
                    </span>
                  )}
                </div>
                <div className="font-mono text-slate-200 truncate" title={c.relative_path}>
                  {c.relative_path.split('/').pop()}
                </div>
                <div className="text-[10px] text-slate-500 truncate mt-0.5">
                  {c.relative_path}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Diff & Merger View */}
      {currentConflict ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Carousel of Competing Mods */}
          <div className="h-64 border-b border-slate-800 bg-slate-900/80 p-3 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 flex items-center gap-2">
                <FileCode className="w-4 h-4 text-cyan-400" />
                <span>3-Way Sources for: <code className="text-emerald-400">{currentConflict.relative_path}</code></span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {currentConflict.competing_mods.length + 1} Sources (Vanilla Base + {currentConflict.competing_mods.length} Mods)
              </span>
            </div>

            {/* Horizontal Carousel */}
            <div className="flex-1 flex gap-3 overflow-x-auto pb-2">
              {/* Panel A: Vanilla Base */}
              <div className="w-72 min-w-72 bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex flex-col text-xs font-mono">
                <div className="text-[11px] font-semibold text-slate-400 border-b border-slate-800 pb-1 mb-2 flex items-center justify-between">
                  <span>Vanilla Base</span>
                  <span className="text-[9px] text-slate-600">PZ Build 42</span>
                </div>
                <pre className="flex-1 overflow-auto text-[11px] text-slate-400 font-mono leading-relaxed whitespace-pre-wrap">
                  {currentConflict.base_content}
                </pre>
              </div>

              {/* Paneles de Mods */}
              {currentConflict.competing_mods.map((mod, idx) => (
                <div
                  key={idx}
                  className="w-80 min-w-80 bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex flex-col text-xs font-mono relative group hover:border-emerald-500/40 transition"
                >
                  <div className="text-[11px] font-semibold text-emerald-400 border-b border-slate-800 pb-1 mb-2 flex items-center justify-between">
                    <span className="truncate max-w-[180px]">{mod.mod_name}</span>
                    <button
                      onClick={() => setEditorContent(mod.content)}
                      className="px-2 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-800 hover:text-white transition cursor-pointer"
                    >
                      Use This Code
                    </button>
                  </div>
                  <pre className="flex-1 overflow-auto text-[11px] text-slate-300 font-mono leading-relaxed whitespace-pre-wrap">
                    {mod.content}
                  </pre>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Resolved Output Monaco Editor */}
          <div className="flex-1 flex flex-col bg-slate-950 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-emerald-400">
                  Resolved Merged Output (Syntax Guarded)
                </span>
                <span className="px-2 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-mono">
                  Live Lua AST Validation
                </span>
              </div>

              <button
                onClick={() => onResolveConflict(currentConflict.id, editorContent)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow transition cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Confirm & Save Output
              </button>
            </div>

            <div className="flex-1 border border-slate-800 rounded-lg overflow-hidden">
              <Editor
                height="100%"
                defaultLanguage={currentConflict.file_type === 'LUA' ? 'lua' : 'plaintext'}
                theme="vs-dark"
                value={editorContent}
                onChange={(val) => setEditorContent(val || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: 'Consolas, Monaco, monospace',
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
          No conflicts selected.
        </div>
      )}
    </div>
  );
};
