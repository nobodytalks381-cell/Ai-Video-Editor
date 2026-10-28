import React, { useEffect, useRef } from 'react';
import { Play, Pause, Eye } from 'lucide-react';
import type { AdProjectState } from '../types/editor.ts';
import { renderCommercialFrame } from '../utils/canvasCompositor.ts';

interface VerticalCanvasViewportProps {
  project: AdProjectState;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onPreviewEndCta: () => void;
  onSplitAtPlayhead: () => void;
  showSafeZones: boolean;
  onToggleSafeZones: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  mediaCache: Map<string, HTMLVideoElement | HTMLImageElement>;
  renderedVideoUrl?: string | null;
  hasUnrenderedStudioEdits?: boolean;
}

export const VerticalCanvasViewport: React.FC<VerticalCanvasViewportProps> = ({
  project,
  currentTime,
  isPlaying,
  onTogglePlay,
  onSeek,
  showSafeZones,
  onToggleSafeZones,
  canvasRef,
  mediaCache,
  renderedVideoUrl,
  hasUnrenderedStudioEdits,
}) => {
  const studioVideoRef = useRef<HTMLVideoElement | null>(null);
  const useRenderedVideo = Boolean(
    renderedVideoUrl && !hasUnrenderedStudioEdits && !showSafeZones
  );

  // Sync rendered MP4 video element when in Studio without unrendered edits
  useEffect(() => {
    const vid = studioVideoRef.current;
    if (!vid || !useRenderedVideo) return;
    if (isPlaying) {
      if (Math.abs(vid.currentTime - currentTime) > 0.35) {
        try {
          vid.currentTime = currentTime;
        } catch {
          // ignore
        }
      }
      vid.play().catch(() => {});
    } else {
      vid.pause();
      if (Math.abs(vid.currentTime - currentTime) > 0.04) {
        try {
          vid.currentTime = currentTime;
        } catch {
          // ignore
        }
      }
    }
  }, [isPlaying, currentTime, useRenderedVideo]);

  // Render current frame immediately onto canvas whenever currentTime, project, or safeZones change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderCommercialFrame({
      ctx,
      width: canvas.width,
      height: canvas.height,
      currentTime,
      project,
      mediaCache,
      showSafeZones,
    });
  }, [currentTime, project, showSafeZones, canvasRef, mediaCache]);

  const isInCtaSegment =
    project.endCta.enabled && currentTime >= project.endCta.startTime;

  return (
    <div className="flex flex-col items-center justify-between h-full min-h-0 bg-[#090A0F] px-3 py-2 select-none overflow-hidden">
      {/* Top Viewport Metadata Bar */}
      <div className="w-full shrink-0 flex items-center justify-between text-xs text-[#94A3B8] pb-1.5 border-b border-[#1C202E]">
        <div className="flex items-center gap-2 font-mono tabular-nums">
          <span className="text-[#F8FAFC] font-semibold">9:16 Vertical</span>
          <span aria-hidden="true">·</span>
          <span>1080×1920</span>
          <span aria-hidden="true">·</span>
          <span className="text-[#FACC15]">60 FPS</span>
        </div>

        <div className="flex items-center gap-2.5">
          {isInCtaSegment && (
            <span className="text-xs font-mono text-[#FACC15]">
              CENTERED CTA ACTIVE ("{project.endCta.triggerWord}")
            </span>
          )}
          <button
            type="button"
            onClick={onTogglePlay}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#FACC15] text-[#090A0F] font-bold text-xs hover:bg-[#FDE047] transition-colors cursor-pointer"
          >
            {isPlaying ? (
              <>
                <Pause className="w-3 h-3 fill-current" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-current" />
                <span>Play</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onToggleSafeZones}
            aria-label="Toggle 9:16 Safe Zones"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors cursor-pointer ${
              showSafeZones
                ? 'bg-[#1E2436] text-[#38BDF8]'
                : 'text-[#94A3B8] hover:text-[#F8FAFC]'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Safe Zones</span>
          </button>
        </div>
      </div>

      {/* Center 9:16 Vertical Monitor (Strictly constrained to 9:16 aspect ratio inside Studio viewport) */}
      <div className="flex-1 min-h-0 w-full flex items-center justify-center py-2 overflow-hidden">
        <div
          onClick={onTogglePlay}
          className="relative aspect-[9/16] h-[calc(100vh-310px)] max-h-[520px] min-h-[300px] rounded-xl overflow-hidden border border-[#262B3D] bg-[#050608] shadow-2xl cursor-pointer mx-auto"
        >
          {useRenderedVideo && renderedVideoUrl ? (
            <video
              ref={studioVideoRef}
              data-testid="studio-916-video"
              src={renderedVideoUrl}
              playsInline
              controls={false}
              onTimeUpdate={(e) => {
                if (isPlaying) {
                  const t = (e.currentTarget as HTMLVideoElement).currentTime;
                  onSeek(Number(t.toFixed(3)));
                }
              }}
              onEnded={() => {
                if (isPlaying) onTogglePlay();
              }}
              className="w-full h-full object-contain block"
            />
          ) : null}
          <canvas
            ref={canvasRef}
            data-testid="commercial-916-canvas"
            width={540}
            height={960}
            className={`w-full h-full object-contain ${
              useRenderedVideo ? 'hidden' : 'block'
            }`}
          />
        </div>
      </div>
    </div>
  );
};
