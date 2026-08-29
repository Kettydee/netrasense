"""
NetraSense / Blind's Eye — Asynchronous Text-to-Speech Module
=============================================================
Provides a low-latency, asynchronous TTS engine with Priority Queue
support (CRITICAL alerts immediately interrupt and jump to the front).

Supports:
  1. Piper TTS (offline ONNX voice model)
  2. Windows SAPI via win32com (native Windows)
  3. espeak-ng (native Linux)
  4. pyttsx3 (cross-platform fallback)
"""

from __future__ import annotations

import queue
import sys
import threading
import time
from pathlib import Path
from typing import Optional

try:
    import sounddevice as sd
    _SD_AVAILABLE = True
except ImportError:
    _SD_AVAILABLE = False

try:
    from piper.voice import PiperVoice
    _PIPER_AVAILABLE = True
except ImportError:
    _PIPER_AVAILABLE = False


_STOP_SENTINEL = object()
_PRIORITY_CRITICAL = 0
_PRIORITY_NORMAL   = 1


class TTSEngine:
    """
    Asynchronous Text-to-Speech engine with priority handling.
    """

    def __init__(
        self,
        model_path: Optional[str | Path] = None,
        queue_max:  int   = 4,
        speech_rate_scale: float = 1.0,
        sample_rate: int  = 22050,
        enabled: bool = True,
    ) -> None:
        self._model_path       = Path(model_path) if model_path else None
        self._queue_max        = queue_max
        self._speech_rate_scale = speech_rate_scale
        self._sample_rate      = sample_rate
        self._running          = True
        self.enabled           = enabled

        self._queue: queue.PriorityQueue = queue.PriorityQueue()
        self._counter = 0
        self._counter_lock = threading.Lock()

        self._piper_voice: Optional[PiperVoice] = None
        self._fallback_backend_type = "none"
        self._backend = self._init_backend()

        self._worker = threading.Thread(
            target=self._worker_loop,
            name="tts-worker",
            daemon=True,
        )
        self._worker.start()
        print(f"[TTS] Engine started — backend: {self._backend}")

    def speak(self, message: str) -> None:
        """Enqueue message for asynchronous speech output."""
        if not self._running or not self.enabled or not message.strip():
            return

        is_critical = message.strip().upper().startswith("CRITICAL")

        if is_critical:
            self._flush_normal_queue()
            self._enqueue(message, _PRIORITY_CRITICAL)
            print(f"[TTS][CRITICAL] {message}")
        else:
            current_size = self._queue.qsize()
            if current_size >= self._queue_max:
                return
            self._enqueue(message, _PRIORITY_NORMAL)

    def shutdown(self) -> None:
        """Gracefully stop the worker thread."""
        self._running = False
        self._queue.put((_PRIORITY_CRITICAL, -1, _STOP_SENTINEL))
        self._worker.join(timeout=2.0)
        print("[TTS] Engine shut down.")

    def _init_backend(self) -> str:
        # 1. Piper TTS
        if _PIPER_AVAILABLE and self._model_path and self._model_path.exists():
            try:
                self._piper_voice = PiperVoice.load(
                    str(self._model_path),
                    config_path=str(self._model_path.with_suffix(".onnx.json")),
                    use_cuda=False,
                )
                return "piper"
            except Exception as exc:
                print(f"[TTS] Piper load failed ({exc}). Trying native fallback.")

        # 2. Windows SAPI
        if sys.platform == "win32":
            try:
                import pythoncom
                import win32com.client
                self._fallback_backend_type = "win32com"
                return "win32com"
            except ImportError:
                pass

        # 3. espeak-ng (Linux/macOS)
        import shutil
        if shutil.which("espeak-ng") or shutil.which("espeak"):
            self._fallback_backend_type = "espeak"
            return "espeak"

        # 4. pyttsx3 fallback
        try:
            import pyttsx3
            self._fallback_backend_type = "pyttsx3"
            return "pyttsx3"
        except ImportError:
            pass

        self._fallback_backend_type = "none"
        return "none"

    def _worker_loop(self) -> None:
        native_speaker = None
        if self._backend == "win32com":
            try:
                import pythoncom
                import win32com.client
                pythoncom.CoInitialize()
                native_speaker = win32com.client.Dispatch("SAPI.SpVoice")
                native_speaker.Rate = 1
            except Exception as exc:
                print(f"[TTS] win32com init error in worker: {exc}")

        pyttsx3_engine = None
        if self._backend == "pyttsx3":
            try:
                import pyttsx3
                pyttsx3_engine = pyttsx3.init()
            except Exception as exc:
                print(f"[TTS] pyttsx3 init error in worker: {exc}")

        while True:
            try:
                _priority, _counter, text = self._queue.get(timeout=0.5)
            except queue.Empty:
                if not self._running:
                    break
                continue

            if text is _STOP_SENTINEL:
                self._queue.task_done()
                break

            try:
                if self._backend == "piper":
                    self._play_piper(text)
                elif self._backend == "win32com" and native_speaker:
                    native_speaker.Speak(text, 0)
                elif self._backend == "espeak":
                    self._play_espeak(text)
                elif self._backend == "pyttsx3" and pyttsx3_engine:
                    pyttsx3_engine.say(text)
                    pyttsx3_engine.runAndWait()
            except Exception as exc:
                print(f"[TTS] Playback error: {exc}")
            finally:
                self._queue.task_done()

    def _play_piper(self, text: str) -> None:
        if self._piper_voice is None:
            return
        from piper.voice import SynthesisConfig
        import numpy as np

        syn_config = SynthesisConfig(
            length_scale=1.0 / self._speech_rate_scale,
        )
        chunks = list(self._piper_voice.synthesize(text, syn_config=syn_config))
        if not chunks:
            return

        audio_array = np.concatenate([c.audio_float_array for c in chunks])
        sample_rate  = chunks[0].sample_rate

        if _SD_AVAILABLE:
            sd.play(audio_array, samplerate=sample_rate, blocking=True)
        else:
            print(f"[TTS][NO AUDIO OUTPUT] {text}")

    def _play_espeak(self, text: str) -> None:
        import subprocess
        import shutil
        binary = "espeak-ng" if shutil.which("espeak-ng") else "espeak"
        subprocess.run(
            [binary, "-s", "165", "-v", "en-us", text],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def _enqueue(self, message: str, priority: int) -> None:
        with self._counter_lock:
            self._counter += 1
            counter = self._counter
        self._queue.put((priority, counter, message))

    def _flush_normal_queue(self) -> None:
        kept: list[tuple] = []
        while True:
            try:
                item = self._queue.get_nowait()
                priority = item[0]
                text     = item[2]
                if priority == _PRIORITY_CRITICAL or text is _STOP_SENTINEL:
                    kept.append(item)
            except queue.Empty:
                break

        for item in kept:
            self._queue.put(item)
