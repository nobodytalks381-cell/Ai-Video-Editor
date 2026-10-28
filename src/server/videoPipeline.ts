import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AdProjectState,
  FolderAsset,
  PacingConfig,
  TimelineClip,
  VoiceoverSegment,
} from '../types/editor.ts';

const execFileAsync = promisify(execFile);

const BOLD_FONT_PATH =
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
const MONO_FONT_PATH =
  '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf';

export interface ProbedMediaInfo {
  duration: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

/**
 * Probes any media file on disk using ffprobe to determine real duration, dimensions,
 * and whether it contains video and/or audio streams.
 */
export async function probeMediaFile(filePath: string): Promise<ProbedMediaInfo> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type,width,height',
        '-of',
        'json',
        filePath,
      ],
      { timeout: 15000 }
    );
    const parsed = JSON.parse(stdout || '{}');
    const streams: any[] = Array.isArray(parsed.streams) ? parsed.streams : [];
    const videoStream = streams.find((s) => s.codec_type === 'video');
    const audioStream = streams.find((s) => s.codec_type === 'audio');
    const rawDur = parseFloat(parsed.format?.duration || '0');

    return {
      duration: Number.isFinite(rawDur) && rawDur > 0 ? Number(rawDur.toFixed(2)) : 5.0,
      width: videoStream?.width ? Number(videoStream.width) : 1080,
      height: videoStream?.height ? Number(videoStream.height) : 1920,
      hasVideo: Boolean(videoStream),
      hasAudio: Boolean(audioStream),
    };
  } catch {
    return {
      duration: 5.0,
      width: 1080,
      height: 1920,
      hasVideo: false,
      hasAudio: false,
    };
  }
}

/**
 * Extracts a representative 360p JPEG keyframe from a video clip using ffmpeg
 * so both the UI thumbnail and Gemini multimodal vision can inspect the actual video pixels.
 */
export async function extractVideoKeyframe(
  videoPath: string,
  duration: number,
  outJpgPath: string
): Promise<string | null> {
  try {
    const seekSec = Math.max(0.1, Math.min(duration * 0.35, duration - 0.2));
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-ss',
        seekSec.toFixed(2),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-vf',
        'scale=360:-2',
        '-q:v',
        '5',
        outJpgPath,
      ],
      { timeout: 15000 }
    );
    const buf = await fs.readFile(outJpgPath);
    return buf.toString('base64');
  } catch {
    return null;
  }
}

/**
 * Normalizes any uploaded audio file (or audio stream from a voiceover video) into:
 * 1) A clean 44.1kHz stereo WAV file (`raw_vo.wav`) for sample-accurate J-cut editing
 * 2) A compact 64kbps mono MP3 file (`raw_vo.mp3`) for fast Gemini transcription
 */
export async function normalizeVoiceoverAudio(
  inputAudioPath: string,
  outWavPath: string,
  outMp3Path: string
): Promise<{ duration: number; waveformPeaks: number[] }> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputAudioPath,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '44100',
      '-ac',
      '2',
      outWavPath,
    ],
    { timeout: 30000 }
  );

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      outWavPath,
      '-vn',
      '-acodec',
      'libmp3lame',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-b:a',
      '64k',
      outMp3Path,
    ],
    { timeout: 30000 }
  );

  const info = await probeMediaFile(outWavPath);
  const waveformPeaks = await computeWavPeaks(outWavPath, 36);
  return { duration: info.duration, waveformPeaks };
}

/**
 * Reads 16-bit PCM WAV data directly to compute 36 normalized waveform peaks for the Studio timeline.
 */
async function computeWavPeaks(wavPath: string, count = 36): Promise<number[]> {
  try {
    const buf = await fs.readFile(wavPath);
    if (buf.length <= 44) return new Array(count).fill(0.5);
    const pcmBytes = buf.length - 44;
    const totalSamples = Math.floor(pcmBytes / 2);
    const bucket = Math.max(1, Math.floor(totalSamples / count));
    const peaks: number[] = [];

    for (let i = 0; i < count; i++) {
      let maxAbs = 0;
      const startSample = i * bucket;
      const endSample = Math.min(totalSamples, startSample + bucket);
      const step = Math.max(1, Math.floor((endSample - startSample) / 120));
      for (let s = startSample; s < endSample; s += step) {
        const byteOffset = 44 + s * 2;
        if (byteOffset + 1 < buf.length) {
          const val = buf.readInt16LE(byteOffset) / 32768;
          const abs = Math.abs(val);
          if (abs > maxAbs) maxAbs = abs;
        }
      }
      peaks.push(Number(Math.max(0.08, Math.min(1, maxAbs)).toFixed(2)));
    }
    return peaks;
  } catch {
    return new Array(count).fill(0.6);
  }
}

