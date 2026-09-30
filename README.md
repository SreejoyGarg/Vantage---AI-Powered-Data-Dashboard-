# Vantage — AI-Powered Data Dashboard

Vantage is a web-based analytics dashboard that turns any CSV file into an interactive, filterable report — combining traditional data analysis (Pandas), BI-style visual exploration (Chart.js), and a generative AI insight layer (Groq/LLM), all built as a full-stack web application.

Upload a dataset, and Vantage automatically detects its structure, computes key metrics, builds relevant filters and charts, and generates a plain-English AI summary — no configuration required, and no assumption that the data is about "sales" or any specific domain.

---

## Table of Contents

- [Live Demo](#live-demo)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Setup Instructions (Local Development)](#setup-instructions-local-development)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Design Decisions & Trade-offs](#design-decisions--trade-offs)
- [Known Limitations](#known-limitations)
- [Possible Future Improvements](#possible-future-improvements)
- [Author](#author)

---

## Live Demo

[Add your live Render URL here once deployed, e.g. `https://vantage-dashboard.onrender.com`]

---

## Features

### Core functionality
- **Universal CSV support** — works with any CSV file, not just a specific domain (e.g. sales data). Automatically detects encoding (UTF-8, Latin-1, CP1252), delimiter (comma, semicolon, tab), and column types.
- **Automatic metric detection** — scans numeric columns and intelligently picks the most relevant one to analyze (prioritizing columns named revenue, sales, amount, price, etc.), while excluding ID-like columns (e.g. `CustomerID`, `Unnamed: 0`) from being offered as a metric.
- **Dynamic filter generation** — automatically builds a checkbox-based filter panel for every categorical column with a reasonable number of unique values (2–30), plus low-cardinality numeric columns (e.g. `Year`, `Star Rating`).
- **Date/trend detection** — automatically detects a date-like column (regardless of its original format) and renders a time-series trend chart, with automatic monthly bucketing for datasets spanning many days.
- **AI-generated insights** — sends computed summary statistics (not raw data) to a large language model via the Groq API, which returns a 2–3 sentence plain-English summary of the dataset.
- **Client-side interactive filtering** — once data is loaded, all filtering, metric switching, and chart updates happen instantly in the browser with zero additional server calls.
- **Multiple visualization types** — bar charts, a doughnut/share chart, and a time-series line chart, all Power BI–style "visual cards" with consistent headers.

### Robustness & production-readiness
- Handles files up to 50MB.
- Automatically samples very large datasets (30,000+ rows) for browser-side performance, while still computing headline totals from the **full** uploaded file for accuracy.
- Gracefully handles missing values (`NaN` → filled with `0` for numbers, `"Unknown"` for text) before sending data to the browser, since raw `NaN` values are not valid JSON.
- Try/except fallback around the AI call — if the LLM provider is down, rate-limited, or misconfigured, the dashboard still renders fully functional charts and stats, with a fallback message instead of crashing.
- Clear, human-readable error messages returned to the user for bad files, empty files, or files with no usable numeric column (instead of generic server crashes).

### UI/UX
- Custom dark, BI-tool-inspired interface (not a default template), with a dedicated color system, typography pairing (Inter + IBM Plex Mono for data + IBM Plex Serif for editorial/secondary text), and consistent visual-card design language.
- Drag-and-drop file upload with visual feedback.
- Loading state on the analyze button (prevents duplicate submissions, communicates progress).
- Smooth, non-flickering chart and stat updates on every filter change — charts are updated in place via Chart.js's `update()` method rather than destroyed and recreated, avoiding visual flicker.
- Fully responsive layout (filter panel collapses above the main content on narrow screens).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, Flask |
| Data processing | Pandas |
| AI / LLM | Groq API (OpenAI-compatible SDK), model: `openai/gpt-oss-120b` |
| Frontend | HTML, CSS, vanilla JavaScript (no framework) |
| Charts | Chart.js (via CDN) |
| Fonts | Google Fonts — Inter, IBM Plex Mono, IBM Plex Serif |
| Production server | Gunicorn |
| Hosting | Render (free tier) |
| Version control | Git + GitHub |

**Why these choices:**
- **Flask** was chosen over a heavier framework (e.g. Django) since the app has a small, well-defined surface area (two routes) — Flask keeps the codebase simple and easy to reason about end-to-end.
- **Vanilla JavaScript** (no React/Vue) was a deliberate choice to keep the project self-contained and dependency-light, and because the interactivity required (DOM updates, Chart.js calls) didn't need a component framework's overhead.
- **Groq** was chosen over OpenAI directly for cost reasons — Groq offers a generous free tier using open models, which matters for a project meant to run publicly without an ongoing API bill.
- **Client-side filtering** (rather than re-querying the server on every filter change) was chosen for responsiveness — once the dataset is in the browser, filtering is instant with no network latency, at the cost of capping how much raw data can reasonably be sent to the client (handled via the row-sampling logic described below).

---

## How It Works

### 1. Upload & parsing
When a CSV is uploaded, the Flask backend (`read_csv_robustly`) attempts to parse it using several encodings (`utf-8`, `utf-8-sig`, `latin1`, `cp1252`) and lets Pandas auto-detect the delimiter (`sep=None, engine="python"`), so it can handle files from a wide variety of sources without the user needing to specify format details.

### 2. Column analysis
The backend inspects the parsed DataFrame to classify columns:
- **Numeric columns** are candidates for the primary "metric" being analyzed.
- **Identifier columns** (e.g. `ID`, `CustomerID`, `Unnamed: 0`, or any column where every value is unique) are excluded from being offered as a metric, since summing or charting an ID column is meaningless.
- **Categorical (text) columns** with between 2 and 30 unique values (and covering less than 90% of total rows, to exclude free-text/near-unique columns) become filter options.
- **Low-cardinality numeric columns** (2–15 unique values, e.g. `Star Rating`, `Year`) are also offered as filters, in addition to text columns.
- **Date columns** are detected by checking whether a text column parses successfully as a date for more than 90% of its rows, using `pandas.to_datetime` with error coercion.

### 3. Metric selection
The backend looks for numeric columns whose names contain common business-metric keywords (`revenue`, `sales`, `amount`, `total`, `price`, `value`, `count`, `score`, `rating`), in that priority order. If none match, it falls back to the first available non-identifier numeric column. The user can override this choice via a dropdown in the UI at any time.

### 4. Full-dataset accuracy vs. browser performance
To keep the interactive experience fast, only a maximum of 30,000 rows are sent to the browser for client-side filtering (randomly sampled if the file is larger). However, headline statistics (total value, top category, the data fed to the AI summary) are computed from the **complete, unsampled** dataset on the server first — so accuracy is never sacrificed for performance, only the interactive drill-down experience is capped.

### 5. AI insight generation
Once totals and top-performing categories are computed, they (not the raw dataset) are sent to Groq's LLM API with a prompt asking for a 2–3 sentence plain-English summary. This keeps the request small, fast, and cheap, and avoids sending potentially sensitive raw data to a third-party API.

### 6. Frontend rendering
On receiving the JSON response, the frontend:
- Builds the filter panel dynamically based on whatever columns the backend identified as filterable (this means the UI adapts automatically to any dataset's structure).
- Builds a fixed set of chart "slots" once (`buildDashboardShell`) — a trend chart (if a date column exists), a doughnut chart, and up to three bar charts.
- On every filter/metric change afterward, only the **data inside** those existing charts is updated (`updateDashboard`, via Chart.js's `.update()` method) — the chart and card DOM elements themselves are never destroyed and recreated, which is what allows filter changes to feel instant and flicker-free.

---

## Project Structure

```
ai-data-dashboard/
├── app.py                  # Flask backend: routes, CSV parsing, analysis, AI call
├── requirements.txt         # Python dependencies
├── Procfile                 # Tells Render/Heroku how to start the app (gunicorn)
├── .gitignore                # Excludes venv/, .env, and cache files from Git
├── .env                       # Local-only secrets (GROQ_API_KEY) — never committed
├── templates/
│   └── index.html              # Single-page app shell
├── static/
│   ├── style.css                # All styling (dark theme, layout, animations)
│   └── script.js                  # All frontend logic (upload, filtering, charts)
└── sample_data/
    └── sales.csv                   # Example dataset for quick testing/demoing
```

---

## Setup Instructions (Local Development)

### Prerequisites
- Python 3.10+ installed
- A free [Groq API key](https://console.groq.com/keys)

### Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/SreejoyGarg/Vantage---AI-Powered-Data-Dashboard-.git
   cd Vantage---AI-Powered-Data-Dashboard-
   ```

2. **Create and activate a virtual environment**
   ```bash
   python -m venv venv

   # Windows (PowerShell):
   .\venv\Scripts\Activate.ps1

   # macOS/Linux:
   source venv/bin/activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Set up environment variables**

   Create a `.env` file in the project root:
   ```
   GROQ_API_KEY=your_groq_api_key_here
   ```

5. **Run the app**
   ```bash
   python app.py
   ```

6. Open `http://127.0.0.1:5000` in your browser and upload a CSV (or use the included `sample_data/sales.csv` to test immediately).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes | API key for Groq's LLM API, used to generate the AI insight summary. Get one free at [console.groq.com/keys](https://console.groq.com/keys). |

If this variable is missing or invalid, the app does **not** crash — the AI insight section will display: *"AI insight unavailable right now — showing raw stats above."* All other functionality (charts, filters, stats) continues to work normally.

---

## Deployment

This app is deployed on **Render** (free tier) as a Python web service.

**Build command:** `pip install -r requirements.txt`
**Start command:** `gunicorn app:app`

Render environment variables configured:
- `GROQ_API_KEY`

The `Procfile` (`web: gunicorn app:app`) exists for compatibility with any Heroku-style platform, in case of migrating hosts in the future.

**Note on production settings:** `app.run(debug=False)` is set in `app.py` for production; Gunicorn is used as the actual production WSGI server rather than Flask's built-in development server, per Flask's own deployment recommendations.

---

## Design Decisions & Trade-offs

- **Client-side filtering vs. server-side querying:** Chosen for UI responsiveness (instant filtering with no network round-trip), at the cost of a hard cap on how many rows can be interactively explored per session (30,000). For most public datasets and business use cases, this is a reasonable trade-off; a future version could move to server-side pagination/querying for true "big data" scale.
- **The AI summary is generated once per upload, not per filter change:** Regenerating the AI summary on every filter click would be slow (1–3 second LLM latency) and would burn through API rate limits quickly. Instead, the AI insight reflects the full, unfiltered dataset, and this is explicitly labeled in the UI so it's never misleading.
- **Dark, BI-tool-inspired theme:** Chosen deliberately over a generic light "SaaS" template to visually signal this is an analytical tool, drawing inspiration from the visual language of tools like Power BI and Looker (visual cards with headers, a persistent filter rail) while using a more modern color palette and typography than most enterprise BI tools default to.
- **No frontend framework (React/Vue):** The interactivity required didn't justify the added complexity and bundle size of a full framework; vanilla JS with direct DOM manipulation was sufficient and keeps the project easy for others (and future me) to read end-to-end.

---

## Known Limitations

- Very large files (500,000+ rows) will parse correctly on the backend, but the interactive frontend experience is capped at a 30,000-row sample for performance — headline totals remain accurate, but drill-down filtering operates on the sample.
- The AI insight is based on the unfiltered dataset only; it does not currently regenerate based on active filters.
- Currently supports CSV files only (not Excel `.xlsx`, JSON, or other tabular formats).
- Free-tier hosting on Render means the app may "spin down" after periods of inactivity, causing a slower first load (10–30 seconds) after idle periods.

## Possible Future Improvements

- Support `.xlsx` and JSON file uploads in addition to CSV.
- Add a "regenerate AI insight based on current filters" button for on-demand, filtered summaries.
- Add exportable reports (PDF/PNG snapshot of the current filtered dashboard view).
- Add user accounts and saved dashboards, so a user can return to a previous analysis without re-uploading.
- Server-side pagination for datasets beyond the current row cap, enabling true large-scale exploration.

---

## Author

**Sreejoy Garg**
B.Tech Student, Sikkim Manipal Institute of Technology
Aspiring Data Analyst | Learning Full-Stack Development

[LinkedIn](https://www.linkedin.com/in/sreejoy-garg-b2225b437/) · [GitHub](https://github.com/SreejoyGarg)
