import asyncio
import json
import os
from typing import Optional, Dict, List
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
import logging
import threading
import time
import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TranscriptionService:
    def __init__(self):
        self.models: Dict[str, Optional[WhisperModel]] = {
            "tiny": None,
            "base": None,
            "small": None,
            "medium": None,
            "large": None
        }
        self.current_model = "small"
        self.download_progress = None
        self.is_downloading = False
        
        # Set environment variables to control model caching
        # This ensures models are stored in this project's folder
        self.project_cache_dir = os.path.abspath("../models")
        os.environ['HF_HOME'] = self.project_cache_dir
        os.environ['TRANSFORMERS_CACHE'] = self.project_cache_dir
        os.environ['HF_DATASETS_CACHE'] = self.project_cache_dir
        logger.info(f"Model cache directory set to: {self.project_cache_dir}")
        
        self.load_model("small")
    
    def model_exists_locally(self, model_size: str):
        """Check if model files exist in this project's cache directory"""
        # Check in this project's models folder (faster-whisper cache structure)
        model_path = os.path.join(self.project_cache_dir, f"models--KBLab--kb-whisper-{model_size}")
        
        if os.path.exists(model_path):
            # Check if the model has actual model files
            blobs_path = os.path.join(model_path, "blobs")
            if os.path.exists(blobs_path) and os.listdir(blobs_path):
                logger.info(f"Model {model_size} found in project cache: {model_path}")
                return True
        
        logger.info(f"Model {model_size} not found in project cache: {model_path}")
        return False
    
    def update_download_progress(self, model_size: str):
        """Simple status updates while downloading"""
        size_estimates = {
            "tiny": "80 MB",
            "base": "150 MB",
            "small": "500 MB",
            "medium": "1.5 GB",
            "large": "3 GB"
        }
        
        model_size_str = size_estimates.get(model_size, "Unknown")
        
        # Simple status - no fake percentages
        self.download_progress = {
            "status": f"Laddar ner {model_size} modell ({model_size_str})...",
            "is_downloading": True,
            "model": model_size
        }
        
        # Keep status updated while downloading
        while self.is_downloading:
            time.sleep(1)  # Just keep the status alive
        
        # Download complete
        self.download_progress = {
            "status": f"{model_size} modell nedladdad och klar!",
            "is_downloading": False,
            "model": model_size
        }
        time.sleep(2)  # Show completion briefly
        self.download_progress = None
    
    def load_model(self, model_size: str):
        if model_size not in self.models:
            raise ValueError(f"Invalid model size: {model_size}")
        
        if self.models[model_size] is not None:
            self.current_model = model_size
            logger.info(f"Model {model_size} already loaded in memory")
            return
        
        try:
            model_id = f"KBLab/kb-whisper-{model_size}"
            
            # Check if downloading is needed
            needs_download = not self.model_exists_locally(model_size)
            
            if needs_download:
                logger.info(f"Model {model_size} not found locally, downloading...")
                self.is_downloading = True
                
                # Start progress updates in a separate thread
                progress_thread = threading.Thread(
                    target=self.update_download_progress, 
                    args=(model_size,)
                )
                progress_thread.daemon = True
                progress_thread.start()
            
            logger.info(f"Loading model: {model_id}")
            logger.info(f"Using cache directory: {self.project_cache_dir}")
            
            # Load model (will download if needed to our project cache)
            self.models[model_size] = WhisperModel(
                model_id,
                device="cpu",
                compute_type="int8",
                download_root=self.project_cache_dir,
                local_files_only=False
            )
            
            # Log where the model was actually loaded from
            logger.info(f"Model {model_size} loaded successfully")
            
            # Mark download as complete
            self.is_downloading = False
            
            # Give progress thread time to show 100%
            if needs_download:
                time.sleep(2)
            
            self.current_model = model_size
            self.download_progress = None
            logger.info(f"Model {model_size} loaded successfully")
            
        except Exception as e:
            self.is_downloading = False
            self.download_progress = None
            logger.error(f"Failed to load model {model_size}: {e}")
            raise
    
    def transcribe_audio(self, audio_data: np.ndarray, vad_sensitivity: int = 3):
        if self.models[self.current_model] is None:
            raise RuntimeError(f"Model {self.current_model} not loaded")
        
        beam_size = 6 - vad_sensitivity
        
        segments, info = self.models[self.current_model].transcribe(
            audio_data,
            language="sv",
            beam_size=max(1, beam_size),
            vad_filter=True
        )
        
        transcriptions = []
        for segment in segments:
            transcriptions.append({
                "text": segment.text.strip(),
                "start": segment.start,
                "end": segment.end
            })
        
        return transcriptions

