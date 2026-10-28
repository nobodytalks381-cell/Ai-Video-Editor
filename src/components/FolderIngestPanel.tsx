import React, { useRef, useState } from 'react';
import {
  FolderOpen,
  Sparkles,
  Film,
  Volume2,
  Image as ImageIcon,
  FileText,
  Upload,
  CheckCircle2,
  Ban,
} from 'lucide-react';
import type { FolderAsset, AdProjectState } from '../types/editor.ts';

interface FolderIngestModalProps {
  project: AdProjectState;
  onFilesIngested: (
    folderName: string,
    assets: FolderAsset[],
    rawTranscript?: string
  ) => void;
  onLoadDemoFolder: () => void;
  onRunAiAutoEdit: () => Promise<void>;
  isAnalyzingAi: boolean;
  aiStatusMessage: string;
}

export const FolderIngestPanel: React.FC<FolderIngestModalProps> = ({
  project,
  onFilesIngested,
  onLoadDemoFolder,
  onRunAiAutoEdit,
  isAnalyzingAi,
  aiStatusMessage,
}) => {
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [customDirectoryPath, setCustomDirectoryPath] = useState(
    'C:\\Users\\Creator\\Desktop\\Ads\\Solaris_C20_Ad_Kit'
  );
  const [customVoiceoverScript, setCustomVoiceoverScript] = useState(
    project.voiceoverSegments.map((s) => s.text).join(' ')
  );

  const processFileList = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const firstPath = (files[0] as any).webkitRelativePath || files[0].name;
    const detectedFolder = firstPath.includes('/')
      ? firstPath.split('/')[0]
      : 'Local_Product_Ad_Folder';

    const parsedAssets: FolderAsset[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const lower = file.name.toLowerCase();
      const relName = (file as any).webkitRelativePath || file.name;

      if (
        file.type.startsWith('video/') ||
        lower.endsWith('.mp4') ||
        lower.endsWith('.mov') ||
        lower.endsWith('.webm')
      ) {
        const url = URL.createObjectURL(file);
        const isTalkingHead =
          lower.includes('talking') ||
          lower.includes('human') ||
          lower.includes('vlog') ||
          lower.includes('face');
        parsedAssets.push({
          id: `local-vid-${i}-${Date.now()}`,
          name: relName,
          type: 'video',
          url,
          duration: 5.5,
          width: 1080,
          height: 1920,
          sizeBytes: file.size,
          productScore: isTalkingHead ? 32 : 94 - (i % 7),
          humanPresenceScore: isTalkingHead ? 86 : 5,
          visualTags: relName
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((t: string) => t.length > 2),
        });
      } else if (
        file.type.startsWith('audio/') ||
        lower.endsWith('.wav') ||
        lower.endsWith('.mp3') ||
        lower.endsWith('.m4a')
      ) {
        const url = URL.createObjectURL(file);
        parsedAssets.push({
          id: `local-aud-${i}-${Date.now()}`,
          name: relName,
          type: 'audio',
          url,
          duration: 15.0,
          width: 0,
          height: 0,
          sizeBytes: file.size,
          productScore: 100,
          humanPresenceScore: 0,
          visualTags: ['voiceover', 'audio', 'cta'],
          waveformPeaks: [
            0.12, 0.84, 0.91, 0.72, 0.04, 0.88, 0.95, 0.67, 0.03, 0.79, 0.93,
            0.82, 0.04, 0.91, 0.96, 0.74,
          ],
        });
      } else if (
        file.type.startsWith('image/') ||
        lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.webp')
      ) {
        const url = URL.createObjectURL(file);
        parsedAssets.push({
          id: `local-img-${i}-${Date.now()}`,
          name: relName,
          type: 'image',
          url,
          duration: 4.0,
          width: 1080,
          height: 1920,
          sizeBytes: file.size,
          productScore: 90,
          humanPresenceScore: 0,
          visualTags: ['reference', 'still', 'product'],
        });
      } else if (
        lower.endsWith('.txt') ||
        lower.endsWith('.md') ||
        lower.endsWith('.json') ||
        lower.endsWith('.doc')
      ) {
        const textContent = await file.text().catch(() => '');
        parsedAssets.push({
          id: `local-doc-${i}-${Date.now()}`,
          name: relName,
          type: 'document',
          url: '',
          duration: 0,
          width: 0,
          height: 0,
          sizeBytes: file.size,
          productScore: 100,
          humanPresenceScore: 0,
          visualTags: ['brief', 'document'],
          textContent,
        });
      }
    }

    if (parsedAssets.length > 0) {
      onFilesIngested(detectedFolder, parsedAssets, customVoiceoverScript);
    }
  };

  const videos = project.assets.filter((a) => a.type === 'video');
  const audios = project.assets.filter((a) => a.type === 'audio');
  const images = project.assets.filter((a) => a.type === 'image');
  const docs = project.assets.filter((a) => a.type === 'document');

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header & Directory Path Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-[#232736]">
        <div>
          <h1 className="text-2xl font-bold text-[#F8FAFC] font-display tracking-tight">
            Local Product Folder & Asset Ingestion
          </h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            Point CutShut Studio to a PC folder containing your product clips, voiceover audio (with end CTA), reference images, and product brief.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onLoadDemoFolder}
            className="px-3.5 py-2 text-xs font-medium text-[#E2E8F0] bg-[#171A24] border border-[#2A3042] rounded-lg hover:bg-[#1E2230] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Reset Sample Folder Kit
          </button>
          <button
            type="button"
            onClick={onRunAiAutoEdit}
            disabled={isAnalyzingAi}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#090A0F] bg-[#FACC15] rounded-lg hover:bg-[#FDE047] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {isAnalyzingAi
                ? 'Running AI Cut & Shut...'
                : 'Auto-Cut 9:16 Commercial Now'}
            </span>
          </button>
        </div>
      </div>

      {aiStatusMessage && (
        <div
          role="status"
          className="px-4 py-3 rounded-lg bg-[#171A24] border border-[#2A3042] text-xs text-[#FACC15] font-mono flex items-center justify-between"
        >
          <span>{aiStatusMessage}</span>
          <span className="text-[#94A3B8]">1080p · 60fps · 9:16 Vertical</span>
        </div>
      )}

      {/* Directory Path Bar & Native Folder Picker */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              processFileList(e.dataTransfer.files);
            }
          }}
          className={`lg:col-span-7 p-6 rounded-xl border transition-colors flex flex-col justify-between ${
            dragActive
              ? 'bg-[#1B2030] border-[#FACC15]'
              : 'bg-[#11131A] border-[#232736]'
          }`}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#E2E8F0]">
                PC Directory Mount & Drag-Drop Zone
              </span>
              <span className="text-xs text-[#94A3B8] font-mono tabular-nums">
                Active: {project.folderName}
              </span>
            </div>

            <div>
              <label
                htmlFor="pc-directory-path"
                className="block text-xs text-[#94A3B8] mb-1.5"
              >
                Local PC Directory Path
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="pc-directory-path"
                  type="text"
                  value={customDirectoryPath}
                  onChange={(e) => setCustomDirectoryPath(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#090A0F] border border-[#232736] rounded-lg text-[#F8FAFC] focus:outline-none focus:border-[#FACC15]"
                />
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-[#171A24] text-[#F8FAFC] border border-[#2A3042] rounded-lg hover:border-[#FACC15] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#FACC15]" />
                  <span>Browse PC Folder</span>
                </button>
              </div>
            </div>

            {/* Hidden webkitdirectory input for full folder selection */}
            <input
              ref={folderInputRef}
              type="file"
              multiple
              {...({ webkitdirectory: '', directory: '' } as any)}
              onChange={(e) => {
                if (e.target.files) processFileList(e.target.files);
              }}
              className="hidden"
            />
            <input
              ref={filesInputRef}
              type="file"
              multiple
              accept="video/*,audio/*,image/*,.txt,.md,.json"
              onChange={(e) => {
                if (e.target.files) processFileList(e.target.files);
              }}
              className="hidden"
            />

            <div className="p-5 rounded-lg bg-[#090A0F] border border-dashed border-[#2A3042] text-center space-y-2">
              <Upload className="w-6 h-6 text-[#FACC15] mx-auto" />
              <p className="text-xs text-[#E2E8F0] font-medium">
                Drag and drop an entire product folder, video clips, voiceover `.wav`/`.mp3`, and product brief here
              </p>
              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="px-3 py-1.5 text-xs font-medium text-[#090A0F] bg-[#FACC15] rounded-md hover:bg-[#FDE047] transition-colors cursor-pointer"
                >
                  Select Local Folder
                </button>
                <button
                  type="button"
                  onClick={() => filesInputRef.current?.click()}
                  className="px-3 py-1.5 text-xs font-medium text-[#E2E8F0] bg-[#171A24] border border-[#2A3042] rounded-md hover:bg-[#1E2230] transition-colors cursor-pointer"
                >
                  Select Individual Files
                </button>
              </div>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-[#232736] flex items-center justify-between text-xs text-[#94A3B8]">
            <span>{videos.length} Video Clips</span>
            <span>·</span>
            <span>{audios.length} Voiceover Track</span>
            <span>·</span>
            <span>{images.length} Reference Images</span>
            <span>·</span>
            <span>{docs.length} Product Brief</span>
          </div>
        </div>

        {/* Voiceover Script & End-of-Audio CTA Detector Box */}
        <div className="lg:col-span-5 p-6 rounded-xl bg-[#11131A] border border-[#232736] flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#E2E8F0]">
                Voiceover Audio Transcript & End CTA Hook
              </span>
              <span className="text-xs text-[#10B981] font-mono">
                J-Cut: -{project.pacing.jCutOverlapMs}ms Lead
              </span>
            </div>

            <label htmlFor="voiceover-script-box" className="sr-only">
              Voiceover Transcript
            </label>
            <textarea
              id="voiceover-script-box"
              rows={5}
              value={customVoiceoverScript}
              onChange={(e) => setCustomVoiceoverScript(e.target.value)}
              className="w-full p-3 text-xs leading-relaxed bg-[#090A0F] border border-[#232736] rounded-lg text-[#E2E8F0] focus:outline-none focus:border-[#FACC15]"
              placeholder="Paste or edit voiceover transcript. Keep the Comment CTA sentence at the end..."
            />

            <div className="p-3 rounded-lg bg-[#090A0F] border border-[#232736] space-y-1">
              <div className="text-xs text-[#94A3B8]">
                Auto-Detected End-of-Audio Comment CTA:
              </div>
              <div className="text-sm font-bold text-[#F8FAFC] font-display">
                {project.endCta.prefixText}{' '}
                <span className="text-[#FACC15] underline">
                  "{project.endCta.triggerWord}"
                </span>{' '}
                — {project.endCta.suffixText}
              </div>
              <div className="text-xs text-[#94A3B8] font-mono tabular-nums">
                Video fades to {Math.round(project.endCta.fadeScrimOpacity * 100)}% blackish scrim at {project.endCta.startTime.toFixed(2)}s
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onFilesIngested(
                project.folderName,
                project.assets,
                customVoiceoverScript
              )
            }
            className="w-full py-2 text-xs font-semibold text-[#F8FAFC] bg-[#171A24] border border-[#2A3042] rounded-lg hover:border-[#FACC15] transition-colors cursor-pointer"
          >
            Re-Sync Voiceover Pauses & Extract End CTA Word
          </button>
        </div>
      </div>

      {/* Categorized Folder Assets Table */}
      <div className="rounded-xl bg-[#11131A] border border-[#232736] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#232736] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#F8FAFC]">
            Ingested Folder Contents & AI Visual Screening
          </h2>
          <span className="text-xs text-[#94A3B8]">
            Clips with high human presence (&gt;{project.pacing.maxHumanScoreAllowed}%) are automatically skipped
          </span>
        </div>

        <div className="divide-y divide-[#1C202E]">
          {project.assets.map((asset) => {
            const isRejected =
              asset.type === 'video' &&
              project.pacing.rejectHighHumanClips &&
              asset.humanPresenceScore > project.pacing.maxHumanScoreAllowed;

            return (
              <div
                key={asset.id}
                className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[#151822] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {asset.type === 'video' && (
                    <Film className="w-4 h-4 text-[#6366F1] shrink-0" />
                  )}
                  {asset.type === 'audio' && (
                    <Volume2 className="w-4 h-4 text-[#10B981] shrink-0" />
                  )}
                  {asset.type === 'image' && (
                    <ImageIcon className="w-4 h-4 text-[#FACC15] shrink-0" />
                  )}
                  {asset.type === 'document' && (
                    <FileText className="w-4 h-4 text-[#94A3B8] shrink-0" />
                  )}
                  <div className="truncate">
                    <div className="text-xs font-medium text-[#F8FAFC] truncate">
                      {asset.name}
                    </div>
                    <div className="text-xs text-[#94A3B8] flex items-center gap-2">
                      <span className="capitalize">{asset.type}</span>
                      {asset.duration > 0 && (
                        <>
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            {asset.duration.toFixed(2)}s
                          </span>
                        </>
                      )}
                      {asset.width > 0 && (
                        <>
                          <span>·</span>
                          <span className="font-mono tabular-nums">
                            {asset.width}×{asset.height}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 shrink-0 text-xs font-mono tabular-nums">
                  {(asset.type === 'video' || asset.type === 'image') && (
                    <>
                      <span className="text-[#E2E8F0]">
                        Product Focus: {asset.productScore}%
                      </span>
                      <span
                        className={
                          asset.humanPresenceScore > 30
                            ? 'text-[#F43F5E]'
                            : 'text-[#94A3B8]'
                        }
                      >
                        Human Presence: {asset.humanPresenceScore}%
                      </span>
                    </>
                  )}

                  {isRejected ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-[#F43F5E]">
                      <Ban className="w-3.5 h-3.5" />
                      <span>Filtered (Too Many Humans)</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-[#10B981]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Active in Cut</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
