import React, { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Check, Circle, Code2, Database, ExternalLink, LoaderCircle, LogOut, ShieldCheck, UtensilsCrossed } from 'lucide-react';
import { api, ApiError, setCsrf, type User } from './api';
import './styles.css';

const modules = [
  ['01', 'Meals & bookings', 'Dated menus, headcounts, booking cutoffs and limited extras.'],
  ['02', 'Attendance', 'Expiring meal passes with single-use redemption.'],
  ['03', 'Leave & billing', 'Leave approvals, itemised invoices and fake payment flows.'],
  ['04', 'Kitchen operations', 'Stock ledgers, suppliers, procurement and food waste.'],
  ['05', 'Student support', 'Private complaints, meal feedback and mess notices.'],
  ['06', 'Administration', 'Role permissions, policy settings and audit history.']
];
function App() {
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [endpointCount, setEndpointCount] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch('/api/health').then(response => { if (!response.ok) throw new Error(); return response.json(); }).then(() => setHealth('online')).catch(() => setHealth('offline'));
    fetch('/api/openapi.json').then(response => response.json()).then(spec => setEndpointCount(Object.values(spec.paths).reduce((count: number, methods) => count + Object.keys(methods as object).length, 0))).catch(() => {});
    api<{ user: User; csrfToken: string }>('/auth/me').then(result => { setUser(result.user); setCsrf(result.csrfToken); }).catch(err => { if (!(err instanceof ApiError && err.code === 'UNAUTHENTICATED')) setError('The API is unavailable. Check that npm run dev is running.'); });
  }, []);
  useEffect(() => {
    if (!user || user.must_change_password) { setDashboard(null); return; }
    api<Record<string, unknown>>('/dashboard').then(setDashboard).catch(err => setError(err.message));
  }, [user]);
  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<{ user: User; csrfToken: string }>('/auth/login', 'POST', { email, password });
      setCsrf(result.csrfToken); setUser(result.user); setPassword('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in'); }
    finally { setBusy(false); }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/auth/password', 'POST', { currentPassword: password, newPassword });
      setUser(null); setCsrf(''); setPassword(''); setNewPassword(''); setMessage('Password changed. Sign in with your new password.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to change password'); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true); setError('');
    try { await api('/auth/logout', 'POST'); setUser(null); setCsrf(''); setDashboard(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign out'); }
    finally { setBusy(false); }
  }
  return <div className="app">
    <header className="topbar"><a className="brand" href="/"><span className="brand-symbol"><UtensilsCrossed size={21} /></span><span>IIIT Bhubaneswar<span className="brand-sub">MESS MANAGEMENT SYSTEM</span></span></a><span className="phase"><Code2 size={14} /> Backend development</span></header>
    <main>
      <div className="eyebrow">BUILT AROUND CAMPUS LIFE</div>
      <section className="intro"><div><h1>A better mess.<br /><span>From the ground up.</span></h1><p>The foundation for fewer queues, clearer bills and a kitchen that knows how many meals to prepare.</p></div><div className="status-card"><span className={`health ${health}`}><Circle size={8} fill="currentColor" />{health === 'online' ? 'API connected' : health === 'checking' ? 'Connecting to API' : 'API unavailable'}</span><div className="status-number">{endpointCount ?? '—'}<span>API endpoints</span></div><a href="/api/docs" target="_blank" rel="noreferrer">Explore the API <ExternalLink size={14} /></a></div></section>
      <div className="workspace"><section className="modules"><div className="section-heading"><h2>The backend foundation</h2><span>PHASE 01</span></div><div className="module-grid">{modules.map(([number, title, description]) => <article className="module" key={number}><span className="module-number">{number}</span><h3>{title}</h3><p>{description}</p><span className="module-label"><Check size={12} /> API implemented</span></article>)}</div><div className="phase-note"><Database size={18} /><p>This is the backend verification workspace. The complete student, kitchen and administration interfaces come in the next phase.</p></div></section>
      <aside className="access-panel"><ShieldCheck size={25} className="panel-icon" /><h2>{user ? `Hello, ${user.name.split(' ')[0]}.` : 'Test your account'}</h2><p>{user ? `${user.role.toLowerCase()} access · secure cookie session` : 'Sign in to verify authentication and your role’s live dashboard.'}</p>
      {error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
      {!user ? <form onSubmit={signIn}><label htmlFor="email">Institute email</label><input id="email" type="email" autoComplete="username" placeholder="you@iiit-bh.ac.in" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} /><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={128} /><button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <>Sign in <ArrowRight size={16} /></>}</button><div className="account-help">For demo accounts, run <code>npm run db:seed</code> on an empty development database. Credentials are in <code>README.md</code>.</div></form> : user.must_change_password ? <form onSubmit={changePassword}><div className="account-help">Set a new password before using your account. Use at least 12 characters with upper and lowercase letters and a number.</div><label htmlFor="current">Temporary password</label><input id="current" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={128} /><label htmlFor="new">New password</label><input id="new" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required minLength={12} maxLength={128} /><button disabled={busy}>Change password <ArrowRight size={16} /></button></form> : <div className="verified"><div className="verified-label"><Check size={15} /> Session verified</div>{dashboard ? <dl>{Object.entries(dashboard).filter(([key, value]) => !['role','date','billingMonth'].includes(key) && typeof value === 'number').map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1').replace('Paise', '(₹)').replace(/^./, char => char.toUpperCase())}</dt><dd>{key.endsWith('Paise') ? (Number(value) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : String(value)}</dd></div>)}</dl> : <p>Loading your dashboard…</p>}<div className="account-help">Live values from <code>/api/v1/dashboard</code></div></div>}
      {dashboard?.paymentsMode === 'FAKE' && <div className="account-help">Fake payments enabled. No real money is collected.</div>}
      {user && <button className="secondary" onClick={signOut} disabled={busy}><LogOut size={15} /> Sign out</button>}
      </aside></div>
    </main><footer><span>IIIT Bhubaneswar · Mess Management</span><span>Asia/Kolkata <span className="footer-dot">·</span> INR</span></footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
