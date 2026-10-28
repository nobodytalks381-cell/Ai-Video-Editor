import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  probeMediaFile,
  normalizeVoiceoverAudio,
  detectSpeechIntervalsWithFFmpeg,
  buildEditedVoiceoverAudioWithFFmpeg,
  renderCommercialMp4WithFFmpeg,
  generateSampleFolderFilesOnDisk,
} from './videoPipeline.ts';
import {
  buildJCutVoiceoverTimeline,
  assembleCommercialCut,
} from '../utils/editingEngine.ts';
import { DEFAULT_PACING_CONFIG } from '../utils/demoFolderKit.ts';
import type { AdProjectState, FolderAsset } from '../types/editor.ts';

test('FFmpeg backend pipeline probes, strips silences, splices J-cuts, and renders 1080x1920 @ 60fps MP4', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cutshut-test-'));
  const uploadsDir = path.join(tmpDir, 'uploads');

  try {
    const { files } = await generateSampleFolderFilesOnDisk(uploadsDir, null);
    assert.ok(files.length >= 5, 'Should create sample video clips and audio file');

    const audioFile = files.find((f) => f.type === 'audio')!;
    const rawWavPath = path.join(tmpDir, 'raw_vo.wav');
    const rawMp3Path = path.join(tmpDir, 'raw_vo.mp3');
    const editedWavPath = path.join(tmpDir, 'edited_vo.wav');
    const editedMp3Path = path.join(tmpDir, 'edited_vo.mp3');
    const finalMp4Path = path.join(tmpDir, 'final.mp4');

    const norm = await normalizeVoiceoverAudio(
      audioFile.diskPath,
      rawWavPath,
      rawMp3Path
    );
    assert.ok(norm.duration > 5, 'Raw voiceover should have valid duration');
    assert.equal(norm.waveformPeaks.length, 36);

    const speechWindows = await detectSpeechIntervalsWithFFmpeg(
      rawWavPath,
      norm.duration,
      DEFAULT_PACING_CONFIG
    );
    assert.ok(
      speechWindows.length >= 3,
      `Expected >= 3 speech windows from silencedetect, got ${speechWindows.length}`
    );

    const phrases = speechWindows.map((w, idx) => ({
      id: `vo-${idx + 1}`,
      text:
        idx === speechWindows.length - 1
          ? "Comment 'PULSE' right now and we will send you the 50% link in DM!"
          : `Product feature highlight ${idx + 1}`,
      rawStart: w.rawStart,
      rawEnd: w.rawEnd,
      semanticTopic: `feature ${idx + 1}`,
    }));

    const { segments, totalAudioDuration, totalSilenceRemovedSec } =
      buildJCutVoiceoverTimeline(phrases, DEFAULT_PACING_CONFIG);
    assert.ok(totalSilenceRemovedSec > 0.5, 'Should strip silent pauses');

    await buildEditedVoiceoverAudioWithFFmpeg(
      rawWavPath,
      segments,
      editedWavPath,
      editedMp3Path
    );
    const editedInfo = await probeMediaFile(editedWavPath);
    assert.ok(editedInfo.hasAudio, 'Edited WAV must have an audio stream');
    assert.ok(
      editedInfo.duration < norm.duration,
      `Edited audio (${editedInfo.duration}s) must be shorter than raw audio (${norm.duration}s) after silence stripping`
    );

    const assets: FolderAsset[] = [];
    const assetDiskPaths = new Map<string, string>();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.type === 'video') {
        const info = await probeMediaFile(f.diskPath);
        const id = `vid-${i}`;
        assetDiskPaths.set(id, f.diskPath);
        assets.push({
          id,
          name: f.relName,
          type: 'video',
          url: f.diskPath,
          duration: info.duration,
          width: info.width,
          height: info.height,
          sizeBytes: 1000,
          productScore: 95 - i,
          humanPresenceScore: 5,
          visualTags: ['product', 'feature'],
        });
      }
    }

    const { clips, sparseTexts, endCta } = assembleCommercialCut(
      assets,
      segments,
      DEFAULT_PACING_CONFIG
    );
    assert.equal(endCta.triggerWord, 'PULSE');

    const project: AdProjectState = {
      folderName: 'Test_Folder',
      productName: 'AeroPulse Pro',
      productBriefSummary: 'Test brief',
      resolution: '1080x1920',
      fps: 60,
      aspectRatio: '9:16',
      assets,
      voiceoverSegments: segments,
      clips,
      sparseTexts,
      endCta,
      pacing: DEFAULT_PACING_CONFIG,
      totalDuration: totalAudioDuration,
    };

    await renderCommercialMp4WithFFmpeg({
      jobDir: tmpDir,
      project,
      assetDiskPaths,
      editedAudioPath: editedWavPath,
      outMp4Path: finalMp4Path,
    });

    const finalInfo = await probeMediaFile(finalMp4Path);
    assert.equal(finalInfo.hasVideo, true, 'Final MP4 must contain a video stream');
    assert.equal(finalInfo.hasAudio, true, 'Final MP4 must contain an audio stream');
    assert.equal(finalInfo.width, 1080, 'Final MP4 width must be 1080');
    assert.equal(finalInfo.height, 1920, 'Final MP4 height must be 1920');
    assert.ok(finalInfo.duration > 3.0, 'Final MP4 duration must be > 3.0s');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
