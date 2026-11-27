import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FilesetResolver, FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
import { io } from 'socket.io-client';
import { loadAllLolyAssets } from './lolyAssets';
import { lolyAudio, LOLY_TRACKS } from './lolyAudio';
import LolyStageCanvas from './LolyStageCanvas';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const AUTO_MIX_INTERVAL_MS = 45000;
const CHILD_LOCK_HOLD_MS = 2000; // 2.0s hold to exit phone mirror
const MOTION_EMIT_INTERVAL_MS = 40; // ~25fps smooth low-latency streaming

const LOLY_SCENES = [
  { id: 0, title: 'أبلة فاهيتا', emoji: '💎' },
  { id: 1, title: 'لولاتي والبطة', emoji: '🐥' },
  { id: 2, title: 'الفقاعات السحرية', emoji: '🫧' },
  { id: 3, title: 'موكب العيلة', emoji: '🎈' },
];

const ADULT_GESTURE_GUIDE = [
  { type: 'victory', icon: '✌️', label: 'أبلة فاهيتا' },
  { type: 'ok_thumbs', icon: '👍👌', label: 'البطة الراقصة' },
  { type: 'open_palm', icon: '🖐️', label: 'بالونات العيلة' },
  { type: 'fist', icon: '✊', label: 'مدفع + أغنية' },
];

function detectIsMobileViewport() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || window.innerWidth < 768;
}

/**
 * Classifies Adult Secret Hand Gestures from 21 MediaPipe Hand Landmarks:
 * - 'victory'   (✌️ V-sign)
 * - 'ok_thumbs' (👍 Thumbs-Up OR 👌 OK circle)
 * - 'open_palm' (🖐️ Open waving palm)
 * - 'fist'      (✊ Closed fist)
 */
function classifyAdultHandGesture(hlm) {
  if (!hlm || hlm.length < 21) return null;
  const wrist = hlm[0];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const palmLen = Math.max(0.04, dist(wrist, hlm[9]));

  const indexExt = dist(wrist, hlm[8]) > dist(wrist, hlm[6]) * 1.14;
  const middleExt = dist(wrist, hlm[12]) > dist(wrist, hlm[10]) * 1.14;
  const ringExt = dist(wrist, hlm[16]) > dist(wrist, hlm[14]) * 1.11;
  const pinkyExt = dist(wrist, hlm[20]) > dist(wrist, hlm[18]) * 1.11;

  // 1. 👌 OK Sign: Thumb tip (4) touching/close to Index tip (8), while middle + ring are extended
  const thumbIndexDist = dist(hlm[4], hlm[8]);
  if (thumbIndexDist < palmLen * 0.42 && middleExt && ringExt) {
    return { type: 'ok_thumbs', priority: 4 };
  }

  // 2. ✌️ Victory Sign: Index + Middle extended & spread apart, Ring + Pinky folded
  if (
    indexExt &&
    middleExt &&
    !ringExt &&
    !pinkyExt &&
    dist(hlm[8], hlm[12]) > palmLen * 0.24
  ) {
    return { type: 'victory', priority: 4 };
  }

  // 3. 👍 Thumbs-Up: 4 fingers curled, Thumb (4) clearly extended & raised above index knuckle (5)
  const fourCurled = !indexExt && !middleExt && !ringExt && !pinkyExt;
  const thumbOut = dist(hlm[4], hlm[5]) > palmLen * 0.52;
  const thumbPointingUp = hlm[4].y < hlm[3].y && hlm[4].y < hlm[5].y - palmLen * 0.12;
  if (fourCurled && thumbOut && thumbPointingUp) {
    return { type: 'ok_thumbs', priority: 3 };
  }

  // 4. 🖐️ Open Palm (Bye-Bye): All 4 fingers extended + thumb open
  if (indexExt && middleExt && ringExt && pinkyExt && dist(hlm[4], hlm[17]) > palmLen * 0.85) {
    return { type: 'open_palm', priority: 2 };
  }

  // 5. ✊ Closed Fist: All 4 fingers tightly curled into palm (and NOT thumbs-up)
  const tightlyFolded =
    fourCurled &&
    !thumbPointingUp &&
    dist(wrist, hlm[8]) < dist(wrist, hlm[5]) * 1.4 &&
    dist(wrist, hlm[12]) < dist(wrist, hlm[9]) * 1.4;

  if (tightlyFolded) {
    return { type: 'fist', priority: 1 };
  }

  return null;
}

