import express from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleGenAI, Type } from '@google/genai';
import {
  buildJCutVoiceoverTimeline,
  assembleCommercialCut,
  extractCtaTriggerFromTranscript,
} from './src/utils/editingEngine.ts';
import { DEFAULT_PACING_CONFIG } from './src/utils/demoFolderKit.ts';
import {
  probeMediaFile,
  extractVideoKeyframe,
  normalizeVoiceoverAudio,
  detectSpeechIntervalsWithFFmpeg,
  buildEditedVoiceoverAudioWithFFmpeg,
  renderCommercialMp4WithFFmpeg,
  generateSampleFolderFilesOnDisk,
} from './src/server/videoPipeline.ts';
import type {
  AdProjectState,
  FolderAsset,
  PacingConfig,
} from './src/types/editor.ts';

dotenv.config();

const app = express();
const PORT = 3000;

const JOBS_ROOT = path.join(os.tmpdir(), 'cutshut-jobs');
fsSync.mkdirSync(JOBS_ROOT, { recursive: true });

app.use(express.json({ limit: '100mb' }));

interface JobRecord {
  jobId: string;
  jobDir: string;
  uploadsDir: string;
  rawWavPath: string | null;
  editedWavPath: string | null;
  editedMp3Path: string | null;
  finalMp4Path: string;
  assetDiskPaths: Map<string, string>;
  project: AdProjectState;
}

interface UploadedFileEntry {
  diskPath: string;
  relName: string;
  mimeType?: string;
  sizeBytes?: number;
}

interface PendingJobSession {
  jobId: string;
  folderName: string;
  pacing: PacingConfig;
  jobDir: string;
  uploadsDir: string;
  fileDiskPaths: Map<number, string>;
  completedFiles: UploadedFileEntry[];
}

interface JobProgressStatus {
  jobId: string;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  stepIndex: number;
  progressPct: number;
  error?: string;
  result?: any;
}

