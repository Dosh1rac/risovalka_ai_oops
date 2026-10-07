import { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  Brush,
  Eraser,
  RotateCcw,
  RotateCw,
  Trash2,
  Sparkles,
  Download,
  Volume2,
  VolumeX,
  X,
  LoaderCircle,
} from 'lucide-react';

const COLORS = [
  '#1E293B', '#EF4444', '#F97316', '#FACC15', '#22C55E',
  '#06B6D4', '#3B82F6', '#A855F7', '#EC4899', '#78350F',
];

const STYLES = [
  { id: 'bright-cartoon', name: 'Мультфильм', emoji: '🌈', description: 'яркие цвета · чистые контуры', badge: 'Самый универсальный' },
  { id: 'comic', name: 'Комикс', emoji: '💥', description: 'чернила · ракурсы · экшен', badge: 'Бум! Вау!' },
  { id: 'storybook', name: 'Сказка', emoji: '🪄', description: 'книжная иллюстрация · волшебство', badge: 'Как в сказочной книге' },
  { id: 'watercolor', name: 'Акварель', emoji: '🎨', description: 'бумага · мазки · мягкие цвета', badge: 'Рисованная вручную' },
  { id: 'anime', name: 'Аниме', emoji: '⭐', description: 'выразительные глаза · cel-shading', badge: 'Аниме-стиль' },
  { id: 'clay', name: 'Пластилин', emoji: '🧸', description: 'объём · мягкий свет · стоп-моушн', badge: 'Будто слепили руками' },
  { id: 'doll', name: 'Кукольный', emoji: '🎀', description: 'глянцевые детали · мягкий свет', badge: 'Как игрушечная кукла' },
  { id: 'impressionism', name: 'Импрессионизм', emoji: '🖼️', description: 'живые мазки · свет · цвет', badge: 'Как настоящая картина' },
  { id: 'tarot', name: 'Таро', emoji: '🔮', description: 'мистика · символы · карта', badge: 'Как иллюстрированная карта' },
  { id: 'stickers', name: 'Стикеры', emoji: '✨', description: 'ярко · толстый контур · наклейка', badge: 'Как набор наклеек' },
  { id: 'y2k', name: 'Нулевые', emoji: '💿', description: 'Y2K · глянец · цифровой стиль', badge: 'Эстетика 2000-х' },
  { id: 'rick-morty', name: 'Рик и Морти', emoji: '🛸', description: 'sci-fi · чёрный юмор · мультфильм', badge: 'Без реализма' },
];

const TIPS = [
  'Рассматриваю именно твой рисунок…',
  'Сохраняю форму и расположение твоих объектов…',
  'Превращаю линии в аккуратные мультяшные формы…',
  'Добавляю цвет, свет и выразительные контуры…',
  'Почти готово — не меняю твою задумку! 🎨',
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });
  const historyRef = useRef<ImageData[]>([]);
  const historyIndexRef = useRef(-1);
  const audioRef = useRef<AudioContext | null>(null);

  const [tool, setTool] = useState<'brush' | 'eraser' | 'rainbow' | 'fill'>('brush');
  const [zoom, setZoom] = useState(1);
  const [color, setColor] = useState('#1E293B');
  const [size, setSize] = useState(12);
  const [style, setStyle] = useState('bright-cartoon');
  const [sound, setSound] = useState(true);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const playSound = useCallback((kind: 'tap' | 'magic' | 'done' | 'clear') => {
    if (!sound || typeof window === 'undefined') return;
    try {
      const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;
      const ctx = audioRef.current ?? new AudioCtor();
      audioRef.current = ctx;
      const notes = kind === 'done' ? [523, 659, 784, 1047] : kind === 'magic' ? [392, 523, 659, 784] : kind === 'clear' ? [360, 220] : [500, 760];
      notes.forEach((frequency, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = ctx.currentTime + i * (kind === 'done' || kind === 'magic' ? 0.07 : 0);
        osc.type = kind === 'clear' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.08, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + (kind === 'clear' ? 0.22 : 0.16));
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.24);
      });
    } catch {
      // Audio is optional.
    }
  }, [sound]);

  const saveHistory = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !ctx) return;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }
    historyRef.current.push(image);
    if (historyRef.current.length > 30) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
    setHasDrawing(true);
  }, []);

  const clearCanvas = useCallback((record = true) => {
    const canvas = canvasRef.current;
    const board = boardRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !board || !ctx) return;
    const rect = board.getBoundingClientRect();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (record) {
      saveHistory();
    }
    setHasDrawing(false);
  }, [saveHistory]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const board = boardRef.current;
    if (!canvas || !board) return;
    const rect = board.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const old = canvas.width && canvas.height ? canvas.toDataURL('image/png') : null;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, rect.width, rect.height);
    if (old) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = old;
    } else {
      historyRef.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)];
      historyIndexRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    }
  }, []);

  useEffect(() => {
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    if (boardRef.current) observer.observe(boardRef.current);
    return () => observer.disconnect();
  }, [resizeCanvas]);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => setTipIndex((v) => (v + 1) % TIPS.length), 2200);
    return () => window.clearInterval(id);
  }, [loading]);