/**
 * Runs ffmpeg `silencedetect` on the normalized voiceover WAV to detect real pauses
 * and returns the active speech windows `[rawStart, rawEnd]`.
 * If a continuous speech segment is longer than 3.0s, it subdivides it into fast-paced ~2.2s beats
 * so the commercial cuts clips dynamically.
 */
export async function detectSpeechIntervalsWithFFmpeg(
  wavPath: string,
  totalDuration: number,
  pacing: PacingConfig
): Promise<Array<{ rawStart: number; rawEnd: number }>> {
  const minSilenceSec = Math.max(0.08, pacing.minSilenceDurationMs / 1000);
  const thresholdDb = Math.max(-55, Math.min(-18, pacing.silenceThresholdDb));

  let stderrOutput = '';
  try {
    const res = await execFileAsync(
      'ffmpeg',
      [
        '-i',
        wavPath,
        '-af',
        `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec.toFixed(2)}`,
        '-f',
        'null',
        '-',
      ],
      { timeout: 25000 }
    );
    stderrOutput = res.stderr || '';
  } catch (err: any) {
    stderrOutput = err?.stderr || '';
  }

  const silenceStarts: number[] = [];
  const silenceEnds: number[] = [];

  for (const line of stderrOutput.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      silenceStarts.push(parseFloat(startMatch[1]));
    }
    const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
    if (endMatch) {
      silenceEnds.push(parseFloat(endMatch[1]));
    }
  }

  const speechRegions: Array<{ rawStart: number; rawEnd: number }> = [];
  let cursor = 0;
  const numSilences = Math.max(silenceStarts.length, silenceEnds.length);

  for (let i = 0; i < numSilences; i++) {
    const sStart = silenceStarts[i] ?? totalDuration;
    const sEnd = silenceEnds[i] ?? totalDuration;
    if (sStart - cursor >= 0.35) {
      speechRegions.push({
        rawStart: Number(cursor.toFixed(3)),
        rawEnd: Number(sStart.toFixed(3)),
      });
    }
    cursor = Math.max(cursor, sEnd);
  }

  if (totalDuration - cursor >= 0.35) {
    speechRegions.push({
      rawStart: Number(cursor.toFixed(3)),
      rawEnd: Number(totalDuration.toFixed(3)),
    });
  }

  // Merge micro-speech intervals (< 1.45s) separated by tiny comma pauses (< 0.28s) so full spoken clauses stay intact
  const mergedRegions: Array<{ rawStart: number; rawEnd: number }> = [];
  for (const reg of speechRegions) {
    const prev = mergedRegions[mergedRegions.length - 1];
    if (
      prev &&
      reg.rawStart - prev.rawEnd < 0.28 &&
      (prev.rawEnd - prev.rawStart < 1.45 || reg.rawEnd - reg.rawStart < 1.35) &&
      reg.rawEnd - prev.rawStart <= 3.6
    ) {
      prev.rawEnd = reg.rawEnd;
    } else {
      mergedRegions.push({ ...reg });
    }
  }

  // Subdivide any long continuous speech (> 3.6s) into natural ~2.5s commercial beats
  const refinedBeats: Array<{ rawStart: number; rawEnd: number }> = [];
  for (const reg of mergedRegions) {
    const len = reg.rawEnd - reg.rawStart;
    if (len > 3.6) {
      const subCount = Math.min(5, Math.ceil(len / 2.55));
      const step = len / subCount;
      for (let k = 0; k < subCount; k++) {
        refinedBeats.push({
          rawStart: Number((reg.rawStart + k * step).toFixed(3)),
          rawEnd: Number((reg.rawStart + (k + 1) * step).toFixed(3)),
        });
      }
    } else {
      refinedBeats.push(reg);
    }
  }

  // Fallback if audio had continuous background noise or < 3 beats
  if (refinedBeats.length < 3) {
    refinedBeats.length = 0;
    const targetBeats = Math.max(4, Math.min(7, Math.round(totalDuration / 2.4)));
    const beatDur = totalDuration / targetBeats;
    for (let i = 0; i < targetBeats; i++) {
      refinedBeats.push({
        rawStart: Number((i * beatDur).toFixed(3)),
        rawEnd: Number(((i + 1) * beatDur).toFixed(3)),
      });
    }
  }

  return refinedBeats;
}

