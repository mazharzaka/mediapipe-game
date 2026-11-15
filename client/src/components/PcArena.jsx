import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import confetti from 'canvas-confetti';
import { socket } from '../socket';

const BALL_R = 28;
const GLOVE_R = 48;
const HIT_R = GLOVE_R * 2; // hitbox 100% larger than the visible glove
const GRAVITY = 0.0875;
const START_VY = 2;

const randomX = () => BALL_R + Math.random() * (window.innerWidth - BALL_R * 2);

export default function PcArena() {
  const [score, setScore] = useState(0);
  const [ball, setBall] = useState({ x: randomX(), y: -BALL_R, vy: START_VY });

  // Glove position in percent, smoothed with springs
  const tx = useMotionValue(50);
  const ty = useMotionValue(50);
  const sx = useSpring(tx, { stiffness: 1000, damping: 30, mass: 0.5 });
  const sy = useSpring(ty, { stiffness: 1000, damping: 30, mass: 0.5 });
  const left = useMotionValue('50%');
  const top = useMotionValue('50%');

  useEffect(() => {
    const unsubX = sx.on('change', (v) => left.set(`${v}%`));
    const unsubY = sy.on('change', (v) => top.set(`${v}%`));
    return () => {
      unsubX();
      unsubY();
    };
  }, [sx, sy, left, top]);

  useEffect(() => {
    const onGloves = ({ x, y }) => {
      tx.set(x);
      ty.set(y);
    };
    socket.on('updateGloves', onGloves);
    return () => socket.off('updateGloves', onGloves);
  }, [tx, ty]);

  const physics = useRef({ x: ball.x, y: ball.y, vy: ball.vy, cooldown: 0 });

  useEffect(() => {
    let raf;
    const step = () => {
      const b = physics.current;
      b.vy += GRAVITY;
      b.y += b.vy;
      if (b.cooldown > 0) b.cooldown--;

      const gx = (sx.get() / 100) * window.innerWidth;
      const gy = (sy.get() / 100) * window.innerHeight;
      const dist = Math.hypot(b.x - gx, b.y - gy);

      if (dist < BALL_R + HIT_R && b.cooldown === 0) {
        b.vy = -Math.abs(b.vy) - 2; // bounce up
        b.y = gy - (BALL_R + HIT_R);
        b.cooldown = 15;
        setScore((s) => s + 1);
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { x: b.x / window.innerWidth, y: b.y / window.innerHeight },
        });
      }

      if (b.y - BALL_R > window.innerHeight) {
        b.x = randomX();
        b.y = -BALL_R;
        b.vy = START_VY;
      }
      if (b.vy < -12) b.vy = -12;

      setBall({ x: b.x, y: b.y, vy: b.vy });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [sx, sy]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-gradient-to-b from-green-600 to-green-800">
      {/* Pitch markings */}
      <div className="absolute inset-6 border-4 border-white/40 rounded-xl pointer-events-none" />
      <div className="absolute left-6 right-6 top-1/2 border-t-4 border-white/40 pointer-events-none" />
      <div className="absolute left-1/2 top-1/2 w-40 h-40 -translate-x-1/2 -translate-y-1/2 border-4 border-white/40 rounded-full pointer-events-none" />

      {/* Score */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 px-8 py-3 rounded-2xl bg-white/20 backdrop-blur-md border border-white/30 shadow-lg text-white text-center">
        <div className="text-xs uppercase tracking-widest opacity-80">Score</div>
        <div className="text-4xl font-extrabold">{score}</div>
      </div>

      {/* Ball */}
      <div
        className="absolute rounded-full shadow-xl pointer-events-none"
        style={{
          width: BALL_R * 2,
          height: BALL_R * 2,
          transform: `translate(${ball.x - BALL_R}px, ${ball.y - BALL_R}px)`,
          background:
            'radial-gradient(circle at 30% 30%, #fff, #ffd54f 40%, #f57c00 100%)',
          boxShadow: '0 10px 25px rgba(0,0,0,0.4), inset -4px -4px 10px rgba(0,0,0,0.2)',
        }}
      />

      {/* Glove */}
      <motion.div
        className="absolute -translate-x-1/2 -translate-y-1/2 select-none pointer-events-none z-10"
        style={{ left, top, fontSize: GLOVE_R * 2, lineHeight: 1 }}
      >
        🧤
      </motion.div>
    </div>
  );
}



