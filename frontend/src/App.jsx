import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import { useEffect, useMemo, useState } from 'react'
import {
  Activity, Wind, MapPin, Search,
  RefreshCw, ShieldCheck, Clock3, AlertTriangle, Leaf, Waves
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip,
  XAxis, YAxis
} from 'recharts'

const API = 'http://127.0.0.1:8002';

function fmt(value, digits = 0) {
  return value === null || value === undefined || Number.isNaN(Number(value))
    ? '—' : Number(value).toFixed(digits)
}

function shortTime(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? value.slice(5, 16)
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' })
}
function MapClickHandler({ onSelect }) {
  useMapEvents({
    click(event) {
      onSelect(event.latlng.lat, event.latlng.lng)
    },
  })

  return null
}
function App() {
  const [cityInput, setCityInput] = useState('Chennai')
  const [city, setCity] = useState('Chennai')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [range, setRange] = useState('24h')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [pollutant, setPollutant] = useState('us_aqi')
  const [selectedPoint, setSelectedPoint] = useState(null)
  const [environmentReports, setEnvironmentReports] = useState([])
  const [reportsLoading, setReportsLoading] = useState(false)
  const [reportsError, setReportsError] = useState('')
  const [reportsRegion, setReportsRegion] = useState('Chennai')

  async function loadEnvironmentalReports(region) {
    const regionToSearch = (region || 'Chennai').trim()
    setReportsRegion(regionToSearch)
    setReportsLoading(true)
    setReportsError('')
    try {
      const response = await fetch(
        `${API}/api/environmental-reports?region=${encodeURIComponent(regionToSearch)}`
      )
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.detail || 'Could not load environmental reports.')
      }
      setEnvironmentReports(Array.isArray(body.reports) ? body.reports : [])
    } catch (e) {
      setReportsError(`${e.message} Check that the backend is running at ${API}.`)
      setEnvironmentReports([])
    } finally {
      setReportsLoading(false)
    }
  }