/**
 * Physically cuts the user's voiceover WAV according to the J-Cut timeline segments,
 * stripping dead-air pauses and overlapping each subsequent spoken phrase by `jCutLeadMs`
 * before the previous phrase finishes. Produces both `edited_vo.wav` and `edited_vo.mp3`.
 */
export async function buildEditedVoiceoverAudioWithFFmpeg(
  rawWavPath: string,
  segments: VoiceoverSegment[],
  outEditedWavPath: string,
  outEditedMp3Path: string
): Promise<void> {
  if (segments.length === 0) {
    await fs.copyFile(rawWavPath, outEditedWavPath);
    return;
  }

  const probed = await probeMediaFile(rawWavPath);
  const rawDur = Math.max(0.5, probed.duration || 60);

  const filterParts: string[] = [];
  const mixInputs: string[] = [];

  segments.forEach((seg, idx) => {
    const start = Math.max(0, Math.min(seg.rawStart, rawDur - 0.1));
    const dur = Math.max(0.2, seg.timelineDuration);
    const end = Number(Math.max(start + 0.15, Math.min(rawDur, start + dur)).toFixed(3));
    const actualSegDur = Math.max(0.15, end - start);
    const fadeOutStart = Math.max(0, Number((actualSegDur - 0.018).toFixed(3)));
    const delayMs = Math.max(0, Math.round(seg.timelineStart * 1000));

    filterParts.push(
      `[0:a]atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.015,afade=t=out:st=${fadeOutStart}:d=0.018,adelay=${delayMs}|${delayMs}[a${idx}]`
    );
    mixInputs.push(`[a${idx}]`);
  });

  filterParts.push(
    `${mixInputs.join('')}amix=inputs=${segments.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`
  );

  const filterComplex = filterParts.join(';');

  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-nostdin',
        '-loglevel',
        'error',
        '-y',
        '-i',
        rawWavPath,
        '-filter_complex',
        filterComplex,
        '-map',
        '[aout]',
        '-acodec',
        'pcm_s16le',
        '-ar',
        '44100',
        '-ac',
        '2',
        outEditedWavPath,
      ],
      { timeout: 35000, maxBuffer: 50 * 1024 * 1024 }
    );
  } catch (err: any) {
    console.warn('J-cut amix fallback to rawWavPath:', err?.message);
    await fs.copyFile(rawWavPath, outEditedWavPath);
  }

  await execFileAsync(
    'ffmpeg',
    [
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-i',
      outEditedWavPath,
      '-acodec',
      'libmp3lame',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-b:a',
      '192k',
      outEditedMp3Path,
    ],
    { timeout: 35000, maxBuffer: 50 * 1024 * 1024 }
  );
}

/**
 * Renders the complete 1080x1920 @ 60fps 9:16 commercial MP4 from the user's real video clips
 * and edited J-cut voiceover audio using FFmpeg.
 */
export async function renderCommercialMp4WithFFmpeg(params: {
  jobDir: string;
  project: AdProjectState;
  assetDiskPaths: Map<string, string>;
  editedAudioPath: string | null;
  outMp4Path: string;
}): Promise<void> {
  const { jobDir, project, assetDiskPaths, editedAudioPath, outMp4Path } = params;
  const segDir = path.join(jobDir, 'segments');
  await fs.mkdir(segDir, { recursive: true });

  const segmentFiles: string[] = new Array(project.clips.length);

  // Render clip segments in parallel (up to 3 concurrent FFmpeg workers) for fast 1080p 60fps turnaround
  const concurrency = 3;
  for (let batchStart = 0; batchStart < project.clips.length; batchStart += concurrency) {
    const batch = project.clips.slice(batchStart, batchStart + concurrency);
    await Promise.all(
      batch.map(async (clip, offset) => {
        const i = batchStart + offset;
        const segMp4 = path.join(segDir, `seg_${String(i).padStart(3, '0')}.mp4`);

        const primaryAsset =
          project.assets.find((a) => a.id === clip.assetId) ||
          project.assets.find((a) => a.type === 'video' || a.type === 'image');
        const secondaryAsset =
          project.assets.find((a) => a.id === clip.secondaryAssetId) ||
          primaryAsset;

        const primaryDiskPath = primaryAsset
          ? assetDiskPaths.get(primaryAsset.id)
          : undefined;
        const secondaryDiskPath = secondaryAsset
          ? assetDiskPaths.get(secondaryAsset.id)
          : primaryDiskPath;

        await renderSingleClipSegment({
          segIndex: i,
          segDir,
          clip,
          primaryAsset,
          secondaryAsset,
          primaryDiskPath,
          secondaryDiskPath,
          project,
          outSegMp4: segMp4,
        });

        segmentFiles[i] = segMp4;
      })
    );
  }

  // Write concat list
  const concatListPath = path.join(segDir, 'concat_list.txt');
  const concatLines = segmentFiles.map(
    (f) => `file '${f.replace(/'/g, "'\\''")}'`
  );
  await fs.writeFile(concatListPath, concatLines.join('\n'), 'utf8');

  const videoOnlyMp4 = path.join(segDir, 'video_concat.mp4');
  await execFileAsync(
    'ffmpeg',
    [
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c',
      'copy',
      videoOnlyMp4,
    ],
    { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }
  );

  // Mux with the edited silence-stripped J-cut voiceover audio track
  if (editedAudioPath) {
    try {
      await fs.access(editedAudioPath);
      await execFileAsync(
        'ffmpeg',
        [
          '-nostdin',
          '-loglevel',
          'error',
          '-y',
          '-i',
          videoOnlyMp4,
          '-i',
          editedAudioPath,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          '-movflags',
          '+faststart',
          outMp4Path,
        ],
        { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }
      );
      return;
    } catch {
      // Fallback to video-only if audio file is unavailable
    }
  }

  await fs.copyFile(videoOnlyMp4, outMp4Path);
}

