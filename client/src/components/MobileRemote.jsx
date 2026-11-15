import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { socket } from '../socket';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const clampPercent = (v) => Math.min(100, Math.max(0, v * 100));

export default function MobileRemote() {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let stream = null;
    let landmarker = null;
    let lastVideoTime = -1;

    const loop = () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (landmarker && video && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const result = landmarker.detectForVideo(video, performance.now());
        const hand = result.landmarks?.[0];
        if (hand) {
          const p = hand[9]; // middle finger base (palm center)
          // Front camera is mirrored, so flip X
          const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
          const tips = [8, 12, 16, 20].reduce((s, i) => s + d(hand[i], hand[0]), 0) / 4;
          const isPunching = tips < d(hand[9], hand[0]) * 1.3; // closed fist
          socket.emit('handMove', { x: clampPercent(1 - p.x), y: clampPercent(p.y), isPunching });
          setStatus('Hand detected');
        } else {
          setStatus('No hand detected');
        }
      }
      rafId = requestAnimationFrame(loop);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const lm = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
        });
        if (cancelled) return lm.close();
        landmarker = lm;
        setStatus('Show your hand');
        loop();
      } catch (err) {
        console.error(err);
        if (!cancelled) setStatus(`Error: ${err.message}`);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      landmarker?.close();
    };
  }, []);

  return (
    <div className="relative w-screen h-screen bg-gray-800 text-white overflow-hidden">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 w-full h-screen object-cover scale-x-[-1]"
      />
      <div className="absolute inset-0 bg-black/10 pointer-events-none" />
      <div className="absolute top-3 left-3 right-3 z-10 px-3 py-2 rounded-lg bg-black/50 text-white text-sm text-center">
        وجه الكاميرا نحوك وحرك يدك<div className="text-sm font-bold text-yellow-300 mt-1">قم بتدوير الهاتف بالعرض (Landscape) للحصول على أفضل تحكم</div>
        <div className="text-xs opacity-80 mt-1">{status}</div>
      </div>
    </div>
  );
}


