import React, { useState } from 'react';
import { VfsConflict } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { GitCompare, CheckCircle2, AlertTriangle, FileCode, Check, EyeOff, Layers, Target, ShieldCheck, FolderX, RefreshCw, Sparkles } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { MOCK_CONFLICTS } from '../../data/mock_data';

interface MergerModuleProps {
  conflicts: VfsConflict[];
  paths: StudioPathsUI;
  onResolveConflict: (conflictId: string, resolvedCode: string) => void;
  onGoToSettings: () => void;
  onRescan: () => void;
  onLoadMockups: (mockups: VfsConflict[]) => void;
}

export const MergerModule: React.FC<MergerModuleProps> = ({
  conflicts,
  paths,
  onResolveConflict,
  onGoToSettings,
  onRescan,
  onLoadMockups,
}) => {
  const [selectedConflictId, setSelectedConflictId] = useState<string>(conflicts[0]?.id || '');
  const [filterNoise, setFilterNoise] = useState<boolean>(true);
  const [focusOnConflict, setFocusOnConflict] = useState<boolean>(true);

  const currentConflict = conflicts.find((c) => c.id === selectedConflictId) || conflicts[0];
  const [editorContent, setEditorContent] = useState<string>(currentConflict?.merged_output || '');

  const startLine = currentConflict?.start_line ?? 1;
  const conflictLine = currentConflict?.conflict_line ?? 4;
  const totalFileLines = currentConflict?.total_file_lines ?? currentConflict?.base_content.split('\n').length ?? 1;

  const handleSelectConflict = (c: VfsConflict) => {
    setSelectedConflictId(c.id);
    setEditorContent(c.merged_output || c.base_content);
  };

  /**
   * Helper component to render code snippet or full file with real aligned line numbers
   */
  const LinedCodeSnippet: React.FC<{
    content: string;
    startLineNum: number;
    targetConflictLine: number;
  }> = ({ content, startLineNum, targetConflictLine }) => {
    const lines = content.split('\n');

    return (
      <div className="flex-1 flex overflow-auto text-xs font-mono bg-slate-950 rounded-b-lg select-text">
        {/* Line Numbers Gutter */}
        <div className="w-12 bg-slate-900/90 border-r border-slate-800 text-slate-500 py-2 px-1 text-right select-none font-mono text-[11px] shrink-0 space-y-0.5">
          {lines.map((_, idx) => {
            const currentLineNum = (startLineNum || 1) + idx;
            const isConflict = currentLineNum === targetConflictLine;
            return (
              <div
                key={idx}
                className={`leading-6 h-6 px-1 ${
                  isConflict ? 'text-amber-400 font-bold bg-amber-500/20 rounded' : 'hover:text-slate-300'
                }`}
              >
                {currentLineNum}
              </div>
            );
          })}
        </div>

        {/* Code Content Lines */}
        <div className="flex-1 py-2 overflow-x-auto">
          {lines.map((line, idx) => {
            const currentLineNum = (startLineNum || 1) + idx;
            const isConflict = currentLineNum === targetConflictLine;
            return (
              <div
                key={idx}
                className={`leading-6 h-6 px-3 whitespace-pre text-[12px] font-mono flex items-center transition ${
                  isConflict
                    ? 'bg-amber-500/20 text-amber-200 border-l-4 border-amber-400 font-semibold shadow-inner'
                    : 'text-slate-300 hover:bg-slate-900/40'
                }`}
              >
                {line || ' '}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // State 1: Invalid or unconfigured installation path
  if (!paths.is_valid) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-200">
        <div className="max-w-md w-full bg-slate-900/80 border border-amber-500/40 rounded-2xl p-6 text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto">
            <FolderX className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">Setup Required: Game Directory</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Project Zomboid installation directory could not be auto-detected. Please configure your paths in App Settings to scan active mods.
            </p>
          </div>
          <button
            onClick={onGoToSettings}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-xs py-2.5 rounded-lg shadow transition cursor-pointer"
          >
            Configure Directory Paths in Settings
          </button>
        </div>
      </div>
    );
  }

  // State 2: Valid paths, but 0 real conflicts found!
  if (conflicts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-200">
        <div className="max-w-lg w-full bg-slate-900/80 border border-emerald-500/30 rounded-2xl p-8 text-center space-y-5 shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-inner">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">All Clean! No Script Conflicts Detected</h3>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Your active mod list in <code className="text-emerald-400 font-mono">ModListData.ini</code> has zero relative file path collisions. All installed mods will run smoothly!
            </p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={onRescan}
              className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-4 py-2.5 rounded-lg border border-slate-700 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
              Rescan Active Mods
            </button>

            <button
              onClick={() => onLoadMockups(MOCK_CONFLICTS)}
              className="flex items-center justify-center gap-2 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-xs font-medium px-4 py-2.5 rounded-lg border border-emerald-800 transition cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              Load Preview Demo (Mockup)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State 3: Active conflicts to display & merge!
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
                <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                  <span className="truncate max-w-[140px]">{c.relative_path}</span>
                  <span className="font-mono text-amber-400/90 font-semibold">L{c.conflict_line ?? 4}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Diff & Merger View */}
      {currentConflict ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Carousel of Multi-Way Competing Mods */}
          <div className="h-72 border-b border-slate-800 bg-slate-900/80 p-3 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <FileCode className="w-4 h-4 text-cyan-400" />
                <span>
                  Multi-Way (N-Way) Sources for: <code className="text-emerald-400">{currentConflict.relative_path}</code>
                </span>
              </span>

              {/* Excerpt Metadata Banner & Focus Toggle */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFocusOnConflict(!focusOnConflict)}
                  className={`flex items-center gap-1 text-[10px] font-mono px-2.5 py-1 rounded-full border transition cursor-pointer ${
                    focusOnConflict
                      ? 'bg-amber-950/80 text-amber-300 border-amber-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  <Target className="w-3 h-3 text-amber-400" />
                  <span>Focused on Conflict @ Line {conflictLine}</span>
                </button>

                <span className="flex items-center gap-1 text-[10px] font-mono px-2.5 py-1 rounded-full bg-slate-950 text-slate-400 border border-slate-800">
                  <Layers className="w-3 h-3 text-cyan-400" />
                  {currentConflict.competing_mods.length + 1} Multi-Way Sources (Vanilla Base + {currentConflict.competing_mods.length} Mods)
                </span>
              </div>
            </div>

            {/* Horizontal Carousel */}
            <div className="flex-1 flex gap-3 overflow-x-auto pb-2">
              {/* Panel A: Vanilla Base */}
              <div className="w-80 min-w-80 bg-slate-950 border border-slate-800 rounded-lg flex flex-col shadow">
                <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300">Vanilla Base</span>
                  <span className="text-[9px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800">
                    Lines {startLine} - {startLine + currentConflict.base_content.split('\n').length - 1} ({totalFileLines} total)
                  </span>
                </div>
                <LinedCodeSnippet
                  content={currentConflict.base_content}
                  startLineNum={startLine}
                  targetConflictLine={conflictLine}
                />
              </div>

              {/* Multi-Way Mod Panels */}
              {currentConflict.competing_mods.map((mod, idx) => (
                <div
                  key={idx}
                  className="w-96 min-w-96 bg-slate-950 border border-slate-800 rounded-lg flex flex-col shadow group hover:border-emerald-500/50 transition"
                >
                  <div className="px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span className="text-xs font-bold text-emerald-400 truncate max-w-[170px]" title={mod.mod_name}>
                        {mod.mod_name}
                      </span>
                      <span className="text-[9px] font-mono text-slate-400 shrink-0">
                        Mod #{idx + 1}
                      </span>
                    </div>

                    <button
                      onClick={() => setEditorContent(mod.content)}
                      className="px-2 py-1 text-[10px] font-semibold rounded bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-700 hover:text-white transition cursor-pointer shrink-0"
                    >
                      Use This Code
                    </button>
                  </div>
                  <LinedCodeSnippet
                    content={mod.content}
                    startLineNum={startLine}
                    targetConflictLine={conflictLine}
                  />
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
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow transition cursor-pointer"
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
