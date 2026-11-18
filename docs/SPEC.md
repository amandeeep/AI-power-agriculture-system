# Build Prompt: AI-Powered Agriculture Decision Support System (MERN + Python ML)

> The original project specification from the user, kept verbatim as the source of truth.

You are building a final-year B.Tech project: **"An AI-Powered Agriculture Decision Support System"**. It is one platform that combines crop recommendation, fertilizer guidance, plant disease detection, live weather and an AI chat assistant. Farmers use it in natural language, in 5 languages: English, Hindi, Telugu, Tamil and Kannada. **Google Gemini 2.5 Flash** (free API) is the orchestration layer. It reads the farmer's query, picks the right service, calls the ML model or data source, and replies in plain language.

Work **phase by phase**. At the end of each phase, run the verification steps, show me the results, and wait for my OK before starting the next phase. Ask me before downloading datasets or installing anything global.

---

## 1. Tech stack (fixed)

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, Tailwind CSS, React Router, react-i18next, axios, Recharts |
| Main backend | Node.js + Express, Mongoose, JWT (bcryptjs), Multer, zod, helmet, cors, express-rate-limit |
| AI orchestration | Gemini via the official `@google/genai` Node SDK, using **function calling**. Read the model name from env: `GEMINI_MODEL=gemini-2.5-flash` |
| ML service | Python 3.11, FastAPI + Uvicorn, scikit-learn, pandas, numpy, joblib, TensorFlow/Keras, Pillow |
| Notebooks | Jupyter: pandas, matplotlib, seaborn, scikit-learn |
| Database | MongoDB Atlas (free tier). The connection string comes from env |
| Weather | Open-Meteo forecast + geocoding APIs (free, no key) |

Environment: **Windows 11**. `python` is not on PATH, so use `py -3.11 -m venv .venv` and the venv's interpreter. Node is installed.

## 2. Repository layout (single repo)

```
agri-dss/
├── client/                 # React app
├── server/                 # Express API + Gemini orchestrator
├── ml-service/             # FastAPI + trained models
│   ├── app/                # main.py, routers/, services/, schemas.py
│   ├── models/             # crop_stack.joblib, scaler, label_encoder, disease_mnv2.keras, class_names.json
│   ├── data/               # datasets (I will place them here)
│   ├── knowledge/          # crop_profiles.json, crop_seasons.json, disease_treatments.json
│   └── tests/
├── notebooks/              # 01_eda, 02_crop_models, 03_disease_mobilenetv2 (Colab-ready)
├── reports/                # metrics.json, confusion matrices, comparison charts
├── docs/                   # architecture diagram, API docs
├── .env.example files in client/, server/, ml-service/
├── package.json            # root "dev" script runs all 3 services with concurrently
└── README.md               # setup + run instructions
```

Never commit `.env`, datasets or large model files. Add them to `.gitignore`.

---

## 3. ML service (Python / FastAPI)

### 3.1 Crop recommendation: stacked ensemble
- Dataset: `ml-service/data/Crop_recommendation.csv` (2,200 rows, 22 crops). Features: N, P, K, temperature, humidity, ph, rainfall. Label: `label`.
- Preprocessing: check for missing values and duplicates, encode labels, scale with StandardScaler, use a stratified 80/20 split.
- Base models: RandomForest, ExtraTrees, GradientBoosting. Meta-model: LogisticRegression, via `sklearn.ensemble.StackingClassifier` with 5-fold CV.
- Baselines for comparison: DecisionTree, RandomForest, LogisticRegression, SVM. Use the same split and stratified 5-fold CV.
- Report accuracy, precision, recall and F1 (macro), a confusion matrix, and feature importance. Save the results to `reports/metrics.json` plus PNG charts.
- Save the pipeline, scaler and label encoder with joblib.
- **Composite score** for the top 5 crops:
  `final = 0.6 × model_probability + 0.2 × season_score + 0.2 × weather_score`
  - `season_score`: from `knowledge/crop_seasons.json`, which maps each crop to Kharif/Rabi/Zaid. Score is 1.0 if the crop is in the current Indian season, 0.5 if it is in an adjacent season, 0 otherwise.
  - `weather_score`: compare live temperature, humidity and rainfall against that crop's ideal range (per-crop mean ± std computed from the dataset and saved in `knowledge/crop_profiles.json`).
  - Return each part of the score so the UI and Gemini can explain the result.

