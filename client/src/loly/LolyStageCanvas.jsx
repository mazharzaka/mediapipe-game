import { useEffect, useRef } from 'react';
import {
  drawOrganicStickerCharacter,
  drawGlowingBabyPortrait,
} from './lolyAssets';
import { lolyAudio } from './lolyAudio';

const CONFETTI_COLORS = [
  '#FACC15',
  '#F472B6',
  '#38BDF8',
  '#4ADE80',
  '#FB923C',
  '#C084FC',
  '#FB7185',
];

const RAINBOW_BANDS = [
  'rgba(251, 113, 133, 0.42)',
  'rgba(251, 146, 60, 0.42)',
  'rgba(250, 204, 21, 0.44)',
  'rgba(74, 222, 128, 0.40)',
  'rgba(56, 189, 248, 0.40)',
  'rgba(129, 140, 248, 0.38)',
  'rgba(232, 121, 249, 0.36)',
];

const FAMILY_ALL_KEYS = ['grandpa', 'mom', 'uncle', 'dad', 'grandma'];

const FAMILY_PAIRS = [
  ['mom', 'dad'],
  ['grandpa', 'grandma'],
  ['uncle', 'mom'],
  ['dad', 'grandpa'],
  ['grandma', 'uncle'],
];

const BALLOON_THEMES = {
  mom: { fill: '#EC4899', rim: '#FBCFE8', ribbon: '💖 ماما' },
  dad: { fill: '#0284C7', rim: '#BAE6FD', ribbon: '👑 بابا' },
  uncle: { fill: '#F59E0B', rim: '#FEF08A', ribbon: '😎 خالو' },
  grandpa: { fill: '#10B981', rim: '#A7F3D0', ribbon: '🌟 جدو' },
  grandma: { fill: '#8B5CF6', rim: '#DDD6FE', ribbon: '🌸 تيتة' },
};

const CLOUDS_SEED = [
  { baseX: 0.12, y: 0.14, scale: 1.05, speed: 0.012 },
  { baseX: 0.48, y: 0.1, scale: 1.25, speed: 0.009 },
  { baseX: 0.82, y: 0.17, scale: 0.95, speed: 0.014 },
  { baseX: 0.66, y: 0.24, scale: 0.78, speed: 0.011 },
];

const SKY_TWINKLES = [
  { x: 0.08, y: 0.09, size: 9, phase: 0.2 },
  { x: 0.24, y: 0.07, size: 7, phase: 1.4 },
  { x: 0.41, y: 0.13, size: 10, phase: 2.6 },
  { x: 0.61, y: 0.08, size: 8, phase: 3.5 },
  { x: 0.77, y: 0.12, size: 11, phase: 4.7 },
  { x: 0.92, y: 0.09, size: 8, phase: 5.3 },
];

function drawHeart(ctx, x, y, size, color, alpha = 1, rot = 0) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  const s = size;
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(-s, -s * 0.35, -s * 0.55, -s, 0, -s * 0.42);
  ctx.bezierCurveTo(s * 0.55, -s, s, -s * 0.35, 0, s * 0.35);
  ctx.fill();
  ctx.restore();
}

