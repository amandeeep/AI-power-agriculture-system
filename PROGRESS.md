# PROGRESS: Agri-DSS

_Last updated: 2026-11-14_

## Phase status
| # | Phase | Status |
|---|---|---|
| 1 | Scaffold | ✅ Verified: `npm run dev` + `npm run health`, all 3 services OK, `/api` Vite proxy works. Server tests 2/2. |
| 2 | Crop ML | ✅ Approved by the user |
| 3 | Fertilizer + disease | ✅ Approved by the user. Disease model trained locally on CPU on 2026-11-14 (test acc 0.969, 39 classes incl. "no leaf") |
| 4 | Express API (auth, models, predict proxy, weather, history) | ✅ Approved by the user |
| 5 | Gemini orchestrator + fallback | ✅ Approved by the user |
| 6 | React UI | 🔄 Built (production build OK, all 5 locales 235/235 keys); **the user is testing it in their own browser** (the Claude-in-Chrome extension was not connected). Waiting for their feedback/OK |
| 6.5 | Location-based crop recommendation (soil records + past records) | 🔄 Built and tested, district soil data installed; waiting for the user's browser check and OK |
| 7 | Evaluation and docs | ⏳ |

## Phase 1: done
- Repo skeleton, `.gitignore` (only `.env.example` files are committable), `git init` (no commits yet).
- Root scripts: `dev` / `dev:ml` / `dev:server` / `dev:client` / `install:all` / `health`.
- ML service: FastAPI, settings, `X-Internal-Key` guard, model registry, `/health`.
- Server: zod env, optional Mongo, error handler, `mlClient`, `/api/health`, supertest tests.
- Client: Vite + React 18 + Tailwind v4, `/status` page.
- Vite listens on `localhost` (IPv6 `::1`), so health checks use `http://localhost:5173`, not 127.0.0.1.
- The venv has requirements.txt + matplotlib, seaborn, nbformat, nbclient and ipykernel. **TensorFlow is not installed**; ask the user in Phase 3.

## Phase 2: done
- Dataset: `ml-service/data/Crop_recommendation.csv` (2,200 × 8, 22 crops × 100, no missing values, no duplicates).
- `notebooks/01_eda.ipynb` executed. Charts in `reports/eda_*.png`. P–K r = 0.736.
- `notebooks/02_crop_models.ipynb`: being executed headless at the end of the session. If its outputs are empty, rerun it (command in CLAUDE.md).
- Artifacts: `ml-service/models/crop_stack.joblib` (7.5 MB), `scaler.joblib`, `label_encoder.joblib`, `crop_model_meta.json` (version `crop-stack-v1-20261112`); `knowledge/crop_profiles.json`, `knowledge/crop_seasons.json`.
- Reports: `reports/metrics.json`, `model_comparison.png`, `confusion_matrix_stack.png`, `feature_importance.png`.
- `POST /predict/crop` is live with the composite score. pytest: 10 passed.

### Results (test set n = 440; CV = stratified 5-fold on train)
| Model | CV acc | Test acc | Precision | Recall | F1 (macro) |
|---|---|---|---|---|---|
| Decision Tree | 0.9852 ± 0.0068 | 0.9795 | 0.9806 | 0.9795 | 0.9794 |
| Random Forest | 0.9932 ± 0.0053 | 0.9955 | 0.9957 | 0.9955 | 0.9955 |
| Logistic Regression | 0.9682 ± 0.0066 | 0.9727 | 0.9740 | 0.9727 | 0.9725 |
| SVM (RBF) | 0.9824 ± 0.0049 | 0.9886 | 0.9896 | 0.9886 | 0.9887 |
| **Stacked Ensemble** | **0.9943 ± 0.0048** | **0.9955** | 0.9957 | 0.9955 | 0.9955 |

- Stack errors: 2/440 (blackgram→maize, lentil→mothbeans). Permutation importance: humidity 0.376, rainfall 0.324, N 0.179, P 0.172, K 0.127, ph 0.005, temperature 0.003.
- The stack's test score ties RF and it has the best CV mean and lowest variance, but it costs ~140 s to fit vs 2 s for RF. Worth stating honestly in the report.