transcription_service = TranscriptionService()

# Ollama configuration
OLLAMA_BASE_URL = "http://localhost:11434"

@app.get("/")
async def root():
    return {"status": "Live Subtitler Backend Running"}

@app.get("/check-model")
async def check_model(model: str = Query(default="small")):
    """Check if a model exists locally"""
    exists = transcription_service.model_exists_locally(model)
    # Get approximate size
    sizes = {
        "tiny": "80 MB",
        "base": "150 MB",
        "small": "500 MB", 
        "medium": "1.5 GB",
        "large": "3 GB"
    }
    return {"exists": exists, "model": model, "size": sizes.get(model, "Unknown")}

@app.get("/download-progress")
async def download_progress():
    """Get current download progress"""
    return transcription_service.download_progress or {}

@app.get("/model-status")
async def model_status(model: str = Query(default="small")):
    """Check if a specific model is loaded and ready"""
    is_loaded = transcription_service.models.get(model) is not None
    is_downloading = transcription_service.is_downloading and transcription_service.current_model == model
    
    return {
        "model": model,
        "is_loaded": is_loaded,
        "is_downloading": is_downloading,
        "is_current": transcription_service.current_model == model
    }

@app.get("/ollama-models")
async def get_ollama_models():
    """Get list of available Ollama models"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if response.status_code == 200:
                data = response.json()
                models = [model["name"] for model in data.get("models", [])]
                return {"status": "success", "models": models}
            else:
                return {"status": "error", "message": "Ollama not available", "models": []}
    except Exception as e:
        logger.error(f"Failed to get Ollama models: {e}")
        return {"status": "error", "message": "Ollama not running", "models": []}

@app.post("/translate")
async def translate_text(
    text: str = Query(...),
    target_language: str = Query(...),
    model: str = Query(default="llama3.2:3b")
):
    """Translate text using Ollama"""
    try:
        language_names = {
            "english": "English",
            "german": "German",
            "italian": "Italian",
            "greek": "Greek",
            "french": "French",
            "ukrainian": "Ukrainian",
            "chinese": "Chinese (Mandarin)",
            "japanese": "Japanese",
            "arabic": "Arabic"
        }
        
        target_lang = language_names.get(target_language, target_language)
        
        prompt = f"""You are a part of a software program that does live subtitling. When you are fed text, you will only output the translation of the text. No explanations, no additional text, just the translation.

Translate from Swedish to {target_lang}.

Text: {text}