async function loadCoordinates(latitude, longitude) {
  setSelectedPoint([latitude, longitude])
  setLoading(true)
  setError('')

  try {
    const response = await fetch(
      `${API}/api/dashboard?latitude=${latitude}&longitude=${longitude}`
    )

    const body = await response.json()

    if (!response.ok) {
      throw new Error(body.detail || 'Could not load air-quality data.')
    }

    setData(body)
    setCity('')
    setCityInput('')
    loadEnvironmentalReports(body.location?.name || `Selected location (${latitude.toFixed(2)}, ${longitude.toFixed(2)})`)
  } catch (e) {
    setError(`${e.message}. Check that the backend is running at ${API}.`)
  } finally {
    setLoading(false)
  }
}

  async function loadDashboard(selectedCity = city) {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${API}/api/dashboard?city=${encodeURIComponent(selectedCity)}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail || 'Could not load air-quality data.')
      setData(body)
      setCity(selectedCity)
      setCityInput(selectedCity)
      loadEnvironmentalReports(selectedCity)
    } catch (e) {
      setError(`${e.message}. Check that the FastAPI backend is running at ${API}.`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDashboard('Chennai') }, [])

  // Set a sensible default date window whenever a new location is loaded.
  useEffect(() => {
    if (!data?.history?.length) return
    const dates = data.history.map(row => row.time?.slice(0, 10)).filter(Boolean).sort()
    if (!dates.length) return
    const today = data.current?.time?.slice(0, 10) || dates[dates.length - 1]
    const todayDate = new Date(`${today}T00:00:00Z`)
    todayDate.setUTCDate(todayDate.getUTCDate() - 6)
    const sevenDayStart = todayDate.toISOString().slice(0, 10)
    setStartDate(sevenDayStart < dates[0] ? dates[0] : sevenDayStart)
    setEndDate(today > dates[dates.length - 1] ? dates[dates.length - 1] : today)
  }, [data])

  const availableDates = useMemo(() => {
    const dates = (data?.history || []).map(row => row.time?.slice(0, 10)).filter(Boolean).sort()
    return { min: dates[0] || '', max: dates[dates.length - 1] || '' }
  }, [data])

  const chartData = useMemo(() => {
    if (!data?.history) return []
    const rows = data.history.filter(row => {
      const date = row.time?.slice(0, 10)
      const hasValue = row[pollutant] !== null && row[pollutant] !== undefined
      return hasValue && (!startDate || date >= startDate) && (!endDate || date <= endDate)
    })
    return rows.map(row => ({
      ...row,
      label: shortTime(row.time),
      value: row[pollutant]
    }))
  }, [data, startDate, endDate, pollutant])

  const currentAqi = data?.current?.us_aqi
  const recent = chartData.length > 1 ? chartData[chartData.length - 1]?.value - chartData[0]?.value : 0
  const rising = recent > 0

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Wind size={21} /></span><span>air<span className="brand-light">sense</span></span></div>
        <div className="side-label">WORKSPACE</div>
        <button className="nav-item active"><Activity size={18}/> Overview</button>
        <button className="nav-item" onClick={() => document.getElementById('trends')?.scrollIntoView({ behavior: 'smooth' })}><Waves size={18}/> Air trends</button>
        <button className="nav-item" onClick={() => document.getElementById('forecast')?.scrollIntoView({ behavior: 'smooth' })}><Clock3 size={18}/> ML prediction</button>
        <div className="sidebar-bottom">
          <div className="side-status"><span className="live-dot"></span><span>Data connection</span><b>{data ? 'Online' : '—'}</b></div>
          <p>AirSense · Student project</p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div><div className="eyebrow">ENVIRONMENTAL INTELLIGENCE</div><h1>Air quality overview</h1></div>
          <div className="top-actions">
            <span className="live-pill"><span className="live-dot"></span> Provider connected</span>
            <button className="icon-button" onClick={() => loadDashboard(city)} title="Refresh"><RefreshCw size={17} className={loading ? 'spin' : ''}/></button>
          </div>
        </header>

        <section className="search-row">
          <div className="location-heading"><MapPin size={18}/><div><strong>{data?.location?.name || city}</strong><span>{[data?.location?.admin1, data?.location?.country].filter(Boolean).join(', ') || 'Choose a location'}</span></div></div>
          <form className="search-form" onSubmit={e => { e.preventDefault(); if (cityInput.trim()) loadDashboard(cityInput.trim()) }}>
            <Search size={17}/><input value={cityInput} onChange={e => setCityInput(e.target.value)} placeholder="Search city, e.g. Delhi" aria-label="Search city"/>
            <button type="submit" disabled={loading}>{loading ? 'Loading…' : 'Explore'}</button>
          </form>
        </section>
        <section
  style={{
    margin: '24px 0',
    padding: '20px',
    background: '#121d2c',
    border: '1px solid #263346',
    borderRadius: '16px',
    color: '#edf4fa',
  }}
>
  <h2 style={{ marginTop: 0 }}>Explore air quality by map</h2>

  <p style={{ color: '#a9b8c9' }}>
    Click anywhere on the map to check air quality at that location.
  </p>

  <div style={{ height: '350px', borderRadius: '12px', overflow: 'hidden' }}>
    <MapContainer
      center={[13.0878, 80.2785]}
      zoom={6}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapClickHandler onSelect={loadCoordinates} />

      {selectedPoint && (
        <Marker position={selectedPoint} />
      )}
    </MapContainer>
  </div>

  {selectedPoint && (
    <p style={{ color: '#65d7bb' }}>
      Selected coordinates: {selectedPoint[0].toFixed(4)},
      {' '}{selectedPoint[1].toFixed(4)}
    </p>
  )}

  {loading && <p>Fetching air-quality data…</p>}