### 3.2 Fertilizer recommendation: rule-based
- Ideal NPK per crop = the per-crop means in `crop_profiles.json`.
- Compute the deficit or excess for N, P and K. Recommend Urea (46% N), DAP (18-46-0) and MOP (60% K₂O), with approximate kg/acre. Include organic alternatives and an "excess nutrient" warning.
- Return structured JSON. Gemini turns it into friendly advice. Always add the disclaimer "consult your local Krishi Vigyan Kendra / soil test lab".

### 3.3 Disease detection: MobileNetV2
- Dataset: PlantVillage (38 classes). Training happens in `notebooks/03_disease_mobilenetv2.ipynb`, which must be **Google Colab-ready** with GPU, Kaggle download cells and a cell that saves to Drive.
- Images are 224×224. Use augmentation, ImageNet weights, a frozen base and a new classification head, then fine-tune the top ~30 layers. Use early stopping.
- Export `disease_mnv2.keras` and `class_names.json`. I'll copy them into `ml-service/models/`.
- `knowledge/disease_treatments.json`: for all 38 classes, store the crop, disease name, symptoms, organic treatment, chemical treatment and prevention.
- If top confidence is below 0.5, return `"uncertain"` and ask for a clearer photo.
- If the model file is missing, the endpoint returns 503 with a clear message. **The rest of the system must still run.**

### 3.4 Endpoints
- `GET /health`: reports which models are loaded
- `POST /predict/crop`: body is `{N,P,K,temperature,humidity,ph,rainfall, weather?, month?}`; returns `{top: [{crop, probability, season_score, weather_score, final_score}], model_version}`
- `POST /predict/fertilizer`: body is `{crop, N, P, K}`
- `POST /predict/disease`: multipart image upload; returns `{label, crop, disease, confidence, top3, treatment}`
- Validate every input with Pydantic, using realistic ranges (for example pH 0–14).
- Protect the service with an internal `X-Internal-Key` header shared with Node.
- Load models once at startup.
- Write pytest tests for each endpoint.

---

## 4. Node/Express backend

### 4.1 MongoDB models
- `User`: name, email/phone, passwordHash, preferredLanguage, location `{lat, lon, city}`
- `ChatSession`: userId, title, language, `messages: [{role, content, toolCalls?, toolResults?, imageUrl?, createdAt}]`
- `Prediction`: userId, type (`crop|fertilizer|disease`), input, output, source (`chat|form`), createdAt

