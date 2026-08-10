import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VfsConflict } from '../../types';
import { StudioPathsUI } from '../settings/SettingsModule';
import { TauriService, MasterPatchStatusInfoUI, MergedPackageInfoUI } from '../../services/tauri';
import { GitCompare, CheckCircle2, AlertTriangle, FileCode, Check, EyeOff, Layers, ShieldCheck, FolderX, AlertCircle, Wand2, GripHorizontal, Sparkle, PackageCheck, Package, Unlock, RefreshCw, Plus, Edit2, Trash2, Box } from 'lucide-react';
import Editor from '@monaco-editor/react';

interface MergerModuleProps {
  conflicts: VfsConflict[];
  paths: StudioPathsUI;
  onResolveConflict: (conflictId: string, resolvedCode: string) => void;
  onOptimizeAndResolve: (packageFolderName?: string) => void;
  onGoToSettings: () => void;
  onRescan: () => Promise<void> | void;
  onLoadMockups?: (mockups: VfsConflict[]) => void;
}

export const MergerModule: React.FC<MergerModuleProps> = ({
  conflicts,
  paths,
  onResolveConflict,
  onOptimizeAndResolve,
  onGoToSettings,
  onRescan,
}) => {
  const [selectedConflictId, setSelectedConflictId] = useState<string>(conflicts[0]?.id || '');
  const [filterNoise, setFilterNoise] = useState<boolean>(true);
  const [isRescanning, setIsRescanning] = useState<boolean>(false);
  const [isCleaning, setIsCleaning] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [cleanDoneMessage, setCleanDoneMessage] = useState<string | null>(null);
  const [generateDoneMessage, setGenerateDoneMessage] = useState<string | null>(null);
  const [showScanDoneBanner, setShowScanDoneBanner] = useState<boolean>(false);
  const [patchStatus, setPatchStatus] = useState<MasterPatchStatusInfoUI | null>(null);

  // Multi-Package State
  const [packages, setPackages] = useState<MergedPackageInfoUI[]>([]);
  const [selectedPackageFolder, setSelectedPackageFolder] = useState<string>('Z_PZModStudio_MergedPatch');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [newPackageName, setNewPackageName] = useState<string>('');
  const [editingPackageFolder, setEditingPackageFolder] = useState<string | null>(null);
  const [editingPackageName, setEditingPackageName] = useState<string>('');
  const [isUnpackageModalOpen, setIsUnpackageModalOpen] = useState<boolean>(false);

  const fetchPackages = useCallback(async () => {
    if (paths.user_zomboid_dir) {
      const list = await TauriService.listMergedPackages(paths.user_zomboid_dir, paths.mod_list_ini_path);
      setPackages(list);
      if (list.length > 0 && !list.some(p => p.folder_name === selectedPackageFolder)) {
        setSelectedPackageFolder(list[0].folder_name);
      }
    }
  }, [paths.user_zomboid_dir, paths.mod_list_ini_path, selectedPackageFolder]);

  const fetchPatchStatus = useCallback(async () => {
    if (paths.user_zomboid_dir) {
      const status = await TauriService.getMasterPatchStatus(paths.user_zomboid_dir, paths.mod_list_ini_path, selectedPackageFolder);
      setPatchStatus(status);
    }
  }, [paths.user_zomboid_dir, paths.mod_list_ini_path, selectedPackageFolder]);

  useEffect(() => {
    fetchPackages();
    fetchPatchStatus();
  }, [fetchPackages, fetchPatchStatus, conflicts]);

  const handleCreatePackageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPackageName.trim()) return;
    const pkg = await TauriService.createMergedPackage(paths.user_zomboid_dir, paths.mod_list_ini_path, newPackageName.trim());
    if (pkg) {
      setNewPackageName('');
      setIsCreateModalOpen(false);
      await fetchPackages();
      setSelectedPackageFolder(pkg.folder_name);
      await onRescan();
    }
  };

  const handleRenamePackageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPackageFolder || !editingPackageName.trim()) return;
    const pkg = await TauriService.renameMergedPackage(paths.user_zomboid_dir, paths.mod_list_ini_path, editingPackageFolder, editingPackageName.trim());
    if (pkg) {
      setEditingPackageFolder(null);
      setEditingPackageName('');
      await fetchPackages();
      setSelectedPackageFolder(pkg.folder_name);
      await onRescan();
    }
  };

  const handleDeletePackage = async (folderName: string) => {
    if (confirm(`¿Estás seguro de que deseas eliminar el paquete "${folderName}" del disco?`)) {
      await TauriService.deleteMergedPackage(paths.user_zomboid_dir, paths.mod_list_ini_path, folderName);
      if (paths.user_zomboid_dir) {
        const remainingPackages = await TauriService.listMergedPackages(paths.user_zomboid_dir, paths.mod_list_ini_path);
        setPackages(remainingPackages);
        if (remainingPackages.length > 0) {
          setSelectedPackageFolder(remainingPackages[0].folder_name);
        }
      }
      await onRescan();
    }
  };

  const handleCleanMasterPatch = async () => {
    setIsCleaning(true);
    setCleanDoneMessage(null);
    try {
      await TauriService.cleanMasterPatch({
        workshop_dir: paths.workshop_dir,
        pz_install_dir: paths.pz_install_dir,
        user_zomboid_dir: paths.user_zomboid_dir,
        mod_list_ini_path: paths.mod_list_ini_path,
        package_folder_name: selectedPackageFolder,
      });
      setCleanDoneMessage(`Paquete "${selectedPackageFolder}" desempaquetado con éxito. Se re-escanearon los mods activos.`);
      await fetchPatchStatus();
      await fetchPackages();
      await onRescan();
    } catch (err) {
      console.error('Clean failed:', err);
    } finally {
      setIsCleaning(false);
      setTimeout(() => setCleanDoneMessage(null), 6000);
    }
  };

  const handleGenerateMasterPatch = async () => {
    setIsGenerating(true);
    setGenerateDoneMessage(null);
    try {
      const mergedFilesPayload = conflicts.map((c) => ({
        relative_path: c.relative_path,
        content: c.merged_output || c.base_content,
      }));

      const res = await TauriService.generateMasterPatch({
        workshop_dir: paths.workshop_dir,
        pz_install_dir: paths.pz_install_dir,
        user_zomboid_dir: paths.user_zomboid_dir,
        mod_list_ini_path: paths.mod_list_ini_path,
        merged_files: mergedFilesPayload,
        active_polyfill_ids: ['translator_fix', 'safe_gettext'],
        package_folder_name: selectedPackageFolder,
      });

      if (res.success) {
        setGenerateDoneMessage(`Paquete empacado y generado con éxito en Zomboid/mods/${selectedPackageFolder}.`);
        await fetchPatchStatus();
        await fetchPackages();
      }
    } catch (err) {
      console.error('Generate failed:', err);
    } finally {
      setIsGenerating(false);
      setTimeout(() => setGenerateDoneMessage(null), 6000);
    }
  };

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

  const [scanProgress, setScanProgress] = useState<{ percent: number; text: string } | null>(null);

  const handleRescanClick = async () => {
    setIsRescanning(true);
    setShowScanDoneBanner(false);

    setScanProgress({ percent: 15, text: "Paso 1/5: Leyendo mods activos de la lista de carga y Workshop..." });
    await new Promise((r) => setTimeout(r, 200));

    setScanProgress({ percent: 35, text: "Paso 2/5: Analizando archivos Lua y Script de mods B41 (Brita / GunFighter) y B42..." });
    await onRescan();

    setScanProgress({ percent: 65, text: "Paso 3/5: Resolviendo árboles de archivos y diferencias AST..." });
    await new Promise((r) => setTimeout(r, 200));

    setScanProgress({ percent: 90, text: "Paso 4/5: Inyectando capa de traducción y shims de compatibilidad (Polyfills)..." });
    await new Promise((r) => setTimeout(r, 200));

    setScanProgress({ percent: 100, text: "Paso 5/5: ¡Escaneo de compatibilidad completado al 100%!" });

    setTimeout(() => {
      setIsRescanning(false);
      setScanProgress(null);
      setShowScanDoneBanner(true);
      setTimeout(() => setShowScanDoneBanner(false), 3000);
    }, 500);
  };

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

  const getLineSnippet = (text: string, lineIndex: number): string => {
    const lines = text.split('\n');
    return lines[lineIndex - 1]?.trim() || '(empty or end of file)';
  };

  const currentPackage = packages.find((p) => p.folder_name === selectedPackageFolder) || packages[0];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 text-slate-200 select-none">
      {/* Package Manager Header Selector Bar (ALWAYS VISIBLE AT TOP) */}
      <div className="bg-slate-900 border-b border-slate-800 p-3 flex items-center justify-between gap-4 shrink-0 shadow-md">
        <div className="flex items-center gap-2 overflow-x-auto py-0.5">
          <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5 shrink-0 mr-2">
            <Box className="w-4 h-4 text-emerald-400" />
            <span>Paquetes de Fusión:</span>
          </span>

          {packages.map((pkg) => {
            const isSelected = pkg.folder_name === selectedPackageFolder;
            return (
              <div
                key={pkg.folder_name}
                onClick={() => {
                  setSelectedPackageFolder(pkg.folder_name);
                  fetchPatchStatus();
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition shrink-0 ${
                  isSelected
                    ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-200 font-bold shadow'
                    : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <Package className={`w-3.5 h-3.5 ${isSelected ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span>{pkg.display_name}</span>
                {pkg.is_packaged ? (
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0" title="Empaquetado y Publicado en Mod List">
                    PUBLICADO
                  </span>
                ) : (
                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0" title="Desempaquetado (Modo Análisis - Borrador)">
                    DRAFT
                  </span>
                )}

                {/* Quick Actions */}
                <div className="flex items-center gap-1 ml-1 opacity-80 hover:opacity-100">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingPackageFolder(pkg.folder_name);
                      setEditingPackageName(pkg.display_name);
                    }}
                    className="p-0.5 hover:text-cyan-300 transition cursor-pointer"
                    title="Renombrar paquete"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  {packages.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePackage(pkg.folder_name);
                      }}
                      className="p-0.5 hover:text-red-400 transition cursor-pointer"
                      title="Eliminar paquete del disco"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg transition shadow shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>➕ Nuevo Paquete</span>
        </button>
      </div>

      {/* Modal: Crear Nuevo Paquete */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreatePackageSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl animate-fade-in">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-400" />
              <span>Crear Nuevo Paquete de Fusión</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Ingresa un nombre descriptivo para este paquete (ej. <b>"MergedPatch1"</b> o <b>"Mi Parche B42"</b>). Se creará la carpeta nativa en tu directorio de mods.
            </p>
            <input
              type="text"
              value={newPackageName}
              onChange={(e) => setNewPackageName(e.target.value)}
              placeholder="ej: MergedPatch1"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none font-mono"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Crear Paquete
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Renombrar Paquete */}
      {editingPackageFolder && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleRenamePackageSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl animate-fade-in">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Edit2 className="w-5 h-5 text-cyan-400" />
              <span>Renombrar Paquete</span>
            </h3>
            <input
              type="text"
              value={editingPackageName}
              onChange={(e) => setEditingPackageName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none font-mono"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingPackageFolder(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                Guardar Nombre
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Des-mergear / Abrir Paquete para Editar */}
      {isUnpackageModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl animate-fade-in text-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
                <Unlock className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100">⚠️ ¿Abrir Paquete para Edición?</h3>
                <p className="text-xs text-slate-400 mt-0.5">El paquete pasará a modo Borrador (DRAFT).</p>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs text-slate-300">
              <p>
                Al abrir el paquete <b className="text-emerald-400 font-mono">{currentPackage?.display_name}</b>, sus archivos se des-mergearán para permitir modificar sus conflictos.
              </p>
              <div className="p-2.5 bg-amber-950/40 border border-amber-500/30 rounded-lg text-amber-300 text-[11px] font-mono leading-relaxed">
                ⚠️ <b>Aviso de Visibilidad:</b> Mientras este paquete esté en borrador, <b>NO será visible ni estará activo en la Mod List del juego ni de la app</b> hasta que presiones "Empaquetar y Publicar".
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsUnpackageModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg cursor-pointer transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsUnpackageModalOpen(false);
                  await handleCleanMasterPatch();
                }}
                className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold rounded-lg cursor-pointer shadow transition"
              >
                Confirmar y Abrir Paquete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* State 1: Directory Setup Missing */}
      {!paths.is_valid ? (
        <div className="flex-1 flex items-center justify-center p-6 text-slate-200">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4 shadow-xl">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
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
      ) : patchStatus?.is_packaged || conflicts.length === 0 ? (
        /* State 2: 0 real conflicts found (Clean Screen) */
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-slate-200">
          <div className="max-w-lg w-full bg-slate-900/80 border border-emerald-500/30 rounded-2xl p-8 text-center space-y-5 shadow-xl relative overflow-hidden">
            <div className={`w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-inner transition-all duration-300 ${
              isRescanning ? 'scale-110 border-cyan-400 text-cyan-400 animate-pulse' : ''
            }`}>
              <ShieldCheck className={`w-8 h-8 ${isRescanning ? 'animate-bounce text-cyan-400' : ''}`} />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-100">Paquete Seleccionado: {currentPackage?.display_name || selectedPackageFolder}</h3>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Tu lista de mods activos no tiene colisiones directas no resueltas. ¡Todos tus mods instalados funcionarán de forma fluida!
              </p>
            </div>

            {/* Master Patch Management Banner */}
            <div className="p-4 bg-slate-950/90 border border-slate-800 rounded-xl space-y-3 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  {patchStatus?.is_packaged ? (
                    <>
                      <PackageCheck className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-400 font-bold">Estado: {currentPackage?.display_name} PUBLICADO (Empaquetado)</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-4 h-4 text-amber-400" />
                      <span className="text-amber-400 font-bold">Estado: {currentPackage?.display_name} DRAFT (Desempaquetado)</span>
                    </>
                  )}
                </span>
                {patchStatus?.is_packaged && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                    {patchStatus.merged_files.length} Archivos Fusionados
                  </span>
                )}
              </div>

              <p className="text-[11px] text-slate-300 leading-relaxed">
                {patchStatus?.is_packaged
                  ? `El paquete "${currentPackage?.display_name}" está empaquetado en disco y publicado en la Mod List. Puedes desempaquetarlo para modificar o agregar mods.`
                  : `El paquete "${currentPackage?.display_name}" está en modo borrador/análisis. Presiona "Empaquetar" para compilar y publicarlo en la Mod List.`}
              </p>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleGenerateMasterPatch}
                  disabled={isGenerating || !!patchStatus?.is_packaged}
                  className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 px-4 rounded-lg transition shadow-lg ${
                    patchStatus?.is_packaged
                      ? 'bg-slate-900 text-slate-500 cursor-not-allowed border border-slate-800'
                      : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white cursor-pointer'
                  }`}
                  title={patchStatus?.is_packaged ? 'El paquete ya está empaquetado y publicado. Haz clic en "Des-mergear / Abrir para Editar" para modificarlo.' : 'Empaqueta y publica el paquete en la Mod List'}
                >
                  <Package className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                  <span>{isGenerating ? 'Empaquetando...' : patchStatus?.is_packaged ? '📦 Ya Empaquetado y Publicado' : '📦 Empaquetar y Publicar en Mod List'}</span>
                </button>

                {patchStatus?.is_packaged && (
                  <button
                    onClick={() => setIsUnpackageModalOpen(true)}
                    disabled={isCleaning}
                    className="flex items-center justify-center gap-1.5 bg-amber-950/80 hover:bg-amber-900 text-amber-300 text-xs font-bold py-2.5 px-4 rounded-lg border border-amber-700/60 transition cursor-pointer shadow"
                    title="Desempaqueta y quita el paquete de la Mod List"
                  >
                    <Unlock className="w-4 h-4 text-amber-400" />
                    <span>{isCleaning ? 'Limpiando...' : '🔓 Des-mergear / Abrir para Editar'}</span>
                  </button>
                )}
              </div>
            </div>

            {generateDoneMessage && (
              <div className="p-3 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-mono animate-fade-in text-left flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{generateDoneMessage}</span>
              </div>
            )}

            {cleanDoneMessage && (
              <div className="p-3 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-mono animate-fade-in text-left flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{cleanDoneMessage}</span>
              </div>
            )}

            {showScanDoneBanner && (
              <div className="p-3 bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 rounded-xl text-xs font-mono animate-fade-in text-left flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Escaneo completo: Mods analizados e integrados con éxito.</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* State 3: Workspace View with Conflicts */
        <div className="flex-1 flex overflow-hidden">
          {/* File Conflict Sidebar */}
        <div className="w-80 border-r border-slate-800 flex flex-col bg-slate-900/50 shrink-0">
        <div className="p-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <GitCompare className="w-4 h-4 text-emerald-400" />
            <span>Virtual Conflicts ({conflicts.length})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleRescanClick}
              disabled={isRescanning}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer border border-slate-700"
              title="Re-escanear conflictos en mods activos (incluyendo Build 41 y Build 42)"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isRescanning ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
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
        </div>

        {/* Real-time Progress Bar & Status Text */}
        {isRescanning && scanProgress && (
          <div className="p-3 bg-cyan-950/80 border-b border-cyan-700/60 space-y-2 animate-fade-in shadow-lg">
            <div className="flex items-center justify-between text-[11px] font-mono font-bold text-cyan-300">
              <span className="flex items-center gap-1.5 truncate">
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
                <span className="truncate">{scanProgress.text}</span>
              </span>
              <span className="shrink-0">{scanProgress.percent}%</span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden border border-cyan-800">
              <div
                className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full transition-all duration-300 rounded-full"
                style={{ width: `${scanProgress.percent}%` }}
              />
            </div>
          </div>
        )}

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
                  onClick={() => onOptimizeAndResolve(selectedPackageFolder)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg shadow transition cursor-pointer"
                  title="Fusión Automática: Combina las funciones y tablas de TODOS los mods activos en un solo parche"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>⚡ Fusionar Todo Automáticamente y Empaquetar</span>
                </button>
              </div>
            </div>

            {/* Explanatory Info Card: What happens if I choose nothing vs manual override */}
            <div className="bg-slate-950/80 border border-cyan-500/30 rounded-lg p-2.5 mb-2 flex items-center justify-between gap-3 text-xs shrink-0">
              <div className="flex items-center gap-2 text-slate-300">
                <Sparkle className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>
                  <b>💡 ¿Si no elijo nada qué hace?</b> El motor AST <b>combina automáticamente el código de TODOS los mods</b> en un solo archivo fusionado para que todos funcionen juntos en el juego. Si deseas descartar otros mods y forzar el código de un mod específico, presiona <i>"Usar Solo Este Mod"</i>.
                </span>
              </div>
            </div>

            {/* Conflict Line Breakdown Box with Exact Line Snippet Comparison */}
            <div className="bg-amber-950/40 border border-amber-500/30 rounded-lg p-2.5 mb-2 flex items-start gap-2 text-xs font-mono shrink-0">
              <span className="text-amber-400 font-bold shrink-0 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
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
                      <span className="text-xs font-bold text-emerald-400 truncate max-w-[200px]" title={mod.mod_name}>
                        {mod.mod_name}
                      </span>
                      <span className="text-[9px] font-mono text-slate-400 shrink-0">
                        ({mod.mod_id})
                      </span>
                    </div>

                    <button
                      onClick={() => setEditorContent(mod.content)}
                      className="px-2.5 py-1 text-[10px] font-semibold rounded bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-700 hover:text-white transition cursor-pointer shrink-0 shadow-sm"
                      title={`Reemplazar el resultado para usar únicamente el código de ${mod.mod_name}`}
                    >
                      Usar Solo Este Mod
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
                  Resultado de la Fusión (Master Patch)
                </span>
                <span className="px-2 py-0.5 text-[9px] rounded bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-mono">
                  Combinación AST en Tiempo Real
                </span>
              </div>

              <button
                onClick={() => onResolveConflict(currentConflict.id, editorContent)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow transition cursor-pointer"
                title="Guardar los cambios de fusión de este archivo específico"
              >
                <Check className="w-3.5 h-3.5" />
                <span>✓ Guardar Fusión de este Archivo</span>
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
          No hay conflictos seleccionados.
        </div>
      )}
      </div>
      )}
    </div>
  );
};