const activeJobs = new Map<string, JobRecord>();
const pendingJobSessions = new Map<string, PendingJobSession>();
const jobProgressMap = new Map<string, JobProgressStatus>();

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Configure Multer disk storage per job upload request
const uploadStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    let jobId = (req as any).jobId;
    if (!jobId) {
      jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      (req as any).jobId = jobId;
    }
    const uploadsDir = path.join(JOBS_ROOT, jobId, 'uploads');
    fsSync.mkdirSync(uploadsDir, { recursive: true });
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const safeBase = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${safeBase}`;
    cb(null, uniqueName);
  },
});

const execFileAsync = promisify(execFile);

const uploadMiddleware = multer({
  storage: uploadStorage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB per clip/archive
    files: 300,
  },
});

const chunkUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB per chunk (frontend sends 4MB chunks)
  },
});

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.flac',
  '.opus',
  '.wma',
  '.aiff',
  '.aif',
  '.amr',
  '.oga',
  '.caf',
  '.weba',
]);
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.webm',
  '.mkv',
  '.avi',
  '.m4v',
  '.3gp',
  '.ts',
  '.mts',
  '.m2ts',
  '.wmv',
  '.flv',
  '.mpg',
  '.mpeg',
  '.ogv',
  '.vob',
]);
const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.avif',
  '.gif',
]);
const DOC_EXTENSIONS = new Set(['.txt', '.md', '.json', '.csv', '.srt', '.vtt']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.tar', '.tgz', '.gz']);

/**
 * Recursively scans an unpacked directory on disk and returns all nested files
 */
async function readAllFilesRecursively(
  dir: string
): Promise<Array<{ diskPath: string; sizeBytes: number }>> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const results: Array<{ diskPath: string; sizeBytes: number }> = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__MACOSX' || entry.name.startsWith('.')) {
        continue;
      }
      const sub = await readAllFilesRecursively(fullPath);
      results.push(...sub);
    } else if (entry.isFile()) {
      if (
        entry.name.startsWith('._') ||
        entry.name === '.DS_Store' ||
        entry.name.toLowerCase() === 'thumbs.db' ||
        entry.name.toLowerCase() === 'desktop.ini'
      ) {
        continue;
      }
      const stat = await fs.stat(fullPath).catch(() => null);
      results.push({ diskPath: fullPath, sizeBytes: stat?.size ?? 0 });
    }
  }

  return results;
}

/**
 * Automatically extracts .zip, .tar, .tar.gz archives uploaded by the user so that
 * all enclosed video clips, audio tracks, and images are unpacked and processed by the engine.
 */
async function unpackUploadedEntries(
  uploadsDir: string,
  entries: UploadedFileEntry[]
): Promise<{
  allFiles: UploadedFileEntry[];
  inferredFolderName?: string;
}> {
  const allFiles: UploadedFileEntry[] = [];
  let inferredFolderName: string | undefined;

  for (let idx = 0; idx < entries.length; idx++) {
    const f = entries[idx];
    const origName = path.basename(f.relName || f.diskPath);
    const lowerName = origName.toLowerCase();
    const ext = path.extname(lowerName);

    const isZip =
      ext === '.zip' ||
      f.mimeType === 'application/zip' ||
      f.mimeType === 'application/x-zip-compressed';
    const isTar =
      ext === '.tar' ||
      ext === '.tgz' ||
      lowerName.endsWith('.tar.gz');

    if (isZip || isTar) {
      const archiveBaseName = path
        .basename(origName, path.extname(origName))
        .replace(/\.tar$/i, '');
      if (!inferredFolderName && archiveBaseName) {
        inferredFolderName = archiveBaseName;
      }

      const unpackDir = path.join(uploadsDir, `unpacked_${idx}_${Date.now()}`);
      await fs.mkdir(unpackDir, { recursive: true });

      try {
        if (isZip) {
          try {
            await execFileAsync('unzip', ['-q', '-o', f.diskPath, '-d', unpackDir]);
          } catch {
            // Fallback to Python zipfile module if unzip encounters non-standard zip flags
            await execFileAsync('python3', [
              '-c',
              'import zipfile, sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
              f.diskPath,
              unpackDir,
            ]);
          }
        } else {
          await execFileAsync('tar', ['-xf', f.diskPath, '-C', unpackDir]);
        }

        const extracted = await readAllFilesRecursively(unpackDir);
        for (let k = 0; k < extracted.length; k++) {
          const item = extracted[k];
          const itemRel = path.relative(unpackDir, item.diskPath);
          const safeBase = path
            .basename(item.diskPath)
            .replace(/[^a-zA-Z0-9._-]/g, '_');
          const flatDiskPath = path.join(
            uploadsDir,
            `${Date.now()}_unpacked_${idx}_${k}_${safeBase}`
          );
          await fs.rename(item.diskPath, flatDiskPath).catch(async () => {
            await fs.copyFile(item.diskPath, flatDiskPath);
          });
          allFiles.push({
            diskPath: flatDiskPath,
            relName: itemRel,
            sizeBytes: item.sizeBytes,
          });
        }
        continue;
      } catch (err: any) {
        console.warn('Archive extraction failed:', err?.message || err);
      }
    }

    allFiles.push(f);
  }

  return { allFiles, inferredFolderName };
}

async function unpackAnyArchives(
  uploadsDir: string,
  files: Express.Multer.File[],
  relativePaths: string[]
): Promise<{
  allFiles: UploadedFileEntry[];
  inferredFolderName?: string;
}> {
  const entries: UploadedFileEntry[] = files.map((f, idx) => ({
    diskPath: f.path,
    relName: relativePaths[idx] || f.originalname,
    mimeType: f.mimetype,
    sizeBytes: f.size,
  }));
  return unpackUploadedEntries(uploadsDir, entries);
}

/**
 * Shared Backend Pipeline that processes a job directory containing uploaded files:
 * 1. Probes every file with ffprobe
 * 2. Extracts voiceover audio, runs ffmpeg silencedetect, and builds J-cut spliced audio
 * 3. Transcribes voiceover & analyzes video frames via gemini-3-flash-preview
 * 4. Cuts & shuts the actual video clips with ffmpeg into a 1080x1920 @ 60fps MP4 with blackish fade + top Comment CTA
 */
async function executeJobPipelineOnBackend(params: {
  jobId: string;
  folderName: string;
  uploadedFiles: UploadedFileEntry[];
  pacing: PacingConfig;
  onProgress?: (stepIndex: number, progressPct: number) => void;
}) {
  const { jobId, folderName, uploadedFiles, pacing, onProgress } = params;
  const jobDir = path.join(JOBS_ROOT, jobId);
  const uploadsDir = path.join(jobDir, 'uploads');
  const thumbsDir = path.join(jobDir, 'thumbs');
  await fs.mkdir(thumbsDir, { recursive: true });
  onProgress?.(0, 15);

  const assets: FolderAsset[] = [];
  const assetDiskPaths = new Map<string, string>();
  const keyframePartsForGemini: Array<{
    assetId: string;
    assetName: string;
    base64Jpg: string;
  }> = [];

  let detectedVoiceoverDiskPath: string | null = null;
  let detectedVoiceoverRelName = '';
  let candidateVideoWithAudio: { diskPath: string; relName: string } | null =
    null;

  // Step 1: Probe all uploaded files using ffprobe
  for (let i = 0; i < uploadedFiles.length; i++) {
    const f = uploadedFiles[i];
    const baseName = path.basename(f.relName);
    if (
      baseName.startsWith('._') ||
      baseName === '.DS_Store' ||
      baseName.toLowerCase() === 'thumbs.db' ||
      baseName.toLowerCase() === 'desktop.ini'
    ) {
      continue;
    }

    const ext = path.extname(baseName).toLowerCase();
    const stat = await fs.stat(f.diskPath).catch(() => null);
    const sizeBytes = f.sizeBytes ?? stat?.size ?? 0;
    const diskFileName = path.basename(f.diskPath);

    // Check Document
    if (DOC_EXTENSIONS.has(ext)) {
      const textContent = await fs.readFile(f.diskPath, 'utf8').catch(() => '');
      const id = `doc-${i}-${Date.now()}`;
      assetDiskPaths.set(id, f.diskPath);
      assets.push({
        id,
        name: f.relName,
        type: 'document',
        url: `/api/jobs/${jobId}/uploads/${encodeURIComponent(diskFileName)}`,
        serverUrl: `/api/jobs/${jobId}/uploads/${encodeURIComponent(diskFileName)}`,
        diskFileName,
        duration: 0,
        width: 0,
        height: 0,
        sizeBytes,
        productScore: 100,
        humanPresenceScore: 0,
        visualTags: ['brief', 'document'],
        textContent,
      });
      continue;
    }

    // Check Image
    if (IMAGE_EXTENSIONS.has(ext) || f.mimeType?.startsWith('image/')) {
      const info = await probeMediaFile(f.diskPath);
      const id = `img-${i}-${Date.now()}`;
      assetDiskPaths.set(id, f.diskPath);
      const fileUrl = `/api/jobs/${jobId}/uploads/${encodeURIComponent(diskFileName)}`;
      assets.push({
        id,
        name: f.relName,
        type: 'image',
        url: fileUrl,
        serverUrl: fileUrl,
        diskFileName,
        thumbnailUrl: fileUrl,
        duration: 4.0,
        width: info.width || 1080,
        height: info.height || 1920,
        sizeBytes,
        productScore: 92,
        humanPresenceScore: 0,
        visualTags: f.relName
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length > 2),
      });
      continue;
    }

    // Probe Audio / Video via ffprobe
    const probed = await probeMediaFile(f.diskPath);
    const lowerRel = f.relName.toLowerCase();
    const hasVoiceKeyword =
      /\b(voiceover|voice|vo|audio|narration|speech|sound)\b/i.test(lowerRel);

    const isExplicitAudio =
      AUDIO_EXTENSIONS.has(ext) ||
      f.mimeType?.startsWith('audio/') ||
      (probed.hasAudio && !probed.hasVideo);

    if (isExplicitAudio) {
      const id = `aud-${i}-${Date.now()}`;
      assetDiskPaths.set(id, f.diskPath);
      const fileUrl = `/api/jobs/${jobId}/uploads/${encodeURIComponent(diskFileName)}`;
      if (!detectedVoiceoverDiskPath || hasVoiceKeyword) {
        detectedVoiceoverDiskPath = f.diskPath;
        detectedVoiceoverRelName = f.relName;
      }
      assets.push({
        id,
        name: f.relName,
        type: 'audio',
        url: fileUrl,
        serverUrl: fileUrl,
        diskFileName,
        duration: probed.duration,
        width: 0,
        height: 0,
        sizeBytes,
        productScore: 100,
        humanPresenceScore: 0,
        visualTags: ['voiceover', 'audio', 'cta'],
      });
      continue;
    }

    if (VIDEO_EXTENSIONS.has(ext) || probed.hasVideo || f.mimeType?.startsWith('video/')) {
      // Check if this video is actually the user's voiceover file (e.g. named voiceover.mp4 or at root level)
      if (probed.hasAudio && (!candidateVideoWithAudio || hasVoiceKeyword)) {
        candidateVideoWithAudio = { diskPath: f.diskPath, relName: f.relName };
      }

      const id = `vid-${i}-${Date.now()}`;
      assetDiskPaths.set(id, f.diskPath);
      const fileUrl = `/api/jobs/${jobId}/uploads/${encodeURIComponent(diskFileName)}`;

      // Extract a real keyframe JPEG from this video clip
      const thumbName = `thumb_${id}.jpg`;
      const thumbDiskPath = path.join(thumbsDir, thumbName);
      const base64Jpg = await extractVideoKeyframe(
        f.diskPath,
        probed.duration,
        thumbDiskPath
      );
      if (base64Jpg && keyframePartsForGemini.length < 10) {
        keyframePartsForGemini.push({
          assetId: id,
          assetName: f.relName,
          base64Jpg,
        });
      }

      const isTalkingHeadName =
        lowerRel.includes('talking') ||
        lowerRel.includes('human') ||
        lowerRel.includes('vlog') ||
        lowerRel.includes('face');

      assets.push({
        id,
        name: f.relName,
        type: 'video',
        url: fileUrl,
        serverUrl: fileUrl,
        diskFileName,
        thumbnailUrl: base64Jpg
          ? `/api/jobs/${jobId}/thumbs/${encodeURIComponent(thumbName)}`
          : undefined,
        duration: probed.duration,
        width: probed.width,
        height: probed.height,
        sizeBytes,
        productScore: isTalkingHeadName ? 32 : 95 - (i % 7),
        humanPresenceScore: isTalkingHeadName ? 85 : 5,
        visualTags: f.relName
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length > 2),
      });
    }
  }

  // If no standalone audio file was found, extract the voiceover from the best video with an audio track
  if (!detectedVoiceoverDiskPath && candidateVideoWithAudio) {
    detectedVoiceoverDiskPath = candidateVideoWithAudio.diskPath;
    detectedVoiceoverRelName = candidateVideoWithAudio.relName;
  }

  const rawWavPath = path.join(jobDir, 'raw_vo.wav');
  const rawMp3Path = path.join(jobDir, 'raw_vo.mp3');
  const editedWavPath = path.join(jobDir, 'edited_vo.wav');
  const editedMp3Path = path.join(jobDir, 'edited_vo.mp3');
  const finalMp4Path = path.join(jobDir, 'final.mp4');

  let rawAudioDuration = 12.0;
  let speechWindows: Array<{ rawStart: number; rawEnd: number }> = [];

  // Step 2: Normalize voiceover audio & detect real speech vs silence intervals via FFmpeg
  if (detectedVoiceoverDiskPath) {
    try {
      const norm = await normalizeVoiceoverAudio(
        detectedVoiceoverDiskPath,
        rawWavPath,
        rawMp3Path
      );
      rawAudioDuration = norm.duration;

      const audioAsset = assets.find((a) => a.type === 'audio');
      if (audioAsset) {
        audioAsset.duration = norm.duration;
        audioAsset.waveformPeaks = norm.waveformPeaks;
      } else {
        assets.push({
          id: `aud-extracted-${Date.now()}`,
          name: `${detectedVoiceoverRelName} (Audio Track)`,
          type: 'audio',
          url: `/api/jobs/${jobId}/edited_vo.mp3`,
          serverUrl: `/api/jobs/${jobId}/edited_vo.mp3`,
          duration: norm.duration,
          width: 0,
          height: 0,
          sizeBytes: 0,
          productScore: 100,
          humanPresenceScore: 0,
          visualTags: ['voiceover', 'audio'],
          waveformPeaks: norm.waveformPeaks,
        });
      }

      speechWindows = await detectSpeechIntervalsWithFFmpeg(
        rawWavPath,
        rawAudioDuration,
        pacing
      );
    } catch (e: any) {
      console.warn('Voiceover normalization notice:', e?.message);
    }
  }

  if (speechWindows.length === 0) {
    const count = 4;
    const step = rawAudioDuration / count;
    for (let i = 0; i < count; i++) {
      speechWindows.push({
        rawStart: Number((i * step).toFixed(3)),
        rawEnd: Number(((i + 1) * step).toFixed(3)),
      });
    }
  }

  const docAsset = assets.find((a) => a.type === 'document');
  const videoAssetsOnly = assets.filter((a) => a.type === 'video');
  if (videoAssetsOnly.length > 0) {
    // Strictly remove any static image files when real video clips are present in the folder
    for (let i = assets.length - 1; i >= 0; i--) {
      if (assets[i].type === 'image') {
        assets.splice(i, 1);
      }
    }
  }

  const visualAssets = assets.filter(
    (a) => a.type === 'video' || a.type === 'image'
  );

  if (visualAssets.length === 0) {
    throw new Error(
      'No video clips (.mp4, .mov, .webm) found in the uploaded folder or archive. Please make sure your folder or .zip contains your product video clips and an audio file.'
    );
  }

  onProgress?.(1, 38);

  const isSyntheticSample = jobId.startsWith('sample_');

  // Step 3: Transcribe the real voiceover audio via gemini-3-flash-preview
  let transcriptText = '';
  if (fsSync.existsSync(rawMp3Path) && !isSyntheticSample) {
    try {
      const mp3Buf = await fs.readFile(rawMp3Path);
      const ai = getGeminiClient();
      const transRes: any = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/mp3',
                  data: mp3Buf.toString('base64'),
                },
              },
              {
                text: 'Listen carefully to this audio track. If a human voice is speaking, transcribe the spoken words word-for-word, keeping the final call-to-action (CTA) sentence and comment keyword at the end intact. If there is NO human speech (only synthetic tones, beeps, sound effects, or instrumental music), output the exact single word: NO_SPEECH',
              },
            ],
          },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Transcribe timeout')), 18000)
        ),
      ]);
      const rawTrans = (transRes?.text || '').trim();
      if (
        rawTrans.length > 3 &&
        !rawTrans.toUpperCase().includes('NO_SPEECH')
      ) {
        transcriptText = rawTrans;
      }
    } catch (e: any) {
      console.warn('gemini-3-flash-preview transcribe notice:', e?.message);
    }
  }

  if (!transcriptText && docAsset?.textContent) {
    transcriptText = docAsset.textContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length > 10 &&
          !l.toLowerCase().startsWith('product:') &&
          !l.toLowerCase().startsWith('script:')
      )
      .join(' ');
  }

  const cleanFolderTitle = folderName
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const defaultTrigger =
    cleanFolderTitle
      .split(/\s+/)[0]
      ?.replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase() || 'LINK';

  if (!transcriptText) {
    transcriptText = `Experience ${cleanFolderTitle} in action right out of the box. Built with precision engineering and tested for maximum durability. Watch the close-up performance test from every angle. Comment '${defaultTrigger}' below and we will send you the direct product link in DM!`;
  }

  onProgress?.(2, 58);

  // Step 4: Multimodal Gemini Analysis (align transcript to speech windows, extract CTA trigger word, score keyframes, and match each dialogue beat to the best video clip)
  let productName = cleanFolderTitle;
  let productBriefSummary =
    docAsset?.textContent?.slice(0, 220) ||
    `9:16 Vertical Commercial Ad cut from ${visualAssets.length} video clips in ${folderName}.`;
  let aiTriggerWord = '';
  let aiSegmentTexts: string[] = [];
  const aiBeatClipMatches = new Map<number, string>();

  if (!isSyntheticSample) {
    try {
      const ai = getGeminiClient();
      const multimodalParts: any[] = [];

      for (const kf of keyframePartsForGemini) {
        multimodalParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: kf.base64Jpg,
          },
        });
        multimodalParts.push({
          text: `Keyframe above is from video clip: "${kf.assetName}" (id: ${kf.assetId})`,
        });
      }

      multimodalParts.push({
        text: `You are an AI E-Commerce Commercial Video Editor.
