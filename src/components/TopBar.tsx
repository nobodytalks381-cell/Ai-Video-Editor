import React from 'react';
import { Download, FolderUp } from 'lucide-react';

export type AppWorkflowStage = 'dropzone' | 'processing' | 'ready' | 'studio';

interface TopBarProps {
  stage: AppWorkflowStage;
  hasLoadedProject: boolean;
  onNavigateStage: (stage: AppWorkflowStage) => void;
  onExportVideo: () => void;
  isExporting: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  stage,
  hasLoadedProject,
  onNavigateStage,
  onExportVideo,
  isExporting,
}) => {
  return (
    <header className="flex items-center justify-between gap-4 md:gap-8 px-4 md:px-6 py-3 bg-[#0D0F17] border-b border-[#232736] select-none shrink-0">
      {/* Zone 1: Single text element wordmark */}
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onNavigateStage('dropzone');
        }}
        className="text-base md:text-lg font-bold tracking-tight text-[#F8FAFC] font-display whitespace-nowrap shrink-0"
      >
        CutShut Studio
      </a>

      {/* Zone 2: Clean single-line workflow links */}
      <nav
        aria-label="Primary Workflow Navigation"
        className="flex items-center gap-4 md:gap-6 text-xs md:text-sm font-medium text-[#94A3B8]"
      >
        <button
          type="button"
          onClick={() => onNavigateStage('dropzone')}
          className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
            stage === 'dropzone' || stage === 'processing'
              ? 'text-[#F8FAFC] border-[#FACC15]'
              : 'text-[#94A3B8] border-transparent hover:text-[#F8FAFC]'
          }`}
        >
          Drop Folder
        </button>
        <button
          type="button"
          disabled={!hasLoadedProject}
          onClick={() => {
            if (hasLoadedProject) onNavigateStage('ready');
          }}
          className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
            !hasLoadedProject
              ? 'text-[#475569] border-transparent cursor-not-allowed'
              : stage === 'ready'
              ? 'text-[#F8FAFC] border-[#FACC15] cursor-pointer'
              : 'text-[#94A3B8] border-transparent hover:text-[#F8FAFC] cursor-pointer'
          }`}
        >
          Final Ad Preview
        </button>
        <button
          type="button"
          disabled={!hasLoadedProject}
          onClick={() => {
            if (hasLoadedProject) onNavigateStage('studio');
          }}
          className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
            !hasLoadedProject
              ? 'text-[#475569] border-transparent cursor-not-allowed'
              : stage === 'studio'
              ? 'text-[#F8FAFC] border-[#FACC15] cursor-pointer'
              : 'text-[#94A3B8] border-transparent hover:text-[#F8FAFC] cursor-pointer'
          }`}
        >
          Editing Studio
        </button>
      </nav>

      {/* Zone 3: 1 primary action */}
      <div className="flex items-center shrink-0">
        {!hasLoadedProject || stage === 'dropzone' || stage === 'processing' ? (
          <button
            type="button"
            onClick={() => onNavigateStage('dropzone')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#E2E8F0] bg-[#171A24] border border-[#2A3042] rounded-lg hover:border-[#FACC15] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FolderUp className="w-3.5 h-3.5 text-[#FACC15]" />
            <span>Select Folder</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onExportVideo}
            disabled={isExporting}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#090A0F] bg-[#FACC15] rounded-lg hover:bg-[#FDE047] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {isExporting
                ? 'Rendering 1080p 60fps MP4...'
                : 'Download 1080p 60fps Ad'}
            </span>
          </button>
        )}
      </div>
    </header>
  );
};
