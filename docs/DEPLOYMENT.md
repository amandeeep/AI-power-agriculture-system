# Deployment Guide: Agri-DSS

**Render** runs the backend (Express API + Python ML service). **Vercel** runs the frontend (React).
Everything here is on free plans.

```
 Browser ──► Vercel (React, static)
                │  https://agri-dss-api.onrender.com/api/...
                ▼
         Render: agri-dss-api (Node/Express) ──► MongoDB Atlas, Gemini, Open-Meteo, OSM, India Post
                │  X-Internal-Key header
                ▼
         Render: agri-dss-ml (Python/FastAPI, crop model + district soil)
```

| Part | Host | Folder | Example URL |
|---|---|---|---|
| ML service | Render (Python) | `ml-service/` | `https://agri-dss-ml.onrender.com` |
| API server | Render (Node) | `server/` | `https://agri-dss-api.onrender.com` |
| Frontend | Vercel (Vite) | `client/` | `https://agri-dss.vercel.app` |
| Database | MongoDB Atlas (already set up) | n/a | n/a |

Deploy in this order: **ML service → API server → frontend → set CORS**. Each step needs the URL from the step before.

> Commands are for **PowerShell** on Windows, run from the project root `D:\AI powered\agri-dss` unless the step says otherwise.

---

## 0. What you need

