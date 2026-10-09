import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, PointerEvent as RPointerEvent } from 'react';
import confetti from 'canvas-confetti';
import {
  Brush,
  Eraser,
  FolderOpen,
  Hand,
  LogOut,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Download,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { CANVAS_H, CANVAS_W, clientToCanvas, fitSize, floodFill, hexToRgb } from './lib/canvasMath';
import { deleteSaved, listSaved, migrateLegacy, putSaved, type SavedCanvas } from './lib/savedCanvases';

const COLORS = [
  '#1E293B', '#EF4444', '#F97316', '#FACC15', '#22C55E',
  '#06B6D4', '#3B82F6', '#A855F7', '#EC4899', '#78350F',
];

// id должны совпадать с ключами STYLES в server.ts
const STYLES = [
  { id: 'bright-cartoon', name: 'Мультфильм', emoji: '🌈', description: 'яркие цвета · чистые контуры' },
  { id: 'comic', name: 'Комикс', emoji: '💥', description: 'чернила · ракурсы · экшен' },
  { id: 'storybook', name: 'Сказка', emoji: '🪄', description: 'книжная иллюстрация · волшебство' },
  { id: 'watercolor', name: 'Акварель', emoji: '🎨', description: 'бумага · мазки · мягкие цвета' },
  { id: 'anime', name: 'Аниме', emoji: '⭐', description: 'выразительные глаза · cel-shading' },
  { id: 'clay', name: 'Пластилин', emoji: '🧸', description: 'объём · мягкий свет · стоп-моушн' },
  { id: 'doll', name: 'Кукольный', emoji: '🎀', description: 'глянцевые детали · мягкий свет' },
  { id: 'impressionism', name: 'Импрессионизм', emoji: '🖼️', description: 'живые мазки · свет · цвет' },
  { id: 'tarot', name: 'Таро', emoji: '🔮', description: 'мистика · символы · карта' },
  { id: 'stickers', name: 'Стикеры', emoji: '✨', description: 'ярко · толстый контур · наклейка' },
  { id: 'rick-morty', name: 'Рик и Морти', emoji: '🛸', description: 'sci-fi · чёрный юмор' },
  { id: 'treasure-island', name: 'Остров сокровищ', emoji: '🏴‍☠️', description: 'карта сокровищ · приключения' },
  { id: 'lego', name: 'Лего', emoji: '🧱', description: 'кубики · пластиковые детали' },
  { id: 'roblox', name: 'Роблокс', emoji: '🎮', description: 'блочный мир · игровой стиль' },
  { id: 'origami', name: 'Оригами', emoji: '🦢', description: 'складки бумаги · геометрия' },
] as const;

type Tool = 'brush' | 'eraser' | 'rainbow' | 'fill' | 'pan';
type Toast = { kind: 'error' | 'ok'; text: string } | null;
type HistoryEntry = { image: ImageData; blank: boolean };

const HISTORY_LIMIT = 5;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

const tipsFor = (styleName: string) => [
  'Рассматриваю именно твой рисунок…',
  'Сохраняю форму и расположение твоих объектов…',
  `Превращаю рисунок в стиль «${styleName}»…`,
  `Добавляю детали в стиле «${styleName}»…`,
  'Почти готово — не меняю твою задумку! 🎨',
];

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Вписываем холст в белый квадрат: модель получает рисунок без растяжения. */
function squareDataUrl(src: HTMLCanvasElement): string {
  const side = Math.max(src.width, src.height);
  const out = document.createElement('canvas');
  out.width = side;
  out.height = side;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, side, side);
  ctx.drawImage(src, (side - src.width) / 2, (side - src.height) / 2);
  return out.toDataURL('image/png');
}

