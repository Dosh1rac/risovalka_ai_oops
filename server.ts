import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const ENV_PATH = path.join(__dirname, '.env');

function parseEnv(file: string) {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

const env = parseEnv(ENV_PATH);
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;

const KEY = (process.env.POLZA_API_KEY || '').trim();
const APP_PASSWORD = (process.env.APP_PASSWORD || '').trim();
const MODEL = process.env.POLZA_MODEL?.trim() || 'google/gemini-nano-banana-2.1';
// Защита монет: пауза между генерациями и (необязательно) общий лимит за запуск сервера.
const COOLDOWN_MS = Number(process.env.GENERATION_COOLDOWN_MS || 3000);
const GENERATION_LIMIT = Number(process.env.GENERATION_LIMIT || 0); // 0 = без лимита
let generationsStarted = 0;
const ENDPOINT = 'https://polza.ai/api/v1/media';
const STORAGE_ENDPOINT = 'https://polza.ai/api/v1/storage/upload';
const STATUS_ENDPOINT = 'https://polza.ai/api/v1/media';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = Number(process.env.POLZA_TIMEOUT_MS || 180000);

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
// Для логина достаточно крошечного тела — большие запросы без авторизации не принимаем.
app.use('/api/login', express.json({ limit: '2kb' }));
app.use(express.json({ limit: '100kb' }));

const STYLES: Record<string, string> = {
  'bright-cartoon': `a polished modern Western children's cartoon: friendly rounded shapes, bold smooth outlines, simple expressive forms, cheerful saturated colors, soft cel shading, playful proportions, clean animation-studio finish, readable silhouettes, bright family-friendly 2D illustration. Avoid Japanese anime aesthetics, manga linework, oversized anime eyes, dramatic anime lighting, or sharp stylized facial proportions.`,
  comic: `a professional colorful comic-book panel: bold black ink outlines, expressive line weight, punchy cel shading, dramatic perspective, energetic diagonal composition accents, small halftone texture in the background, a few tasteful comic action marks only when they fit the scene, speech bubbles or text are forbidden`,
  storybook: `a premium children's fairy-tale book illustration, NOT a watercolor painting: rich hand-painted gouache and colored-pencil artwork, elegant dark ink outlines, warm cinematic lighting, detailed storybook scenery, decorative illustrated environment, expressive charming characters, layered painted shapes, soft but clearly defined edges, whimsical fantasy-book atmosphere, rich deep colors, subtle vintage children's book texture. The result should look like a finished illustration from a high-quality printed fairy-tale book, not like loose watercolor washes.`,
  watercolor: `a hand-painted watercolor illustration on textured cold-press paper: transparent layered washes, visible brush and pigment edges, soft color blooms, delicate pencil/ink accents, natural paper grain, luminous light, artistic imperfections`,
  anime: `a distinctly Japanese anime illustration, NOT a generic children's cartoon: precise Japanese anime character design, clean thin black linework, large expressive anime eyes when a face is present, stylized facial proportions, sharp pointed hair shapes when hair is present, detailed anime clothing folds, cel-shaded planes with clear hard shadows, dramatic rim lighting, cinematic anime composition, controlled highlights, strong depth and perspective, polished 2D anime production-art finish. Preserve the user's drawing exactly as the subject and composition; only transform its visual language into Japanese anime aesthetics. Do not make it look like a Western cartoon, preschool illustration, or generic colorful cartoon.`,
  clay: `a charming stop-motion clay animation frame: handcrafted clay/plasticine forms, rounded tactile surfaces, subtle fingerprints and sculpted details, soft studio lighting, gentle shadows, miniature diorama depth, playful family-film look`,
  doll: `a polished doll-like collectible toy aesthetic: smooth softly sculpted surfaces, refined rounded features, glossy painted details, gentle blush and soft highlights where appropriate, neatly styled forms, delicate fabric-like textures when clothing is present, warm studio lighting, subtle toy-scale depth, premium handcrafted doll finish. Keep the subject faithful to the child's drawing and do not invent a human character if none is present. Avoid brand-specific doll designs, logos, text, or fashion trademarks.`,
  impressionism: `a refined Impressionist oil painting: visible short and layered brushstrokes, luminous natural light, broken color, vibrant but harmonious palette, atmospheric depth, painterly edges and subtle canvas texture. Make it look like a finished museum-quality painting while preserving the child's original shapes and composition.`,
  tarot: `a richly illustrated tarot-card aesthetic, fully non-photorealistic and hand-drawn: ornate decorative frame, symbolic composition, mystical stars and celestial motifs, elegant engraved linework, flat-to-painterly illustrated color, decorative gold accents, storybook fantasy atmosphere, clear iconic shapes, whimsical rather than realistic. Treat the child's drawing as the exact source of the subject and composition. Do not invent a real person, photorealistic face, photographic lighting, or realistic human anatomy. If a person-like shape is present, render it as a stylized illustrated figure. No text, logos, or real-world celebrity likenesses.`,
  stickers: `a playful premium sticker-sheet aesthetic: bold clean outer contour, simplified polished shapes, bright cheerful colors, crisp flat shading, subtle glossy highlights, white sticker border around each distinct subject, compact graphic composition. Preserve every visible object from the child's drawing and do not add unrelated sticker characters or decorations.`,
  'treasure-island': `classic illustrated pirate treasure-adventure book style, aged treasure maps, tropical island atmosphere, warm parchment textures, dramatic ocean blues and golden highlights, hand-painted adventure illustration. Preserve only the objects and composition in the child's drawing; do not add unrelated pirates, ships, text or treasure unless drawn.`,
  lego: `a toy-brick construction style with colorful interlocking plastic bricks, visible studs, block-built shapes, clean studio lighting and playful miniature diorama materials. Rebuild the exact drawn subjects as brick-built forms without adding unrelated characters or props.`,
  roblox: `a blocky user-created 3D game aesthetic inspired by sandbox game worlds, simple cubic geometry, toy-like materials, bright colors and clean game-rendered lighting. Keep the original subjects and layout; do not add logos, UI, text or unrelated avatars.`,
  origami: `an elegant origami paper-folding art style, crisp geometric creases, layered folded paper, subtle paper fibers and carefully shaped angular forms, with soft natural shadows. Transform the visible shapes into folded paper while preserving the original subject and composition; no unrelated objects.`,
  'rick-morty': `a non-photorealistic adult animated sci-fi comedy cartoon aesthetic associated with irreverent space adventures: loose expressive ink outlines, deliberately imperfect hand-drawn linework, flat cel colors, limited shading, quirky simplified shapes, exaggerated cartoon poses, offbeat alien/sci-fi visual language, muted teal, yellow, green and purple accents, energetic 2D animation finish. Preserve the child's original subject and composition. Do not create photorealism, realistic human faces, realistic anatomy, photographic lighting, or a live-action look. Keep any people as stylized cartoon figures only. Do not add named characters, logos, episode references, text, or unrelated props.`,
};

const STYLE_NAMES: Record<string, string> = {
  'bright-cartoon': 'Bright cartoon',
  comic: 'Comic book',
  storybook: 'Fairy-tale storybook',
  watercolor: 'Watercolor',
  anime: 'Japanese anime',
  clay: 'Clay animation',
  doll: 'Collectible doll',
  impressionism: 'Impressionism',
  tarot: 'Tarot card',
  stickers: 'Sticker sheet',
  'treasure-island': 'Treasure Island adventure',
  lego: 'Toy-brick (LEGO-like)',
  roblox: 'Blocky sandbox game (Roblox-like)',
  origami: 'Origami',
  'rick-morty': 'Adult sci-fi animated comedy',
};

function promptFor(style: string) {
  return `EDIT THE PROVIDED CHILD DRAWING. The provided image is the source of truth.\n\nSELECTED STYLE: "${STYLE_NAMES[style] || style}". Transform the exact drawing into this visual direction: ${STYLES[style]}.\n\nSTYLE IS A VISUAL TREATMENT, NOT A NEW SUBJECT. Do not invent a new scene just because the chosen style has familiar tropes.\n\nSTRICT IMAGE-TO-IMAGE RULES:\n- Keep the same subject(s) that are actually visible.\n- Keep the same approximate number, position, silhouette, orientation and relative size of objects.\n- Preserve distinctive marks from the child's drawing.\n- Do NOT guess a different object.\n- Do NOT turn the drawing into a cat, dog, person, rocket, banana, SpongeBob or another familiar subject unless that subject is visibly drawn.\n- Do NOT add unsupported characters, animals, props, text, logos or stickers.\n- If the drawing is ambiguous, preserve its visible shapes instead of interpreting them as something else.\n- Keep the overall composition and a clean light background unless the chosen style naturally calls for subtle paper/diorama texture.\n- Apply the selected style ("${STYLE_NAMES[style] || style}") strongly enough that it is clearly and unmistakably recognizable. Do not fall back to a generic cartoon look unless the selected style is the cartoon one.\n- Do not add generic style mascots, castles, superheroes, speech bubbles, anime characters, fairy creatures or other decorations unless they are present in the child's drawing.\n- This is an image edit, not a text-to-image reinterpretation.\n\nThe input image has priority over every assumption in this prompt.`;
}

function extractImage(data: any): string | null {
  const candidates = [
    data?.output?.url,
    data?.output?.image,
    data?.data?.[0]?.url,
    data?.data?.[0]?.b64_json,
    data?.images?.[0]?.url,
    data?.images?.[0]?.b64_json,
    data?.image,
    data?.url,
  ];
  const value = candidates.find((x) => typeof x === 'string' && x.length > 0);
  if (!value) return null;
  return /^(https?:\/\/|data:)/.test(value) ? value : `data:image/png;base64,${value}`;
}

// Отдаём картинку как data URL: так её можно скачать без CORS и ссылка не «протухнет».
async function toDataUrl(image: string): Promise<string> {
  if (image.startsWith('data:')) return image;
  try {
    const r = await fetch(image);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const type = (r.headers.get('content-type') || 'image/png').split(';')[0];
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch (e) {
    console.warn('⚠️ Не удалось встроить результат как data URL, отдаю ссылку:', e instanceof Error ? e.message : e);
    return image;
  }
}

async function parseResponse(r: Response) {
  const text = await r.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { text, data };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error('Неверный Data URL изображения.');
  const mime = match[1] || 'image/png';
  const base64 = match[2];
  const payload = match[3];
  const buffer = base64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
  return new Blob([buffer], { type: mime });
}

async function uploadCanvasImage(image: string): Promise<string> {
  console.log(`📤 Загружаю рисунок в Polza Storage: ${(image.length / 1024).toFixed(0)} KB`);
  const form = new FormData();
  form.append('file', dataUrlToBlob(image), 'drawing.png');
  form.append('externalUserId', 'nanobanana-drawing-board');
  form.append('storagePolicy', 'TEMP_UPLOAD');

  const r = await fetch(STORAGE_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}` },
    body: form,
  });
  const { text, data } = await parseResponse(r);
  if (!r.ok) {
    const msg = data?.error?.message || data?.message || data?.detail || text.slice(0, 1200);
    throw new Error(`Storage API ${r.status}: ${msg}`);
  }
  const url = data?.url;
  if (typeof url !== 'string' || !url.startsWith('http')) {
    throw new Error(`Storage не вернул URL изображения: ${text.slice(0, 1200)}`);
  }
  console.log(`✅ Рисунок загружен: ${url}`);
  return url;
}

async function getMediaStatus(id: string) {
  const r = await fetch(`${STATUS_ENDPOINT}/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
  });
  const { text, data } = await parseResponse(r);
  if (!r.ok) {
    const msg = data?.error?.message || data?.message || data?.detail || text.slice(0, 1000);
    throw new Error(`Media status ${r.status}: ${msg}`);
  }
  return data;
}