- A **GitHub** account. Optional: the GitHub CLI `gh` (`winget install GitHub.cli`), which makes steps 1-2 one command each.
- A **Render** account (https://render.com, sign in with GitHub).
- A **Vercel** account (https://vercel.com, sign in with GitHub).
- Your values from `server\.env`: `MONGODB_URI` and `GEMINI_API_KEY`. **Never commit `.env` files.**

Generate the two secrets now and keep them in a notepad:

```powershell
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('INTERNAL_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

The `INTERNAL_KEY` value is used twice: as `INTERNAL_API_KEY` on the ML service and as `ML_INTERNAL_KEY` on the API server. Both must be **identical**.

---

## 1. Push the code to GitHub

```powershell
cd "D:\AI powered\agri-dss"

git branch -M main
git add .

# Safety check: this must print NOTHING (no .env, dataset, model or district file staged)
git diff --cached --name-only | Select-String -Pattern "\.env$|\.joblib|\.keras|ml-service/data/|district_(soil|boundaries)"

git commit -m "Agri-DSS: initial commit"
```

Then create the repo and push. **Option A, with `gh`:**

```powershell
gh auth login
gh repo create agri-dss --private --source . --remote origin --push
```

**Option B, without `gh`:** create an empty repo named `agri-dss` on github.com (no README), then:

```powershell
git remote add origin https://github.com/<your-username>/agri-dss.git
git push -u origin main
```

---

## 2. Upload the trained model files (they are not in Git)

`.gitignore` keeps the model (`crop_stack.joblib`, ~7.5 MB) and the district soil files out of Git, so Render can't get them from the repo.
Instead we put them in a zip on a **GitHub Release**. Render's build runs `ml-service/scripts/fetch_artifacts.py`, which downloads and unpacks that zip.

### 2a. Make the zip

```powershell
cd "D:\AI powered\agri-dss\ml-service"
# copy only the needed files into a temporary folder with the same layout
New-Item -ItemType Directory -Force ..\_pkg\models, ..\_pkg\knowledge | Out-Null
Copy-Item models\crop_stack.joblib, models\scaler.joblib, models\label_encoder.joblib, models\crop_model_meta.json ..\_pkg\models\
Copy-Item knowledge\district_soil.json, knowledge\district_boundaries.json ..\_pkg\knowledge\
# zip it (outside the repo is fine too), then remove the temp folder
Compress-Archive -Force -Path ..\_pkg\models, ..\_pkg\knowledge -DestinationPath ..\agri-dss-artifacts.zip
Remove-Item -Recurse -Force ..\_pkg
cd ..
```

The zip must contain `models/...` and `knowledge/...` folders at its top level (about 8 MB). Check:

```powershell
ml-service\.venv\Scripts\python.exe -c "import zipfile;print(zipfile.ZipFile('agri-dss-artifacts.zip').namelist())"
```

> Later, when the disease model is trained on Colab, add `models\disease_mnv2.keras` and `models\class_names.json` to this zip.
> The free Render plan (512 MB RAM) is too small for TensorFlow, though, so the disease feature will stay "unavailable" there. Everything else works.

### 2b. Upload it as a release

**With `gh`:**

```powershell
gh release create artifacts-v1 agri-dss-artifacts.zip --title "Model artifacts v1" --notes "Trained crop model + district soil data for deployment"
```

**Without `gh`:** on GitHub open your repo → **Releases** → **Draft a new release** → tag `artifacts-v1` → drag `agri-dss-artifacts.zip` in → **Publish**.

### 2c. Get the download link (`ARTIFACTS_URL`)

- **Public repo:** right-click the zip in the release and copy the link. It looks like
  `https://github.com/<user>/agri-dss/releases/download/artifacts-v1/agri-dss-artifacts.zip`.
  Leave `ARTIFACTS_TOKEN` empty.
- **Private repo** (the default in step 1): the normal link needs login, so use the API link plus a token:
  ```powershell
  gh release view artifacts-v1 --json assets --jq ".assets[0].apiUrl"
  # -> https://api.github.com/repos/<user>/agri-dss/releases/assets/123456789
  ```
  Then create a token: GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate.
  Give it access to **only** the `agri-dss` repo, with permission **Contents: Read-only**. Use it as `ARTIFACTS_TOKEN`.

Don't commit the zip: `Remove-Item agri-dss-artifacts.zip` (or keep it outside the repo).

---

## 3. Deploy the backend on Render

There are two ways. **3A (Blueprint)** uses the `render.yaml` in the repo root and creates both services at once. **3B (manual)** creates them one by one in the dashboard. Pick one.

### 3A. Blueprint (recommended)

1. Render dashboard → **New** → **Blueprint** → connect the `agri-dss` repo → Render reads `render.yaml`.
2. Render asks for every value marked `sync: false`. Use **placeholders for the URLs for now**; you'll fix them in step 3C:

   | Service | Key | Value |
   |---|---|---|
   | agri-dss-ml | `INTERNAL_API_KEY` | your `INTERNAL_KEY` |
   | agri-dss-ml | `ARTIFACTS_URL` | link from step 2c |
   | agri-dss-ml | `ARTIFACTS_TOKEN` | token (private repo) or empty |
   | agri-dss-ml | `CORS_ORIGINS` | `https://agri-dss-api.onrender.com` |
   | agri-dss-api | `CLIENT_ORIGIN` | `http://localhost:5173` for now (fixed in step 5) |
   | agri-dss-api | `MONGODB_URI` | from `server\.env` |
   | agri-dss-api | `ML_SERVICE_URL` | `https://agri-dss-ml.onrender.com` |
   | agri-dss-api | `ML_INTERNAL_KEY` | your `INTERNAL_KEY` (same as above) |
   | agri-dss-api | `GEMINI_API_KEY` | from `server\.env` |

   `JWT_SECRET` is generated by Render automatically.
3. Click **Apply**. The first ML build takes ~3-5 min (scikit-learn wheels plus the model download).

### 3B. Manual setup

**ML service:** New → **Web Service** → pick the repo:

| Setting | Value |
|---|---|
| Name | `agri-dss-ml` |
| Region | Singapore (closest to India) |
| Root Directory | `ml-service` |
| Runtime / Language | Python 3 |
| Build Command | `pip install -r requirements.txt "scikit-learn==1.7.2" "numpy==2.1.3" && python scripts/fetch_artifacts.py` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Instance type | Free |
| Health Check Path (Advanced) | `/health` |

Environment variables: `PYTHON_VERSION=3.11.9`, `INTERNAL_API_KEY`, `ARTIFACTS_URL`, `ARTIFACTS_TOKEN` (private repo only), `CORS_ORIGINS=https://agri-dss-api.onrender.com`.

> Why pin `scikit-learn==1.7.2` and `numpy==2.1.3`? The model was saved with exactly these versions. A joblib model loaded with a different scikit-learn version can fail or warn.

**API server:** New → **Web Service** → same repo:

| Setting | Value |
|---|---|
| Name | `agri-dss-api` |
| Region | Singapore (same as the ML service) |
| Root Directory | `server` |
| Runtime / Language | Node |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Instance type | Free |
| Health Check Path | `/api/health` |

Environment variables (copy the rest from `server\.env.example` if you want to change defaults):

```env
NODE_VERSION=24
NODE_ENV=production
CLIENT_ORIGIN=http://localhost:5173
MONGODB_URI=<from server\.env>
JWT_SECRET=<your JWT_SECRET>
JWT_EXPIRES_IN=7d
ML_SERVICE_URL=https://agri-dss-ml.onrender.com
ML_INTERNAL_KEY=<your INTERNAL_KEY>
ML_TIMEOUT_MS=60000
GEMINI_API_KEY=<from server\.env>
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_THINKING_LEVEL=minimal
```

Don't set `PORT`. Render provides it and the server already reads it.

### 3C. Fix the URLs

Render may add a suffix if a name is taken (for example `agri-dss-ml-x7k2.onrender.com`). Open each service and copy its real URL from the top of the page.
If it differs, update `ML_SERVICE_URL` (API) and `CORS_ORIGINS` (ML) under **Environment** and click **Save, rebuild and deploy**.

### 3D. MongoDB Atlas: allow Render

Render's outgoing IP addresses change, so Atlas must accept all IPs:
Atlas → **Network Access** → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`). Your database user and password still protect the data.

### 3E. Check the backend

```powershell
# ML service: status "ok"; crop_model and district_soil should be loaded
curl.exe -s https://agri-dss-ml.onrender.com/health

# API server: mongo "connected", mlService.status "ok", gemini configured
curl.exe -s https://agri-dss-api.onrender.com/api/health

# The ML service must reject calls without the key (expect 401/403)
curl.exe -s -o NUL -w "%{http_code}`n" -X POST https://agri-dss-ml.onrender.com/predict/crop -H "Content-Type: application/json" -d "{}"
```

The first request after a deploy or a nap can take **up to ~1 minute** (see section 7). Just retry.

---

## 4. Deploy the frontend on Vercel

`client/vercel.json` is already in the repo. It tells Vercel this is a Vite app and sends every route (for example `/crop`, `/fields`) to `index.html`, so refreshing a page doesn't give a 404.

### 4A. Dashboard

1. Vercel → **Add New… → Project** → import the `agri-dss` repo.
2. **Root Directory:** click *Edit* → choose `client`.
3. Framework Preset: **Vite** (detected automatically). Build Command `npm run build`, Output Directory `dist`.
4. **Environment Variables:**

   | Key | Value |
   |---|---|
   | `VITE_API_BASE_URL` | `https://agri-dss-api.onrender.com/api` |

   Only `VITE_*` variables reach the browser. **Never** put `GEMINI_API_KEY`, `MONGODB_URI` or other secrets in Vercel.
5. Settings → General → **Node.js Version: 22.x or newer** (Vite 8 needs Node ≥ 20.19).
6. **Deploy.** You get a URL like `https://agri-dss.vercel.app`.

> `VITE_API_BASE_URL` is baked in **at build time**. If you change it later, **redeploy** (Deployments → ⋯ → Redeploy).

### 4B. CLI (alternative)

```powershell
cd "D:\AI powered\agri-dss\client"
npx vercel login
npx vercel link                      # create/link the project; root = this folder
npx vercel env add VITE_API_BASE_URL production
#   paste: https://agri-dss-api.onrender.com/api
npx vercel --prod                    # build + deploy to production
```

---

## 5. Connect the frontend and backend (CORS)

The API only accepts browser requests from the origins listed in `CLIENT_ORIGIN`. On Render, open **agri-dss-api** → **Environment** and set:

```env
CLIENT_ORIGIN=https://agri-dss.vercel.app
```

To also allow local development, list several origins separated by commas:
`https://agri-dss.vercel.app,http://localhost:5173`.
Use the exact URL with no trailing `/`. Save, and the service redeploys.

> Vercel *preview* deployments get different URLs (`agri-dss-git-branch-user.vercel.app`). They are blocked unless you add them too. Use the main production URL for demos.

---

## 6. Final check (end-to-end)

Open `https://agri-dss.vercel.app` and test:

1. **Register** a new account, then log out and log in again (checks MongoDB and JWT).
2. **Dashboard** shows weather for a city (checks Open-Meteo through the API).
3. **Crop advice** with N 90, P 42, K 43, pH 6.5 → a top-5 list with score bars (checks the ML service).
4. **My fields** → add a field with "use my location" or a PIN code → **From my field** gives a recommendation (checks district soil and climate normals).
5. **Ask (chat)** in Hindi: `मेरी मिट्टी N 90, P 42, K 43, pH 6.5 है, कौन सी फसल लगाऊं?` → reply with a crop card (checks Gemini).
6. **Refresh** on `/crop`. It must not show a Vercel 404 (checks `vercel.json`).
7. Open `https://agri-dss.vercel.app/status`. All services should be green.

If the browser console shows a **CORS error**, `CLIENT_ORIGIN` doesn't match the Vercel URL exactly (step 5).

---

## 7. Free-plan limits (important for your demo)

| Limit | Effect | What to do |
|---|---|---|
| Render free services **sleep after 15 min** without traffic | First request then takes ~30-60 s; both services wake one after the other | Open `/api/health` ~2 min before a demo. `ML_TIMEOUT_MS=60000` already covers the wake-up. |
| **750 free instance-hours per month** per Render workspace | Two services awake 24/7 would need ~1,490 h, so they would be suspended near the end of the month | Don't keep them awake all month. For demo days you can add a free monitor (e.g. UptimeRobot) on `https://agri-dss-api.onrender.com/api/health` every 10 min. That call also pings the ML service, so it keeps both awake. Pause the monitor afterwards. |
| **512 MB RAM** on Render free | TensorFlow does not fit, so leaf-disease detection reports "unavailable" | Everything else works. For disease detection, use a paid instance (≥ 2 GB) and add `pip install -r requirements-tf.txt` to the ML build command. |
| **Gemini free tier** quota is per model and small | When it runs out, chat switches to "basic mode" (keyword fallback) by itself | Expected behaviour. Avoid spamming the chat before the demo. |
| No persistent disk on free Render | Nothing to lose: all data is in MongoDB Atlas, and the model files are re-downloaded at every build | n/a |

---

## 8. Updating after code changes

```powershell
git add .
git commit -m "describe the change"
git push
```

Render and Vercel both **redeploy automatically** on every push to `main`.

**New model version** (after retraining): rebuild the zip (step 2a), upload it as a new release (`gh release create artifacts-v2 agri-dss-artifacts.zip ...`), update `ARTIFACTS_URL` on **agri-dss-ml**, then **Manual Deploy → Clear build cache & deploy**.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| ML build fails at `[artifacts] ARTIFACTS_URL is not set` | Add the env var on agri-dss-ml (step 2c). |
| ML build: `HTTP Error 404` / `401` on download | Private repo: use the **API** asset URL plus `ARTIFACTS_TOKEN`. Public repo: check the link opens in a private browser window. |
| `/health` says `degraded`, `crop_model` not loaded | Zip is missing `models/...` files, or the wrong scikit-learn version is installed. Check the build log. |
| API logs `Invalid server configuration` and exits | A required env var is missing or too short (`JWT_SECRET` ≥ 16 chars, `ML_INTERNAL_KEY` set, `ML_SERVICE_URL` must be a full `https://` URL). |
| `/api/health`: `mlService.status: "unreachable"` | Wrong `ML_SERVICE_URL`, or the ML service is still waking up. Retry after 1 min. |
| Predictions fail with 401/403 from ML | `ML_INTERNAL_KEY` (API) ≠ `INTERNAL_API_KEY` (ML). Make them identical. |
| `/api/health`: mongo not connected | Atlas Network Access missing `0.0.0.0/0`, or a typo in `MONGODB_URI` (password with special characters must be URL-encoded). |
| Browser: CORS error | `CLIENT_ORIGIN` must exactly equal the Vercel URL (https, no trailing slash). |
| Frontend calls `https://agri-dss.vercel.app/api/...` and gets 404 | `VITE_API_BASE_URL` wasn't set at build time. Set it and **redeploy** on Vercel. |
| 404 when refreshing a page on Vercel | Root Directory must be `client` so `client/vercel.json` is used. |
| Chat always answers in "basic mode" | `GEMINI_API_KEY` missing/invalid, or the free quota is used up (check the Render logs for `[chat]` warnings with a 429 quotaId). |

---

## Files used for deployment

| File | Purpose |
|---|---|
| `render.yaml` | Render Blueprint for both backend services |
| `ml-service/scripts/fetch_artifacts.py` | Downloads the model and district-soil zip during the Render build |
| `client/vercel.json` | Vite build settings and SPA route rewrites for Vercel |
| `server/.env.example`, `ml-service/.env.example`, `client/.env.example` | Full list of settings, with explanations |
