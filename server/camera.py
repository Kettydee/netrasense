import cv2
import threading
import time

class CameraStream:
    """
    Asynchronously reads frames from a cv2.VideoCapture in a background thread.
    This prevents the camera buffer from backing up (which causes lag
    when inference is slower than the camera framerate).
    """
    def __init__(self, src=0):
        self.src = src
        self.cap = cv2.VideoCapture(src)
        self.ret = False
        self.frame = None
        self.running = True
        
        if self.cap.isOpened():
            self.ret, self.frame = self.cap.read()
            self.thread = threading.Thread(target=self._update, daemon=True, name="camera-stream")
            self.thread.start()

    def _update(self):
        while self.running:
            if self.cap.isOpened():
                try:
                    ret, frame = self.cap.read()
                    if ret:
                        self.ret = ret
                        self.frame = frame
                except Exception as e:
                    print(f"[CAMERA] Stream warning: {e}")
            time.sleep(0.01)

    def read(self):
        return self.ret, self.frame
        
    def isOpened(self):
        return self.cap.isOpened()
        
    def release(self):
        self.running = False
        if self.cap:
            self.cap.release()
