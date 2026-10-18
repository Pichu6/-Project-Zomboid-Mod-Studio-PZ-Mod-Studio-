import React from 'react';
import Editor from '@monaco-editor/react';
import '../../monacoSetup';
import { VfsConflict } from '../../types';
import { Check, Code2, RotateCcw, Undo2, Unlock } from 'lucide-react';

/** One thing the game could read for this file: the merge, one mod's copy, vanilla. */
export type Choice = { key: string; label: string; help: string; content: string };

export interface EditorPanelProps {
  /** The panel's share of the height, in percent; the rest is the code panels above. */
  topHeightPercent: number;
  currentConflict: VfsConflict;
  isCurrentlyPackaged: boolean;
  fileChoices: Choice[];
  /** The choice the editor shows right now, or 'custom'. */
  activeChoice: string;
  chooseForFile: (choice: Choice) => void;
  /** Read only: the package is packaged and this is not a mod's own file. */
  editorLocked: boolean;
  isManuallyEdited: boolean;
  setIsUnpackageModalOpen: (open: boolean) => void;
  isCleaning: boolean;
  handleResetToAutoMerge: () => void;
  isCurrentConflictAstApplied: boolean;
  handleUnmergeSingleConflict: () => void;
  isCurrentConflictUnmerged: boolean;
  handleSaveSingleConflict: () => void;
  isCurrentConflictSaved: boolean;
  editorContent: string;
  setEditorContent: (content: string) => void;
  setIsManuallyEdited: (edited: boolean) => void;
}

/**
 * The bottom half of the Merger: what the game should read for this file (the choices), the
 * state of the draft, the Restore / Unmerge / Save buttons, and the Monaco editor itself.
 */
export const EditorPanel: React.FC<EditorPanelProps> = ({
  topHeightPercent,
  currentConflict,
  isCurrentlyPackaged,
  fileChoices,
  activeChoice,
  chooseForFile,
  editorLocked,
  isManuallyEdited,
  setIsUnpackageModalOpen,
  isCleaning,
  handleResetToAutoMerge,
  isCurrentConflictAstApplied,
  handleUnmergeSingleConflict,
  isCurrentConflictUnmerged,
  handleSaveSingleConflict,
  isCurrentConflictSaved,
  editorContent,
  setEditorContent,
  setIsManuallyEdited,
}) => (
  <>
  {/* Bottom Panel: Interactive Monaco Editor */}
  <div
    style={{ height: `${100 - topHeightPercent}%` }}
    className="flex flex-col bg-slate-950 p-3 min-h-0 overflow-hidden"
  >
    {!isCurrentlyPackaged && fileChoices.length > 1 && (
    <div className="flex flex-wrap items-center gap-2 mb-2 shrink-0">
      <span className="text-[11px] text-slate-400 mr-1">What should the game read?</span>
      {fileChoices.map((choice) => {
        const active = activeChoice === choice.key;
        return (
          <button
            key={choice.key}
            type="button"
            onClick={() => chooseForFile(choice)}
            aria-pressed={active}
            title={choice.help}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
              active
                ? 'bg-emerald-900/60 text-emerald-200 border-emerald-700'
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
            }`}
          >
            {choice.label}
          </button>
        );
      })}
      {activeChoice === 'custom' && (
        <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold border bg-amber-950/60 text-amber-300 border-amber-800">
          Your own edit
        </span>
      )}
    </div>
    )}
    <div className="flex items-center justify-between mb-2 shrink-0">
    <div className="flex items-center gap-2">
      <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
        <Code2 className="w-4 h-4 text-emerald-400" />
        <span>Merge Result (Master Patch)</span>
      </span>
      {editorLocked ? (
        <span className="px-2 py-0.5 text-[10px] rounded bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-mono font-bold">
          🔒 Published (Read Only)
        </span>
      ) : isCurrentlyPackaged ? (
        <span
          className="px-2 py-0.5 text-[10px] rounded bg-amber-950 text-amber-300 border border-amber-800/80 font-mono"
          title="This is a mod's own file: Save publishes it into the packaged package in place, nothing is unpacked"
        >
          {isManuallyEdited ? '✏️ Edited · Save publishes in place' : 'Patch · Save publishes in place'}
        </span>
      ) : (
        <span className="px-2 py-0.5 text-[10px] rounded bg-amber-950 text-amber-300 border border-amber-800/80 font-mono">
          {isManuallyEdited ? '✏️ Manually Edited' : 'Draft (Editable)'}
        </span>
      )}
    </div>

    <div className="flex items-center gap-2">
      {editorLocked ? (
        <button
          onClick={() => setIsUnpackageModalOpen(true)}
          disabled={isCleaning}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-950 hover:bg-amber-900 text-amber-300 text-xs font-bold border border-amber-700/60 shadow transition cursor-pointer"
          title="Unpack this package to edit its merged code"
        >
          <Unlock className="w-3.5 h-3.5 text-amber-400" />
          <span>{isCleaning ? 'Opening...' : '🔓 Unmerge / Open to Edit'}</span>
        </button>
      ) : (
        <>
          <button
            onClick={handleResetToAutoMerge}
            disabled={isCurrentConflictAstApplied}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
              isCurrentConflictAstApplied
                ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 cursor-pointer'
            }`}
            title={isCurrentConflictAstApplied ? "The automatic AST merge is already applied in this file" : "Restores the automatic merge generated by the AST engine"}
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isCurrentConflictAstApplied ? 'text-slate-600' : 'text-cyan-400'}`} />
            <span>Restore AST Merge</span>
          </button>

          <button
            onClick={handleUnmergeSingleConflict}
            disabled={isCurrentConflictUnmerged}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
              isCurrentConflictUnmerged
                ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 cursor-pointer'
            }`}
            title={isCurrentConflictUnmerged ? "This file is already in its original unmerged state" : "Restores this file to its unmerged base code (removes merged state)"}
          >
            <Undo2 className={`w-3.5 h-3.5 ${isCurrentConflictUnmerged ? 'text-slate-600' : 'text-amber-400'}`} />
            <span>Unmerge this File</span>
          </button>

          <button
            onClick={handleSaveSingleConflict}
            disabled={isCurrentConflictSaved}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition ${
              isCurrentConflictSaved
                ? 'bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow cursor-pointer'
            }`}
            title={isCurrentConflictSaved ? "This file is already saved and resolved (no pending changes)" : "Saves changes to this file and removes Needs Review warning"}
          >
            <Check className={`w-3.5 h-3.5 ${isCurrentConflictSaved ? 'text-slate-600' : 'text-white'}`} />
            <span>{isCurrentConflictSaved ? '✓ Merge Saved' : '✓ Save Merge of this File'}</span>
          </button>
        </>
      )}
    </div>
    </div>

    <div className="flex-1 border border-slate-800 rounded-lg overflow-hidden relative">
    <Editor
      height="100%"
      language={currentConflict.file_type === 'LUA' ? 'lua' : currentConflict.file_type === 'TRANSLATION' ? 'json' : 'plaintext'}
      path={currentConflict.id}
      theme="vs-dark"
      value={editorContent}
      onChange={(val) => {
        if (!editorLocked) {
          setEditorContent(val || '');
          setIsManuallyEdited(true);
        }
      }}
      options={{
        minimap: { enabled: false },
        fontSize: 12,
        fontFamily: 'Consolas, Monaco, monospace',
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 4,
        wordWrap: 'on',
        readOnly: editorLocked,
      }}
    />
    </div>
  </div>
  </>
);
