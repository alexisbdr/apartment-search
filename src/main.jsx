import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Building2, LayoutGrid, LockKeyhole, Map, Monitor } from 'lucide-react';
import { Board } from './board.jsx';
import { boardBackend } from './storage.js';
import './styles.css';

const backend = boardBackend(import.meta.env);
const mapPath = import.meta.env.BASE_URL + 'commute-map.html';

function SignIn({ client }) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  async function submit(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setFeedback('');
    try {
      const { error } = await client.auth.signInWithPassword({
        email: String(fields.get('email')).trim(),
        password: String(fields.get('password')),
      });
      if (error) setFeedback('Sign-in failed. Check your email and password and try again.');
    } catch {
      setFeedback('Sign-in is unavailable. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <span className="gate-icon"><LockKeyhole size={21} aria-hidden="true" /></span>
      <h1>Sign in to the listing board</h1>
      <form onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        {feedback && <p className="error-text" role="alert">{feedback}</p>}
        <button className="button primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function SharedBoard({ client, store }) {
  const [session, setSession] = useState(undefined);
  const [access, setAccess] = useState(null);
  const [signOutError, setSignOutError] = useState('');
  const memberId = session?.user.id;

  useEffect(() => {
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, current) => setSession(current));
    return () => subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    if (!memberId) return;
    let active = true;

    async function checkMembership() {
      try {
        const { data, error } = await client.from('board_members').select('user_id').eq('user_id', memberId).maybeSingle();
        if (active) setAccess({ memberId, allowed: !!data, failed: !!error });
      } catch {
        if (active) setAccess({ memberId, allowed: false, failed: true });
      }
    }

    checkMembership();
    return () => { active = false; };
  }, [client, memberId]);

  async function signOut() {
    setSignOutError('');
    try {
      const { error } = await client.auth.signOut();
      if (error) setSignOutError('Sign-out failed. Try again.');
      else {
        setSession(null);
        setAccess(null);
      }
    } catch {
      setSignOutError('Sign-out failed. Check your connection and try again.');
    }
  }

  if (session === undefined) return <p className="notice" role="status">Checking your session…</p>;
  if (session === null) return <SignIn client={client} />;
  if (access?.memberId !== memberId) return <p className="notice" role="status">Checking board access…</p>;
  if (!access.allowed) return (
    <div className="gate">
      <h1>{access.failed ? 'Board access is unavailable' : 'This account hasn’t been added to the board'}</h1>
      {signOutError && <p className="error-text" role="alert">{signOutError}</p>}
      <button className="button secondary" type="button" onClick={signOut}>Sign out</button>
    </div>
  );

  return <>
    {signOutError && <p className="notice error-text" role="alert">{signOutError}</p>}
    <Board key={memberId} store={store} mode="shared" onSignOut={signOut} />
  </>;
}

function CommuteMap() {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Commute map</h1>
          <p>Compare reported street incidents and subway options to Penn Station.</p>
        </div>
        <a className="button secondary" href={mapPath} target="_blank" rel="noopener noreferrer">
          Open full map <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>
      <iframe className="commute-map" src={mapPath} title="Brooklyn safety and the Penn Station commute" />
    </>
  );
}

function currentView() {
  return window.location.hash === '#map' ? 'map' : 'board';
}

function App() {
  const [view, setView] = useState(currentView);

  useEffect(() => {
    const onChange = () => setView(currentView());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return (
    <>
      <header className="site-header">
        <div className="header-content">
          <a href="#board" className="wordmark">
            <span className="wordmark-icon"><Building2 size={20} aria-hidden="true" /></span>
            Brooklyn apartment search
          </a>
          <nav aria-label="Main navigation">
            <a href="#board" aria-current={view === 'board' ? 'page' : undefined}>
              <LayoutGrid size={16} aria-hidden="true" /> Listings
            </a>
            <a href="#map" aria-current={view === 'map' ? 'page' : undefined}>
              <Map size={16} aria-hidden="true" /> Commute map
            </a>
          </nav>
          {view === 'board' && backend.mode !== 'unavailable' && (
            <span className="storage-label">
              {backend.mode === 'shared' ? <LockKeyhole size={15} aria-hidden="true" /> : <Monitor size={15} aria-hidden="true" />}
              {backend.mode === 'shared' ? 'Private shared board' : 'Saved on this device'}
            </span>
          )}
        </div>
      </header>
      <main className="app-content">
        {view === 'map' ? <CommuteMap />
          : backend.mode === 'shared' ? <SharedBoard client={backend.client} store={backend.store} />
          : backend.mode === 'local' ? <Board store={backend.store} mode="local" />
          : <div className="notice" role="alert">{backend.message}</div>}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
