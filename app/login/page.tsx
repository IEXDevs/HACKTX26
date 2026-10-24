'use client';
import { useState } from 'react';
import { Layers, ArrowRight } from 'lucide-react';
export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <main className="login-page">
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await fetch('/v1/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          });
          if (r.ok) window.location.href = '/';
          else setError((await r.json()).error.message);
        }}
      >
        <span className="brand">
          <span className="brand-mark">
            <Layers />
          </span>
          relay
        </span>
        <h1>Welcome to your workspace.</h1>
        <p>Sign in to configure agents and control their actions.</p>
        <label>
          Workspace password
          <input
            autoFocus
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary">
          Enter workspace <ArrowRight size={15} />
        </button>
        <small>
          Local development uses loopback access. Production requires DASHBOARD_PASSWORD and
          SESSION_SECRET.
        </small>
      </form>
    </main>
  );
}
