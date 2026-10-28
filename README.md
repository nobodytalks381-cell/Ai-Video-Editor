# CutShut Studio

CutShut Studio is a full-stack e-commerce vertical video ad editor (1080×1920 @ 60fps, 9:16 MP4). Drop a product folder or `.zip` archive containing raw product video clips and a voiceover audio file to automatically assemble a commercial ad cut with tight J-cut speech pacing, dynamic beat captions, and an end-of-video Comment CTA overlay.

## Features

- **Automated Folder & Archive Ingestion**: Supports dropping a product folder or `.zip`/`.tar` archive containing video clips (`.mp4`, `.mov`, `.webm`) and voiceover audio (`.wav`, `.mp3`, `.m4a`).
- **FFmpeg Silence Removal & J-Cut Pacing**: Normalizes voiceover audio, strips dead air, and applies subtle speech overlaps (`-48ms` J-cuts) for high-retention pacing.
- **9:16 Full-Frame Video Assembly**: Matches product clips to spoken voiceover beats, skips static cover frames on longer clips, and renders crisp hard cuts at 1080×1920 60fps.
- **End Comment CTA Card**: Automatically extracts the trigger word from the end of the voiceover and renders a centered CTA box over a 78% dark fade in the final seconds.
- **Interactive 4-Layer Editing Studio**: Fine-tune video cuts, voiceover segments, beat captions, and CTA styling before re-exporting via FFmpeg.

## Prerequisites

- **Node.js** (v18+ recommended)
- **FFmpeg & FFprobe** installed and available in your system `PATH`

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Copy `.env.example` to `.env` and set your API key:
   ```bash
   cp .env.example .env
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.

## Scripts

- `npm run dev` — Starts the Express + Vite server on port 3000
- `npm run build` — Builds the frontend production bundle to `dist/`
- `npm run lint` — Runs TypeScript type checking (`tsc --noEmit`)
