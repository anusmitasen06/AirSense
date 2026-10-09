# AirSense — Air Quality Monitoring & Prediction

A starter full-stack student project using:
- React + Vite + Recharts (frontend)
- FastAPI + Python (backend)
- Open-Meteo Air Quality API (no API key required for non-commercial use)
- scikit-learn RandomForestRegressor (ML next-hour AQI estimate)
- OpenAQ can be added later for station-based measured observations and historical sensor data.

## Important data note
Open-Meteo provides model-based air-quality forecasts, not necessarily measurements from a nearby ground station. The dashboard labels data as provider/model data and the ML estimate is a student-project prototype trained from recent hourly API values. It is not an official health forecast. OpenAQ is not wired into this starter yet; add it if the project specifically needs station observations.

## Requirements
- Python 3.10+
- Node.js 20+ recommended
- VS Code

## 1. Start the backend
Open a terminal in the `backend` folder:

Windows:
```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

macOS/Linux:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Open http://127.0.0.1:8000/docs to test the API.

## 2. Start the frontend
Open a second terminal in the `frontend` folder:
```bash
npm install
npm run dev
```
Open the URL Vite prints (usually http://localhost:5173).

## Cities supported in the starter
Search for a city by name. The app uses Open-Meteo geocoding, so many locations can work, but availability depends on provider coverage.

## API endpoints
- `GET /api/dashboard?city=Chennai`
- `GET /api/health`

## Troubleshooting
- If the frontend says it cannot connect, check that the backend is running on port 8000.
- If the API returns no hourly AQI data, try another city or check Open-Meteo's current API status.
- Never present missing values as zero.
- For a production-quality ML evaluation, gather a longer dataset, use a chronological train/test split, compare against a persistence baseline, and report MAE/RMSE. Do not claim model accuracy without measured evaluation.