async function waitForMedia(id: string, shouldStop: () => boolean = () => false): Promise<string> {
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    if (shouldStop()) throw new Error('Клиент закрыл экран результата — ожидание остановлено.');
    const data = await getMediaStatus(id);
    const status = String(data?.status || '').toLowerCase();
    if (status && status !== lastStatus) {
      console.log(`⏳ ${id}: ${status}`);
      lastStatus = status;
    }

    const image = extractImage(data);
    if (status === 'completed' || image) {
      if (!image) throw new Error(`Генерация завершена, но output.url отсутствует: ${JSON.stringify(data).slice(0, 1500)}`);
      return image;
    }
    if (status === 'failed' || status === 'error') {
      const message = data?.error?.message || data?.error || data?.message || 'Неизвестная ошибка генерации';
      throw new Error(`Polza generation failed: ${typeof message === 'string' ? message : JSON.stringify(message)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Polza не завершила генерацию за ${Math.round(POLL_TIMEOUT_MS / 1000)} сек.`);
}

type Session = { expires: number; lastGeneration: number; busy: boolean };
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map<string, Session>();
const loginAttempts = new Map<string, { fails: number; blockedUntil: number }>();
const MAX_LOGIN_FAILS = 5;
const LOGIN_BLOCK_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) if (s.expires < now) sessions.delete(token);
  for (const [ip, a] of loginAttempts) if (a.blockedUntil < now && a.fails === 0) loginAttempts.delete(ip);
}, 10 * 60 * 1000).unref();

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest();
function passwordMatches(input: string) {
  // Сравнение за постоянное время: по времени ответа пароль не подобрать.
  return crypto.timingSafeEqual(sha256(input), sha256(APP_PASSWORD));
}

