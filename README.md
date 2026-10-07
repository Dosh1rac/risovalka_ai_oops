# Nano Banana Drawing Board — v8

Одна версия приложения: React + Vite + Express.

## 1. Настройка ключа

Файл `.env` должен лежать **в этой папке, рядом с `server.ts`**:

```env
POLZA_API_KEY=pza_ваш_ключ
PORT=3000
```

Не называй его `.env.txt`.

## 2. Установка

```powershell
npm.cmd install
```

## 3. Запуск

```powershell
npm.cmd run dev
```

Либо дважды кликни `start.bat`.

В консоли обязательно должно быть:

`Polza: configured (key: pza_…1234)`

и

`.env: C:\...\nanobanana-v8\\.env (найден)`

## API

Polza endpoint: `https://polza.ai/api/v1/media`

Model: `google/gemini-3.1-flash-image-preview`