## Phase 3: done
- `app/services/fertilizer.py` + `POST /predict/fertilizer`: ideal = per-crop mean; ±15% (min 5 kg/ha) counts as optimal; DAP for P (its 18% N is credited against N), then Urea for the remaining N, MOP for K; kg/ha → kg/acre ÷ 2.471; organic alternatives per deficient nutrient; excess warnings; KVK disclaimer; local-name aliases (paddy, chana, arhar, moong, urad, …); 422 lists the 22 supported crops. `confidence: null`, `method: "rule-based"` (deterministic, so no statistical confidence).
- `knowledge/disease_treatments.json`: all 38 PlantVillage classes (crop, disease, pathogen, symptoms, organic, chemical with typical label doses, prevention, healthy flag) + `chemical_disclaimer`.
- `app/services/disease.py` + `POST /predict/disease`: jpg/png/webp only (415), ≤5 MB (413), corrupt image (400), EXIF-rotation fix, RGB, bilinear 224×224, raw 0-255 (the model contains the Rescaling layer); top-3; `uncertain` below `DISEASE_CONFIDENCE_THRESHOLD` (0.5); 503 when the model is missing while everything else keeps working.
- `notebooks/03_disease_mobilenetv2.ipynb`: Colab (T4), Kaggle `abdallahalidev/plantvillage-dataset` (Secrets or kaggle.json), 80/10/10 split, augmentation, frozen MobileNetV2 + GAP/Dropout/Dense head (Adam 1e-3), then fine-tune the top 30 layers (BatchNorm frozen, Adam 1e-5), EarlyStopping + ReduceLROnPlateau + checkpoint to Drive, curves, test report + confusion matrix, exports `.keras` + `class_names.json` + `disease_metrics.json`, reload sanity check. Validated with nbformat; all code cells parse. **Not run** (needs Colab GPU + the user's Kaggle account).
- Tests: `test_fertilizer.py` (12), `test_disease.py` (8, using a fake model injected into the registry, so TensorFlow is not needed). Total pytest 30 passed.
- **TensorFlow still not installed locally.** Only needed once the user has trained the model on Colab.

### Disease model trained locally (2026-11-14, user request: "leaf detection not working, download data and train model")
- Cause of "not working": the model had never been trained, so `/predict/disease` returned 503.
- TensorFlow 2.20 installed in `.venv` (`requirements-tf.txt`); numpy 2.1.3 / sklearn 1.7.2 unchanged. Dataset (downloaded with the user's go-ahead): PlantVillage colour, without augmentation, Mendeley Data `tywbtsjrjv` v1 (868 MB zip in `data/plantvillage_raw/`, extracted to `data/plantvillage/`, 55,448 images, 39 folders). Both gitignored.
- `training/train_disease.py` (CPU, no GPU on this PC): frozen ImageNet MobileNetV2 features extracted once (~30 min, ~50 img/s, cached per path in `data/plantvillage_features.npz`), then a Dropout(0.3)/Dense softmax head (~35 s). **No fine-tuning of the base** (that remains notebook 03 / Colab). Saves the same `models/disease_mnv2.keras` + `class_names.json` the registry loads, plus `reports/disease_metrics.json`, `disease_confusion_matrix.png`, `disease_training_curves.png`.
- **39 classes**: the 38 PlantVillage classes + `Background_without_leaves`. The first 38-class model called a non-leaf photo "Strawberry leaf scorch 99.95 %", so the background class was added. In `app/services/disease.py`, a background win -> `uncertain: true`, `no_leaf: true`, a "no leaf found" message, and it is never shown in `top3`. The client shows `disease.noLeaf` / `noLeafHint` (5 locales, 432 keys each); chat/fallback use the existing `uncertain` path.
- Results (stratified 80/10/10, seed 42, test n = 5,545): accuracy **0.9688**, macro P 0.9639 / R 0.9609 / F1 0.9622, top-3 0.996, 1.2 % below the 0.5 threshold; no-leaf class P 0.991 / R 1.0. Weakest: Tomato early blight (F1 ~0.81 in the 38-class run), Septoria, Target spot, Corn grey leaf spot. (38-class run on its own split: 0.9737.)
- Live check on port 8000: 5/5 real leaf photos correct with treatment, background photos -> "no leaf". **Limit:** random-noise images still get a confident leaf class (closed-set model, lab-style PlantVillage photos); real field photos will score lower than the test set. State this in the report.
- Tests: ML 54 passed + 2 skipped (the skips = "model missing" and "district data missing" tests, expected now); server 93 passed; client build OK.

### Known limitation to mention in the report
- The crop dataset has 22 crops and **no wheat, sugarcane, mustard or soybean**, so the fertilizer endpoint returns 422 for them. Option: add a small hand-curated NPK table for major Indian crops in a later phase if the user wants.

## Phase 4: done
- Models: `User` (email and/or phone, sparse unique; bcrypt hash `select:false`; preferredLanguage; location {lat, lon, city}), `ChatSession` (messages with toolCalls/toolResults/imageUrl/mode), `Prediction` (userId, type, input, output, source, sessionId).
- Routes: `/api/auth` register/login (email or phone as `identifier`)/me/**PATCH me** (profile: name, language, location or null); `/api/predict/crop|fertilizer|disease` (auth; saves Prediction source "form"; crop sends live `weather` from the body lat/lon or the saved profile location); `/api/weather?lat&lon | ?city` (no auth, no DB); `/api/history?type&page&limit`.
- `services/predictions.js` (shared with the Phase 5 orchestrator: `predictCrop/predictFertilizer/predictDisease(user, input, {source, sessionId, location})`).
- `services/weather.js`: Open-Meteo current + 7-day; geocoding; 30-min forecast cache keyed on lat/lon rounded to 2 dp (~1 km), 24 h geocode cache; alert **codes** for i18n: heavy_rain (≥64.5 mm, IMD), very_heavy_rain (≥115.6), heat (≥40 °C), frost (≤4 °C), strong_wind (≥40 km/h), thunderstorm, fungal_risk (RH ≥85 % at 18-32 °C), dry_spell (<2 mm/7 d with tMax ≥35); `summary.rainfallMonthlyEstimate` = avg daily forecast rain × 30 (the dataset scale); `cropWeatherFor(location)` never throws.
- Middleware: `requireAuth` (JWT), `validateBody/validateQuery` (zod 4; Express 5 query goes to `req.validatedQuery`), `imageUpload` (multer memory, 5 MB, jpg/png/webp → 415), `requireDb` (503 if Mongo is not connected), rate limits (api 600/15 min, auth 30/15 min, `chatLimiter` ready for Phase 5, keyed per user).
- Tests: `server/tests/helpers/setup.js` = in-memory MongoDB (`mongodb-memory-server`, dev dep, user-approved) + one fake HTTP server acting as the ML service and Open-Meteo. 24 tests pass (`npm test`).
- Live run verified: real ML service + real Open-Meteo (Hyderabad, Nov: 28 °C, RH 30 %, 0 mm → rice weather_score 0.138, Rabi crops ranked next) + temporary in-memory DB: register/login/crop/fertilizer/disease 503/history all OK.
- The user still needs to set `MONGODB_URI` (Atlas) for real use; until then auth/predict/history return 503 with a clear message, while weather and health work.

## Phase 5: done
- **Keys are set** in `server/.env` by the user: `MONGODB_URI` (Atlas, db name `Agri`) and `GEMINI_API_KEY`.
- **Model: `gemini-3.1-flash-lite`** (user's choice) with `GEMINI_THINKING_LEVEL=minimal`. `gemini-2.5-flash` is closed to new keys (404). `gemini-3.5-flash` works but its free tier is only **20 requests/day/model** (each chat message = 2-3 requests). `gemini-3.8-flash` timed out. Quotas are per model.
- Files: `services/orchestrator.js` (system prompt, ≤10-message history, ≤3 tool rounds then `mode: NONE`, time budget), `services/chat/tools.js` (4 declarations via `parametersJsonSchema` + executors returning `full` for the UI and a compact `forModel` for Gemini), `services/fallback/{intents,templates,index}.js` (keyword router for 5 languages, Indian-script crop names, N/P/K/pH extraction, templates for 5 languages, alert texts), `routes/chat.js` (`POST /api/chat` multipart or JSON; `GET/DELETE /api/chat/sessions[/:id]`).
- Timeouts: `GEMINI_TIMEOUT_MS=15000` = total Gemini budget per message (tool time excluded); `GEMINI_ATTEMPT_TIMEOUT_MS=8000` per attempt (client abortSignal) with ONE retry on timeout/5xx while the budget lasts; no retry on 429. The SDK client `httpOptions.timeout` must be ≥10 s (Google rejects shorter server deadlines with 400). SDK retries are disabled (`retryOptions.attempts: 1`).
- **Invented-value guard:** tools accept N/P/K/pH (and climate) only if the number appears in the farmer's own recent messages (Indian-script digits normalized). flash-lite DID invent "pH 7" live, and the guard caught it. Basic mode sets `trustArgs` because it parses the farmer's text itself.
- The image is NOT sent to Gemini (saves tokens): `[Leaf photo attached]` text + our MobileNetV2 via `detectDisease`. Only attachment metadata is stored.
- Basic mode: Hindi "मौसम" = season OR weather → soil numbers or "फसल" make it crop. Follow-ups reuse soil values from the last 3 user messages. It reuses tool results Gemini already obtained before failing (no duplicate Predictions).
- Tests: 75 pass (`npm test`), including a scriptable fake Gemini in `tests/helpers/setup.js` (`gem.text/call/error/hang`).
- Live verification transcript: `reports/chat_transcript_phase5.json` (7 conversations: Hindi crop, English missing-pH follow-up, Telugu fertilizer, leaf photo, Tamil weather, forced fallback in Kannada via a 2nd server with `GEMINI_TIMEOUT_MS=1`, off-topic decline). 7/8 messages in AI mode, the forced one in basic mode.
- Demo data in Atlas: several users `demo.farmer.<timestamp>@agri-dss.local` (password `demo-password-123`) with chat sessions and predictions. Ask the user before deleting.

### Known issues to raise with the user
- flash-lite sometimes re-orders crops (pushes an out-of-season top crop to the end with a caution) and shows scores loosely. The facts are correct; the UI card shows the exact ranking.
- **Auto-filled climate vs. the model:** with live Hyderabad weather in November (RH 30 %, 0 mm forecast rain), rice-like soil gets muskmelon/papaya instead of rice, because the model takes humidity/rainfall as inputs and the forecast-based rainfall (0) is outside the training range (~20-300 mm). Options: (a) keep, which is honest for "now"; (b) clamp to the dataset range; (c) use Open-Meteo `past_days=30` actual rainfall + forecast for a better monthly estimate. Ask the user.

## Phase 6: state
- Weather option **(c)** applied (the user said OK without choosing; it was the recommended option): Open-Meteo `past_days=30`, `summary.rainfallPast30d`, `rainfallMonthlyEstimate` = actual last-30-days rain (falls back to the forecast ×30/7 if history is missing), `rainfallMonthlySource`. Server tests 75/75.
- Demo users in Atlas are kept (non-destructive default).
- Client (`client/src`): `i18n/` (en/hi/te/ta/kn, 235 keys each, incl. alert codes, WMO weather codes, 22 crop names), `context/AuthContext.jsx` (JWT in localStorage `agri.token`, `auth:expired` event), `lib/{api,constants}.js`, `components/` (Layout with top nav + phone bottom tab bar + language switcher that also PATCHes preferredLanguage; ui.jsx primitives; Markdown (safe, no innerHTML); NumberField; LocationPicker (geolocation + city search via /api/weather?city); ImagePicker; WeatherIcon; results/{CropResults (Recharts stacked score breakdown), FertilizerResults (NPK actual vs ideal), DiseaseResults, WeatherBlocks}), `pages/` (AuthPages, Dashboard, ChatPage (sessions sidebar/drawer, attach, Web Speech voice input, typing indicator, tool cards, basic-mode badge), CropPage (fill from live weather), FertilizerPage, DiseasePage (friendly 503), HistoryPage, ProfilePage, SystemStatus at /status).
- Pages are lazy-loaded (initial JS ≈110 KB gzip; Recharts chunk only on chart pages).
- Known: server-generated texts (fertilizer "when", organic options, disease treatments) are English; chat replies are translated by Gemini. `/status` is an English-only debug page.
- NEXT: wait for the user's browser feedback, fix issues, then Phase 7.

## Phase 6.5: location-based recommendation (state)
- User's choices (2026-11-12): soil source = **district dataset (CSV)**; "past record" = past crops (rotation) + soil-test trend + area's past predictions/crops + historical weather; built as its own phase. Weights: my proposal, implemented so that no context gives exactly the old formula.
- **District soil data (downloaded with the user's permission, 2026-11-12):** Soil Health Card district nutrient status via the Esri India Living Atlas layer "Macro Nutrient Soil Health Card" (779 districts, LGD codes, % Low/Medium/High for N/P/K/OC, pH class, EC, sample counts, for 2023-24 / 2024-25 / 2025-26, plus boundaries). Raw files: `ml-service/data/shc_esri/` (3 MB). The India Data Portal CSV (1.1 GB, village level) has the same kind of class counts (no kg/ha values), so it was not downloaded.
  - `training/build_district_soil.py` (`--download` to refetch) → `knowledge/district_soil.json` (693 districts; 86 left out: no data or < 10 samples) + `knowledge/district_boundaries.json` (simplified ~1 km). Both gitignored (derived from a dataset).
  - **Scale conversion (state it in the report):** Low/Medium/High → 1/6 quantile / median / 5/6 quantile of the TRAINING data (N 14/37/96, P 21/51/76, K 18/32/54), share-weighted; pH from acidic/neutral/alkaline shares → 6.0/7.0/8.0. Relative ordering, not a lab value. Per nutrient, the newest year with ≥ 30 samples. Confidence = 0.7 × sample factor × (0.5 + 0.5 × majority share), max 0.7. 236 of 676 districts are ≥ 95 % "Low N" (matches published Indian soil findings).
  - ML `/soil/district?lat&lon` = point-in-polygon (exact district, no spelling issues), name as fallback; the server sends coordinates first. The UI shows the SHC Low/Medium/High table + record years.
  - Live: Nalgonda field without soil tests, November → district estimate N 14 / P 76 / K 32.6 / pH 6.98 → lentil 0.90. ML pytest **53 passed, 1 skipped**; server **93 passed**.
- ML: `CropContext` on `/predict/crop`, `rotation_score` + `area_score`, `knowledge/crop_families.json`, `/soil/districts` + `/soil/district` (503 until the JSON exists, so `/health` shows `degraded` like the disease model). pytest **44 passed**.
- Server: models `Field` (GeoJSON), `SoilTest`, `CropHistory`; `Prediction.geo` (rounded to 2 dp, used only in aggregate); routes `/api/fields`, `/api/recommend/location`, `/api/recommend/districts`; `services/climate.js`, `services/locationRecommend.js`; chat tool `recommendCropForLocation` (asks "which field?" when there are several); basic mode uses it when the message has no soil numbers. Tests **87 passed** (fake archive + fake /soil/district in the harness).
- Client: `/fields` page (fields, soil tests with estimate + trend, crop history, two-tap delete), crop page tabs "From my field" / "Enter soil test", evidence card (soil source + district caution, climate normals, past crops, nearby records), chart with rotation/area segments, chat card. 5 locales at 305 keys each. Build OK.
- Live check (real ML model + real Open-Meteo archive, in-memory DB): Hyderabad July normals 25.5 °C / 79 % / 231 mm; rice stays #1 for July despite the "same as last season" penalty (probability 0.92); after the season fix, November gives muskmelon (prob 0.52, weather fit 0, the known dry-season issue), then lentil (pulse after paddy, rotation 1.0). The first live run showed Kharif neighbours inflating Rabi results, so area counts are now same-season only.
- Not yet checked in a real browser.
- **Address autofill (user request, 2026-11-12):** free OSM/India Post services instead of Google Places (Google needs a billing account + key). Type-ahead for village/town/city/PIN; "use my location" and picking a suggestion fill village, mandal/taluk/tehsil, district, state and PIN; fields auto-fill district + state (snapped to the district-soil spelling when available). Server tests **92 passed** (5 new, fake Photon/Nominatim/India Post). Live: "Nalgo" → Nalgonda; Kondapur → district Mancherial; Bengaluru reverse OK; throttle spaces Nominatim calls ≥1.1 s. Some India Post post offices are not in OSM, so they get the district centre plus an "approximate" notice. Client build OK, 321 keys × 5 locales. Not browser-tested.

## UI redesign (user-approved design, 2026-11-12)
- Design canvas "Agri-DSS UI Screens" (claude.ai artifact, private) approved by the user: landing (desktop + phone), dashboard, crop advice, chat (phone), leaf check (phone), my fields (tablet).
- Built into the client: theme tokens in `src/index.css` (brand 50-950, soil accent, ink/ink-soft/ink-muted, mint, line), fonts Plus Jakarta Sans (headings) + Noto Sans and Noto Sans Devanagari/Telugu/Tamil/Kannada (via Google Fonts in `index.html`), new favicon (SVG sprout, no emoji). `ui.jsx` restyled + `Eyebrow`, `LogoMark`. 146 slate classes swapped for the ink tokens.
- New public **landing page** `/welcome` (`pages/Landing.jsx`); visitors who are not logged in are redirected there (was /login). Login/register: photo panel on wide screens, no gradient.
- App shell: dark green bar (`brand-900`), desktop links incl. My fields; phone tab bar = Home, Ask, Crop, Disease, Fields (Fertilizer moved to the account menu on phones); avatar menu; skip link.
- Dashboard rebuilt: weather + forecast and alerts on the left; quick actions, My fields (GET /api/fields) and Recent advice (GET /api/history?limit=3) on the right.
- Photos: 6 Wikimedia Commons images (CC BY / BY-SA / CC0 / GODL-India) resized to 800 + 1600 px in `client/public/images/`; credits in the landing footer (required by the licences).
- i18n: 430 keys x 5 locales (landing + dashboard keys added). Client build OK. Landing checked in Chrome at 1440 px (matches the design); the extension's tab group kept closing, so the other screens and phone widths were not browser-checked.

## Research paper (2026-11-12)
- `docs/paper/main.tex` (IEEEtran conference, same layout as `docs/Published paper Gracy.pdf`) + `figures/` + `agri-dss-paper-overleaf.zip`. Authors/mentor from the first draft PDF. All numbers are from `reports/metrics.json`, `reports/chat_transcript_phase5.json`, PROGRESS and the test runs (ML 53 passed + 1 skipped, server 93 passed).
- Not compiled locally (no LaTeX on this PC; the user compiles on Overleaf). Body text has ~0% 6-gram overlap with the old draft and the reference paper (only the author block matches).
- Paper updated 2026-11-14 with the disease results (abstract, method III-C-3, new "Leaf Disease Model" subsection + Table + training-curve figure, limitations, conclusion, Mendeley dataset citation); Overleaf zip rebuilt. Citation order checked.

## Deployment guide (2026-11-12)
- `docs/DEPLOYMENT.md`: Render (ML + API, Blueprint `render.yaml` or manual) + Vercel (`client/vercel.json`). Model + district soil files go in a GitHub Release zip, fetched at build by `ml-service/scripts/fetch_artifacts.py` (tested locally against a served zip). sklearn/numpy pinned to 1.7.2 / 2.1.3 in the Render build (joblib pickle). Not deployed yet; the user does it.

## Phase 7: next steps
- Response-time benchmark (p50/p95 per endpoint) → `reports/`; architecture diagram in `docs/`; final README with screenshots (Playwright could automate the screenshots; ask before installing it, since it downloads Chromium).

## Open items
- The user will add `MONGODB_URI` + `GEMINI_API_KEY` to `server/.env` later (instructions are in `server/.env.example`).
