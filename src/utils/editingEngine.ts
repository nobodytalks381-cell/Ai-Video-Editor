import type {
  FolderAsset,
  VoiceoverSegment,
  TimelineClip,
  SparseTextLayer,
  EndCtaConfig,
  PacingConfig,
  VisualDisplayMode,
} from '../types/editor.ts';

/**
 * Pure function to extract the CTA trigger word from the final spoken phrase of a voiceover.
 * Handles patterns like:
 * - "Comment 'GLOW' below and we will send you the link in DM"
 * - "Just comment SERUM right now and I'll DM you the link"
 * - "Drop the word HYDRATE in the comments for the direct link"
 */
export function extractCtaTriggerFromTranscript(text: string): {
  isCta: boolean;
  triggerWord: string;
  prefixText: string;
  suffixText: string;
} {
  const clean = text.trim();
  if (!clean) {
    return {
      isCta: false,
      triggerWord: 'LINK',
      prefixText: 'Comment',
      suffixText: 'I will send you link in DM',
    };
  }

  const lower = clean.toLowerCase();
  const hasCtaSignal =
    lower.includes('comment') ||
    lower.includes('dm') ||
    lower.includes('send you') ||
    lower.includes('drop the word') ||
    lower.includes('reply with') ||
    lower.includes('links');

  // 1. Check quoted word after comment/type/drop/reply
  const quotedMatch = clean.match(
    /(?:comment|type|drop|reply(?:\s+with)?)\s+(?:the\s+word\s+)?["'“”‘’]([A-Za-z0-9_-]{2,18})["'“”‘’]/i
  );
  if (quotedMatch && quotedMatch[1]) {
    const word = quotedMatch[1].toUpperCase();
    return {
      isCta: true,
      triggerWord: word,
      prefixText: 'Comment',
      suffixText: 'I will send you link in DM',
    };
  }

  // 2. Check unquoted uppercase word or direct token after "comment [ the word ]"
  const directMatch = clean.match(
    /(?:comment|type|drop\s+the\s+word)\s+(?:the\s+word\s+)?([A-Za-z0-9]{2,16})(?:\s+(?:below|right\s+now|in\s+the\s+comments|and|to|for)|\b)/i
  );
  if (directMatch && directMatch[1]) {
    const candidate = directMatch[1].toUpperCase();
    const stopWords = new Set([
      'BELOW',
      'NOW',
      'THIS',
      'THAT',
      'HERE',
      'THE',
      'AND',
      'FOR',
      'WALL',
    ]);
    if (!stopWords.has(candidate)) {
      return {
        isCta: true,
        triggerWord: candidate,
        prefixText: 'Comment',
        suffixText: 'I will send you link in DM',
      };
    }
  }

  // 3. Fallback: look for any ALL-CAPS word >= 3 chars in the phrase
  const allCapsMatch = clean.match(/\b([A-Z]{3,14})\b/);
  if (
    allCapsMatch &&
    allCapsMatch[1] &&
    allCapsMatch[1] !== 'CTA' &&
    allCapsMatch[1] !== 'WALL'
  ) {
    return {
      isCta: hasCtaSignal,
      triggerWord: allCapsMatch[1],
      prefixText: 'Comment',
      suffixText: 'I will send you link in DM',
    };
  }

  return {
    isCta: hasCtaSignal,
    triggerWord: 'GLOW',
    prefixText: 'Comment',
    suffixText: 'I will send you link in DM',
  };
}

/**
 * Pure function that takes raw voiceover phrases with natural pauses and computes
 * a fast-paced Gen-Z timeline where dead air is stripped and each subsequent speech cut
 * starts `jCutOverlapMs` BEFORE the previous speech ends (microsecond/millisecond J-cut).
 */
export function buildJCutVoiceoverTimeline(
  rawPhrases: Array<{
    id: string;
    text: string;
    rawStart: number;
    rawEnd: number;
    semanticTopic: string;
    matchedAssetId?: string;
    recommendedSourceIn?: number;
  }>,
  pacing: PacingConfig
): {
  segments: VoiceoverSegment[];
  totalAudioDuration: number;
  totalSilenceRemovedSec: number;
} {
  if (rawPhrases.length === 0) {
    return { segments: [], totalAudioDuration: 0, totalSilenceRemovedSec: 0 };
  }

  const jCutSec = Math.max(0, Math.min(0.25, pacing.jCutOverlapMs / 1000));
  const minSilenceSec = Math.max(0, pacing.minSilenceDurationMs / 1000);

  let cursor = 0;
  let totalSilenceRemoved = 0;

  const segments: VoiceoverSegment[] = rawPhrases.map((phrase, idx) => {
    const prevRawEnd = idx === 0 ? 0 : rawPhrases[idx - 1].rawEnd;
    const rawGap = Math.max(0, phrase.rawStart - prevRawEnd);

    // Strip any pause exceeding minSilenceSec
    const silenceRemoved = rawGap > minSilenceSec ? rawGap : rawGap * 0.85;
    totalSilenceRemoved += silenceRemoved;

    // Trim trailing breath inside the phrase itself (6% tighten for snappy Gen-Z cadence)
    const rawPhraseDuration = Math.max(0.4, phrase.rawEnd - phrase.rawStart);
    const tightenedDuration = Number((rawPhraseDuration * 0.94).toFixed(3));

    // Apply J-cut overlap on every segment after the first so next speech starts right before previous finishes
    const appliedJCutMs = idx === 0 ? 0 : pacing.jCutOverlapMs;
    const timelineStart =
      idx === 0 ? 0 : Math.max(0, Number((cursor - jCutSec).toFixed(3)));

    cursor = Number((timelineStart + tightenedDuration).toFixed(3));

    const isLast = idx === rawPhrases.length - 1;
    const ctaInfo = isLast
      ? extractCtaTriggerFromTranscript(phrase.text)
      : { isCta: false, triggerWord: undefined };

    return {
      id: phrase.id,
      index: idx,
      text: phrase.text,
      rawStart: phrase.rawStart,
      rawEnd: phrase.rawEnd,
      silenceRemovedSec: Number(silenceRemoved.toFixed(3)),
      jCutLeadMs: appliedJCutMs,
      timelineStart,
      timelineDuration: tightenedDuration,
      isCtaSegment: isLast || ctaInfo.isCta,
      detectedTriggerWord: isLast ? ctaInfo.triggerWord : undefined,
      semanticTopic: phrase.semanticTopic,
      matchedAssetId: phrase.matchedAssetId,
      recommendedSourceIn: phrase.recommendedSourceIn,
    };
  });

  return {
    segments,
    totalAudioDuration: cursor,
    totalSilenceRemovedSec: Number(totalSilenceRemoved.toFixed(2)),
  };
}

/**
 * Semantic synonym map so spoken dialogue phrases match relevant video clip names & visual tags
 * even when exact words differ (e.g., "spray mist" <-> "blows smoke", "walk, roar" <-> "moves in all directions").
 */
const SEMANTIC_SYNONYM_GROUPS: string[][] = [
  ['mist', 'spray', 'smoke', 'blows', 'steam', 'vapor', 'mouth', 'glowing', 'fire', 'breath'],
  ['walk', 'roar', 'move', 'moves', 'direction', 'directions', 'command', 'remote', 'control', 'action'],
  ['kid', 'kids', 'son', 'child', 'boy', 'love', 'loves', 'play', 'birthday', 'holidays', 'gift', 'favorite'],
  ['realistic', 'real', 'jurassic', 'world', 'trees', 'rocks', 'mini', 'look', 'looks', 'detail'],
  ['battery', 'rechargeable', 'charge', 'usb', 'power', 'test', 'ultimate', 'review', 'buy'],
  ['price', 'range', 'nice', 'worth', 'value', 'money', 'dream', 'lover', 'sitting', 'sit'],
  ['dropper', 'amber', 'bottle', 'serum', 'pipette', 'droplets', 'golden', 'vitamin'],
  ['absorb', 'absorbs', 'texture', 'splash', 'residue', 'fast', 'skin', 'glow', 'radiance'],
];

function expandSemanticTokens(rawText: string): string[] {
  const baseTokens = rawText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  const expanded = new Set<string>(baseTokens);
  for (const tok of baseTokens) {
    for (const group of SEMANTIC_SYNONYM_GROUPS) {
      if (group.some((g) => g.includes(tok) || tok.includes(g))) {
        for (const syn of group) expanded.add(syn);
      }
    }
  }
  return Array.from(expanded);
}

/**
 * Pure function that matches voiceover segments strictly to real VIDEO clips in the folder,
 * rejecting human-heavy clips, matching spoken dialogue semantics to clip tags/filenames,
 * and using clean Gen-Z Sharp Cuts ('hard-cut') and full 9:16 video framing ('fill') throughout.
 */
export function assembleCommercialCut(
  assets: FolderAsset[],
  voiceoverSegments: VoiceoverSegment[],
  pacing: PacingConfig
): {
  clips: TimelineClip[];
  sparseTexts: SparseTextLayer[];
  endCta: EndCtaConfig;
} {
  // Strictly prefer video clips! Never use static images when video clips exist in the folder.
  const videoOnlyAssets = assets.filter((a) => a.type === 'video');
  const visualAssets =
    videoOnlyAssets.length > 0
      ? videoOnlyAssets
      : assets.filter((a) => a.type === 'video' || a.type === 'image');

  // Filter out clips with too many human characters when product-only mode is enabled
  const productFocusedAssets = visualAssets.filter((a) =>
    pacing.rejectHighHumanClips
      ? a.humanPresenceScore <= pacing.maxHumanScoreAllowed
      : true
  );

  const pool =
    productFocusedAssets.length > 0 ? productFocusedAssets : visualAssets;

  // Sort by product sharpness score descending
  const rankedPool = [...pool].sort((a, b) => b.productScore - a.productScore);

  const clips: TimelineClip[] = [];
  const sparseTexts: SparseTextLayer[] = [];

  const usageCount = new Map<string, number>();
  let lastUsedAssetId: string | null = null;

  voiceoverSegments.forEach((seg, idx) => {
    const expandedTokens = expandSemanticTokens(
      `${seg.semanticTopic} ${seg.text}`
    );

    // Score each candidate video clip by how strongly its visualTags and filename match the spoken dialogue beat
    const scoreSemanticMatch = (asset: FolderAsset): number => {
      if (seg.matchedAssetId && asset.id === seg.matchedAssetId) {
        return 1000;
      }
      const assetWords = [
        ...asset.visualTags.map((t) => t.toLowerCase()),
        ...asset.name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2),
      ];
      let matchScore = 0;
      for (const tok of expandedTokens) {
        if (assetWords.some((aw) => aw === tok)) {
          matchScore += 25;
        } else if (assetWords.some((aw) => aw.includes(tok) || tok.includes(aw))) {
          matchScore += 12;
        }
      }
      return matchScore;
    };

    const matchScores = new Map<string, number>();
    for (const a of rankedPool) {
      matchScores.set(a.id, scoreSemanticMatch(a));
    }

    const matchingCandidates = rankedPool.filter(
      (a) => (matchScores.get(a.id) ?? 0) > 0
    );

    const pickBestFromList = (list: FolderAsset[]): FolderAsset | undefined => {
      if (list.length === 0) return undefined;
      const sorted = [...list].sort((a, b) => {
        // Avoid back-to-back identical clips so every cut feels like a fresh Gen-Z sharp cut
        if (list.length > 1) {
          if (a.id === lastUsedAssetId && b.id !== lastUsedAssetId) return 1;
          if (b.id === lastUsedAssetId && a.id !== lastUsedAssetId) return -1;
        }
        const countA = usageCount.get(a.id) ?? 0;
        const countB = usageCount.get(b.id) ?? 0;
        if (countA !== countB) return countA - countB;

        const semA = matchScores.get(a.id) ?? 0;
        const semB = matchScores.get(b.id) ?? 0;
        if (semA !== semB) return semB - semA;

        return b.productScore - a.productScore;
      });
      return sorted[0];
    };

    let directMatch = pickBestFromList(matchingCandidates);
    const isFallbackFill = !directMatch;
    if (!directMatch && rankedPool.length > 0) {
      directMatch = pickBestFromList(rankedPool);
    }

    if (directMatch) {
      const priorUses = usageCount.get(directMatch.id) ?? 0;
      usageCount.set(directMatch.id, priorUses + 1);
      lastUsedAssetId = directMatch.id;

      const secondaryCandidates = rankedPool.filter(
        (a) => a.id !== directMatch!.id
      );
      const secondaryAsset =
        secondaryCandidates.length > 0
          ? secondaryCandidates[idx % secondaryCandidates.length]
          : directMatch;

      // Always use Full 9:16 Video Framing ('fill') and Sharp Cuts ('hard-cut') — never static images or B-roll split boxes!
      const visualMode: VisualDisplayMode = 'fill';
      const playbackRate = 1.0;

      // Make sequential video cuts contiguous so FFmpeg segment concatenation has zero cumulative J-cut drift
      const nextSeg =
        idx + 1 < voiceoverSegments.length ? voiceoverSegments[idx + 1] : null;
      const contiguousClipDur = nextSeg
        ? Number(Math.max(0.45, nextSeg.timelineStart - seg.timelineStart).toFixed(3))
        : Number(Math.max(2.4, seg.timelineDuration).toFixed(3));

      const clipDur = Math.max(1.0, directMatch.duration || 5.0);
      const neededSourceDur = contiguousClipDur * playbackRate;
      const maxSourceStart = Math.max(0, clipDur - neededSourceDur - 0.15);

      // For longer clips (> 4.5s), skip the first 1.2s (often a static cover frame in social/Amazon clips)
      // and advance by 3.4s on subsequent uses so each cut shows a distinct moving action window!
      const baseActionStart = clipDur > 4.5 ? 1.2 : 0;
      const rawDesiredOffset =
        typeof seg.recommendedSourceIn === 'number' && priorUses === 0
          ? seg.recommendedSourceIn
          : baseActionStart + priorUses * 3.4;

      const sourceIn =
        maxSourceStart > 0.15
          ? Number(
              Math.min(
                maxSourceStart,
                rawDesiredOffset % (maxSourceStart + 0.01)
              ).toFixed(2)
            )
          : 0;
      const sourceOut = Number((sourceIn + contiguousClipDur).toFixed(2));

      clips.push({
        id: `clip-${seg.id}`,
        assetId: directMatch.id,
        secondaryAssetId: secondaryAsset?.id,
        track: 'main',
        label: directMatch.name,
        timelineStart: seg.timelineStart,
        duration: contiguousClipDur,
        sourceIn,
        sourceOut,
        playbackRate,
        visualMode,
        transitionIn: 'hard-cut',
        zoomIntensity: 1.0,
        filterBrightness: seg.isCtaSegment ? 0.92 : 1.02,
        filterContrast: 1.05,
        matchReason: isFallbackFill
          ? `Sharp cut to ${directMatch.name.split('/').pop()} (${directMatch.productScore}% focus)`
          : `Matched dialogue "${seg.text.slice(0, 38)}..." to ${directMatch.name.split('/').pop()}`,
        isFallbackFill,
      });
    }

    // Sparse text policy: Do NOT clutter every segment with text.
    if (
      !seg.isCtaSegment &&
      pacing.textOverlayDensity !== 'none' &&
      (idx === 0 || (pacing.textOverlayDensity === 'moderate' && idx === 2))
    ) {
      const cleanWords = seg.text
        .replace(/[^\w\s%]/g, '')
        .trim()
        .split(/\s+/)
        .slice(0, pacing.maxWordsPerTextOverlay);
      const shortPhrase = cleanWords.join(' ').toUpperCase();
      const highlightWord =
        cleanWords.sort((a, b) => b.length - a.length)[0]?.toUpperCase() || '';

      sparseTexts.push({
        id: `txt-${seg.id}`,
        text: shortPhrase,
        highlightWord,
        timelineStart: seg.timelineStart,
        duration: Math.min(1.6, seg.timelineDuration * 0.85),
        position: idx === 0 ? 'top' : 'center',
        animation: idx === 0 ? 'kinetic-punch' : 'pop',
        accentColor: '#FACC15',
      });
    }
  });

  // Configure the Centered End-of-Video Comment CTA overlay from the final clip & voiceover segment
  const lastSeg = voiceoverSegments[voiceoverSegments.length - 1];
  const lastClip = clips[clips.length - 1];
  const ctaExtracted = lastSeg
    ? extractCtaTriggerFromTranscript(lastSeg.text)
    : {
        isCta: true,
        triggerWord: 'GLOW',
        prefixText: 'Comment',
        suffixText: 'I will send you link in DM',
      };

  const endCta: EndCtaConfig = {
    enabled: true,
    startTime: lastClip
      ? lastClip.timelineStart
      : lastSeg
      ? lastSeg.timelineStart
      : 0,
    duration: lastClip
      ? lastClip.duration
      : lastSeg
      ? Math.max(2.4, lastSeg.timelineDuration)
      : 3.2,
    fadeScrimOpacity: 0.78, // Fades main video toward blackish
    promptHeader: 'Link in Bio',
    prefixText: ctaExtracted.prefixText || 'Comment',
    triggerWord: ctaExtracted.triggerWord,
    suffixText: ctaExtracted.suffixText || 'I will send you link in DM',
    highlightColor: '#FACC15', // Signal yellow or white
    wordScale: 1.38,
    showCommentBadge: true,
  };

  return { clips, sparseTexts, endCta };
}

/**
 * Formats seconds into SMPTE 60fps timecode (MM:SS:FF)
 */
export function formatTimecode60Fps(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}
