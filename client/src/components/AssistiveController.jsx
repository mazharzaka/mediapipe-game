import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";
import { socket, SERVER_URL } from "../socket";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Landmark index 1 is canonical Nose Tip in MediaPipe Face Mesh
const NOSE_TIP_INDEX = 1;
const THROTTLE_MS = 20; // Fast 20ms throttling (50 Hz) for smooth real-time control
const DEAD_ZONE = 0.004; // Micro-jitter prevention threshold

export default function AssistiveController() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Safety & tracking state
  const [isTracking, setIsTracking] = useState(false);
  const isTrackingRef = useRef(false);

  // Vision model & connection state
  const [modelStatus, setModelStatus] = useState(
    "Initializing camera & model...",
  );
  const [isModelReady, setIsModelReady] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [socketConnected, setSocketConnected] = useState(socket.connected);

  // Non-linear precision curve mode (Enabled by default)
  const [precisionMode, setPrecisionMode] = useState(true);
  const precisionModeRef = useRef(true);

  // Ergonomics: Independent X and Y sensitivities
  const [sensitivityX, setSensitivityX] = useState(1.8);
  const sensitivityXRef = useRef(1.8);

  const [sensitivityY, setSensitivityY] = useState(3.5);
  const sensitivityYRef = useRef(3.5);

  // Smoothing factor for EMA filter: smooth = prev * smoothing + current * (1 - smoothing)
  // Default changed to 0.65 (65%) to eliminate lag and swimming sensation
  const [smoothing, setSmoothing] = useState(0.65);
  const smoothingRef = useRef(0.65);

  // Ergonomics: Center calibration point
  const [centerPos, setCenterPos] = useState({ x: 0.5, y: 0.5 });
  const centerPosRef = useRef({ x: 0.5, y: 0.5 });

  // Recenter countdown & audio feedback state
  const [countdown, setCountdown] = useState(null);
  const [recenterFeedback, setRecenterFeedback] = useState(false);
  const countdownTimerRef = useRef(null);

  // Latest raw mirrored nose position for recentering
  const latestRawNoseRef = useRef({ x: 0.5, y: 0.5 });

  // Smoothed coordinates via EMA
  const smoothedPosRef = useRef({ x: 0.5, y: 0.5 });

  // Telemetry state for UI
  const [coords, setCoords] = useState({ x: 0.5, y: 0.5 });
  const [rawCoords, setRawCoords] = useState({ x: 0.5, y: 0.5 });
  const [packetsSent, setPacketsSent] = useState(0);

  // Synchronize state to refs for animation loop
  useEffect(() => {
    isTrackingRef.current = isTracking;
  }, [isTracking]);

  useEffect(() => {
    precisionModeRef.current = precisionMode;
  }, [precisionMode]);

  useEffect(() => {
    sensitivityXRef.current = sensitivityX;
  }, [sensitivityX]);

  useEffect(() => {
    sensitivityYRef.current = sensitivityY;
  }, [sensitivityY]);

  useEffect(() => {
    smoothingRef.current = smoothing;
  }, [smoothing]);

  useEffect(() => {
    centerPosRef.current = centerPos;
  }, [centerPos]);

  // Audio tone synthesis via Web Audio API (Clinical acoustic feedback)
  const playAudioTone = useCallback(
    (freq = 440, duration = 0.08, type = "sine") => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          ctx.currentTime + duration,
        );

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);

        setTimeout(
          () => {
            ctx.close();
          },
          (duration + 0.1) * 1000,
        );
      } catch {
        // Audio autoplay policy fallback
      }
    },
    [],
  );

  const playChimeTone = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.14); // A5

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);

      setTimeout(() => {
        ctx.close();
      }, 450);
    } catch {
      // Audio fallback
    }
  }, []);

  // 3-Second Recenter Countdown with audio feedback
  const handleStartRecenterCountdown = useCallback(() => {
    if (countdown !== null) return; // Prevent multiple clicks during countdown

    setRecenterFeedback(false);
    setCountdown(3);
    playAudioTone(440, 0.07); // Tick 3

    let step = 3;
    const intervalId = setInterval(() => {
      step -= 1;
      if (step > 0) {
        setCountdown(step);
        playAudioTone(step === 2 ? 494 : 587, 0.07); // Tick 2 & 1
      } else {
        clearInterval(intervalId);
        countdownTimerRef.current = null;
        setCountdown(null);

        // Calibrate: Save current nose coordinate as screen center
        const current = latestRawNoseRef.current;
        setCenterPos({ x: current.x, y: current.y });
        smoothedPosRef.current = { x: 0.5, y: 0.5 };

        // Sound completion chime
        playChimeTone();

        setRecenterFeedback(true);
        setTimeout(() => setRecenterFeedback(false), 2000);
      }
    }, 1000);

    countdownTimerRef.current = intervalId;
  }, [countdown, playAudioTone, playChimeTone]);

  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  // Socket connection tracking
  useEffect(() => {
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
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
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
        }

        if (face && face[NOSE_TIP_INDEX]) {
          setFaceDetected(true);
          const rawNose = face[NOSE_TIP_INDEX];

          // Front camera mirrored horizontally:
          const noseX = 1 - rawNose.x;
          const noseY = rawNose.y;

          latestRawNoseRef.current = { x: noseX, y: noseY };
          setRawCoords({ x: noseX, y: noseY });

          // 1. Calculate delta from center
          const sensX = sensitivityXRef.current;
          const sensY = sensitivityYRef.current;
          const smoothFactor = smoothingRef.current;
          const center = centerPosRef.current;
          const usePrecision = precisionModeRef.current;

          const dx = noseX - center.x;
          const dy = noseY - center.y;

          let mappedX;
          let mappedY;

          if (usePrecision) {
            // Non-linear precision curve: Power of 1.35 on normalized displacement
            // Small movements around center are slow and delicate for targeting small buttons;
            // Larger movements accelerate smoothly to cover screen extremities.
            const maxDx = 0.5 / sensX;
            const normX = dx / maxDx;
            const curvedNormX =
              Math.sign(normX) * Math.pow(Math.abs(normX), 1.35);
            mappedX = 0.5 + curvedNormX * 0.5;

            const maxDy = 0.5 / sensY;
            const normDy = dy / maxDy;
            const curvedNormDy =
              Math.sign(normDy) * Math.pow(Math.abs(normDy), 1.35);
            mappedY = 0.5 + curvedNormDy * 0.5;
          } else {
            // Standard linear mapping
            mappedX = 0.5 + dx * sensX;
            mappedY = 0.5 + dy * sensY;
          }

          // 2. Clamp between 0 and 1
          const clampedMappedX = Math.max(0, Math.min(1, mappedX));
          const clampedMappedY = Math.max(0, Math.min(1, mappedY));

          // 3. Dead Zone check (0.004) and EMA Smoothing filter
          const prev = smoothedPosRef.current;
          const deltaX = Math.abs(clampedMappedX - prev.x);
          const deltaY = Math.abs(clampedMappedY - prev.y);

          let finalX = prev.x;
          let finalY = prev.y;

          if (deltaX >= DEAD_ZONE || deltaY >= DEAD_ZONE) {
            // Formula: smooth = prev * smoothing + current * (1 - smoothing)
            const smoothX =
              prev.x * smoothFactor + clampedMappedX * (1 - smoothFactor);
            const smoothY =
              prev.y * smoothFactor + clampedMappedY * (1 - smoothFactor);

            finalX = Math.max(0, Math.min(1, smoothX));
            finalY = Math.max(0, Math.min(1, smoothY));

            smoothedPosRef.current = { x: finalX, y: finalY };
            setCoords({ x: finalX, y: finalY });
          }

          // 4. Draw high-contrast utilitarian overlays on canvas
          if (canvas) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
              const cw = canvas.width;
              const ch = canvas.height;

              // A. Draw Active Zone Box (independent width and height)
              const halfBoxW = (0.5 / sensX) * cw;
              const halfBoxH = (0.5 / sensY) * ch;
              const boxCenterX = center.x * cw;
              const boxCenterY = center.y * ch;

              ctx.strokeStyle = "#3F3F46"; // zinc-700
              ctx.lineWidth = 2;
              ctx.setLineDash([6, 6]);
              ctx.strokeRect(
                boxCenterX - halfBoxW,
                boxCenterY - halfBoxH,
                halfBoxW * 2,
                halfBoxH * 2,
              );
              ctx.setLineDash([]);

              // B. Draw Center Reference Point
              ctx.fillStyle = "#D97706"; // amber-600
              ctx.beginPath();
              ctx.arc(boxCenterX, boxCenterY, 5, 0, 2 * Math.PI);
              ctx.fill();

              // C. Draw Current Nose Pointer Crosshair
              const nosePxX = noseX * cw;
              const nosePxY = noseY * ch;

              ctx.strokeStyle = isTrackingRef.current ? "#22C55E" : "#D97706";
              ctx.lineWidth = 3;

              // Outer Ring
              ctx.beginPath();
              ctx.arc(nosePxX, nosePxY, 16, 0, 2 * Math.PI);
              ctx.stroke();

              // Center Dot
              ctx.fillStyle = isTrackingRef.current ? "#22C55E" : "#D97706";
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

          // 5. High-Frequency Throttle: 20ms (50 Hz) for smooth cursor gliding
          if (isTrackingRef.current) {
            const now = performance.now();
            if (now - lastEmitTime >= THROTTLE_MS) {
              lastEmitTime = now;
              socket.emit("assistiveMove", { x: finalX, y: finalY });
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
        setModelStatus("Requesting camera access / جاري طلب إذن الكاميرا...");
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
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

        setModelStatus(
          "Loading FaceLandmarker model / جاري تحميل نموذج التتبع...",
        );
        const visionFileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const lm = await FaceLandmarker.createFromOptions(visionFileset, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
        });

        if (cancelled) {
          lm.close();
          return;
        }

        landmarker = lm;
        setIsModelReady(true);
        setModelStatus(
          "Ready. Keep your face in frame / جاهز. حافظ على وجهك داخل الإطار.",
        );
        renderLoop();
      } catch (err) {
        console.error("Assistive setup error:", err);
        if (!cancelled) {
          setModelStatus(
            `Error: ${err.message || "Could not initialize camera/model"}`,
          );
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

  const changeSensitivityX = (newVal) => {
    const clamped = Math.max(0.5, Math.min(5.0, Math.round(newVal * 10) / 10));
    setSensitivityX(clamped);
  };

  const changeSensitivityY = (newVal) => {
    const clamped = Math.max(0.5, Math.min(6.0, Math.round(newVal * 10) / 10));
    setSensitivityY(clamped);
  };

  const changeSmoothing = (newVal) => {
    const clamped = Math.max(
      0.5,
      Math.min(0.92, Math.round(newVal * 100) / 100),
    );
    setSmoothing(clamped);
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
            تحكم مريح بماوس الويندوز بحركة الأنف — تقنية مساعدة معتمدة (WCAG
            AAA)
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
              socketConnected ? "bg-green-500" : "bg-red-500"
            }`}
            aria-hidden="true"
          />
          <span className="text-base font-semibold text-zinc-200">
            {socketConnected ? "[●] Server Connected" : "[■] Server Offline"}
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
              ? "bg-red-600 hover:bg-red-500 text-white border-red-300 shadow-none"
              : "bg-teal-600 hover:bg-teal-500 text-white border-teal-300 shadow-none"
          }`}
          aria-pressed={isTracking}
          aria-label={
            isTracking
              ? "Safety Emergency Stop: Stop Tracking Mouse"
              : "Start Tracking: Begin Moving Mouse with Head"
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
        {/* Left Column: Ergonomics, Precision Toggle, Sensitivities, Recenter & Telemetry */}
        <section
          className="lg:col-span-5 flex flex-col gap-6"
          aria-label="Head Ergonomics and Telemetry"
        >
          {/* Recenter / ضبط المركز Button with 3-Second Countdown & Sound */}
          <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-700 flex flex-col gap-3">
            <h2 className="text-xl font-bold text-zinc-50 border-b border-zinc-700 pb-2">
              ضبط المركز والزاوية / Recenter
            </h2>
            <p className="text-base text-zinc-300 leading-relaxed">
              عند الضغط، يبدأ عد تنازلي 3 ثوانٍ مع صوت تنبيه خفيف لتتمكن من
              النظر لمنتصف شاشة اللابتوب بوضعية مريحة قبل التثبيت.
            </p>

            <button
              type="button"
              onClick={handleStartRecenterCountdown}
              disabled={countdown !== null}
              className={`w-full min-h-16 px-6 py-4 rounded-xl font-bold text-xl flex items-center justify-center gap-3 border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed ${
                recenterFeedback
                  ? "bg-green-600 text-white border-green-300"
                  : countdown !== null
                    ? "bg-amber-700 text-white border-amber-300"
                    : "bg-amber-600 hover:bg-amber-500 text-white border-amber-300"
              }`}
              aria-label={
                countdown !== null
                  ? `Recentering in ${countdown} seconds`
                  : "Start 3-second recenter countdown"
              }
              aria-live="assertive"
            >
              {countdown !== null ? (
                <>
                  <span className="text-2xl font-mono" aria-hidden="true">
                    ⏳
                  </span>
                  <span className="font-mono text-2xl font-bold">
                    {countdown}.. انظر لمنتصف شاشة اللابتوب
                  </span>
                </>
              ) : recenterFeedback ? (
                <>
                  <span className="text-2xl" aria-hidden="true">
                    ✓
                  </span>
                  <span>تم ضبط المركز بنجاح! / Recentered</span>
                </>
              ) : (
                <>
                  <span className="text-2xl" aria-hidden="true">
                    🎯
                  </span>
                  <span>Recenter / ضبط المركز (عد 3 ثوانٍ)</span>
                </>
              )}
            </button>
          </div>

          {/* NON-LINEAR PRECISION CURVE TOGGLE (High Contrast Accessible Switch) */}
          <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-700 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-zinc-700 pb-2">
              <span className="text-xl font-bold text-zinc-50">
                وضع الدقة / Precision Curve
              </span>
              <span
                className={`px-3 py-1 rounded text-sm font-bold font-mono border ${
                  precisionMode
                    ? "bg-teal-950 text-teal-300 border-teal-600"
                    : "bg-zinc-800 text-zinc-300 border-zinc-600"
                }`}
              >
                {precisionMode ? "[●] مفعّل (1.35x)" : "[○] معطّل (خطي)"}
              </span>
            </div>
            <p className="text-base text-zinc-300 leading-relaxed">
              منحنى تسارع غير خطي يجعل الحركة حول المركز دقيقة وبطيئة جداً
              لاصطياد الأزرار وعلامات التبويب الصغيرة (Tabs وزر X)، مع تسارع
              تلقائي عند أطراف الشاشة.
            </p>
            <button
              type="button"
              onClick={() => setPrecisionMode((prev) => !prev)}
              className={`w-full min-h-16 px-6 py-4 rounded-xl font-bold text-xl flex items-center justify-center gap-3 border-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                precisionMode
                  ? "bg-teal-600 hover:bg-teal-500 text-white border-teal-300"
                  : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-600"
              }`}
              aria-pressed={precisionMode}
              aria-label="Toggle non-linear precision curve mode"
            >
              <span className="text-2xl" aria-hidden="true">
                {precisionMode ? "🎯" : "📐"}
              </span>
              <span>
                {precisionMode
                  ? "وضع الدقة مفعّل (Non-linear 1.35x)"
                  : "وضع الدقة معطّل (حركة خطية مباشرة)"}
              </span>
            </button>
          </div>

          {/* Independent X & Y Sensitivity Controls */}
          <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-700 flex flex-col gap-5">
            <h2 className="text-xl font-bold text-zinc-50 border-b border-zinc-700 pb-2">
              الحساسية المستقلة للمحاور / Independent Sensitivity
            </h2>

            {/* X Sensitivity Slider */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="sensitivity-x-slider"
                  className="text-lg font-bold text-zinc-100"
                >
                  حساسية المحور الأفقي (X)
                </label>
                <span className="font-mono text-xl font-bold text-teal-400 px-3 py-0.5 rounded bg-zinc-950 border border-zinc-800">
                  {sensitivityX.toFixed(1)}x
                </span>
              </div>
              <p className="text-sm text-zinc-300">
                تحكم مريح لليسار واليمين (الافتراضي 1.8x).
              </p>
              <input
                id="sensitivity-x-slider"
                type="range"
                min="0.5"
                max="5.0"
                step="0.1"
                value={sensitivityX}
                onChange={(e) => changeSensitivityX(parseFloat(e.target.value))}
                className="w-full h-4 bg-zinc-950 border border-zinc-700 rounded-lg cursor-pointer accent-teal-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                aria-valuemin={0.5}
                aria-valuemax={5.0}
                aria-valuenow={sensitivityX}
                aria-valuetext={`Horizontal sensitivity ${sensitivityX.toFixed(1)}`}
              />
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => changeSensitivityX(sensitivityX - 0.2)}
                  disabled={sensitivityX <= 0.5}
                  className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 font-bold text-base text-zinc-100 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
                  aria-label="Decrease horizontal sensitivity X by 0.2"
                >
                  <span className="text-xl">−</span>
                  <span>تقليل X (-0.2)</span>
                </button>
                <button
                  type="button"
                  onClick={() => changeSensitivityX(sensitivityX + 0.2)}
                  disabled={sensitivityX >= 5.0}
                  className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 font-bold text-base text-zinc-100 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
                  aria-label="Increase horizontal sensitivity X by 0.2"
                >
                  <span className="text-xl">+</span>
                  <span>زيادة X (+0.2)</span>
                </button>
              </div>
            </div>

            {/* Y Sensitivity Slider */}
            <div className="flex flex-col gap-3 pt-4 border-t border-zinc-800">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="sensitivity-y-slider"
                  className="text-lg font-bold text-zinc-100"
                >
                  حساسية المحور الرأسي (Y)
                </label>
                <span className="font-mono text-xl font-bold text-amber-400 px-3 py-0.5 rounded bg-zinc-950 border border-zinc-800">
                  {sensitivityY.toFixed(1)}x
                </span>
              </div>
              <p className="text-sm text-zinc-300">
                حساسية أعلى للوصول لأعلى وأسفل الشاشة بسهولة بدون إجهاد الرقبة
                (الافتراضي 3.5x).
              </p>
              <input
                id="sensitivity-y-slider"
                type="range"
                min="0.5"
                max="6.0"
                step="0.1"
                value={sensitivityY}
                onChange={(e) => changeSensitivityY(parseFloat(e.target.value))}
                className="w-full h-4 bg-zinc-950 border border-zinc-700 rounded-lg cursor-pointer accent-amber-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                aria-valuemin={0.5}
                aria-valuemax={6.0}
                aria-valuenow={sensitivityY}
                aria-valuetext={`Vertical sensitivity ${sensitivityY.toFixed(1)}`}
              />
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => changeSensitivityY(sensitivityY - 0.2)}
                  disabled={sensitivityY <= 0.5}
                  className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 font-bold text-base text-zinc-100 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
                  aria-label="Decrease vertical sensitivity Y by 0.2"
                >
                  <span className="text-xl">−</span>
                  <span>تقليل Y (-0.2)</span>
                </button>
                <button
                  type="button"
                  onClick={() => changeSensitivityY(sensitivityY + 0.2)}
                  disabled={sensitivityY >= 6.0}
                  className="min-h-14 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 font-bold text-base text-zinc-100 flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 transition-colors duration-150"
                  aria-label="Increase vertical sensitivity Y by 0.2"
                >
                  <span className="text-xl">+</span>
                  <span>زيادة Y (+0.2)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Smoothing and Stability Control */}
          <div className="p-6 rounded-xl bg-zinc-900 border border-zinc-700 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-zinc-700 pb-2">
              <label
                htmlFor="smoothing-slider"
                className="text-lg font-bold text-zinc-100"
              >
                تنعيم الحركة (Smoothing EMA)
              </label>
              <span className="font-mono text-xl font-bold text-teal-400 px-3 py-0.5 rounded bg-zinc-950 border border-zinc-800">
                {(smoothing * 100).toFixed(0)}%
              </span>
            </div>

            <p className="text-sm text-zinc-300">
              النعومة. القيمة الافتراضية 65% توفر استجابة فورية بدون بطء أو
              عومان (المدى: 50% إلى 92%).
            </p>

            <input
              id="smoothing-slider"
              type="range"
              min="0.50"
              max="0.92"
              step="0.02"
              value={smoothing}
              onChange={(e) => changeSmoothing(parseFloat(e.target.value))}
              className="w-full h-4 bg-zinc-950 border border-zinc-700 rounded-lg cursor-pointer accent-teal-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              aria-valuemin={0.5}
              aria-valuemax={0.92}
              aria-valuenow={smoothing}
              aria-valuetext={`Smoothing factor ${(smoothing * 100).toFixed(0)} percent`}
            />

            <div className="flex justify-between text-xs font-mono text-zinc-400">
              <span>50% (فوري جداً)</span>
              <span>65% (افتراضي رشيق)</span>
              <span>92% (أقصى تنعيم)</span>
            </div>

            {/* Dead Zone Indicator Callout */}
            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between text-sm">
              <span className="text-zinc-300 font-semibold">
                منطقة الثبات (Dead Zone):
              </span>
              <span className="font-mono text-teal-400 font-bold">
                0.004 (فلترة الرعشة الخفيفة)
              </span>
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

            {/* Smoothing, Sensitivities, Throttle and Precision Details */}
            <div className="flex flex-col gap-1.5 text-base text-zinc-300 pt-2 border-t border-zinc-800 font-mono text-sm">
              <div className="flex justify-between">
                <span>Curve Mode:</span>
                <span
                  className={
                    precisionMode ? "text-teal-400 font-bold" : "text-zinc-400"
                  }
                >
                  {precisionMode
                    ? "Non-linear (Power 1.35)"
                    : "Linear (Standard)"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Filter:</span>
                <span className="text-zinc-100 font-bold">
                  EMA {(smoothing * 100).toFixed(0)}% /{" "}
                  {((1 - smoothing) * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span>Dead Zone:</span>
                <span className="text-zinc-100 font-bold">{DEAD_ZONE}</span>
              </div>
              <div className="flex justify-between">
                <span>Sens (X / Y):</span>
                <span className="text-teal-400 font-bold">
                  {`${sensitivityX.toFixed(1)}x / ${sensitivityY.toFixed(1)}x`}
                </span>
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
                <span className="text-teal-400 font-bold">20 ms (50 Hz)</span>
              </div>
              <div className="flex justify-between">
                <span>Packets Sent:</span>
                <span className="text-zinc-100 font-bold">{packetsSent}</span>
              </div>
              <div className="flex justify-between">
                <span>Server Endpoint:</span>
                <span
                  className="text-zinc-400 text-xs truncate max-w-[200px]"
                  title={SERVER_URL}
                >
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
                المستطيل = نطاق التحكم النشط
              </span>
            </div>

            {/* Detection status badge */}
            <div className="absolute top-3 right-3 z-20">
              <span
                className={`px-3 py-1.5 rounded-md border text-sm font-bold flex items-center gap-2 ${
                  faceDetected
                    ? "bg-zinc-900/90 border-green-500 text-green-400"
                    : "bg-zinc-900/90 border-amber-500 text-amber-300"
                }`}
              >
                <span aria-hidden="true">{faceDetected ? "●" : "■"}</span>
                <span>{faceDetected ? "Face Locked" : "Searching Face"}</span>
              </span>
            </div>
          </div>

          {/* Utilitarian Instructions Callout */}
          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-300 text-base leading-relaxed space-y-2">
            <p className="font-bold text-zinc-50">
              (Precision Mode):
            </p>
            <ul className="list-disc list-inside space-y-1.5 pr-2">
              <li>
                <strong>معدل 50 Hz (20ms):</strong> يرسل حركة الماوس 50 مرة في
                الثانية لضمان انسيابية تامة وسرعة استجابة بدون تقطيع.
              </li>
              <li>
                <strong>منحنى الدقة غير الخطي (1.35x):</strong> يجعل الحركات
                البسيطة حول المركز بطيئة جداً مما يتيح لك الوقوف بدقة وسهولة على
                علامات التبويب (Tabs)، والروابط، وزر الإغلاق (X).
              </li>
              <li>
                <strong>التنعيم الرشيق (EMA 65%):</strong> يقضي على إحساس
                التأخير (العومان) ويمنحك تحكماً فورياً ومباشراً ومستقراً.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
