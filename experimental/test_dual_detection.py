"""Unit tests for the optional fusion module. Run: python -m unittest discover -s experimental -p 'test_*.py'"""
import unittest
from dual_detection import fuse_detections

class FusionTests(unittest.TestCase):
    def test_same_object_duplicate_removed(self):
        a = [{"label": "person", "confidence": .8, "bbox": [0, 0, 100, 100], "distance_cm": 65}]
        b = [{"label": "person", "confidence": .9, "bbox": [2, 2, 98, 98]}]
        result = fuse_detections(a, b)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["source"], "ultralytics")

    def test_different_classes_remain(self):
        a = [{"label": "person", "confidence": .8, "bbox": [0, 0, 100, 100]}]
        b = [{"label": "bicycle", "confidence": .9, "bbox": [0, 0, 100, 100]}]
        self.assertEqual(len(fuse_detections(a, b)), 2)

    def test_existing_sensor_distance_is_not_overwritten_when_unique(self):
        a = [{"label": "chair", "confidence": .8, "bbox": [0, 0, 100, 100], "distance_cm": 45}]
        self.assertEqual(fuse_detections(a, [])[0]["distance_cm"], 45)

    def test_invalid_boxes_are_skipped(self):
        self.assertEqual(fuse_detections([{"label": "person", "confidence": .9, "bbox": [0, 0, 0, 0]}], []), [])

if __name__ == "__main__":
    unittest.main()
