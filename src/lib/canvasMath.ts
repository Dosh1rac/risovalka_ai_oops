// Чистые функции без DOM — их легко проверять отдельно от интерфейса.

/** Внутреннее разрешение холста. Оно НЕ меняется при ресайзе окна, поэтому
 *  рисунок никогда не пересэмплируется и не «мылится». */
export const CANVAS_W = 9600;
export const CANVAS_H = 6000;

export type Rect = { left: number; top: number; width: number; height: number };

/** Размер холста на экране (CSS-пиксели): вписываем в область с отступом. */
export function fitSize(areaW: number, areaH: number, pad = 20) {
  const availW = Math.max(120, areaW - pad * 2);
  const availH = Math.max(120, areaH - pad * 2);
  // Рендерим холст в 3 раза крупнее области просмотра: пользователь видит
  // только участок большого полотна и может перемещаться по другим участкам.
  const scale = Math.min(availW / 1600, availH / 1000);
  return { w: Math.max(1, Math.floor(1600 * scale * 6)), h: Math.max(1, Math.floor(1000 * scale * 6)) };
}

/**
 * Экранная точка -> пиксель холста.
 * rect — это getBoundingClientRect() самого <canvas> ПОСЛЕ всех CSS-трансформаций
 * (масштаб, сдвиг, зум браузера, масштаб Windows). Поэтому формула верна всегда
 * и не зависит ни от zoom, ни от offsetX, ни от DPR.
 */
export function clientToCanvas(clientX: number, clientY: number, rect: Rect) {
  const rx = (clientX - rect.left) / Math.max(rect.width, 1e-6);
  const ry = (clientY - rect.top) / Math.max(rect.height, 1e-6);
  const inside = rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1;
  const cx = Math.min(1, Math.max(0, rx));
  const cy = Math.min(1, Math.max(0, ry));
  return { x: cx * CANVAS_W, y: cy * CANVAS_H, inside };
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Заливка с запасом на сглаженные края линий.
 * Работает прямо с пикселями (data — RGBA, как ImageData.data).
 * Возвращает false, если заливать нечего.
 */
export function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  rgb: [number, number, number],
  tolerance = 100,
): boolean {
  const sx = Math.max(0, Math.min(width - 1, Math.floor(startX)));
  const sy = Math.max(0, Math.min(height - 1, Math.floor(startY)));
  const s = (sy * width + sx) * 4;
  const tr = data[s], tg = data[s + 1], tb = data[s + 2];
  if (tr === rgb[0] && tg === rgb[1] && tb === rgb[2]) return false;

  const tol2 = tolerance * tolerance;
  const matches = (i: number) => {
    const dr = data[i] - tr, dg = data[i + 1] - tg, db = data[i + 2] - tb;
    return dr * dr + dg * dg + db * db <= tol2;
  };

  const filled = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const stack: number[] = [sy * width + sx];
  let minX = sx, maxX = sx, minY = sy, maxY = sy;

  while (stack.length) {
    const pos = stack.pop()!;
    if (visited[pos]) continue;
    visited[pos] = 1;
    if (!matches(pos * 4)) continue;
    filled[pos] = 1;
    const px = pos % width;
    const py = (pos - px) / width;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    if (px + 1 < width) stack.push(pos + 1);
    if (px > 0) stack.push(pos - 1);
    if (py + 1 < height) stack.push(pos + width);
    if (py > 0) stack.push(pos - width);
  }

  const paint = (pos: number) => {
    const i = pos * 4;
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  };
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) if (filled[y * width + x]) paint(y * width + x);
  }

  // Два прохода «подтяжки» цвета к контуру: закрашиваем только светлые
  // пиксели сглаживания рядом с заливкой, тёмная линия остаётся нетронутой.
  let edge = filled;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(width * height);
    const y0 = Math.max(0, minY - 3), y1 = Math.min(height - 1, maxY + 3);
    const x0 = Math.max(0, minX - 3), x1 = Math.min(width - 1, maxX + 3);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const pos = y * width + x;
        if (edge[pos]) continue;
        let near = false;
        for (let oy = -1; oy <= 1 && !near; oy++) {
          const ny = y + oy;
          if (ny < 0 || ny >= height) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            if (nx >= 0 && nx < width && edge[ny * width + nx]) { near = true; break; }
          }
        }
        if (!near) continue;
        const i = pos * 4;
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const dist = Math.sqrt((255 - data[i]) ** 2 + (255 - data[i + 1]) ** 2 + (255 - data[i + 2]) ** 2);
        if (brightness >= 100 && dist <= 230) { next[pos] = 1; paint(pos); }
      }
    }
    edge = next;
  }
  return true;
}