function makeThumb(src: HTMLCanvasElement): string {
  const out = document.createElement('canvas');
  out.width = 320;
  out.height = Math.round((320 * CANVAS_H) / CANVAS_W);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.75);
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<AudioContext | null>(null);

  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const activePointerRef = useRef<number | null>(null);
  const lastActivityRef = useRef(0);
  const strokeRef = useRef<{ last: { x: number; y: number }; hue: number } | null>(null);
  const panStartRef = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  const [everAuthed, setEverAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#1E293B');
  const [size, setSize] = useState(12);
  const [style, setStyle] = useState<(typeof STYLES)[number]['id']>('bright-cartoon');
  const [sound, setSound] = useState(true);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  const [hasDrawing, setHasDrawing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const [toast, setToast] = useState<Toast>(null);

  const [resultOpen, setResultOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultStyleId, setResultStyleId] = useState<string>('bright-cartoon');

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saved, setSaved] = useState<SavedCanvas[]>([]);
  const [saveName, setSaveName] = useState('');

  const appVisible = auth === 'in' || everAuthed;
  const display = useMemo(
    () => (stageSize.w > 0 ? fitSize(stageSize.w, stageSize.h) : { w: 960, h: 600 }),
    [stageSize],
  );
  const displayRef = useRef(display);
  displayRef.current = display;

  const styleInfo = STYLES.find((s) => s.id === style)!;
  const resultStyleName = STYLES.find((s) => s.id === resultStyleId)?.name ?? '';

  const getCtx = () => canvasRef.current?.getContext('2d', { willReadFrequently: true }) ?? null;

  const showToast = useCallback((kind: 'error' | 'ok', text: string) => setToast({ kind, text }), []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.kind === 'ok' ? 3000 : 7000);
    return () => window.clearTimeout(id);
  }, [toast]);

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
      // Звук необязателен.
    }
  }, [sound]);

  // ---------- Авторизация ----------
  useEffect(() => {
    fetch('/api/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setAuth(d.authenticated ? 'in' : 'out'))
      .catch(() => setAuth('out'));
  }, []);

  useEffect(() => {
    if (auth === 'in') setEverAuthed(true);
  }, [auth]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (loginBusy) return;
    setAuthError('');
    setLoginBusy(true);
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || 'Не удалось войти');
      setPassword('');
      setAuth('in');
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Ошибка авторизации');
    } finally {
      setLoginBusy(false);
    }
  };

  const logout = async () => {
    abortRef.current?.abort();
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* noop */ }
    setResultOpen(false);
    setLibraryOpen(false);
    setEverAuthed(false);
    setAuth('out');
  };

  // ---------- История (undo / redo) ----------
  const syncHistoryState = () => {
    const h = historyRef.current;
    const i = historyIndexRef.current;
    setCanUndo(i > 0);
    setCanRedo(i >= 0 && i < h.length - 1);
    setHasDrawing(i >= 0 && !!h[i] && !h[i].blank);
  };

  const pushHistory = (blank = false) => {
    const ctx = getCtx();
    if (!ctx) return;
    const h = historyRef.current;
    h.length = historyIndexRef.current + 1; // отбрасываем «будущее»
    h.push({ image: ctx.getImageData(0, 0, CANVAS_W, CANVAS_H), blank });
    while (h.length > HISTORY_LIMIT) h.shift();
    historyIndexRef.current = h.length - 1;
    syncHistoryState();
  };

  // Инициализация холста: фиксированное разрешение, ресайз окна его не трогает.
  useEffect(() => {
    if (!appVisible) return;
    const ctx = getCtx();
    if (!ctx) return;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    historyRef.current = [{ image: ctx.getImageData(0, 0, CANVAS_W, CANVAS_H), blank: true }];
    historyIndexRef.current = 0;
    syncHistoryState();
    return () => {
      historyRef.current = [];
      historyIndexRef.current = -1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appVisible]);

  // Размер области рисования нужен только для CSS-вписывания (битмап не пересоздаётся).
  useEffect(() => {
    if (!appVisible) return;
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [appVisible]);

  const restoreHistory = (index: number) => {
    const entry = historyRef.current[index];
    const ctx = getCtx();
    if (!entry || !ctx) return;
    historyIndexRef.current = index;
    ctx.putImageData(entry.image, 0, 0);
    syncHistoryState();
    playSound('tap');
  };

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) restoreHistory(historyIndexRef.current - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSound]);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) restoreHistory(historyIndexRef.current + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSound]);

  const clearCanvas = () => {
    const ctx = getCtx();
    if (!ctx) return;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    pushHistory(true);
    playSound('clear');
  };

  useEffect(() => {
    if (!appVisible) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [appVisible, undo, redo]);

  // ---------- Масштаб и сдвиг ----------
  const clampPan = (p: { x: number; y: number }, z: number) => {
    if (!stageSize.w) return p;
    const maxX = (display.w * z) / 2 + stageSize.w / 2 - 120;
    const maxY = (display.h * z) / 2 + stageSize.h / 2 - 120;
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
  };

  const changeZoom = (next: number) => {
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(next.toFixed(2))));
    setZoom(z);
    setPan((p) => clampPan(p, z));
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // ---------- Рисование ----------
  // Размер кисти задан в «экранных пикселях при масштабе 100%», переводим в пиксели холста.
  const brushPx = () => size * (CANVAS_W / displayRef.current.w);

  const eraseSquare = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => {
    // Целые координаты: дробные края дают полупрозрачный «призрак» старой линии.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(Math.floor(x - s / 2), Math.floor(y - s / 2), Math.ceil(s) + 1, Math.ceil(s) + 1);
  };

  const drawDot = (ctx: CanvasRenderingContext2D, p: { x: number; y: number }, hue: number) => {
    const s = brushPx();
    if (tool === 'eraser') return eraseSquare(ctx, p.x, p.y, s);
    ctx.fillStyle = tool === 'rainbow' ? `hsl(${hue % 360}, 90%, 55%)` : color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawSegment = (
    ctx: CanvasRenderingContext2D,
    stroke: { last: { x: number; y: number }; hue: number },
    to: { x: number; y: number },
  ) => {
    const from = stroke.last;
    const s = brushPx();
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (tool === 'eraser') {
      const steps = Math.max(1, Math.ceil(dist / Math.max(1, s / 4)));
      for (let i = 1; i <= steps; i++) eraseSquare(ctx, from.x + (dx * i) / steps, from.y + (dy * i) / steps, s);
    } else {
      stroke.hue += dist * 0.6;
      ctx.strokeStyle = tool === 'rainbow' ? `hsl(${stroke.hue % 360}, 90%, 55%)` : color;
      ctx.lineWidth = s;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    stroke.last = to;
  };

  const floodAt = (x: number, y: number) => {
    const ctx = getCtx();
    const rgb = hexToRgb(color);
    if (!ctx || !rgb) return;
    const image = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    if (floodFill(image.data, CANVAS_W, CANVAS_H, x, y, rgb)) {
      ctx.putImageData(image, 0, 0);
      pushHistory(false);
      playSound('tap');
    }
  };

  const endStroke = () => {
    if (activePointerRef.current === null) return;
    activePointerRef.current = null;
    panStartRef.current = null;
    const had = strokeRef.current;
    strokeRef.current = null;
    if (had) pushHistory(false);
  };

  const updateCursor = (e: RPointerEvent<HTMLDivElement>) => {
    const el = cursorRef.current;
    const st = stageRef.current;
    if (!el || !st) return;
    if (tool === 'pan' || tool === 'fill' || e.pointerType === 'touch') {
      el.style.display = 'none';
      return;
    }
    const r = st.getBoundingClientRect();
    const d = Math.max(4, size * zoom);
    el.style.display = 'block';
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
  };

  useEffect(() => {
    if (cursorRef.current) cursorRef.current.style.display = 'none';
  }, [tool]);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Игнорируем второй палец/ладонь, пока идёт штрих. Если предыдущий штрих
    // «завис» (потеряли pointerup), через 1.5 с без движения сбрасываем его.
    if (activePointerRef.current !== null) {
      if (e.pointerId !== activePointerRef.current && performance.now() - lastActivityRef.current < 1500) return;
      endStroke();
    }
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    e.preventDefault();
    lastActivityRef.current = performance.now();

    if (tool === 'pan') {
      activePointerRef.current = e.pointerId;
      panStartRef.current = { cx: e.clientX, cy: e.clientY, px: pan.x, py: pan.y };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
      return;
    }

    const p = clientToCanvas(e.clientX, e.clientY, canvas.getBoundingClientRect());
    if (!p.inside) return;
    if (tool === 'fill') {
      floodAt(p.x, p.y);
      return;
    }

    activePointerRef.current = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    const hue = Math.random() * 360;
    strokeRef.current = { last: p, hue };
    drawDot(ctx, p, hue);
    playSound('tap');
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    updateCursor(e);
    if (activePointerRef.current !== e.pointerId) return;
    lastActivityRef.current = performance.now();

    if (tool === 'pan') {
      const s = panStartRef.current;
      if (s) setPan(clampPan({ x: s.px + e.clientX - s.cx, y: s.py + e.clientY - s.cy }, zoom));
      return;
    }

    const canvas = canvasRef.current;
    const ctx = getCtx();
    const stroke = strokeRef.current;
    if (!canvas || !ctx || !stroke) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const native = e.nativeEvent;
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const list = coalesced.length ? coalesced : [native];
    for (const ev of list) {
      drawSegment(ctx, stroke, clientToCanvas(ev.clientX, ev.clientY, rect));
    }
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== activePointerRef.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    endStroke();
  };

  useEffect(() => {
    const stop = () => endStroke();
    window.addEventListener('blur', stop);
    return () => window.removeEventListener('blur', stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Генерация ----------
  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => setTipIndex((v) => v + 1), 2200);
    return () => window.clearInterval(id);
  }, [loading]);

  const closeResult = () => {
    requestIdRef.current += 1; // ответ отменённого запроса больше не нужен
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setResultOpen(false);
    setResultImage(null);
    setSourceImage(null);
    setResultError(null);
  };

  const transform = async () => {
    const canvas = canvasRef.current;
    if (loading) return;
    if (!canvas || !hasDrawing) {
      showToast('error', 'Сначала нарисуй что-нибудь на доске! 🎨');
      return;
    }
    const image = squareDataUrl(canvas);
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    // Экран результата открываем СРАЗУ: слева рисунок, справа индикатор ожидания.
    setSourceImage(image);
    setResultImage(null);
    setResultError(null);
    setResultStyleId(style);
    setTipIndex(0);
    setLoading(true);
    setResultOpen(true);
    playSound('magic');

    try {
      const response = await fetch('/api/transform', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, style }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (requestId !== requestIdRef.current) return;
      if (response.status === 401) {
        setAuth('out');
        throw new Error('Сессия закончилась. Войди заново — рисунок на доске сохранён.');
      }
      if (!response.ok || !data.success || !data.image) {
        throw new Error(data.detail || data.error || 'Нейросеть не вернула изображение.');
      }
      setResultImage(data.image);
      playSound('done');
      confetti({ particleCount: 100, spread: 75, origin: { y: 0.6 } });
    } catch (err) {
      if (requestId !== requestIdRef.current || (err instanceof DOMException && err.name === 'AbortError')) return;
      setResultError(err instanceof Error ? err.message : 'Не удалось преобразовать рисунок.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  const downloadResult = () => {
    if (!resultImage) return;
    if (/^https?:/i.test(resultImage)) {
      window.open(resultImage, '_blank', 'noopener');
      return;
    }
    const a = document.createElement('a');
    a.href = resultImage;
    a.download = `nanobanana-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // ---------- Сохранение холстов ----------
  const refreshSaved = async () => {
    try {
      setSaved(await listSaved());
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Не удалось прочитать сохранённые холсты.');
    }
  };

  const openLibrary = async () => {
    setLibraryOpen(true);
    await migrateLegacy();
    await refreshSaved();
  };

  const saveCurrent = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!hasDrawing) {
      showToast('error', 'Холст пустой — сохранять пока нечего.');
      return;
    }
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось получить PNG.'))), 'image/png'),
      );
      const name = saveName.trim() || `Рисунок ${saved.length + 1}`;
      await putSaved({ id: uid(), name, createdAt: Date.now(), blob, thumb: makeThumb(canvas) });
      setSaveName('');
      await refreshSaved();
      showToast('ok', `Холст «${name}» сохранён ✅`);
    } catch (e) {
      showToast('error', `Не удалось сохранить: ${e instanceof Error ? e.message : 'неизвестная ошибка'}`);
    }
  };

  const drawBlobToCanvas = (src: Blob) =>
    new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(src);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const ctx = getCtx();
        if (!ctx) return reject(new Error('Холст недоступен.'));
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        const s = Math.min(CANVAS_W / img.width, CANVAS_H / img.height);
        const w = img.width * s;
        const h = img.height * s;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
        pushHistory(false); // можно вернуть прежний рисунок кнопкой «Назад»
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Не удалось прочитать изображение.'));
      };
      img.src = url;
    });

  const openSaved = async (item: SavedCanvas) => {
    try {
      await drawBlobToCanvas(item.blob);
      resetView();
      setLibraryOpen(false);
      showToast('ok', `Открыт холст «${item.name}». Прежний рисунок вернёт кнопка «Назад».`);
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Не удалось открыть холст.');
    }
  };

  const removeSaved = async (item: SavedCanvas) => {
    if (!window.confirm(`Удалить холст «${item.name}»?`)) return;
    try {
      await deleteSaved(item.id);
      await refreshSaved();
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Не удалось удалить.');
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await drawBlobToCanvas(file);
      resetView();
      setLibraryOpen(false);
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Не удалось загрузить файл.');
    }
  };

  // ---------- Экран входа ----------
  const loginForm = (
    <form className="auth-card" onSubmit={login}>
      <div className="auth-icon">🔐</div>
      <h1>Вход в мастерскую</h1>
      <p>Введи пароль, чтобы открыть редактор и использовать генерацию.</p>
      <input
        autoFocus
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Пароль доступа"
        required
      />
      <button type="submit" disabled={loginBusy}>{loginBusy ? 'Проверяю…' : 'Войти'}</button>
      {authError && <small>{authError}</small>}
    </form>
  );

  if (auth === 'checking' && !everAuthed) return <div className="auth-screen" />;
  if (!appVisible) return <div className="auth-screen">{loginForm}</div>;

  const tips = tipsFor(resultStyleName);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="subtitle">Рисуй что угодно — ИИ оживит именно твой рисунок</div>
        </div>
        <div className="top-actions">
          <div className="status-pill">● РЕЖИМ: РИСУНОК → {styleInfo.name.toUpperCase()}</div>
          <button type="button" className="top-btn" onClick={openLibrary}><FolderOpen size={18}/> Мои холсты</button>
          <button type="button" className="top-btn" onClick={logout} title="Выйти"><LogOut size={18}/></button>
        </div>
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
              <button className={`tool-btn ${tool === 'pan' ? 'active' : ''}`} onClick={() => setTool('pan')}><Hand size={18}/> Двигать холст</button>
            </div>
          </section>

          <section>
            <h3>{tool === 'eraser' ? 'Размер ластика' : 'Размер кисти'} <span>{size}px</span></h3>
            <input type="range" min="3" max="48" value={size} onChange={(e) => setSize(Number(e.target.value))}/>
          </section>

          <section>
            <h3>Цвет</h3>
            <div className="colors">
              {COLORS.map((item) => (
                <button
                  key={item}
                  aria-label={item}
                  className={`color-dot ${color === item && tool !== 'rainbow' ? 'selected' : ''}`}
                  style={{ background: item }}
                  onClick={() => { setColor(item); setTool('brush'); playSound('tap'); }}
                />
              ))}
            </div>
            <label className="custom-color">Другой цвет <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setTool('brush'); }}/></label>
          </section>

          <section>
            <h3>Стиль <span>{STYLES.length} вариантов</span></h3>
            <div className="style-list">
              {STYLES.map((item) => (
                <button
                  key={item.id}
                  title={item.description}
                  className={`style-card style-${item.id} ${style === item.id ? 'selected' : ''}`}
                  onClick={() => { setStyle(item.id); playSound('tap'); }}
                >
                  <span className="style-preview"><span>{item.emoji}</span><i></i><i></i><i></i></span>
                  <b>{item.name}</b>
                </button>
              ))}
            </div>
            <p className="style-caption"><b>{styleInfo.name}:</b> {styleInfo.description}</p>
          </section>
        </aside>

        <main className="canvas-area">
          <div className="canvas-board">
            <div
              ref={stageRef}
              className={`canvas-stage tool-${tool}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onLostPointerCapture={onPointerUp}
              onPointerLeave={() => { if (cursorRef.current) cursorRef.current.style.display = 'none'; }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                className="draw-canvas"
                style={{
                  left: (stageSize.w - display.w) / 2,
                  top: (stageSize.h - display.h) / 2,
                  width: display.w,
                  height: display.h,
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  visibility: stageSize.w ? 'visible' : 'hidden',
                }}
              />
              <div ref={cursorRef} className={`tool-cursor ${tool === 'eraser' ? 'square' : ''}`} />
            </div>

            <div className="canvas-history-controls" aria-label="История рисования">
              <button type="button" disabled={!canUndo} onClick={undo} title="Отменить (Ctrl+Z)"><RotateCcw size={22}/><span>Назад</span></button>
              <button type="button" disabled={!canRedo} onClick={redo} title="Повторить (Ctrl+Y)"><RotateCw size={22}/><span>Вперёд</span></button>
              <button type="button" className="danger" onClick={clearCanvas} title="Очистить холст (можно отменить кнопкой «Назад»)"><Trash2 size={22}/><span>Очистить</span></button>
            </div>

            <div className="zoom-controls" aria-label="Масштаб холста">
              <button type="button" aria-label="Уменьшить" title="Уменьшить" onClick={() => changeZoom(zoom - 0.25)}>−</button>
              <button type="button" className="zoom-value" aria-label="Сбросить масштаб" title="Сбросить масштаб" onClick={resetView}>{Math.round(zoom * 100)}%</button>
              <button type="button" aria-label="Приблизить" title="Приблизить" onClick={() => changeZoom(zoom + 0.25)}>+</button>
            </div>

            <div className="board-hint">Полотно большое: выбери «Двигать холст», чтобы перейти к другому месту</div>
          </div>

          <button className="magic-btn" disabled={loading} onClick={transform}>
            <Sparkles size={25}/>
            <span>
              <b>Превратить мой рисунок!</b>
              <small>Стиль: {styleInfo.name} · ИИ сохранит то, что я нарисовал</small>
            </span>
          </button>
        </main>

        <aside className="panel help-panel">
          <h3>Как это работает</h3>
          <div className="steps">
            <div><b>1</b><span>Нарисуй любой предмет, героя или сцену.</span></div>
            <div><b>2</b><span>Выбери стиль.</span></div>
            <div><b>3</b><span>Нажми кнопку превращения.</span></div>
          </div>
          <div className="important">
            <strong>🔒 Важное правило</strong>
            <p>ИИ получает сам PNG с холста. Он не получает описание вроде «нарисуй кота» — его задача только преобразовать твой исходный рисунок.</p>
          </div>
          <button className="sound-btn" onClick={() => setSound((v) => !v)}>{sound ? <Volume2 size={17}/> : <VolumeX size={17}/>} Звук {sound ? 'включён' : 'выключен'}</button>
        </aside>
      </div>

      {toast && <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.kind === 'error' ? '⚠️' : ''} {toast.text}</div>}

      {libraryOpen && (
        <div className="overlay" onClick={() => setLibraryOpen(false)}>
          <div className="library-card" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setLibraryOpen(false)} aria-label="Закрыть"><X size={20}/></button>
            <h2>Мои холсты</h2>
            <p className="library-note">Холсты хранятся в этом браузере на этом устройстве. Для копии на флешку — «Скачать PNG».</p>
            <div className="library-save">
              <input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCurrent(); }}
                placeholder="Название рисунка (необязательно)"
                maxLength={60}
              />
              <button type="button" onClick={saveCurrent}><Save size={18}/> Сохранить текущий</button>
              <button type="button" onClick={() => fileInputRef.current?.click()}><Upload size={18}/> Из файла</button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }}
              />
            </div>
            {saved.length === 0 ? (
              <div className="library-empty">Пока нет сохранённых холстов.</div>
            ) : (
              <div className="library-grid">
                {saved.map((item) => (
                  <div className="library-item" key={item.id}>
                    <img src={item.thumb} alt={item.name} />
                    <b title={item.name}>{item.name}</b>
                    <small>{new Date(item.createdAt).toLocaleString('ru-RU')}</small>
                    <div className="library-actions">
                      <button type="button" onClick={() => openSaved(item)}>Открыть</button>
                      <button type="button" onClick={() => downloadBlob(item.blob, `${item.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'canvas'}.png`)} title="Скачать PNG"><Download size={16}/></button>
                      <button type="button" className="danger" onClick={() => removeSaved(item)} title="Удалить"><Trash2 size={16}/></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {resultOpen && (
        <div className="overlay result-overlay">
          <div className="result-card">
            <button className="close-btn" onClick={closeResult} aria-label="Закрыть"><X size={20}/></button>
            <div className="result-head">
              <span>{resultError ? '😕 Не получилось' : resultImage ? '🎉 Готово!' : '✨ Колдую…'}</span>
              <h2>Твой рисунок в стиле «{resultStyleName}»</h2>
            </div>
            <div className="comparison">
              <figure>
                <figcaption>Твой рисунок</figcaption>
                <img src={sourceImage ?? ''} alt="Исходный рисунок"/>
              </figure>
              <figure>
                <figcaption>Результат ИИ</figcaption>
                {resultImage ? (
                  <img src={resultImage} alt={`Результат в стиле ${resultStyleName}`}/>
                ) : resultError ? (
                  <div className="result-placeholder error">
                    <div className="loader-emoji">🙈</div>
                    <p>{resultError}</p>
                  </div>
                ) : (
                  <div className="result-placeholder">
                    <div className="loader-icon"><span>🍌</span><Sparkles size={26}/></div>
                    <h3>Оживляю именно твой рисунок</h3>
                    <p>{tips[tipIndex % tips.length]}</p>
                    <div className="loader-bar"><span/></div>
                    <small>Это может занять несколько секунд</small>
                  </div>
                )}
              </figure>
            </div>
            <div className="result-actions">
              {resultError && <button onClick={transform}><Sparkles size={18}/> Попробовать снова</button>}
              <button onClick={downloadResult} disabled={!resultImage}><Download size={18}/> Сохранить PNG</button>
              <button onClick={closeResult}>Продолжить рисовать</button>
            </div>
          </div>
        </div>
      )}

      {auth === 'out' && everAuthed && (
        <div className="overlay auth-overlay">{loginForm}</div>
      )}
    </div>
  );
}
