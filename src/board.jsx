import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, ClipboardCheck, Footprints, MapPin, MessageSquare, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { activeListing, listingDraft, listingLink, listingTitle, providers, stages, statuses } from './listings.js';
import { addressFromLink, isMapped, listingLocation } from './locations.js';
import { SearchSettings } from './search-settings.jsx';

const icons = { interested: Bookmark, contacted: MessageSquare, visited: Footprints, applications: ClipboardCheck };
const emptyCopy = {
  interested: 'New listings go here.',
  contacted: 'Move a listing here after you reach out.',
  visited: 'Move a listing here after a tour.',
  applications: 'Mark an application as Applied or Denied.',
};
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function readableLink(listing) {
  try {
    return listingLink(listing.url).url;
  } catch {
    return null;
  }
}

function ListingCard({ listing, canEdit, onEdit, onMove, actions }) {
  const title = listingTitle(listing);
  const link = readableLink(listing);
  const facts = [
    listing.neighborhood,
    listing.bedrooms === 0 ? 'Studio' : listing.bedrooms != null ? listing.bedrooms + ' bed' : '',
    listing.bathrooms != null ? listing.bathrooms + ' bath' : '',
    listing.square_feet != null ? listing.square_feet.toLocaleString('en-US') + ' sq ft' : '',
  ].filter(Boolean).join(' · ');

  return (
    <article className="listing-card">
      <div className="listing-meta">
        <span className="source-tag">{providers[listing.source]}</span>
        {onEdit && <button type="button" className="icon-button" onClick={() => onEdit(listing)} disabled={!canEdit}
          aria-label={'Edit ' + title} title="Edit listing">
          <Pencil size={16} aria-hidden="true" />
        </button>}
      </div>
      <h3>{link ? <a href={link} target="_blank" rel="noopener noreferrer">{title}<ArrowUpRight size={15} aria-hidden="true" /></a> : title}</h3>
      {listing.street_address && listing.street_address !== title && <p className="listing-location">{listing.street_address}</p>}
      {facts && <p className="listing-location">{facts}</p>}
      {listing.monthly_rent != null && (
        <p className="listing-rent">{dollars.format(listing.monthly_rent)} <span>/mo</span></p>
      )}
      {listing.notes && <p className="listing-notes">{listing.notes}</p>}
      {onMove && (isMapped(listing) ? (
        <a className="pin-link" href={'#map/' + listing.id}><MapPin size={15} aria-hidden="true" /> View on map</a>
      ) : <p className="pin-missing">{listing.street_address
        ? (Number.isFinite(listing.latitude) ? 'Outside commute map coverage' : 'Edit the street address to retry the pin')
        : 'Add a street address to place a pin'}</p>)}
      {onMove && <div className="status-control">
        <select aria-label={'Status for ' + title} value={listing.status}
          onChange={event => onMove(listing, event.target.value)} disabled={!canEdit}>
          {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>}
      {actions && <div className="card-actions">{actions}</div>}
    </article>
  );
}

const fillFields = [
  'title', 'street_address', 'neighborhood', 'monthly_rent', 'bedrooms', 'bathrooms', 'square_feet', 'notes', 'image_url',
];

function ListingDialog({ listing, pending, lookup, onClose, onSave, onRemove }) {
  const modal = useRef(null);
  const form = useRef(null);
  const originalLink = useRef(listing?.url ?? '');
  const filled = useRef({});
  const edited = useRef(new Set());
  const [url, setUrl] = useState(originalLink.current);
  const [lookupRevision, setLookupRevision] = useState(0);
  const [lookupState, setLookupState] = useState({ busy: false, message: '' });
  const [feedback, setFeedback] = useState('');
  const canonicalUrl = readableLink({ url });

  useEffect(() => {
    const dialog = modal.current;
    dialog.showModal();
    dialog.querySelector('[name="url"]').focus();
  }, []);

  useEffect(() => {
    if (!lookup || !canonicalUrl || (!lookupRevision && canonicalUrl === originalLink.current)) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const timer = setTimeout(async () => {
      setLookupState({ busy: true, message: 'Looking up listing details…' });
      try {
        const details = await lookup(canonicalUrl, signal);
        if (signal.aborted) return;
        let populated = false;
        for (const name of fillFields) {
          const input = form.current.elements.namedItem(name);
          if (details[name] == null || details[name] === '' || input.value || edited.current.has(name)) continue;
          input.value = details[name];
          filled.current[name] = input.value;
          populated = true;
        }
        const found = fillFields.some(name => details[name] != null && details[name] !== '');
        setLookupState({ busy: false, message: populated ? 'Details filled from the listing. Review them before saving.'
          : found ? 'The form already has the available details.' : 'Couldn’t verify details for this link. You can enter them by hand.' });
      } catch (error) {
        if (!signal.aborted) setLookupState({ busy: false, message: error.message });
      }
    }, 650);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [canonicalUrl, lookup, lookupRevision]);

  function changeUrl(event) {
    const next = event.target.value;
    if (readableLink({ url: next }) !== canonicalUrl) {
      for (const [key, value] of Object.entries(filled.current)) {
        const input = form.current.elements.namedItem(key);
        if (input.value === value && !edited.current.has(key)) input.value = '';
      }
      const photo = form.current.elements.namedItem('image_url');
      if (next !== originalLink.current && !edited.current.has('image_url')) photo.value = '';
      filled.current = {};
      setLookupState({ busy: false, message: '' });
    }
    setUrl(next);
  }

  async function submit(event) {
    event.preventDefault();
    setFeedback('');
    const fields = new FormData(event.currentTarget);
    try {
      await onSave(listing, listingDraft(fields));
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function remove() {
    setFeedback('');
    try {
      await onRemove(listing);
    } catch (error) {
      setFeedback(error.message);
    }
  }

  return (
    <dialog ref={modal} className="listing-dialog" aria-labelledby="listing-dialog-title" onCancel={event => {
      event.preventDefault();
      if (!pending) onClose();
    }}>
      <form ref={form} onSubmit={submit} onChange={event => {
        if (fillFields.includes(event.target.name)) edited.current.add(event.target.name);
      }}>
        <div className="dialog-heading">
          <h2 id="listing-dialog-title">{listing ? 'Edit listing' : 'Add a listing'}</h2>
          <button className="icon-button" type="button" aria-label="Close listing form" onClick={onClose} disabled={pending}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <fieldset className="listing-fields" disabled={pending}>
          <label className="span-two">
            Listing link
            <input name="url" type="text" inputMode="url" placeholder="Paste a listing link"
              maxLength={2048} value={url} onChange={changeUrl} required />
          </label>
          {lookup && <div className="span-two lookup-status">
            <button className="text-button" type="button" disabled={!canonicalUrl || lookupState.busy}
              onClick={() => setLookupRevision(value => value + 1)}>Look up details</button>
            <p role="status">{lookupState.message || 'Listing details are looked up when you paste a link.'}</p>
          </div>}
          <label className="span-two">
            Listing name <span className="optional">Optional</span>
            <input name="title" maxLength={160} defaultValue={listing?.title} placeholder="e.g. Fulton St, Apt 3B" />
          </label>
          <label className="span-two">
            Brooklyn street address
            <input name="street_address" maxLength={200} defaultValue={listing?.street_address}
              placeholder="e.g. 200 Lafayette Ave" />
            <span className="optional">The app looks up the address with NYC Planning when you save.</span>
          </label>
          <label className="span-two">
            Neighborhood
            <input name="neighborhood" maxLength={100} defaultValue={listing?.neighborhood} placeholder="e.g. Clinton Hill" />
          </label>
          <label>
            Monthly rent
            <input name="monthly_rent" type="number" min="0" max="1000000" step="1"
              defaultValue={listing?.monthly_rent ?? ''} placeholder="USD" />
          </label>
          <label>
            Bedrooms
            <input name="bedrooms" type="number" min="0" max="30" step="1"
              defaultValue={listing?.bedrooms ?? ''} placeholder="0 for studio" />
          </label>
          <label>
            Bathrooms
            <input name="bathrooms" type="number" min="0" max="30" step="0.5" defaultValue={listing?.bathrooms ?? ''} />
          </label>
          <label>
            Square feet
            <input name="square_feet" type="number" min="0" max="100000" step="1" defaultValue={listing?.square_feet ?? ''} />
          </label>
          <label className="span-two">
            Map photo URL <span className="optional">Optional</span>
            <input name="image_url" type="url" maxLength={2048} defaultValue={listing?.image_url}
              placeholder="Direct StreetEasy or Zillow photo URL" />
          </label>
          <label className="span-two">
            Notes
            <textarea name="notes" rows="3" maxLength={4000} defaultValue={listing?.notes}
              placeholder="Viewing times, commute, follow-ups…" />
          </label>
        </fieldset>
        {feedback && <p className="error-text" role="alert">{feedback}</p>}
        <div className="dialog-actions">
          {listing && <button className="text-button danger-text" type="button" onClick={remove} disabled={pending}>
            <Trash2 size={15} aria-hidden="true" /> Move to trash
          </button>}
          <div>
            <button className="button secondary" type="button" onClick={onClose} disabled={pending}>Cancel</button>
            <button className="button primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save listing'}</button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

function ListingDrawer({ view, rows, disabled, store, onClose, onUpdate }) {
  const modal = useRef(null);
  const [feedback, setFeedback] = useState('');
  const isTrash = view === 'trash';
  useEffect(() => { modal.current.showModal(); }, []);

  async function update(listing, action) {
    setFeedback('');
    try {
      await onUpdate(listing, action);
    } catch (error) {
      setFeedback(error.message);
    }
  }

  return <dialog ref={modal} className="listing-dialog listing-drawer" aria-labelledby="drawer-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading">
      <h2 id="drawer-title">{isTrash ? 'Trash' : 'Suggestions'}</h2>
      <button className="icon-button" type="button" aria-label={isTrash ? 'Close trash' : 'Close suggestions'} onClick={onClose}>
        <X size={20} aria-hidden="true" />
      </button>
    </div>
    {!isTrash && <SearchSettings store={store} />}
    {feedback && <p className="error-text" role="alert">{feedback}</p>}
    {rows.length ? <div className="lane-list">
      {rows.map(listing => (
        <ListingCard key={listing.id} listing={listing} actions={isTrash
          ? <button className="button secondary" type="button" disabled={disabled}
              onClick={() => update(listing, 'restore')}>Restore</button>
          : <>
            <button className="button primary" type="button" disabled={disabled}
              onClick={() => update(listing, 'accept')}>Save to Interested</button>
            <button className="button secondary" type="button" disabled={disabled}
              onClick={() => update(listing, 'trash')}>Dismiss</button>
          </>} />
      ))}
    </div> : <p className="lane-empty">{isTrash ? 'The bin is empty.' : 'New matches will appear here.'}</p>}
  </dialog>;
}

export function Board({ board, onSignOut, lookup }) {
  const { listings, loaded, loadError, pending, refresh, mutate, store } = board;
  const [actionError, setActionError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const trash = listings.filter(listing => listing.trashed_at)
    .sort((a, b) => Date.parse(b.trashed_at) - Date.parse(a.trashed_at));
  const suggestions = listings.filter(listing => !listing.trashed_at && listing.status === 'suggested');
  const canEdit = !pending && !loadError;

  async function save(listing, draft) {
    setActionError('');
    await mutate(async () => {
      const address = draft.street_address || (!listing ? addressFromLink(draft.url) : '');
      const location = await listingLocation(address, listing);
      const record = { ...draft, street_address: address, ...location };
      return listing ? store.update(listing, record) : store.add(record);
    }, (rows, saved) => listing ? rows.map(row => row.id === saved.id ? saved : row) : [saved, ...rows]);
    setDialog(null);
  }

  async function remove(listing) {
    setActionError('');
    await updateListing(listing, 'trash');
    setDialog(null);
  }

  async function updateListing(listing, action) {
    await mutate(async () => {
      if (action === 'trash') return store.update(listing, { trashed_at: new Date().toISOString() });
      if (action === 'restore') return store.update(listing, { trashed_at: null });
      const address = listing.street_address || addressFromLink(listing.url);
      const location = await listingLocation(address, listing);
      return store.update(listing, { status: 'interested', street_address: address, ...location });
    }, (rows, updated) => rows.map(row => row.id === updated.id ? updated : row));
  }

  async function move(listing, status) {
    setActionError('');
    try {
      await mutate(
        () => store.update(listing, { status }),
        (rows, updated) => rows.map(row => row.id === updated.id ? updated : row),
      );
    } catch (error) {
      setActionError(error.message);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Listing board</h1>
          <p>Save apartments from StreetEasy or Zillow and track where each one stands.</p>
        </div>
        <div className="page-actions">
          {onSignOut && <button className="button secondary" type="button" onClick={onSignOut}>Sign out</button>}
          {store.getSearch && <button className="button secondary" type="button" disabled={!loaded}
            onClick={() => setDrawer('suggestions')}>
            <Sparkles size={17} aria-hidden="true" /> Suggestions
            {!!suggestions.length && <span className="action-count">{suggestions.length}</span>}
          </button>}
          <button className="button primary" type="button" disabled={!loaded || !!loadError || pending}
            onClick={() => setDialog({ listing: null })}>
            <Plus size={18} aria-hidden="true" /> Add listing
          </button>
        </div>
      </div>
      {loadError && <div className="notice" role="alert">
        <p>{loadError}</p>
        <button className="button secondary" type="button" onClick={refresh}>Try again</button>
      </div>}
      {actionError && <p className="notice error-text" role="alert">{actionError}</p>}
      {!loaded && !loadError && <p className="notice" role="status">Loading listings…</p>}
      {loaded && (
        <div className="board">
          {stages.map(stage => {
            const Icon = icons[stage.key];
            const items = listings.filter(listing => activeListing(listing) && stage.statuses.includes(listing.status));
            return (
              <section key={stage.key} className="lane" data-stage={stage.key} aria-label={stage.label}>
                <div className="lane-heading">
                  <span className="lane-icon"><Icon size={17} aria-hidden="true" /></span>
                  <h2>{stage.label}</h2>
                  <span className="lane-count" aria-label={items.length + ' listings'}>{items.length}</span>
                </div>
                {items.length ? <div className="lane-list">
                  {items.map(listing => (
                    <ListingCard key={listing.id} listing={listing} canEdit={canEdit}
                      onEdit={listing => setDialog({ listing })} onMove={move} />
                  ))}
                </div> : <p className="lane-empty">{emptyCopy[stage.key]}</p>}
              </section>
            );
          })}
        </div>
      )}
      {loaded && <button className="button secondary trash-button" type="button" onClick={() => setDrawer('trash')}>
        <Trash2 size={18} aria-hidden="true" /> Trash
        {!!trash.length && <span className="action-count">{trash.length}</span>}
      </button>}
      {drawer && <ListingDrawer view={drawer} rows={drawer === 'trash' ? trash : suggestions} store={store}
        disabled={!canEdit} onClose={() => setDrawer(null)} onUpdate={updateListing} />}
      {dialog && <ListingDialog listing={dialog.listing} pending={pending} lookup={lookup} onClose={() => setDialog(null)}
        onSave={save} onRemove={remove} />}
    </>
  );
}
