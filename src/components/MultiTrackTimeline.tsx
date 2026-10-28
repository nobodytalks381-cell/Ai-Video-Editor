import React, { useRef } from 'react';
import {
  Film,
  Volume2,
  Type as TypeIcon,
  MessageSquare,
  Layers,
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Scissors,
  Download,
} from 'lucide-react';
import type { AdProjectState } from '../types/editor.ts';
import type { InspectorMode } from './RightInspectorPanel.tsx';
import { formatTimecode60Fps } from '../utils/editingEngine.ts';

interface MultiTrackTimelineProps {
  project: AdProjectState;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onPreviewEndCta: () => void;
  onSplitAtPlayhead: () => void;
  onExportVideo: () => void;
  isExporting?: boolean;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onSelectInspectorMode: (mode: InspectorMode) => void;
}

export const MultiTrackTimeline: React.FC<MultiTrackTimelineProps> = ({
  project,
  currentTime,
  isPlaying,
  onTogglePlay,
  onSeek,
  onPreviewEndCta,
  onSplitAtPlayhead,
  onExportVideo,
  isExporting,
  selectedClipId,
  onSelectClip,
  onSelectInspectorMode,
}) => {
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const totalDur = Math.max(1, project.totalDuration);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(Number((relX * totalDur).toFixed(3)));
  };

  const playheadPercent = Math.min(
    100,
    Math.max(0, (currentTime / totalDur) * 100)
  );

  return (
    <section
      aria-label="Layer-by-Layer Studio Video Timeline"
      className="shrink-0 bg-[#0D0F17] border-t border-[#232736] select-none"
    >
      {/* Dedicated Playback & Transport Bar Docked Directly to Top of Timeline Panel */}
      <div
        data-testid="studio-timeline-transport-bar"
        className="bg-[#121624] border-b border-[#232736] px-4 py-2 flex flex-wrap items-center justify-between gap-3"
      >
        {/* Left: Primary Play/Pause + Frame Step + Timecode */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause Commercial' : 'Play Commercial'}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#FACC15] text-[#090A0F] font-bold text-xs hover:bg-[#FDE047] transition-colors cursor-pointer shadow-sm"
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

          <button
            type="button"
            onClick={() => onSeek(0)}
            aria-label="Restart Video"
            className="p-1.5 rounded-lg bg-[#090A0F] text-[#CBD5E1] hover:text-[#F8FAFC] hover:bg-[#171A24] border border-[#232736] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onSeek(Math.max(0, currentTime - 1 / 60))}
            aria-label="Step Back 1 Frame"
            className="p-1.5 rounded-lg bg-[#090A0F] text-[#CBD5E1] hover:text-[#F8FAFC] hover:bg-[#171A24] border border-[#232736] transition-colors cursor-pointer"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() =>
              onSeek(Math.min(project.totalDuration, currentTime + 1 / 60))
            }
            aria-label="Step Forward 1 Frame"
            className="p-1.5 rounded-lg bg-[#090A0F] text-[#CBD5E1] hover:text-[#F8FAFC] hover:bg-[#171A24] border border-[#232736] transition-colors cursor-pointer"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <div className="font-mono text-xs tabular-nums text-[#F8FAFC] bg-[#090A0F] px-2.5 py-1 rounded border border-[#232736]">
            <span className="text-[#FACC15] font-semibold">
              {formatTimecode60Fps(currentTime)}
            </span>
            <span className="text-[#64748B] mx-1.5">/</span>
            <span className="text-[#94A3B8]">
              {formatTimecode60Fps(project.totalDuration)}
            </span>
          </div>
        </div>

        {/* Center: Timeline Info & J-Cut Pacing */}
        <div className="hidden xl:flex items-center gap-2 text-xs text-[#94A3B8]">
          <span className="font-semibold text-[#F8FAFC]">
            Layer-by-Layer Breakdown Timeline
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-[#10B981]">
            J-Cut: -{project.pacing.jCutOverlapMs}ms
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-[#FACC15]">Sharp Cuts</span>
        </div>

        {/* Right: Quick Studio Actions (Preview End CTA, Split Clip, Download MP4) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPreviewEndCta}
            className="px-2.5 py-1.5 rounded-lg bg-[#090A0F] hover:bg-[#171A24] text-[#FACC15] border border-[#232736] text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Preview End CTA
          </button>
          <button
            type="button"
            onClick={onSplitAtPlayhead}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#090A0F] hover:bg-[#171A24] text-[#E2E8F0] border border-[#232736] text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5 text-[#FACC15]" />
            <span>Split Clip</span>
          </button>
          <button
            type="button"
            onClick={onExportVideo}
            disabled={isExporting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#171A24] hover:bg-[#1E2333] text-[#FACC15] border border-[#FACC15]/50 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting ? 'Rendering...' : 'Download MP4'}</span>
          </button>
        </div>
      </div>

      {/* Tracks Container */}
      <div className="px-4 py-2 grid grid-cols-12 gap-2 items-stretch">
        {/* Track Labels Column (4 explicit layers) */}
        <div className="col-span-2 flex flex-col justify-between py-4 space-y-1 text-xs text-[#94A3B8] pr-2 border-r border-[#232736]">
          <div className="h-5 flex items-center gap-1.5 truncate">
            <MessageSquare className="w-3.5 h-3.5 text-[#FACC15] shrink-0" />
            <span className="truncate">Layer 1: End CTA</span>
          </div>
          <div className="h-5 flex items-center gap-1.5 truncate">
            <TypeIcon className="w-3.5 h-3.5 text-[#38BDF8] shrink-0" />
            <span className="truncate">Layer 2: Text Overlay</span>
          </div>
          <div className="h-7 flex items-center gap-1.5 truncate">
            <Film className="w-3.5 h-3.5 text-[#6366F1] shrink-0" />
            <span className="truncate">Layer 3: Video Cuts</span>
          </div>
          <div className="h-6 flex items-center gap-1.5 truncate">
            <Volume2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
            <span className="truncate">Layer 4: Audio J-Cut</span>
          </div>
        </div>

        {/* Interactive Scrubbable Tracks Area */}
        <div
          ref={rulerRef}
          onClick={handleTimelineClick}
          className="col-span-10 relative bg-[#090A0F] rounded-lg border border-[#1E2230] p-2 space-y-1.5 cursor-pointer overflow-hidden"
        >
          {/* Time Ruler Marks */}
          <div className="h-4 flex items-center justify-between text-[10px] font-mono tabular-nums text-[#64748B] border-b border-[#181B26] pb-1">
            {Array.from({ length: 7 }).map((_, i) => {
              const t = (totalDur / 6) * i;
              return <span key={i}>{t.toFixed(1)}s</span>;
            })}
          </div>

          {/* Layer 1: End-of-Video Comment CTA Layer */}
          <div className="relative h-6 bg-[#11131A] rounded overflow-hidden">
            {project.endCta.enabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectInspectorMode('cta');
                  onSeek(project.endCta.startTime + 0.35);
                }}
                style={{
                  left: `${(project.endCta.startTime / totalDur) * 100}%`,
                  width: `${Math.max(
                    10,
                    (project.endCta.duration / totalDur) * 100
                  )}%`,
                }}
                className="absolute top-0.5 bottom-0.5 bg-[#FACC15]/25 border border-[#FACC15] rounded px-2 text-[10px] font-mono font-bold text-[#FACC15] truncate flex items-center justify-center cursor-pointer"
              >
                CTA LAYER: COMMENT "{project.endCta.triggerWord}" ({Math.round(project.endCta.fadeScrimOpacity * 100)}% BLACK FADE)
              </button>
            )}
          </div>

          {/* Layer 2: Sparse Text Overlay Layer */}
          <div className="relative h-6 bg-[#11131A] rounded overflow-hidden">
            {project.sparseTexts.map((txt) => {
              const left = (txt.timelineStart / totalDur) * 100;
              const width = (txt.duration / totalDur) * 100;
              return (
                <button
                  key={txt.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectInspectorMode('text');
                    onSeek(txt.timelineStart + 0.1);
                  }}
                  style={{ left: `${left}%`, width: `${Math.max(5, width)}%` }}
                  className="absolute top-0.5 bottom-0.5 bg-[#38BDF8]/20 border border-[#38BDF8] rounded px-1.5 text-[10px] font-mono text-[#E0F2FE] truncate flex items-center gap-1 cursor-pointer"
                >
                  <Layers className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">TEXT: {txt.text}</span>
                </button>
              );
            })}
          </div>

          {/* Layer 3: Main 9:16 Product Video Cuts Layer */}
          <div className="relative h-8 bg-[#11131A] rounded overflow-hidden">
            {project.clips.map((clip) => {
              const left = (clip.timelineStart / totalDur) * 100;
              const width = (clip.duration / totalDur) * 100;
              const isSelected = clip.id === selectedClipId;
              return (
                <button
                  key={clip.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectClip(clip.id);
                    onSelectInspectorMode('clip');
                    onSeek(clip.timelineStart + 0.15);
                  }}
                  style={{ left: `${left}%`, width: `${Math.max(5, width)}%` }}
                  className={`absolute top-0.5 bottom-0.5 rounded px-2 text-left transition-colors overflow-hidden cursor-pointer ${
                    isSelected
                      ? 'bg-[#6366F1]/40 border-2 border-[#FACC15] text-[#F8FAFC]'
                      : 'bg-[#6366F1]/20 border border-[#6366F1]/60 text-[#E2E8F0] hover:bg-[#6366F1]/30'
                  }`}
                >
                  <div className="text-[10px] font-semibold truncate">
                    {clip.label.split('/').pop()} ({clip.visualMode})
                  </div>
                </button>
              );
            })}
          </div>

          {/* Layer 4: Silence-Stripped J-Cut Voiceover Audio Layer */}
          <div className="relative h-7 bg-[#11131A] rounded overflow-hidden">
            {project.voiceoverSegments.map((seg) => {
              const left = (seg.timelineStart / totalDur) * 100;
              const width = (seg.timelineDuration / totalDur) * 100;
              return (
                <button
                  key={seg.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectInspectorMode(seg.isCtaSegment ? 'cta' : 'pacing');
                    onSeek(seg.timelineStart + 0.1);
                  }}
                  style={{ left: `${left}%`, width: `${Math.max(5, width)}%` }}
                  className={`absolute top-0.5 bottom-0.5 rounded px-1.5 text-left overflow-hidden cursor-pointer ${
                    seg.isCtaSegment
                      ? 'bg-[#FACC15]/20 border border-[#FACC15] text-[#FACC15]'
                      : 'bg-[#10B981]/20 border border-[#10B981]/60 text-[#A7F3D0]'
                  }`}
                >
                  <div className="text-[10px] font-mono truncate">
                    {seg.jCutLeadMs > 0 ? `◄ -${seg.jCutLeadMs}ms ` : ''}
                    {seg.text}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Playhead Vertical Line */}
          <div
            style={{ left: `${playheadPercent}%` }}
            className="absolute top-0 bottom-0 w-0.5 bg-[#FACC15] pointer-events-none z-10"
          >
            <div className="w-2.5 h-2.5 -ml-1 rounded-full bg-[#FACC15]" />
          </div>
        </div>
      </div>
    </section>
  );
};
