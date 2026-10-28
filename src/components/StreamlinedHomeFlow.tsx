import React, { useRef, useState, useEffect } from 'react';
import {
  FolderUp,
  CheckCircle2,
  Download,
  Sliders,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  Film,
  MessageSquare,
  AlertCircle,
} from 'lucide-react';
import type { AdProjectState } from '../types/editor.ts';
import type { AppWorkflowStage } from './TopBar.tsx';
import { formatTimecode60Fps } from '../utils/editingEngine.ts';
import { extractFilesFromDataTransfer } from '../utils/mediaProcessor.ts';

export interface ProcessingSlide {
  id: string;
  stepNumber: string;
  title: string;
  detail: string;
}

export const BACKEND_PROCESSING_SLIDES: ProcessingSlide[] = [
  {
    id: 'scan',
    stepNumber: '01',
    title: 'Uploading Folder & Probing Real Media Streams (FFprobe)',
    detail:
      'Uploading your video clips and voiceover audio to the backend, probing exact durations/resolutions, and extracting keyframes...',
  },
  {
    id: 'voiceover',
    stepNumber: '02',
    title: 'FFmpeg Silence Stripping & J-Cut Audio Splicing',
    detail:
      'Running FFmpeg silencedetect on your voiceover to strip dead pauses and overlapping spoken beats by -48ms for fast Gen-Z pacing...',
  },
  {
    id: 'cta',
    stepNumber: '03',
    title: 'Gemini Audio Transcription & End Comment CTA Extraction',
    detail:
      'Transcribing spoken audio, isolating the final CTA trigger word, and building the blackish fade + top comment card...',
  },
  {
    id: 'cutshut',
    stepNumber: '04',
    title: 'FFmpeg Cutting & Rendering 1080p 60fps 9:16 Commercial (.MP4)',
    detail:
      'Cutting your actual video clips to each spoken beat, burning in the CTA overlay, and muxing the edited voiceover into a 1080p 60fps MP4...',
  },
];

