import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCtaTriggerFromTranscript,
  buildJCutVoiceoverTimeline,
  assembleCommercialCut,
  formatTimecode60Fps,
} from './editingEngine.ts';
import type { FolderAsset, PacingConfig } from '../types/editor.ts';

const defaultPacing: PacingConfig = {
  silenceThresholdDb: -38,
  minSilenceDurationMs: 100,
  jCutOverlapMs: 50,
  maxWordsPerTextOverlay: 3,
  textOverlayDensity: 'minimal',
  rejectHighHumanClips: true,
  maxHumanScoreAllowed: 30,
  bgmDuckingDb: -14,
};

test('extractCtaTriggerFromTranscript extracts quoted and unquoted trigger keywords from end of voiceover', () => {
  const res1 = extractCtaTriggerFromTranscript(
    "Comment 'GLOW' right now and we will send you the link in DM!"
  );
  assert.equal(res1.isCta, true);
  assert.equal(res1.triggerWord, 'GLOW');

  const res2 = extractCtaTriggerFromTranscript(
    'Just comment SERUM below and I will DM you the 40% off link.'
  );
  assert.equal(res2.isCta, true);
  assert.equal(res2.triggerWord, 'SERUM');
});

test('buildJCutVoiceoverTimeline strips pauses and pulls subsequent speech earlier by jCutOverlapMs', () => {
  const rawPhrases = [
    {
      id: 'p1',
      text: 'Stop wasting money on watered-down skincare.',
      rawStart: 0.4,
      rawEnd: 2.4,
      semanticTopic: 'dropper bottle',
    },
    {
      id: 'p2',
      text: 'This cold-pressed vitamin C serum absorbs in 3 seconds flat.',
      rawStart: 3.2, // 0.8s dead air pause
      rawEnd: 5.2,
      semanticTopic: 'golden droplets',
    },
    {
      id: 'p3',
      text: "Comment 'GLOW' below and we'll send you the link in DM.",
      rawStart: 6.1, // 0.9s dead air pause
      rawEnd: 8.5,
      semanticTopic: 'product lineup',
    },
  ];

  const { segments, totalSilenceRemovedSec } = buildJCutVoiceoverTimeline(
    rawPhrases,
    defaultPacing
  );

  assert.equal(segments.length, 3);
  assert.ok(totalSilenceRemovedSec > 1.5, 'Should strip >1.5s of dead air');

  // Verify J-cut overlap: segment 2 starts 50ms (0.05s) BEFORE segment 1 finishes
  const seg1End = segments[0].timelineStart + segments[0].timelineDuration;
  assert.equal(
    Number((seg1End - segments[1].timelineStart).toFixed(2)),
    0.05
  );

  // Verify final segment is flagged as CTA and extracts 'GLOW'
  assert.equal(segments[2].isCtaSegment, true);
  assert.equal(segments[2].detectedTriggerWord, 'GLOW');
});

test('assembleCommercialCut rejects human-heavy clips, fills gaps with dynamic modes, and configures blackish CTA fade', () => {
  const mockAssets: FolderAsset[] = [
    {
      id: 'v-human',
      name: 'influencer_talking_head.mp4',
      type: 'video',
      url: 'blob:human',
      duration: 6,
      width: 1080,
      height: 1920,
      sizeBytes: 1024,
      productScore: 30,
      humanPresenceScore: 88, // Should be rejected
      visualTags: ['dropper', 'bottle'],
    },
    {
      id: 'v-product-1',
      name: '01_macro_amber_dropper.mp4',
      type: 'video',
      url: 'blob:prod1',
      duration: 5,
      width: 1080,
      height: 1920,
      sizeBytes: 2048,
      productScore: 96,
      humanPresenceScore: 5,
      visualTags: ['dropper', 'bottle', 'amber'],
    },
    {
      id: 'v-product-2',
      name: '02_serum_texture_splash.mp4',
      type: 'video',
      url: 'blob:prod2',
      duration: 5,
      width: 1080,
      height: 1920,
      sizeBytes: 2048,
      productScore: 92,
      humanPresenceScore: 0,
      visualTags: ['texture', 'splash'],
    },
  ];

  const { segments } = buildJCutVoiceoverTimeline(
    [
      {
        id: 's1',
        text: 'Stop buying watered down serums.',
        rawStart: 0,
        rawEnd: 2.0,
        semanticTopic: 'dropper',
      },
      {
        id: 's2',
        text: 'Watch how fast it penetrates.',
        rawStart: 2.5,
        rawEnd: 4.5,
        semanticTopic: 'unmatched_topic_requiring_fallback',
      },
      {
        id: 's3',
        text: "Comment 'SOLARIS' and we'll DM the link.",
        rawStart: 5.0,
        rawEnd: 7.5,
        semanticTopic: 'texture',
      },
    ],
    defaultPacing
  );

  const { clips, sparseTexts, endCta } = assembleCommercialCut(
    mockAssets,
    segments,
    defaultPacing
  );

  assert.equal(clips.length, 3);
  // Ensure human-heavy clip was never selected
  assert.ok(clips.every((c) => c.assetId !== 'v-human'));

  // Verify all clips use full 9:16 video framing ('fill') and sharp cuts ('hard-cut')
  assert.ok(clips.every((c) => c.visualMode === 'fill'));
  assert.ok(clips.every((c) => c.transitionIn === 'hard-cut'));

  // Sparse text must be strictly minimal (only 1 overlay for 3 segments)
  assert.equal(sparseTexts.length, 1);

  // End CTA must fade toward blackish (>= 0.7), highlight SOLARIS, and use 'Link in Bio' & 'I will send you link in DM'
  assert.equal(endCta.triggerWord, 'SOLARIS');
  assert.equal(endCta.promptHeader, 'Link in Bio');
  assert.equal(endCta.prefixText, 'Comment');
  assert.equal(endCta.suffixText, 'I will send you link in DM');
  assert.ok(endCta.fadeScrimOpacity >= 0.7);
});

test('formatTimecode60Fps formats 60fps timecode accurately', () => {
  assert.equal(formatTimecode60Fps(0), '00:00:00');
  assert.equal(formatTimecode60Fps(12.5), '00:12:30');
});