function drawStar(ctx, x, y, outerR, color, rotation = 0, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : outerR * 0.45;
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFluffyCloud(ctx, cx, cy, unitR) {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.shadowColor = 'rgba(186, 230, 253, 0.55)';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(cx - unitR * 0.95, cy + unitR * 0.12, unitR * 0.62, 0, Math.PI * 2);
  ctx.arc(cx - unitR * 0.35, cy - unitR * 0.22, unitR * 0.82, 0, Math.PI * 2);
  ctx.arc(cx + unitR * 0.42, cy - unitR * 0.12, unitR * 0.74, 0, Math.PI * 2);
  ctx.arc(cx + unitR * 1.0, cy + unitR * 0.16, unitR * 0.56, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSmilingCartoonSun(ctx, cx, cy, r, timeSec) {
  ctx.save();
  ctx.translate(cx, cy);

  const halo = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2.1);
  halo.addColorStop(0, 'rgba(254, 240, 138, 0.75)');
  halo.addColorStop(0.55, 'rgba(253, 224, 71, 0.25)');
  halo.addColorStop(1, 'rgba(253, 224, 71, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.rotate(timeSec * 0.22);
  const rayCount = 12;
  ctx.fillStyle = '#FDE047';
  for (let i = 0; i < rayCount; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI * 2) / rayCount);
    ctx.beginPath();
    ctx.ellipse(0, -r * 1.24, r * 0.13, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  const pulse = 1 + Math.sin(timeSec * 2.8) * 0.03;
  ctx.scale(pulse, 1 / pulse);
  const bodyGrad = ctx.createRadialGradient(-r * 0.25, -r * 0.25, r * 0.1, 0, 0, r);
  bodyGrad.addColorStop(0, '#FEF9C3');
  bodyGrad.addColorStop(0.65, '#FACC15');
  bodyGrad.addColorStop(1, '#F59E0B');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  [-r * 0.28, r * 0.28].forEach((ex) => {
    ctx.fillStyle = '#451A03';
    ctx.beginPath();
    ctx.arc(ex, -r * 0.08, r * 0.095, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(ex - r * 0.03, -r * 0.11, r * 0.035, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = 'rgba(244, 114, 182, 0.45)';
  ctx.beginPath();
  ctx.arc(-r * 0.44, r * 0.08, r * 0.12, 0, Math.PI * 2);
  ctx.arc(r * 0.44, r * 0.08, r * 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#78350F';
  ctx.lineWidth = Math.max(2.5, r * 0.065);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, r * 0.06, r * 0.28, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  ctx.restore();
}

function drawSwayingFlower(ctx, x, y, size, petalColor, timeSec, phase) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(timeSec * 2.4 + phase) * 0.14);

  ctx.strokeStyle = '#15803D';
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -size * 1.3);
  ctx.stroke();

  ctx.translate(0, -size * 1.35);
  ctx.fillStyle = petalColor;
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5 + timeSec * 0.3;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * size * 0.42, Math.sin(a) * size * 0.42, size * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#FEF08A';
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLivingCartoonWorld(ctx, w, h, timeSec, sceneIndex, beatPulse) {
  const minDim = Math.min(w, h);

  const palettes = [
    ['#FCE7F3', '#FEF3C7', '#E0F2FE'],
    ['#BAE6FD', '#E0F2FE', '#FEF9C3'],
    ['#C7D2FE', '#E0F2FE', '#FCE7F3'],
    ['#FDE68A', '#FCE7F3', '#DBEAFE'],
  ];
  const pal = palettes[sceneIndex % palettes.length];

  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.82);
  sky.addColorStop(0, pal[0]);
  sky.addColorStop(0.52, pal[1]);
  sky.addColorStop(1, pal[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  SKY_TWINKLES.forEach((st) => {
    const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(timeSec * 2.2 + st.phase));
    drawStar(
      ctx,
      st.x * w,
      st.y * h,
      st.size * (0.85 + twinkle * 0.35),
      '#FACC15',
      timeSec * 0.4 + st.phase,
      twinkle * 0.85
    );
  });

  drawSmilingCartoonSun(ctx, w * 0.12, h * 0.16, minDim * 0.068, timeSec);

  const rainbowCx = w * 0.52;
  const rainbowCy = h * 0.86;
  const baseArchR = Math.max(w * 0.46, minDim * 0.62);
  const bandThickness = Math.max(8, minDim * 0.018);

  ctx.save();
  ctx.lineCap = 'round';
  RAINBOW_BANDS.forEach((color, idx) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = bandThickness;
    ctx.beginPath();
    ctx.arc(
      rainbowCx,
      rainbowCy,
      baseArchR - idx * (bandThickness * 0.92),
      Math.PI * 1.06,
      Math.PI * 1.94
    );
    ctx.stroke();
  });
  ctx.restore();

  CLOUDS_SEED.forEach((cl) => {
    const wrappedX = ((cl.baseX + timeSec * cl.speed) % 1.28) - 0.14;
    const bobY = Math.sin(timeSec * 1.3 + cl.baseX * 10) * 6;
    drawFluffyCloud(ctx, wrappedX * w, cl.y * h + bobY, minDim * 0.052 * cl.scale);
  });

  const backHillGrad = ctx.createLinearGradient(0, h * 0.66, 0, h);
  backHillGrad.addColorStop(0, '#86EFAC');
  backHillGrad.addColorStop(1, '#22C55E');
  ctx.fillStyle = backHillGrad;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h * 0.77);
  ctx.quadraticCurveTo(w * 0.28, h * 0.65, w * 0.58, h * 0.76);
  ctx.quadraticCurveTo(w * 0.82, h * 0.84, w, h * 0.71);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  const frontHillGrad = ctx.createLinearGradient(0, h * 0.74, 0, h);
  frontHillGrad.addColorStop(0, '#4ADE80');
  frontHillGrad.addColorStop(0.55, '#22C55E');
  frontHillGrad.addColorStop(1, '#15803D');
  ctx.fillStyle = frontHillGrad;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h * 0.83);
  ctx.quadraticCurveTo(w * 0.24, h * 0.75, w * 0.5, h * 0.81);
  ctx.quadraticCurveTo(w * 0.78, h * 0.87, w, h * 0.77);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  const flowerSpots = [
    { x: 0.09, y: 0.88, c: '#F472B6' },
    { x: 0.19, y: 0.84, c: '#FFFFFF' },
    { x: 0.34, y: 0.89, c: '#FB923C' },
    { x: 0.66, y: 0.88, c: '#F472B6' },
    { x: 0.81, y: 0.85, c: '#C084FC' },
    { x: 0.91, y: 0.89, c: '#FFFFFF' },
  ];
  const flowerSize = Math.max(8, minDim * 0.015) * (1 + Math.abs(beatPulse) * 0.06);
  flowerSpots.forEach((fl, idx) => {
    drawSwayingFlower(ctx, fl.x * w, fl.y * h, flowerSize, fl.c, timeSec, idx * 1.3);
  });
}

function drawDancingYellowDuck(
  ctx,
  x,
  y,
  scaleRadius,
  tiltRad,
  wingFlap,
  timeSec,
  beatPulse = 0,
  gazeTarget = null
) {
  const r = Math.max(12, scaleRadius);
  const sy = 1 + beatPulse * 0.075 + Math.sin(timeSec * 3.4) * 0.025;
  const sx = 1 / Math.max(0.82, sy);

  ctx.save();
  ctx.translate(x, y + r * 0.82);
  ctx.rotate(tiltRad);
  ctx.scale(sx, sy);
  ctx.translate(0, -r * 0.82);

  ctx.fillStyle = 'rgba(56, 189, 248, 0.36)';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.92, r * 1.12, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  const footBounce = Math.sin(timeSec * 8) * r * 0.06;
  ctx.fillStyle = '#F97316';
  ctx.beginPath();
  ctx.ellipse(-r * 0.35, r * 0.85 - footBounce, r * 0.24, r * 0.12, -0.2, 0, Math.PI * 2);
  ctx.ellipse(r * 0.35, r * 0.85 + footBounce, r * 0.24, r * 0.12, 0.2, 0, Math.PI * 2);
  ctx.fill();

  const bodyGrad = ctx.createRadialGradient(-r * 0.2, -r * 0.1, r * 0.1, 0, r * 0.2, r);
  bodyGrad.addColorStop(0, '#FEF08A');
  bodyGrad.addColorStop(0.65, '#FACC15');
  bodyGrad.addColorStop(1, '#EAB308');
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = '#CA8A04';
  ctx.lineWidth = Math.max(3, r * 0.04);

  ctx.beginPath();
  ctx.ellipse(0, r * 0.26, r * 0.86, r * 0.64, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const flapAngle = 0.35 + Math.sin(timeSec * 9) * 0.25 + wingFlap * 0.45;
  [-1, 1].forEach((dir) => {
    ctx.save();
    ctx.translate(dir * r * 0.72, r * 0.18);
    ctx.rotate(dir * -flapAngle);
    ctx.fillStyle = '#FDE047';
    ctx.strokeStyle = '#CA8A04';
    ctx.lineWidth = Math.max(2.5, r * 0.035);
    ctx.beginPath();
    ctx.ellipse(dir * r * 0.18, 0, r * 0.34, r * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });

  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.arc(0, -r * 0.42, r * 0.56, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FDE047';
  ctx.beginPath();
  ctx.ellipse(-r * 0.06, -r * 0.98, r * 0.09, r * 0.16, -0.3, 0, Math.PI * 2);
  ctx.ellipse(r * 0.08, -r * 0.96, r * 0.08, r * 0.14, 0.35, 0, Math.PI * 2);
  ctx.fill();

  let pupilShiftX = 0;
  let pupilShiftY = 0;
  if (gazeTarget) {
    pupilShiftX = Math.max(-1, Math.min(1, (gazeTarget.x - x) / 360)) * r * 0.04;
    pupilShiftY = Math.max(-1, Math.min(1, (gazeTarget.y - y) / 360)) * r * 0.03;
  }
  const blinking = timeSec % 4.1 > 3.96;

  [-r * 0.22, r * 0.22].forEach((ex) => {
    if (blinking) {
      ctx.strokeStyle = '#18181B';
      ctx.lineWidth = Math.max(3, r * 0.045);
      ctx.beginPath();
      ctx.arc(ex, -r * 0.47, r * 0.09, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#18181B';
      ctx.beginPath();
      ctx.arc(ex + pupilShiftX, -r * 0.48 + pupilShiftY, r * 0.11, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(
        ex + pupilShiftX - r * 0.035,
        -r * 0.52 + pupilShiftY,
        r * 0.042,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  });

  ctx.fillStyle = 'rgba(244, 114, 182, 0.48)';
  ctx.beginPath();
  ctx.arc(-r * 0.36, -r * 0.34, r * 0.11, 0, Math.PI * 2);
  ctx.arc(r * 0.36, -r * 0.34, r * 0.11, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#F97316';
  ctx.strokeStyle = '#C2410C';
  ctx.lineWidth = Math.max(2, r * 0.03);
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.3, r * 0.26, r * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#9A3412';
  ctx.beginPath();
  ctx.arc(0, -r * 0.28, r * 0.14, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.fill();

  ctx.restore();
}

function drawFloatingFamilyBalloon(
  ctx,
  charSticker,
  bx,
  by,
  bRadius,
  theme,
  isLeft,
  timeSec,
  beatPulse,
  gazeTarget,
  slotIdx
) {
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(Math.sin(timeSec * 2.4 + slotIdx) * 0.07);

  ctx.strokeStyle = 'rgba(120, 53, 15, 0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-bRadius * 0.35, bRadius * 0.92);
  ctx.lineTo(-bRadius * 0.25, bRadius * 1.22);
  ctx.moveTo(bRadius * 0.35, bRadius * 0.92);
  ctx.lineTo(bRadius * 0.25, bRadius * 1.22);
  ctx.stroke();

  const balGrad = ctx.createRadialGradient(
    -bRadius * 0.3,
    -bRadius * 0.3,
    bRadius * 0.15,
    0,
    0,
    bRadius * 1.1
  );
  balGrad.addColorStop(0, '#FFFFFF');
  balGrad.addColorStop(0.35, theme.rim);
  balGrad.addColorStop(1, theme.fill);

  ctx.fillStyle = balGrad;
  ctx.strokeStyle = '#FEF08A';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, 0, bRadius, bRadius * 1.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  drawOrganicStickerCharacter(ctx, charSticker, bx, by + bRadius * 0.08, bRadius * 1.65, {
    timeSec,
    beatPulse,
    swayRad: Math.sin(timeSec * 2.5 + slotIdx) * 0.06,
    squashStrength: 0.06,
    gazeTarget,
    phaseOffset: slotIdx * 1.3,
  });

  ctx.save();
  ctx.translate(bx, by);
  const waveAngle = Math.sin(timeSec * 12 + slotIdx) * 0.45;
  ctx.save();
  ctx.translate(isLeft ? bRadius * 0.88 : -bRadius * 0.88, -bRadius * 0.12);
  ctx.rotate(waveAngle);
  ctx.font = `${Math.round(bRadius * 0.46)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('👋', 0, 0);
  ctx.restore();

  const tagW = bRadius * 1.35;
  const tagH = Math.max(24, bRadius * 0.32);
  ctx.fillStyle = '#831843';
  ctx.strokeStyle = '#FDE047';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(-tagW / 2, bRadius * 1.04, tagW, tagH, tagH / 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FEF9C3';
  ctx.font = `bold ${Math.round(tagH * 0.58)}px "IBM Plex Sans Arabic", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(theme.ribbon, 0, bRadius * 1.04 + tagH / 2 + 1);
  ctx.restore();
}

function drawIridescentSoapBubble(ctx, bx, by, r, hue, toy) {
  ctx.save();
  const bubGrad = ctx.createRadialGradient(
    bx - r * 0.3,
    by - r * 0.3,
    r * 0.08,
    bx,
    by,
    r
  );
  bubGrad.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  bubGrad.addColorStop(0.55, `hsla(${hue}, 95%, 72%, 0.32)`);
  bubGrad.addColorStop(0.88, `hsla(${(hue + 95) % 360}, 95%, 66%, 0.62)`);
  bubGrad.addColorStop(1, 'rgba(255, 255, 255, 0.92)');

  ctx.fillStyle = bubGrad;
  ctx.strokeStyle = `hsla(${hue}, 100%, 86%, 0.95)`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.beginPath();
  ctx.ellipse(bx - r * 0.34, by - r * 0.34, r * 0.22, r * 0.11, -0.6, 0, Math.PI * 2);
  ctx.fill();

  if (toy) {
    ctx.font = `${Math.round(r * 0.62)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(toy, bx, by + 2);
  }
  ctx.restore();
}

export default function LolyStageCanvas({
  sceneIndex = 0,
  assets,
  motionRef,
  gestureCommandRef,
}) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const bubblesRef = useRef([]);
  const rewardBubblesRef = useRef([]);
  const popTextsRef = useRef([]);
  const lastHandledSeqRef = useRef(0);
  const lastAutoRewardAtRef = useRef(0);
  const lastCloseZoomGiggleRef = useRef(0);

  // Smooth 60fps interpolated baby face pose (`faceX`, `faceY`, `faceScale`, `headTilt`)
  const smoothFaceRef = useRef({
    x: 0.56,
    y: 0.52,
    scale: 1.0,
    tilt: 0,
  });

  // Active Adult Gesture Surprise Timers
  const surpriseStateRef = useRef({
    victoryDivaUntil: 0,
    victoryDivaStartedAt: 0,
    okDuckUntil: 0,
    okDuckStartedAt: 0,
    familyBalloonsUntil: 0,
    familyBalloonsStartedAt: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const createBubble = (w, h, startAtBottom = false) => {
      const radius = Math.max(46, Math.min(w, h) * (0.072 + Math.random() * 0.055));
      return {
        x: radius + Math.random() * Math.max(100, w - radius * 2),
        y: startAtBottom ? h + radius + Math.random() * 110 : Math.random() * h,
        r: radius,
        vy: 1.1 + Math.random() * 1.35,
        wobbleOffset: Math.random() * Math.PI * 2,
        hue: Math.floor(Math.random() * 360),
        toy: ['⭐', '💛', '🐥', '👑', '🌸'][Math.floor(Math.random() * 5)],
      };
    };

    bubblesRef.current = Array.from({ length: 10 }, () =>
      createBubble(canvas.width, canvas.height, false)
    );

    const trimParticles = () => {
      if (particlesRef.current.length > 240) {
        particlesRef.current.splice(0, particlesRef.current.length - 240);
      }
    };

    const spawnSparkleBurst = (x, y, count = 10, kind = 'mixed') => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.2 + Math.random() * 6.5;
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2.4,
          gravity: 0.1,
          size: 11 + Math.random() * 15,
          color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
          shape:
            kind === 'confetti'
              ? 'rect'
              : kind === 'hearts'
                ? 'heart'
                : Math.random() > 0.45
                  ? 'heart'
                  : 'star',
          rot: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 0.22,
          life: 1.0,
          decay: 0.013 + Math.random() * 0.011,
        });
      }
      trimParticles();
    };

    const spawnGoldenHeartRain = (w, count = 36) => {
      const heartPalette = ['#FACC15', '#FDE047', '#F59E0B', '#F472B6', '#FB7185'];
      for (let i = 0; i < count; i++) {
        particlesRef.current.push({
          x: Math.random() * w,
          y: -20 - Math.random() * 260,
          vx: (Math.random() - 0.5) * 2.2,
          vy: 2.3 + Math.random() * 3.4,
          gravity: 0.035,
          size: 16 + Math.random() * 16,
          color: heartPalette[i % heartPalette.length],
          shape: 'heart',
          rot: (Math.random() - 0.5) * 0.45,
          vRot: (Math.random() - 0.5) * 0.05,
          life: 1.0,
          decay: 0.0065 + Math.random() * 0.004,
        });
      }
      trimParticles();
    };

    const fireTwinConfettiCannons = (w, h) => {
      [0.06, 0.94].forEach((originNormX, sideIdx) => {
        const dirSign = sideIdx === 0 ? 1 : -1;
        for (let i = 0; i < 42; i++) {
          const spreadAngle = -Math.PI * (0.24 + Math.random() * 0.24);
          const speed = 9 + Math.random() * 11;
          particlesRef.current.push({
            x: w * originNormX,
            y: h * 0.92,
            vx: dirSign * Math.cos(spreadAngle) * speed,
            vy: Math.sin(spreadAngle) * speed - 3,
            gravity: 0.19,
            size: 12 + Math.random() * 14,
            color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
            shape: i % 4 === 0 ? 'star' : 'rect',
            rot: Math.random() * Math.PI * 2,
            vRot: (Math.random() - 0.5) * 0.32,
            life: 1.0,
            decay: 0.0085 + Math.random() * 0.006,
          });
        }
      });
      trimParticles();
    };

    const spawnBabyRewardBubbles = (cx, cy, minDim, count = 2) => {
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
        const speed = 2.2 + Math.random() * 2.8;
        const r = Math.max(36, minDim * (0.055 + Math.random() * 0.045));
        rewardBubblesRef.current.push({
          x: cx + (Math.random() - 0.5) * 60,
          y: cy + (Math.random() - 0.5) * 40,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.2,
          r,
          hue: Math.floor(Math.random() * 360),
          toy: ['✨', '💛', '👑', '🐥', '🌸'][Math.floor(Math.random() * 5)],
          bornAt: performance.now(),
          popAfterMs: 1200 + Math.random() * 900,
        });
      }
      if (rewardBubblesRef.current.length > 18) {
        rewardBubblesRef.current.splice(0, rewardBubblesRef.current.length - 18);
      }
    };

    // Execute Secret Adult Gesture Surprises
    const executeAdultGestureSurprise = (type, nowMs, w, h) => {
      const st = surpriseStateRef.current;
      if (type === 'victory') {
        st.victoryDivaStartedAt = nowMs;
        st.victoryDivaUntil = nowMs + 4200;
        lolyAudio.playBangleJingle();
        lolyAudio.playBabyGiggle();
        spawnGoldenHeartRain(w, 42);
      } else if (type === 'ok_thumbs') {
        st.okDuckStartedAt = nowMs;
        st.okDuckUntil = nowMs + 4000;
        lolyAudio.playDuckQuack();
        setTimeout(() => lolyAudio.playDuckQuack(), 480);
        spawnSparkleBurst(w * 0.5, h * 0.45, 36, 'confetti');
      } else if (type === 'open_palm') {
        st.familyBalloonsStartedAt = nowMs;
        st.familyBalloonsUntil = nowMs + 4800;
        lolyAudio.playFamilyApplause();
        spawnSparkleBurst(w * 0.5, h * 0.4, 28, 'mixed');
      } else if (type === 'fist') {
        fireTwinConfettiCannons(w, h);
        lolyAudio.playHappyBurst();
      }
    };

    const handlePointerDown = () => {
      lolyAudio.unlockOnFirstGesture();
    };
    canvas.addEventListener('pointerdown', handlePointerDown);

    let rafId = 0;
    let rewardSoundTurn = 0;

    const render = (nowMs) => {
      rafId = requestAnimationFrame(render);
      const w = canvas.width;
      const h = canvas.height;
      const minDim = Math.min(w, h);
      const timeSec = nowMs / 1000;
      const beatPhase = lolyAudio.getBeatPhase(nowMs);
      const beatPulse = Math.sin(beatPhase * Math.PI * 2);

      const motion = motionRef.current || {};
      const isMotionFresh = nowMs - (motion.updatedAt || 0) < 2200;

      // Consume Adult Gesture Surprise Trigger
      const pendingCmd = gestureCommandRef?.current;
      if (pendingCmd && pendingCmd.seq && pendingCmd.seq !== lastHandledSeqRef.current) {
        lastHandledSeqRef.current = pendingCmd.seq;
        executeAdultGestureSurprise(pendingCmd.type, nowMs, w, h);
      }

      // Smoothly interpolate Loly's real face pose (`faceX`, `faceY`, `faceScale`, `headTilt`)
      const sf = smoothFaceRef.current;
      const targetX =
        isMotionFresh && typeof motion.faceX === 'number'
          ? Math.max(0.12, Math.min(0.88, motion.faceX))
          : 0.58 + Math.sin(timeSec * 0.9) * 0.05;
      const targetY =
        isMotionFresh && typeof motion.faceY === 'number'
          ? Math.max(0.22, Math.min(0.76, motion.faceY))
          : 0.52 + Math.cos(timeSec * 1.1) * 0.03;
      const targetScale =
        isMotionFresh && typeof motion.faceScale === 'number'
          ? Math.max(0.6, Math.min(2.4, motion.faceScale))
          : 1.0;
      const targetTilt =
        isMotionFresh && typeof motion.headTilt === 'number'
          ? Math.max(-0.55, Math.min(0.55, motion.headTilt))
          : Math.sin(timeSec * 1.4) * 0.1;

      const lerpFactor = 0.16;
      sf.x += (targetX - sf.x) * lerpFactor;
      sf.y += (targetY - sf.y) * lerpFactor;
      sf.scale += (targetScale - sf.scale) * lerpFactor;
      sf.tilt += (targetTilt - sf.tilt) * lerpFactor;

      const isSmiling = isMotionFresh ? Boolean(motion.isSmiling) : false;
      const movementEnergy = isMotionFresh ? Number(motion.movementEnergy || 0) : 0;

      // Map Loly's face coordinates to stage pixels
      const lolyStageX = w * (0.18 + sf.x * 0.64);
      const lolyStageY = h * (0.28 + sf.y * 0.42);
      const gazeTarget = { x: lolyStageX, y: lolyStageY };

      // Cheerful Giggle when Loly leans super close to the phone (`faceScale > 1.65`)!
      if (isMotionFresh && sf.scale > 1.65 && nowMs - lastCloseZoomGiggleRef.current > 2800) {
        lastCloseZoomGiggleRef.current = nowMs;
        lolyAudio.playBabyGiggle();
        spawnSparkleBurst(lolyStageX, lolyStageY, 14, 'hearts');
      }

      // Automatic Rewards for Baby's Spontaneous Movement (`movementEnergy`) or Smile (`isSmiling`)!
      if (
        isMotionFresh &&
        (isSmiling || movementEnergy > 0.032) &&
        nowMs - lastAutoRewardAtRef.current > 360
      ) {
        lastAutoRewardAtRef.current = nowMs;
        spawnBabyRewardBubbles(lolyStageX, lolyStageY, minDim, isSmiling ? 2 : 1);
        spawnSparkleBurst(lolyStageX, lolyStageY, isSmiling ? 8 : 5, 'mixed');

        rewardSoundTurn = (rewardSoundTurn + 1) % 3;
        if (isSmiling && rewardSoundTurn === 0) {
          lolyAudio.playBabyGiggle();
        } else if (rewardSoundTurn === 1) {
          lolyAudio.playBangleJingle();
        } else {
          lolyAudio.playBubblePop();
        }
      }

      // 1. Living Cartoon World Backdrop
      drawLivingCartoonWorld(ctx, w, h, timeSec, sceneIndex, beatPulse);

      const danceJump = Math.abs(beatPulse) * minDim * 0.032;

      // =====================================================================
      // SCENE 0: مسرح أبلة فاهيتا + لولاتي (تتحرك وتكبر وتصغر بوشها!)
      // =====================================================================
      if (sceneIndex === 0) {
        const divaX = sf.x > 0.48 ? w * 0.25 : w * 0.75;
        const divaY = h * 0.55;
        const divaHeight = Math.min(w * 0.38, minDim * 0.52);

        drawOrganicStickerCharacter(ctx, assets?.characters?.diva, divaX, divaY, divaHeight, {
          timeSec,
          beatPulse,
          swayRad: beatPulse * 0.08,
          extraJump: danceJump,
          squashStrength: 0.065,
          gazeTarget,
          phaseOffset: 0.4,
        });

        // Loly's Cartoon + Real Portrait moving & scaling dynamically with `faceX, faceY, faceScale`!
        const lolyRadius = Math.min(w * 0.17, minDim * 0.19) * sf.scale;
        drawGlowingBabyPortrait(
          ctx,
          assets?.realPhotos?.loly_real1,
          lolyStageX,
          lolyStageY - danceJump * 0.8,
          lolyRadius,
          timeSec,
          sf.tilt * 1.15,
          'لولاتي القمر 👑',
          beatPulse
        );
      }

      // =====================================================================
      // SCENE 1: الأميرة لولاتي والبطة الصفراء الراقصة
      // =====================================================================
      else if (sceneIndex === 1) {
        // Companion Yellow Duck dancing opposite Loly's horizontal side
        const duckX = sf.x > 0.5 ? w * 0.24 : w * 0.76;
        drawDancingYellowDuck(
          ctx,
          duckX,
          h * 0.6 - danceJump,
          Math.min(w * 0.15, minDim * 0.2),
          sf.tilt * 1.1,
          movementEnergy * 12,
          timeSec,
          beatPulse,
          gazeTarget
        );

        // Cartoon Princess Loly scaling & moving directly with Baby's Face!
        const lolyHeight = Math.min(w * 0.28, minDim * 0.4) * sf.scale;
        drawOrganicStickerCharacter(
          ctx,
          assets?.characters?.loly,
          lolyStageX,
          lolyStageY + lolyHeight * 0.08,
          lolyHeight,
          {
            timeSec,
            beatPulse,
            swayRad: sf.tilt * 1.15,
            extraJump: danceJump,
            squashStrength: 0.07,
            gazeTarget,
            crown: true,
          }
        );
      }

      // =====================================================================
      // SCENE 2: فقاعات الصابون السحرية (تتفرقع تلقائياً بحركة وش لولاتي!)
      // =====================================================================
      else if (sceneIndex === 2) {
        const lolyRadius = Math.min(w * 0.15, minDim * 0.17) * sf.scale;

        bubblesRef.current.forEach((b, idx) => {
          b.y -= b.vy;
          const bx = b.x + Math.sin(timeSec * 1.8 + b.wobbleOffset) * 24;

          if (b.y + b.r < -20) {
            bubblesRef.current[idx] = createBubble(w, h, true);
            return;
          }

          // Pop whenever Loly's face-driven character touches any floating bubble!
          if (Math.hypot(lolyStageX - bx, lolyStageY - b.y) < b.r + lolyRadius * 0.95) {
            lolyAudio.playBubblePop();
            spawnSparkleBurst(bx, b.y, 12);
            popTextsRef.current.push({ x: bx, y: b.y, text: 'بوب! ✨', life: 1.0 });
            bubblesRef.current[idx] = createBubble(w, h, true);
            return;
          }

          drawIridescentSoapBubble(ctx, bx, b.y, b.r, b.hue, b.toy);
        });

        drawGlowingBabyPortrait(
          ctx,
          assets?.realPhotos?.loly_real2,
          lolyStageX,
          lolyStageY - danceJump * 0.6,
          lolyRadius,
          timeSec,
          sf.tilt * 1.1,
          'لولاتي والفقاعات 🫧',
          beatPulse
        );
      }

      // =====================================================================
      // SCENE 3: موكب عيلة لولاتي حولها
      // =====================================================================
      else {
        const pairIdx = Math.floor(timeSec / 8.0) % FAMILY_PAIRS.length;
        const activePair = FAMILY_PAIRS[pairIdx];
        const bRadius = Math.min(w * 0.135, minDim * 0.165);

        activePair.forEach((memberKey, slotIdx) => {
          const isLeft = slotIdx === 0;
          const theme = BALLOON_THEMES[memberKey] || BALLOON_THEMES.mom;
          const bx = (isLeft ? w * 0.18 : w * 0.82) + Math.sin(timeSec * 1.4 + slotIdx * 2) * 18;
          const by = h * 0.44 - Math.sin(timeSec * 2.2 + slotIdx * Math.PI) * 18;

          drawFloatingFamilyBalloon(
            ctx,
            assets?.characters?.[memberKey],
            bx,
            by,
            bRadius,
            theme,
            isLeft,
            timeSec,
            beatPulse,
            gazeTarget,
            slotIdx
          );
        });

        // Loly's Cartoon Character in the center controlled by her face & scale!
        const lolyHeight = Math.min(w * 0.25, minDim * 0.36) * sf.scale;
        drawOrganicStickerCharacter(
          ctx,
          assets?.characters?.loly,
          lolyStageX,
          lolyStageY + lolyHeight * 0.08,
          lolyHeight,
          {
            timeSec,
            beatPulse,
            swayRad: sf.tilt * 1.1,
            extraJump: danceJump,
            squashStrength: 0.07,
            gazeTarget,
            crown: true,
          }
        );
      }

      // =====================================================================
      // SECRET ADULT GESTURE 1 (`victory` ✌️): GIANT ABLA FAHITA + GOLDEN HEARTS!
      // =====================================================================
      const st = surpriseStateRef.current;
      if (nowMs < st.victoryDivaUntil) {
        const elapsed = nowMs - st.victoryDivaStartedAt;
        const remaining = st.victoryDivaUntil - nowMs;
        const popScale = Math.min(1, elapsed / 260) * Math.min(1, remaining / 320);

        if (Math.random() < 0.35) {
          spawnGoldenHeartRain(w, 2);
        }

        ctx.save();
        const spot = ctx.createRadialGradient(
          w * 0.5,
          h * 0.52,
          20,
          w * 0.5,
          h * 0.52,
          minDim * 0.56 * popScale
        );
        spot.addColorStop(0, 'rgba(254, 240, 138, 0.94)');
        spot.addColorStop(0.6, 'rgba(244, 114, 182, 0.45)');
        spot.addColorStop(1, 'rgba(254, 240, 138, 0)');
        ctx.fillStyle = spot;
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.52, minDim * 0.56 * popScale, 0, Math.PI * 2);
        ctx.fill();

        const divaSize = minDim * 0.64 * popScale;
        const jumpBounce = Math.abs(Math.sin(elapsed * 0.011)) * minDim * 0.07;

        drawOrganicStickerCharacter(ctx, assets?.characters?.diva, w * 0.5, h * 0.58, divaSize, {
          timeSec,
          beatPulse: Math.sin(elapsed * 0.02),
          swayRad: Math.sin(elapsed * 0.011) * 0.11,
          extraJump: jumpBounce,
          squashStrength: 0.085,
          gazeTarget,
        });

        // Extra Shimmering Diamond Bangles Halo on Diva's Wrists!
        ctx.translate(w * 0.5 + divaSize * 0.04, h * 0.58 + divaSize * 0.08 - jumpBounce);
        const bGlow = ctx.createRadialGradient(0, 0, 4, 0, 0, divaSize * 0.24);
        bGlow.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
        bGlow.addColorStop(0.45, 'rgba(250, 204, 21, 0.8)');
        bGlow.addColorStop(1, 'rgba(250, 204, 21, 0)');
        ctx.fillStyle = bGlow;
        ctx.beginPath();
        ctx.arc(0, 0, divaSize * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // =====================================================================
      // SECRET ADULT GESTURE 2 (`ok_thumbs` 👍 / 👌): GIANT DANCING YELLOW DUCK!
      // =====================================================================
      if (nowMs < st.okDuckUntil) {
        const elapsed = nowMs - st.okDuckStartedAt;
        const remaining = st.okDuckUntil - nowMs;
        const popScale = Math.min(1, elapsed / 240) * Math.min(1, remaining / 300);

        if (Math.random() < 0.28) {
          spawnSparkleBurst(w * (0.25 + Math.random() * 0.5), h * 0.3, 2, 'confetti');
        }

        const duckJump = Math.abs(Math.sin(elapsed * 0.013)) * minDim * 0.09;
        drawDancingYellowDuck(
          ctx,
          w * 0.5,
          h * 0.56 - duckJump,
          minDim * 0.3 * popScale,
          Math.sin(elapsed * 0.014) * 0.2,
          1.4,
          timeSec,
          Math.sin(elapsed * 0.022),
          gazeTarget
        );
      }

      // =====================================================================
      // SECRET ADULT GESTURE 3 (`open_palm` 🖐️): ALL 5 FAMILY BALLOONS WAVING!
      // =====================================================================
      if (nowMs < st.familyBalloonsUntil) {
        const elapsed = nowMs - st.familyBalloonsStartedAt;
        const remaining = st.familyBalloonsUntil - nowMs;
        const popScale = Math.min(1, elapsed / 280) * Math.min(1, remaining / 340);

        FAMILY_ALL_KEYS.forEach((memberKey, idx) => {
          const normX = 0.13 + (idx / (FAMILY_ALL_KEYS.length - 1)) * 0.74;
          const archY = Math.sin((idx / (FAMILY_ALL_KEYS.length - 1)) * Math.PI) * h * 0.14;
          const bobY = Math.sin(elapsed * 0.008 + idx) * minDim * 0.04;
          const bx = w * normX;
          const by = h * 0.44 - archY + bobY;
          const bRad = Math.min(w * 0.11, minDim * 0.145) * popScale;
          const theme = BALLOON_THEMES[memberKey] || BALLOON_THEMES.mom;

          drawFloatingFamilyBalloon(
            ctx,
            assets?.characters?.[memberKey],
            bx,
            by,
            bRad,
            theme,
            idx < 2,
            timeSec,
            Math.sin(elapsed * 0.018 + idx),
            gazeTarget,
            idx
          );
        });
      }

      // Update & Pop Automatic Baby Reward Soap Bubbles
      for (let i = rewardBubblesRef.current.length - 1; i >= 0; i--) {
        const rb = rewardBubblesRef.current[i];
        rb.x += rb.vx + Math.sin(timeSec * 3 + i) * 0.7;
        rb.y += rb.vy;
        rb.vy -= 0.025;

        if (nowMs - rb.bornAt >= rb.popAfterMs || rb.y + rb.r < -20) {
          spawnSparkleBurst(rb.x, rb.y, 7);
          popTextsRef.current.push({ x: rb.x, y: rb.y, text: 'بوب! 🫧', life: 1.0 });
          rewardBubblesRef.current.splice(i, 1);
          continue;
        }

        drawIridescentSoapBubble(ctx, rb.x, rb.y, rb.r, rb.hue, rb.toy);
      }

      // Render Floating "بوب!" Cartoon Pop Labels
      for (let i = popTextsRef.current.length - 1; i >= 0; i--) {
        const pt = popTextsRef.current[i];
        pt.y -= 1.8;
        pt.life -= 0.028;
        if (pt.life <= 0) {
          popTextsRef.current.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = pt.life;
        ctx.fillStyle = '#9D174D';
        ctx.strokeStyle = '#FEF9C3';
        ctx.lineWidth = 5;
        ctx.font = `bold ${Math.round(minDim * 0.052)}px "IBM Plex Sans Arabic", sans-serif`;
        ctx.textAlign = 'center';
        ctx.strokeText(pt.text, pt.x, pt.y);
        ctx.fillText(pt.text, pt.x, pt.y);
        ctx.restore();
      }

      // Render Hearts, Stars & Confetti Ribbons
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity ?? 0.11;
        p.rot += p.vRot;
        p.life -= p.decay;

        if (p.life <= 0 || p.y > h + 80) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        if (p.shape === 'heart') {
          drawHeart(ctx, p.x, p.y, p.size, p.color, p.life, p.rot * 0.25);
        } else if (p.shape === 'rect') {
          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size * 0.65, -p.size * 0.32, p.size * 1.3, p.size * 0.64);
          ctx.restore();
        } else {
          drawStar(ctx, p.x, p.y, p.size, p.color, p.rot, p.life);
        }
      }
    };

    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [sceneIndex, assets, motionRef, gestureCommandRef]);

  return (
    <canvas
      ref={canvasRef}
      className="block w-screen h-screen touch-none select-none cursor-pointer"
      aria-label="عالم لولي الكرتوني التفاعلي"
    />
  );
}
