import type {
  AdProjectState,
  FolderAsset,
  TimelineClip,
  SparseTextLayer,
  VoiceoverSegment,
} from '../types/editor.ts';

/**
 * Draws an individual asset (real HTMLVideoElement or HTMLImageElement from the user's folder)
 * into a target rectangle on the 9:16 Studio canvas.
 */
function drawAssetIntoRect(
  ctx: CanvasRenderingContext2D,
  asset: FolderAsset | undefined,
  mediaCache: Map<string, HTMLVideoElement | HTMLImageElement>,
  x: number,
  y: number,
  w: number,
  h: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);

  if (asset) {
    const cachedEl = mediaCache.get(asset.id);
    // Note: readyState >= 1 && videoWidth > 0 ensures the decoded video frame continues to draw even while seeking!
    if (
      cachedEl instanceof HTMLVideoElement &&
      cachedEl.readyState >= 1 &&
      cachedEl.videoWidth > 0
    ) {
      const vw = cachedEl.videoWidth;
      const vh = cachedEl.videoHeight || h;
      const scale = Math.max(w / vw, h / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      try {
        ctx.drawImage(cachedEl, (w - dw) * 0.5, (h - dh) * 0.5, dw, dh);
        ctx.restore();
        return;
      } catch {
        // continue to fallback if video frame not yet ready
      }
    }

    if (
      cachedEl instanceof HTMLImageElement &&
      cachedEl.complete &&
      cachedEl.naturalWidth > 0
    ) {
      const iw = cachedEl.naturalWidth;
      const ih = cachedEl.naturalHeight || h;
      const scale = Math.max(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(cachedEl, (w - dw) * 0.5, (h - dh) * 0.5, dw, dh);
      ctx.restore();
      return;
    }

    // Check if we cached the extracted keyframe thumbnail while the video stream is seeking
    const thumbEl = mediaCache.get(`${asset.id}-thumb`);
    if (
      thumbEl instanceof HTMLImageElement &&
      thumbEl.complete &&
      thumbEl.naturalWidth > 0
    ) {
      const iw = thumbEl.naturalWidth;
      const ih = thumbEl.naturalHeight || h;
      const scale = Math.max(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(thumbEl, (w - dw) * 0.5, (h - dh) * 0.5, dw, dh);
      ctx.restore();
      return;
    }
  }

  // Clean neutral studio frame while video decodes (no fake placeholder product graphics)
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0F131F');
  grad.addColorStop(1, '#07090F');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (asset?.name) {
    ctx.fillStyle = '#94A3B8';
    ctx.font = `600 ${Math.round(w * 0.032)}px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(
      asset.name.split('/').pop() || 'Loading Clip...',
      w * 0.5,
      h * 0.48
    );
  }

  ctx.restore();
}

/**
 * Master 60fps 9:16 Commercial Frame Compositor for the Interactive Editing Studio.
 */
export function renderCommercialFrame(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  currentTime: number;
  project: AdProjectState;
  mediaCache: Map<string, HTMLVideoElement | HTMLImageElement>;
  showSafeZones?: boolean;
}) {
  const {
    ctx,
    width: w,
    height: h,
    currentTime,
    project,
    mediaCache,
    showSafeZones,
  } = params;

  ctx.save();
  ctx.fillStyle = '#07080C';
  ctx.fillRect(0, 0, w, h);

  // 1. Find active clip on main track
  const activeClip: TimelineClip | undefined =
    project.clips.find(
      (c) =>
        currentTime >= c.timelineStart &&
        currentTime <= c.timelineStart + c.duration
    ) || project.clips[project.clips.length - 1];

  if (activeClip) {
    const clipElapsed = Math.max(0, currentTime - activeClip.timelineStart);
    const clipProgress = Math.min(
      1,
      clipElapsed / Math.max(0.1, activeClip.duration)
    );
    const primaryAsset = project.assets.find(
      (a) => a.id === activeClip.assetId
    );
    const secondaryAsset = project.assets.find(
      (a) => a.id === (activeClip.secondaryAssetId || activeClip.assetId)
    );

    ctx.save();

    // Transition entry effect (first 180ms of clip)
    const transDuration = 0.18;
    const transProgress = Math.min(1, clipElapsed / transDuration);
    if (transProgress < 1) {
      if (activeClip.transitionIn === 'whip-pan') {
        const offsetX = (1 - Math.pow(transProgress, 2)) * w * 0.35;
        ctx.translate(offsetX, 0);
      } else if (activeClip.transitionIn === 'zoom-punch') {
        const punchScale = 1.22 - 0.22 * transProgress;
        ctx.translate(w * 0.5, h * 0.5);
        ctx.scale(punchScale, punchScale);
        ctx.translate(-w * 0.5, -h * 0.5);
      }
    }

    // Dynamic zoom / Ken Burns motion
    let scale = 1.0;
    if (
      activeClip.visualMode === 'dynamic-zoom' ||
      activeClip.visualMode === 'ref-showcase'
    ) {
      scale = 1 + (activeClip.zoomIntensity - 1) * clipProgress;
    } else if (activeClip.visualMode === 'speed-ramp') {
      scale = 1.04 + Math.sin(clipProgress * Math.PI) * 0.12;
    }

    ctx.translate(w * 0.5, h * 0.5);
    ctx.scale(scale, scale);
    ctx.translate(-w * 0.5, -h * 0.5);

    if (activeClip.visualMode === 'split-2up') {
      const halfH = h * 0.5;
      drawAssetIntoRect(ctx, primaryAsset, mediaCache, 0, 0, w, halfH);
      drawAssetIntoRect(ctx, secondaryAsset, mediaCache, 0, halfH, w, halfH);

      ctx.fillStyle = '#FACC15';
      ctx.fillRect(0, halfH - 2, w, 4);
    } else if (activeClip.visualMode === 'split-3up') {
      const thirdH = h / 3;
      drawAssetIntoRect(ctx, primaryAsset, mediaCache, 0, 0, w, thirdH);
      drawAssetIntoRect(ctx, secondaryAsset, mediaCache, 0, thirdH, w, thirdH);
      drawAssetIntoRect(
        ctx,
        primaryAsset,
        mediaCache,
        0,
        thirdH * 2,
        w,
        thirdH
      );

      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(0, thirdH - 1, w, 2);
      ctx.fillRect(0, thirdH * 2 - 1, w, 2);
    } else {
      drawAssetIntoRect(ctx, primaryAsset, mediaCache, 0, 0, w, h);
    }

    if (activeClip.transitionIn === 'flash-cut' && transProgress < 1) {
      ctx.fillStyle = `rgba(255, 255, 255, ${(1 - transProgress) * 0.55})`;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.restore();
  }

  // 2. Render Sparse Kinetic Text Overlays
  const activeText: SparseTextLayer | undefined = project.sparseTexts.find(
    (t) =>
      currentTime >= t.timelineStart &&
      currentTime <= t.timelineStart + t.duration
  );

  const isInCtaWindow =
    project.endCta.enabled &&
    currentTime >= project.endCta.startTime &&
    currentTime <= project.endCta.startTime + project.endCta.duration + 0.5;

  if (activeText && !isInCtaWindow) {
    const textElapsed = Math.max(0, currentTime - activeText.timelineStart);
    const popScale = Math.min(1, 0.78 + (textElapsed / 0.12) * 0.22);

    const anchorY =
      activeText.position === 'top'
        ? h * 0.18
        : activeText.position === 'center'
        ? h * 0.48
        : h * 0.74;

    ctx.save();
    ctx.translate(w * 0.5, anchorY);
    ctx.scale(popScale, popScale);

    ctx.fillStyle = 'rgba(9, 10, 15, 0.82)';
    const boxW = w * 0.82;
    const boxH = h * 0.075;
    ctx.beginPath();
    ctx.roundRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH, w * 0.025);
    ctx.fill();

    ctx.font = `800 ${Math.round(w * 0.054)}px "Outfit", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = activeText.accentColor || '#FACC15';
    ctx.fillText(activeText.text, 0, 2);
    ctx.restore();
  }

  // 3. Render Signature End-of-Video Comment CTA Screen (Centered in the 9:16 frame)
  if (isInCtaWindow) {
    const ctaElapsed = Math.max(0, currentTime - project.endCta.startTime);
    const fadeRamp = Math.min(1, ctaElapsed / 0.35);
    const targetScrim = project.endCta.fadeScrimOpacity;
    const currentScrim = Number((targetScrim * fadeRamp).toFixed(3));

    // Fade main video toward blackish
    ctx.fillStyle = `rgba(6, 7, 11, ${currentScrim})`;
    ctx.fillRect(0, 0, w, h);

    const cardW = w * 0.88;
    const cardH = h * 0.25;
    const cardX = (w - cardW) * 0.5;
    const cardY = (h - cardH) * 0.5; // Dead-center vertically on the 9:16 canvas

    ctx.save();
    ctx.fillStyle = 'rgba(17, 19, 28, 0.95)';
    ctx.strokeStyle =
      project.endCta.highlightColor === '#FACC15'
        ? 'rgba(250, 204, 21, 0.78)'
        : 'rgba(255, 255, 255, 0.78)';
    ctx.lineWidth = Math.max(2, w * 0.005);

    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, w * 0.036);
    ctx.fill();
    ctx.stroke();

    const headerLabel = (project.endCta.promptHeader || 'Link in Bio').trim();
    if (headerLabel) {
      ctx.fillStyle = '#FACC15';
      ctx.font = `600 ${Math.round(w * 0.028)}px "Plus Jakarta Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(headerLabel, w * 0.5, cardY + cardH * 0.18);
    }

    const baseFontPx = Math.round(w * 0.05);
    const wordScale = project.endCta.wordScale || 1.38;
    const keywordFontPx = Math.round(baseFontPx * wordScale);

    ctx.fillStyle = '#F8FAFC';
    ctx.font = `700 ${baseFontPx}px "Outfit", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(
      (project.endCta.prefixText || 'Comment').replace(/:$/, ''),
      w * 0.5,
      cardY + cardH * 0.38
    );

    ctx.font = `800 ${keywordFontPx}px "Outfit", sans-serif`;
    const triggerText = `"${project.endCta.triggerWord.toUpperCase()}"`;
    const textMetrics = ctx.measureText(triggerText);
    const highlightPadX = w * 0.05;
    const highlightW = textMetrics.width + highlightPadX * 2;
    const highlightH = keywordFontPx * 1.32;
    const highlightX = (w - highlightW) * 0.5;
    const highlightY = cardY + cardH * 0.62 - highlightH * 0.5;

    ctx.fillStyle =
      project.endCta.highlightColor === '#FACC15'
        ? 'rgba(250, 204, 21, 0.22)'
        : 'rgba(255, 255, 255, 0.22)';
    ctx.beginPath();
    ctx.roundRect(highlightX, highlightY, highlightW, highlightH, w * 0.022);
    ctx.fill();

    ctx.fillStyle = project.endCta.highlightColor;
    ctx.textBaseline = 'middle';
    ctx.fillText(triggerText, w * 0.5, cardY + cardH * 0.62);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#E2E8F0';
    ctx.font = `600 ${Math.round(w * 0.033)}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText(
      project.endCta.suffixText || 'I will send you link in DM',
      w * 0.5,
      cardY + cardH * 0.89
    );

    ctx.restore();
  }

  // 4. Active voiceover caption bar at bottom safe zone
  const activeVo: VoiceoverSegment | undefined = project.voiceoverSegments.find(
    (s) =>
      currentTime >= s.timelineStart &&
      currentTime <= s.timelineStart + s.timelineDuration
  );
  if (activeVo && !isInCtaWindow) {
    ctx.save();
    const grad = ctx.createLinearGradient(0, h * 0.78, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h * 0.78, w, h * 0.22);

    ctx.fillStyle = '#F8FAFC';
    ctx.font = `600 ${Math.round(w * 0.033)}px "Plus Jakarta Sans", sans-serif`;
    ctx.textAlign = 'center';

    const words = activeVo.text.split(' ');
    const mid = Math.ceil(words.length / 2);
    const line1 = words.slice(0, mid).join(' ');
    const line2 = words.slice(mid).join(' ');
    ctx.fillText(line1, w * 0.5, h * 0.87);
    if (line2) {
      ctx.fillText(line2, w * 0.5, h * 0.915);
    }
    ctx.restore();
  }

  // 5. Optional 9:16 Safe Zone Guides
  if (showSafeZones) {
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.strokeRect(w * 0.06, h * 0.08, w * 0.88, h * 0.78);
    ctx.restore();
  }

  ctx.restore();
}
