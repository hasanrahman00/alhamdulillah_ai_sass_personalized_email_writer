# AI Cold Email Personalization (PeakLead MVP)

Production-ready MVP for internal use: upload a CSV of prospects, scrape each prospect website, call DeepSeek to generate personalized cold email JSON, then download an updated CSV with new columns (`subject`, `opening_line`, `email_body`, `cta`).

## Tech

- Backend: Node.js + Express
- Auth: none (internal MVP)
- DB: SQLite
- CSV: `csv-parser`, `json2csv`
- Scraping: Playwright (Chromium)
- AI: DeepSeek Chat Completions
- Queue: simple in-memory async queue (concurrency controlled), persisted row/job state in SQLite

## Setup

### 1) Backend

```bash
cd backend
copy .env.example .env
npm install
```

Edit `backend/.env`:

- Set `DEEPSEEK_API_KEY`
- Optionally adjust: `WORKER_CONCURRENCY`, `MAX_SCRAPED_CHARS`

Install Playwright browser binaries (required for scraping):

```bash
cd backend
npx playwright install
```

Run the backend:

```bash
cd backend
npm run dev
```

Backend runs on `http://localhost:3005`.

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` and proxies `/api/*` to the backend.

## Usage

1. Open the frontend dashboard
2. Upload a CSV
3. Preview rows
4. Click **Start Processing**
5. When status is **completed**, click **Download results CSV**

## CSV Requirements

The system scans all headers and tries to map these main columns:

- `First Name`
- `Last Name`
- `Email`
- `Company`
- `Website`
- Optional: `Our Services` / `service_focus`

You can include additional columns; they will be preserved in the downloaded CSV.

## API (backend)

- `POST /api/files/upload` (multipart form-data `file`)
- `GET /api/files`

- `POST /api/jobs/start` `{ fileId }`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/rows?limit=50&offset=0`
- `GET /api/jobs/:jobId/download`

## Notes / Limitations (MVP)

- Queue is in-memory, but job/row state is persisted in SQLite; on backend restart it will resume queued/running jobs.
- Scraping extracts homepage text + headings + meta description and may also visit up to 2 internal pages that look like About/Services.
- Website content is capped (`MAX_SCRAPED_CHARS`) to stay token-safe.
- DeepSeek response is expected to be JSON; non-JSON text is handled by extracting the first JSON object found.
