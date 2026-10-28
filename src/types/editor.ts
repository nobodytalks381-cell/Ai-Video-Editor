export type AssetType = 'video' | 'audio' | 'image' | 'document';

export interface FolderAsset {
  id: string;
  name: string;
  type: AssetType;
  url: string;
  serverUrl?: string;
  diskFileName?: string;
  thumbnailUrl?: string;
  duration: number; // in seconds
  width: number;
  height: number;
  sizeBytes: number;
  /** Higher means sharper product focus; lower means generic or blurry */
  productScore: number; // 0 to 100
  /** Higher means too many human faces/distractions; AI avoids high human presence */
  humanPresenceScore: number; // 0 to 100
  visualTags: string[];
  textContent?: string;
  /** Optional procedural render theme for demo or synthesized high-FPS canvas assets */
  proceduralPreset?:
    | 'amber-dropper'
    | 'golden-droplets'
    | 'obsidian-jar'
    | 'ingredients-grid'
    | 'talking-head-reject';
  waveformPeaks?: number[];
}

export interface VoiceoverSegment {
  id: string;
  index: number;
  text: string;
  /** Original start time in raw audio (seconds) */
  rawStart: number;
  /** Original end time in raw audio (seconds) */
  rawEnd: number;
  /** Silence removed before this segment (seconds) */
  silenceRemovedSec: number;
  /** J-cut microsecond/millisecond overlap pulled earlier so speech starts right before previous ends */
  jCutLeadMs: number;
  /** Computed start time on the master edited timeline (seconds) */
  timelineStart: number;
  /** Computed duration on the master edited timeline (seconds) */
  timelineDuration: number;
  /** True if this segment is the final CTA hook at the end of the audio */
  isCtaSegment: boolean;
  /** Extracted keyword to comment if isCtaSegment is true */
  detectedTriggerWord?: string;
  /** Matched visual keyword from voiceover */
  semanticTopic: string;
  /** Optional direct AI-matched video clip asset ID */
  matchedAssetId?: string;
  /** Optional AI-recommended start offset inside the matched video clip */
  recommendedSourceIn?: number;
}

export type VisualDisplayMode =
  | 'fill'
  | 'dynamic-zoom'
  | 'speed-ramp'
  | 'split-2up'
  | 'split-3up'
  | 'ref-showcase';

export type TransitionStyle =
  | 'none'
  | 'hard-cut'
  | 'whip-pan'
  | 'zoom-punch'
  | 'flash-cut';

export interface TimelineClip {
  id: string;
  assetId: string;
  secondaryAssetId?: string; // Used when split-2up or split-3up is active
  track: 'main' | 'broll';
  label: string;
  timelineStart: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  playbackRate: number; // 0.5 to 2.5
  visualMode: VisualDisplayMode;
  transitionIn: TransitionStyle;
  zoomIntensity: number; // 1.0 to 1.6
  filterBrightness: number; // 0.4 to 1.3
  filterContrast: number; // 0.8 to 1.4
  matchReason: string;
  isFallbackFill: boolean;
}

export interface SparseTextLayer {
  id: string;
  text: string;
  highlightWord: string;
  timelineStart: number;
  duration: number;
  position: 'top' | 'center' | 'bottom';
  animation: 'pop' | 'slide-up' | 'kinetic-punch';
  accentColor: '#FACC15' | '#FFFFFF' | '#38BDF8';
}

export interface EndCtaConfig {
  enabled: boolean;
  /** Automatically anchored to the final CTA voiceover segment start */
  startTime: number;
  duration: number;
  /** How much the main product video fades toward black (0.50 to 0.95) */
  fadeScrimOpacity: number;
  /** Top prompt line above the keyword, e.g. "COMMENT BELOW TO GET THE LINK IN DM" */
  promptHeader: string;
  /** Spoken phrase context, e.g. "Comment" */
  prefixText: string;
  /** The highlighted keyword extracted from the end of the audio, e.g. "GLOW" */
  triggerWord: string;
  /** Suffix text, e.g. "& we'll DM you the secret 40% link!" */
  suffixText: string;
  /** Slight yellow (#FACC15) or crisp white (#FFFFFF) per user instructions */
  highlightColor: '#FACC15' | '#FFFFFF';
  /** Relative scale of the trigger word (e.g., 1.35x) */
  wordScale: number;
  showCommentBadge: boolean;
}

export interface PacingConfig {
  silenceThresholdDb: number; // e.g., -38 dB
  minSilenceDurationMs: number; // e.g., 110 ms
  jCutOverlapMs: number; // e.g., 45 ms (next speech starts right before previous finishes)
  maxWordsPerTextOverlay: number; // strict cap to prevent text clutter
  textOverlayDensity: 'minimal' | 'moderate' | 'none';
  rejectHighHumanClips: boolean;
  maxHumanScoreAllowed: number; // e.g., 35%
  bgmDuckingDb: number; // e.g., -14 dB
}

export interface AdProjectState {
  jobId?: string;
  renderedVideoUrl?: string;
  editedAudioUrl?: string;
  folderName: string;
  productName: string;
  productBriefSummary: string;
  resolution: '1080x1920';
  fps: 60;
  aspectRatio: '9:16';
  assets: FolderAsset[];
  voiceoverSegments: VoiceoverSegment[];
  clips: TimelineClip[];
  sparseTexts: SparseTextLayer[];
  endCta: EndCtaConfig;
  pacing: PacingConfig;
  totalDuration: number;
}
