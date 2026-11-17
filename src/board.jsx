import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, ClipboardCheck, MapPin, MessageSquare, Pencil, Plus, X } from 'lucide-react';
import { listingDraft, listingLink, listingTitle, providers, stages, statuses } from './listings.js';
import { addressFromLink, isMapped, listingLocation } from './locations.js';

const icons = { interested: Bookmark, contacted: MessageSquare, applications: ClipboardCheck };
const emptyCopy = {
  interested: 'New listings go here.',
  contacted: 'Move a listing here after you reach out.',
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

function ListingCard({ listing, canEdit, onEdit, onMove }) {
  const title = listingTitle(listing);
  const link = readableLink(listing);

  return (
    <article className="listing-card">
      <div className="listing-meta">
        <span className="source-tag">{providers[listing.source]}</span>
        <button type="button" className="icon-button" onClick={() => onEdit(listing)} disabled={!canEdit}
          aria-label={'Edit ' + title} title="Edit listing">
          <Pencil size={16} aria-hidden="true" />
        </button>
      </div>
      <h3>{link ? <a href={link} target="_blank" rel="noopener noreferrer">{title}<ArrowUpRight size={15} aria-hidden="true" /></a> : title}</h3>
      {listing.street_address && listing.street_address !== title && <p className="listing-location">{listing.street_address}</p>}
      {(listing.neighborhood || listing.bedrooms !== null) && (
        <p className="listing-location">
          {[
            listing.neighborhood,
            listing.bedrooms === 0 ? 'Studio' : listing.bedrooms !== null ? listing.bedrooms + ' bed' : '',
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      {listing.monthly_rent !== null && (
        <p className="listing-rent">{dollars.format(listing.monthly_rent)} <span>/mo</span></p>
      )}
      {listing.notes && <p className="listing-notes">{listing.notes}</p>}
      {isMapped(listing) ? (
        <a className="pin-link" href={'#map/' + listing.id}><MapPin size={15} aria-hidden="true" /> View on map</a>
      ) : <p className="pin-missing">{listing.street_address
        ? (Number.isFinite(listing.latitude) ? 'Outside commute map coverage' : 'Edit the street address to retry the pin')
        : 'Add a street address to place a pin'}</p>}
      <div className="status-control">
        <select aria-label={'Status for ' + title} value={listing.status}
          onChange={event => onMove(listing, event.target.value)} disabled={!canEdit}>
          {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
    </article>
  );
}

function ListingDialog({ listing, pending, onClose, onSave, onRemove }) {
  const modal = useRef(null);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const dialog = modal.current;
    dialog.showModal();
    dialog.querySelector('[name="url"]').focus();
  }, []);

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
    if (!window.confirm('Remove this listing from the board?')) return;
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
      <form onSubmit={submit}>
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
              maxLength={2048} defaultValue={listing?.url} required />
          </label>
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
          <label className="span-two">
            Notes
            <textarea name="notes" rows="3" maxLength={4000} defaultValue={listing?.notes}
              placeholder="Viewing times, commute, follow-ups…" />
          </label>
        </fieldset>
        {feedback && <p className="error-text" role="alert">{feedback}</p>}
        <div className="dialog-actions">
          {listing && <button className="text-button danger-text" type="button" onClick={remove} disabled={pending}>Remove listing</button>}
          <div>
            <button className="button secondary" type="button" onClick={onClose} disabled={pending}>Cancel</button>
            <button className="button primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save listing'}</button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

export function Board({ board, onSignOut }) {
  const { listings, loaded, loadError, pending, refresh, mutate, store } = board;
  const [actionError, setActionError] = useState('');
  const [dialog, setDialog] = useState(null);

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
    await mutate(() => store.remove(listing), rows => rows.filter(row => row.id !== listing.id));
    setDialog(null);
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
            const items = listings.filter(listing => stage.statuses.includes(listing.status));
            return (
              <section key={stage.key} className="lane" data-stage={stage.key} aria-label={stage.label}>
                <div className="lane-heading">
                  <span className="lane-icon"><Icon size={17} aria-hidden="true" /></span>
                  <h2>{stage.label}</h2>
                  <span className="lane-count" aria-label={items.length + ' listings'}>{items.length}</span>
                </div>
                {items.length ? <div className="lane-list">
                  {items.map(listing => (
                    <ListingCard key={listing.id} listing={listing} canEdit={!pending && !loadError}
                      onEdit={listing => setDialog({ listing })} onMove={move} />
                  ))}
                </div> : <p className="lane-empty">{emptyCopy[stage.key]}</p>}
              </section>
            );
          })}
        </div>
      )}
      {dialog && <ListingDialog listing={dialog.listing} pending={pending} onClose={() => setDialog(null)}
        onSave={save} onRemove={remove} />}
    </>
  );
}
