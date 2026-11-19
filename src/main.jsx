import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Building2, LayoutGrid, LockKeyhole, Map, Monitor } from 'lucide-react';
import { Board } from './board.jsx';
import { boardBackend } from './storage.js';
import { activeListing, listingLink, listingPhoto, listingTitle, statuses } from './listings.js';
import { isMapped } from './locations.js';
import { useBoard } from './use-board.js';
import './styles.css';

const backend = boardBackend(import.meta.env);
const mapPath = import.meta.env.BASE_URL + 'commute-map.html';

async function fetchListingDetails(client, url, signal) {
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error('Sign in again to look up listing details.');

  let response;
  let result;
  try {
    response = await fetch('/api/lookup-listing', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
      signal,
    });
    result = await response.json();
  } catch {
    throw new Error('Automatic lookup is unavailable. You can enter the details by hand.');
  }
  if (!response.ok) throw new Error(result.error);
  return result;
}

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

function SharedBoard({ client, store, route }) {
  const [session, setSession] = useState(undefined);
  const [access, setAccess] = useState(null);
  const [signOutError, setSignOutError] = useState('');
  const memberId = session?.user.id;
  const lookup = useCallback((url, signal) => fetchListingDetails(client, url, signal), [client]);
  const fallbackLocation = useCallback(async address => {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return null;
    const response = await fetch('/api/geocode-address', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
      signal: AbortSignal.timeout(12000),
    });
    return response.ok ? response.json() : null;
  }, [client]);

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

  if (route.view === 'map' && (!memberId || access?.memberId !== memberId || !access.allowed)) {
    return <CommuteMap signInRequired />;
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
    <Workspace key={memberId} store={store} route={route} onSignOut={signOut} lookup={lookup}
      fallbackLocation={fallbackLocation} />
  </>;
}

const emptyListings = [];
const statusLabels = Object.fromEntries(statuses);
const isVisiblePin = listing => activeListing(listing) && isMapped(listing);

function CommuteMap({ listings = emptyListings, focusListingId, signInRequired }) {
  const iframe = useRef(null);
  const pins = listings.filter(isVisiblePin);

  const sync = useCallback(() => {
    const records = listings.filter(isVisiblePin).flatMap(listing => {
      try {
        return [{
          id: listing.id,
          title: listingTitle(listing),
          address: listing.street_address,
          url: listingLink(listing.url).url,
          photo: listingPhoto(listing.image_url),
          rent: listing.monthly_rent,
          status: statusLabels[listing.status],
          latitude: listing.latitude,
          longitude: listing.longitude,
        }];
      } catch {
        return [];
      }
    });

    iframe.current?.contentWindow?.postMessage({
      type: 'brooklyn-listings:sync',
      pins: records,
      focusListingId,
    }, window.location.origin);
  }, [listings, focusListingId]);

  useEffect(() => sync(), [sync]);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Commute map</h1>
          <p>{signInRequired ? 'Sign in from Listings to see your pins.'
            : pins.length ? pins.length + (pins.length === 1 ? ' listing on the map. ' : ' listings on the map. ') + 'Select a pin for details.'
            : 'Save a Brooklyn street address on a listing to place its pin.'}</p>
        </div>
        {!!pins.length && <button className="button secondary" type="button" onClick={() => {
          iframe.current?.contentWindow?.postMessage({ type: 'brooklyn-listings:fit' }, window.location.origin);
        }}>Show listings</button>}
      </div>
      <iframe ref={iframe} className="commute-map" src={mapPath}
        title="Brooklyn safety, subway commutes and listing locations" onLoad={sync} />
    </>
  );
}

function Workspace({ store, route, onSignOut, lookup, fallbackLocation }) {
  const board = useBoard(store);
  return route.view === 'map'
    ? <CommuteMap listings={board.listings} focusListingId={route.listingId} />
    : <Board board={board} onSignOut={onSignOut} lookup={lookup} fallbackLocation={fallbackLocation} />;
}

function currentRoute() {
  const path = window.location.hash.slice(1);
  if (path === 'map' || path.startsWith('map/')) {
    return { view: 'map', listingId: path.slice(4) || null };
  }
  return { view: 'board', listingId: null };
}

function App() {
  const [route, setRoute] = useState(currentRoute);
  const { view } = route;

  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
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
        {backend.mode === 'shared' ? <SharedBoard client={backend.client} store={backend.store} route={route} />
          : backend.mode === 'local' ? <Workspace store={backend.store} route={route} />
          : view === 'map' ? <CommuteMap />
          : <div className="notice" role="alert">{backend.message}</div>}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