/**
 * Renders one TimelineClip into a normalized 1080x1920 @ 60fps H.264 segment MP4,
 * including dynamic zoom / split-screen B-roll, sparse kinetic text, captions,
 * and the End-of-Video Comment CTA blackish fade + highlighted keyword card.
 */
async function renderSingleClipSegment(params: {
  segIndex: number;
  segDir: string;
  clip: TimelineClip;
  primaryAsset?: FolderAsset;
  secondaryAsset?: FolderAsset;
  primaryDiskPath?: string;
  secondaryDiskPath?: string;
  project: AdProjectState;
  outSegMp4: string;
}): Promise<void> {
  const {
    segIndex,
    segDir,
    clip,
    primaryAsset,
    secondaryAsset,
    primaryDiskPath,
    secondaryDiskPath,
    project,
    outSegMp4,
  } = params;

  const outDur = Math.max(0.4, Number(clip.duration.toFixed(3)));
  const rate = Math.max(0.5, Math.min(2.2, clip.playbackRate || 1.0));
  const readDur = Number((outDur * rate + 0.25).toFixed(3));

  const brightnessOffset = Math.max(
    -0.35,
    Math.min(0.3, (clip.filterBrightness || 1) - 1)
  );
  const contrastVal = Math.max(0.8, Math.min(1.4, clip.filterContrast || 1.05));

  // Build overlay filters (Sparse Text, Voiceover Caption, and End Comment CTA)
  const overlayFilters: string[] = [];

  const clipEnd = clip.timelineStart + outDur;
  const isCtaActiveOnClip =
    project.endCta.enabled && clipEnd > project.endCta.startTime + 0.05;

  // 1. Sparse Kinetic Text Overlay (if active during this clip and not overlapping the End CTA)
  const activeSparseText = project.sparseTexts.find(
    (t) =>
      t.timelineStart < clipEnd &&
      t.timelineStart + t.duration > clip.timelineStart
  );

  const safeSparseLabel = activeSparseText?.text
    ?.replace(/[\r\n]+/g, ' ')
    .trim();

  if (activeSparseText && safeSparseLabel && !isCtaActiveOnClip) {
    const sparseFile = path.join(segDir, `sparse_${segIndex}.txt`);
    await fs.writeFile(sparseFile, safeSparseLabel, 'utf8');
    const localStart = Math.max(
      0,
      activeSparseText.timelineStart - clip.timelineStart
    );
    const localEnd = Math.min(
      outDur,
      activeSparseText.timelineStart +
        activeSparseText.duration -
        clip.timelineStart
    );
    const yBox =
      activeSparseText.position === 'top'
        ? 250
        : activeSparseText.position === 'center'
        ? 860
        : 1320;
    const textColor =
      activeSparseText.accentColor === '#FFFFFF'
        ? '0xFFFFFF'
        : activeSparseText.accentColor === '#38BDF8'
        ? '0x38BDF8'
        : '0xFACC15';

    overlayFilters.push(
      `drawbox=x=96:y=${yBox}:w=888:h=136:color=0x090A0F@0.82:t=fill:enable='between(t,${localStart.toFixed(2)},${localEnd.toFixed(2)})'`,
      `drawbox=x=96:y=${yBox}:w=888:h=136:color=${textColor}@0.75:t=3:enable='between(t,${localStart.toFixed(2)},${localEnd.toFixed(2)})'`,
      `drawtext=fontfile=${BOLD_FONT_PATH}:textfile=${sparseFile}:expansion=none:fontcolor=${textColor}:fontsize=54:x=(w-text_w)/2:y=${yBox + 42}:enable='between(t,${localStart.toFixed(2)},${localEnd.toFixed(2)})'`
    );
  }

  // 2. Spoken Voiceover Beat Caption at bottom safe zone (when not in CTA window)
  const matchingVo = project.voiceoverSegments.find(
    (s) =>
      s.timelineStart < clipEnd &&
      s.timelineStart + s.timelineDuration > clip.timelineStart
  );
  if (matchingVo && !isCtaActiveOnClip) {
    const words = matchingVo.text
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const mid = Math.ceil(words.length / 2);
    const line1 = words.slice(0, mid).join(' ').slice(0, 42) || ' ';
    const line2 = words.slice(mid).join(' ').slice(0, 42);

    const cap1File = path.join(segDir, `cap1_${segIndex}.txt`);
    await fs.writeFile(cap1File, line1, 'utf8');

    overlayFilters.push(
      `drawbox=x=64:y=1540:w=952:h=${line2 ? 156 : 104}:color=0x090A0F@0.76:t=fill`,
      `drawtext=fontfile=${BOLD_FONT_PATH}:textfile=${cap1File}:expansion=none:fontcolor=0xF8FAFC:fontsize=36:x=(w-text_w)/2:y=1568`
    );

    if (line2) {
      const cap2File = path.join(segDir, `cap2_${segIndex}.txt`);
      await fs.writeFile(cap2File, line2, 'utf8');
      overlayFilters.push(
        `drawtext=fontfile=${BOLD_FONT_PATH}:textfile=${cap2File}:expansion=none:fontcolor=0xFACC15:fontsize=36:x=(w-text_w)/2:y=1624`
      );
    }
  }

  // 3. End-of-Video Comment CTA Screen (Blackish fade + Dead-Center Comment Card + Enlarged Yellow/White Keyword)
  if (isCtaActiveOnClip) {
    const localCtaStart = Math.max(
      0,
      project.endCta.startTime - clip.timelineStart
    );
    const scrimOpacity = Math.max(
      0.5,
      Math.min(0.95, project.endCta.fadeScrimOpacity || 0.78)
    ).toFixed(2);
    const accentHex =
      project.endCta.highlightColor === '#FFFFFF' ? '0xFFFFFF' : '0xFACC15';
    const keywordPx = Math.round(56 * (project.endCta.wordScale || 1.38));

    const headerFile = path.join(segDir, `cta_hdr_${segIndex}.txt`);
    const prefixFile = path.join(segDir, `cta_pre_${segIndex}.txt`);
    const wordFile = path.join(segDir, `cta_word_${segIndex}.txt`);
    const suffixFile = path.join(segDir, `cta_suf_${segIndex}.txt`);

    await fs.writeFile(
      headerFile,
      (project.endCta.promptHeader || 'Link in Bio').trim().slice(0, 44) ||
        'Link in Bio',
      'utf8'
    );
    await fs.writeFile(
      prefixFile,
      (project.endCta.prefixText || 'Comment').replace(/:$/, '').trim() ||
        'Comment',
      'utf8'
    );
    await fs.writeFile(
      wordFile,
      `"${(project.endCta.triggerWord || 'LINK').toUpperCase()}"`,
      'utf8'
    );
    await fs.writeFile(
      suffixFile,
      (project.endCta.suffixText || 'I will send you link in DM').slice(0, 48) ||
        'I will send you link in DM',
      'utf8'
    );

    const enableClause =
      localCtaStart > 0.05
        ? `:enable='gte(t,${localCtaStart.toFixed(2)})'`
        : '';

    overlayFilters.push(
      // Fade main video toward blackish
      `drawbox=x=0:y=0:w=1080:h=1920:color=black@${scrimOpacity}:t=fill${enableClause}`,
      // Centered CTA card container & border (y=735, h=450 centers the card on 1080x1920)
      `drawbox=x=64:y=735:w=952:h=450:color=0x11131C@0.95:t=fill${enableClause}`,
      `drawbox=x=64:y=735:w=952:h=450:color=${accentHex}@0.82:t=4${enableClause}`,
      // Top line ("Link in Bio")
      `drawtext=fontfile=${BOLD_FONT_PATH}:textfile=${headerFile}:expansion=none:fontcolor=0xFACC15:fontsize=30:x=(w-text_w)/2:y=780${enableClause}`,
      // Main line ("Comment")
      `drawtext=fontfile=${BOLD_FONT_PATH}:textfile=${prefixFile}:expansion=none:fontcolor=0xF8FAFC:fontsize=48:x=(w-text_w)/2:y=842${enableClause}`,
      // Highlight badge box behind the enlarged trigger word
      `drawbox=x=170:y=915:w=740:h=130:color=${accentHex}@0.22:t=fill${enableClause}`,
      // Enlarged CTA Trigger Word in Signal Yellow (#FACC15) or Crisp White (#FFFFFF)
      `drawtext=fontfile=${BOLD_FONT_PATH}:textfile=${wordFile}:expansion=none:fontcolor=${accentHex}:fontsize=${keywordPx}:x=(w-text_w)/2:y=943${enableClause}`,
      // Bottom instruction text ("I will send you link in DM")
      `drawtext=fontfile=${BOLD_FONT_PATH}:textfile=${suffixFile}:expansion=none:fontcolor=0xE2E8F0:fontsize=34:x=(w-text_w)/2:y=1092${enableClause}`
    );
  }

  const postOverlayChain =
    overlayFilters.length > 0 ? `,${overlayFilters.join(',')}` : '';

  // Case A: 2-Up Split-Screen Product Grid (only if manually selected in Studio Inspector)
  if (
    clip.visualMode === 'split-2up' &&
    primaryDiskPath &&
    secondaryDiskPath &&
    primaryAsset &&
    secondaryAsset
  ) {
    try {
      const args1 = buildInputArgsForAsset(
        primaryAsset,
        primaryDiskPath,
        clip.sourceIn,
        readDur
      );
      const args2 = buildInputArgsForAsset(
        secondaryAsset,
        secondaryDiskPath,
        clip.sourceIn + 0.8,
        readDur
      );

      const filterComplex = [
        `[0:v]setpts=PTS/${rate.toFixed(3)},scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1,fps=60,trim=duration=${outDur},setpts=PTS-STARTPTS[top]`,
        `[1:v]setpts=PTS/${rate.toFixed(3)},scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1,fps=60,trim=duration=${outDur},setpts=PTS-STARTPTS[bot]`,
        `[top][bot]vstack=inputs=2,eq=brightness=${brightnessOffset.toFixed(2)}:contrast=${contrastVal.toFixed(2)}:saturation=1.08,drawbox=x=0:y=958:w=1080:h=4:color=0xFACC15:t=fill${postOverlayChain},format=yuv420p[vout]`,
      ].join(';');

      await execFileAsync(
        'ffmpeg',
        [
          '-nostdin',
          '-loglevel',
          'error',
          '-y',
          ...args1,
          ...args2,
          '-filter_complex',
          filterComplex,
          '-map',
          '[vout]',
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-maxrate',
          '4500k',
          '-bufsize',
          '9000k',
          '-profile:v',
          'high',
          '-pix_fmt',
          'yuv420p',
          '-r',
          '60',
          outSegMp4,
        ],
        { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }
      );
      return;
    } catch (splitErr: any) {
      console.warn(
        `Segment ${segIndex} split-2up fallback to single clip:`,
        splitErr?.message
      );
    }
  }

  // Case B: Full 9:16 Vertical Product Video Cut ('fill' with Sharp Cut)
  if (primaryDiskPath && primaryAsset) {
    const inputArgs = buildInputArgsForAsset(
      primaryAsset,
      primaryDiskPath,
      clip.sourceIn,
      readDur
    );

    const isZoomMode =
      clip.visualMode === 'dynamic-zoom' ||
      clip.visualMode === 'ref-showcase' ||
      clip.zoomIntensity > 1.12;

    const scaleAndCrop = isZoomMode
      ? `scale=1240:2204:force_original_aspect_ratio=increase,crop=1080:1920:'(iw-1080)/2':'(ih-1920)/2 - 48*sin(t*1.4)'`
      : `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;

    const vf = `setpts=PTS/${rate.toFixed(3)},${scaleAndCrop},setsar=1,fps=60,trim=duration=${outDur},setpts=PTS-STARTPTS,eq=brightness=${brightnessOffset.toFixed(2)}:contrast=${contrastVal.toFixed(2)}:saturation=1.06${postOverlayChain},format=yuv420p`;

    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-nostdin',
          '-loglevel',
          'error',
          '-y',
          ...inputArgs,
          '-vf',
          vf,
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-maxrate',
          '4500k',
          '-bufsize',
          '9000k',
          '-profile:v',
          'high',
          '-pix_fmt',
          'yuv420p',
          '-r',
          '60',
          outSegMp4,
        ],
        { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }
      );
      return;
    } catch (singleErr: any) {
      console.warn(
        `Segment ${segIndex} primary filter retry with simplified filter:`,
        singleErr?.message
      );
      try {
        const simpleVf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=60,trim=duration=${outDur},setpts=PTS-STARTPTS${postOverlayChain},format=yuv420p`;
        await execFileAsync(
          'ffmpeg',
          [
            '-nostdin',
            '-loglevel',
            'error',
            '-y',
            '-t',
            outDur.toFixed(3),
            '-i',
            primaryDiskPath,
            '-vf',
            simpleVf,
            '-an',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '23',
            '-maxrate',
            '4500k',
            '-bufsize',
            '9000k',
            '-profile:v',
            'high',
            '-pix_fmt',
            'yuv420p',
            '-r',
            '60',
            outSegMp4,
          ],
          { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }
        );
        return;
      } catch (retryErr: any) {
        console.warn(
          `Segment ${segIndex} simplified filter fallback:`,
          retryErr?.message
        );
      }
    }
  }

  // Emergency fallback only if no visual file was provided or readable in the folder
  await execFileAsync(
    'ffmpeg',
    [
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=0x11131A:s=1080x1920:r=60:d=${outDur}`,
      '-vf',
      `setsar=1${postOverlayChain},format=yuv420p`,
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      outSegMp4,
    ],
    { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }
  );
}

function buildInputArgsForAsset(
  asset: FolderAsset,
  diskPath: string,
  sourceIn: number,
  readDur: number
): string[] {
  if (asset.type === 'image') {
    return ['-loop', '1', '-t', readDur.toFixed(3), '-i', diskPath];
  }

  const assetDur = Math.max(0.5, asset.duration || 5.0);

  // If the video clip is at least as long as readDur, clamp safeIn so we NEVER need -stream_loop
  if (assetDur >= readDur + 0.08) {
    const maxStart = Math.max(0, assetDur - readDur - 0.05);
    const clampedIn = Math.max(
      0,
      Math.min(maxStart, Number((sourceIn % (maxStart + 0.01)).toFixed(3)))
    );
    return [
      '-ss',
      clampedIn.toFixed(3),
      '-t',
      readDur.toFixed(3),
      '-i',
      diskPath,
    ];
  }

  // For very short clips (< readDur), place BOTH -stream_loop and -t BEFORE -i so FFmpeg never hangs or misplaces options!
  return [
    '-stream_loop',
    '-1',
    '-t',
    readDur.toFixed(3),
    '-i',
    diskPath,
  ];
}

/**
 * Generates real MP4 video clips and a real WAV voiceover on disk for the "Try Sample Folder"
 * flow so even the sample demo runs 100% through the real FFmpeg pipeline.
 */
export async function generateSampleFolderFilesOnDisk(
  uploadsDir: string,
  ttsAudioBuffer?: Buffer | null
): Promise<{
  files: Array<{
    diskPath: string;
    relName: string;
    type: 'video' | 'audio' | 'document';
  }>;
}> {
  await fs.mkdir(uploadsDir, { recursive: true });

  const sampleClips = [
    {
      fileName: 'clip_01_product_hero_unboxing.mp4',
      relName: 'clips/clip_01_product_hero_unboxing.mp4',
      bgHex: '0x1E293B',
      accentHex: '0xFACC15',
      title: 'AERO-PULSE PRO MASSAGER',
      subtitle: 'MACRO UNBOXING & BRUSHLESS MOTOR',
      duration: 4.5,
    },
    {
      fileName: 'clip_02_deep_percussion_test.mp4',
      relName: 'clips/clip_02_deep_percussion_test.mp4',
      bgHex: '0x0F172A',
      accentHex: '0x38BDF8',
      title: '3200 RPM PERCUSSION TEST',
      subtitle: '14MM DEEP TISSUE AMPLITUDE',
      duration: 4.5,
    },
    {
      fileName: 'clip_03_titanium_attachments.mp4',
      relName: 'clips/clip_03_titanium_attachments.mp4',
      bgHex: '0x18181B',
      accentHex: '0x10B981',
      title: '6 TITANIUM INTERCHANGE HEADS',
      subtitle: 'ULTRA-QUIET 35dB GLIDE SENSOR',
      duration: 4.5,
    },
    {
      fileName: 'clip_04_travel_case_pack.mp4',
      relName: 'clips/clip_04_travel_case_pack.mp4',
      bgHex: '0x1E1B4B',
      accentHex: '0xFACC15',
      title: 'USB-C FAST CHARGE · 30 DAY BATTERY',
      subtitle: 'POCKET-SIZED CARBON SHELL',
      duration: 4.5,
    },
  ];

  const createdFiles: Array<{
    diskPath: string;
    relName: string;
    type: 'video' | 'audio' | 'document';
  }> = [];

  const createdVideos = await Promise.all(
    sampleClips.map(async (c, i) => {
      const outPath = path.join(uploadsDir, c.fileName);
      const t1Path = path.join(uploadsDir, `sample_t1_${i}.txt`);
      const t2Path = path.join(uploadsDir, `sample_t2_${i}.txt`);
      await fs.writeFile(t1Path, c.title, 'utf8');
      await fs.writeFile(t2Path, c.subtitle, 'utf8');

      const vf = [
        `drawbox=x=120:y='420+40*sin(t*2.2)':w=840:h=840:color=${c.accentHex}@0.18:t=fill`,
        `drawbox=x=120:y='420+40*sin(t*2.2)':w=840:h=840:color=${c.accentHex}@0.85:t=6`,
        `drawtext=fontfile=${BOLD_FONT_PATH}:textfile=${t1Path}:expansion=none:fontcolor=0xF8FAFC:fontsize=52:x=(w-text_w)/2:y=780`,
        `drawtext=fontfile=${MONO_FONT_PATH}:textfile=${t2Path}:expansion=none:fontcolor=${c.accentHex}:fontsize=32:x=(w-text_w)/2:y=860`,
        `format=yuv420p`,
      ].join(',');

      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          `color=c=${c.bgHex}:s=1080x1920:r=30:d=${c.duration}`,
          '-vf',
          vf,
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-crf',
          '23',
          outPath,
        ],
        { timeout: 25000 }
      );

      return {
        diskPath: outPath,
        relName: c.relName,
        type: 'video' as const,
      };
    })
  );
  createdFiles.push(...createdVideos);

  // Create voiceover WAV file (either from Gemini TTS buffer or synthesized multi-phrase audio with real silences)
  const voPath = path.join(uploadsDir, 'voiceover_aeropulse_raw.wav');
  if (ttsAudioBuffer && ttsAudioBuffer.length > 500) {
    await fs.writeFile(voPath, ttsAudioBuffer);
  } else {
    // Generate 4 distinct spoken-cadence bursts separated by 0.65s silent pauses so silencedetect strips real pauses!
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=f=220:d=2.2',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=44100:cl=mono:d=0.65',
        '-f',
        'lavfi',
        '-i',
        'sine=f=260:d=2.3',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=44100:cl=mono:d=0.70',
        '-f',
        'lavfi',
        '-i',
        'sine=f=290:d=2.2',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=44100:cl=mono:d=0.60',
        '-f',
        'lavfi',
        '-i',
        'sine=f=330:d=2.5',
        '-filter_complex',
        '[0:a][1:a][2:a][3:a][4:a][5:a][6:a]concat=n=7:v=0:a=1,volume=0.35[aout]',
        '-map',
        '[aout]',
        '-acodec',
        'pcm_s16le',
        '-ar',
        '44100',
        '-ac',
        '2',
        voPath,
      ],
      { timeout: 20000 }
    );
  }

  createdFiles.push({
    diskPath: voPath,
    relName: 'audio/voiceover_aeropulse_raw.wav',
    type: 'audio',
  });

  const docPath = path.join(uploadsDir, 'product_brief.txt');
  await fs.writeFile(
    docPath,
    `Product: AeroPulse Pro Pocket Percussion Massager\nScript:\nStop living with stiff shoulders after a ten-hour desk shift.\nAeroPulse Pro packs a 3200 RPM brushless titanium motor into your palm.\nSix precision heads melt deep muscle knots in ninety seconds with whisper-quiet glide.\nComment 'PULSE' right now and we will send you the 50% VIP link in DM!`,
    'utf8'
  );
  createdFiles.push({
    diskPath: docPath,
    relName: 'product_brief.txt',
    type: 'document',
  });

  return { files: createdFiles };
}
