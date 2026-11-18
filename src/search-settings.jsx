import React, { useEffect, useState } from 'react';
import { defaultNeighborhoods, searchNeighborhoods } from './search-criteria.js';

export function SearchSettings({ store }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    store.getSearch().then(saved => {
      if (mounted) setSettings({
        ...saved,
        neighborhoods: saved.neighborhoods.length ? saved.neighborhoods : defaultNeighborhoods,
      });
    }).catch(() => {
      if (mounted) setMessage('Couldn’t load search preferences. Close Suggestions and try again.');
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [store]);

  async function save(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const enabled = fields.has('enabled');
    const neighborhoods = fields.getAll('neighborhoods');
    const rent = fields.get('max_rent');
    if (enabled && (!rent || !neighborhoods.length)) {
      setMessage('Set a maximum rent and select at least one neighborhood to turn on suggestions.');
      return;
    }
    setMessage('');
    setSaving(true);
    try {
      const updated = await store.saveSearch({
        enabled,
        neighborhoods,
        max_rent: rent ? Number(rent) : null,
        min_bedrooms: Number(fields.get('min_bedrooms')),
      });
      setSettings(updated);
      setMessage(updated.enabled ? 'Daily search preferences saved.' : 'Daily search is paused.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  return <details className="search-settings">
    <summary>Daily search preferences</summary>
    {loading && <p role="status">Loading preferences…</p>}
    {settings && <form onSubmit={save}>
      <fieldset disabled={saving} className="listing-fields">
        <label className="check-label span-two">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} /> Send daily matches to Suggestions
        </label>
        <label>
          Max monthly rent
          <input name="max_rent" type="number" min="1" max="1000000" step="1" placeholder="USD"
            defaultValue={settings.max_rent ?? ''} />
        </label>
        <label>
          Minimum bedrooms
          <input name="min_bedrooms" type="number" min="0" max="30" step="1" required
            defaultValue={settings.min_bedrooms} />
        </label>
        <fieldset className="neighborhood-choices span-two">
          <legend>Neighborhoods</legend>
          {searchNeighborhoods.map(name => (
            <label key={name} className="check-label">
              <input type="checkbox" name="neighborhoods" value={name} defaultChecked={settings.neighborhoods.includes(name)} />
              {name}
            </label>
          ))}
        </fieldset>
        <div className="span-two"><button className="button secondary" disabled={saving}>Save preferences</button></div>
      </fieldset>
    </form>}
    {message && <p className="search-feedback" role="status">{message}</p>}
  </details>;
}