function sessionToken(req: express.Request) {
  const raw = req.headers.cookie || '';
  const match = raw.match(/(?:^|;\s*)drawing_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}
function getSession(req: express.Request): Session | null {
  const token = sessionToken(req);
  const s = token ? sessions.get(token) : undefined;
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  return s;
}
function cookieFlags() {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  return `HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`;
}
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!APP_PASSWORD) return res.status(503).json({ success: false, detail: 'Авторизация не настроена: добавьте APP_PASSWORD в .env.' });
  const session = getSession(req);
  if (!session) return res.status(401).json({ success: false, detail: 'Сначала войдите в приложение.' });
  res.locals.session = session;
  next();
}

app.get('/api/session', (req, res) => { res.json({ authenticated: Boolean(APP_PASSWORD && getSession(req)) }); });

app.post('/api/login', (req, res) => {
  if (!APP_PASSWORD) return res.status(503).json({ detail: 'Доступ закрыт: задайте APP_PASSWORD в .env.' });
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const attempt = loginAttempts.get(ip) ?? { fails: 0, blockedUntil: 0 };
  if (attempt.blockedUntil > now) {
    const sec = Math.ceil((attempt.blockedUntil - now) / 1000);
    return res.status(429).json({ detail: `Слишком много попыток. Подождите ${sec} сек.` });
  }
  const submitted = String(req.body?.password ?? '');
  if (submitted.length > 512 || !passwordMatches(submitted)) {
    attempt.fails += 1;
    if (attempt.fails >= MAX_LOGIN_FAILS) { attempt.blockedUntil = now + LOGIN_BLOCK_MS; attempt.fails = 0; console.warn(`🔒 Много неверных паролей с ${ip}: блокировка на 5 минут`); }
    loginAttempts.set(ip, attempt);
    return res.status(401).json({ detail: 'Неверный пароль.' });
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: now + SESSION_TTL_MS, lastGeneration: 0, busy: false });
  res.setHeader('Set-Cookie', `drawing_session=${token}; ${cookieFlags()}; Max-Age=${SESSION_TTL_MS / 1000}`);
  res.json({ success: true });
});