Folder Name: "${folderName}"
Product Document: "${docAsset?.textContent || 'None'}"
Video Clips in Folder: ${visualAssets.map((v) => `"${v.name}" (id:${v.id}, duration:${v.duration.toFixed(1)}s)`).join(', ')}
Full Voiceover Transcript: "${transcriptText}"
Number of Detected Speech Beats: ${speechWindows.length}

Tasks:
1. Split the Full Voiceover Transcript into exactly ${speechWindows.length} spoken dialogue packets in chronological order (NEVER repeat earlier sentences; the LAST beat line MUST contain the end-of-audio Comment CTA).
2. Extract the single CTA trigger word that viewers are told to comment at the end of the audio (e.g., "DINO", "PULSE", "LINK", "GLOW").
3. For each spoken beat (0 to ${speechWindows.length - 1}), pick the most visually relevant video clip ID (matchedAssetId) from the Video Clips list that best illustrates that spoken dialogue line.
4. Score each video clip: productScore (0-100) and humanPresenceScore (0-100) and provide rich visualTags.`,
      });

      const aiRes: any = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: { parts: multimodalParts },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                productName: { type: Type.STRING },
                productBriefSummary: { type: Type.STRING },
                ctaTriggerWord: { type: Type.STRING },
                beatTexts: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                beatMatchedAssetIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                assetScores: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      productScore: { type: Type.NUMBER },
                      humanPresenceScore: { type: Type.NUMBER },
                      visualTags: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                    },
                    required: [
                      'name',
                      'productScore',
                      'humanPresenceScore',
                      'visualTags',
                    ],
                  },
                },
              },
              required: [
                'productName',
                'productBriefSummary',
                'ctaTriggerWord',
                'beatTexts',
              ],
            },
          },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gemini analysis timeout')), 20000)
        ),
      ]);

      const parsed = JSON.parse((aiRes?.text || '{}').trim());
      if (parsed.productName) productName = parsed.productName;
      if (parsed.productBriefSummary)
        productBriefSummary = parsed.productBriefSummary;
      if (parsed.ctaTriggerWord) {
        aiTriggerWord = String(parsed.ctaTriggerWord)
          .replace(/[^A-Za-z0-9_-]/g, '')
          .toUpperCase();
      }
      if (Array.isArray(parsed.beatTexts) && parsed.beatTexts.length > 0) {
        aiSegmentTexts = parsed.beatTexts;
      }
      if (Array.isArray(parsed.beatMatchedAssetIds)) {
        parsed.beatMatchedAssetIds.forEach((idOrName: string, bIdx: number) => {
          const found = visualAssets.find(
            (v) =>
              v.id === idOrName ||
              v.name === idOrName ||
              v.name.endsWith(idOrName)
          );
          if (found) {
            aiBeatClipMatches.set(bIdx, found.id);
          }
        });
      }
      if (Array.isArray(parsed.assetScores)) {
        for (const sc of parsed.assetScores) {
          const target = assets.find(
            (a) => a.name === sc.name || a.name.endsWith(sc.name)
          );
          if (target) {
            target.productScore = sc.productScore ?? target.productScore;
            target.humanPresenceScore =
              sc.humanPresenceScore ?? target.humanPresenceScore;
            if (Array.isArray(sc.visualTags) && sc.visualTags.length > 0) {
              target.visualTags = sc.visualTags;
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('Gemini multimodal analysis fallback:', err?.message);
    }
  }

  // Distribute transcript words proportionally across speechWindows if aiSegmentTexts count doesn't match speechWindows.length
  // This guarantees we NEVER wrap around or repeat earlier sentences!
  const proportionalLines: string[] = [];
  if (aiSegmentTexts.length === speechWindows.length) {
    for (let i = 0; i < aiSegmentTexts.length; i++) {
      const curr = aiSegmentTexts[i].trim();
      const next = i + 1 < aiSegmentTexts.length ? aiSegmentTexts[i + 1].trim() : '';
      if (curr && curr === next) {
        const words = curr.split(/\s+/);
        const mid = Math.max(1, Math.ceil(words.length / 2));
        proportionalLines.push(words.slice(0, mid).join(' '));
        aiSegmentTexts[i + 1] = words.slice(mid).join(' ') || curr;
      } else {
        proportionalLines.push(curr);
      }
    }
  } else {
    const allWords = transcriptText.trim().split(/\s+/).filter(Boolean);
    const totalWinDur = Math.max(
      0.5,
      speechWindows.reduce((acc, w) => acc + Math.max(0.3, w.rawEnd - w.rawStart), 0)
    );
    let wordCursor = 0;
    for (let i = 0; i < speechWindows.length; i++) {
      if (i === speechWindows.length - 1) {
        const remaining = allWords.slice(wordCursor).join(' ');
        proportionalLines.push(
          remaining || allWords.slice(-6).join(' ') || `Comment ${defaultTrigger}`
        );
      } else {
        const winDur = Math.max(0.3, speechWindows[i].rawEnd - speechWindows[i].rawStart);
        const share = Math.max(
          2,
          Math.round((winDur / totalWinDur) * allWords.length)
        );
        const maxTake = Math.max(1, allWords.length - (speechWindows.length - 1 - i) * 2);
        const endIdx = Math.min(maxTake, wordCursor + share);
        const sliceWords = allWords.slice(wordCursor, Math.max(wordCursor + 1, endIdx));
        wordCursor = Math.max(wordCursor + 1, endIdx);
        proportionalLines.push(sliceWords.join(' '));
      }
    }
  }

  const rawPhrases = speechWindows.map((win, idx) => {
    const textLine =
      proportionalLines[idx] || `${productName} highlight ${idx + 1}`;
    return {
      id: `vo-${idx + 1}`,
      text: textLine,
      rawStart: win.rawStart,
      rawEnd: win.rawEnd,
      semanticTopic: textLine,
      matchedAssetId: aiBeatClipMatches.get(idx),
    };
  });

  // Step 5: Build J-Cut Voiceover Timeline & Physically Cut/Splice Voiceover Audio with FFmpeg
  const { segments, totalAudioDuration, totalSilenceRemovedSec } =
    buildJCutVoiceoverTimeline(rawPhrases, pacing);

  let hasEditedAudio = false;
  if (fsSync.existsSync(rawWavPath)) {
    try {
      await buildEditedVoiceoverAudioWithFFmpeg(
        rawWavPath,
        segments,
        editedWavPath,
        editedMp3Path
      );
      hasEditedAudio = true;
    } catch (e: any) {
      console.warn('FFmpeg J-cut audio build warning:', e?.message);
    }
  }

  // Step 6: Assemble Commercial Video Cuts, Sparse Kinetic Text, and End Comment CTA
  const { clips, sparseTexts, endCta } = assembleCommercialCut(
    assets,
    segments,
    pacing
  );

  // Extract CTA trigger word from full transcript & last segment
  const extractedFromLast =
    segments.length > 0
      ? extractCtaTriggerFromTranscript(segments[segments.length - 1].text)
      : extractCtaTriggerFromTranscript(transcriptText);
  const extractedFromFull = extractCtaTriggerFromTranscript(transcriptText);

  if (extractedFromLast.isCta && extractedFromLast.triggerWord) {
    endCta.triggerWord = extractedFromLast.triggerWord;
  } else if (aiTriggerWord && aiTriggerWord.length >= 2) {
    endCta.triggerWord = aiTriggerWord;
  } else if (extractedFromFull.isCta && extractedFromFull.triggerWord) {
    endCta.triggerWord = extractedFromFull.triggerWord;
  } else {
    endCta.triggerWord = defaultTrigger;
  }

  const versionTag = Date.now();
  const project: AdProjectState = {
    jobId,
    renderedVideoUrl: `/api/jobs/${jobId}/final.mp4?v=${versionTag}`,
    editedAudioUrl: hasEditedAudio
      ? `/api/jobs/${jobId}/edited_vo.mp3?v=${versionTag}`
      : undefined,
    folderName,
    productName,
    productBriefSummary,
    resolution: '1080x1920',
    fps: 60,
    aspectRatio: '9:16',
    assets,
    voiceoverSegments: segments,
    clips,
    sparseTexts,
    endCta,
    pacing,
    totalDuration: Number(Math.max(totalAudioDuration, 3.0).toFixed(2)),
  };

  onProgress?.(3, 78);

  // Step 7: Render the 1080x1920 @ 60fps Commercial MP4 on the Backend using FFmpeg
  await renderCommercialMp4WithFFmpeg({
    jobDir,
    project,
    assetDiskPaths,
    editedAudioPath: hasEditedAudio
      ? editedWavPath
      : fsSync.existsSync(rawWavPath)
      ? rawWavPath
      : null,
    outMp4Path: finalMp4Path,
  });

  onProgress?.(3, 100);

  const jobRecord: JobRecord = {
    jobId,
    jobDir,
    uploadsDir,
    rawWavPath: fsSync.existsSync(rawWavPath) ? rawWavPath : null,
    editedWavPath: hasEditedAudio ? editedWavPath : null,
    editedMp3Path: hasEditedAudio ? editedMp3Path : null,
    finalMp4Path,
    assetDiskPaths,
    project,
  };
  activeJobs.set(jobId, jobRecord);

  return {
    jobId,
    project,
    telemetry: {
      audioFileDetected:
        detectedVoiceoverRelName ||
        assets.find((a) => a.type === 'audio')?.name ||
        'voiceover_audio',
      videoClipsDetected: visualAssets.length,
      totalSilenceRemovedSec,
      jCutOverlapMs: pacing.jCutOverlapMs,
      extractedTriggerWord: endCta.triggerWord,
    },
  };
}

// POST /api/jobs/init - Initializes a chunked upload session so arbitrarily large folders/zips never exceed proxy limits
app.post('/api/jobs/init', async (req, res) => {
  try {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const jobDir = path.join(JOBS_ROOT, jobId);
    const uploadsDir = path.join(jobDir, 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });

    const folderName = String(req.body?.folderName || 'Product_Ad_Folder');
    const pacing: PacingConfig = req.body?.pacing
      ? { ...DEFAULT_PACING_CONFIG, ...req.body.pacing }
      : DEFAULT_PACING_CONFIG;

    pendingJobSessions.set(jobId, {
      jobId,
      folderName,
      pacing,
      jobDir,
      uploadsDir,
      fileDiskPaths: new Map(),
      completedFiles: [],
    });

    jobProgressMap.set(jobId, {
      jobId,
      status: 'uploading',
      stepIndex: 0,
      progressPct: 5,
    });

    res.json({ jobId });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to initialize upload job' });
  }
});

// POST /api/jobs/:jobId/upload-chunk - Appends a 4MB file chunk to disk
app.post(
  '/api/jobs/:jobId/upload-chunk',
  chunkUploadMiddleware.single('chunk'),
  async (req, res) => {
    try {
      const { jobId } = req.params;
      const session = pendingJobSessions.get(jobId);
      if (!session) {
        res.status(404).json({ error: 'Upload session not found' });
        return;
      }

      const chunkFile = req.file;
      if (!chunkFile) {
        res.status(400).json({ error: 'Missing chunk payload' });
        return;
      }

      const fileIndex = Number(req.body.fileIndex || 0);
      const chunkIndex = Number(req.body.chunkIndex || 0);
      const totalChunks = Number(req.body.totalChunks || 1);
      const fileName = String(req.body.fileName || `file_${fileIndex}`);
      const relativePath = String(req.body.relativePath || fileName);
      const mimeType = String(req.body.mimeType || '');

      let diskPath = session.fileDiskPaths.get(fileIndex);
      if (!diskPath) {
        const safeBase = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const uniqueName = `${Date.now()}_${fileIndex}_${safeBase}`;
        diskPath = path.join(session.uploadsDir, uniqueName);
        session.fileDiskPaths.set(fileIndex, diskPath);
      }

      if (chunkIndex === 0) {
        await fs.writeFile(diskPath, chunkFile.buffer);
      } else {
        await fs.appendFile(diskPath, chunkFile.buffer);
      }

      if (chunkIndex >= totalChunks - 1) {
        const stat = await fs.stat(diskPath).catch(() => null);
        session.completedFiles.push({
          diskPath,
          relName: relativePath,
          mimeType,
          sizeBytes: stat?.size ?? 0,
        });
      }

      res.json({ ok: true, fileIndex, chunkIndex });
    } catch (err: any) {
      console.error('Chunk upload error:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Chunk upload failed' });
    }
  }
);

// POST /api/jobs/:jobId/start - Starts async FFmpeg + Gemini pipeline on uploaded chunks
app.post('/api/jobs/:jobId/start', async (req, res) => {
  try {
    const { jobId } = req.params;
    const session = pendingJobSessions.get(jobId);
    if (!session) {
      res.status(404).json({ error: 'Job session not found' });
      return;
    }

    jobProgressMap.set(jobId, {
      jobId,
      status: 'processing',
      stepIndex: 0,
      progressPct: 12,
    });

    // Respond immediately so the reverse proxy never times out
    res.json({ jobId, status: 'processing' });

    // Run pipeline in background
    (async () => {
      try {
        let folderName = session.folderName;
        const { allFiles, inferredFolderName } = await unpackUploadedEntries(
          session.uploadsDir,
          session.completedFiles
        );

        if (
          inferredFolderName &&
          (folderName === 'Product_Ad_Folder' ||
            folderName === 'Product_Commercial_Folder')
        ) {
          folderName = inferredFolderName;
        }

        if (allFiles.length === 0) {
          throw new Error(
            'No files found inside the dropped folder or archive.'
          );
        }

        const result = await executeJobPipelineOnBackend({
          jobId,
          folderName,
          uploadedFiles: allFiles,
          pacing: session.pacing,
          onProgress: (stepIndex, progressPct) => {
            jobProgressMap.set(jobId, {
              jobId,
              status: 'processing',
              stepIndex,
              progressPct,
            });
          },
        });

        jobProgressMap.set(jobId, {
          jobId,
          status: 'completed',
          stepIndex: 3,
          progressPct: 100,
          result,
        });
        pendingJobSessions.delete(jobId);
      } catch (err: any) {
        console.error('Async job pipeline error:', err?.message || err);
        jobProgressMap.set(jobId, {
          jobId,
          status: 'error',
          stepIndex: 0,
          progressPct: 0,
          error:
            err?.message ||
            'Failed to process uploaded folder on backend. Please ensure the folder contains video clips and an audio file.',
        });
        pendingJobSessions.delete(jobId);
      }
    })();
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to start job' });
  }
});

// GET /api/jobs/:jobId/status - Polls live backend FFmpeg + AI pipeline status
app.get('/api/jobs/:jobId/status', (req, res) => {
  const { jobId } = req.params;
  const progress = jobProgressMap.get(jobId);
  if (!progress) {
    res.status(404).json({ error: 'Job status not found' });
    return;
  }
  res.json(progress);
});

// POST /api/jobs/upload-folder - Main Multipart Folder & Archive Upload & Real Backend FFmpeg Pipeline
app.post(
  '/api/jobs/upload-folder',
  (req, res, next) => {
    uploadMiddleware.array('files', 300)(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            error:
              'Too many files in folder (maximum 300 files allowed). Try zipping the folder into a .zip file.',
          });
        }
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File size exceeds 1GB limit.',
          });
        }
        return res
          .status(400)
          .json({ error: `Upload error: ${err.message || 'Invalid upload'}` });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const jobId: string =
        (req as any).jobId ||
        `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const files = (req.files as Express.Multer.File[]) || [];

      if (files.length === 0) {
        res
          .status(400)
          .json({ error: 'No files were found in the dropped folder or archive.' });
        return;
      }

      const jobDir = path.join(JOBS_ROOT, jobId);
      const uploadsDir = path.join(jobDir, 'uploads');
      await fs.mkdir(uploadsDir, { recursive: true });

      let folderName = String(req.body.folderName || 'Product_Ad_Folder');
      let relativePaths: string[] = [];
      try {
        relativePaths = JSON.parse(req.body.relativePaths || '[]');
      } catch {
        relativePaths = [];
      }

      let pacing: PacingConfig = DEFAULT_PACING_CONFIG;
      try {
        if (req.body.pacing) {
          pacing = { ...DEFAULT_PACING_CONFIG, ...JSON.parse(req.body.pacing) };
        }
      } catch {
        // use default pacing
      }

      // Automatically unpack any .zip, .tar, .tar.gz archives uploaded by the user
      const { allFiles, inferredFolderName } = await unpackAnyArchives(
        uploadsDir,
        files,
        relativePaths
      );

      if (inferredFolderName && (folderName === 'Product_Ad_Folder' || folderName === 'Product_Commercial_Folder')) {
        folderName = inferredFolderName;
      }

      if (allFiles.length === 0) {
        res.status(400).json({
          error:
            'No files found inside the dropped folder or archive.',
        });
        return;
      }

      const result = await executeJobPipelineOnBackend({
        jobId,
        folderName,
        uploadedFiles: allFiles,
        pacing,
      });

      res.json(result);
    } catch (err: any) {
      console.error('Upload folder pipeline error:', err?.message || err);
      res.status(500).json({
        error:
          err?.message ||
          'Failed to process uploaded folder on backend. Please ensure the folder contains video clips and an audio file.',
      });
    }
  }
);

