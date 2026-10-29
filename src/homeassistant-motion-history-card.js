import { LitElement, html, css, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { PALETTE, validateConfig, historyPath, parseHistory, segmentsFor, relativeTime } from './model.js';
import { languageFor, textFor } from './localize.js';
import './editor.js';
export { validateConfig } from './model.js';
export class MotionHistoryCard extends LitElement {
  static properties = { hass: { attribute: false, hasChanged: () => true }, _states: { state: true, hasChanged: () => true }, _config: { state: true }, _snapshot: { state: true }, _status: { state: true }, _now: { state: true } };
  constructor() {
    super(); this._generation = 0; this._status = 'loading'; this._now = Date.now(); this._visible = true;
    this._visibility = () => { this._syncVisibility(); };
  }
  setConfig(config) {
    this._config = validateConfig(config);
    this._resetHistory();
    if (this.isConnected) this._schedule(0);
  }
  static getStubConfig(hass) {
    const sensors = Object.entries(hass?.states || {}).filter(([id, state]) => id.startsWith('binary_sensor.') && ['motion', 'occupancy', 'presence'].includes(state.attributes?.device_class));
    return { entities: sensors.slice(0, 3).map(([entity]) => ({ entity })), hours_to_show: 1, refresh_interval: 30 };
  }
  static async getConfigElement() {
    if (!customElements.get('ha-form')) {
      const helpers = await window.loadCardHelpers();
      await helpers.createCardElement({ type: 'entities', entities: [] }).constructor.getConfigElement();
    }
    return document.createElement('homeassistant-motion-history-card-editor');
  }
  connectedCallback() {
    super.connectedCallback();
    const contextToken = this._contextToken = Symbol();
    const request = new CustomEvent('context-request', { bubbles: true, composed: true, cancelable: true });
    request.context = 'states'; request.subscribe = true;
    request.callback = (states, unsubscribe) => {
      if (!this.isConnected || this._contextClosed || contextToken !== this._contextToken) { unsubscribe?.(); return; }
      if (this._unsubscribe && unsubscribe && this._unsubscribe !== unsubscribe) this._unsubscribe();
      this._states = states; this._unsubscribe = unsubscribe || this._unsubscribe;
    };
    this._contextClosed = false; this.dispatchEvent(request);
    document.addEventListener('visibilitychange', this._visibility);
    if (typeof IntersectionObserver !== 'undefined') {
      this._observer = new IntersectionObserver(entries => { this._visible = entries[0]?.isIntersecting !== false; this._syncVisibility(); });
      this._observer.observe(this);
    }
    this._syncVisibility();
  }
  disconnectedCallback() {
    this._contextClosed = true; this._unsubscribe?.(); this._unsubscribe = undefined; this._states = undefined;
    this._observer?.disconnect(); document.removeEventListener('visibilitychange', this._visibility);
    this._resetHistory(); super.disconnectedCallback();
  }
  _resetHistory() {
    this._generation++; this._inflight = false; this._cancelRequest?.(); this._cancelRequest = undefined; clearTimeout(this._timer);
    this._snapshot = undefined; this._status = 'loading';
  }
  _active() { return this.isConnected && this._visible && !document.hidden; }
  _syncVisibility() {
    this.toggleAttribute('paused', !this._active());
    clearTimeout(this._timer);
    if (this._active()) { this._now = Date.now(); this._schedule(0); }
  }
  updated(changed) {
    if (changed.has('hass')) {
      if (this._connection && this._connection !== this.hass?.connection) this._resetHistory();
      this._connection = this.hass?.connection;
      if (!this._snapshot && !this._inflight && this._status !== 'error') this._schedule(0);
    }
  }
  _schedule(delay) {
    clearTimeout(this._timer);
    if (this._active() && this.hass?.callApi && this._config) this._timer = setTimeout(() => this._fetchHistory(), delay);
  }
  async _fetchHistory() {
    if (!this._active() || !this.hass?.callApi || !this._config || this._inflight) return;
    this._inflight = true;
    const generation = this._generation;
    let requestTimer;
    const end = Date.now(), start = end - this._config.hours_to_show * 3600000;
    const ids = this._config.entities.map(row => row.entity);
    try {
      const response = await Promise.race([
        this.hass.callApi('GET', historyPath(ids, start, end)),
        new Promise((_, reject) => { this._cancelRequest = () => reject(new Error('History request cancelled')); requestTimer = setTimeout(() => reject(new Error('History request timeout')), 20000); }),
      ]);
      if (generation !== this._generation || !this.isConnected) return;
      this._snapshot = { start, end, records: parseHistory(response, ids) }; this._status = 'ready';
    } catch {
      if (generation === this._generation && this.isConnected) this._status = 'error';
    } finally {
      clearTimeout(requestTimer);
      if (generation === this._generation) {
        this._cancelRequest = undefined; this._inflight = false; this._now = Date.now();
        this._schedule(this._config.refresh_interval * 1000);
      }
    }
  }
  _moreInfo(entity) { this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: entity }, bubbles: true, composed: true })); }
  _time(value) {
    const locale = this.hass?.locale;
    return new Intl.DateTimeFormat(languageFor(this.hass), { hour: '2-digit', minute: '2-digit', ...(locale?.time_format === '12' ? { hour12: true } : locale?.time_format === '24' ? { hour12: false } : {}), timeZone: locale?.time_zone === 'local' ? undefined : this.hass?.config?.time_zone }).format(value);
  }
  getCardSize() { return Math.ceil(((this._config?.entities.length || 3) * 56 + 24) / 50); }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: 'auto' }; }
  render() {
    if (!this._config) return nothing;
    const t = textFor(this.hass), snapshot = this._snapshot;
    return html`<ha-card><div class="rows">
      ${this._config.entities.map(row => {
        const state = (this._states || this.hass?.states)?.[row.entity];
        const value = state?.state || 'unavailable', name = row.name || state?.attributes?.friendly_name || row.entity;
        const segments = snapshot ? segmentsFor(snapshot.records[row.entity], snapshot.start, snapshot.end) : [];
        const records = snapshot?.records[row.entity] || [];
        return html`<div class="row" style=${styleMap({ '--room-color': PALETTE[row.color] || row.color })}>
          <button class=${`sensor ${value === 'on' ? 'active' : ''}`} @click=${() => this._moreInfo(row.entity)} aria-label=${`${name}: ${t[value] || t.unknown}. ${t.changed}: ${relativeTime(state?.last_changed, this._now, languageFor(this.hass))}. ${t.details}`}>
            <span class="icon"><ha-icon .icon=${row.icon || state?.attributes?.icon || 'mdi:motion-sensor'}></ha-icon><span class="dot"></span></span>
            <span class="copy"><strong>${name}</strong><span class="since" title=${t.changed}>${!state || ['unavailable', 'unknown'].includes(value) ? (t[value] || t.unavailable) : relativeTime(state.last_changed, this._now, languageFor(this.hass))}</span></span>
          </button>
          <button class="timeline" @click=${() => this._moreInfo(row.entity)} aria-label=${`${name}: ${t.history}. ${t.details}`}>
            <span class="track" role="img" aria-label=${`${t.history}: ${records.length ? segments.map(part => `${this._time(part.start)}–${this._time(part.end)} ${t[part.state] || t.unknown}`).join('; ') : t.missing}`}>
              ${segments.map(part => html`<span class=${`segment ${part.state === 'on' ? 'on' : part.state === 'off' ? 'off' : 'unknown'}`} style=${styleMap({ left: `${100 * (part.start - snapshot.start) / (snapshot.end - snapshot.start)}%`, width: `${100 * (part.end - part.start) / (snapshot.end - snapshot.start)}%` })} title=${`${this._time(part.start)}–${this._time(part.end)} · ${t[part.state] || t.unknown}`}></span>`)}
              ${!snapshot || !records.length ? html`<span class="empty">${snapshot ? t.missing : this._status === 'error' ? t.error : t.loading}</span>` : nothing}
            </span>
          </button>
        </div>`;
      })}
      ${snapshot ? html`<div class="axis-row"><span></span><div class="axis"><span>${this._time(snapshot.start)}</span><span>${this._time((snapshot.start + snapshot.end) / 2)}</span><span>${this._status === 'error' ? this._time(snapshot.end) : t.now}</span></div></div>` : nothing}
      ${this._status === 'error' ? html`<div class="error" role="status">${snapshot ? t.stale : t.error}<button @click=${() => this._fetchHistory()}>${t.retry}</button></div>` : nothing}
    </div></ha-card>`;
  }
  static styles = css`
    :host{display:block;container-type:inline-size;color:var(--primary-text-color,#e8edf2);font-family:var(--ha-font-family-body,inherit);font-variant-numeric:tabular-nums}
    ha-card{display:block;padding:8px;margin:0;border-radius:var(--motion-history-radius,14px);background:var(--ha-card-background,var(--card-background-color,#1e232b));border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color,transparent);box-shadow:var(--ha-card-box-shadow,0 2px 5px #0000000d);overflow:hidden}
    .rows{display:grid;gap:4px}.row,.axis-row{display:grid;grid-template-columns:minmax(108px,1fr) minmax(0,2fr);gap:8px;align-items:center;min-width:0}
    .row{border-radius:10px;background:linear-gradient(90deg,color-mix(in srgb,var(--room-color) 5%,transparent),transparent 66%)}
    button{font:inherit;color:inherit;border:0;cursor:pointer;background:transparent;min-width:0;min-height:44px;border-radius:9px;text-align:start;padding:0;touch-action:manipulation}
    button:focus-visible{outline:2px solid var(--primary-color,#70cddc);outline-offset:-2px}button:hover{background:color-mix(in srgb,currentColor 5%,transparent)}
    .sensor{display:flex;align-items:center;gap:8px;min-height:52px;padding:4px 6px;box-sizing:border-box}.icon{position:relative;flex:0 0 30px;height:30px;display:grid;place-items:center;border-radius:50%;color:var(--secondary-text-color,#9da7b7);background:color-mix(in srgb,currentColor 8%,transparent);transition:color .18s,background .18s}.icon ha-icon{--mdc-icon-size:20px}.active .icon{color:var(--room-color);background:color-mix(in srgb,var(--room-color) 16%,transparent)}.dot{display:none;position:absolute;width:5px;height:5px;right:-1px;bottom:0;border-radius:50%;background:var(--secondary-text-color,#9da7b7)}.active .dot{display:block;background:var(--room-color);animation:breathe 3s ease-in-out infinite}.copy{min-width:0;display:grid;gap:3px}strong{font-size:13px;font-weight:600;overflow-wrap:anywhere;line-height:1.15}.since{font-size:10px;line-height:1.2;color:var(--secondary-text-color,#9da7b7);overflow-wrap:anywhere}
    .timeline{height:52px;padding:0 4px;display:flex;align-items:center}.track{position:relative;display:block;width:100%;height:22px;border-radius:5px;overflow:hidden;background:color-mix(in srgb,var(--primary-text-color,#fff) 8%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 5%,transparent)}.segment{position:absolute;top:0;height:100%}.on{background:var(--room-color);box-shadow:inset 0 1px #ffffff30}.off{background:color-mix(in srgb,var(--room-color) 10%,transparent)}.unknown{background:repeating-linear-gradient(135deg,transparent,transparent 3px,color-mix(in srgb,currentColor 18%,transparent) 3px,color-mix(in srgb,currentColor 18%,transparent) 4px)}.empty{position:absolute;inset:0;display:grid;place-items:center;font-size:10px;color:var(--secondary-text-color,#9da7b7);background:var(--ha-card-background,var(--card-background-color,#1e232b))}.axis{display:flex;justify-content:space-between;gap:4px;padding:0 4px 2px;font-size:10px;color:var(--secondary-text-color,#9da7b7)}.error{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--secondary-text-color,#9da7b7);padding-inline:6px}.error button{padding:0 12px;color:var(--primary-color,#70cddc)}
    @keyframes breathe{50%{opacity:.45}}:host([paused]) .dot{animation-play-state:paused}@media(prefers-reduced-motion:reduce){.dot{animation:none!important}.icon{transition:none}}
    @container(max-width:320px){.row,.axis-row{grid-template-columns:minmax(104px,1.1fr) minmax(0,1.6fr);gap:4px}.sensor{gap:6px;padding-inline:4px}.axis{font-size:9px}}
  `;
}
if (!customElements.get('homeassistant-motion-history-card')) customElements.define('homeassistant-motion-history-card', MotionHistoryCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === 'homeassistant-motion-history-card')) window.customCards.push({ type: 'homeassistant-motion-history-card', name: 'Motion History Card', preview: true, description: 'Compact room activity and aligned motion history.' });
console.info(`Motion History Card ${__VERSION__}`);
