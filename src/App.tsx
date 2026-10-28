import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  FolderUp,
  Film,
  Volume2,
  Type as TypeIcon,
  MessageSquare,
  CheckCircle2,
  Download,
  RefreshCw,
  X,
} from 'lucide-react';
import { TopBar, type AppWorkflowStage } from './components/TopBar.tsx';
import {
  StreamlinedHomeFlow,
  BACKEND_PROCESSING_SLIDES,
} from './components/StreamlinedHomeFlow.tsx';
import { VerticalCanvasViewport } from './components/VerticalCanvasViewport.tsx';
import {
  RightInspectorPanel,
  type InspectorMode,
} from './components/RightInspectorPanel.tsx';
import { MultiTrackTimeline } from './components/MultiTrackTimeline.tsx';
import {
  createDemoAdProject,
  DEFAULT_PACING_CONFIG,
} from './utils/demoFolderKit.ts';
import {
  buildJCutVoiceoverTimeline,
  assembleCommercialCut,
} from './utils/editingEngine.ts';
import { renderCommercialFrame } from './utils/canvasCompositor.ts';
import {
  probeAndLoadVideoElement,
  probeAndLoadImageElement,
} from './utils/mediaProcessor.ts';
import type {
  AdProjectState,
  FolderAsset,
  TimelineClip,
  EndCtaConfig,
  PacingConfig,
  SparseTextLayer,
} from './types/editor.ts';