const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
  const canvas = canvasRef.current!;
  const rect = canvas.getBoundingClientRect();

  return {
    x: (event.clientX - rect.left) / zoom,
    y: (event.clientY - rect.top) / zoom
  };
};


  const floodFill = (x: number, y: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !ctx) return;

    // ImageData хранится в физических пикселях (с учётом DPR), а координаты
    // указателя приходят в CSS-пикселях. Поэтому переводим точку клика в
    // реальные пиксели холста.
    const rect = canvas.getBoundingClientRect();
    const baseWidth = canvas.clientWidth || (rect.width / zoom);
    const baseHeight = canvas.clientHeight || (rect.height / zoom);
    const scaleX = canvas.width / baseWidth;
    const scaleY = canvas.height / baseHeight;
    const startX = Math.max(0, Math.min(canvas.width - 1, Math.floor(x * scaleX)));
    const startY = Math.max(0, Math.min(canvas.height - 1, Math.floor(y * scaleY)));

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const width = canvas.width;
    const height = canvas.height;
    const idx = (px: number, py: number) => (py * width + px) * 4;
    const start = idx(startX, startY);
    const target = [data[start], data[start + 1], data[start + 2], data[start + 3]];

    const hex = color.replace('#', '');
    const rgb = hex.match(/.{2}/g)?.map((v) => parseInt(v, 16));
    if (!rgb || rgb.length !== 3) return;
    const replacement = [rgb[0], rgb[1], rgb[2], 255];

    if (
      target[0] === replacement[0] &&
      target[1] === replacement[1] &&
      target[2] === replacement[2] &&
      target[3] === replacement[3]
    ) return;

    // Сглаживание контура создаёт несколько светлых пикселей между заливкой
    // и тёмной линией. Обычный flood-fill их не всегда забирает, поэтому
    // сначала заполняем область, а затем аккуратно «подводим» цвет к контуру.
    // Тёмные пиксели контура при этом не трогаем.
    const tolerance = 220;
    const matches = (i: number) => {
      const dr = data[i] - target[0];
      const dg = data[i + 1] - target[1];
      const db = data[i + 2] - target[2];
      return (dr * dr + dg * dg + db * db) <= tolerance * tolerance;
    };

    const stack: Array<[number, number]> = [[startX, startY]];
    const visited = new Uint8Array(width * height);
    const filled = new Uint8Array(width * height);

    while (stack.length) {
      const [px, py] = stack.pop()!;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;

      const pos = py * width + px;
      if (visited[pos]) continue;
      visited[pos] = 1;

      const i = pos * 4;
      if (!matches(i)) continue;

      filled[pos] = 1;
      data[i] = replacement[0];
      data[i + 1] = replacement[1];
      data[i + 2] = replacement[2];
      data[i + 3] = 255;

      stack.push(
        [px + 1, py],
        [px - 1, py],
        [px, py + 1],
        [px, py - 1],
      );
    }

    // Убираем тонкий светлый ореол у сглаженного контура. Расширяем маску
    // только на 2 физических пикселя и только в светлые пиксели — сам тёмный
    // контур остаётся нетронутым.
    let edge = filled;
    for (let pass = 0; pass < 2; pass += 1) {
      const next = new Uint8Array(width * height);
      for (let py = 0; py < height; py += 1) {
        for (let px = 0; px < width; px += 1) {
          const pos = py * width + px;
          if (edge[pos]) continue;

          let nearFill = false;
          for (let oy = -1; oy <= 1 && !nearFill; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
              const nx = px + ox;
              const ny = py + oy;
              if (nx >= 0 && ny >= 0 && nx < width && ny < height && edge[ny * width + nx]) {
                nearFill = true;
              }
            }
          }
          if (!nearFill) continue;

          const i = pos * 4;
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          const distanceFromWhite = Math.sqrt(
            (255 - data[i]) ** 2 +
            (255 - data[i + 1]) ** 2 +
            (255 - data[i + 2]) ** 2,
          );

          // Светлый anti-aliasing пиксель можно заменить цветом заливки;
          // тёмная линия (и её насыщенные пиксели) останется на месте.
          if (brightness >= 100 && distanceFromWhite <= 230) {
            next[pos] = 1;
            data[i] = replacement[0];
            data[i + 1] = replacement[1];
            data[i + 2] = replacement[2];
            data[i + 3] = 255;
          }
        }
      }
      edge = next;
    }

    ctx.putImageData(image, 0, 0);
    saveHistory();
    setHasDrawing(true);
  };

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    if (tool === 'fill') {
      const p = point(event);
      floodFill(Math.floor(p.x), Math.floor(p.y));
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const p = point(event);
    lastPointRef.current = p;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = tool === 'eraser' ? '#FFFFFF' : color;
    ctx.fill();
    playSound('tap');
  };

  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const p = point(event);
    const last = lastPointRef.current;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : tool === 'rainbow' ? `hsl(${(p.x + p.y) % 360}, 90%, 55%)` : color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPointRef.current = p;
  };

  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try { canvasRef.current?.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    saveHistory();
  };

  const undo = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const image = historyRef.current[historyIndexRef.current];
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !image) return;
    ctx.putImageData(image, 0, 0);
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(true);
    setHasDrawing(historyIndexRef.current > 0);
    playSound('tap');
  };

  const redo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const image = historyRef.current[historyIndexRef.current];
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !image) return;
    ctx.putImageData(image, 0, 0);
    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
    setHasDrawing(true);
    playSound('tap');
  };

  const transform = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawing || loading) {
      setError('Сначала нарисуй что-нибудь на доске! 🎨');
      return;
    }
    // 1x PNG без прозрачности: модель получает ровно то, что видит ребёнок.
    const image = canvas.toDataURL('image/png', 1);
    setSourceImage(image);
    setLoading(true);
    setTipIndex(0);
    setError(null);
    playSound('magic');

    try {
      const response = await fetch('/api/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, style }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success || !data.image) {
        throw new Error(data.detail || data.error || 'Нейросеть не вернула изображение.');
      }
      setResultImage(data.image);
      playSound('done');
      confetti({ particleCount: 100, spread: 75, origin: { y: 0.6 } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось превратить рисунок в мультфильм.');
    } finally {
      setLoading(false);
    }
  };

  const downloadResult = () => {
    if (!resultImage) return;
    const a = document.createElement('a');
    a.href = resultImage;
    a.download = `nanobanana-${Date.now()}.png`;
    a.click();
  };

  const resetResult = () => {
    setResultImage(null);
    setSourceImage(null);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="subtitle">Рисуй что угодно — ИИ оживит именно твой рисунок</div>
        </div>
        <div className="status-pill">● РЕЖИМ: РИСУНОК → МУЛЬТФИЛЬМ</div>
      </header>

      <div className="workspace">
        <aside className="panel tools-panel">
          <section>
            <h3>Инструменты</h3>
            <div className="tool-row">
              <button className={`tool-btn ${tool === 'brush' ? 'active' : ''}`} onClick={() => setTool('brush')}><Brush size={18}/> Кисть</button>
              <button className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')}><Eraser size={18}/> Ластик</button>
              <button className={`tool-btn ${tool === 'rainbow' ? 'active' : ''}`} onClick={() => setTool('rainbow')}>🌈 Радуга</button>
              <button className={`tool-btn ${tool === 'fill' ? 'active' : ''}`} onClick={() => setTool('fill')}>🪣 Заливка</button>
            </div>
          </section>

          <section>
            <h3>Размер кисти <span>{size}px</span></h3>
            <input type="range" min="3" max="48" value={size} onChange={(e) => setSize(Number(e.target.value))}/>
          </section>

          <section>
            <h3>Цвет</h3>
            <div className="colors">
              {COLORS.map((item) => <button key={item} aria-label={item} className={`color-dot ${color === item && tool !== 'rainbow' ? 'selected' : ''}`} style={{ background: item }} onClick={() => { setColor(item); setTool('brush'); playSound('tap'); }}/>) }
            </div>
            <label className="custom-color">Другой цвет <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setTool('brush'); }}/></label>
          </section>

          <section>
            <h3>Как оживить рисунок <span>11 стилей</span></h3>
            <div className="style-list">
              {STYLES.map((item) => (
                <button key={item.id} className={`style-card style-${item.id} ${style === item.id ? 'selected' : ''}`} onClick={() => { setStyle(item.id); playSound('tap'); }}>
                  <span className="style-preview"><span>{item.emoji}</span><i></i><i></i><i></i></span>
                  <span className="style-copy"><b>{item.name}</b><small>{item.description}</small><em>{item.badge}</em></span>
                </button>
              ))}
            </div>
          </section>

          <div className="panel-actions">
            <button disabled={!canUndo} onClick={undo}><RotateCcw size={16}/> Назад</button>
            <button disabled={!canRedo} onClick={redo}><RotateCw size={16}/> Вперёд</button>
            <button onClick={() => { clearCanvas(); playSound('clear'); }} className="danger"><Trash2 size={16}/></button>
          </div>
        </aside>

        <main className="canvas-area">
          <div ref={boardRef} className="canvas-board">
            <div className="board-hint">👆 Рисуй пальцем, мышкой или стилусом</div>

            <div className="zoom-controls" aria-label="Масштаб холста">
              <button type="button" aria-label="Уменьшить" title="Уменьшить" onClick={() => setZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}>−</button>
              <button type="button" className="zoom-value" aria-label="Сбросить масштаб" title="Сбросить масштаб" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <button type="button" aria-label="Приблизить" title="Приблизить" onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}>+</button>
            </div>

            <div className="canvas-zoom">
              <canvas
                ref={canvasRef}
                style={{ transform: `scale(${zoom})` }}
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerUp}
              />
            </div>
          </div>

          <button className="magic-btn" disabled={loading} onClick={transform}>
            <Sparkles size={25}/>
            <span>
              <b>Превратить мой рисунок!</b>
              <small>ИИ обязан сохранить то, что я нарисовал</small>
            </span>
          </button>
        </main>

        <aside className="panel help-panel">
          <h3>Как это работает</h3>
          <div className="steps">
            <div><b>1</b><span>Нарисуй любой предмет, героя или сцену.</span></div>
            <div><b>2</b><span>Выбери стиль мультфильма.</span></div>
            <div><b>3</b><span>Нажми кнопку превращения.</span></div>
          </div>
          <div className="important">
            <strong>🔒 Важное правило</strong>
            <p>ИИ получает сам PNG с холста. Он не получает описание вроде «нарисуй кота» — его задача только преобразовать твой исходный рисунок.</p>
          </div>
          <button className="sound-btn" onClick={() => setSound((v) => !v)}>{sound ? <Volume2 size={17}/> : <VolumeX size={17}/>} Звук {sound ? 'включён' : 'выключен'}</button>
        </aside>
      </div>

      {error && <div className="toast" onClick={() => setError(null)}>⚠️ {error}</div>}

      {loading && (
        <div className="overlay">
          <div className="loader-card">
            <div className="loader-icon"><span>🍌</span><Sparkles size={26}/></div>
            <h2>Оживляю именно твой рисунок</h2>
            <p>{TIPS[tipIndex]}</p>
            <div className="loader-bar"><span/></div>
            <small>Это может занять несколько секунд</small>
          </div>
        </div>
      )}

      {resultImage && (
        <div className="overlay result-overlay">
          <div className="result-card">
            <button className="close-btn" onClick={resetResult}><X size={20}/></button>
            <div className="result-head"><span>🎉 Готово!</span><h2>Твой рисунок превратился в мультфильм</h2></div>
            <div className="comparison">
              <figure><figcaption>Твой рисунок</figcaption><img src={sourceImage ?? ''} alt="Исходный рисунок"/></figure>
              <figure><figcaption>Результат ИИ</figcaption><img src={resultImage} alt="Мультяшный результат"/></figure>
            </div>
            <div className="result-actions">
              <button onClick={downloadResult}><Download size={18}/> Сохранить PNG</button>
              <button onClick={resetResult}>Продолжить рисовать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