</section>

        {error && <div className="error-banner"><AlertTriangle size={18}/><span>{error}</span><button onClick={() => loadDashboard(city)}>Retry</button></div>}

        {!data && loading && <div className="loading-card"><div className="loader"></div><p>Fetching air-quality information…</p></div>}

        {data && <>
          <section className="hero-grid">
            <div className={`aqi-card tone-${data.current.category.tone}`}>
              <div className="card-topline"><span className="card-kicker">CURRENT US AQI</span><span className="status-pill">{data.current.category.label}</span></div>
              <div className="aqi-main"><div><span className="aqi-number">{fmt(currentAqi)}</span><span className="aqi-unit">AQI</span></div><div className="aqi-icon"><Wind size={29}/></div></div>
              <p className="aqi-description">Air-quality index provided by the air-quality model for this location.</p>
              <div className="aqi-footer"><span><Clock3 size={14}/> {data.current.time ? `Updated ${shortTime(data.current.time)}` : 'Current timestamp unavailable'}</span><span className="location-coords">{Number(data.location.latitude).toFixed(2)}, {Number(data.location.longitude).toFixed(2)}</span></div>
            </div>
            <div className="insight-card">
              <div className="section-heading"><div><span className="card-kicker">AIR QUALITY SNAPSHOT</span><h2>Pollutant levels</h2></div><span className="round-icon"><Activity size={17}/></span></div>
              <div className="pollutant-grid">
                {data.pollutants.map(p => <div className="pollutant" key={p.key}><span>{p.label}</span><strong>{fmt(p.value, 1)}</strong><small>{p.unit}</small></div>)}
              </div>
              <div className="mini-note"><span className="note-dot"></span> Values may be unavailable where provider coverage is limited.</div>
            </div>
          </section>

          <section className="section-block" id="trends">
            <div className="section-heading trends-heading"><div><span className="card-kicker">HISTORICAL SERIES</span><h2>Pollution trends</h2><p>Explore hourly provider data for this location.</p></div>
              <div className="chart-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                <select value={pollutant} onChange={e => setPollutant(e.target.value)} aria-label="Select chart variable">
                  <option value="us_aqi">US AQI</option><option value="european_aqi">European AQI</option><option value="pm2_5">PM2.5</option><option value="pm10">PM10</option><option value="nitrogen_dioxide">NO₂</option><option value="sulphur_dioxide">SO₂</option><option value="ozone">O₃</option><option value="carbon_monoxide">CO</option>
                </select>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: '#a9b8c9', fontSize: '12px' }}>
                  Start date
                  <input type="date" value={startDate} min={availableDates.min} max={endDate || availableDates.max} onChange={e => setStartDate(e.target.value)} style={{ padding: '8px', borderRadius: '8px', border: '1px solid #263346', background: '#121d2c', color: '#edf4fa' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: '#a9b8c9', fontSize: '12px' }}>
                  End date
                  <input type="date" value={endDate} min={startDate || availableDates.min} max={availableDates.max} onChange={e => setEndDate(e.target.value)} style={{ padding: '8px', borderRadius: '8px', border: '1px solid #263346', background: '#121d2c', color: '#edf4fa' }} />
                </label>
                <button type="button" onClick={() => { setStartDate(availableDates.min); setEndDate(data?.current?.time?.slice(0, 10) || availableDates.max) }} style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid #263346', background: 'transparent', color: '#edf4fa', cursor: 'pointer' }}>Reset</button>
              </div>
            </div>
            <div className="chart-card">
              {chartData.length ? <ResponsiveContainer width="100%" height={270}>
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                  <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#65d7bb" stopOpacity={0.27}/><stop offset="95%" stopColor="#65d7bb" stopOpacity={0.01}/></linearGradient></defs>
                  <CartesianGrid stroke="#263346" strokeDasharray="4 5" vertical={false}/>
                  <XAxis dataKey="label" tick={{ fill: '#8290a4', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={36}/>
                  <YAxis tick={{ fill: '#8290a4', fontSize: 11 }} axisLine={false} tickLine={false}/>
                  <Tooltip contentStyle={{ background: '#121d2c', border: '1px solid #2a3b50', borderRadius: 12, color: '#edf4fa' }} labelStyle={{ color: '#a9b8c9' }}/>
                  <Area type="monotone" dataKey="value" stroke="#65d7bb" strokeWidth={2.5} fill="url(#chartFill)" connectNulls/>
                </AreaChart>
              </ResponsiveContainer> : <div className="empty-chart">No hourly series is available for this selection.</div>}
              <div className="chart-foot"><span><span className="legend-line"></span> {pollutant.replace('_', '.').toUpperCase()}</span><span>{chartData.length} hourly records displayed</span></div>
            </div>
          </section>

          <section className="bottom-grid" id="forecast">
            <div className="prediction-card">
              <div className="section-heading"><div><span className="card-kicker">MACHINE LEARNING</span><h2>Next-hour AQI estimate</h2></div><span className="round-icon purple"><Activity size={17}/></span></div>
              <div className="prediction-value">{fmt(data.prediction?.value, 1)} <span>AQI</span></div>
              <p className="prediction-caption">{data.prediction?.note || 'Prediction unavailable.'}</p>
              <div className="model-chip"><span className="model-dot"></span>{data.prediction?.method || 'ML model'}{data.prediction?.training_rows ? ` · ${data.prediction.training_rows} training rows` : ''}</div>
              <div className="disclaimer"><AlertTriangle size={15}/> Experimental estimate; not an official forecast or medical advice.</div>
            </div>
            <div className="recommendation-card">
              <div className="section-heading"><div><span className="card-kicker">WHAT YOU CAN DO</span><h2>Recommendations</h2></div><span className="round-icon green"><ShieldCheck size={17}/></span></div>
              <ul className="recommendation-list">{data.recommendations.map((r, i) => <li key={i}><span className="check-mark">✓</span>{r}</li>)}</ul>
              <div className="source-note"><Leaf size={15}/><span>Source: {data.source}</span></div>
            </div>
          </section>
          <footer className="page-footer"><span>AirSense · Monitor your air. Understand your environment.</span><span>Generated {new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></footer>
        </>}
        <section
          id="environmental-reports"
          style={{
            margin: '24px 0',
            padding: '20px',
            background: '#121d2c',
            border: '1px solid #263346',
            borderRadius: '16px',
            color: '#edf4fa',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: '#65d7bb', fontSize: '11px', letterSpacing: '1.5px', fontWeight: 700 }}>PUBLIC ENVIRONMENTAL COVERAGE</div>
              <h2 style={{ margin: '8px 0' }}>Environmental reports</h2>
              <p style={{ color: '#a9b8c9', margin: 0 }}>
                News and public reporting related to <strong>{reportsRegion}</strong>, emissions, and air pollution.
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadEnvironmentalReports(reportsRegion)}
              disabled={reportsLoading}
              style={{ padding: '9px 12px', borderRadius: '8px', border: '1px solid #263346', background: 'transparent', color: '#edf4fa', cursor: reportsLoading ? 'wait' : 'pointer' }}
            >
              {reportsLoading ? 'Loading…' : 'Refresh reports'}
            </button>
          </div>

          {reportsLoading && <p style={{ color: '#a9b8c9', marginTop: '18px' }}>Fetching public environmental reports…</p>}
          {reportsError && (
            <div role="alert" style={{ marginTop: '16px', padding: '12px', borderRadius: '8px', background: '#3a2028', color: '#ffd9df' }}>
              {reportsError}
            </div>
          )}
          {!reportsLoading && !reportsError && environmentReports.length === 0 && (
            <p style={{ color: '#a9b8c9', marginTop: '18px' }}>No matching reports were returned for this region. Try refreshing later.</p>
          )}
          {environmentReports.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginTop: '18px' }}>
              {environmentReports.map((report, index) => (
                <article key={`${report.url || report.title}-${index}`} style={{ padding: '15px', borderRadius: '12px', border: '1px solid #263346', background: '#172538', minWidth: 0 }}>
                  <div style={{ color: '#65d7bb', fontSize: '12px', fontWeight: 700 }}>{report.source || 'Public news report'}</div>
                  <h3 style={{ fontSize: '15px', lineHeight: 1.45, margin: '8px 0' }}>{report.title}</h3>
                  <p style={{ color: '#a9b8c9', fontSize: '12px', margin: '0 0 12px' }}>
                    {report.published_at ? new Date(report.published_at).toLocaleDateString() : 'Publication date unavailable'}
                  </p>
                  {report.url && (
                    <a href={report.url} target="_blank" rel="noreferrer" style={{ color: '#65d7bb', fontSize: '13px', fontWeight: 700 }}>
                      Read original article ↗
                    </a>
                  )}
                </article>
              ))}
            </div>
          )}
          <p style={{ color: '#a9b8c9', fontSize: '12px', lineHeight: 1.5, margin: '16px 0 0' }}>
            Note: These are public news reports, not official proof of a legal violation. Verify compliance claims with CPCB, the relevant State Pollution Control Board, or court records.
          </p>
        </section>


      </main>
    </div>
  )
}

export default App