export default function App() {
  const [project, setProject] = useState<AdProjectState>(() =>
    createDemoAdProject(DEFAULT_PACING_CONFIG)
  );
  const [hasLoadedProject, setHasLoadedProject] = useState<boolean>(false);
  const [hasUnrenderedStudioEdits, setHasUnrenderedStudioEdits] =
    useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [stage, setStage] = useState<AppWorkflowStage>('dropzone');
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);

  const [telemetrySummary, setTelemetrySummary] = useState({
    audioFileDetected: 'voiceover_audio.wav',
    videoClipsDetected: 0,
    totalSilenceRemovedSec: 0,
    jCutOverlapMs: 48,
    extractedTriggerWord: 'LINK',
  });

  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('clip');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showSafeZones, setShowSafeZones] = useState<boolean>(false);
  const [exportModalOpen, setExportModalOpen] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);
  const [exportedVideoSizeBytes, setExportedVideoSizeBytes] =
    useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const studioAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaCache = useMemo(
    () => new Map<string, HTMLVideoElement | HTMLImageElement>(),
    []
  );

  /**
   * Fetches the final rendered 1080p 60fps MP4 from backend in 4MB chunks and builds a local RAM Blob URL.
   * This bypasses Cloud Run's 32MB response limit and guarantees instant <video> playback and valid MP4 downloads.
   */
  const fetchFinalMp4AsLocalBlobUrl = useCallback(
    async (
      jobId: string
    ): Promise<{ blobUrl: string; sizeBytes: number } | null> => {
      try {
        const metaRes = await fetch(`/api/jobs/${jobId}/video-info`);
        if (metaRes.ok) {
          const meta = await metaRes.json();
          const totalSize = Number(meta.sizeBytes || meta.size) || 0;
          if (totalSize > 10000) {
            const CHUNK = 4 * 1024 * 1024; // 4 MB per chunk
            const buffers: ArrayBuffer[] = [];
            for (let start = 0; start < totalSize; start += CHUNK) {
              const end = Math.min(totalSize - 1, start + CHUNK - 1);
              const chunkRes = await fetch(
                `/api/jobs/${jobId}/video-chunk?start=${start}&end=${end}`
              );
              if (!chunkRes.ok) {
                throw new Error(`Chunk fetch failed at byte ${start}`);
              }
              const buf = await chunkRes.arrayBuffer();
              buffers.push(buf);
            }
            const mp4Blob = new Blob(buffers, { type: 'video/mp4' });
            if (mp4Blob.size > 10000) {
              return {
                blobUrl: URL.createObjectURL(mp4Blob),
                sizeBytes: mp4Blob.size,
              };
            }
          }
        }

        // Fallback direct fetch if video-info is unavailable
        const directRes = await fetch(`/api/jobs/${jobId}/final.mp4`);
        if (directRes.ok) {
          const blob = await directRes.blob();
          if (blob.size > 10000) {
            const mp4Blob = new Blob([blob], { type: 'video/mp4' });
            return {
              blobUrl: URL.createObjectURL(mp4Blob),
              sizeBytes: mp4Blob.size,
            };
          }
        }
      } catch (err) {
        console.error('Failed to pre-fetch rendered MP4 into local Blob:', err);
      }
      return null;
    },
    []
  );

  const repaintStudioCanvas = useCallback(
    (timeToDraw: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      renderCommercialFrame({
        ctx,
        width: canvas.width,
        height: canvas.height,
        currentTime: timeToDraw,
        project,
        mediaCache,
        showSafeZones,
      });
    },
    [project, mediaCache, showSafeZones]
  );

  // Preload all real video clips, images, and keyframe thumbnails into mediaCache for the Editing Studio
  const preloadProjectMediaForStudio = useCallback(
    async (
      loadedProject: AdProjectState,
      localBlobUrls?: Map<string, string>
    ) => {
      mediaCache.clear();

      // Load edited J-cut voiceover audio for Studio playback
      if (loadedProject.editedAudioUrl) {
        const audio = new Audio(loadedProject.editedAudioUrl);
        audio.preload = 'auto';
        studioAudioRef.current = audio;
      } else {
        const audioAsset = loadedProject.assets.find((a) => a.type === 'audio');
        if (audioAsset?.url) {
          const audio = new Audio(audioAsset.url);
          audio.preload = 'auto';
          studioAudioRef.current = audio;
        }
      }

      await Promise.all(
        loadedProject.assets.map(async (asset: FolderAsset) => {
          const baseName = asset.name.split('/').pop() || asset.name;
          const preferredUrl =
            localBlobUrls?.get(asset.name) ||
            localBlobUrls?.get(baseName) ||
            asset.serverUrl ||
            asset.url;

          if (asset.thumbnailUrl) {
            const thumb = await probeAndLoadImageElement(asset.thumbnailUrl);
            mediaCache.set(`${asset.id}-thumb`, thumb.element);
          }

          if (asset.type === 'video' && preferredUrl) {
            const probed = await probeAndLoadVideoElement(preferredUrl);
            mediaCache.set(asset.id, probed.element);
          } else if (asset.type === 'image' && preferredUrl) {
            const probedImg = await probeAndLoadImageElement(preferredUrl);
            mediaCache.set(asset.id, probedImg.element);
          }
        })
      );

      repaintStudioCanvas(0);
    },
    [mediaCache, repaintStudioCanvas]
  );

  // Synchronize HTMLVideoElements to currentTime during Studio scrubbing & live playback
  useEffect(() => {
    if (stage !== 'studio') return;

    const activeClip = project.clips.find(
      (c) =>
        currentTime >= c.timelineStart &&
        currentTime <= c.timelineStart + c.duration
    );

    // Pause any non-active video elements
    for (const [key, el] of mediaCache.entries()) {
      if (
        el instanceof HTMLVideoElement &&
        key !== activeClip?.assetId &&
        key !== activeClip?.secondaryAssetId
      ) {
        if (!el.paused) el.pause();
      }
    }

    if (activeClip) {
      const clipElapsed = Math.max(0, currentTime - activeClip.timelineStart);
      const targetMediaTime =
        activeClip.sourceIn + clipElapsed * activeClip.playbackRate;

      const syncVideoElement = (
        vid: HTMLVideoElement,
        targetSec: number,
        rate: number
      ) => {
        const safeDur =
          Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 10;
        const clamped = Math.max(
          0,
          Math.min(safeDur - 0.05, targetSec % safeDur)
        );

        if (isPlaying) {
          vid.playbackRate = Math.max(0.5, Math.min(2.5, rate || 1));
          if (Math.abs(vid.currentTime - clamped) > 0.35) {
            try {
              vid.currentTime = clamped;
            } catch {
              // ignore
            }
          }
          if (vid.paused) {
            vid.play().catch(() => {});
          }
        } else {
          if (!vid.paused) vid.pause();
          if (Math.abs(vid.currentTime - clamped) > 0.04) {
            const onSeekDone = () => {
              vid.removeEventListener('seeked', onSeekDone);
              repaintStudioCanvas(currentTime);
            };
            vid.addEventListener('seeked', onSeekDone);
            try {
              vid.currentTime = clamped;
            } catch {
              vid.removeEventListener('seeked', onSeekDone);
            }
          }
        }
      };

      const primaryEl = mediaCache.get(activeClip.assetId);
      if (primaryEl instanceof HTMLVideoElement) {
        syncVideoElement(primaryEl, targetMediaTime, activeClip.playbackRate);
      }

      if (activeClip.secondaryAssetId) {
        const secEl = mediaCache.get(activeClip.secondaryAssetId);
        if (secEl instanceof HTMLVideoElement) {
          syncVideoElement(
            secEl,
            targetMediaTime + 0.8,
            activeClip.playbackRate
          );
        }
      }
    }

    repaintStudioCanvas(currentTime);
  }, [stage, currentTime, isPlaying, project, mediaCache, repaintStudioCanvas]);

  // Play/Pause the real edited J-cut voiceover audio when playing inside the Editing Studio (only when canvas mode is active)
  useEffect(() => {
    const audioEl = studioAudioRef.current;
    if (!audioEl) return;

    const usingRenderedStudioVideo = Boolean(
      exportedVideoUrl && !hasUnrenderedStudioEdits && !showSafeZones
    );

    if (stage !== 'studio' || !isPlaying || usingRenderedStudioVideo) {
      audioEl.pause();
      return;
    }

    try {
      if (Math.abs(audioEl.currentTime - currentTime) > 0.25) {
        audioEl.currentTime = Math.max(0, currentTime);
      }
      audioEl.play().catch(() => {});
    } catch {
      // ignore autoplay restriction
    }

    return () => {
      audioEl.pause();
    };
  }, [
    isPlaying,
    stage,
    currentTime,
    exportedVideoUrl,
    hasUnrenderedStudioEdits,
    showSafeZones,
  ]);

  // 60fps Playback Loop for the Editing Studio timeline (when using live canvas preview)
  useEffect(() => {
    const usingRenderedStudioVideo = Boolean(
      exportedVideoUrl && !hasUnrenderedStudioEdits && !showSafeZones
    );
    if (!isPlaying || stage !== 'studio' || usingRenderedStudioVideo) return;

    const frameIntervalMs = 1000 / 60;
    let lastTick = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const deltaSec = (now - lastTick) / 1000;
      if (now - lastTick >= frameIntervalMs) {
        lastTick = now;
        setCurrentTime((prev) => {
          const next = prev + deltaSec;
          if (next >= project.totalDuration) {
            setIsPlaying(false);
            return 0;
          }
          return Number(next.toFixed(3));
        });
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    isPlaying,
    stage,
    project.totalDuration,
    exportedVideoUrl,
    hasUnrenderedStudioEdits,
    showSafeZones,
  ]);

  // Upload dropped folder files to the Backend FFmpeg + Gemini pipeline using 4MB chunks + async polling
  const handleFolderDropped = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setUploadError(null);
    setIsPlaying(false);
    setStage('processing');
    setActiveSlideIndex(0);

    const firstPath =
      (files[0] as any).webkitRelativePath ||
      (files[0] as any).relativePath ||
      files[0].name;
    const detectedFolder = firstPath.includes('/')
      ? firstPath.split('/')[0]
      : files[0].name.replace(/\.(zip|tar(\.gz)?|tgz)$/i, '') ||
        'Product_Commercial_Folder';

    setProject((prev) => ({ ...prev, folderName: detectedFolder }));

    const localBlobUrls = new Map<string, string>();
    for (const file of files) {
      const relPath =
        (file as any).webkitRelativePath ||
        (file as any).relativePath ||
        file.name;
      const blobUrl = URL.createObjectURL(file);
      localBlobUrls.set(relPath, blobUrl);
      localBlobUrls.set(file.name, blobUrl);
    }

    try {
      // 1. Initialize chunked job session on backend
      const initRes = await fetch('/api/jobs/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName: detectedFolder,
          pacing: project.pacing,
        }),
      });

      if (!initRes.ok) {
        const errData = await initRes.json().catch(() => ({}));
        throw new Error(
          errData.error || 'Could not initialize upload session on backend.'
        );
      }

      const { jobId } = await initRes.json();

      // 2. Upload each file in 4MB chunks so we never hit proxy 413 Payload Too Large limits
      const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB
      for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
        const file = files[fileIdx];
        const relPath =
          (file as any).webkitRelativePath ||
          (file as any).relativePath ||
          file.name;
        const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));

        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
          const start = chunkIdx * CHUNK_SIZE;
          const end = Math.min(file.size, start + CHUNK_SIZE);
          const blobSlice = file.slice(start, end);

          const chunkForm = new FormData();
          chunkForm.append('fileIndex', String(fileIdx));
          chunkForm.append('chunkIndex', String(chunkIdx));
          chunkForm.append('totalChunks', String(totalChunks));
          chunkForm.append('fileName', file.name);
          chunkForm.append('relativePath', relPath);
          chunkForm.append('mimeType', file.type || '');
          chunkForm.append('chunk', blobSlice, file.name);

          const chunkRes = await fetch(`/api/jobs/${jobId}/upload-chunk`, {
            method: 'POST',
            body: chunkForm,
          });

          if (!chunkRes.ok) {
            const errData = await chunkRes.json().catch(() => ({}));
            throw new Error(
              errData.error || `Failed uploading file ${file.name}.`
            );
          }
        }
      }

      // 3. Start async backend FFmpeg + Gemini pipeline
      const startRes = await fetch(`/api/jobs/${jobId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!startRes.ok) {
        const errData = await startRes.json().catch(() => ({}));
        throw new Error(
          errData.error || 'Failed to start backend video processing pipeline.'
        );
      }

      // 4. Poll /api/jobs/:jobId/status until completed or error (prevents proxy 504 timeouts)
      let completedData: any = null;
      const maxPollAttempts = 240; // Up to ~2.5 minutes for large 60fps renders
      for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, 650));
        const statusRes = await fetch(`/api/jobs/${jobId}/status`);
        if (!statusRes.ok) continue;

        const statusPayload = await statusRes.json();
        if (typeof statusPayload.stepIndex === 'number') {
          setActiveSlideIndex(
            Math.min(
              BACKEND_PROCESSING_SLIDES.length - 1,
              Math.max(0, statusPayload.stepIndex)
            )
          );
        }

        if (statusPayload.status === 'error') {
          throw new Error(
            statusPayload.error ||
              'Backend failed to process the uploaded folder.'
          );
        }

        if (statusPayload.status === 'completed' && statusPayload.result) {
          completedData = statusPayload.result;
          break;
        }
      }

      if (!completedData) {
        throw new Error('Video rendering timed out on the backend.');
      }

      setActiveSlideIndex(BACKEND_PROCESSING_SLIDES.length - 1);

      if (completedData.project) {
        // Pre-fetch the rendered MP4 in 4MB chunks into a verified local Blob URL
        const fetchedMp4 = await fetchFinalMp4AsLocalBlobUrl(
          completedData.jobId
        );
        const finalPlayableUrl =
          fetchedMp4?.blobUrl || `/api/jobs/${completedData.jobId}/final.mp4`;

        const hydratedProject: AdProjectState = {
          ...completedData.project,
          renderedVideoUrl: finalPlayableUrl,
        };

        setProject(hydratedProject);
        setSelectedClipId(hydratedProject.clips[0]?.id || null);
        setHasLoadedProject(true);
        setHasUnrenderedStudioEdits(false);
        setExportedVideoUrl(finalPlayableUrl);
        setExportedVideoSizeBytes(fetchedMp4?.sizeBytes || 0);

        if (completedData.telemetry) {
          setTelemetrySummary(completedData.telemetry);
        }

        await preloadProjectMediaForStudio(hydratedProject, localBlobUrls);
        setCurrentTime(0);
        setStage('ready');
      }
    } catch (err: any) {
      setUploadError(
        err?.message ||
          'Could not process the folder. Make sure it contains video clips (.mp4/.mov) and an audio file (.mp3/.wav/.m4a).'
      );
      setStage('dropzone');
    }
  };

  // Run the backend sample folder generator (creates real MP4 clips + WAV voiceover on disk and runs FFmpeg)
  const handleRunSampleFolderOnBackend = async () => {
    setUploadError(null);
    setIsPlaying(false);
    setProject((prev) => ({ ...prev, folderName: 'AeroPulse_Pro_Ad_Folder' }));
    setStage('processing');
    setActiveSlideIndex(0);

    const slideTimer = setInterval(() => {
      setActiveSlideIndex((prev) =>
        prev < BACKEND_PROCESSING_SLIDES.length - 1 ? prev + 1 : prev
      );
    }, 950);

    try {
      const response = await fetch('/api/jobs/sample-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pacing: project.pacing }),
      });

      clearInterval(slideTimer);
      setActiveSlideIndex(BACKEND_PROCESSING_SLIDES.length - 1);

      if (!response.ok) {
        throw new Error('Failed to generate sample folder on backend.');
      }

      const data = await response.json();
      if (data.project) {
        const fetchedMp4 = await fetchFinalMp4AsLocalBlobUrl(data.jobId);
        const finalPlayableUrl =
          fetchedMp4?.blobUrl || `/api/jobs/${data.jobId}/final.mp4`;

        const hydratedProject: AdProjectState = {
          ...data.project,
          renderedVideoUrl: finalPlayableUrl,
        };

        setProject(hydratedProject);
        setSelectedClipId(hydratedProject.clips[0]?.id || null);
        setHasLoadedProject(true);
        setHasUnrenderedStudioEdits(false);
        setExportedVideoUrl(finalPlayableUrl);
        setExportedVideoSizeBytes(fetchedMp4?.sizeBytes || 0);

        if (data.telemetry) {
          setTelemetrySummary(data.telemetry);
        }

        await preloadProjectMediaForStudio(hydratedProject);
        setCurrentTime(0);
        setStage('ready');
      }
    } catch (err: any) {
      clearInterval(slideTimer);
      setUploadError(err?.message || 'Sample folder generation failed.');
      setStage('dropzone');
    }
  };

  // Manual Studio Layer Edit Handlers (marks hasUnrenderedStudioEdits = true so Export re-runs FFmpeg on backend)
  const handleUpdateClip = (clipId: string, patch: Partial<TimelineClip>) => {
    setHasUnrenderedStudioEdits(true);
    setProject((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
    }));
  };

  const handleDeleteClip = (clipId: string) => {
    setHasUnrenderedStudioEdits(true);
    setProject((prev) => {
      if (prev.clips.length <= 1) return prev;
      return { ...prev, clips: prev.clips.filter((c) => c.id !== clipId) };
    });
  };

  const handleSplitAtPlayhead = () => {
    setHasUnrenderedStudioEdits(true);
    setProject((prev) => {
      const targetIdx = prev.clips.findIndex(
        (c) =>
          currentTime > c.timelineStart + 0.25 &&
          currentTime < c.timelineStart + c.duration - 0.25
      );
      if (targetIdx === -1) return prev;

      const target = prev.clips[targetIdx];
      const firstDur = Number((currentTime - target.timelineStart).toFixed(2));
      const secondDur = Number((target.duration - firstDur).toFixed(2));

      const firstHalf: TimelineClip = {
        ...target,
        duration: firstDur,
        sourceOut: Number((target.sourceIn + firstDur).toFixed(2)),
      };
      const secondHalf: TimelineClip = {
        ...target,
        id: `${target.id}-split-${Date.now()}`,
        timelineStart: currentTime,
        duration: secondDur,
        sourceIn: Number((target.sourceIn + firstDur).toFixed(2)),
        visualMode: 'fill',
        transitionIn: 'hard-cut',
      };

      const nextClips = [...prev.clips];
      nextClips.splice(targetIdx, 1, firstHalf, secondHalf);
      setSelectedClipId(secondHalf.id);
      return { ...prev, clips: nextClips };
    });
  };

  const handleUpdateEndCta = (patch: Partial<EndCtaConfig>) => {
    setHasUnrenderedStudioEdits(true);
    setProject((prev) => ({
      ...prev,
      endCta: { ...prev.endCta, ...patch },
    }));
  };

  const handleUpdatePacing = (patch: Partial<PacingConfig>) => {
    setHasUnrenderedStudioEdits(true);
    setProject((prev) => {
      const nextPacing = { ...prev.pacing, ...patch };
      const rawPhrases = prev.voiceoverSegments.map((s) => ({
        id: s.id,
        text: s.text,
        rawStart: s.rawStart,
        rawEnd: s.rawEnd,
        semanticTopic: s.semanticTopic,
        matchedAssetId: s.matchedAssetId,
        recommendedSourceIn: s.recommendedSourceIn,
      }));
      const { segments, totalAudioDuration } = buildJCutVoiceoverTimeline(
        rawPhrases,
        nextPacing
      );
      const { clips, sparseTexts, endCta } = assembleCommercialCut(
        prev.assets,
        segments,
        nextPacing
      );
      return {
        ...prev,
        pacing: nextPacing,
        voiceoverSegments: segments,
        clips,
        sparseTexts,
        endCta: {
          ...endCta,
          highlightColor: prev.endCta.highlightColor,
          fadeScrimOpacity: prev.endCta.fadeScrimOpacity,
          triggerWord: prev.endCta.triggerWord,
        },
        totalDuration: Number(Math.max(totalAudioDuration, 3.0).toFixed(2)),
      };
    });
  };

  const handleAddSparseText = () => {
    setHasUnrenderedStudioEdits(true);
    const newLayer: SparseTextLayer = {
      id: `txt-${Date.now()}`,
      text: 'TOP FEATURE',
      highlightWord: 'FEATURE',
      timelineStart: Number(
        Math.min(currentTime, project.totalDuration - 1.5).toFixed(2)
      ),
      duration: 1.4,
      position: 'center',
      animation: 'kinetic-punch',
      accentColor: '#FACC15',
    };
    setProject((prev) => ({
      ...prev,
      sparseTexts: [...prev.sparseTexts, newLayer],
    }));
  };

  const handleUpdateSparseText = (
    id: string,
    patch: Partial<SparseTextLayer>
  ) => {
    setHasUnrenderedStudioEdits(true);
    setProject((prev) => ({
      ...prev,
      sparseTexts: prev.sparseTexts.map((t) =>
        t.id === id ? { ...t, ...patch } : t
      ),
    }));
  };

  const handleDeleteSparseText = (id: string) => {
    setHasUnrenderedStudioEdits(true);
    setProject((prev) => ({
      ...prev,
      sparseTexts: prev.sparseTexts.filter((t) => t.id !== id),
    }));
  };

  const triggerBrowserDownload = (downloadUrl: string, filename: string) => {
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /**
   * Real Backend FFmpeg 1080x1920 @ 60fps MP4 Render & Verified Blob Download
   */
  const handleStartRender1080p60 = async () => {
    setIsPlaying(false);
    setExportModalOpen(true);

    const cleanFileName = `${project.folderName.replace(/[^a-zA-Z0-9_-]/g, '_')}_1080p_60fps_9x16.mp4`;

    // If we already have a verified local Blob URL and no Studio layer edits were made, download immediately from RAM!
    if (
      project.jobId &&
      !hasUnrenderedStudioEdits &&
      exportedVideoUrl &&
      exportedVideoUrl.startsWith('blob:')
    ) {
      setIsExporting(false);
      setExportProgress(100);
      triggerBrowserDownload(exportedVideoUrl, cleanFileName);
      return;
    }

    if (project.jobId) {
      setIsExporting(true);
      setExportProgress(18);
      const progTimer = setInterval(() => {
        setExportProgress((p) => (p < 90 ? p + 12 : p));
      }, 450);

      try {
        if (hasUnrenderedStudioEdits) {
          const res = await fetch(`/api/jobs/${project.jobId}/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project }),
          });
          if (!res.ok) {
            throw new Error('Failed to re-render updated Studio layers.');
          }
          const data = await res.json();
          if (data.project) {
            setProject(data.project);
          }
        }

        // Fetch the final MP4 in 4MB chunks into a verified local Blob URL
        const fetchedMp4 = await fetchFinalMp4AsLocalBlobUrl(project.jobId);
        clearInterval(progTimer);

        const dlUrl =
          fetchedMp4?.blobUrl ||
          `/api/jobs/${project.jobId}/download?v=${Date.now()}`;
        setExportedVideoUrl(dlUrl);
        if (fetchedMp4?.sizeBytes) {
          setExportedVideoSizeBytes(fetchedMp4.sizeBytes);
        }
        setProject((prev) => ({ ...prev, finalVideoUrl: dlUrl }));
        setHasUnrenderedStudioEdits(false);
        setExportProgress(100);
        setIsExporting(false);
        triggerBrowserDownload(dlUrl, cleanFileName);
        return;
      } catch {
        clearInterval(progTimer);
      }
      setIsExporting(false);
      setExportProgress(100);
    }
  };

  return (
    <div
      id="top"
      className="min-h-screen flex flex-col bg-[#090A0F] text-[#F8FAFC]"
    >
      {/* 3-Zone Top Bar */}
      <TopBar
        stage={stage}
        hasLoadedProject={hasLoadedProject}
        onNavigateStage={(nextStage) => {
          setIsPlaying(false);
          setStage(nextStage);
        }}
        onExportVideo={handleStartRender1080p60}
        isExporting={isExporting}
      />

      {stage !== 'studio' ? (
        <StreamlinedHomeFlow
          stage={stage}
          project={project}
          activeSlideIndex={activeSlideIndex}
          uploadError={uploadError}
          telemetrySummary={telemetrySummary}
          onFolderDropped={handleFolderDropped}
          onRunDemoFolderThroughBackend={handleRunSampleFolderOnBackend}
          onOpenStudioPanel={() => {
            setIsPlaying(false);
            setStage('studio');
          }}
          onExport1080p60={handleStartRender1080p60}
          isExporting={isExporting}
          currentTime={currentTime}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          onSeek={(t) => {
            setCurrentTime(t);
          }}
          canvasRef={canvasRef}
        />
      ) : (
        /* Full Layer-by-Layer Professional Studio Panel */
        <main
          id="workspace"
          className="flex-1 flex flex-col justify-between lg:overflow-hidden"
        >
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 lg:overflow-hidden lg:max-h-[calc(100vh-235px)]">
            {/* Left Layer Breakdown & Folder Explorer */}
            <aside className="order-2 lg:order-1 lg:col-span-3 bg-[#11131A] border-r border-[#232736] flex flex-col overflow-hidden select-none">
              <div className="p-3 border-b border-[#232736] flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-xs font-semibold text-[#F8FAFC]">
                    Studio Layer Breakdown
                  </h2>
                  <p className="text-[11px] text-[#94A3B8] truncate">
                    Folder: {project.folderName}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {hasUnrenderedStudioEdits && (
                    <button
                      type="button"
                      onClick={handleStartRender1080p60}
                      disabled={isExporting}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#FACC15] text-[#090A0F] text-xs font-bold hover:bg-[#FDE047] transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Render Edits</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlaying(false);
                      setStage('dropzone');
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#171A24] hover:bg-[#1E2333] text-xs font-medium text-[#FACC15] border border-[#2A3042] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderUp className="w-3.5 h-3.5" />
                    <span>New Folder</span>
                  </button>
                </div>
              </div>

              <div className="p-3 overflow-y-auto flex-1 space-y-4">
                {/* Layer 1: End Comment CTA Layer Card */}
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-[#FACC15] flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Layer 1 · Centered End CTA Overlay</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setInspectorMode('cta');
                      setCurrentTime(project.endCta.startTime + 0.35);
                    }}
                    className={`w-full text-left p-2.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                      inspectorMode === 'cta'
                        ? 'bg-[#1B2030] border-[#FACC15] text-[#F8FAFC]'
                        : 'bg-[#090A0F] border-[#1E2230] text-[#CBD5E1] hover:border-[#FACC15]/50'
                    }`}
                  >
                    <div className="font-bold text-[#FACC15]">
                      {project.endCta.topLabel || 'Link in Bio'} · Comment "
                      {project.endCta.triggerWord}"
                    </div>
                    <div className="text-[11px] text-[#94A3B8] font-mono tabular-nums">
                      {project.endCta.startTime.toFixed(2)}s ·{' '}
                      {Math.round(project.endCta.fadeScrimOpacity * 100)}% Black
                      Fade · Centered
                    </div>
                  </button>
                </div>

                {/* Layer 2: Sparse Text Overlay Layer */}
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-[#38BDF8] flex items-center gap-1.5">
                    <TypeIcon className="w-3.5 h-3.5" />
                    <span>
                      Layer 2 · Sparse Text ({project.sparseTexts.length})
                    </span>
                  </div>
                  {project.sparseTexts.map((txt) => (
                    <button
                      key={txt.id}
                      type="button"
                      onClick={() => {
                        setInspectorMode('text');
                        setCurrentTime(txt.timelineStart + 0.1);
                      }}
                      className="w-full text-left p-2 rounded-lg bg-[#090A0F] border border-[#1E2230] hover:border-[#38BDF8] text-xs cursor-pointer"
                    >
                      <div className="font-semibold text-[#F8FAFC] truncate">
                        {txt.text}
                      </div>
                      <div className="text-[10px] font-mono text-[#94A3B8]">
                        {txt.timelineStart.toFixed(2)}s (
                        {txt.duration.toFixed(1)}s)
                      </div>
                    </button>
                  ))}
                </div>

                {/* Layer 3: Video Cuts Layer */}
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-[#6366F1] flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5" />
                    <span>
                      Layer 3 · Product Video Cuts ({project.clips.length})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {project.clips.map((clip, idx) => (
                      <button
                        key={clip.id}
                        type="button"
                        onClick={() => {
                          setSelectedClipId(clip.id);
                          setInspectorMode('clip');
                          setCurrentTime(clip.timelineStart + 0.15);
                        }}
                        className={`w-full text-left p-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                          selectedClipId === clip.id && inspectorMode === 'clip'
                            ? 'bg-[#1B2030] border-[#FACC15] text-[#F8FAFC]'
                            : 'bg-[#090A0F] border-[#1E2230] text-[#CBD5E1]'
                        }`}
                      >
                        <div className="flex justify-between text-[10px] font-mono text-[#94A3B8]">
                          <span>Cut 0{idx + 1}</span>
                          <span>
                            Sharp Cut · {clip.playbackRate}x
                          </span>
                        </div>
                        <div className="truncate font-medium text-[#F8FAFC]">
                          {clip.label.split('/').pop()}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Layer 4: Voiceover Audio Layer */}
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-[#10B981] flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>
                      Layer 4 · Voiceover J-Cut Beats (
                      {project.voiceoverSegments.length})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {project.voiceoverSegments.map((seg, i) => (
                      <button
                        key={seg.id}
                        type="button"
                        onClick={() => {
                          setCurrentTime(seg.timelineStart + 0.1);
                          setInspectorMode(seg.isCtaSegment ? 'cta' : 'pacing');
                        }}
                        className="w-full text-left p-2 rounded-lg bg-[#090A0F] border border-[#1E2230] hover:border-[#10B981] text-xs cursor-pointer"
                      >
                        <div className="flex justify-between text-[10px] font-mono text-[#94A3B8]">
                          <span>
                            Beat 0{i + 1} · {seg.timelineStart.toFixed(2)}s
                          </span>
                          <span className="text-[#10B981]">
                            -{seg.jCutLeadMs}ms J-Cut
                          </span>
                        </div>
                        <div className="truncate text-[#E2E8F0]">
                          {seg.text}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </aside>

            {/* Center 9:16 1080p 60fps Vertical Canvas Viewport */}
            <div className="order-1 lg:order-2 lg:col-span-6 flex flex-col overflow-hidden">
              <VerticalCanvasViewport
                project={project}
                currentTime={currentTime}
                isPlaying={isPlaying}
                onTogglePlay={() => setIsPlaying((p) => !p)}
                onSeek={(t) => {
                  setIsPlaying(false);
                  setCurrentTime(t);
                }}
                onPreviewEndCta={() => {
                  setIsPlaying(false);
                  setInspectorMode('cta');
                  setCurrentTime(project.endCta.startTime + 0.4);
                }}
                onSplitAtPlayhead={handleSplitAtPlayhead}
                showSafeZones={showSafeZones}
                onToggleSafeZones={() => setShowSafeZones((s) => !s)}
                canvasRef={canvasRef}
                mediaCache={mediaCache}
                renderedVideoUrl={exportedVideoUrl}
                hasUnrenderedStudioEdits={hasUnrenderedStudioEdits}
              />
            </div>

            {/* Right Contextual NLE Inspector */}
            <div className="order-3 lg:order-3 lg:col-span-3 flex flex-col overflow-hidden">
              <RightInspectorPanel
                project={project}
                inspectorMode={inspectorMode}
                onSelectInspectorMode={setInspectorMode}
                selectedClipId={selectedClipId}
                onUpdateClip={handleUpdateClip}
                onDeleteClip={handleDeleteClip}
                onUpdateEndCta={handleUpdateEndCta}
                onUpdatePacing={handleUpdatePacing}
                onAddSparseText={handleAddSparseText}
                onUpdateSparseText={handleUpdateSparseText}
                onDeleteSparseText={handleDeleteSparseText}
                onSeek={(t) => {
                  setIsPlaying(false);
                  setCurrentTime(t);
                }}
              />
            </div>
          </div>

          {/* Bottom 4-Layer Timeline with Integrated Studio Transport Controls */}
          <MultiTrackTimeline
            project={project}
            currentTime={currentTime}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onSeek={(t) => {
              setIsPlaying(false);
              setCurrentTime(t);
            }}
            onPreviewEndCta={() => {
              setIsPlaying(false);
              setInspectorMode('cta');
              setCurrentTime(project.endCta.startTime + 0.4);
            }}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onExportVideo={handleStartRender1080p60}
            isExporting={isExporting}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
            onSelectInspectorMode={setInspectorMode}
          />
        </main>
      )}

      {/* 1080p 60fps 9:16 MP4 Render & Download Modal */}
      {exportModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-modal-title"
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md rounded-xl bg-[#11131A] border border-[#2A3042] p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2
                id="export-modal-title"
                className="text-base font-bold font-display text-[#F8FAFC]"
              >
                Export 9:16 Commercial Ad (1080p · 60fps MP4)
              </h2>
              <button
                type="button"
                onClick={() => setExportModalOpen(false)}
                aria-label="Close Export Dialog"
                className="p-1 text-[#94A3B8] hover:text-[#F8FAFC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-lg bg-[#090A0F] border border-[#232736] space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Output Format</span>
                <span className="font-mono tabular-nums text-[#F8FAFC]">
                  MP4 (H.264 High · AAC · 1080×1920)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Frame Rate & Cuts</span>
                <span className="font-mono tabular-nums text-[#FACC15]">
                  60 FPS · Sharp Video Cuts Only
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Voiceover J-Cut Pacing</span>
                <span className="font-mono tabular-nums text-[#10B981]">
                  -{project.pacing.jCutOverlapMs}ms Lead Overlap
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Centered End CTA Box</span>
                <span className="font-mono tabular-nums text-[#FACC15]">
                  "{project.endCta.triggerWord}" · Link in Bio / DM
                </span>
              </div>
              {exportedVideoSizeBytes > 0 && (
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Verified MP4 Size</span>
                  <span className="font-mono tabular-nums text-[#10B981]">
                    {(exportedVideoSizeBytes / (1024 * 1024)).toFixed(2)} MB
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs font-mono tabular-nums">
                <span className="text-[#CBD5E1]">
                  {isExporting
                    ? 'FFmpeg Rendering 1080×1920 @ 60fps MP4...'
                    : '1080p 60fps MP4 Ready in Memory'}
                </span>
                <span className="text-[#FACC15]">{exportProgress}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#090A0F] overflow-hidden border border-[#232736]">
                <div
                  style={{ width: `${exportProgress}%` }}
                  className="h-full bg-[#FACC15] transition-all duration-150"
                />
              </div>
            </div>

            {!isExporting && exportProgress >= 100 && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-2 text-xs text-[#10B981]">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Ready:{' '}
                    {project.folderName.replace(/\s+/g, '_')}_1080p_60fps_9x16.mp4
                  </span>
                </div>
                {exportedVideoUrl ? (
                  <a
                    href={exportedVideoUrl}
                    download={`${project.folderName.replace(/\s+/g, '_')}_1080p_60fps_9x16.mp4`}
                    className="w-full py-2.5 px-4 rounded-lg bg-[#FACC15] text-[#090A0F] font-semibold text-xs flex items-center justify-center gap-2 hover:bg-[#FDE047] transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Final 1080p 60fps Ad (.MP4)</span>
                  </a>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
