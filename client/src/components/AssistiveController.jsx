import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { socket, SERVER_URL } from '../socket';
import AiAgentTab from './AiAgentTab';
import TouchpadTab from './TouchpadTab';
import RemoteTab from './RemoteTab';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Landmark index 1 is canonical Nose Tip in MediaPipe Face Mesh
const NOSE_TIP_INDEX = 1;
const THROTTLE_MS = 50; // Strict 50ms throttling (20 Hz) for mouse move
const CLICK_COOLDOWN_MS = 600; // 600ms cooldown for clicks
const SCROLL_THROTTLE_MS = 80; // 80ms throttle for scroll events
const SCROLL_DEADZONE = 0.005; // Vertical deadzone for head tilt scroll

export default function AssistiveController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'ai';
  const [activeTab, setActiveTab] = useState(initialTab);

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

  // Refs for tracking loop (avoids stale closures)
  const lastEmitTimeRef = useRef(0);
  const lastClickTimeRef = useRef(0);
  const lastScrollTimeRef = useRef(0);
  const lastScrollNoseYRef = useRef(null);
  const isScrollModeRef = useRef(false);
  const prevGestureStatusRef = useRef('Standby');
  const clickFeedbackUntilRef = useRef(0);
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

      if (video && landmarker && video.readyState >= 2) {
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          const timestamp = performance.now();
          const result = landmarker.detectForVideo(video, timestamp);

          if (result && result.faceLandmarks && result.faceLandmarks.length > 0) {
            setFaceDetected(true);
            const landmarks = result.faceLandmarks[0];
            const noseTip = landmarks[NOSE_TIP_INDEX];

            // Mirrored camera feed: flip X so moving head right moves cursor right
            const rawX = 1 - noseTip.x;
            const rawY = noseTip.y;
            latestRawNoseRef.current = { x: rawX, y: rawY };

            // 1. Deadzone & Ergonomics Box Mapping
            const halfZone = 0.5 / sensitivityRef.current;
            const boxMinX = centerPosRef.current.x - halfZone;
            const boxMaxX = centerPosRef.current.x + halfZone;
            const boxMinY = centerPosRef.current.y - halfZone;
            const boxMaxY = centerPosRef.current.y + halfZone;

            const mappedX = (rawX - boxMinX) / (boxMaxX - boxMinX);
            const mappedY = (rawY - boxMinY) / (boxMaxY - boxMinY);
            const clampedX = Math.max(0, Math.min(1, mappedX));
            const clampedY = Math.max(0, Math.min(1, mappedY));

            // EMA Smoothing: 70% current, 30% previous
            const finalX = 0.7 * clampedX + 0.3 * smoothedPosRef.current.x;
            const finalY = 0.7 * clampedY + 0.3 * smoothedPosRef.current.y;

            // Extract blendshapes
            let browInnerUp = 0;
            let jawRight = 0;
            let jawLeft = 0;
            let jawOpen = 0;

            if (result.faceBlendshapes && result.faceBlendshapes.length > 0) {
              const categories = result.faceBlendshapes[0].categories;
              for (let i = 0; i < categories.length; i++) {
                const c = categories[i];
                if (c.categoryName === 'browInnerUp') browInnerUp = c.score;
                else if (c.categoryName === 'jawRight') jawRight = c.score;
                else if (c.categoryName === 'jawLeft') jawLeft = c.score;
                else if (c.categoryName === 'jawOpen') jawOpen = c.score;
              }
            }

            // Throttled UI Telemetry updates (10 Hz)
            if (timestamp - lastTelemetryUpdateRef.current >= 100) {
              lastTelemetryUpdateRef.current = timestamp;
              setRawCoords({ x: rawX, y: rawY });
              setBlendshapesData({ browInnerUp, jawRight, jawLeft, jawOpen });
            }

            // Canvas Visualization (Active Zone Box & Nose Crosshair)
            if (canvas) {
              const ctx = canvas.getContext('2d');
              const cw = canvas.width;
              const ch = canvas.height;
              ctx.clearRect(0, 0, cw, ch);

              // Active Control Box
              const boxPixelMinX = (1 - boxMaxX) * cw;
              const boxPixelMinY = boxMinY * ch;
              const boxPixelWidth = (boxMaxX - boxMinX) * cw;
              const boxPixelHeight = (boxMaxY - boxMinY) * ch;
              const boxCenterX = (1 - centerPosRef.current.x) * cw;
              const boxCenterY = centerPosRef.current.y * ch;

              ctx.strokeStyle = '#D97706';
              ctx.lineWidth = 2;
              ctx.setLineDash([8, 6]);
              ctx.strokeRect(boxPixelMinX, boxPixelMinY, boxPixelWidth, boxPixelHeight);
              ctx.setLineDash([]);

              // Center Point
              ctx.fillStyle = '#D97706';
              ctx.beginPath();
              ctx.arc(boxCenterX, boxCenterY, 5, 0, 2 * Math.PI);
              ctx.fill();

              // Nose Pointer Crosshair
              const nosePxX = (1 - rawX) * cw;
              const nosePxY = rawY * ch;

              ctx.strokeStyle = isTrackingRef.current ? '#22C55E' : '#D97706';
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.arc(nosePxX, nosePxY, 16, 0, 2 * Math.PI);
              ctx.stroke();

              ctx.fillStyle = isTrackingRef.current ? '#22C55E' : '#D97706';
              ctx.beginPath();
              ctx.arc(nosePxX, nosePxY, 4, 0, 2 * Math.PI);
              ctx.fill();
            }

            // 2. Gesture Evaluation & Freeze-on-Gesture Logic
            const maxJawSide = Math.max(jawRight, jawLeft);
            const isScrollMode = jawOpen > 0.45;
            const isFrozen = browInnerUp > 0.25 || maxJawSide > 0.25;

            let currentStatus = isTrackingRef.current ? 'Tracking Active' : 'Standby';

            // A. Trigger Click Gestures
            if (browInnerUp > 0.45 && timestamp - lastClickTimeRef.current >= CLICK_COOLDOWN_MS) {
              lastClickTimeRef.current = timestamp;
              clickFeedbackUntilRef.current = timestamp + 500;
              if (isTrackingRef.current) {
                socket.emit('mouse_click', { button: 'left' });
              }
            } else if (
              maxJawSide > 0.40 &&
              timestamp - lastClickTimeRef.current >= CLICK_COOLDOWN_MS
            ) {
              lastClickTimeRef.current = timestamp;
              clickFeedbackUntilRef.current = timestamp + 500;
              if (isTrackingRef.current) {
                socket.emit('mouse_click', { button: 'right' });
              }
            }

            // B. Scroll Mode
            if (isScrollMode) {
              if (!isScrollModeRef.current || lastScrollNoseYRef.current === null) {
                lastScrollNoseYRef.current = rawY;
                isScrollModeRef.current = true;
              }

              const dy = rawY - lastScrollNoseYRef.current;
              if (timestamp - lastScrollTimeRef.current >= SCROLL_THROTTLE_MS) {
                if (dy < -SCROLL_DEADZONE) {
                  if (isTrackingRef.current) {
                    socket.emit('mouse_scroll', { direction: 'up', dy, amount: 2 });
                  }
                  lastScrollTimeRef.current = timestamp;
                  lastScrollNoseYRef.current = rawY;
                } else if (dy > SCROLL_DEADZONE) {
                  if (isTrackingRef.current) {
                    socket.emit('mouse_scroll', { direction: 'down', dy, amount: 2 });
                  }
                  lastScrollTimeRef.current = timestamp;
                  lastScrollNoseYRef.current = rawY;
                }
              }
              currentStatus = 'Scroll Mode';
            } else {
              isScrollModeRef.current = false;
              lastScrollNoseYRef.current = null;

              if (isFrozen) {
                currentStatus = 'Frozen';
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
                }
              }
            }

            if (timestamp < clickFeedbackUntilRef.current) {
              currentStatus = browInnerUp > 0.45 ? 'Left Click' : 'Right Click';
            }

            if (currentStatus !== prevGestureStatusRef.current) {
              prevGestureStatusRef.current = currentStatus;
              setGestureStatus(currentStatus);
            }
          } else {
            setFaceDetected(false);
            if (prevGestureStatusRef.current !== 'Standby') {
              prevGestureStatusRef.current = 'Standby';
              setGestureStatus('Standby');
            }
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

  const switchTab = (tabKey) => {
    setActiveTab(tabKey);
    setSearchParams({ tab: tabKey });
  };

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

  const tabsList = [
    { id: 'ai', label: '🤖 المساعد الذكي (AI Agent)' },
    { id: 'touchpad', label: '🖱️ التاتش باد (Touchpad)' },
    { id: 'remote', label: '📱 الريموت (Remote)' },
    { id: 'face', label: '👤 تتبع الوجه (Face)' },
  ];

  return (
    <main
      className="min-h-screen bg-zinc-950 text-zinc-50 p-4 sm:p-6 lg:p-8 flex flex-col gap-6 max-w-5xl mx-auto"
      aria-label="Assistive Technology & AI Agent Control Suite"
    >
      {/* Top Header & Connection Status */}
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
              منظومة التحكم المساعد والذكاء الاصطناعي
            </h1>
          </div>
          <p className="text-zinc-300 text-base sm:text-lg">
            تحكم متكامل بالذكاء الاصطناعي، تتبع الوجه، التاتش باد، والريموت — معتمد (WCAG AAA)
          </p>
        </div>

        {/* Server connection indicator */}
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

      {/* TOP NAVIGATION TABS (Clinical-Grade, WCAG AAA Large Targets >= 56px) */}
      <nav
        aria-label="Application Control Modes"
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-zinc-900 p-2 rounded-2xl border-2 border-zinc-700"
      >
        {tabsList.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => switchTab(tab.id)}
              className={`min-h-16 px-4 py-3 rounded-xl font-bold text-lg sm:text-xl flex items-center justify-center text-center transition-colors duration-150 border-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                isActive
                  ? 'bg-teal-600 text-white border-teal-300 shadow-none'
                  : 'bg-zinc-950 text-zinc-300 hover:text-white hover:bg-zinc-800 border-zinc-800'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* TAB 1: AI OS AGENT */}
      {activeTab === 'ai' && <AiAgentTab />}

      {/* TAB 2: TOUCHPAD */}
      {activeTab === 'touchpad' && <TouchpadTab />}

      {/* TAB 3: REMOTE */}
      {activeTab === 'remote' && <RemoteTab />}

      {/* TAB 4: FACE TRACKING (Keep DOM active to preserve camera stream) */}
      <div className={activeTab === 'face' ? 'flex flex-col gap-6' : 'hidden'}>
        {/* EMERGENCY SAFETY ACTION BUTTON */}
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
            {/* Recenter Button */}
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

            {/* Sensitivity Slider Control */}
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
                />

                <div className="flex justify-between text-sm font-mono text-zinc-400">
                  <span>1.0x (أوسع حركة)</span>
                  <span>2.5x (افتراضي متوازن)</span>
                  <span>5.0x (أدنى حركة)</span>
                </div>
              </div>
            </div>

            {/* Telemetry Panel */}
            <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-700 flex flex-col gap-4">
              <h2 className="text-xl font-bold text-zinc-50 border-b border-zinc-700 pb-2">
                مؤشرات الحركة النشطة / Live Telemetry
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800">
                  <span className="text-sm font-semibold text-zinc-300 block mb-1">
                    X (الأفقي)
                  </span>
                  <span className="font-mono text-2xl font-bold text-teal-400 block">
                    {(coords.x * 100).toFixed(1)}%
                  </span>
                </div>

                <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800">
                  <span className="text-sm font-semibold text-zinc-300 block mb-1">
                    Y (الرأسي)
                  </span>
                  <span className="font-mono text-2xl font-bold text-teal-400 block">
                    {(coords.y * 100).toFixed(1)}%
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 text-base text-zinc-300 pt-2 border-t border-zinc-800 font-mono text-sm">
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
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                aria-label="Mirrored Front Camera Feed"
              />

              <canvas
                ref={canvasRef}
                width={640}
                height={480}
                className="absolute inset-0 w-full h-full pointer-events-none z-10"
                aria-hidden="true"
              />

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
                </div>
              )}

              {/* Status Badges */}
              <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
                <div
                  className={`px-3.5 py-1.5 rounded-lg text-sm sm:text-base font-bold flex items-center gap-2 shadow-sm ${getBadgeStyle()}`}
                  role="status"
                  aria-live="polite"
                >
                  <span>{gestureStatus}</span>
                </div>

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
            </div>

            {/* Gesture Instructions Callout */}
            <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-300 text-base leading-relaxed space-y-2">
              <p className="font-bold text-zinc-50">
                💡 إرشادات التحكم بالإيماءات وتعبيرات الوجه:
              </p>
              <ul className="list-disc list-inside space-y-1.5 pr-2">
                <li>
                  <strong>Left Click (نقرة يسار):</strong> ارفع حاجبيك لأعلى (Brow Up) للضغط كليك يسار.
                </li>
                <li>
                  <strong>Right Click (نقرة يمين):</strong> حرّك فكك للجانب الأيمن أو الأيسر (Jaw Side) للضغط كليك يمين.
                </li>
                <li>
                  <strong>Scroll Mode (وضع التمرير):</strong> افتح فمك (Jaw Open) وحرّك رأسك لأعلى أو لأسفل للتمرير بدلاً من تحريك المؤشر.
                </li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
