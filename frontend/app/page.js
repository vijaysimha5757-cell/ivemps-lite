'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Wind, Flame, CloudFog, ShieldCheck, ShieldAlert, ShieldX, Activity, WifiOff, Clock, Cpu } from 'lucide-react';

const BACKEND_URL = 'https://ivemps-lite-backend.onrender.com';
const REFRESH_MS = 5000;
const FETCH_TIMEOUT_MS = 60000; // Render free tier can take ~50s to wake up

// Results of the deployed 3-gas-input model (train_forecast_model.py, 70/30 chronological split).
const MODEL_RESULTS = {
  accuracy: 66.6,
  f1: 0.68,
  dangerF1: 0.80,
};
const PAPER_RESULTS = { accuracy: 83.3, f1: 0.79, dangerF1: 0.70 };

// ---------- helpers ----------
// Backend stores naive UTC timestamps (no "Z"), so add it before parsing.
function parseTs(s) {
  if (!s) return new Date(NaN);
  return new Date(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : s + 'Z');
}
function istFull(s) {
  return parseTs(s).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
}
function istClock(s) {
  return parseTs(s).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}
function ago(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
async function getJson(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`${BACKEND_URL}${path}`, { signal: ctrl.signal });
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function ratingConfig(rating) {
  switch (rating) {
    case 'Danger':
      return { bg: 'from-red-500 to-rose-700', icon: ShieldX, text: 'High emission level detected. Telegram alert sent.' };
    case 'Warning':
      return { bg: 'from-amber-400 to-orange-600', icon: ShieldAlert, text: 'One or more gases are elevated.' };
    case 'Safe':
      return { bg: 'from-emerald-400 to-green-700', icon: ShieldCheck, text: 'All gases within the normal range.' };
    default:
      return { bg: 'from-slate-500 to-slate-700', icon: ShieldAlert, text: 'Waiting for data from the device.' };
  }
}

// ---------- page ----------
export default function Dashboard() {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [conn, setConn] = useState('connecting'); // connecting | live | error
  const [lastFetch, setLastFetch] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let stop = false;
    let timer;

    async function fetchData() {
      // allSettled: one failing endpoint (e.g. /forecast) never blocks the others
      const [l, h, f] = await Promise.allSettled([
        getJson('/readings/latest'),
        getJson('/readings'),
        getJson('/forecast'),
      ]);
      let ok = false;
      if (l.status === 'fulfilled' && l.value && l.value.co2_ppm !== undefined) { setLatest(l.value); ok = true; }
      if (h.status === 'fulfilled' && Array.isArray(h.value)) { setHistory(h.value); ok = true; }
      if (f.status === 'fulfilled') setForecast(f.value);
      if (ok) { setConn('live'); setLastFetch(Date.now()); } else { setConn('error'); }
    }

    // chained timeout (not setInterval) so slow requests never overlap
    async function loop() {
      await fetchData();
      if (!stop) timer = setTimeout(loop, REFRESH_MS);
    }
    loop();
    return () => { stop = true; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const rating = latest?.safety_rating;
  const rc = ratingConfig(rating);
  const RatingIcon = rc.icon;
  const deviceAge = latest?.timestamp ? now - parseTs(latest.timestamp).getTime() : null;
  const deviceStale = deviceAge !== null && deviceAge > 90000;

  const chartData = history.slice(-120).map((r) => ({ ...r, t: istClock(r.timestamp), full: istFull(r.timestamp) }));
  const spark = history.slice(-30);
  const dangerEvents = history.filter((r) => r.safety_rating === 'Danger').slice(-6).reverse();

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-5 md:p-10 text-white">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            IVEMPS<span className="text-indigo-400">-Lite</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">IoT-Based Vehicle Emission Monitoring &amp; Prediction</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-800/60 px-4 py-2 rounded-full border border-slate-700 text-sm">
          {conn === 'live' ? (
            <>
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <span className="text-slate-200">Live · updated {lastFetch ? ago(now - lastFetch) : '...'}</span>
            </>
          ) : conn === 'connecting' ? (
            <><Activity size={14} className="animate-spin text-indigo-300" /><span className="text-slate-300">Connecting…</span></>
          ) : (
            <><WifiOff size={14} className="text-red-400" /><span className="text-slate-300">Server unreachable</span></>
          )}
        </div>
      </div>

      {/* connection banners */}
      {conn === 'connecting' && (
        <div className="mb-6 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
          Connecting to the cloud server… the free-tier backend sleeps when idle, so the first load can take up to
          50 seconds. The dashboard will fill in automatically.
        </div>
      )}
      {conn === 'error' && (
        <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          Can't reach the server right now. Retrying every few seconds…
        </div>
      )}
      {conn === 'live' && deviceStale && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 flex items-center gap-2">
          <Clock size={16} /> Last reading from the device was {ago(deviceAge)} ({istFull(latest.timestamp)} IST). Check that the ESP32 is powered and on WiFi.
        </div>
      )}

      {/* status hero */}
      <div className={`rounded-3xl p-6 md:p-8 mb-6 bg-gradient-to-br ${rc.bg} shadow-xl ${rating === 'Danger' ? 'animate-pulse' : ''}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/80 text-sm font-medium">Current safety rating</p>
            <p className="text-5xl md:text-6xl font-extrabold mt-1">{rating ?? '—'}</p>
            <p className="text-white/90 mt-2 text-sm md:text-base">{rc.text}</p>
          </div>
          <RatingIcon size={64} className="text-white/80 hidden sm:block" />
        </div>
        {latest?.timestamp && (
          <p className="text-white/70 text-xs mt-4">Last reading: {istFull(latest.timestamp)} IST</p>
        )}
      </div>

      {/* gas cards with sparklines */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
        <GasCard icon={CloudFog} label="CO2" value={latest?.co2_ppm} dataKey="co2_ppm" data={spark} grad="from-sky-400 to-blue-600" stroke="#38bdf8" />
        <GasCard icon={Flame} label="CO" value={latest?.co_ppm} dataKey="co_ppm" data={spark} grad="from-red-400 to-rose-600" stroke="#fb7185" />
        <GasCard icon={Wind} label="Smoke / HC" value={latest?.smoke_ppm} dataKey="smoke_ppm" data={spark} grad="from-amber-400 to-yellow-600" stroke="#facc15" />
      </div>

      {/* forecast */}
      <div className="rounded-2xl p-5 mb-6 bg-slate-800/60 border border-slate-700">
        <div className="flex items-center gap-2 mb-1"><Cpu size={16} className="text-indigo-300" /><h2 className="font-semibold">15-second forecast</h2></div>
        {forecast?.predicted_safety_rating && forecast.predicted_safety_rating !== 'Unknown' ? (
          <div className="flex items-end justify-between">
            <p className="text-3xl font-extrabold">{forecast.predicted_safety_rating}</p>
            <p className="text-slate-400 text-sm">Model confidence {Math.round((forecast.confidence ?? 0) * 100)}%</p>
          </div>
        ) : (
          <p className="text-slate-400 text-sm">{forecast?.message ?? 'The forecast appears once at least 10 readings have been received.'}</p>
        )}
      </div>

      {/* chart */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5 mb-6">
        <h2 className="font-semibold mb-3">Emission history (IST)</h2>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="t" stroke="#64748b" tick={{ fontSize: 11 }} minTickGap={50} />
            <YAxis stroke="#94a3b8" />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#94a3b8' }} labelFormatter={(label, payload) => payload?.[0]?.payload?.full ?? label} />
            <Legend />
            <Line type="monotone" dataKey="co2_ppm" stroke="#38bdf8" name="CO2 (ppm)" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="co_ppm" stroke="#fb7185" name="CO (ppm)" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="smoke_ppm" stroke="#facc15" name="Smoke/HC (ppm)" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* alert history + zones */}
      <div className="grid md:grid-cols-2 gap-5 mb-6">
        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5">
          <h2 className="font-semibold mb-3">Recent Danger events</h2>
          {dangerEvents.length === 0 ? (
            <p className="text-slate-400 text-sm">No Danger readings in the recent history.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {dangerEvents.map((e) => (
                <li key={e.id} className="flex justify-between gap-3 border-b border-slate-700/60 pb-2">
                  <span className="text-slate-300">{istFull(e.timestamp)}</span>
                  <span className="text-slate-400 text-right">CO2 {e.co2_ppm} · CO {e.co_ppm} · Smoke {e.smoke_ppm}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5">
          <h2 className="font-semibold mb-1">Fuzzy classification zones</h2>
          <p className="text-slate-400 text-xs mb-3">Readings between zones are blends, which avoids flickering near a boundary. Safe = all Low · Danger = any High · otherwise Warning.</p>
          <table className="w-full text-sm">
            <thead><tr className="text-slate-400 text-left text-xs"><th className="pb-2">Gas (ppm)</th><th>Low</th><th>Medium</th><th>High</th></tr></thead>
            <tbody className="text-slate-200">
              <tr><td className="py-1">CO2</td><td>≤ 8</td><td>14 – 24</td><td>≥ 30</td></tr>
              <tr><td className="py-1">CO</td><td>≤ 0.9</td><td>1.3 – 1.8</td><td>≥ 2.2</td></tr>
              <tr><td className="py-1">Smoke/HC</td><td>≤ 7</td><td>10 – 15</td><td>≥ 18</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* architecture + results */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5 mb-6">
        <h2 className="font-semibold mb-3">How it works</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {['MQ135 · MQ7 · MQ2 sensors', 'ESP32 + fuzzy logic', 'WiFi', 'Flask API', 'Supabase PostgreSQL', 'RandomForest forecast', 'Dashboard + Telegram'].map((s, i, a) => (
            <span key={s} className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded-lg bg-slate-900/70 border border-slate-700">{s}</span>
              {i < a.length - 1 && <span className="text-indigo-400">→</span>}
            </span>
          ))}
        </div>

        <h3 className="font-semibold mt-6 mb-2 text-sm">Forecast model vs. base paper (IEEE Access 2025)</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-slate-400 text-left text-xs"><th className="pb-2">Metric</th><th>This project</th><th>Base paper (N-HiTS)</th></tr></thead>
          <tbody className="text-slate-200">
            <tr><td className="py-1">Accuracy</td><td>{MODEL_RESULTS.accuracy}%</td><td>{PAPER_RESULTS.accuracy}%</td></tr>
            <tr><td className="py-1">F1-score</td><td>{MODEL_RESULTS.f1}</td><td>{PAPER_RESULTS.f1}</td></tr>
            <tr><td className="py-1">Danger F1-score</td><td>{MODEL_RESULTS.dangerF1}</td><td>{PAPER_RESULTS.dangerF1}</td></tr>
          </tbody>
        </table>
        <p className="text-slate-500 text-xs mt-3">
          This project's model is a RandomForest trained on a synthetic driving-cycle dataset; the paper used N-HiTS on real
          PEMS data, so the numbers are indicative rather than a like-for-like benchmark.
        </p>
      </div>

      <p className="text-center text-slate-500 text-xs">VTU Major Project · Based on IVEMPS, IEEE Access (2025)</p>
    </main>
  );
}

function GasCard({ icon: Icon, label, value, dataKey, data, grad, stroke }) {
  return (
    <div className="rounded-2xl p-5 bg-slate-800/60 border border-slate-700 shadow-lg">
      <div className="flex items-center justify-between">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center`}>
          <Icon className="text-white" size={20} />
        </div>
        <p className="text-slate-400 text-sm">{label}</p>
      </div>
      <p className="text-3xl font-bold mt-3">
        {value ?? '--'} <span className="text-base font-normal text-slate-400">ppm</span>
      </p>
      <div className="mt-2">
        <ResponsiveContainer width="100%" height={40}>
          <LineChart data={data}>
            <Line type="monotone" dataKey={dataKey} stroke={stroke} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
