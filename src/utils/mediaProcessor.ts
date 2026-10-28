import type { PacingConfig } from '../types/editor.ts';

/**
 * Ensures a hidden offscreen DOM container exists so HTMLVideoElements stay mounted
 * in the document and Chrome's hardware decoder never suspends frame decoding.
 */
function getHiddenMediaContainer(): HTMLElement {
  let container = document.getElementById('cutshut-hidden-media-pool');
  if (!container) {
    container = document.createElement('div');
    container.id = 'cutshut-hidden-media-pool';
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.width = '1px';
    container.style.height = '1px';
    container.style.opacity = '0.01';
    container.style.pointerEvents = 'none';
    container.style.overflow = 'hidden';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Recursively traverses dropped FileSystemEntry items (when a user drags and drops a folder from their PC)
 * so that all nested subfolders (e.g., clips/, audio/, images/) and their File objects are extracted.
 * Captures synchronous `dataTransfer.files` BEFORE any `await` so browser DataTransfer clearing never loses files.
 */
export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<File[]> {
  // MUST capture synchronous FileList and FileSystemEntry list BEFORE first await!
  const syncFallbackFiles = Array.from(dataTransfer.files || []);
  const syncEntries: any[] = [];

  if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      const webkitEntry =
        typeof (item as any).webkitGetAsEntry === 'function'
          ? (item as any).webkitGetAsEntry()
          : null;
      if (webkitEntry) {
        syncEntries.push(webkitEntry);
      }
    }
  }

  const collected: File[] = [];

  async function readEntry(entry: any, pathPrefix = ''): Promise<void> {
    if (!entry) return;
    if (entry.isFile) {
      await new Promise<void>((resolve) => {
        entry.file(
          (file: File) => {
            try {
              Object.defineProperty(file, 'relativePath', {
                value: pathPrefix ? `${pathPrefix}/${file.name}` : file.name,
                configurable: true,
              });
            } catch {
              // ignore if read-only
            }
            collected.push(file);
            resolve();
          },
          () => resolve()
        );
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readAllEntries = async (): Promise<any[]> => {
        const batch: any[] = await new Promise((resolve) =>
          dirReader.readEntries(
            (entries: any[]) => resolve(entries || []),
            () => resolve([])
          )
        );
        if (batch.length > 0) {
          const rest = await readAllEntries();
          return batch.concat(rest);
        }
        return [];
      };
      const entries = await readAllEntries();
      const nextPrefix = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
      for (const child of entries) {
        await readEntry(child, nextPrefix);
      }
    }
  }

  if (syncEntries.length > 0) {
    for (const entry of syncEntries) {
      await readEntry(entry, '');
    }
    if (collected.length > 0) {
      return collected;
    }
  }

  return syncFallbackFiles;
}

/**
 * Loads an HTMLVideoElement from a URL (either local blob URL or backend server URL),
 * mounts it in the hidden DOM pool so frames are always decoded, and resolves once the first frame is ready.
 */
export async function probeAndLoadVideoElement(
  url: string
): Promise<{
  element: HTMLVideoElement;
  duration: number;
  width: number;
  height: number;
}> {
  return new Promise((resolve) => {
    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.preload = 'auto';
    vid.muted = true;
    vid.playsInline = true;
    vid.src = url;

    if (typeof document !== 'undefined') {
      getHiddenMediaContainer().appendChild(vid);
    }

    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve({
        element: vid,
        duration:
          Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 5.0,
        width: vid.videoWidth || 1080,
        height: vid.videoHeight || 1920,
      });
    };

    const timeout = setTimeout(finish, 2500);

    vid.onloadeddata = () => {
      try {
        vid.currentTime = 0.05;
      } catch {
        clearTimeout(timeout);
        finish();
      }
    };

    vid.onseeked = () => {
      clearTimeout(timeout);
      finish();
    };

    vid.onerror = () => {
      clearTimeout(timeout);
      finish();
    };

    vid.load();
  });
}

/**
 * Probes an image URL to load a decoded HTMLImageElement.
 */
export async function probeAndLoadImageElement(url: string): Promise<{
  element: HTMLImageElement;
  width: number;
  height: number;
}> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resolve({
        element: img,
        width: img.naturalWidth || 1080,
        height: img.naturalHeight || 1920,
      });
    };
    img.onerror = () => {
      resolve({ element: img, width: 1080, height: 1920 });
    };
    img.src = url;
  });
}

/**
 * Seeks a cached HTMLVideoElement to a target timestamp and awaits the `seeked` event
 * so frame-accurate scrubbing captures the exact video frame.
 */
export async function seekVideoToTime(
  video: HTMLVideoElement,
  timeSec: number
): Promise<void> {
  const safeDur =
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
  const target = Math.max(0, Math.min(safeDur - 0.05, timeSec % safeDur));

  if (Math.abs(video.currentTime - target) < 0.03 && video.readyState >= 1) {
    return;
  }

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      resolve();
    };
    const timer = setTimeout(finish, 300);
    video.addEventListener('seeked', finish);
    try {
      video.currentTime = target;
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}