export default function LolyWorld() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Dedicated Socket.IO client configured with ['polling', 'websocket'] for rock-solid VS Code Ports (`devtunnels.ms`) stability!
  const lolySocket = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return io(origin, {
      transports: ['polling', 'websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 500,
    });
  }, []);

  useEffect(() => {
    return () => {
      lolySocket.disconnect();
    };
  }, [lolySocket]);

  // mode: 'select' | 'tv' | 'mobile'
  const initialMode = searchParams.get('mode') || 'select';
  const [mode, setMode] = useState(initialMode);
  const [isMobileDevice, setIsMobileDevice] = useState(detectIsMobileViewport);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [autoMix, setAutoMix] = useState(true);
  const [currentTrack, setCurrentTrack] = useState(0);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [assets, setAssets] = useState(null);

  // Room & Phone Connection Status
  const [isRoomConnected, setIsRoomConnected] = useState(false);
  const [phonePairedOnTv, setPhonePairedOnTv] = useState(false);
  const [cameraStreamActive, setCameraStreamActive] = useState(false);
  const [cameraPermissionError, setCameraPermissionError] = useState('');
  const [cameraRetryTick, setCameraRetryTick] = useState(0);

  // TV Controls Drawer
  const [showControlsHud, setShowControlsHud] = useState(false);

  // Mobile Exit Lock Progress (2s hold)
  const [exitHoldProgress, setExitHoldProgress] = useState(0);

  const videoRef = useRef(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const motionRef = useRef({
    faceDetected: false,
    faceX: 0.56,
    faceY: 0.52,
    faceScale: 1.0,
    headTilt: 0,
    isSmiling: false,
    movementEnergy: 0,
    adultGesture: null,
    updatedAt: 0,
  });
  const gestureCommandRef = useRef({ type: null, seq: 0 });
  const gestureSeqCounterRef = useRef(1);
  const lastFistAdvanceAtRef = useRef(0);
  const holdIntervalRef = useRef(null);
  const holdStartRef = useRef(0);
  const wakeLockRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const onResize = () => setIsMobileDevice(detectIsMobileViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Load chroma-keyed character stickers & real Loly photos + playlist state
  useEffect(() => {
    let mounted = true;
    loadAllLolyAssets().then((loaded) => {
      if (mounted) setAssets(loaded);
    });

    const unsubscribeTrack = lolyAudio.onTrackChange(({ trackIndex, isPlaying }) => {
      if (!mounted) return;
      setCurrentTrack(trackIndex);
      setIsMusicPlaying(isPlaying);
    });

    return () => {
      mounted = false;
      unsubscribeTrack();
      lolyAudio.destroy();
    };
  }, []);

  // Unlock & start 3-track playlist loop on first touch/click on PC
  useEffect(() => {
    if (mode === 'mobile') return;
    const handleFirstGesture = () => {
      lolyAudio.unlockOnFirstGesture();
    };
    window.addEventListener('pointerdown', handleFirstGesture, { once: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
    };
  }, [mode]);

  const switchMode = useCallback(
    (nextMode) => {
      modeRef.current = nextMode;
      setMode(nextMode);
      setCameraPermissionError('');

      if (nextMode === 'select') {
        setSearchParams({}, { replace: true });
        lolyAudio.pauseMusic();
        setIsMusicPlaying(false);
        lolySocket.emit('loly:join', { role: 'select' });
      } else {
        setSearchParams({ mode: nextMode }, { replace: true });
        lolySocket.emit('loly:join', { role: nextMode });
        if (nextMode === 'tv') {
          setShowControlsHud(false);
          lolyAudio.unlockOnFirstGesture();
        }
      }
    },
    [lolySocket, setSearchParams]
  );

  // Trigger Adult Gesture Surprise on the PC Stage (and switch track/scene on `fist` ✊)
  const triggerAdultSurpriseOnStage = useCallback((type) => {
    if (!type) return;
    const seq = ++gestureSeqCounterRef.current;
    gestureCommandRef.current = { type, seq };

    if (type === 'fist') {
      const now = performance.now();
      if (now - lastFistAdvanceAtRef.current > 2400) {
        lastFistAdvanceAtRef.current = now;
        lolyAudio.nextTrack();
        setSceneIndex((prev) => (prev + 1) % LOLY_SCENES.length);
      }
    }
  }, []);

  // Screen Wake Lock so neither Phone Mirror nor PC Stage dims
  useEffect(() => {
    if (mode === 'select' || !('wakeLock' in navigator)) return;
    let active = true;
    navigator.wakeLock
      .request('screen')
      .then((sentinel) => {
        if (active) wakeLockRef.current = sentinel;
        else sentinel.release().catch(() => {});
      })
      .catch(() => {});

    return () => {
      active = false;
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [mode]);

  // Auto-Mix scene rotation every 45 seconds on PC Stage
  useEffect(() => {
    if (mode !== 'tv' || !autoMix) return;
    const id = setInterval(() => {
      setSceneIndex((prev) => (prev + 1) % LOLY_SCENES.length);
    }, AUTO_MIX_INTERVAL_MS);
    return () => clearInterval(id);
  }, [mode, autoMix]);

  // Socket.IO `'loly-room'` Join + Instant `loly:motion` & `loly:phone_status` Sync
  useEffect(() => {
    let lastRemoteGestureId = '';

    const joinRoomNow = () => {
      setIsRoomConnected(true);
      lolySocket.emit('loly:join', { role: modeRef.current });
    };

    const onDisconnect = () => {
      setIsRoomConnected(false);
      setPhonePairedOnTv(false);
    };

    const onPhoneStatus = (status) => {
      setIsRoomConnected(true);
      if (typeof status?.phoneConnected === 'boolean') {
        setPhonePairedOnTv(status.phoneConnected);
        if (status.phoneConnected && modeRef.current === 'select' && !detectIsMobileViewport()) {
          switchMode('tv');
        }
      }
    };

    const onRemoteMotion = (data) => {
      if (!data || modeRef.current === 'mobile') return;
      motionRef.current = {
        ...data,
        updatedAt: performance.now(),
      };
      setPhonePairedOnTv(true);

      // Auto-enter full-screen TV mode if PC was waiting on `/loly` landing screen!
      if (modeRef.current === 'select') {
        modeRef.current = 'tv';
        setMode('tv');
        setShowControlsHud(false);
        setSearchParams({ mode: 'tv' }, { replace: true });
        lolySocket.emit('loly:join', { role: 'tv' });
        lolyAudio.unlockOnFirstGesture();
      }

      if (data.adultGestureEvent?.type && data.adultGestureEvent?.id) {
        if (data.adultGestureEvent.id !== lastRemoteGestureId) {
          lastRemoteGestureId = data.adultGestureEvent.id;
          triggerAdultSurpriseOnStage(data.adultGestureEvent.type);
        }
      }
    };

    const onRemoteControl = (cmd) => {
      if (!cmd || modeRef.current === 'mobile') return;
      if (typeof cmd.sceneIndex === 'number') {
        setSceneIndex(cmd.sceneIndex % LOLY_SCENES.length);
      }
      if (typeof cmd.trackIndex === 'number') {
        lolyAudio.playTrack(cmd.trackIndex);
      }
      if (cmd.adultGesture) {
        triggerAdultSurpriseOnStage(cmd.adultGesture);
      }
    };

    if (lolySocket.connected) {
      joinRoomNow();
    }

    lolySocket.on('connect', joinRoomNow);
    lolySocket.on('disconnect', onDisconnect);
    lolySocket.on('loly:phone_status', onPhoneStatus);
    lolySocket.on('loly:motion', onRemoteMotion);
    lolySocket.on('loly:control', onRemoteControl);

    return () => {
      lolySocket.off('connect', joinRoomNow);
      lolySocket.off('disconnect', onDisconnect);
      lolySocket.off('loly:phone_status', onPhoneStatus);
      lolySocket.off('loly:motion', onRemoteMotion);
      lolySocket.off('loly:control', onRemoteControl);
    };
  }, [lolySocket, setSearchParams, switchMode, triggerAdultSurpriseOnStage]);

  // Phone Camera Face + 4-Hand Adult Gesture Loop (~40ms interval in `mobile` mode)
  useEffect(() => {
    if (mode !== 'mobile') {
      setCameraStreamActive(false);
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let stream = null;
    let faceLandmarker = null;
    let handLandmarker = null;
    let lastEmitMs = 0;

    let prevFaceX = null;
    let prevFaceY = null;
    let prevFaceScale = null;
    let prevHandCenters = [];

    let candidateGesture = null;
    let candidateStreak = 0;
    const lastFiredByType = {
      victory: 0,
      ok_thumbs: 0,
      open_palm: 0,
      fist: 0,
    };

    async function initPhoneMirrorAndVision() {
      setCameraPermissionError('');
      setCameraStreamActive(false);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraPermissionError(
          'يرجى فتح الرابط عبر HTTPS (رابط VS Code Ports) للسماح بتشغيل الكاميرا الأمامية.'
        );
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        setCameraStreamActive(true);
        lolySocket.emit('loly:join', { role: 'mobile' });
        lolySocket.emit('loly:phone_status', { role: 'mobile', phoneConnected: true });

        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;

        [faceLandmarker, handLandmarker] = await Promise.all([
          FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_MODEL_URL },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
          }),
          HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: HAND_MODEL_URL },
            runningMode: 'VIDEO',
            numHands: 4,
          }),
        ]);

        if (cancelled) return;

        const loop = () => {
          if (cancelled) return;
          rafId = requestAnimationFrame(loop);

          const now = performance.now();
          if (now - lastEmitMs < MOTION_EMIT_INTERVAL_MS) return;
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          lastEmitMs = now;

          let faceDetected = false;
          let faceX = prevFaceX ?? 0.5;
          let faceY = prevFaceY ?? 0.5;
          let faceScale = prevFaceScale ?? 1.0;
          let headTilt = 0;
          let isSmiling = false;
          let movementEnergy = 0;

          try {
            const faceRes = faceLandmarker.detectForVideo(video, now);
            if (faceRes?.faceLandmarks?.length > 0) {
              faceDetected = true;
              const lm = faceRes.faceLandmarks[0];
              const nose = lm[1] || lm[4];
              const leftEye = lm[33];
              const rightEye = lm[263];
              const leftCheek = lm[234];
              const rightCheek = lm[454];

              if (nose) {
                // Mirrored X (0..1) so moving right in front of phone moves character right on PC!
                faceX = Math.max(0, Math.min(1, 1 - nose.x));
                faceY = Math.max(0, Math.min(1, nose.y));
              }

              if (leftEye && rightEye) {
                headTilt = Math.atan2(leftEye.y - rightEye.y, rightEye.x - leftEye.x);
                const eyeSpan = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
                const cheekSpan =
                  leftCheek && rightCheek
                    ? Math.hypot(rightCheek.x - leftCheek.x, rightCheek.y - leftCheek.y)
                    : eyeSpan * 2.1;
                const rawWidth = Math.max(eyeSpan * 2.1, cheekSpan);
                // Normalized 0.6 (far) .. 2.4 (close-up baby face!)
                faceScale = Math.max(0.6, Math.min(2.4, rawWidth / 0.22));
              }

              if (prevFaceX !== null && prevFaceY !== null) {
                const dPos = Math.hypot(faceX - prevFaceX, faceY - prevFaceY);
                const dScale = Math.abs(faceScale - (prevFaceScale ?? faceScale)) * 0.35;
                movementEnergy = Math.min(1, dPos * 2.2 + dScale);
              }

              prevFaceX = faceX;
              prevFaceY = faceY;
              prevFaceScale = faceScale;

              const shapes = faceRes.faceBlendshapes?.[0]?.categories || [];
              let sLeft = 0;
              let sRight = 0;
              let jawOpen = 0;
              for (const c of shapes) {
                if (c.categoryName === 'mouthSmileLeft') sLeft = c.score;
                else if (c.categoryName === 'mouthSmileRight') sRight = c.score;
                else if (c.categoryName === 'jawOpen') jawOpen = c.score;
              }
              isSmiling = (sLeft + sRight) / 2 > 0.3 || jawOpen > 0.34;
            }
          } catch (_) {}

          let bestAdultGesture = null;
          const currentHandCenters = [];

          try {
            const handRes = handLandmarker.detectForVideo(video, now);
            const landmarksList = handRes?.landmarks || [];

            landmarksList.forEach((hlm, idx) => {
              const wristOrPalm = hlm[9] || hlm[0];
              if (wristOrPalm) {
                const cPt = { x: 1 - wristOrPalm.x, y: wristOrPalm.y };
                currentHandCenters.push(cPt);
                const prevPt = prevHandCenters[idx];
                if (prevPt) {
                  movementEnergy = Math.min(
                    1,
                    Math.max(movementEnergy, Math.hypot(cPt.x - prevPt.x, cPt.y - prevPt.y) * 1.4)
                  );
                }
              }

              const match = classifyAdultHandGesture(hlm);
              if (match && (!bestAdultGesture || match.priority > bestAdultGesture.priority)) {
                bestAdultGesture = match;
              }
            });

            prevHandCenters = currentHandCenters;
          } catch (_) {}

          const detectedType = bestAdultGesture?.type || null;
          if (detectedType && detectedType === candidateGesture) {
            candidateStreak++;
          } else {
            candidateGesture = detectedType;
            candidateStreak = detectedType ? 1 : 0;
          }

          const confirmedAdultGesture = candidateStreak >= 3 ? candidateGesture : null;
          let adultGestureEvent = null;

          if (confirmedAdultGesture) {
            const lastAt = lastFiredByType[confirmedAdultGesture] || 0;
            if (now - lastAt >= 2400) {
              lastFiredByType[confirmedAdultGesture] = now;
              adultGestureEvent = {
                type: confirmedAdultGesture,
                id: `${confirmedAdultGesture}-${Math.round(now)}`,
              };
            }
          }

          lolySocket.emit('loly:motion', {
            faceDetected,
            faceX: Number(faceX.toFixed(4)),
            faceY: Number(faceY.toFixed(4)),
            faceScale: Number(faceScale.toFixed(3)),
            headTilt: Number(headTilt.toFixed(3)),
            isSmiling,
            movementEnergy: Number(movementEnergy.toFixed(4)),
            adultGesture: confirmedAdultGesture,
            adultGestureEvent,
          });
        };

        rafId = requestAnimationFrame(loop);
      } catch (err) {
        console.error('[Loly Phone Mirror Error]:', err);
        setCameraStreamActive(false);
        setCameraPermissionError('يرجى السماح بإذن الكاميرا الأمامية لعرض مرآة لولاتي.');
      }
    }

    initPhoneMirrorAndVision();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      setCameraStreamActive(false);
      try {
        faceLandmarker?.close();
        handLandmarker?.close();
      } catch (_) {}
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [mode, cameraRetryTick, lolySocket]);

  // 2-Second Long-Press Exit Lock on Phone Mirror
  const startExitHold = () => {
    clearInterval(holdIntervalRef.current);
    holdStartRef.current = performance.now();
    setExitHoldProgress(8);

    holdIntervalRef.current = setInterval(() => {
      const elapsed = performance.now() - holdStartRef.current;
      const pct = Math.min(100, Math.round((elapsed / CHILD_LOCK_HOLD_MS) * 100));
      setExitHoldProgress(pct);
      if (elapsed >= CHILD_LOCK_HOLD_MS) {
        clearInterval(holdIntervalRef.current);
        setExitHoldProgress(0);
        switchMode('select');
      }
    }, 50);
  };

  const cancelExitHold = () => {
    clearInterval(holdIntervalRef.current);
    setExitHoldProgress(0);
  };

  const handleTrackSelect = async (idx) => {
    setCurrentTrack(idx);
    await lolyAudio.playTrack(idx);
  };

  const togglePlayPauseMusic = async () => {
    if (isMusicPlaying) {
      lolyAudio.pauseMusic();
    } else {
      await lolyAudio.playTrack(currentTrack);
    }
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    lolyAudio.setMuted(next);
  };

  // =========================================================================
  // VIEW 1: LANDING SCREEN (/loly) — TWO CLEAR SIDE-BY-SIDE BUTTONS
  // =========================================================================
  if (mode === 'select') {
    return (
      <main
        dir="rtl"
        className="min-h-[100dvh] w-full relative overflow-hidden flex flex-col items-center justify-center p-4 sm:p-8 select-none"
        style={{
          background:
            'linear-gradient(180deg, #BAE6FD 0%, #FEF3C7 58%, #86EFAC 82%, #22C55E 100%)',
        }}
      >
        <div className="relative z-10 w-full max-w-4xl bg-amber-50/95 border-4 border-amber-400 rounded-[2rem] p-6 sm:p-8 shadow-2xl flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-amber-200 pb-4">
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden bg-amber-100 border-4 border-amber-400 ring-4 ring-pink-300 shrink-0"
                style={{ boxShadow: '0 0 22px rgba(250, 204, 21, 0.8)' }}
              >
                <img
                  src="/loly/characters/loly.png"
                  alt="لولاتي"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h1 className="text-2xl sm:text-4xl font-extrabold text-pink-800">
                  عالم الأميرة لولاتي 👑
                </h1>
                <p className="text-sm sm:text-lg font-bold text-amber-900 mt-1">
                  مرآة وجه لولاتي على التليفون وتحريك المسرح الكرتوني تلقائياً على الكمبيوتر!
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate('/')}
              className="min-h-14 px-5 py-2.5 rounded-2xl bg-white hover:bg-amber-100 text-pink-900 font-extrabold border-2 border-amber-400 shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pink-400 shrink-0"
            >
              🏠 الرئيسية
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <button
              type="button"
              onClick={() => switchMode('mobile')}
              className={`min-h-52 p-6 rounded-3xl text-right flex flex-col items-start justify-between gap-3 transition-transform duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${
                isMobileDevice
                  ? 'order-1 bg-emerald-600 hover:bg-emerald-500 text-white border-4 border-yellow-300 shadow-2xl ring-4 ring-emerald-300'
                  : 'order-2 sm:order-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 border-4 border-white shadow-lg'
              }`}
            >
              <span className="text-5xl" aria-hidden="true">
                📱
              </span>
              <div className="space-y-1.5">
                <h2 className="text-xl sm:text-2xl font-extrabold">
                  مرآة التليفون أمام لولاتي
                </h2>
                <p
                  className={`text-sm sm:text-base leading-relaxed font-semibold ${
                    isMobileDevice ? 'text-emerald-50' : 'text-amber-950'
                  }`}
                >
                  يعرض وجه لولاتي فقط بملء شاشة التليفون ويبث حركتها وقربها وإشارات الأهل للكمبيوتر!
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => switchMode('tv')}
              className={`min-h-52 p-6 rounded-3xl bg-pink-600 hover:bg-pink-500 text-white border-4 border-yellow-300 shadow-lg flex flex-col items-start justify-between gap-3 text-right transition-transform duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${
                isMobileDevice ? 'order-2' : 'order-1 sm:order-2 ring-4 ring-pink-300'
              }`}
            >
              <span className="text-5xl" aria-hidden="true">
                📺
              </span>
              <div className="space-y-1.5">
                <h2 className="text-xl sm:text-2xl font-extrabold">
                  مسرح شاشة الكمبيوتر
                </h2>
                <p className="text-sm sm:text-base text-pink-50 leading-relaxed font-medium">
                  يستقبل حركة وجه لولاتي تلقائياً ويكبّر شخصيتها كلما اقتربت مع مفاجآت أبلة فاهيتا والبطة والعيلة!
                </p>
              </div>
            </button>
          </div>
        </div>
      </main>
    );
  }

  // =========================================================================
  // VIEW 2: PHONE FACE MIRROR (/loly?mode=mobile) — 100vw x 100vh PURE MIRROR ONLY!
  // =========================================================================
  if (mode === 'mobile') {
    const mirrorConnected = isRoomConnected && cameraStreamActive && !cameraPermissionError;

    return (
      <main className="fixed inset-0 w-screen h-screen overflow-hidden bg-black select-none touch-none">
        {/* Fullscreen Horizontally Mirrored Front Camera Feed ONLY (100vw x 100vh) */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-screen h-screen object-cover -scale-x-100"
        />

        {/* Tiny Green Connection Dot in Top-Right Corner */}
        <div
          className="fixed top-4 right-4 z-20 pointer-events-none flex items-center justify-center"
          title={mirrorConnected ? 'متصل بالكمبيوتر' : 'جاري الاتصال...'}
        >
          <span
            className={`block w-3.5 h-3.5 rounded-full border border-white/80 ${
              mirrorConnected ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
            style={{
              boxShadow: mirrorConnected
                ? '0 0 10px rgba(52, 211, 153, 0.95)'
                : '0 0 8px rgba(251, 191, 36, 0.85)',
            }}
          />
        </div>

        {/* Small Corner Lock Button (Requires 2-Second Long-Press to Exit) */}
        <button
          type="button"
          onPointerDown={startExitHold}
          onPointerUp={cancelExitHold}
          onPointerLeave={cancelExitHold}
          onPointerCancel={cancelExitHold}
          aria-label="اضغط مطولاً لمدة ثانيتين للخروج"
          className="fixed bottom-4 left-4 z-20 w-11 h-11 rounded-full bg-black/45 border border-white/40 text-white text-sm flex items-center justify-center overflow-hidden"
        >
          {exitHoldProgress > 0 && (
            <span
              className="absolute bottom-0 inset-x-0 bg-red-500/70 transition-none"
              style={{ height: `${exitHoldProgress}%` }}
              aria-hidden="true"
            />
          )}
          <span className="relative z-10">🔒</span>
        </button>

        {/* Camera Permission Prompt ONLY if Browser Blocked Camera */}
        {cameraPermissionError && (
          <div
            dir="rtl"
            role="alert"
            className="fixed inset-0 z-30 bg-black/85 flex items-center justify-center p-6"
          >
            <div className="max-w-sm w-full p-5 rounded-3xl bg-zinc-900 border-2 border-amber-400 text-white text-center flex flex-col gap-4">
              <p className="font-bold text-base leading-relaxed">⚠️ {cameraPermissionError}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCameraRetryTick((t) => t + 1)}
                  className="flex-1 min-h-12 rounded-xl bg-emerald-600 text-white font-bold text-sm"
                >
                  إعادة المحاولة
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('select')}
                  className="min-h-12 px-4 rounded-xl bg-zinc-700 text-white font-bold text-sm"
                >
                  رجوع
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  // =========================================================================
  // VIEW 3: PC STAGE (/loly?mode=tv) — AUTO FACE TRACKING + ADULT SURPRISES
  // =========================================================================
  return (
    <div dir="rtl" className="relative w-screen h-screen overflow-hidden select-none">
      {/* Hidden custom MP3 picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            lolyAudio.loadCustomAudioFile(file);
          }
        }}
      />

      {/* Fullscreen 60fps Cartoon Stage Controlled by Phone Face Mirror + Adult Gestures */}
      <LolyStageCanvas
        sceneIndex={sceneIndex}
        assets={assets}
        motionRef={motionRef}
        gestureCommandRef={gestureCommandRef}
      />

      {/* Discreet Corner Controls (Parent Bar Toggle + Home + Live Phone Dot + Audio Start if needed) */}
      <div className="fixed top-3 left-3 z-30 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowControlsHud((prev) => !prev)}
          className="min-h-11 px-3.5 py-1.5 rounded-2xl bg-white/90 hover:bg-white text-pink-900 font-extrabold text-xs sm:text-sm border-2 border-amber-400 shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
        >
          {showControlsHud ? '✕ إخفاء' : '👑 أدوات الأهل'}
        </button>

        <button
          type="button"
          onClick={() => navigate('/')}
          className="min-h-11 px-3.5 py-1.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-extrabold text-xs sm:text-sm border-2 border-white shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pink-400"
        >
          🏠 الرئيسية
        </button>

        {!isMusicPlaying && !isMuted && (
          <button
            type="button"
            onClick={() => lolyAudio.unlockOnFirstGesture()}
            className="min-h-11 px-3.5 py-1.5 rounded-2xl bg-pink-600 hover:bg-pink-500 text-white font-extrabold text-xs sm:text-sm border-2 border-yellow-200 shadow-md"
          >
            🔊 تشغيل الصوت
          </button>
        )}

        <span
          className={`min-h-11 px-3 py-1.5 rounded-2xl font-extrabold text-xs sm:text-sm border-2 shadow-md flex items-center gap-1.5 ${
            phonePairedOnTv
              ? 'bg-emerald-600 text-white border-emerald-200'
              : 'bg-white/85 text-amber-950 border-amber-300'
          }`}
        >
          <span>{phonePairedOnTv ? '🟢' : '⏳'}</span>
          <span>{phonePairedOnTv ? 'التليفون متصل' : 'بانتظار مرآة التليفون'}</span>
        </span>
      </div>

      {/* Collapsible Parent Drawer (Scenes + Playlist + Secret Adult Gestures Guide) */}
      {showControlsHud && (
        <aside
          aria-label="أدوات الأهل"
          className="fixed top-3 right-3 z-30 max-w-[calc(100vw-240px)] bg-white/95 border-3 border-amber-400 rounded-3xl p-3 shadow-2xl flex flex-col gap-2.5"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {LOLY_SCENES.map((sc) => {
              const active = sceneIndex === sc.id;
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => setSceneIndex(sc.id)}
                  className={`min-h-10 px-3 py-1 rounded-2xl font-extrabold text-xs border-2 flex items-center gap-1 ${
                    active
                      ? 'bg-pink-600 text-white border-yellow-300'
                      : 'bg-amber-50 text-amber-950 border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  <span>{sc.emoji}</span>
                  <span className="hidden md:inline">{sc.title}</span>
                </button>
              );
            })}

            <span className="h-5 w-0.5 bg-amber-200 mx-0.5" aria-hidden="true" />

            {LOLY_TRACKS.map((tr, idx) => (
              <button
                key={tr.id}
                type="button"
                onClick={() => handleTrackSelect(idx)}
                className={`min-h-10 px-2.5 py-1 rounded-2xl font-extrabold text-xs border-2 ${
                  currentTrack === idx && isMusicPlaying
                    ? 'bg-amber-400 text-zinc-950 border-pink-400'
                    : 'bg-amber-50 text-amber-950 border-amber-200 hover:bg-amber-100'
                }`}
              >
                {tr.emoji} {tr.title}
              </button>
            ))}

            <button
              type="button"
              onClick={togglePlayPauseMusic}
              className="min-h-10 px-2.5 py-1 rounded-2xl bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-xs border border-amber-300"
            >
              {isMusicPlaying ? '⏸' : '▶️'}
            </button>

            <button
              type="button"
              onClick={toggleMute}
              className="min-h-10 px-2.5 py-1 rounded-2xl bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-xs border border-amber-300"
            >
              {isMuted ? '🔇' : '🔊'}
            </button>

            <button
              type="button"
              onClick={() => setAutoMix((prev) => !prev)}
              className={`min-h-10 px-2.5 py-1 rounded-2xl font-extrabold text-xs border-2 ${
                autoMix
                  ? 'bg-emerald-600 text-white border-emerald-200'
                  : 'bg-zinc-100 text-zinc-700 border-zinc-300'
              }`}
            >
              🔄 {autoMix ? 'تلقائي' : 'ثابت'}
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-10 px-2.5 py-1 rounded-2xl bg-amber-100 hover:bg-amber-200 text-pink-900 font-extrabold text-xs border border-amber-300"
            >
              🎵 ملف
            </button>
          </div>

          {/* Secret Adult Gesture Legend (`✌️`, `👍👌`, `🖐️`, `✊`) */}
          <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-amber-200">
            <span className="text-xs font-extrabold text-pink-800">
              ✨ إشارات الأهل السرية من خلف لولاتي:
            </span>
            {ADULT_GESTURE_GUIDE.map((g) => (
              <button
                key={g.type}
                type="button"
                onClick={() => {
                  lolyAudio.unlockOnFirstGesture();
                  triggerAdultSurpriseOnStage(g.type);
                }}
                className="min-h-9 px-2.5 py-1 rounded-xl bg-amber-50 hover:bg-amber-200 active:scale-95 border border-amber-300 flex items-center gap-1.5 text-xs font-extrabold text-amber-950"
              >
                <span className="text-base">{g.icon}</span>
                <span>{g.label}</span>
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