interface StreamlinedHomeFlowProps {
  stage: AppWorkflowStage;
  project: AdProjectState;
  activeSlideIndex: number;
  uploadError: string | null;
  telemetrySummary: {
    audioFileDetected: string;
    videoClipsDetected: number;
    totalSilenceRemovedSec: number;
    jCutOverlapMs: number;
    extractedTriggerWord: string;
  };
  onFolderDropped: (files: FileList | File[]) => void;
  onRunDemoFolderThroughBackend: () => void;
  onOpenStudioPanel: () => void;
  onExport1080p60: () => void;
  isExporting: boolean;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export const StreamlinedHomeFlow: React.FC<StreamlinedHomeFlowProps> = ({
  stage,
  project,
  activeSlideIndex,
  uploadError,
  telemetrySummary,
  onFolderDropped,
  onRunDemoFolderThroughBackend,
  onOpenStudioPanel,
  onExport1080p60,
  isExporting,
  currentTime,
  isPlaying,
  onTogglePlay,
  onSeek,
  canvasRef,
}) => {
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const readyVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Sync the real rendered MP4 video element with Play/Pause/Seek controls on the Ready screen
  useEffect(() => {
    const vid = readyVideoRef.current;
    if (!vid || stage !== 'ready') return;
    if (isPlaying) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [isPlaying, stage, project.renderedVideoUrl]);

  // STAGE 1: Ultra-Simple Drag & Drop Folder Screen
  if (stage === 'dropzone') {
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10 max-w-3xl mx-auto w-full select-none">
        <div className="text-center space-y-3 mb-8">
          <div className="text-xs font-mono text-[#FACC15] tracking-wider uppercase">
            Automated E-Commerce Ad Agent · 1080p 60fps · 9:16 Vertical MP4
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold font-display text-[#F8FAFC] tracking-tight text-balance">
            Drag and drop your product folder to create your commercial ad
          </h1>
          <p className="text-sm text-[#94A3B8] max-w-xl mx-auto leading-relaxed">
            Folder and file names can be anything. Our backend FFmpeg + AI engine automatically detects your voiceover audio, strips pauses with J-cuts, extracts the final Comment CTA word, and cuts your actual video clips into a 1080p 60fps MP4.
          </p>
        </div>

        {uploadError && (
          <div className="w-full mb-5 p-4 rounded-xl bg-[#F43F5E]/10 border border-[#F43F5E]/40 text-xs text-[#FDA4AF] flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-[#F43F5E] shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Single Focal Point: Giant Drag-and-Drop Folder Target */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setIsDragging(false);
            const extractedFiles = await extractFilesFromDataTransfer(
              e.dataTransfer
            );
            if (extractedFiles.length > 0) {
              onFolderDropped(extractedFiles);
            }
          }}
          onClick={() => folderInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drag and drop product folder here or click to browse"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              folderInputRef.current?.click();
            }
          }}
          className={`w-full rounded-2xl border-2 border-dashed p-10 sm:p-14 text-center transition-all cursor-pointer ${
            isDragging
              ? 'border-[#FACC15] bg-[#161A29] scale-[1.01]'
              : 'border-[#2A3042] bg-[#11131A] hover:border-[#FACC15]/80 hover:bg-[#141722]'
          }`}
        >
          <input
            ref={folderInputRef}
            type="file"
            multiple
            {...({ webkitdirectory: '', directory: '' } as any)}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onFolderDropped(e.target.files);
              }
            }}
            className="hidden"
          />
          <input
            ref={filesInputRef}
            data-testid="direct-files-input"
            type="file"
            multiple
            accept="video/*,audio/*,image/*,.mp4,.mov,.webm,.mkv,.avi,.mp3,.wav,.m4a,.aac,.ogg,.flac,.zip,.tar,.tar.gz,.tgz,.gz,.txt,.md,.json"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onFolderDropped(e.target.files);
              }
            }}
            className="hidden"
          />

          <div className="w-16 h-16 rounded-2xl bg-[#1A1E2D] border border-[#2E354B] flex items-center justify-center mx-auto mb-5">
            <FolderUp className="w-8 h-8 text-[#FACC15]" />
          </div>

          <h2 className="text-xl font-bold font-display text-[#F8FAFC] mb-2">
            Drop Product Folder or .ZIP Archive Here
          </h2>
          <p className="text-xs text-[#94A3B8] max-w-md mx-auto mb-6">
            Drop your product folder or an archived file (<code className="text-[#FACC15]">.zip</code> / <code className="text-[#FACC15]">.tar</code>) containing your video clips (<code className="text-[#94A3B8]">.mp4, .mov</code>), voiceover audio (<code className="text-[#94A3B8]">.wav, .mp3</code>), and optional product document.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
              className="px-5 py-2.5 rounded-lg bg-[#FACC15] text-[#090A0F] font-semibold text-xs hover:bg-[#FDE047] transition-colors cursor-pointer"
            >
              Select Folder from PC
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                filesInputRef.current?.click();
              }}
              className="px-4 py-2.5 rounded-lg bg-[#171A24] text-[#F8FAFC] border border-[#2A3042] font-medium text-xs hover:border-[#FACC15] transition-colors cursor-pointer"
            >
              Select Files or .ZIP
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRunDemoFolderThroughBackend();
              }}
              className="px-4 py-2.5 rounded-lg bg-[#171A24] text-[#94A3B8] border border-[#232736] font-medium text-xs hover:text-[#F8FAFC] transition-colors cursor-pointer"
            >
              Try Sample Folder
            </button>
          </div>
        </div>

        {/* Quiet 3-item summary of what happens automatically on the backend */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 pt-6 border-t border-[#1C202E] text-xs text-[#94A3B8]">
          <div className="flex items-start gap-2.5">
            <Volume2 className="w-4 h-4 text-[#10B981] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-[#E2E8F0]">FFmpeg Silence & J-Cut</div>
              <div>Detects pauses in your audio file, strips dead air, and overlaps speech by -48ms.</div>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Film className="w-4 h-4 text-[#6366F1] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-[#E2E8F0]">Real Video Cut & Shut</div>
              <div>Cuts your actual folder clips to spoken beats at 1080×1920 60fps.</div>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <MessageSquare className="w-4 h-4 text-[#FACC15] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-[#E2E8F0]">End Comment CTA</div>
              <div>Extracts the final CTA word with blackish fade & yellow/white highlight.</div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // STAGE 2: Slide-by-Slide Backend Processing View
  if (stage === 'processing') {
    const activeSlide =
      BACKEND_PROCESSING_SLIDES[activeSlideIndex] ||
      BACKEND_PROCESSING_SLIDES[0];
    const progressPct = Math.min(
      100,
      Math.round(((activeSlideIndex + 1) / BACKEND_PROCESSING_SLIDES.length) * 100)
    );

    return (
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 max-w-2xl mx-auto w-full select-none">
        <div className="w-full rounded-2xl bg-[#11131A] border border-[#232736] p-8 space-y-6">
          <div className="flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-[#FACC15] font-semibold">
              BACKEND FFMPEG + AI PIPELINE RUNNING · STEP {activeSlide.stepNumber} OF 04
            </span>
            <span className="text-[#E2E8F0]">{progressPct}%</span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2 rounded-full bg-[#090A0F] overflow-hidden border border-[#232736]">
            <div
              style={{ width: `${progressPct}%` }}
              className="h-full bg-[#FACC15] transition-all duration-300"
            />
          </div>

          {/* Active Slide Card */}
          <div className="py-6 px-5 rounded-xl bg-[#090A0F] border border-[#1E2230] space-y-2">
            <div className="text-xs font-mono text-[#94A3B8]">
              Folder: {project.folderName}
            </div>
            <h2 className="text-xl font-bold font-display text-[#F8FAFC]">
              {activeSlide.title}
            </h2>
            <p className="text-sm text-[#94A3B8] leading-relaxed">
              {activeSlide.detail}
            </p>
          </div>

          {/* Slide Step Checklist */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {BACKEND_PROCESSING_SLIDES.map((s, idx) => {
              const isDone = idx < activeSlideIndex;
              const isCurrent = idx === activeSlideIndex;
              return (
                <div
                  key={s.id}
                  className={`p-3 rounded-lg border text-xs flex items-center gap-2.5 ${
                    isCurrent
                      ? 'bg-[#171B29] border-[#FACC15] text-[#F8FAFC]'
                      : isDone
                      ? 'bg-[#0D1017] border-[#1E2433] text-[#10B981]'
                      : 'bg-[#090A0F] border-[#181B26] text-[#64748B]'
                  }`}
                >
                  <CheckCircle2
                    className={`w-4 h-4 shrink-0 ${
                      isDone
                        ? 'text-[#10B981]'
                        : isCurrent
                        ? 'text-[#FACC15]'
                        : 'text-[#475569]'
                    }`}
                  />
                  <span className="font-medium truncate">
                    {s.stepNumber}. {s.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    );
  }

  // STAGE 3: Final Ad Ready Screen (Download 1080p 60fps MP4 Ad OR Open in Editing Studio)
  return (
    <main className="flex-1 flex flex-col justify-center px-6 py-6 max-w-5xl mx-auto w-full select-none">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left Column: 9:16 1080p 60fps Ready Video Preview */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div
            onClick={onTogglePlay}
            className="relative aspect-[9/16] h-[420px] sm:h-[460px] rounded-2xl overflow-hidden border border-[#2A3042] bg-[#050608] shadow-2xl cursor-pointer"
          >
            {project.renderedVideoUrl ? (
              <video
                ref={readyVideoRef}
                data-testid="ready-916-video"
                src={project.renderedVideoUrl}
                playsInline
                preload="auto"
                controls={false}
                onLoadedData={(e) => {
                  const v = e.currentTarget;
                  if (v.currentTime === 0) {
                    try {
                      v.currentTime = 0.05;
                    } catch {
                      // ignore
                    }
                  }
                }}
                onTimeUpdate={(e) => {
                  const t = (e.currentTarget as HTMLVideoElement).currentTime;
                  onSeek(Number(t.toFixed(2)));
                }}
                onEnded={() => {
                  if (isPlaying) onTogglePlay();
                }}
                className="w-full h-full object-contain block"
              />
            ) : (
              <canvas
                ref={canvasRef}
                data-testid="ready-916-canvas"
                width={540}
                height={960}
                className="w-full h-full object-contain block"
              />
            )}
          </div>

          {/* Simple Playback Scrub Bar under Preview */}
          <div className="w-full max-w-[310px] mt-3 flex items-center justify-between gap-2 bg-[#11131A] px-3 py-2 rounded-xl border border-[#232736]">
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Pause Ad Preview' : 'Play Ad Preview'}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#FACC15] text-[#090A0F] font-semibold text-xs hover:bg-[#FDE047] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Play Ad</span>
                </>
              )}
            </button>

            <span className="font-mono text-xs tabular-nums text-[#E2E8F0] whitespace-nowrap shrink-0">
              {formatTimecode60Fps(currentTime)}
            </span>

            <button
              type="button"
              onClick={() => {
                const target = project.endCta.startTime + 0.35;
                if (readyVideoRef.current) {
                  readyVideoRef.current.currentTime = target;
                }
                onSeek(target);
              }}
              className="text-xs font-medium text-[#FACC15] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              See End CTA
            </button>

            <button
              type="button"
              onClick={() => {
                if (readyVideoRef.current) {
                  readyVideoRef.current.currentTime = 0;
                }
                onSeek(0);
              }}
              aria-label="Restart Preview"
              className="p-1 text-[#94A3B8] hover:text-[#F8FAFC] shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right Column: Backend Completion Summary & The 2 Primary Choices */}
        <div className="lg:col-span-7 space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-xs font-mono text-[#10B981]">
              <CheckCircle2 className="w-4 h-4" />
              <span>BACKEND FFMPEG CUT & SHUT COMPLETE · 1080p 60FPS 9:16 MP4</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold font-display text-[#F8FAFC]">
              Your Commercial Ad is Ready
            </h1>
            <p className="text-sm text-[#94A3B8] leading-relaxed">
              We analyzed your voiceover audio, stripped {telemetrySummary.totalSilenceRemovedSec}s of pauses with -{telemetrySummary.jCutOverlapMs}ms Gen-Z J-cuts, cut {project.clips.length} product video segments from your folder, and burned in the end Comment CTA overlay for <span className="text-[#FACC15] font-semibold">"{project.endCta.triggerWord}"</span>.
            </p>
          </div>

          {/* Backend Automated Processing Report */}
          <div className="p-5 rounded-xl bg-[#11131A] border border-[#232736] space-y-3 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-[#1C202E]">
              <span className="text-[#94A3B8]">Detected Audio Track</span>
              <span className="font-mono text-[#F8FAFC]">
                {telemetrySummary.audioFileDetected.split('/').pop()}
              </span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-[#1C202E]">
              <span className="text-[#94A3B8]">Voiceover Pacing & Silence Cut</span>
              <span className="font-mono tabular-nums text-[#10B981]">
                -{telemetrySummary.totalSilenceRemovedSec}s Dead Air Removed (-{telemetrySummary.jCutOverlapMs}ms J-Cut)
              </span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-[#1C202E]">
              <span className="text-[#94A3B8]">Extracted End Comment CTA Word</span>
              <span className="font-mono font-bold text-[#FACC15]">
                Comment "{project.endCta.triggerWord}" ({Math.round(project.endCta.fadeScrimOpacity * 100)}% Blackish Fade)
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-[#94A3B8]">Output Format</span>
              <span className="font-mono tabular-nums text-[#F8FAFC]">
                1080×1920 · 60 FPS · 9:16 MP4 (H.264 + AAC)
              </span>
            </div>
          </div>

          {/* Two Primary Actions requested by User:
              1. Download / Export 1080p 60fps Ad (.MP4)
              2. Open in Editing Studio (full layer-by-layer breakdown) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <button
              type="button"
              onClick={onExport1080p60}
              disabled={isExporting}
              className="py-3.5 px-5 rounded-xl bg-[#FACC15] hover:bg-[#FDE047] text-[#090A0F] font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>
                {isExporting
                  ? 'Rendering 1080p 60fps MP4...'
                  : 'Download 1080p 60fps Ad (.MP4)'}
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenStudioPanel}
              className="py-3.5 px-5 rounded-xl bg-[#171A24] hover:bg-[#1E2333] text-[#F8FAFC] border border-[#2A3042] hover:border-[#FACC15] font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Sliders className="w-4 h-4 text-[#FACC15]" />
              <span>Open in Editing Studio</span>
            </button>
          </div>

          <p className="text-xs text-[#64748B]">
            Want to tweak a specific layer? Click <strong className="text-[#CBD5E1]">Open in Editing Studio</strong> to inspect and edit every Text Layer, End CTA Layer, Video B-Roll Layer, and Voiceover Audio Layer on the timeline, then re-render your 1080p 60fps MP4.
          </p>
        </div>
      </div>
    </main>
  );
};
