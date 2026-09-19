'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Wind, Flame, CloudFog, ShieldCheck, ShieldAlert, ShieldX, Activity } from 'lucide-react';

const BACKEND_URL = 'https://ivemps-lite-backend.onrender.com';

export default function Dashboard() {
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);

  async function fetchData() {
    try {
      const latestRes = await fetch(`${BACKEND_URL}/readings/latest`);
      const latestData = await latestRes.json();
      setLatest(latestData);

      const historyRes = await fetch(`${BACKEND_URL}/readings`);
      const historyData = await historyRes.json();
      setHistory(historyData);

      const forecastRes = await fetch(`${BACKEND_URL}/forecast`);
      const forecastData = await forecastRes.json();
      setForecast(forecastData);

      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Config for the safety badge: color + icon depending on rating
  function ratingConfig(rating) {
    switch (rating) {
      case 'Danger':
        return { bg: 'from-red-500 to-rose-600', icon: ShieldX, label: 'Danger' };
      case 'Warning':
        return { bg: 'from-amber-400 to-orange-500', icon: ShieldAlert, label: 'Warning' };
      case 'Safe':
        return { bg: 'from-emerald-400 to-green-600', icon: ShieldCheck, label: 'Safe' };
      default:
        return { bg: 'from-slate-400 to-slate-500', icon: ShieldAlert, label: 'Unknown' };
    }
  }

  const rc = ratingConfig(latest?.safety_rating);
  const RatingIcon = rc.icon;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
        <div className="text-white text-xl animate-pulse flex items-center gap-3">
          <Activity className="animate-spin" /> Loading IVEMPS-Lite dashboard...
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-6 md:p-10">
      {/* --- Header --- */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-4xl font-extrabold text-white tracking-tight">
            IVEMPS<span className="text-indigo-400">-Lite</span>
          </h1>
          <p className="text-slate-400 mt-1">IoT-Based Vehicle Emission Monitoring & Prediction</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-800/60 px-4 py-2 rounded-full border border-slate-700">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
          <span className="text-slate-300 text-sm font-medium">Live</span>
        </div>
      </div>

      {/* --- Gas reading cards --- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <GasCard icon={CloudFog} label="CO2" value={latest?.co2_ppm} unit="ppm" color="from-sky-400 to-blue-600" />
        <GasCard icon={Flame} label="CO" value={latest?.co_ppm} unit="ppm" color="from-red-400 to-rose-600" />
        <GasCard icon={Wind} label="Smoke / HC" value={latest?.smoke_ppm} unit="ppm" color="from-amber-400 to-yellow-600" />

        {/* Safety rating card, styled distinctly */}
        <div className={`rounded-2xl p-5 bg-gradient-to-br ${rc.bg} shadow-lg flex flex-col justify-between`}>
          <div className="flex items-center justify-between">
            <p className="text-white/90 text-sm font-medium">Safety Rating</p>
            <RatingIcon className="text-white/90" size={22} />
          </div>
          <p className="text-3xl font-extrabold text-white mt-3">{rc.label}</p>
        </div>
      </div>

      {/* --- Forecast card --- */}
      {forecast && forecast.predicted_safety_rating && forecast.predicted_safety_rating !== 'Unknown' && (
        <div className={`rounded-2xl p-5 mb-8 bg-gradient-to-r ${ratingConfig(forecast.predicted_safety_rating).bg} shadow-lg flex items-center justify-between`}>
          <div>
            <p className="text-white/90 text-sm font-medium">Predicted in {forecast.horizon_seconds ?? 15} seconds</p>
            <p className="text-2xl font-extrabold text-white mt-1">{forecast.predicted_safety_rating}</p>
          </div>
          <div className="text-right">
            <p className="text-white/80 text-xs">Model confidence</p>
            <p className="text-xl font-bold text-white">{Math.round((forecast.confidence ?? 0) * 100)}%</p>
          </div>
        </div>
      )}

      {/* --- Chart --- */}
      <div className="bg-slate-800/60 backdrop-blur border border-slate-700 rounded-2xl p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-white mb-4">Emission History</h2>
        <ResponsiveContainer width="100%" height={380}>
          <LineChart data={history}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="timestamp" tick={false} stroke="#64748b" />
            <YAxis stroke="#94a3b8" />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
              labelStyle={{ color: '#94a3b8' }}
            />
            <Legend />
            <Line type="monotone" dataKey="co2_ppm" stroke="#38bdf8" name="CO2 (ppm)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="co_ppm" stroke="#fb7185" name="CO (ppm)" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="smoke_ppm" stroke="#facc15" name="Smoke/HC (ppm)" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="text-center text-slate-500 text-sm mt-8">
        VTU Major Project · Based on IEEE Access IVEMPS (2025)
      </p>
    </main>
  );
}

// Reusable card component for the 3 gas readings
function GasCard({ icon: Icon, label, value, unit, color }) {
  return (
    <div className="rounded-2xl p-5 bg-slate-800/60 backdrop-blur border border-slate-700 shadow-lg hover:scale-[1.02] transition-transform">
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-4`}>
        <Icon className="text-white" size={20} />
      </div>
      <p className="text-slate-400 text-sm">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">
        {value ?? '--'} <span className="text-base font-normal text-slate-400">{unit}</span>
      </p>
    </div>
  );
}