### 4.2 REST API
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/predict/crop | fertilizer | disease`: direct form routes that proxy to the ML service and save a `Prediction`
- `GET /api/weather?lat=&lon=` or `?city=`: Open-Meteo current conditions + 7-day forecast, cached in memory for 30 minutes
- `POST /api/chat`: body is `{sessionId?, message, language, location?}`, plus an optional image (multipart)
- `GET /api/chat/sessions`, `GET /api/chat/sessions/:id`, `DELETE /api/chat/sessions/:id`
- `GET /api/history`: the user's saved predictions
- Use central error handling, zod validation, and a rate limit on `/api/chat`. Multer: memory storage, 5 MB limit, jpg/png/webp only.

### 4.3 Gemini orchestrator (`server/src/services/orchestrator.js`)
- Declare 4 tools:
  - `recommendCrop`: takes N, P, K, pH, temperature?, humidity?, rainfall?
  - `recommendFertilizer`: takes crop, N, P, K
  - `detectDisease`: no arguments; uses the image attached to the current message
  - `getWeather`: takes a location
- System prompt:
  - Gemini is a friendly agricultural advisor for Indian farmers.
  - It always replies in `{language}`, in simple words.
  - It asks for any missing soil values instead of guessing them.
  - It never invents numbers. Facts come from tool results.
  - It explains *why* a recommendation was made, flags risks such as heavy rain or a disease spreading, and gives clear next steps.
  - Questions unrelated to farming are politely declined.
- Loop:
  1. Send the last ~10 messages + the tools.
  2. When Gemini returns a function call, run it (ML service or weather) and send the result back.
  3. Allow at most 3 tool rounds, then return the final text.
  4. If the farmer's location is known and temperature, humidity or rainfall is missing, auto-fill them from live weather.
- Save the messages, tool calls and the matching `Prediction` records.
- **Fallback:** if Gemini returns 429, 5xx, or times out after 15 seconds:
  - Use a keyword/regex intent router in all 5 languages, with keywords such as crop/फसल, fertilizer/खाद, disease/रोग and weather/मौसम.
  - Call the matching service directly.
  - Reply using pre-written response templates for each language.
  - Tell the user the response is in "basic mode".
- Keep the API key server-side only (`GEMINI_API_KEY` in `server/.env`).

---

## 5. React frontend

- Mobile-first, with large touch targets, simple icons and a green agriculture theme. Must work on a 360px-wide phone.
- **Pages:**
  - Login / Register
  - Dashboard: weather card, 7-day forecast, risk alerts, and quick-action tiles
  - **Chat**: the main feature
  - Crop Recommendation form
  - Fertilizer form
  - Disease Detection: image upload with preview
  - History
  - Profile: language and location
- **Chat page:**
  - Message bubbles, an image attach button and a typing indicator
  - Tool-result cards rendered inside replies: top-5 crops with a score-breakdown bar chart, an NPK deficit chart, and a disease card with confidence and treatment
  - A session list sidebar
- **i18n:** react-i18next with `en`, `hi`, `te`, `ta`, `kn` locale files covering **all** UI strings. A language switcher sits in the navbar. The chosen language is also sent to the backend.
- **Location:** use browser geolocation, falling back to a city search.
- Show loading and error states everywhere. Forms validate inputs with helpful ranges.
- Optional, as the last step only: voice input with the Web Speech API (`hi-IN`, `te-IN`, `ta-IN`, `kn-IN`, `en-IN`).

---

## 6. Phases & verification

1. **Scaffold:** set up the repo structure, `.env.example` files, root `npm run dev` with concurrently, and the README.
   *Verify:* all 3 services start and their health endpoints respond.
2. **Crop ML:** notebooks 01 and 02, baseline vs stacked comparison, saved models, knowledge JSONs.
   *Verify:* show me the metrics table and confusion matrix.
3. **Fertilizer + disease:** the fertilizer rules, the Colab notebook, the treatments JSON, and a disease endpoint that degrades gracefully.
   *Verify:* run pytest and show sample responses.
4. **Express API:** auth, models, the predict proxy, weather, history.
   *Verify:* run a Postman collection or supertest tests.
5. **Gemini orchestrator + fallback:**
   *Verify:* 6 sample conversations, including Hindi, a missing-values follow-up, an image query, and a forced-fallback test.
6. **React UI:** all pages, i18n and charts.
   *Verify:* run it in the browser at desktop and mobile widths.
7. **Evaluation & docs:**
   - A response-time benchmark script that measures p50/p95 per endpoint and adds them to `reports/`
   - An architecture diagram in `docs/`
   - The final README with screenshots

## 7. Quality rules
- Write clean, modular code with comments where the logic isn't obvious. No hard-coded secrets or URLs; all config comes from env.
- Every ML response includes `model_version` and confidence values.
- Medical/chemical advice always carries a safety disclaimer.
- Keep Gemini calls within the free tier: no extra calls, short context, and caching where possible.
- After each phase, give a short summary of what was built, how to run it, and what is left.
