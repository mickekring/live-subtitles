# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Live Subtitler - A real-time Swedish speech-to-text application using KB Whisper models from Hugging Face. The app provides live transcription of audio with a clean, full-screen subtitle display.

## Architecture

### Backend (Python/FastAPI)
- **main.py**: FastAPI server with WebSocket endpoint for real-time audio streaming
- **TranscriptionService**: Manages KB Whisper models (tiny, base, small, medium, large)
- **Model Loading**: Downloads models from Hugging Face on first use, caches locally in ../models/
- **Audio Processing**: Receives Float32 audio chunks via WebSocket, buffers and transcribes using faster-whisper
- **Duplicate Detection**: Filters repeated transcriptions within 2-second window to prevent hallucinations

### Frontend (Next.js 15 with TypeScript)
- **app/page.tsx**: Main React component handling audio capture and subtitle display
- **Web Audio API**: Captures microphone at 16kHz, processes through ScriptProcessorNode
- **WebSocket Client**: Streams audio chunks to backend, receives transcriptions
- **Model Status Polling**: Checks /model-status endpoint every 2 seconds for readiness
- **UI Features**: Left-aligned subtitles, model status indicator, settings modal

## Key Commands

### Development
```bash
# Start both frontend and backend
./start.sh

# Or start individually:
# Backend
cd backend
source venv/bin/activate
python main.py

# Frontend
cd frontend
npm run dev
```

### Backend Commands
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py  # Runs on http://localhost:8000
```

### Frontend Commands
```bash
cd frontend
npm install
npm run dev     # Development server on http://localhost:3000
npm run build   # Production build
npm run lint    # Run ESLint
```

## API Endpoints

- `GET /` - Health check
- `GET /check-model?model={name}` - Check if model exists locally
- `GET /model-status?model={name}` - Get model loading status
- `POST /load-model?model={name}` - Load/download a model
- `GET /download-progress` - Get current download progress
- `WS /ws/transcribe?model={name}&vad={1-5}` - WebSocket for audio streaming

## Model Management

Models are stored in `../models/` relative to backend. The system:
1. Checks if model exists locally before downloading
2. Downloads from Hugging Face (KBLab/kb-whisper-{size})
3. Loads into memory for fast inference
4. Keeps loaded models in memory for quick switching

## Audio Processing Flow

1. Frontend captures audio at 16kHz mono
2. Sends Float32 audio chunks via WebSocket
3. Backend buffers audio (size based on VAD sensitivity)
4. Processes with faster-whisper when buffer is full
5. Filters duplicate transcriptions
6. Sends transcriptions back via WebSocket
7. Frontend displays with fade animation

## Important Implementation Details

- **Buffer Overlap**: Backend keeps 1/4 of previous buffer to avoid cutting words
- **Duplicate Filtering**: Same text within 2 seconds is filtered to prevent repetition
- **Model Ready State**: Frontend polls /model-status to ensure model is loaded before enabling recording
- **Subtitle Lifecycle**: Subtitles auto-fade after 15 seconds
- **VAD Sensitivity**: Controls buffer size (1=less sensitive, 5=more sensitive)