Translation:"""
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "temperature": 0.3,  # Lower temperature for more consistent translations
                    "top_p": 0.9
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                translation = data.get("response", "").strip()
                return {"status": "success", "translation": translation}
            else:
                return {"status": "error", "message": "Translation failed"}
                
    except httpx.TimeoutException:
        return {"status": "error", "message": "Translation timeout"}
    except Exception as e:
        logger.error(f"Translation error: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/load-model")
async def load_model(model: str = Query(default="small")):
    try:
        logger.info(f"Request to load model: {model}")
        
        # Check if model needs downloading
        needs_download = not transcription_service.model_exists_locally(model)
        
        # Run model loading in a thread to avoid blocking
        def load_in_thread():
            transcription_service.load_model(model)
        
        thread = threading.Thread(target=load_in_thread)
        thread.daemon = True
        thread.start()
        
        if needs_download:
            # For downloads, return immediately and let client poll for progress
            logger.info(f"Model {model} will be downloaded in background")
            return {"status": "downloading", "model": model}
        else:
            # For cached models, wait for loading to complete
            thread.join(timeout=30)
            
            if thread.is_alive():
                return {"status": "loading", "message": "Model loading in progress"}
            
            logger.info(f"Model {model} loaded from cache")
            return {"status": "success", "model": model}
            
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        return {"status": "error", "message": str(e)}

@app.websocket("/ws/transcribe")
async def websocket_endpoint(
    websocket: WebSocket,
    model: str = Query(default="small"),
    vad: int = Query(default=3),
    instant: bool = Query(default=False)
):
    await websocket.accept()
    logger.info(f"WebSocket connection established with model={model}, vad={vad}, instant={instant}")
    
    try:
        # Wait for model to be ready if it's downloading
        max_wait = 300  # 5 minutes max
        wait_time = 0
        while transcription_service.is_downloading and wait_time < max_wait:
            await asyncio.sleep(1)
            wait_time += 1
            
        if model != transcription_service.current_model:
            await websocket.send_json({
                "type": "model_loading",
                "model": model
            })
            transcription_service.load_model(model)
            await websocket.send_json({
                "type": "model_loaded",
                "model": model
            })
        
        buffer_size = 30 - (vad * 2)
        audio_buffer = []
        instant_buffer = []  # For instant mode
        instant_buffer_size = 8  # Much smaller for instant transcription
        
        last_transcription_text = ""
        last_transcription_time = 0
        last_instant_text = ""
        last_instant_time = 0
        
        while True:
            data = await websocket.receive_bytes()
            
            audio_array = np.frombuffer(data, dtype=np.float32)
            audio_buffer.append(audio_array)
            
            # Handle instant mode transcription
            if instant:
                instant_buffer.append(audio_array)
                
                if len(instant_buffer) >= instant_buffer_size:
                    instant_audio = np.concatenate(instant_buffer)
                    instant_buffer = instant_buffer[-(instant_buffer_size//4):]  # Small overlap
                    
                    try:
                        instant_transcriptions = transcription_service.transcribe_audio(instant_audio, vad)
                        
                        if instant_transcriptions:
                            for transcription in instant_transcriptions:
                                current_time = time.time()
                                text = transcription["text"].strip()
                                
                                # More lenient duplicate filtering for instant mode
                                if text and (text != last_instant_text or 
                                           current_time - last_instant_time > 1.0):
                                    await websocket.send_json({
                                        "type": "transcription",
                                        "mode": "instant",
                                        "data": transcription
                                    })
                                    last_instant_text = text
                                    last_instant_time = current_time
                    except Exception as e:
                        logger.error(f"Instant transcription error: {e}")
            
            # Handle normal (final) transcription
            if len(audio_buffer) >= buffer_size:
                full_audio = np.concatenate(audio_buffer)
                audio_buffer = audio_buffer[-(buffer_size//4):]
                
                try:
                    transcriptions = transcription_service.transcribe_audio(full_audio, vad)
                    
                    if transcriptions:
                        for transcription in transcriptions:
                            # Filter out duplicates - ignore if same text within 2 seconds
                            current_time = time.time()
                            text = transcription["text"].strip()
                            
                            # Skip if it's the same text as last time (within 2 seconds)
                            if text and (text != last_transcription_text or 
                                       current_time - last_transcription_time > 2.0):
                                await websocket.send_json({
                                    "type": "transcription",
                                    "mode": "final",
                                    "data": transcription
                                })
                                last_transcription_text = text
                                last_transcription_time = current_time
                except Exception as e:
                    logger.error(f"Transcription error: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": str(e)
                    })
    
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)