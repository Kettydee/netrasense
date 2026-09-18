"""
NetraSense Biometric Face & Mood Engine
=======================================
Provides 1-shot biometric face enrollment, high-accuracy recognition
using ArcFace 512D embeddings, and emotional expression reading via DeepFace.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

# Ensure UTF-8 output to prevent Windows console encoding issues with emojis
os.environ["PYTHONUTF8"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

# Reduce TensorFlow verbose logging
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

logger = logging.getLogger("FaceEngine")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


EMOTION_MAP = {
    "happy": ("Smiling warmly", "😊"),
    "neutral": ("Attentive and calm", "🙂"),
    "surprise": ("Surprised and alert", "😲"),
    "sad": ("Looking thoughtful or concerned", "😔"),
    "fear": ("Looking startled", "😨"),
    "angry": ("Looking serious or tense", "😐"),
    "disgust": ("Looking displeased", "😕"),
}

# ArcFace Cosine distance threshold (DeepFace default is ~0.68; 0.50 gives high precision)
DEFAULT_COSINE_THRESHOLD = 0.50


class FaceEngine:
    """Biometric Face Recognition and Emotional Expression Engine."""

    def __init__(self, storage_dir: Optional[str] = None):
        base_dir = Path(__file__).resolve().parent
        self.storage_dir = Path(storage_dir) if storage_dir else base_dir / "known_faces"
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_file = self.storage_dir / "metadata.json"
        self.embeddings_file = self.storage_dir / "embeddings.npy"

        self.threshold = DEFAULT_COSINE_THRESHOLD
        self.enrolled_faces: Dict[str, Dict[str, Any]] = {}
        # Mapping: name -> list of normalized 512D numpy embeddings
        self.face_embeddings: Dict[str, List[np.ndarray]] = {}

        self._load_enrolled()
        logger.info(f"[FaceEngine] Initialized with {len(self.enrolled_faces)} enrolled faces.")

    def _load_enrolled(self) -> None:
        """Load enrolled faces metadata and cached embeddings."""
        if self.metadata_file.exists():
            try:
                with open(self.metadata_file, "r", encoding="utf-8") as f:
                    self.enrolled_faces = json.load(f)
            except Exception as exc:
                logger.error(f"[FaceEngine] Failed to load metadata: {exc}")
                self.enrolled_faces = {}

        if self.embeddings_file.exists():
            try:
                raw_data = np.load(self.embeddings_file, allow_pickle=True).item()
                self.face_embeddings = {k: [np.array(e, dtype=np.float32) for e in v] for k, v in raw_data.items()}
            except Exception as exc:
                logger.error(f"[FaceEngine] Failed to load embeddings: {exc}")
                self.face_embeddings = {}

    def _save_enrolled(self) -> None:
        """Persist enrolled faces metadata and embeddings to disk."""
        try:
            with open(self.metadata_file, "w", encoding="utf-8") as f:
                json.dump(self.enrolled_faces, f, indent=2, ensure_ascii=False)
            
            serializable_embeddings = {
                k: [e.tolist() for e in v] for k, v in self.face_embeddings.items()
            }
            np.save(self.embeddings_file, serializable_embeddings)
        except Exception as exc:
            logger.error(f"[FaceEngine] Failed to persist enrolled faces: {exc}")

    @staticmethod
    def _sanitize_name(name: str) -> str:
        """Sanitize name string for filenames."""
        cleaned = re.sub(r'[^\w\s-]', '', name).strip()
        return re.sub(r'[-\s]+', '_', cleaned)

    @staticmethod
    def _normalize_l2(vector: np.ndarray) -> np.ndarray:
        """L2 normalize embedding vector."""
        norm = np.linalg.norm(vector)
        if norm == 0:
            return vector
        return vector / norm

    @staticmethod
    def decode_base64_frame(frame_data: str) -> Optional[np.ndarray]:
        """Convert a base64 or data URL string to an OpenCV BGR image."""
        try:
            if "," in frame_data:
                frame_data = frame_data.split(",", 1)[1]
            img_bytes = base64.b64decode(frame_data)
            np_arr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            return img
        except Exception as exc:
            logger.error(f"[FaceEngine] Base64 decode error: {exc}")
            return None

    def enroll_face(self, name: str, frame_bgr: np.ndarray) -> Dict[str, Any]:
        """
        Enroll a person by name from a camera frame.
        Detects face, computes ArcFace 512D embedding, and saves reference crop.
        """
        name = name.strip()
        if not name:
            return {"success": False, "error": "Name cannot be empty."}

        if frame_bgr is None or frame_bgr.size == 0:
            return {"success": False, "error": "Invalid camera frame received."}

        try:
            from deepface import DeepFace

            # Detect face and compute 512D ArcFace embedding
            # detector_backend='opencv' is fast and reliable; 'retinaface' can be used as high-precision fallback
            results = DeepFace.represent(
                img_path=frame_bgr,
                model_name="ArcFace",
                enforce_detection=True,
                detector_backend="opencv",
                align=True,
            )

            if not results or len(results) == 0:
                return {
                    "success": False,
                    "error": "No face detected in camera view. Please center your face in front of the lens.",
                }

            # Select the largest face detected
            primary = max(
                results,
                key=lambda r: r.get("facial_area", {}).get("w", 0) * r.get("facial_area", {}).get("h", 0),
            )

            embedding = np.array(primary["embedding"], dtype=np.float32)
            embedding = self._normalize_l2(embedding)

            # Crop face with margin for visual thumbnail
            area = primary.get("facial_area", {})
            x, y, w, h = area.get("x", 0), area.get("y", 0), area.get("w", 0), area.get("h", 0)
            h_img, w_img = frame_bgr.shape[:2]
            pad_x, pad_y = int(w * 0.15), int(h * 0.15)
            x1 = max(0, x - pad_x)
            y1 = max(0, y - pad_y)
            x2 = min(w_img, x + w + pad_x)
            y2 = min(h_img, y + h + pad_y)

            crop = frame_bgr[y1:y2, x1:x2]
            sanitized = self._sanitize_name(name)
            crop_path = self.storage_dir / f"{sanitized}.jpg"
            if crop.size > 0:
                cv2.imwrite(str(crop_path), crop)

            # Store embedding (support up to 3 multi-sample embeddings per person for robustness)
            if name not in self.face_embeddings:
                self.face_embeddings[name] = []
            
            # Keep newest samples, max 3
            self.face_embeddings[name].append(embedding)
            if len(self.face_embeddings[name]) > 3:
                self.face_embeddings[name].pop(0)

            # Update metadata
            self.enrolled_faces[name] = {
                "name": name,
                "sanitized": sanitized,
                "enrolled_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "samples_count": len(self.face_embeddings[name]),
                "image_file": f"{sanitized}.jpg",
            }

            self._save_enrolled()
            logger.info(f"[FaceEngine] Successfully enrolled '{name}' ({len(self.face_embeddings[name])} samples).")

            return {
                "success": True,
                "name": name,
                "message": f"Successfully enrolled {name} into recognized biometric contacts.",
                "samplesCount": len(self.face_embeddings[name]),
            }

        except ValueError as val_err:
            logger.warning(f"[FaceEngine] Face detection failed during enrollment: {val_err}")
            return {
                "success": False,
                "error": "No face detected in camera view. Please look directly into the camera in good lighting.",
            }
        except Exception as exc:
            logger.error(f"[FaceEngine] Enrollment error: {exc}", exc_info=True)
            return {"success": False, "error": f"Face enrollment failed: {str(exc)}"}

    def recognize_face_and_mood(self, frame_bgr: np.ndarray) -> Dict[str, Any]:
        """
        Identify person in front of the camera and read their emotional expression.
        Uses ArcFace 512D embeddings for identification, and DeepFace emotion analysis.
        """
        if frame_bgr is None or frame_bgr.size == 0:
            return {"success": False, "error": "Invalid camera frame received."}

        try:
            from deepface import DeepFace

            # 1. Detect faces & extract ArcFace embeddings
            try:
                reps = DeepFace.represent(
                    img_path=frame_bgr,
                    model_name="ArcFace",
                    enforce_detection=True,
                    detector_backend="opencv",
                    align=True,
                )
            except ValueError:
                # No face detected
                return {
                    "success": True,
                    "peopleCount": 0,
                    "identified": False,
                    "identifiedName": None,
                    "mood": "None",
                    "moodEmoji": "👤",
                    "distanceEstimate": "None",
                    "actionDescription": "No person in camera frame",
                    "speech": "No person detected in front of the camera.",
                    "source": "arcface_deepface",
                }

            if not reps:
                return {
                    "success": True,
                    "peopleCount": 0,
                    "identified": False,
                    "identifiedName": None,
                    "mood": "None",
                    "moodEmoji": "👤",
                    "distanceEstimate": "None",
                    "actionDescription": "No person in camera frame",
                    "speech": "No person detected in front of the camera.",
                    "source": "arcface_deepface",
                }

            # Select primary (largest) face
            primary = max(
                reps,
                key=lambda r: r.get("facial_area", {}).get("w", 0) * r.get("facial_area", {}).get("h", 0),
            )
            live_emb = self._normalize_l2(np.array(primary["embedding"], dtype=np.float32))
            area = primary.get("facial_area", {})
            face_h = area.get("h", 0)

            # 2. Match against all enrolled faces using cosine distance
            best_match_name: Optional[str] = None
            best_distance: float = 1.0

            for enrolled_name, emb_list in self.face_embeddings.items():
                for saved_emb in emb_list:
                    # Cosine distance = 1 - dot(u, v) for normalized vectors
                    cos_sim = float(np.dot(live_emb, saved_emb))
                    cos_dist = max(0.0, 1.0 - cos_sim)
                    if cos_dist < best_distance:
                        best_distance = cos_dist
                        best_match_name = enrolled_name

            is_identified = bool(best_match_name is not None and best_distance < self.threshold)
            confidence_pct = (
                round(max(0.0, min(100.0, (1.0 - (best_distance / self.threshold)) * 100.0)), 1)
                if is_identified
                else 0.0
            )

            # 3. Emotion / Mood Analysis
            mood_str = "Attentive and calm"
            mood_emoji = "🙂"
            dominant_emotion = "neutral"

            try:
                # Crop face region for focused emotion analysis
                h_img, w_img = frame_bgr.shape[:2]
                x, y, w, h = area.get("x", 0), area.get("y", 0), area.get("w", 0), area.get("h", 0)
                crop_face = frame_bgr[max(0, y):min(h_img, y + h), max(0, x):min(w_img, x + w)]
                input_for_emotion = crop_face if crop_face.size > 400 else frame_bgr

                analyses = DeepFace.analyze(
                    img_path=input_for_emotion,
                    actions=["emotion"],
                    enforce_detection=False,
                    detector_backend="opencv",
                    silent=True,
                )
                if analyses and len(analyses) > 0:
                    dominant_emotion = analyses[0].get("dominant_emotion", "neutral")
                    mapped = EMOTION_MAP.get(dominant_emotion, ("Attentive", "🙂"))
                    mood_str = mapped[0]
                    mood_emoji = mapped[1]
            except Exception as emo_err:
                logger.warning(f"[FaceEngine] Emotion analysis warning: {emo_err}")

            # 4. Spatial distance estimation from face height in pixels
            # 200px -> ~0.5m, 100px -> ~1.0m, 50px -> ~2.0m
            if face_h > 20:
                meters = round(max(0.4, min(3.5, 95.0 / face_h)), 1)
                distance_str = f"{meters} meters ahead"
            else:
                distance_str = "1 to 2 meters ahead"

            # 5. Formulate natural spoken readout
            person_label = best_match_name if is_identified else "An unfamiliar person"
            speech = f"{person_label} is {distance_str}, {mood_str.lower()}."

            return {
                "success": True,
                "peopleCount": len(reps),
                "identified": is_identified,
                "identifiedName": best_match_name if is_identified else None,
                "confidence": confidence_pct,
                "distanceScore": round(float(best_distance), 3),
                "mood": mood_str,
                "dominantEmotion": dominant_emotion,
                "moodEmoji": mood_emoji,
                "distanceEstimate": distance_str,
                "actionDescription": f"Facing camera, {mood_str.lower()}",
                "speech": speech,
                "box": area,
                "source": "arcface_deepface",
            }

        except Exception as exc:
            logger.error(f"[FaceEngine] Face recognition error: {exc}", exc_info=True)
            return {"success": False, "error": f"Recognition failed: {str(exc)}"}

    def list_enrolled(self) -> List[Dict[str, Any]]:
        """Return list of currently enrolled people."""
        return list(self.enrolled_faces.values())

    def delete_person(self, name: str) -> bool:
        """Remove a person from enrolled database."""
        name = name.strip()
        if name in self.enrolled_faces:
            info = self.enrolled_faces.pop(name)
            if name in self.face_embeddings:
                del self.face_embeddings[name]
            
            # Remove image thumbnail if present
            img_file = self.storage_dir / info.get("image_file", "")
            if img_file.exists():
                try:
                    img_file.unlink()
                except Exception:
                    pass

            self._save_enrolled()
            logger.info(f"[FaceEngine] Deleted enrolled person: {name}")
            return True
        return False
