import type {
  AdProjectState,
  FolderAsset,
  PacingConfig,
} from '../types/editor.ts';
import {
  buildJCutVoiceoverTimeline,
  assembleCommercialCut,
} from './editingEngine.ts';

export const DEFAULT_PACING_CONFIG: PacingConfig = {
  silenceThresholdDb: -38,
  minSilenceDurationMs: 110,
  jCutOverlapMs: 48, // Starts next speech 48ms before previous ends for Gen-Z fast pacing
  maxWordsPerTextOverlay: 3,
  textOverlayDensity: 'minimal',
  rejectHighHumanClips: true,
  maxHumanScoreAllowed: 30,
  bgmDuckingDb: -14,
};

export const DEMO_PRODUCT_BRIEF = `PRODUCT NAME: SOLARIS C20 — Cold-Pressed Bio-Active Vitamin C Serum
CATEGORY: Luxury Clinical Skincare (9:16 TikTok / Reels Performance Ad)
KEY HOOKS:
- 20% L-Ascorbic Acid + Ferulic Micro-Droplets in UV-shielded amber glass
- Zero sticky residue; absorbs into skin barrier in 3.0 seconds
- Clinical test: +64% surface luminosity in 7 days
VOICEOVER SCRIPT (WITH END COMMENT CTA):
1. "Stop paying eighty dollars for oxidized, watered-down skincare."
2. "Solaris C20 locks pure cold-pressed Vitamin C inside micro-amber droplets."
3. "One drop absorbs in three seconds flat with zero greasy residue."
4. "Watch dull texture turn into glass-skin radiance after the very first night."
5. "Comment 'SOLARIS' right now and we'll send you the secret 40% link in DM!"`;

export const DEMO_RAW_VOICEOVER_PHRASES = [
  {
    id: 'vo-1',
    text: 'Stop paying eighty dollars for oxidized, watered-down skincare.',
    rawStart: 0.35, // 350ms initial dead air
    rawEnd: 2.75,
    semanticTopic: 'amber dropper bottle',
  },
  {
    id: 'vo-2',
    text: 'Solaris C20 locks pure cold-pressed Vitamin C inside micro-amber droplets.',
    rawStart: 3.45, // 700ms pause stripped by AI
    rawEnd: 6.05,
    semanticTopic: 'golden droplets macro',
  },
  {
    id: 'vo-3',
    text: 'One drop absorbs in three seconds flat with zero greasy residue.',
    rawStart: 6.65, // 600ms pause stripped by AI
    rawEnd: 9.05,
    semanticTopic: 'serum texture absorption',
  },
  {
    id: 'vo-4',
    text: 'Watch dull texture turn into glass-skin radiance after the very first night.',
    rawStart: 9.7, // 650ms pause stripped by AI
    rawEnd: 12.2,
    semanticTopic: 'clinical glow comparison',
  },
  {
    id: 'vo-5',
    text: "Comment 'SOLARIS' right now and we'll send you the secret 40% link in DM!",
    rawStart: 12.85, // 650ms pause stripped by AI
    rawEnd: 15.85,
    semanticTopic: 'obsidian bottle lineup',
  },
];

