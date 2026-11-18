(() => {
  const currency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  function sourceUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['streeteasy.com', 'www.zillow.com'].includes(url.hostname)
        ? url.href : null;
    } catch {
      return null;
    }
  }

  function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text) item.textContent = text;
    return item;
  }

  window.createBrooklynListingLayer = function createListingLayer({ frame, project, screen, inBounds, focus, fit, redraw }) {
    const markers = element('div', 'listing-map-markers');
    const popup = element('section', 'listing-map-popup');
    popup.hidden = true;
    popup.setAttribute('aria-label', 'Listing details');
    frame.append(markers, popup);

    let groups = new Map();
    let selected = null;
    let previousFocus = null;

    function close(restoreFocus = false) {
      const anchor = groups.get(selected?.key)?.button;
      selected = null;
      popup.hidden = true;
      popup.replaceChildren();
      if (restoreFocus) anchor?.focus();
    }

    function show(group, listingId) {
      const listing = group.items.find(item => item.id === listingId) ?? group.items[0];
      selected = { key: group.key, id: listing.id };
      const title = element('strong', 'listing-popup-title', listing.title);
      const dismiss = element('button', 'listing-popup-close cursor-interaction', '×');
      dismiss.type = 'button';
      dismiss.setAttribute('aria-label', 'Close listing details');
      dismiss.addEventListener('click', () => close(true));
      const heading = element('div', 'listing-popup-heading');
      heading.append(title, dismiss);
      popup.replaceChildren(heading);

      if (group.items.length > 1) {
        const units = element('select', 'form-select');
        units.setAttribute('aria-label', 'Listing at this address');
        for (const item of group.items) {
          const option = element('option', '', item.title);
          option.value = item.id;
          units.append(option);
        }
        units.value = listing.id;
        units.addEventListener('change', () => {
          show(group, units.value);
          popup.querySelector('select')?.focus();
        });
        popup.append(units);
      }

      if (listing.photo) {
        const image = element('img', 'listing-popup-photo');
        image.alt = 'Main photo from the listing';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => {
          image.remove();
          redraw();
        }, { once: true });
        image.src = listing.photo;
        popup.append(image);
      }

      if (listing.address && listing.address !== listing.title) {
        popup.append(element('div', 'text-small text-muted', listing.address));
      }

      const details = [
        Number.isFinite(listing.rent) ? currency.format(listing.rent) + '/mo' : '',
        listing.status,
      ].filter(Boolean).join(' · ');
      if (details) popup.append(element('div', 'text-small', details));
      const url = sourceUrl(listing.url);
      if (url) {
        const link = element('a', 'text-small', 'Open listing ↗');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        popup.append(link);
      }

      popup.hidden = false;
      redraw();
    }

    function showListings() {
      if (groups.size) fit([...groups.values()].map(group => group.point));
    }

    function update(pins, focusListingId) {
      const firstPins = groups.size === 0;
      const next = new Map();
      for (const item of pins) {
        if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' ||
            !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) continue;
        const point = project([item.longitude, item.latitude]);
        if (!inBounds(...point)) continue;
        const key = item.longitude.toFixed(5) + ',' + item.latitude.toFixed(5);
        if (!next.has(key)) next.set(key, { key, point, items: [] });
        next.get(key).items.push(item);
      }

      const fragment = document.createDocumentFragment();
      for (const group of next.values()) {
        const title = group.items.length === 1 ? group.items[0].title : group.items.length + ' listings at this address';
        const button = element('button', 'listing-map-pin cursor-interaction', group.items.length > 1 ? String(group.items.length) : '●');
        button.type = 'button';
        button.setAttribute('aria-label', 'Show ' + title);
        button.addEventListener('click', () => show(group));
        group.button = button;
        fragment.append(button);
      }
      groups = next;
      markers.replaceChildren(fragment);

      const requested = focusListingId && focusListingId !== previousFocus &&
        [...groups.values()].find(group => group.items.some(item => item.id === focusListingId));

      if (requested) {
        previousFocus = focusListingId;
        focus(...requested.point);
        show(requested, focusListingId);
      } else if (selected && groups.get(selected.key)?.items.some(item => item.id === selected.id)) {
        show(groups.get(selected.key), selected.id);
      } else {
        close();
      }

      if (!focusListingId) previousFocus = null;
      if (firstPins && !requested && !focusListingId) showListings();
      redraw();
    }

    function render(width, height) {
      for (const group of groups.values()) {
        const [x, y] = screen(...group.point);
        group.button.hidden = x < 12 || x > width - 12 || y < 12 || y > height - 12;
        group.button.style.left = x + 'px';
        group.button.style.top = y + 'px';
        group.button.setAttribute('aria-expanded', String(group.key === selected?.key));
      }

      const active = groups.get(selected?.key);
      if (!active || active.button.hidden) {
        popup.hidden = true;
        return;
      }

      const [x, y] = screen(...active.point);
      popup.hidden = false;
      const gap = 8;
      const left = Math.max(gap, Math.min(width - popup.offsetWidth - gap, x - popup.offsetWidth / 2));
      const above = y - popup.offsetHeight - 20;
      const top = above > gap ? above : Math.min(height - popup.offsetHeight - gap, y + 20);
      popup.style.left = left + 'px';
      popup.style.top = Math.max(gap, top) + 'px';
    }

    window.addEventListener('message', event => {
      if (window.parent === window || event.source !== window.parent || event.origin !== window.location.origin) return;
      if (event.data?.type === 'brooklyn-listings:sync' && Array.isArray(event.data.pins)) {
        update(event.data.pins, event.data.focusListingId);
      } else if (event.data?.type === 'brooklyn-listings:fit') {
        showListings();
      }
    });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && selected && !popup.hidden) close(true);
    });

    return { render, close };
  };
})();