// POST /api/jobs/sample-demo - Generates real MP4 video clips + real WAV voiceover on disk and runs the exact FFmpeg pipeline
app.post('/api/jobs/sample-demo', async (req, res) => {
  try {
    const jobId = `sample_${Date.now()}`;
    const jobDir = path.join(JOBS_ROOT, jobId);
    const uploadsDir = path.join(jobDir, 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });

    let pacing: PacingConfig = DEFAULT_PACING_CONFIG;
    if (req.body?.pacing) {
      pacing = { ...DEFAULT_PACING_CONFIG, ...req.body.pacing };
    }

    const { files } = await generateSampleFolderFilesOnDisk(uploadsDir, null);

    const result = await executeJobPipelineOnBackend({
      jobId,
      folderName: 'AeroPulse_Pro_Ad_Folder',
      uploadedFiles: files,
      pacing,
    });

    res.json(result);
  } catch (err: any) {
    console.error('Sample demo pipeline error:', err?.message || err);
    res.status(500).json({
      error: err?.message || 'Failed to build sample folder on backend',
    });
  }
});

// POST /api/jobs/:jobId/render - Re-renders the 1080p 60fps MP4 with manual Studio layer edits
app.post('/api/jobs/:jobId/render', async (req, res) => {
  try {
    const { jobId } = req.params;
    const record = activeJobs.get(jobId);
    if (!record) {
      res.status(404).json({ error: 'Job session not found on server' });
      return;
    }

    const updatedProject: AdProjectState = req.body.project || record.project;

    // If J-cut overlap or voiceover segments changed and rawWavPath exists, rebuild edited_vo.wav
    if (record.rawWavPath && record.editedWavPath && record.editedMp3Path) {
      try {
        await buildEditedVoiceoverAudioWithFFmpeg(
          record.rawWavPath,
          updatedProject.voiceoverSegments,
          record.editedWavPath,
          record.editedMp3Path
        );
      } catch (e: any) {
        console.warn('Re-render audio update notice:', e?.message);
      }
    }

    await renderCommercialMp4WithFFmpeg({
      jobDir: record.jobDir,
      project: updatedProject,
      assetDiskPaths: record.assetDiskPaths,
      editedAudioPath: record.editedWavPath || record.rawWavPath,
      outMp4Path: record.finalMp4Path,
    });

    const versionTag = Date.now();
    updatedProject.renderedVideoUrl = `/api/jobs/${jobId}/final.mp4?v=${versionTag}`;
    if (record.editedMp3Path) {
      updatedProject.editedAudioUrl = `/api/jobs/${jobId}/edited_vo.mp3?v=${versionTag}`;
    }
    record.project = updatedProject;

    res.json({
      project: updatedProject,
      renderedVideoUrl: updatedProject.renderedVideoUrl,
      downloadUrl: `/api/jobs/${jobId}/download?v=${versionTag}`,
    });
  } catch (err: any) {
    console.error('Re-render error:', err?.message || err);
    res.status(500).json({
      error: err?.message || 'Failed to re-render edited video on backend',
    });
  }
});

