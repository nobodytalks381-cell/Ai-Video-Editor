import React from 'react';
import {
  Sliders,
  MessageSquare,
  Type as TypeIcon,
  Zap,
  Trash2,
  Plus,
} from 'lucide-react';
import type {
  AdProjectState,
  TimelineClip,
  VisualDisplayMode,
  TransitionStyle,
  EndCtaConfig,
  PacingConfig,
  SparseTextLayer,
} from '../types/editor.ts';

export type InspectorMode = 'clip' | 'cta' | 'pacing' | 'text';

interface RightInspectorPanelProps {
  project: AdProjectState;
  inspectorMode: InspectorMode;
  onSelectInspectorMode: (mode: InspectorMode) => void;
  selectedClipId: string | null;
  onUpdateClip: (clipId: string, patch: Partial<TimelineClip>) => void;
  onDeleteClip: (clipId: string) => void;
  onUpdateEndCta: (patch: Partial<EndCtaConfig>) => void;
  onUpdatePacing: (patch: Partial<PacingConfig>) => void;
  onAddSparseText: () => void;
  onUpdateSparseText: (id: string, patch: Partial<SparseTextLayer>) => void;
  onDeleteSparseText: (id: string) => void;
  onSeek: (time: number) => void;
}

export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = ({
  project,
  inspectorMode,
  onSelectInspectorMode,
  selectedClipId,
  onUpdateClip,
  onDeleteClip,
  onUpdateEndCta,
  onUpdatePacing,
  onAddSparseText,
  onUpdateSparseText,
  onDeleteSparseText,
  onSeek,
}) => {
  const activeClip =
    project.clips.find((c) => c.id === selectedClipId) || project.clips[0];
  const videoAssets = project.assets.filter((a) => a.type === 'video');
  const videoAndImageAssets =
    videoAssets.length > 0
      ? videoAssets
      : project.assets.filter((a) => a.type === 'video' || a.type === 'image');

  return (
    <aside className="w-full lg:w-[340px] xl:w-[370px] bg-[#11131A] border-l border-[#232736] flex flex-col h-full select-none">
      {/* Segmented Inspector Mode Selector */}
      <div className="p-2.5 border-b border-[#232736] grid grid-cols-4 gap-1 bg-[#0D0F17]">
        <button
          type="button"
          onClick={() => onSelectInspectorMode('clip')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            inspectorMode === 'clip'
              ? 'bg-[#1E2333] text-[#F8FAFC]'
              : 'text-[#94A3B8] hover:text-[#F8FAFC]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Clip</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onSelectInspectorMode('cta');
            onSeek(project.endCta.startTime + 0.4);
          }}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            inspectorMode === 'cta'
              ? 'bg-[#1E2333] text-[#FACC15]'
              : 'text-[#94A3B8] hover:text-[#F8FAFC]'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>End CTA</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectInspectorMode('pacing')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            inspectorMode === 'pacing'
              ? 'bg-[#1E2333] text-[#F8FAFC]'
              : 'text-[#94A3B8] hover:text-[#F8FAFC]'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>J-Cut</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectInspectorMode('text')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            inspectorMode === 'text'
              ? 'bg-[#1E2333] text-[#F8FAFC]'
              : 'text-[#94A3B8] hover:text-[#F8FAFC]'
          }`}
        >
          <TypeIcon className="w-3.5 h-3.5" />
          <span>Text</span>
        </button>
      </div>

      {/* Inspector Body */}
      <div className="p-4 overflow-y-auto flex-1 space-y-5">
        {inspectorMode === 'clip' && activeClip && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-[#F8FAFC]">
                  Clip Inspector & Visual Fill
                </h3>
                <p className="text-xs text-[#94A3B8] truncate max-w-[230px]">
                  {activeClip.label}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDeleteClip(activeClip.id)}
                aria-label="Delete Selected Clip"
                className="p-1.5 text-[#94A3B8] hover:text-[#F43F5E] rounded hover:bg-[#1C202E] transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-lg bg-[#090A0F] border border-[#232736] text-xs text-[#CBD5E1]">
              {activeClip.matchReason}
            </div>

            {/* Swap Source Asset from Folder */}
            <div>
              <label
                htmlFor="swap-source-select"
                className="block text-xs font-medium text-[#94A3B8] mb-1.5"
              >
                Source Folder Video Clip
              </label>
              <select
                id="swap-source-select"
                value={activeClip.assetId}
                onChange={(e) => {
                  const chosen = project.assets.find(
                    (a) => a.id === e.target.value
                  );
                  if (chosen) {
                    onUpdateClip(activeClip.id, {
                      assetId: chosen.id,
                      label: chosen.name,
                    });
                  }
                }}
                className="w-full px-3 py-2 text-xs bg-[#090A0F] border border-[#232736] rounded-lg text-[#F8FAFC] focus:outline-none focus:border-[#FACC15]"
              >
                {videoAndImageAssets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name.split('/').pop()} (Focus: {a.productScore}%)
                  </option>
                ))}
              </select>
            </div>

            {/* Visual Mode */}
            <div>
              <label
                htmlFor="visual-mode-select"
                className="block text-xs font-medium text-[#94A3B8] mb-1.5"
              >
                9:16 Video Framing Mode
              </label>
              <select
                id="visual-mode-select"
                value={activeClip.visualMode}
                onChange={(e) =>
                  onUpdateClip(activeClip.id, {
                    visualMode: e.target.value as VisualDisplayMode,
                  })
                }
                className="w-full px-3 py-2 text-xs bg-[#090A0F] border border-[#232736] rounded-lg text-[#F8FAFC] focus:outline-none focus:border-[#FACC15]"
              >
                <option value="fill">Full 9:16 Vertical Video Clip</option>
                <option value="dynamic-zoom">Dynamic Macro Zoom</option>
                <option value="speed-ramp">Fast Gen-Z Speed Ramp (1.35x)</option>
                <option value="split-2up">2-Up Split-Screen Product Grid</option>
                <option value="split-3up">3-Up Triple Product Showcase Grid</option>
              </select>
            </div>

            {/* Transition Style */}
            <div>
              <label
                htmlFor="transition-select"
                className="block text-xs font-medium text-[#94A3B8] mb-1.5"
              >
                Cut Style (Gen-Z Viral Sharp Cut)
              </label>
              <select
                id="transition-select"
                value={activeClip.transitionIn}
                onChange={(e) =>
                  onUpdateClip(activeClip.id, {
                    transitionIn: e.target.value as TransitionStyle,
                  })
                }
                className="w-full px-3 py-2 text-xs bg-[#090A0F] border border-[#232736] rounded-lg text-[#F8FAFC] focus:outline-none focus:border-[#FACC15]"
              >
                <option value="hard-cut">Sharp Cut (No Transition)</option>
                <option value="none">None (Sharp Cut)</option>
                <option value="whip-pan">High-Velocity Whip Pan</option>
                <option value="zoom-punch">Optical Zoom Punch</option>
                <option value="flash-cut">Commercial Strobe Flash</option>
              </select>
            </div>

            {/* Playback Speed & Zoom Sliders */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[#94A3B8]">Speed Ramp</span>
                  <span className="font-mono tabular-nums text-[#F8FAFC]">
                    {activeClip.playbackRate.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Clip Playback Speed"
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  value={activeClip.playbackRate}
                  onChange={(e) =>
                    onUpdateClip(activeClip.id, {
                      playbackRate: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-[#FACC15]"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[#94A3B8]">Zoom Punch</span>
                  <span className="font-mono tabular-nums text-[#F8FAFC]">
                    {activeClip.zoomIntensity.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Clip Zoom Intensity"
                  min={1.0}
                  max={1.6}
                  step={0.02}
                  value={activeClip.zoomIntensity}
                  onChange={(e) =>
                    onUpdateClip(activeClip.id, {
                      zoomIntensity: parseFloat(e.target.value),
                    })
                  }
                  className="w-full accent-[#FACC15]"
                />
              </div>
            </div>

            {/* Source In / Duration Trim */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#232736]">
              <div>
                <label
                  htmlFor="clip-source-in"
                  className="block text-xs text-[#94A3B8] mb-1"
                >
                  Source In (s)
                </label>
                <input
                  id="clip-source-in"
                  type="number"
                  step={0.1}
                  min={0}
                  value={activeClip.sourceIn}
                  onChange={(e) =>
                    onUpdateClip(activeClip.id, {
                      sourceIn: Math.max(0, parseFloat(e.target.value) || 0),
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-[#090A0F] border border-[#232736] rounded text-[#F8FAFC]"
                />
              </div>
              <div>
                <label
                  htmlFor="clip-duration"
                  className="block text-xs text-[#94A3B8] mb-1"
                >
                  Clip Duration (s)
                </label>
                <input
                  id="clip-duration"
                  type="number"
                  step={0.1}
                  min={0.3}
                  value={activeClip.duration}
                  onChange={(e) =>
                    onUpdateClip(activeClip.id, {
                      duration: Math.max(0.3, parseFloat(e.target.value) || 1),
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-[#090A0F] border border-[#232736] rounded text-[#F8FAFC]"
                />
              </div>
            </div>
          </div>
        )}

        {inspectorMode === 'cta' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-[#F8FAFC]">
                End-of-Video Comment-to-DM CTA
              </h3>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                Fades the product video toward blackish and displays the spoken trigger keyword on top of the screen.
              </p>
            </div>

            <div>
              <label
                htmlFor="cta-trigger-word"
                className="block text-xs font-medium text-[#94A3B8] mb-1"
              >
                Spoken CTA Trigger Keyword (Written Bigger)
              </label>
              <input
                id="cta-trigger-word"
                type="text"
                value={project.endCta.triggerWord}
                onChange={(e) =>
                  onUpdateEndCta({ triggerWord: e.target.value.toUpperCase() })
                }
                className="w-full px-3 py-2 text-sm font-bold font-mono bg-[#090A0F] border border-[#FACC15] rounded-lg text-[#FACC15] focus:outline-none"
              />
            </div>

            {/* Highlight Color Selector: Slightly Yellow or Crisp White per prompt */}
            <div>
              <span className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                Trigger Word Highlight Color
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onUpdateEndCta({ highlightColor: '#FACC15' })}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    project.endCta.highlightColor === '#FACC15'
                      ? 'bg-[#FACC15]/15 border-[#FACC15] text-[#FACC15]'
                      : 'bg-[#090A0F] border-[#232736] text-[#94A3B8]'
                  }`}
                >
                  Signal Yellow (#FACC15)
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateEndCta({ highlightColor: '#FFFFFF' })}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    project.endCta.highlightColor === '#FFFFFF'
                      ? 'bg-white/15 border-white text-white'
                      : 'bg-[#090A0F] border-[#232736] text-[#94A3B8]'
                  }`}
                >
                  Pure White (#FFFFFF)
                </button>
              </div>
            </div>

            {/* Blackish Fade Scrim Slider */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#94A3B8]">Fade Video to Blackish</span>
                <span className="font-mono tabular-nums text-[#F8FAFC]">
                  {Math.round(project.endCta.fadeScrimOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                aria-label="Fade Video to Blackish Opacity"
                min={0.45}
                max={0.95}
                step={0.02}
                value={project.endCta.fadeScrimOpacity}
                onChange={(e) =>
                  onUpdateEndCta({
                    fadeScrimOpacity: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-[#FACC15]"
              />
            </div>

            {/* Keyword Enlargement Scale */}
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#94A3B8]">Trigger Word Scale</span>
                <span className="font-mono tabular-nums text-[#F8FAFC]">
                  {project.endCta.wordScale.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                aria-label="Trigger Word Enlargement Scale"
                min={1.15}
                max={1.75}
                step={0.05}
                value={project.endCta.wordScale}
                onChange={(e) =>
                  onUpdateEndCta({ wordScale: parseFloat(e.target.value) })
                }
                className="w-full accent-[#FACC15]"
              />
            </div>

            <div>
              <label
                htmlFor="cta-header-input"
                className="block text-xs font-medium text-[#94A3B8] mb-1"
              >
                Top Header Text (e.g., Link in Bio)
              </label>
              <input
                id="cta-header-input"
                type="text"
                value={project.endCta.promptHeader}
                onChange={(e) =>
                  onUpdateEndCta({ promptHeader: e.target.value })
                }
                className="w-full px-3 py-2 text-xs bg-[#090A0F] border border-[#232736] rounded-lg text-[#F8FAFC]"
              />
            </div>

            <div>
              <label
                htmlFor="cta-suffix-input"
                className="block text-xs font-medium text-[#94A3B8] mb-1"
              >
                DM Instruction Subtext
              </label>
              <input
                id="cta-suffix-input"
                type="text"
                value={project.endCta.suffixText}
                onChange={(e) => onUpdateEndCta({ suffixText: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-[#090A0F] border border-[#232736] rounded-lg text-[#F8FAFC]"
              />
            </div>
          </div>
        )}

        {inspectorMode === 'pacing' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-[#F8FAFC]">
                Gen-Z Voiceover J-Cut & Silence Engine
              </h3>
              <p className="text-xs text-[#94A3B8] mt-0.5">
                Strips dead pauses and starts the next spoken phrase a split-second before the previous finishes.
              </p>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#94A3B8]">J-Cut Speech Pre-Overlap</span>
                <span className="font-mono tabular-nums text-[#10B981]">
                  -{project.pacing.jCutOverlapMs} ms
                </span>
              </div>
              <input
                type="range"
                aria-label="J-Cut Speech Overlap Milliseconds"
                min={0}
                max={140}
                step={4}
                value={project.pacing.jCutOverlapMs}
                onChange={(e) =>
                  onUpdatePacing({
                    jCutOverlapMs: parseInt(e.target.value, 10),
                  })
                }
                className="w-full accent-[#10B981]"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#94A3B8]">Silence Gate Threshold</span>
                <span className="font-mono tabular-nums text-[#F8FAFC]">
                  {project.pacing.silenceThresholdDb} dB
                </span>
              </div>
              <input
                type="range"
                aria-label="Silence Threshold dB"
                min={-55}
                max={-20}
                step={1}
                value={project.pacing.silenceThresholdDb}
                onChange={(e) =>
                  onUpdatePacing({
                    silenceThresholdDb: parseInt(e.target.value, 10),
                  })
                }
                className="w-full accent-[#FACC15]"
              />
            </div>

            <div className="pt-2 border-t border-[#232736] flex items-center justify-between">
              <span className="text-xs text-[#E2E8F0]">
                Filter High-Human Clips (&gt;{project.pacing.maxHumanScoreAllowed}%)
              </span>
              <input
                type="checkbox"
                aria-label="Filter High-Human Clips"
                checked={project.pacing.rejectHighHumanClips}
                onChange={(e) =>
                  onUpdatePacing({ rejectHighHumanClips: e.target.checked })
                }
                className="accent-[#FACC15] w-4 h-4"
              />
            </div>
          </div>
        )}

        {inspectorMode === 'text' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-[#F8FAFC]">
                  Sparse On-Screen Text Layers
                </h3>
                <p className="text-xs text-[#94A3B8]">
                  Minimalist policy: only use text where impact is needed.
                </p>
              </div>
              <button
                type="button"
                onClick={onAddSparseText}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#FACC15] text-[#090A0F] text-xs font-semibold hover:bg-[#FDE047] transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {project.sparseTexts.map((txt) => (
                <div
                  key={txt.id}
                  className="p-3 rounded-lg bg-[#090A0F] border border-[#232736] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      aria-label="Sparse Text Content"
                      value={txt.text}
                      onChange={(e) =>
                        onUpdateSparseText(txt.id, {
                          text: e.target.value.toUpperCase(),
                        })
                      }
                      className="w-full px-2 py-1 text-xs font-bold bg-[#11131A] border border-[#232736] rounded text-[#F8FAFC]"
                    />
                    <button
                      type="button"
                      onClick={() => onDeleteSparseText(txt.id)}
                      aria-label={`Delete text ${txt.text}`}
                      className="p-1 text-[#94A3B8] hover:text-[#F43F5E] cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[#94A3B8] font-mono tabular-nums">
                    <span>Start: {txt.timelineStart.toFixed(2)}s</span>
                    <span>Dur: {txt.duration.toFixed(2)}s</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
