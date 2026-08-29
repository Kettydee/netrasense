"""
NetraSense / Blind's Eye — Hardware Probing & Model Loading Engine
==================================================================
Dynamically detects host hardware (GPU model, VRAM, CPU) and selects
the appropriate model tier and ONNX Runtime execution provider.
"""

from __future__ import annotations

import os
import platform
from dataclasses import dataclass, field
from enum import IntEnum
from pathlib import Path
from typing import Optional

try:
    import torch
except ImportError:
    torch = None

try:
    from ultralytics import YOLO
except ImportError:
    YOLO = None

try:
    import onnxruntime as ort
except ImportError:
    ort = None


# ======================================================================
# Data Classes
# ======================================================================

class Tier(IntEnum):
    """Hardware tier classification."""
    TIER_1_SERVER = 1    # A100 / high-end datacenter GPU
    TIER_2_EDGE = 2      # Consumer NVIDIA GPU (<= 8 GB VRAM)
    TIER_3_CPU = 3       # No dedicated GPU


@dataclass
class HardwareProfile:
    """Snapshot of the detected host hardware."""
    tier: Tier
    platform: str
    cpu_name: str
    cuda_available: bool
    gpu_name: Optional[str] = None
    gpu_vram_gb: Optional[float] = None
    onnx_providers: list[str] = field(default_factory=list)


# ======================================================================
# Hardware Probe
# ======================================================================

class HardwareProbe:
    """
    Probes the local system and returns a `HardwareProfile`.
    """
    _TIER1_VRAM_MIN = 20.0   # >= 20 GB -> server class

    def __init__(self) -> None:
        self.profile: HardwareProfile = self._probe()

    def detect(self) -> dict:
        """Return the profile as a plain dict."""
        return {
            "tier": self.profile.tier.name,
            "platform": self.profile.platform,
            "cpu": self.profile.cpu_name,
            "cuda": self.profile.cuda_available,
            "gpu": self.profile.gpu_name,
            "vram_gb": self.profile.gpu_vram_gb,
            "onnx_providers": self.profile.onnx_providers,
        }

    def _probe(self) -> HardwareProfile:
        plat = platform.platform()
        cpu = platform.processor() or "unknown"
        cuda = False
        gpu_name: Optional[str] = None
        vram_gb: Optional[float] = None
        tier = Tier.TIER_3_CPU

        # --- CUDA / GPU detection via PyTorch --------------------------
        if torch is not None and torch.cuda.is_available():
            cuda = True
            gpu_name = torch.cuda.get_device_name(0)
            vram_bytes = torch.cuda.get_device_properties(0).total_memory
            vram_gb = round(vram_bytes / (1024 ** 3), 2)

            if vram_gb >= self._TIER1_VRAM_MIN:
                tier = Tier.TIER_1_SERVER
            else:
                tier = Tier.TIER_2_EDGE
        else:
            tier = Tier.TIER_3_CPU

        # --- ONNX Runtime providers ------------------------------------
        onnx_providers: list[str] = []
        if ort is not None:
            onnx_providers = ort.get_available_providers()

        return HardwareProfile(
            tier=tier,
            platform=plat,
            cpu_name=cpu,
            cuda_available=cuda,
            gpu_name=gpu_name,
            gpu_vram_gb=vram_gb,
            onnx_providers=onnx_providers,
        )


# ======================================================================
# Model Loader
# ======================================================================

_SERVER_ROOT = Path(__file__).resolve().parent
_MODELS_DIR = _SERVER_ROOT / "models"

_YOLO_TIER_MAP: dict[Tier, str] = {
    Tier.TIER_1_SERVER: "yolo11m.pt",
    Tier.TIER_2_EDGE:   "yolo11n.pt",
    Tier.TIER_3_CPU:    "yolo11n.pt",
}

_DEPTH_TIER_MAP: dict[Tier, str] = {
    Tier.TIER_1_SERVER: "depth_anything_v2_large.engine",
    Tier.TIER_2_EDGE:   "depth_anything_v2_small.onnx",
    Tier.TIER_3_CPU:    "depth_anything_v2_small.onnx",
}


class ModelLoader:
    """
    Loads the YOLO and Depth Anything V2 models appropriate for the
    detected hardware tier.
    """

    def __init__(
        self,
        profile: HardwareProfile,
        models_dir: Optional[Path | str] = None,
    ) -> None:
        self._profile = profile
        self._models_dir = Path(models_dir) if models_dir else _MODELS_DIR
        self._yolo_model = None
        self._depth_session = None

    def load_yolo(self):
        """Load the Ultralytics YOLO model."""
        if YOLO is None:
            raise ImportError("ultralytics is not installed. Run: pip install ultralytics")

        weight_name = _YOLO_TIER_MAP[self._profile.tier]
        weight_path = self._models_dir / "detection" / weight_name

        source = str(weight_path) if weight_path.exists() else weight_name
        print(f"[ENGINE] Loading YOLO model: {source} (Tier {self._profile.tier.name})")

        self._yolo_model = YOLO(source)
        return self._yolo_model

    def load_depth(self):
        """Load the Depth Anything V2 ONNX model via ONNX Runtime if present."""
        if ort is None:
            print("[ENGINE] onnxruntime not installed — running without depth estimation.")
            return None

        weight_name = _DEPTH_TIER_MAP[self._profile.tier]
        weight_path = self._models_dir / "depth" / weight_name

        if not weight_path.exists():
            print(f"[ENGINE] Depth model not found at {weight_path}. Running detection-only.")
            return None

        providers = self._select_onnx_providers()
        print(f"[ENGINE] Loading depth model: {weight_path} with providers {providers}")

        try:
            self._depth_session = ort.InferenceSession(
                str(weight_path), providers=providers,
            )
            return self._depth_session
        except Exception as exc:
            print(f"[ENGINE] Depth session load error: {exc}")
            return None

    def _select_onnx_providers(self) -> list[str]:
        available = set(self._profile.onnx_providers)
        if self._profile.tier in (Tier.TIER_1_SERVER, Tier.TIER_2_EDGE):
            preferred = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        else:
            preferred = ["OpenVINOExecutionProvider", "CPUExecutionProvider"]
        return [p for p in preferred if p in available] or ["CPUExecutionProvider"]

    @property
    def yolo(self):
        return self._yolo_model

    @property
    def depth(self):
        return self._depth_session