// GET /api/jobs/:jobId/video-info - Returns exact byte size of the rendered final.mp4 for chunked blob loading
app.get('/api/jobs/:jobId/video-info', async (req, res) => {
  const filePath = path.join(JOBS_ROOT, req.params.jobId, 'final.mp4');
  if (!fsSync.existsSync(filePath)) {
    res.status(404).json({ error: 'Rendered video not found' });
    return;
  }
  const stat = await fs.stat(filePath);
  res.json({
    exists: true,
    sizeBytes: stat.size,
    mimeType: 'video/mp4',
  });
});

// GET /api/jobs/:jobId/video-chunk - Streams a <= 4MB binary slice of final.mp4 so large videos never hit proxy 32MB response limits
app.get('/api/jobs/:jobId/video-chunk', async (req, res) => {
  const filePath = path.join(JOBS_ROOT, req.params.jobId, 'final.mp4');
  if (!fsSync.existsSync(filePath)) {
    res.status(404).send('Rendered video not found');
    return;
  }
  const stat = await fs.stat(filePath);
  const totalSize = stat.size;
  const start = Math.max(0, Number(req.query.start || 0));
  const maxChunk = 4 * 1024 * 1024; // 4 MB max per chunk
  const requestedEnd = req.query.end
    ? Number(req.query.end)
    : start + maxChunk - 1;
  const end = Math.min(totalSize - 1, Math.min(requestedEnd, start + maxChunk - 1));

  if (start >= totalSize || end < start) {
    res.status(416).send('Requested range not satisfiable');
    return;
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(end - start + 1));
  res.setHeader('Cache-Control', 'no-store');

  const stream = fsSync.createReadStream(filePath, { start, end });
  stream.pipe(res);
});

