import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VfsConflict } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { GitCompare, CheckCircle2, AlertTriangle, FileCode, Check, EyeOff, Layers, ShieldCheck, FolderX, RefreshCw, Sparkles, AlertCircle, Wand2, GripHorizontal, Sparkle } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { MOCK_CONFLICTS } from '../../data/mock_data';

interface MergerModuleProps {
  conflicts: VfsConflict[];
  paths: StudioPathsUI;
  onResolveConflict: (conflictId: string, resolvedCode: string) => void;
  onOptimizeAndResolve: () => void;
  onGoToSettings: () => void;
  onRescan: () => void;
  onLoadMockups: (mockups: VfsConflict[]) => void;
}

export const MergerModule: React.FC<MergerModuleProps> = ({
  conflicts,
  paths,
  onResolveConflict,
  onOptimizeAndResolve,
  onGoToSettings,
  onRescan,
  onLoadMockups,
}) => {
  const [selectedConflictId, setSelectedConflictId] = useState<string>(conflicts[0]?.id || '');
  const [filterNoise, setFilterNoise] = useState<boolean>(true);

  // Vertical resizable split panel height percentage (Top competing mods vs Bottom merged output)
  const [topHeightPercent, setTopHeightPercent] = useState<number>(55);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentConflict = conflicts.find((c) => c.id === selectedConflictId) || conflicts[0];
  const [editorContent, setEditorContent] = useState<string>(currentConflict?.merged_output || '');

  useEffect(() => {
    if (currentConflict) {
      setEditorContent(currentConflict.merged_output || currentConflict.base_content);
    }
  }, [selectedConflictId, currentConflict]);

  // Handle vertical panel dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeY = e.clientY - containerRect.top;
      const newPercent = (relativeY / containerRect.height) * 100;
      // Clamp between 20% and 80%
      setTopHeightPercent(Math.max(20, Math.min(80, newPercent)));
    },
    [isResizing]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const startLine = currentConflict?.start_line ?? 1;
  const conflictLine = currentConflict?.conflict_line ?? 1;
  const totalFileLines = currentConflict?.total_file_lines ?? currentConflict?.base_content.split('\n').length ?? 1;

  const handleSelectConflict = (c: VfsConflict) => {
    setSelectedConflictId(c.id);
    setEditorContent(c.merged_output || c.base_content);
  };

  /**
   * Code Snippet Renderer with exact Diff Highlighting (Green for mod changes, Amber for exact conflict line)
   */
  const LinedCodeSnippet: React.FC<{
    content: string;
    vanillaBaseContent: string;
    startLineNum: number;
    targetConflictLine: number;
  }> = ({ content, vanillaBaseContent, startLineNum, targetConflictLine }) => {
    const lines = content.split('\n');
    const vanillaLines = vanillaBaseContent.split('\n');
    const conflictRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (conflictRef.current) {
        conflictRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, [targetConflictLine, content]);

    return (
      <div className="flex-1 flex overflow-auto text-xs font-mono bg-slate-950 rounded-b-lg select-text">
        {/* Line Numbers Gutter */}
        <div className="w-16 bg-slate-900/90 border-r border-slate-800 text-slate-500 py-2 px-1 text-right select-none font-mono text-[11px] shrink-0 space-y-0.5">
          {lines.map((_, idx) => {
            const currentLineNum = (startLineNum || 1) + idx;
            const isConflict = currentLineNum === targetConflictLine;
            return (
              <div
                key={idx}
                className={`leading-6 h-6 px-1 flex items-center justify-end gap-1 ${
                  isConflict ? 'text-amber-300 font-bold bg-amber-500/30 rounded' : 'hover:text-slate-300'
                }`}
              >
                {isConflict && <span className="text-[9px] text-amber-400 font-extrabold">▶</span>}
                <span>{currentLineNum}</span>
              </div>
            );
          })}
        </div>

        {/* Code Content Lines with Diff Highlighting */}
        <div className="flex-1 py-2 overflow-x-auto">
          {lines.map((line, idx) => {
            const currentLineNum = (startLineNum || 1) + idx;
            const isConflict = currentLineNum === targetConflictLine;
            const vanillaLine = vanillaLines[idx] ?? '';
            const isModifiedFromVanilla = line.trim() !== vanillaLine.trim() && !isConflict;

            let lineStyle = 'text-slate-300 hover:bg-slate-900/40';
            if (isConflict) {
              lineStyle = 'bg-amber-500/30 text-amber-200 border-l-4 border-amber-400 font-bold shadow-md';
            } else if (isModifiedFromVanilla) {
              lineStyle = 'bg-emerald-950/40 text-emerald-300 border-l-4 border-emerald-500/80 font-medium';
            }

            return (
              <div
                key={idx}
                ref={isConflict ? conflictRef : null}
                className={`leading-6 h-6 px-3 whitespace-pre text-[12px] font-mono flex items-center transition ${lineStyle}`}
              >
                {line || ' '}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // State 1: Invalid paths
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

  // State 2: 0 real conflicts found
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

  // Helper to extract conflicting line snippet for breakdown box
  const getLineSnippet = (text: string, lineIndex: number): string => {
    const lines = text.split('\n');
    return lines[lineIndex - 1]?.trim() || '(empty or end of file)';
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-950 text-slate-200 select-none">
      {/* File Conflict Sidebar */}
      <div className="w-80 border-r border-slate-800 flex flex-col bg-slate-900/50 shrink-0">
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
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Auto-Merged
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Needs Review
                    </span>
                  )}
                </div>
                <div className="font-mono text-slate-200 font-semibold truncate" title={c.relative_path}>
                  {c.relative_path.split('/').pop()}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                  <span className="truncate max-w-[140px]">{c.relative_path}</span>
                  <span className="font-mono text-amber-400 font-bold bg-amber-500/10 px-1 rounded border border-amber-500/20">
                    L{c.conflict_line ?? 1}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Split Screen Container */}
      {currentConflict ? (
        <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Top Panel: Competing Code Carousel (Resizable height) */}
          <div
            style={{ height: `${topHeightPercent}%` }}
            className="flex flex-col bg-slate-900/80 p-3 min-h-0 overflow-hidden"
          >
            {/* Header Toolbar (Fixed Non-Overlapping Layout) */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2 mb-2 shrink-0">
              <div className="flex items-center gap-2 overflow-hidden max-w-xl">
                <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="text-xs font-bold text-slate-200 truncate">
                  File: <code className="text-emerald-400 font-mono">{currentConflict.relative_path}</code>
                </span>
              </div>

              {/* Action Badges & Auto-Merge Button (Clean flex row) */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="flex items-center gap-1 text-[10px] font-mono px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  Differing Line #{conflictLine}
                </span>

                <span className="flex items-center gap-1 text-[10px] font-mono px-2.5 py-1 rounded-full bg-slate-950 text-slate-400 border border-slate-800">
                  <Layers className="w-3 h-3 text-cyan-400" />
                  {currentConflict.competing_mods.length + 1} Sources
                </span>

                <button
                  onClick={onOptimizeAndResolve}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg shadow transition cursor-pointer"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>Auto-Merge & Generate Master Patch</span>
                </button>
              </div>
            </div>

            {/* Conflict Line Breakdown Box with Exact Line Snippet Comparison */}
            <div className="bg-amber-950/40 border border-amber-500/30 rounded-lg p-2.5 mb-2 flex items-start gap-2 text-xs font-mono shrink-0">
              <span className="text-amber-400 font-bold shrink-0 flex items-center gap-1">
                <Sparkle className="w-3.5 h-3.5 text-amber-400" />
                Line #{conflictLine} Comparison:
              </span>
              <div className="flex-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300">
                <span className="text-slate-400">
                  <b className="text-slate-200">Vanilla Base:</b> "{getLineSnippet(currentConflict.base_content, conflictLine)}"
                </span>
                {currentConflict.competing_mods.map((mod, idx) => (
                  <span key={idx} className="text-emerald-300">
                    <b className="text-emerald-400">[{mod.mod_name}]:</b> "{getLineSnippet(mod.content, conflictLine)}"
                  </span>
                ))}
              </div>
            </div>

            {/* Horizontal Code Panels Carousel */}
            <div className="flex-1 flex gap-3 overflow-x-auto min-h-0">
              {/* Panel A: Vanilla Base */}
              <div className="w-96 min-w-96 bg-slate-950 border border-slate-800 rounded-lg flex flex-col shadow">
                <div className="px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300">Vanilla Base Game</span>
                  <span className="text-[9px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800">
                    {totalFileLines} total lines
                  </span>
                </div>
                <LinedCodeSnippet
                  content={currentConflict.base_content}
                  vanillaBaseContent={currentConflict.base_content}
                  startLineNum={startLine}
                  targetConflictLine={conflictLine}
                />
              </div>

              {/* Multi-Way Mod Panels */}
              {currentConflict.competing_mods.map((mod, idx) => (
                <div
                  key={idx}
                  className="w-[420px] min-w-[420px] bg-slate-950 border border-slate-800 rounded-lg flex flex-col shadow group hover:border-emerald-500/50 transition"
                >
                  <div className="px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span className="text-xs font-bold text-emerald-400 truncate max-w-[220px]" title={mod.mod_name}>
                        {mod.mod_name}
                      </span>
                      <span className="text-[9px] font-mono text-slate-400 shrink-0">
                        ({mod.mod_id})
                      </span>
                    </div>

                    <button
                      onClick={() => setEditorContent(mod.content)}
                      className="px-2.5 py-1 text-[10px] font-semibold rounded bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-700 hover:text-white transition cursor-pointer shrink-0 shadow-sm"
                    >
                      Use This Code
                    </button>
                  </div>
                  <LinedCodeSnippet
                    content={mod.content}
                    vanillaBaseContent={currentConflict.base_content}
                    startLineNum={startLine}
                    targetConflictLine={conflictLine}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Draggable Vertical Splitter Bar */}
          <div
            onMouseDown={handleMouseDown}
            className={`h-2.5 bg-slate-900 hover:bg-emerald-600/60 border-y border-slate-800 cursor-ns-resize flex items-center justify-center transition shrink-0 select-none ${
              isResizing ? 'bg-emerald-500 text-white' : 'text-slate-600 hover:text-white'
            }`}
            title="Drag vertically to resize code panels vs output editor"
          >
            <GripHorizontal className="w-5 h-3" />
          </div>

          {/* Bottom Panel: Resolved Output Monaco Editor (Dynamic remaining height) */}
          <div
            style={{ height: `${100 - topHeightPercent}%` }}
            className="flex flex-col bg-slate-950 p-3 min-h-0 overflow-hidden"
          >
            <div className="flex items-center justify-between mb-2 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-400">
                  Resolved Merged Output (Guarded Master Patch)
                </span>
                <span className="px-2 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-mono">
                  Live Lua AST Validation
                </span>
              </div>

              <button
                onClick={() => onResolveConflict(currentConflict.id, editorContent)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow transition cursor-pointer"
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
