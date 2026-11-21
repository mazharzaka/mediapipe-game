import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { socket, SERVER_URL } from '../socket';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Landmark index 1 is canonical Nose Tip in MediaPipe Face Mesh
const NOSE_TIP_INDEX = 1;
const THROTTLE_MS = 50; // Strict 50ms throttling (20 Hz) for mouse move
const SCROLL_THROTTLE_MS = 80; // 80ms throttle for scroll events
const SCROLL_DEADZONE = 0.005; // Vertical deadzone for head tilt scroll
const MAX_FREEZE_MS = 400; // Max freeze duration (400ms) to prevent mouse hang

export default function AssistiveController() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Safety & tracking state
  const [isTracking, setIsTracking] = useState(false);
  const isTrackingRef = useRef(false);

  // Vision model & connection state
  const [modelStatus, setModelStatus] = useState('Initializing camera & model...');
  const [isModelReady, setIsModelReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [socketConnected, setSocketConnected] = useState(socket.connected);

  // Active Zone & Ergonomics State
  const [sensitivity, setSensitivity] = useState(2.5);
  const sensitivityRef = useRef(2.5);

  const [centerPos, setCenterPos] = useState({ x: 0.5, y: 0.5 });
  const centerPosRef = useRef({ x: 0.5, y: 0.5 });

  // Latest raw mirrored nose position for recentering
  const latestRawNoseRef = useRef({ x: 0.5, y: 0.5 });

  // Smoothed coordinates via EMA (Exponential Moving Average)
  const smoothedPosRef = useRef({ x: 0.5, y: 0.5 });

  // Telemetry state for UI
  const [coords, setCoords] = useState({ x: 0.5, y: 0.5 });
  const [rawCoords, setRawCoords] = useState({ x: 0.5, y: 0.5 });
  const [packetsSent, setPacketsSent] = useState(0);
  const [recenterFeedback, setRecenterFeedback] = useState(false);

  // Blendshapes & Gesture state
  const [gestureStatus, setGestureStatus] = useState('Standby');
  const [blendshapesData, setBlendshapesData] = useState({
    browInnerUp: 0,
    jawRight: 0,
    jawLeft: 0,
    jawOpen: 0,
  });

  // Edge Trigger & Hysteresis State Refs
  const leftClickArmedRef = useRef(true);
  const rightClickArmedRef = useRef(true);

  // Freeze-on-Gesture timer
  const freezeStartTimeRef = useRef(0);

  // Scroll Mode tracking refs
  const lastScrollTimeRef = useRef(0);
  const lastScrollNoseYRef = useRef(null);
  const isScrollModeRef = useRef(false);

  // General loop tracking refs
  const lastEmitTimeRef = useRef(0);
  const prevGestureStatusRef = useRef('Standby');
  const clickFeedbackUntilRef = useRef(0);
  const lastClickTypeRef = useRef('Left Click');
  const lastTelemetryUpdateRef = useRef(0);

  // Synchronize state to refs for animation loop
  useEffect(() => {
    isTrackingRef.current = isTracking;
  }, [isTracking]);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    centerPosRef.current = centerPos;
  }, [centerPos]);

  // Socket connection tracking
  useEffect(() => {
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // MediaPipe FaceLandmarker and Camera initialization
  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let stream = null;
    let landmarker = null;
    let lastVideoTime = -1;

    const renderLoop = () => {
      if (cancelled) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (
        landmarker &&
        video &&
        video.readyState >= 2 &&
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;
        const timestamp = performance.now();
        const result = landmarker.detectForVideo(video, timestamp);
        const face = result.faceLandmarks?.[0];
        const blendshapes = result.faceBlendshapes?.[0]?.categories;

        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        }

        // 1. Extract Blendshape scores
        let browInnerUp = 0;
        let jawRight = 0;
        let jawLeft = 0;
        let jawOpen = 0;

        if (blendshapes) {
          for (let i = 0; i < blendshapes.length; i++) {
            const b = blendshapes[i];
            if (b.categoryName === 'browInnerUp') browInnerUp = b.score;
            else if (b.categoryName === 'jawRight') jawRight = b.score;
            else if (b.categoryName === 'jawLeft') jawLeft = b.score;
            else if (b.categoryName === 'jawOpen') jawOpen = b.score;
          }
        }

        // Throttle telemetry update to React UI (every 100ms) for high performance
        if (timestamp - lastTelemetryUpdateRef.current >= 100) {
          lastTelemetryUpdateRef.current = timestamp;
          setBlendshapesData({ browInnerUp, jawRight, jawLeft, jawOpen });
        }

        if (face && face[NOSE_TIP_INDEX]) {
          setFaceDetected(true);
          const rawNose = face[NOSE_TIP_INDEX];

          // Front camera is mirrored horizontally:
          const noseX = 1 - rawNose.x;
          const noseY = rawNose.y;

          latestRawNoseRef.current = { x: noseX, y: noseY };
          setRawCoords({ x: noseX, y: noseY });

          // Active Zone Mapping from centerPos
          const sens = sensitivityRef.current;
          const center = centerPosRef.current;
          const mappedX = 0.5 + (noseX - center.x) * sens;
          const mappedY = 0.5 + (noseY - center.y) * sens;

          const clampedMappedX = Math.max(0, Math.min(1, mappedX));
          const clampedMappedY = Math.max(0, Math.min(1, mappedY));

          // Simple Exponential Moving Average (EMA) smoothing
          const prev = smoothedPosRef.current;
          const smoothX = prev.x * 0.7 + clampedMappedX * 0.3;
          const smoothY = prev.y * 0.7 + clampedMappedY * 0.3;

          const finalX = Math.max(0, Math.min(1, smoothX));
          const finalY = Math.max(0, Math.min(1, smoothY));

          // Draw high-contrast utilitarian overlays on canvas
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const cw = canvas.width;
              const ch = canvas.height;

              // Active Zone Box
              const halfBoxW = (0.5 / sens) * cw;
              const halfBoxH = (0.5 / sens) * ch;
              const boxCenterX = center.x * cw;
              const boxCenterY = center.y * ch;

              ctx.strokeStyle = '#3F3F46'; // zinc-700
              ctx.lineWidth = 2;
              ctx.setLineDash([6, 6]);
              ctx.strokeRect(
                boxCenterX - halfBoxW,
                boxCenterY - halfBoxH,
                halfBoxW * 2,
                halfBoxH * 2
              );
              ctx.setLineDash([]);

              // Center Reference Point
              ctx.fillStyle = '#D97706'; // amber-600
              ctx.beginPath();
              ctx.arc(boxCenterX, boxCenterY, 5, 0, 2 * Math.PI);
              ctx.fill();

              // Nose Pointer Crosshair
              const nosePxX = noseX * cw;
              const nosePxY = noseY * ch;

              ctx.strokeStyle = isTrackingRef.current ? '#22C55E' : '#D97706';
              ctx.lineWidth = 3;

              ctx.beginPath();
              ctx.arc(nosePxX, nosePxY, 16, 0, 2 * Math.PI);
              ctx.stroke();

              ctx.fillStyle = isTrackingRef.current ? '#22C55E' : '#D97706';
              ctx.beginPath();
              ctx.arc(nosePxX, nosePxY, 4, 0, 2 * Math.PI);
              ctx.fill();

              ctx.beginPath();
              ctx.moveTo(nosePxX - 22, nosePxY);
              ctx.lineTo(nosePxX + 22, nosePxY);
              ctx.moveTo(nosePxX, nosePxY - 22);
              ctx.lineTo(nosePxX + 22, nosePxY);
              ctx.stroke();
            }
          }

          // 2. Gesture Evaluation with Mutual Exclusion, Edge Trigger & Max Freeze
          const maxJawSide = Math.max(jawRight, jawLeft);
          const isScrollMode = jawOpen > 0.45;
          let currentStatus = isTrackingRef.current ? 'Tracking Active' : 'Standby';

          // --- MUTUAL EXCLUSION: Scroll Mode takes precedence ---
          if (isScrollMode) {
            // When jawOpen > 0.45, clicks are completely disabled to avoid accidental triggers
            freezeStartTimeRef.current = 0; // Release any active freeze

            if (!isScrollModeRef.current || lastScrollNoseYRef.current === null) {
              lastScrollNoseYRef.current = noseY;
              isScrollModeRef.current = true;
            }

            const dy = noseY - lastScrollNoseYRef.current;
            if (timestamp - lastScrollTimeRef.current >= SCROLL_THROTTLE_MS) {
              if (dy < -SCROLL_DEADZONE) {
                // Head tilted upward -> Scroll Up
                console.log('[AssistiveController] Scroll UP, dy =', dy.toFixed(4));
                if (isTrackingRef.current) {
                  socket.emit('mouse_scroll', { direction: 'up', dy, amount: 150 });
                }
                lastScrollTimeRef.current = timestamp;
                lastScrollNoseYRef.current = noseY;
              } else if (dy > SCROLL_DEADZONE) {
                // Head tilted downward -> Scroll Down
                console.log('[AssistiveController] Scroll DOWN, dy =', dy.toFixed(4));
                if (isTrackingRef.current) {
                  socket.emit('mouse_scroll', { direction: 'down', dy, amount: 150 });
                }
                lastScrollTimeRef.current = timestamp;
                lastScrollNoseYRef.current = noseY;
              }
            }

            currentStatus = 'Scroll Mode';
          } else {
            // Not in scroll mode: reset scroll state
            isScrollModeRef.current = false;
            lastScrollNoseYRef.current = null;

            // --- HYSTERESIS & EDGE TRIGGER FOR CLICKS ---
            // 1. Re-arm triggers only after values drop below 0.20
            if (browInnerUp < 0.20) {
              leftClickArmedRef.current = true;
            }
            if (maxJawSide < 0.20) {
              rightClickArmedRef.current = true;
            }

            // 2. Fire single-shot edge trigger on threshold crossing
            if (leftClickArmedRef.current && browInnerUp > 0.50) {
              leftClickArmedRef.current = false; // Disarm until value falls below 0.20
              clickFeedbackUntilRef.current = timestamp + 500;
              lastClickTypeRef.current = 'Left Click';
              console.log('[AssistiveController] Triggered Left Click (browInnerUp > 0.50)');
              if (isTrackingRef.current) {
                socket.emit('mouse_click', { button: 'left' });
              }
            } else if (rightClickArmedRef.current && maxJawSide > 0.45) {
              rightClickArmedRef.current = false; // Disarm until value falls below 0.20
              clickFeedbackUntilRef.current = timestamp + 500;
              lastClickTypeRef.current = 'Right Click';
              console.log('[AssistiveController] Triggered Right Click (maxJawSide > 0.45)');
              if (isTrackingRef.current) {
                socket.emit('mouse_click', { button: 'right' });
              }
            }

            // --- FREEZE-ON-GESTURE WITH MAX TIMEOUT (400ms) ---
            const inGestureZone = browInnerUp > 0.25 || maxJawSide > 0.25;
            let isFrozen = false;

            if (inGestureZone) {
              if (freezeStartTimeRef.current === 0) {
                freezeStartTimeRef.current = timestamp;
              }
              const freezeElapsed = timestamp - freezeStartTimeRef.current;
              if (freezeElapsed <= MAX_FREEZE_MS) {
                isFrozen = true;
              } else {
                // Max freeze time exceeded -> auto unfreeze to prevent cursor hang
                isFrozen = false;
              }
            } else {
              // Reset freeze timer when gesture returns to rest
              freezeStartTimeRef.current = 0;
              isFrozen = false;
            }

            // --- MOUSE MOVEMENT DISPATCH ---
            if (isFrozen) {
              currentStatus = 'Frozen';
              // Cursor is anchored in place: do NOT emit movement to prevent drift
            } else {
              smoothedPosRef.current = { x: finalX, y: finalY };
              setCoords({ x: finalX, y: finalY });

              if (isTrackingRef.current) {
                currentStatus = 'Tracking Active';
                if (timestamp - lastEmitTimeRef.current >= THROTTLE_MS) {
                  lastEmitTimeRef.current = timestamp;
                  socket.emit('assistiveMove', { x: finalX, y: finalY });
                  setPacketsSent((prev) => prev + 1);
                }
              } else {
                currentStatus = 'Standby';
              }
            }
          }

          // Prioritize showing Click badge for 500ms after a click
          if (timestamp < clickFeedbackUntilRef.current) {
            currentStatus = lastClickTypeRef.current;
          }

          if (currentStatus !== prevGestureStatusRef.current) {
            prevGestureStatusRef.current = currentStatus;
            setGestureStatus(currentStatus);
          }
        } else {
          setFaceDetected(false);
          freezeStartTimeRef.current = 0;
          if (prevGestureStatusRef.current !== 'Standby') {
            prevGestureStatusRef.current = 'Standby';
            setGestureStatus('Standby');
          }
        }
      }

      rafId = requestAnimationFrame(renderLoop);
    };

    const videoEl = videoRef.current;
    (async () => {
      try {
        setModelStatus('Requesting camera access / جاري طلب إذن الكاميرا...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setModelStatus('Loading FaceLandmarker model / جاري تحميل نموذج التتبع...');
        const visionFileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const lm = await FaceLandmarker.createFromOptions(visionFileset, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: 'GPU',
          },
          outputFaceBlendshapes: true,
          runningMode: 'VIDEO',
          numFaces: 1,
        });

        if (cancelled) {
          lm.close();
          return;
        }

        landmarker = lm;
        setIsModelReady(true);
        setModelStatus('Ready. Keep your face in frame / جاهز. حافظ على وجهك داخل الإطار.');
        renderLoop();
      } catch (err) {
        console.error('Assistive setup error:', err);
        if (!cancelled) {
          setModelStatus(`Error: ${err.message || 'Could not initialize camera/model'}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (videoEl) {
        videoEl.srcObject = null;
      }
      landmarker?.close();
    };
  }, []);

  const toggleTracking = useCallback(() => {
    setIsTracking((prev) => !prev);
  }, []);

  // Recenter: Save current nose coordinates as new centerPos
  const handleRecenter = useCallback(() => {
    const current = latestRawNoseRef.current;
    setCenterPos({ x: current.x, y: current.y });
    smoothedPosRef.current = { x: 0.5, y: 0.5 };
    setRecenterFeedback(true);
    setTimeout(() => setRecenterFeedback(false), 1500);
  }, []);

  const changeSensitivity = (newVal) => {
    const clamped = Math.max(1.0, Math.min(5.0, Math.round(newVal * 2) / 2));
    setSensitivity(clamped);
  };

  // Helper for rendering high-contrast WCAG AAA Status Badge
  const getBadgeStyle = () => {
    switch (gestureStatus) {
      case 'Left Click':
        return 'bg-teal-600 border-2 border-teal-300 text-white';
      case 'Right Click':
        return 'bg-blue-600 border-2 border-blue-300 text-white';
      case 'Scroll Mode':
        return 'bg-purple-600 border-2 border-purple-300 text-white';
      case 'Frozen':
        return 'bg-amber-600 border-2 border-amber-300 text-white';
      case 'Tracking Active':
        return 'bg-green-600 border-2 border-green-300 text-white';
      default:
        return 'bg-zinc-800 border-2 border-zinc-600 text-zinc-300';
    }
  };

  const getBadgeIcon = () => {
    switch (gestureStatus) {
      case 'Left Click':
        return '👆';
      case 'Right Click':
        return '👉';
      case 'Scroll Mode':
        return '↕';
      case 'Frozen':
        return '❄';
      case 'Tracking Active':
        return '●';
      default:
        return '■';
    }
  };

  return (
    <main
      className="min-h-screen bg-zinc-950 text-zinc-50 p-4 sm:p-6 lg:p-8 flex flex-col gap-6 max-w-5xl mx-auto"
      aria-label="Assistive Technology Mouse Controller"
    >
      {/* Top Header & Server Status */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-zinc-700">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center justify-center min-h-14 min-w-14 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 font-bold text-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
              aria-label="Back to home page"
            >
              ← الرئيسية
            </Link>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-50">
              Assistive Head Controller
            </h1>
          </div>
          <p className="text-zinc-300 text-base sm:text-lg">
            تحكم مريح بماوس الويندوز بحركة الأنف وتعبيرات الوجه — تقنية مساعدة معتمدة (WCAG AAA)
          </p>
        </div>

        {/* Server connection indicator (Icon + Color + Text) */}
        <div
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-700"
          role="status"
          aria-live="polite"
        >
          <span
            className={`inline-block w-3.5 h-3.5 rounded-full ${
              socketConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
            aria-hidden="true"
          />
          <span className="text-base font-semibold text-zinc-200">
            {socketConnected ? '[●] Server Connected' : '[■] Server Offline'}
          </span>
        </div>
      </header>

      {/* EMERGENCY SAFETY ACTION BUTTON (Largest, Most Accessible Target) */}
      <section aria-label="Safety Tracking Control">
        <button
          type="button"
          onClick={toggleTracking}
          disabled={!isModelReady}
          className={`w-full min-h-24 px-6 py-5 rounded-xl text-xl sm:text-2xl font-bold tracking-wide transition-colors duration-150 flex items-center justify-center gap-4 border-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-zinc-950 disabled:opacity-50 disabled:cursor-not-allowed ${
            isTracking
              ? 'bg-red-600 hover:bg-red-500 text-white border-red-300 shadow-none'
              : 'bg-teal-600 hover:bg-teal-500 text-white border-teal-300 shadow-none'
          }`}
          aria-pressed={isTracking}
          aria-label={
            isTracking
              ? 'Safety Emergency Stop: Stop Tracking Mouse'
              : 'Start Tracking: Begin Moving Mouse with Head'
          }
        >
          {isTracking ? (
            <>
              <span className="text-3xl" aria-hidden="true">
                ⏹
              </span>
              <span>EMERGENCY STOP / إيقاف الأمان الفوري (الماوس متصل)</span>
            </>
          ) : (
            <>
              <span className="text-3xl" aria-hidden="true">
                ▶
              </span>
              <span>START TRACKING / بدء تتبع الرأس وتحريك الماوس</span>
            </>
          )}
        </button>
      </section>

      {/* Main Grid: Ergonomics Controls & Telemetry + Camera Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Ergonomics, Sensitivity Slider, Recenter & Telemetry */}
        <section
          className="lg:col-span-5 flex flex-col gap-6"
          aria-label="Head Ergonomics and Telemetry"
        >
          {/* Recenter / ضبط المركز Button (Large, Highly Accessible) */}
          <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-700 flex flex-col gap-3">
            <h2 className="text-xl font-bold text-zinc-50 border-b border-zinc-700 pb-2">
              ضبط المركز والزاوية / Recenter
            </h2>
            <p className="text-base text-zinc-300 leading-relaxed">
              ثبّت رأسك في الوضعية الأكثر راحة لك، ثم اضغط على الزر ليصبح موضع أنفك الحالي هو منتصف الشاشة.
            </p>

            <button
              type="button"
              onClick={handleRecenter}
              className={`w-full min-h-16 px-6 py-4 rounded-xl font-bold text-xl flex items-center justify-center gap-3 border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                recenterFeedback
                  ? 'bg-green-600 text-white border-green-300'
                  : 'bg-amber-600 hover:bg-amber-500 text-white border-amber-300'
              }`}
              aria-label="Recenter current nose position as screen center"
            >
              <span className="text-2xl" aria-hidden="true">
                🎯
              </span>
              <span>
                {recenterFeedback
                  ? 'تم ضبط المركز بنجاح! / Recentered'
                  : 'Recenter / ضبط المركز'}
              </span>
            </button>
          </div>

          {/* Sensitivity Slider Control (1.0 to 5.0 in steps of 0.5) */}
          <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-700 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-zinc-700 pb-2">
              <label
                htmlFor="sensitivity-slider"
                className="text-xl font-bold text-zinc-50"
              >
                التحكم في الحساسية / Sensitivity
              </label>
              <span className="font-mono text-2xl font-bold text-teal-400 px-3 py-1 rounded bg-zinc-950 border border-zinc-800">
                {sensitivity.toFixed(1)}x
              </span>
            </div>

            <p className="text-base text-zinc-300">
              كلما زادت الحساسية، احتجت لحركة رأس أصغر للوصول لأطراف الشاشة.
            </p>

            <div className="flex flex-col gap-3">
              <input
                id="sensitivity-slider"
                type="range"
                min="1.0"
                max="5.0"
                step="0.5"
                value={sensitivity}
                onChange={(e) => changeSensitivity(parseFloat(e.target.value))}
                className="w-full h-4 bg-zinc-950 border border-zinc-700 rounded-lg cursor-pointer accent-teal-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                aria-valuemin={1.0}
                aria-valuemax={5.0}
                aria-valuenow={sensitivity}
                aria-valuetext={`${sensitivity.toFixed(1)} times sensitivity`}
              />

              <div className="flex justify-between text-sm font-mono text-zinc-400">
                <span>1.0x (أوسع حركة)</span>
                <span>2.5x (افتراضي متوازن)</span>
                <span>5.0x (أدنى حركة)</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => changeSensitivity(sensitivity - 0.5)}
                disabled={sensitivity <= 1.0}
                className="min-h-14 px-4 py-2 rounded-lg bg-zinc-950 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-lg text-zinc-100 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
                aria-label="Decrease sensitivity by 0.5"
              >
                <span className="text-2xl" aria-hidden="true">
                  −
                </span>
                <span>تقليل الحساسية (-0.5)</span>
              </button>

              <button
                type="button"
                onClick={() => changeSensitivity(sensitivity + 0.5)}
                disabled={sensitivity >= 5.0}
                className="min-h-14 px-4 py-2 rounded-lg bg-zinc-950 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-lg text-zinc-100 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
                aria-label="Increase sensitivity by 0.5"
              >
                <span className="text-2xl" aria-hidden="true">
                  +
                </span>
                <span>زيادة الحساسية (+0.5)</span>
              </button>
            </div>
          </div>

          {/* Telemetry & State Panel (Monospace WCAG AAA) */}
          <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-700 flex flex-col gap-4">
            <h2 className="text-xl font-bold text-zinc-50 border-b border-zinc-700 pb-2">
              مؤشرات الحركة النشطة / Live Telemetry
            </h2>

            {/* Output Coordinates (Smoothed & Clamped) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800">
                <span className="text-sm font-semibold text-zinc-300 block mb-1">
                  X (إحداثي الشاشة الأفقي)
                </span>
                <span className="font-mono text-2xl font-bold text-teal-400 block">
                  {(coords.x * 100).toFixed(1)}%
                </span>
                <span className="font-mono text-xs text-zinc-400 block mt-1">
                  Val: {coords.x.toFixed(4)}
                </span>
              </div>

              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800">
                <span className="text-sm font-semibold text-zinc-300 block mb-1">
                  Y (إحداثي الشاشة الرأسي)
                </span>
                <span className="font-mono text-2xl font-bold text-teal-400 block">
                  {(coords.y * 100).toFixed(1)}%
                </span>
                <span className="font-mono text-xs text-zinc-400 block mt-1">
                  Val: {coords.y.toFixed(4)}
                </span>
              </div>
            </div>

            {/* Face Expressions Live Blendshapes */}
            <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-col gap-2 font-mono text-xs">
              <span className="text-sm font-bold text-zinc-200 block mb-1">
                تعبيرات الوجه النشطة / Live Blendshapes:
              </span>
              <div className="flex justify-between items-center">
                <span>Brow Up (Left Click &gt;0.50, reset &lt;0.20):</span>
                <span
                  className={`font-bold ${
                    blendshapesData.browInnerUp > 0.50
                      ? 'text-teal-400'
                      : blendshapesData.browInnerUp > 0.25
                      ? 'text-amber-400'
                      : 'text-zinc-400'
                  }`}
                >
                  {(blendshapesData.browInnerUp * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Jaw Side (Right Click &gt;0.45, reset &lt;0.20):</span>
                <span
                  className={`font-bold ${
                    Math.max(blendshapesData.jawRight, blendshapesData.jawLeft) > 0.45
                      ? 'text-blue-400'
                      : Math.max(blendshapesData.jawRight, blendshapesData.jawLeft) > 0.25
                      ? 'text-amber-400'
                      : 'text-zinc-400'
                  }`}
                >
                  {(Math.max(blendshapesData.jawRight, blendshapesData.jawLeft) * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Jaw Open (Scroll Mode &gt;0.45):</span>
                <span
                  className={`font-bold ${
                    blendshapesData.jawOpen > 0.45 ? 'text-purple-400' : 'text-zinc-400'
                  }`}
                >
                  {(blendshapesData.jawOpen * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            {/* Smoothing and Throttle Details */}
            <div className="flex flex-col gap-1.5 text-base text-zinc-300 pt-2 border-t border-zinc-800 font-mono text-sm">
              <div className="flex justify-between">
                <span>Filter:</span>
                <span className="text-zinc-100 font-bold">EMA Smoothing (70% / 30%)</span>
              </div>
              <div className="flex justify-between">
                <span>Freeze Limit:</span>
                <span className="text-zinc-100 font-bold">Max 400 ms (Auto-Unfreeze)</span>
              </div>
              <div className="flex justify-between">
                <span>Active Center:</span>
                <span className="text-amber-400 font-bold">
                  {`X:${(centerPos.x * 100).toFixed(0)}% Y:${(centerPos.y * 100).toFixed(0)}%`}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Raw Nose:</span>
                <span className="text-zinc-300">
                  {`X:${(rawCoords.x * 100).toFixed(0)}% Y:${(rawCoords.y * 100).toFixed(0)}%`}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Throttle Rate:</span>
                <span className="text-zinc-100 font-bold">50 ms (20 Hz)</span>
              </div>
              <div className="flex justify-between">
                <span>Packets Sent:</span>
                <span className="text-zinc-100 font-bold">{packetsSent}</span>
              </div>
              <div className="flex justify-between">
                <span>Server Endpoint:</span>
                <span className="text-zinc-400 text-xs truncate max-w-[200px]" title={SERVER_URL}>
                  {SERVER_URL}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Right Column: Mirrored Video Camera Feed with Active Zone Box */}
        <section
          className="lg:col-span-7 flex flex-col gap-4"
          aria-label="Camera Live Feed"
        >
          <div className="relative w-full aspect-4/3 bg-black rounded-xl border-2 border-zinc-700 overflow-hidden flex items-center justify-center">
            {/* Mirrored video element */}
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
              aria-label="Mirrored Front Camera Feed"
            />

            {/* Overlays: Active Zone Box, Center Target, and Crosshair */}
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
              aria-hidden="true"
            />

            {/* Model status overlay during loading */}
            {!isModelReady && (
              <div
                className="absolute inset-0 bg-zinc-950/90 flex flex-col items-center justify-center p-6 text-center z-20"
                role="status"
              >
                <div
                  className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mb-4"
                  aria-hidden="true"
                />
                <p className="text-xl font-bold text-zinc-50">{modelStatus}</p>
                <p className="text-base text-zinc-300 mt-2">
                  يرجى السماح بصلاحية الكاميرا لتمكين التتبع
                </p>
              </div>
            )}

            {/* TOP BAR BADGES: Gesture Status Badge & Face Locked Badge */}
            <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
              {/* Dynamic Gesture / Status Badge */}
              <div
                className={`px-3.5 py-1.5 rounded-lg text-sm sm:text-base font-bold flex items-center gap-2 shadow-sm ${getBadgeStyle()}`}
                role="status"
                aria-live="polite"
              >
                <span aria-hidden="true" className="text-base">
                  {getBadgeIcon()}
                </span>
                <span>{gestureStatus}</span>
              </div>

              {/* Face Locked Status Badge */}
              <div
                className={`px-3 py-1.5 rounded-lg border text-sm font-bold flex items-center gap-2 ${
                  faceDetected
                    ? 'bg-zinc-900/90 border-green-500 text-green-400'
                    : 'bg-zinc-900/90 border-amber-500 text-amber-300'
                }`}
              >
                <span aria-hidden="true">{faceDetected ? '●' : '■'}</span>
                <span>{faceDetected ? 'Face Locked' : 'Searching Face'}</span>
              </div>
            </div>

            {/* Badges on bottom of video container */}
            <div className="absolute bottom-3 left-3 z-20 flex gap-2">
              <span className="px-3 py-1.5 rounded-md bg-zinc-900/90 border border-zinc-700 text-zinc-200 text-sm font-semibold">
                مرآة الكاميرا الأمامية
              </span>
              <span className="px-3 py-1.5 rounded-md bg-zinc-900/90 border border-zinc-700 text-amber-300 text-sm font-semibold">
                المستطيل المنقط = نطاق التحكم النشط
              </span>
            </div>
          </div>

          {/* Utilitarian Instructions Callout (Face Gestures) */}
          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-300 text-base leading-relaxed space-y-2">
            <p className="font-bold text-zinc-50">
              💡 إرشادات التحكم بالإيماءات وتعبيرات الوجه:
            </p>
            <ul className="list-disc list-inside space-y-1.5 pr-2">
              <li>
                <strong>Left Click (نقرة يسار):</strong> ارفع حاجبيك لأعلى (&gt; 50%) لإرسال نقرة واحدة؛ وأنزل حاجبيك (&lt; 20%) لتجهيز النقرة التالية (Hysteresis).
              </li>
              <li>
                <strong>Right Click (نقرة يمين):</strong> حرّك فكك للجانب (&gt; 45%) لإرسال نقرة يمين؛ وأعده للمنتصف (&lt; 20%) لتجهيز النقرة التالية.
              </li>
              <li>
                <strong>Scroll Mode (وضع التمرير):</strong> افتح فمك (&gt; 45%) وحرّك رأسك لأعلى أو لأسفل للتمرير. تُعطّل النقرات تلقائياً أثناء فتح الفم لمنع أي ضغط بالخطأ.
              </li>
              <li>
                <strong>Freeze-on-Gesture (تثبيت المؤشر الذكي):</strong> يتجمد المؤشر لحظة الإيماءة بحد أقصى 400ms لتثبيت الموضع، ثم يفك التجميد تلقائياً حتى لا يعلق الماوس.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