export const DEMO_FOLDER_ASSETS: FolderAsset[] = [
  {
    id: 'asset-vid-1',
    name: 'clips/01_amber_dropper_macro_60fps.mp4',
    type: 'video',
    url: 'procedural://amber-dropper',
    duration: 5.4,
    width: 1080,
    height: 1920,
    sizeBytes: 14_820_000,
    productScore: 98,
    humanPresenceScore: 4,
    visualTags: ['amber', 'dropper', 'bottle', 'macro', 'glass'],
    proceduralPreset: 'amber-dropper',
  },
  {
    id: 'asset-vid-2',
    name: 'clips/02_golden_pipette_droplets_slowmo.mp4',
    type: 'video',
    url: 'procedural://golden-droplets',
    duration: 6.2,
    width: 1080,
    height: 1920,
    sizeBytes: 18_400_000,
    productScore: 95,
    humanPresenceScore: 0,
    visualTags: ['golden', 'droplets', 'pipette', 'macro', 'vitamin'],
    proceduralPreset: 'golden-droplets',
  },
  {
    id: 'asset-vid-3',
    name: 'clips/03_influencer_vlog_talking_head_raw.mp4',
    type: 'video',
    url: 'procedural://talking-head-reject',
    duration: 8.1,
    width: 1080,
    height: 1920,
    sizeBytes: 22_150_000,
    productScore: 28,
    humanPresenceScore: 89, // High human presence -> automatically bypassed by AI product filter
    visualTags: ['talking', 'person', 'vlog', 'face'],
    proceduralPreset: 'talking-head-reject',
  },
  {
    id: 'asset-vid-4',
    name: 'clips/04_obsidian_podium_lineup_lighting.mp4',
    type: 'video',
    url: 'procedural://obsidian-jar',
    duration: 5.8,
    width: 1080,
    height: 1920,
    sizeBytes: 16_900_000,
    productScore: 93,
    humanPresenceScore: 2,
    visualTags: ['obsidian', 'bottle', 'lineup', 'radiance', 'glow'],
    proceduralPreset: 'obsidian-jar',
  },
  {
    id: 'asset-vid-5',
    name: 'clips/05_clinical_absorption_test_60fps.mp4',
    type: 'video',
    url: 'procedural://ingredients-grid',
    duration: 5.2,
    width: 1080,
    height: 1920,
    sizeBytes: 15_420_000,
    productScore: 94,
    humanPresenceScore: 0,
    visualTags: ['clinical', 'absorption', 'comparison', 'skin', 'test'],
    proceduralPreset: 'ingredients-grid',
  },
  {
    id: 'asset-aud-1',
    name: 'audio/voiceover_solaris_ad_raw_take.wav',
    type: 'audio',
    url: 'procedural://voiceover-wav',
    duration: 15.85,
    width: 0,
    height: 0,
    sizeBytes: 2_850_000,
    productScore: 100,
    humanPresenceScore: 0,
    visualTags: ['voiceover', 'narration', 'cta'],
    waveformPeaks: [
      0.08, 0.72, 0.88, 0.64, 0.91, 0.55, 0.04, 0.03, 0.79, 0.94, 0.81, 0.67,
      0.85, 0.05, 0.02, 0.76, 0.89, 0.92, 0.71, 0.04, 0.03, 0.84, 0.95, 0.77,
      0.68, 0.03, 0.88, 0.97, 0.91, 0.83, 0.74, 0.42,
    ],
  },
  {
    id: 'asset-doc-1',
    name: 'product_brief_solaris_c20.md',
    type: 'document',
    url: 'procedural://doc',
    duration: 0,
    width: 0,
    height: 0,
    sizeBytes: 4_120,
    productScore: 100,
    humanPresenceScore: 0,
    visualTags: ['brief', 'specs', 'copy'],
    textContent: DEMO_PRODUCT_BRIEF,
  },
];

export function createDemoAdProject(
  customPacing: PacingConfig = DEFAULT_PACING_CONFIG
): AdProjectState {
  const { segments, totalAudioDuration } = buildJCutVoiceoverTimeline(
    DEMO_RAW_VOICEOVER_PHRASES,
    customPacing
  );

  const { clips, sparseTexts, endCta } = assembleCommercialCut(
    DEMO_FOLDER_ASSETS,
    segments,
    customPacing
  );

  return {
    folderName: 'Solaris_C20_Ad_Kit',
    productName: 'SOLARIS C20 Bio-Active Serum',
    productBriefSummary:
      '20% Cold-Pressed Vitamin C + Ferulic Acid in UV-shielded amber glass. Absorbs in 3 seconds with zero sticky residue.',
    resolution: '1080x1920',
    fps: 60,
    aspectRatio: '9:16',
    assets: DEMO_FOLDER_ASSETS,
    voiceoverSegments: segments,
    clips,
    sparseTexts,
    endCta,
    pacing: customPacing,
    totalDuration: Number(Math.max(totalAudioDuration, 11.2).toFixed(2)),
  };
}
