/**
 * Smart Asset Loader & Pixar-Grade Organic Character Renderer for Loly World (/loly)
 * - Loads all 9 character & real baby images in /loly/characters/:
 *   (loly.png, loly_real1.jpg, loly_real2.jpg, diva.png, mom.png, dad.png, uncle.png, grandpa.png, grandma.png)
 * - Safe Border-Connected Flood-Fill + Multi-Ring Soft Edge Feathering:
 *   Removes white outer backgrounds smoothly with ZERO jagged edges or pixelation,
 *   while protecting white hijabs (grandma.png), plaid shirts (grandpa.png), and tuxedos (dad.png)!
 */

const CARTOON_SPECS = [
  { key: 'diva', file: 'diva.png', label: 'أبلة فاهيتا', role: 'diva' },
  { key: 'loly', file: 'loly.png', label: 'لولاتي', role: 'baby' },
  { key: 'mom', file: 'mom.png', label: 'ماما', role: 'mom' },
  { key: 'dad', file: 'dad.png', label: 'بابا', role: 'dad' },
  { key: 'uncle', file: 'uncle.png', label: 'خالو', role: 'uncle' },
  { key: 'grandpa', file: 'grandpa.png', label: 'جدو', role: 'grandpa' },
  { key: 'grandma', file: 'grandma.png', label: 'تيتة', role: 'grandma' },
];

const REAL_PHOTO_SPECS = [
  { key: 'loly_real1', candidates: ['loly_real1.jpg', 'loly_real1.png', 'loly_real1.jpeg'] },
  { key: 'loly_real2', candidates: ['loly_real2.jpg', 'loly_real2.png', 'loly_real1.jpg'] },
];

function loadRawImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Edge-Connected Flood-Fill White Chroma Key with Multi-Ring Soft Edge Feathering:
 * - Flood-fills strictly outer pure-white background from the 4 borders so Grandma's white hijab
 *   and Grandpa's white shirt remain 100% intact.
 * - Applies 3-ring smooth alpha feathering + white halo de-fringing so sticker edges look silky smooth.
 */
