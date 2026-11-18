import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { socket, SERVER_URL } from '../socket';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Landmark index 1 is canonical Nose Tip in MediaPipe Face Mesh
const NOSE_TIP_INDEX = 1;
const THROTTLE_MS = 50; // Strict 50ms throttling (20 Hz)

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

  // Active Zone & Ergonomics State (Defaults from user specs)
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
    let lastEmitTime = 0;

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

        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        }

        if (face && face[NOSE_TIP_INDEX]) {
          setFaceDetected(true);
          const rawNose = face[NOSE_TIP_INDEX];

          // Front camera is mirrored horizontally:
          // When user moves head to their physical right, raw X decreases,
          // so (1 - rawNose.x) correctly increases to the right.
          const noseX = 1 - rawNose.x;
          const noseY = rawNose.y;

          latestRawNoseRef.current = { x: noseX, y: noseY };
          setRawCoords({ x: noseX, y: noseY });

          // 1. Active Zone Mapping from centerPos
          const sens = sensitivityRef.current;
          const center = centerPosRef.current;
          const mappedX = 0.5 + (noseX - center.x) * sens;
          const mappedY = 0.5 + (noseY - center.y) * sens;

          // 2. Clamp between 0 and 1
          const clampedMappedX = Math.max(0, Math.min(1, mappedX));
          const clampedMappedY = Math.max(0, Math.min(1, mappedY));

          // 3. Simple Exponential Moving Average (EMA) smoothing:
          // smoothX = prevX * 0.7 + mappedX * 0.3
          const prev = smoothedPosRef.current;
          const smoothX = prev.x * 0.7 + clampedMappedX * 0.3;
          const smoothY = prev.y * 0.7 + clampedMappedY * 0.3;

          const finalX = Math.max(0, Math.min(1, smoothX));
          const finalY = Math.max(0, Math.min(1, smoothY));

          smoothedPosRef.current = { x: finalX, y: finalY };
          setCoords({ x: finalX, y: finalY });

          // 4. Draw high-contrast utilitarian overlays on canvas
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const cw = canvas.width;
              const ch = canvas.height;

              // A. Draw Active Zone Box (the physical area in camera space mapping to screen edges)
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

              // B. Draw Center Reference Point
              ctx.fillStyle = '#D97706'; // amber-600
              ctx.beginPath();
              ctx.arc(boxCenterX, boxCenterY, 5, 0, 2 * Math.PI);
              ctx.fill();

              // C. Draw Current Nose Pointer Crosshair
              const nosePxX = noseX * cw;
              const nosePxY = noseY * ch;

              ctx.strokeStyle = isTrackingRef.current ? '#22C55E' : '#D97706';
              ctx.lineWidth = 3;

              // Outer Ring
              ctx.beginPath();
              ctx.arc(nosePxX, nosePxY, 16, 0, 2 * Math.PI);
              ctx.stroke();

              // Center Dot
              ctx.fillStyle = isTrackingRef.current ? '#22C55E' : '#D97706';
              ctx.beginPath();
              ctx.arc(nosePxX, nosePxY, 4, 0, 2 * Math.PI);
              ctx.fill();

              // Crosshair tick marks
              ctx.beginPath();
              ctx.moveTo(nosePxX - 22, nosePxY);
              ctx.lineTo(nosePxX + 22, nosePxY);
              ctx.moveTo(nosePxX, nosePxY - 22);
              ctx.lineTo(nosePxX, nosePxY + 22);
              ctx.stroke();
            }
          }

          // 5. Strict Throttle: Send coordinates every 50ms ONLY when tracking is Active
          if (isTrackingRef.current) {
            const now = performance.now();
            if (now - lastEmitTime >= THROTTLE_MS) {
              lastEmitTime = now;
              socket.emit('assistiveMove', { x: finalX, y: finalY });
              setPacketsSent((prev) => prev + 1);
            }
          }
        } else {
          setFaceDetected(false);
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
            تحكم مريح بماوس الويندوز بحركة الأنف — تقنية مساعدة معتمدة (WCAG AAA)
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

            {/* Slider with Touch/Mouse controls */}
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

            {/* Accessible +/- Step Buttons for Limited Motor Control */}
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

            {/* Smoothing and Throttle Details */}
            <div className="flex flex-col gap-1.5 text-base text-zinc-300 pt-2 border-t border-zinc-800 font-mono text-sm">
              <div className="flex justify-between">
                <span>Filter:</span>
                <span className="text-zinc-100 font-bold">EMA Smoothing (70% / 30%)</span>
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

            {/* Badges on video container */}
            <div className="absolute bottom-3 left-3 z-20 flex gap-2">
              <span className="px-3 py-1.5 rounded-md bg-zinc-900/90 border border-zinc-700 text-zinc-200 text-sm font-semibold">
                مرآة الكاميرا الأمامية
              </span>
              <span className="px-3 py-1.5 rounded-md bg-zinc-900/90 border border-zinc-700 text-amber-300 text-sm font-semibold">
                المستطيل المنقط = نطاق التحكم النشط
              </span>
            </div>

            {/* Detection status badge */}
            <div className="absolute top-3 right-3 z-20">
              <span
                className={`px-3 py-1.5 rounded-md border text-sm font-bold flex items-center gap-2 ${
                  faceDetected
                    ? 'bg-zinc-900/90 border-green-500 text-green-400'
                    : 'bg-zinc-900/90 border-amber-500 text-amber-300'
                }`}
              >
                <span aria-hidden="true">{faceDetected ? '●' : '■'}</span>
                <span>{faceDetected ? 'Face Locked' : 'Searching Face'}</span>
              </span>
            </div>
          </div>

          {/* Utilitarian Instructions Callout */}
          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-300 text-base leading-relaxed space-y-2">
            <p className="font-bold text-zinc-50">
              💡 إرشادات الاستخدام المريح:
            </p>
            <ul className="list-disc list-inside space-y-1.5 pr-2">
              <li>
                اجلس في وضعية طبيعية واضغط على زر <strong>Recenter / ضبط المركز</strong> لحفظ الوضع المريح لنقطة الصفر.
              </li>
              <li>
                المستطيل المنقط داخل الكاميرا يوضح مدى حركة الأنف اللازمة لتغطية الشاشة كاملة؛ يمكنك تصغيره بزيادة الحساسية.
              </li>
              <li>
                تم تفعيل نظام التنعيم <strong>(EMA Smoothing)</strong> لامتصاص الرعشات الطفيفة وضمان استقرار مؤشر الماوس عند الضغط والتوجيه.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
