import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import confetti from 'canvas-confetti';
import { socket } from '../socket';

const FACE_R = 60;
const GLOVE_R = 48;
const HIT_R = FACE_R + GLOVE_R;

const randomPos = () => ({ x: 10 + Math.random() * 80, y: 20 + Math.random() * 65 });

export default function PcVsAI() {
  const [glove, setGlove] = useState({ x: 50, y: 50, isPunching: false });
  const [computerPos, setComputerPos] = useState(randomPos);
  const [playerScore, setPlayerScore] = useState(0);
  const [computerScore, setComputerScore] = useState(0);
  const [flash, setFlash] = useState(false);
  const shake = useAnimationControls();

  const gloveRef = useRef(glove);
  const posRef = useRef(computerPos);
  const moveTimer = useRef(null);
  const missTimer = useRef(null);
  const cooldown = useRef(false);

  const moveFace = useCallback(() => {
    const p = randomPos();
    posRef.current = p;
    setComputerPos(p);
  }, []);

  const startMoveTimer = useCallback(() => {
    clearInterval(moveTimer.current);
    moveTimer.current = setInterval(moveFace, 1500);
  }, [moveFace]);

  const startMissTimer = useCallback(() => {
    clearTimeout(missTimer.current);
    missTimer.current = setTimeout(() => {
      setComputerScore((s) => s + 1);
      setFlash(true);
      setTimeout(() => setFlash(false), 300);
      shake.start({ x: [0, -20, 20, -15, 15, -8, 8, 0], transition: { duration: 0.4 } });
      startMissTimer();
    }, 3000);
  }, [shake]);

  useEffect(() => {
    startMoveTimer();
    startMissTimer();
    return () => {
      clearInterval(moveTimer.current);
      clearTimeout(missTimer.current);
    };
  }, [startMoveTimer, startMissTimer]);

  useEffect(() => {
    const onGloves = (d) => {
      const g = { x: d.x, y: d.y, isPunching: !!d.isPunching };
      gloveRef.current = g;
      setGlove(g);

      if (!g.isPunching || cooldown.current) return;
      const gx = (g.x / 100) * window.innerWidth;
      const gy = (g.y / 100) * window.innerHeight;
      const fx = (posRef.current.x / 100) * window.innerWidth;
      const fy = (posRef.current.y / 100) * window.innerHeight;
      if (Math.hypot(gx - fx, gy - fy) < HIT_R) {
        cooldown.current = true;
        setTimeout(() => (cooldown.current = false), 300);
        setPlayerScore((s) => s + 1);
        confetti({
          particleCount: 90,
          spread: 70,
          origin: { x: fx / window.innerWidth, y: fy / window.innerHeight },
        });
        moveFace();
        startMoveTimer();
        startMissTimer();
      }
    };
    socket.on('updateGloves', onGloves);
    return () => socket.off('updateGloves', onGloves);
  }, [moveFace, startMoveTimer, startMissTimer]);

  return (
    <motion.div
      animate={shake}
      className="relative w-screen h-screen overflow-hidden bg-gradient-to-b from-indigo-900 to-purple-900"
    >
      <div
        className={`absolute inset-0 z-30 pointer-events-none bg-red-600 transition-opacity duration-300 ${
          flash ? 'opacity-50' : 'opacity-0'
        }`}
      />

      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 px-8 py-3 rounded-2xl bg-white/20 backdrop-blur-md border border-white/30 shadow-lg text-white text-3xl font-extrabold">
        Player {playerScore} - {computerScore} Computer
      </div>

      <motion.div
        className="absolute -translate-x-1/2 -translate-y-1/2 select-none pointer-events-none"
        animate={{ left: `${computerPos.x}%`, top: `${computerPos.y}%` }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        style={{ fontSize: FACE_R * 2, lineHeight: 1 }}
      >
        😈
      </motion.div>

      <motion.div
        className="absolute -translate-x-1/2 -translate-y-1/2 select-none pointer-events-none z-10"
        animate={{
          left: `${glove.x}%`,
          top: `${glove.y}%`,
          scale: glove.isPunching ? 1.4 : 1,
        }}
        transition={{ type: 'spring', stiffness: 1000, damping: 30, mass: 0.5 }}
        style={{ fontSize: GLOVE_R * 2, lineHeight: 1 }}
      >
        {glove.isPunching ? '🥊' : '🧤'}
      </motion.div>
    </motion.div>
  );
}
