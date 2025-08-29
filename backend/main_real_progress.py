import os
from typing import Optional, Dict
import numpy as np
from faster_whisper import WhisperModel
import logging
from huggingface_hub import snapshot_download
from tqdm import tqdm

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class RealProgressTracker:
    def __init__(self):
        self.total_bytes = 0
        self.downloaded_bytes = 0
        self.download_progress = None
        
    def update_progress(self, block_num, block_size, total_size):
        """Callback for tracking download progress"""
        if total_size > 0:
            self.total_bytes = total_size
            self.downloaded_bytes = block_num * block_size
            percentage = min(int((self.downloaded_bytes / total_size) * 100), 100)
            
            self.download_progress = {
                "percentage": percentage,
                "status": f"Laddar ner... {percentage}%",
                "downloaded": self.format_bytes(self.downloaded_bytes),
                "total": self.format_bytes(total_size)
            }
    
    def format_bytes(self, bytes):
        for unit in ['B', 'KB', 'MB', 'GB']:
            if bytes < 1024.0:
                return f"{bytes:.1f} {unit}"
            bytes /= 1024.0
        return f"{bytes:.1f} TB"

class RealDownloadService:
    def __init__(self):
        self.progress_tracker = RealProgressTracker()
    
    def download_with_real_progress(self, model_id: str, local_dir: str):
        """Download model with real progress tracking"""
        
        class ProgressCallback:
            def __init__(self, tracker):
                self.tracker = tracker
                self.pbar = None
                
            def __call__(self, progress_info):
                if isinstance(progress_info, tqdm):
                    # Extract real progress from tqdm object
                    if progress_info.total:
                        percentage = int((progress_info.n / progress_info.total) * 100)
                        self.tracker.download_progress = {
                            "percentage": percentage,
                            "status": f"Laddar ner... {percentage}%",
                            "downloaded": self.tracker.format_bytes(progress_info.n),
                            "total": self.tracker.format_bytes(progress_info.total)
                        }
        
        # Download with progress callback
        try:
            snapshot_download(
                repo_id=model_id,
                local_dir=local_dir,
                local_dir_use_symlinks=False,
                resume_download=True,  # Resume if interrupted
                tqdm_class=lambda *args, **kwargs: ProgressCallback(self.progress_tracker)
            )
        except Exception as e:
            logger.error(f"Download failed: {e}")
            raise

# Example usage:
# service = RealDownloadService()
# service.download_with_real_progress("KBLab/kb-whisper-medium", "./models/medium")