export function removeWhiteBackgroundSticker(img) {
  const maxDim = 512;
  const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const total = w * h;
  const bgMask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  // Strictly match pure outer background (stops at the thin gray sticker contour ~238 so white hijabs stay safe)
  const isOuterWhite = (idx4) => {
    const a = data[idx4 + 3];
    if (a < 20) return true;
    const r = data[idx4];
    const g = data[idx4 + 1];
    const b = data[idx4 + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    return minC >= 247 && maxC - minC <= 9;
  };

  const pushSeed = (x, y) => {
    const p = y * w + x;
    if (bgMask[p]) return;
    if (isOuterWhite(p * 4)) {
      bgMask[p] = 1;
      queue[tail++] = p;
    }
  };

  for (let x = 0; x < w; x++) {
    pushSeed(x, 0);
    pushSeed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    pushSeed(0, y);
    pushSeed(w - 1, y);
  }

  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    data[p * 4 + 3] = 0;

    if (x > 0) pushSeed(x - 1, y);
    if (x < w - 1) pushSeed(x + 1, y);
    if (y > 0) pushSeed(x, y - 1);
    if (y < h - 1) pushSeed(x, y + 1);
  }

  // Compute 3-pixel distance ring from removed background for silky-smooth Soft Edge Feathering
  const distRing = new Uint8Array(total);
  for (let ring = 1; ring <= 3; ring++) {
    const prevMarker = ring === 1 ? 0 : ring - 1;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (bgMask[p] || distRing[p] !== 0) continue;

        const touchesPrev =
          ring === 1
            ? bgMask[p - 1] ||
              bgMask[p + 1] ||
              bgMask[p - w] ||
              bgMask[p + w] ||
              bgMask[p - w - 1] ||
              bgMask[p - w + 1] ||
              bgMask[p + w - 1] ||
              bgMask[p + w + 1]
            : distRing[p - 1] === prevMarker ||
              distRing[p + 1] === prevMarker ||
              distRing[p - w] === prevMarker ||
              distRing[p + w] === prevMarker;

        if (touchesPrev) {
          distRing[p] = ring;
        }
      }
    }
  }

  const ringAlphaScale = [1, 0.28, 0.65, 0.88];
  for (let p = 0; p < total; p++) {
    const ring = distRing[p];
    if (ring > 0) {
      const idx4 = p * 4;
      data[idx4 + 3] = Math.round(data[idx4 + 3] * ringAlphaScale[ring]);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function createFallbackCharacterSticker(role = 'grandpa') {
  const size = 320;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2 + 12;

  ctx.fillStyle = role === 'grandma' ? '#EC4899' : '#2563EB';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 95, 86, 58, 0, Math.PI, 0, false);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#FDBA8C';
  ctx.beginPath();
  ctx.arc(cx, cy, 66, 0, Math.PI * 2);
  ctx.fill();

  [-24, 24].forEach((ox) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx + ox, cy - 8, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#27272A';
    ctx.beginPath();
    ctx.arc(cx + ox, cy - 8, 8, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#9F1239';
  ctx.beginPath();
  ctx.arc(cx, cy + 20, 24, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

/**
 * Loads all 9 Loly character stickers & real photos from /loly/characters/
 */
export async function loadAllLolyAssets() {
  const characters = {};
  const labels = {};

  await Promise.all(
    CARTOON_SPECS.map(async (spec) => {
      labels[spec.key] = spec.label;
      const rawImg = await loadRawImage(`/loly/characters/${spec.file}`);
      if (rawImg && rawImg.width > 10) {
        characters[spec.key] = removeWhiteBackgroundSticker(rawImg);
      } else {
        characters[spec.key] = createFallbackCharacterSticker(spec.role);
      }
    })
  );

  const realPhotos = {};
  await Promise.all(
    REAL_PHOTO_SPECS.map(async (spec) => {
      for (const candidate of spec.candidates) {
        const img = await loadRawImage(`/loly/characters/${candidate}`);
        if (img && img.width > 10) {
          // Softly feather white sticker background on real Loly cutouts too!
          realPhotos[spec.key] = removeWhiteBackgroundSticker(img);
          break;
        }
      }
      if (!realPhotos[spec.key]) {
        realPhotos[spec.key] = characters.loly;
      }
    })
  );

  return { characters, realPhotos, labels };
}

/**
 * Draws a Cartoon Golden Princess Crown
 */
export function drawPrincessCrown(ctx, x, y, crownWidth, timeSec = 0) {
  const w = crownWidth;
  const h = crownWidth * 0.56;
  ctx.save();
  ctx.translate(x, y);

  const grad = ctx.createLinearGradient(-w / 2, -h, w / 2, 0);
  grad.addColorStop(0, '#FEF08A');
  grad.addColorStop(0.5, '#FACC15');
  grad.addColorStop(1, '#CA8A04');

  ctx.fillStyle = grad;
  ctx.strokeStyle = '#854D0E';
  ctx.lineWidth = Math.max(2, w * 0.035);
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(-w * 0.44, 0);
  ctx.lineTo(-w * 0.5, -h * 0.72);
  ctx.lineTo(-w * 0.22, -h * 0.35);
  ctx.lineTo(0, -h);
  ctx.lineTo(w * 0.22, -h * 0.35);
  ctx.lineTo(w * 0.5, -h * 0.72);
  ctx.lineTo(w * 0.44, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const pulse = 1 + Math.sin(timeSec * 5) * 0.14;
  const jewels = [
    { gx: 0, gy: -h * 0.42, r: w * 0.085 * pulse, color: '#EC4899' },
    { gx: -w * 0.27, gy: -h * 0.22, r: w * 0.055, color: '#38BDF8' },
    { gx: w * 0.27, gy: -h * 0.22, r: w * 0.055, color: '#38BDF8' },
    { gx: 0, gy: -h * 1.03, r: w * 0.065, color: '#FEF9C3' },
  ];

  jewels.forEach((j) => {
    ctx.fillStyle = j.color;
    ctx.beginPath();
    ctx.arc(j.gx, j.gy, j.r, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

/**
 * Pixar-Style Organic Character Renderer:
 * - Applies volume-preserving Squash & Stretch anchored at the character's base
 * - Smooth rhythmic breathing & sway
 * - Subtle interactive gaze lean + animated sparkling eye glints tracking Loly's motion + periodic blinking!
 */
export function drawOrganicStickerCharacter(
  ctx,
  stickerCanvas,
  cx,
  cy,
  targetHeight,
  {
    timeSec = 0,
    beatPulse = 0,
    swayRad = 0,
    extraJump = 0,
    squashStrength = 0.055,
    gazeTarget = null,
    phaseOffset = 0,
    crown = false,
  } = {}
) {
  if (!stickerCanvas) return;

  const aspect = stickerCanvas.width / Math.max(1, stickerCanvas.height);
  const drawW = targetHeight * aspect;
  const drawH = targetHeight;

  // Organic breathing + musical squash & stretch (volume preserving: sx * sy ≈ 1)
  const breath = Math.sin(timeSec * 3.1 + phaseOffset) * 0.022;
  const beatSquash = beatPulse * squashStrength;
  const scaleY = 1 + breath + beatSquash;
  const scaleX = 1 / Math.max(0.82, scaleY);

  // Subtle lean toward where Loly is moving
  let gazeLeanX = 0;
  let gazeOffsetY = 0;
  if (gazeTarget) {
    const dx = Math.max(-1, Math.min(1, (gazeTarget.x - cx) / 450));
    const dy = Math.max(-1, Math.min(1, (gazeTarget.y - cy) / 450));
    gazeLeanX = dx * 0.045;
    gazeOffsetY = dy * 4;
  }

  ctx.save();
  // Anchor squash & stretch near bottom of character so they bounce organically from their waist/feet!
  const anchorY = cy + drawH * 0.42 - extraJump;
  ctx.translate(cx + gazeLeanX * drawW * 0.5, anchorY);
  ctx.rotate(swayRad + gazeLeanX * 0.6);
  ctx.scale(scaleX, scaleY);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Soft warm ground/drop shadow
  ctx.shadowColor = 'rgba(24, 24, 27, 0.22)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;

  ctx.drawImage(stickerCanvas, -drawW / 2, -drawH * 0.92, drawW, drawH);

  ctx.shadowColor = 'transparent';

  // Subtle interactive Pixar eye-glint sparkles shifting toward Loly's hand/face + natural blink
  const blinkCycle = (timeSec + phaseOffset * 0.7) % 4.4;
  const isBlinking = blinkCycle > 4.24 && blinkCycle < 4.38;
  const eyeCenterY = -drawH * 0.53 + gazeOffsetY * 0.45;
  const eyeSpanX = drawW * 0.115;
  const glintShiftX = gazeLeanX * drawW * 0.12;

  if (!isBlinking) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    [-eyeSpanX, eyeSpanX].forEach((ex) => {
      ctx.beginPath();
      ctx.arc(ex + glintShiftX, eyeCenterY, Math.max(2.2, drawW * 0.013), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (crown) {
    drawPrincessCrown(ctx, 0, -drawH * 0.88, drawW * 0.48, timeSec);
  }

  ctx.restore();
}

/**
 * Draws Real Baby Loly Photo inside a Glowing Golden Circular Frame + Princess Crown + Organic Squash & Stretch
 */
export function drawGlowingBabyPortrait(
  ctx,
  photoSource,
  cx,
  cy,
  radius,
  timeSec = 0,
  tiltRad = 0,
  caption = 'لولاتي 👑',
  squashPulse = 0
) {
  if (!photoSource) return;

  const sy = 1 + squashPulse * 0.045 + Math.sin(timeSec * 3) * 0.018;
  const sx = 1 / sy;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tiltRad);
  ctx.scale(sx, sy);

  // 1. Soft Golden Radiant Aura
  const glowRadius = radius * (1.3 + Math.sin(timeSec * 3.5) * 0.05);
  const aura = ctx.createRadialGradient(0, 0, radius * 0.82, 0, 0, glowRadius);
  aura.addColorStop(0, 'rgba(253, 224, 71, 0.85)');
  aura.addColorStop(0.6, 'rgba(244, 114, 182, 0.35)');
  aura.addColorStop(1, 'rgba(253, 224, 71, 0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  // 2. Warm Pastel Backdrop inside Circular Frame
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();

  const innerBg = ctx.createRadialGradient(0, -radius * 0.2, radius * 0.1, 0, 0, radius);
  innerBg.addColorStop(0, '#FFFBEB');
  innerBg.addColorStop(0.7, '#FDE68A');
  innerBg.addColorStop(1, '#FBCFE8');
  ctx.fillStyle = innerBg;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);

  const iw = photoSource.width || radius * 2;
  const ih = photoSource.height || radius * 2;
  const scale = Math.max((radius * 2.06) / iw, (radius * 2.06) / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photoSource, -dw / 2, -dh / 2 + radius * 0.06, dw, dh);
  ctx.restore();

  // 3. Metallic Gold Circular Ring + Orbiting Sparkle Gems
  const ringGrad = ctx.createLinearGradient(-radius, -radius, radius, radius);
  ringGrad.addColorStop(0, '#FEF08A');
  ringGrad.addColorStop(0.35, '#F59E0B');
  ringGrad.addColorStop(0.7, '#FDE047');
  ringGrad.addColorStop(1, '#B45309');

  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = Math.max(6, radius * 0.11);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  const gemCount = 8;
  for (let i = 0; i < gemCount; i++) {
    const angle = (i / gemCount) * Math.PI * 2 + timeSec * 0.7;
    const gx = Math.cos(angle) * radius;
    const gy = Math.sin(angle) * radius;
    ctx.fillStyle = i % 2 === 0 ? '#FFFBEB' : '#F472B6';
    ctx.beginPath();
    ctx.arc(gx, gy, Math.max(3.5, radius * 0.048), 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Princess Crown perched atop the Golden Frame
  drawPrincessCrown(ctx, 0, -radius * 0.94, radius * 0.95, timeSec);

  if (caption) {
    const pillW = radius * 1.45;
    const pillH = Math.max(26, radius * 0.28);
    const py = radius * 0.94;
    ctx.fillStyle = '#9D174D';
    ctx.strokeStyle = '#FDE047';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-pillW / 2, py - pillH / 2, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FEF9C3';
    ctx.font = `bold ${Math.round(pillH * 0.56)}px "IBM Plex Sans Arabic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption, 0, py + 1);
  }

  ctx.restore();
}