app.post('/api/logout', requireAuth, (req, res) => {
  sessions.delete(sessionToken(req));
  res.setHeader('Set-Cookie', `drawing_session=; ${cookieFlags()}; Max-Age=0`);
  res.json({ success: true });
});

app.get('/api/health', (_req, res) => {
  if (!getSession(_req)) return res.json({ ok: true });
  res.json({ ok: true, configured: Boolean(KEY), authConfigured: Boolean(APP_PASSWORD), model: MODEL, generationsStarted, generationLimit: GENERATION_LIMIT || null });
});

// Сначала проверяем авторизацию и только потом читаем большое тело запроса.
app.post('/api/transform', requireAuth, express.json({ limit: '20mb' }), async (req, res) => {
  const session = res.locals.session as Session;
  let clientGone = false;
  res.on('close', () => { if (!res.writableEnded) clientGone = true; });
  let locked = false;
  try {
    if (!KEY) return res.status(503).json({ success: false, detail: `POLZA_API_KEY не найден. Создай файл ${ENV_PATH}` });
    const image = String(req.body?.image || '').trim();
    const style = String(req.body?.style || '');
    if (!Object.prototype.hasOwnProperty.call(STYLES, style)) return res.status(400).json({ success: false, detail: `Неизвестный стиль: «${style}».` });
    if (!image.startsWith('data:image/')) return res.status(400).json({ success: false, detail: 'Canvas должен передать PNG/JPEG Data URL.' });
    if (image.length > 18 * 1024 * 1024) return res.status(413).json({ success: false, detail: 'Изображение слишком большое.' });

    if (session.busy) return res.status(429).json({ success: false, detail: 'Предыдущая генерация ещё идёт. Подождите немного.' });
    const wait = session.lastGeneration + COOLDOWN_MS - Date.now();
    if (wait > 0) return res.status(429).json({ success: false, detail: `Слишком быстро. Подождите ${Math.ceil(wait / 1000)} сек.` });
    if (GENERATION_LIMIT > 0 && generationsStarted >= GENERATION_LIMIT) return res.status(403).json({ success: false, detail: 'Лимит генераций на сегодня исчерпан.' });
    session.busy = true;
    locked = true;
    session.lastGeneration = Date.now();
    generationsStarted += 1;
    console.log(`🖼️ Canvas: ${(image.length / 1024).toFixed(0)} KB | стиль: ${style} | генерация №${generationsStarted}${GENERATION_LIMIT ? ` из ${GENERATION_LIMIT}` : ''}`);

    // Polza's Nano Banana 2 media API expects reference images under input.images.
    // The documented and reliable path is: Canvas -> Polza Storage -> public URL -> media job.
    const imageUrl = await uploadCanvasImage(image);
    const payload = {
      model: MODEL,
      input: {
        prompt: promptFor(style),
        aspect_ratio: '1:1',
        image_resolution: '1K',
        output_format: 'png',
        images: [{ type: 'url', data: imageUrl }],
      },
      user: 'nanobanana-drawing-board',
    };

    console.log(`➡️ POST ${ENDPOINT} | ${MODEL}`);
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const { text, data } = await parseResponse(r);

    if (!r.ok) {
      const msg = data?.error?.message || data?.message || data?.detail || text.slice(0, 1200);
      console.error(`❌ Polza ${r.status}: ${msg}`);
      return res.status(r.status).json({ success: false, detail: `Polza API ${r.status}: ${msg}` });
    }

    const immediateImage = extractImage(data);
    if (immediateImage) {
      console.log('✅ Polza сразу вернула изображение');
      return res.json({ success: true, image: await toDataUrl(immediateImage), style });
    }

    const requestId = data?.id || data?.requestId || data?.request_id || data?.taskId;
    if (!requestId) {
      console.error('⚠️ Polza не вернула ID задачи:', text.slice(0, 1500));
      return res.status(502).json({ success: false, detail: `Polza не вернула изображение или ID задачи. Ответ: ${text.slice(0, 1200)}` });
    }

    console.log(`🆔 Задача Polza: ${requestId}`);
    const result = await waitForMedia(String(requestId), () => clientGone);
    console.log('✅ Polza вернула готовое изображение');
    return res.json({ success: true, image: await toDataUrl(result), style });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('❌ Transform:', msg);
    if (!res.headersSent) return res.status(500).json({ success: false, detail: msg });
  } finally {
    if (locked) session.busy = false;
  }
});

async function start() {
  if (fs.existsSync(path.join(__dirname, 'dist', 'index.html'))) {
    app.use(express.static(path.join(__dirname, 'dist')));
  } else {
    const vite = await createViteServer({ root: __dirname, server: { middlewareMode: true, hmr: true } });
    app.use(vite.middlewares);
  }
  app.listen(PORT, '0.0.0.0', () => {
    const masked = KEY ? `${KEY.slice(0, 4)}…${KEY.slice(-4)}` : 'нет';
    console.log(`🍌 nanobanana: http://localhost:${PORT}`);
    console.log(`AI: ${MODEL}`);
    console.log(`Polza: ${KEY ? 'configured' : 'NOT CONFIGURED'} (key: ${masked})`);
    console.log(`.env: ${ENV_PATH} ${fs.existsSync(ENV_PATH) ? '(найден)' : '(НЕ НАЙДЕН)'}`);
    console.log(`Endpoint: ${ENDPOINT}`);
    console.log(`Storage: ${STORAGE_ENDPOINT}`);
    console.log(`Status: ${STATUS_ENDPOINT}/{id}`);
  });
}

start().catch((e) => { console.error(e); process.exit(1); });
