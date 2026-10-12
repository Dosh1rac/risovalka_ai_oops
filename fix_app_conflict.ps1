$ErrorActionPreference = "Stop"

$file = Join-Path (Get-Location) "src\App.tsx"
if (-not (Test-Path $file)) {
  throw "Не найден src\App.tsx. Запусти этот скрипт из корневой папки проекта."
}

$source = Get-Content -LiteralPath $file -Raw -Encoding UTF8

if ($source -notmatch "<<<<<<< HEAD") {
  Write-Host "Маркеры конфликта не найдены. Возможно, файл уже исправлен." -ForegroundColor Yellow
  exit 0
}

$function = @'
/** Подготовка изображения только для ИИ: убираем пустые поля, центрируем
 * рисунок и уменьшаем размер PNG. Оригинальный холст остаётся неизменным. */
function squareDataUrl(src: HTMLCanvasElement): string {
  const outputSide = 1024;
  const scanScale = Math.min(1, 1600 / Math.max(src.width, src.height));

  const scan = document.createElement('canvas');
  scan.width = Math.max(1, Math.round(src.width * scanScale));
  scan.height = Math.max(1, Math.round(src.height * scanScale));

  const scanCtx = scan.getContext('2d', { willReadFrequently: true })!;
  scanCtx.fillStyle = '#FFFFFF';
  scanCtx.fillRect(0, 0, scan.width, scan.height);
  scanCtx.drawImage(src, 0, 0, scan.width, scan.height);

  const { data } = scanCtx.getImageData(0, 0, scan.width, scan.height);

  const edgePoints = [
    [0, 0], [scan.width - 1, 0],
    [0, scan.height - 1], [scan.width - 1, scan.height - 1],
    [Math.floor(scan.width / 2), 0],
    [Math.floor(scan.width / 2), scan.height - 1],
    [0, Math.floor(scan.height / 2)],
    [scan.width - 1, Math.floor(scan.height / 2)],
  ];

  const colors = new Map<string, { count: number; rgb: [number, number, number] }>();
  for (const [x, y] of edgePoints) {
    const i = (y * scan.width + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const entry = colors.get(key);
    if (entry) entry.count++;
    else colors.set(key, { count: 1, rgb: [r, g, b] });
  }

  const mostCommon = [...colors.values()].sort((a, b) => b.count - a.count)[0];
  const [bgR, bgG, bgB] = mostCommon && mostCommon.count >= 4
    ? mostCommon.rgb : [255, 255, 255];

  let minX = scan.width, minY = scan.height, maxX = -1, maxY = -1;
  for (let y = 0; y < scan.height; y++) {
    for (let x = 0; x < scan.width; x++) {
      const i = (y * scan.width + x) * 4;
      if (Math.max(
        Math.abs(data[i] - bgR),
        Math.abs(data[i + 1] - bgG),
        Math.abs(data[i + 2] - bgB),
      ) > 24) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  const out = document.createElement('canvas');
  out.width = outputSide;
  out.height = outputSide;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
  ctx.fillRect(0, 0, outputSide, outputSide);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (maxX < 0) {
    const scale = Math.min(outputSide / src.width, outputSide / src.height);
    ctx.drawImage(src,
      (outputSide - src.width * scale) / 2,
      (outputSide - src.height * scale) / 2,
      src.width * scale, src.height * scale);
    return out.toDataURL('image/png');
  }

  const factorX = src.width / scan.width;
  const factorY = src.height / scan.height;
  const left = minX * factorX, top = minY * factorY;
  const right = (maxX + 1) * factorX, bottom = (maxY + 1) * factorY;
  const subjectW = right - left, subjectH = bottom - top;
  const scale = outputSide * 0.78 / Math.max(subjectW, subjectH);
  const bleed = Math.max(
    2 * Math.max(factorX, factorY),
    Math.max(subjectW, subjectH) * 0.12,
  );
  const cropL = Math.max(0, Math.floor(left - bleed));
  const cropT = Math.max(0, Math.floor(top - bleed));
  const cropR = Math.min(src.width, Math.ceil(right + bleed));
  const cropB = Math.min(src.height, Math.ceil(bottom + bleed));
  const cropW = cropR - cropL, cropH = cropB - cropT;

  ctx.drawImage(
    src, cropL, cropT, cropW, cropH,
    (outputSide - subjectW * scale) / 2 - (left - cropL) * scale,
    (outputSide - subjectH * scale) / 2 - (top - cropT) * scale,
    cropW * scale, cropH * scale,
  );
  return out.toDataURL('image/png');
}

'@

$pattern = '(?s)<<<<<<< HEAD.*?(?=function makeThumb\()'
if ($source -notmatch $pattern) {
  throw "Не удалось найти ожидаемый конфликтный блок squareDataUrl. Файл не изменён."
}

$source = [regex]::Replace($source, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $function }, 1)
$source = $source.Replace('src="/mission-cover.png"', 'src="/mission-cover.webp"')

$backup = "$file.bak"
Copy-Item -LiteralPath $file -Destination $backup -Force
Set-Content -LiteralPath $file -Value $source -Encoding UTF8

if ($source -match '<<<<<<< HEAD|=======|>>>>>>> 13da82f') {
  throw "В файле ещё остались маркеры конфликта. Резервная копия: $backup"
}

Write-Host "Готово: src\App.tsx исправлен." -ForegroundColor Green
Write-Host "Резервная копия: $backup"
Write-Host "Теперь выполни: npm run build"