// GET /api/jobs/:jobId/final.mp4 - Streams the rendered 1080x1920 @ 60fps MP4 with HTTP Range support
app.get('/api/jobs/:jobId/final.mp4', async (req, res) => {
  const filePath = path.join(JOBS_ROOT, req.params.jobId, 'final.mp4');
  if (!fsSync.existsSync(filePath)) {
    res.status(404).send('Rendered video not found');
    return;
  }
  const stat = await fs.stat(filePath);
  const totalSize = stat.size;
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-store');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10) || 0;
    const maxRangeChunk = 8 * 1024 * 1024; // 8 MB max per range response
    const reqEnd = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
    const end = Math.min(totalSize - 1, Math.min(reqEnd, start + maxRangeChunk - 1));

    if (start >= totalSize || end < start) {
      res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
      return;
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Content-Length', String(end - start + 1));
    fsSync.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', String(totalSize));
  fsSync.createReadStream(filePath).pipe(res);
});

// GET /api/jobs/:jobId/download - Downloads the rendered 1080x1920 @ 60fps MP4 file to the user's PC
app.get('/api/jobs/:jobId/download', (req, res) => {
  const { jobId } = req.params;
  const record = activeJobs.get(jobId);
  const filePath = path.join(JOBS_ROOT, jobId, 'final.mp4');
  if (!fsSync.existsSync(filePath)) {
    res.status(404).send('Rendered video not found');
    return;
  }
  const cleanName = (record?.project.folderName || 'Commercial_Ad')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_');
  res.download(filePath, `${cleanName}_1080p_60fps_9x16.mp4`);
});

// GET /api/jobs/:jobId/edited_vo.mp3 - Streams the silence-stripped J-cut voiceover audio
app.get('/api/jobs/:jobId/edited_vo.mp3', (req, res) => {
  const filePath = path.join(JOBS_ROOT, req.params.jobId, 'edited_vo.mp3');
  if (!fsSync.existsSync(filePath)) {
    res.status(404).send('Edited audio not found');
    return;
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(filePath);
});

// GET /api/jobs/:jobId/uploads/:fileName - Streams individual uploaded clips/images
app.get('/api/jobs/:jobId/uploads/:fileName', (req, res) => {
  const safeFile = path.basename(req.params.fileName);
  const filePath = path.join(JOBS_ROOT, req.params.jobId, 'uploads', safeFile);
  if (!fsSync.existsSync(filePath)) {
    res.status(404).send('Asset file not found');
    return;
  }
  res.sendFile(filePath);
});

// GET /api/jobs/:jobId/thumbs/:fileName - Streams extracted video keyframe thumbnails
app.get('/api/jobs/:jobId/thumbs/:fileName', (req, res) => {
  const safeFile = path.basename(req.params.fileName);
  const filePath = path.join(JOBS_ROOT, req.params.jobId, 'thumbs', safeFile);
  if (!fsSync.existsSync(filePath)) {
    res.status(404).send('Thumbnail not found');
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.sendFile(filePath);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CutShut Studio server listening on http://localhost:${PORT}`);
  });
}

startServer();
