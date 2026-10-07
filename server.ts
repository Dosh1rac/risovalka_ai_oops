import express from 'express';
import path from 'node:path';
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
const MODEL = 'google/gemini-3.1-flash-image-preview';
const ENDPOINT = 'https://polza.ai/api/v1/media';
const STORAGE_ENDPOINT = 'https://polza.ai/api/v1/storage/upload';
const STATUS_ENDPOINT = 'https://polza.ai/api/v1/media';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = Number(process.env.POLZA_TIMEOUT_MS || 180000);

const app = express();
app.use(express.json({ limit: '20mb' }));

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
  y2k: `a polished Y2K digital aesthetic: glossy gradients, chrome-like highlights, translucent plastic details, playful early-2000s digital design, soft lens glow, subtle sparkle, candy colors and clean graphic forms. Keep the child's original subject, silhouette and composition; style it with Y2K materials and lighting without adding unrelated objects, text, logos, or characters.`,
};

function promptFor(style: string) {
  return `EDIT THE PROVIDED CHILD DRAWING. The provided image is the source of truth.\n\nTransform the exact drawing into this visual direction: ${STYLES[style] || STYLES['bright-cartoon']}.\n\nSTYLE IS A VISUAL TREATMENT, NOT A NEW SUBJECT. Do not invent a new scene just because the chosen style has familiar tropes.\n\nSTRICT IMAGE-TO-IMAGE RULES:\n- Keep the same subject(s) that are actually visible.\n- Keep the same approximate number, position, silhouette, orientation and relative size of objects.\n- Preserve distinctive marks from the child's drawing.\n- Do NOT guess a different object.\n- Do NOT turn the drawing into a cat, dog, person, rocket, banana, SpongeBob or another familiar subject unless that subject is visibly drawn.\n- Do NOT add unsupported characters, animals, props, text, logos or stickers.\n- If the drawing is ambiguous, preserve its visible shapes instead of interpreting them as something else.\n- Keep the overall composition and a clean light background unless the chosen style naturally calls for subtle paper/diorama texture.\n- Apply the chosen visual medium strongly enough that the result is unmistakably different from the default cartoon.\n- Do not add generic style mascots, castles, superheroes, speech bubbles, anime characters, fairy creatures or other decorations unless they are present in the child's drawing.\n- This is an image edit, not a text-to-image reinterpretation.\n\nThe input image has priority over every assumption in this prompt.`;
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

async function waitForMedia(id: string): Promise<string> {
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < POLL_TIMEOUT_MS) {
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: Boolean(KEY), model: MODEL, endpoint: ENDPOINT, envFile: ENV_PATH });
});

app.post('/api/transform', async (req, res) => {
  try {
    if (!KEY) return res.status(503).json({ success: false, detail: `POLZA_API_KEY не найден. Создай файл ${ENV_PATH}` });
    const image = String(req.body?.image || '').trim();
    const style = String(req.body?.style || 'bright-cartoon');
    if (!image.startsWith('data:image/')) return res.status(400).json({ success: false, detail: 'Canvas должен передать PNG/JPEG Data URL.' });
    if (image.length > 18 * 1024 * 1024) return res.status(413).json({ success: false, detail: 'Изображение слишком большое.' });

    console.log(`🖼️ Canvas: ${(image.length / 1024).toFixed(0)} KB`);

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
      return res.json({ success: true, image: immediateImage });
    }

    const requestId = data?.id || data?.requestId || data?.request_id || data?.taskId;
    if (!requestId) {
      console.error('⚠️ Polza не вернула ID задачи:', text.slice(0, 1500));
      return res.status(502).json({ success: false, detail: `Polza не вернула изображение или ID задачи. Ответ: ${text.slice(0, 1200)}` });
    }

    console.log(`🆔 Задача Polza: ${requestId}`);
    const result = await waitForMedia(String(requestId));
    console.log('✅ Polza вернула готовое изображение');
    return res.json({ success: true, image: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('❌ Transform:', msg);
    return res.status(500).json({ success: false, detail: msg });
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
