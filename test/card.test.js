import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { validateConfig, parseHistory, segmentsFor, historyPath, relativeTime } from '../src/model.js';
const window = new Window();
for (const key of ['window', 'document', 'customElements', 'HTMLElement', 'Element', 'Document', 'CSSStyleSheet', 'ShadowRoot', 'CustomEvent', 'Event']) globalThis[key] = window[key];
globalThis.__VERSION__ = 'test';
before(async () => { await import('../src/homeassistant-motion-history-card.js'); });
const id = 'binary_sensor.hall';
const config = { entities: [{ entity: id, name: 'Hall', icon: 'mdi:door', color: 'cyan' }] };
const state = (value = 'on') => ({ state: value, last_changed: new Date(Date.now() - 60000).toISOString(), attributes: { friendly_name: 'Hall', device_class: 'motion' } });
function fixture(callApi = async () => []) {
  const card = document.createElement('homeassistant-motion-history-card'); card.setConfig(config);
  card.hass = { states: { [id]: state() }, callApi, locale: { language: 'en', time_format: '24' }, config: { time_zone: 'Europe/Berlin' } };
  document.body.append(card); return card;
}
test('configuration accepts shorthand, defaults and preserves unknown fields without mutating input', () => {
  const input = { entities: [id], extension: true }; const result = validateConfig(input);
  assert.equal(result.hours_to_show, 1); assert.equal(result.refresh_interval, 30); assert.equal(result.entities[0].color, 'cyan'); assert.equal(result.extension, true); assert.equal(input.entities[0], id);
  for (const bad of [{ entities: [] }, { entities: ['light.hall'] }, { entities: [id, id] }, { ...config, hours_to_show: 0 }, { ...config, refresh_interval: 0 }, { ...config, refresh_interval: '30' }, { entities: [{ entity: id, color: 'url(evil)' }] }]) assert.throws(() => validateConfig(bad));
});
test('minimal history maps by ID rather than response order and preserves missing entities', () => {
  const parsed = parseHistory([[{ entity_id: id, state: 'off', last_changed: '2026-10-25T00:00:00Z' }, { state: 'on', last_changed: '2026-10-25T00:30:00Z' }]], ['binary_sensor.missing', id]);
  assert.equal(parsed[id].length, 2); assert.deepEqual(parsed['binary_sensor.missing'], []); assert.equal(parsed[id][1].state, 'on'); assert.throws(() => parseHistory({}, [id]));
});
test('timeline bounds, initial state, gaps, unknowns and empty history remain accurate', () => {
  assert.deepEqual(segmentsFor([{ time: 0, state: 'off' }, { time: 15, state: 'on' }, { time: 20, state: 'unavailable' }, { time: 40, state: 'off' }], 10, 30), [{ start: 10, end: 15, state: 'off' }, { start: 15, end: 20, state: 'on' }, { start: 20, end: 30, state: 'unavailable' }]);
  assert.deepEqual(segmentsFor([{ time: 15, state: 'on' }], 10, 20), [{ start: 10, end: 15, state: 'missing' }, { start: 15, end: 20, state: 'on' }]);
  assert.deepEqual(segmentsFor([], 10, 20), [{ start: 10, end: 20, state: 'missing' }]);
  assert.equal(segmentsFor([{ time: 10, state: 'off' }, { time: 10, state: 'on' }], 10, 20)[0].state, 'on');
});
test('history request spans an actual hour across DST and filters only configured entities', () => {
  const end = Date.parse('2026-10-25T02:30:00+01:00'), start = end - 3600000;
  const url = new URL('https://example.test/api/' + historyPath([id], start, end));
  assert.equal(url.searchParams.get('filter_entity_id'), id); assert.equal(Date.parse(url.searchParams.get('end_time')) - start, 3600000); assert.equal(url.searchParams.get('minimal_response'), '1'); assert.equal(url.searchParams.has('skip_initial_state'), false);
});
test('relative times are localized and invalid times are unavailable', () => {
  const now = Date.parse('2026-10-29T10:00:00Z');
  assert.match(relativeTime('2026-10-29T09:58:00Z', now, 'de'), /2/); assert.match(relativeTime('2026-10-29T09:58:00Z', now, 'en'), /ago/); assert.equal(relativeTime(undefined, now), '—');
});
test('reused hass updates current state, escaped names, relative time and correct more-info target', async () => {
  const card = fixture(); card.setConfig({ entities: [{ entity: id, name: '<img src=x>' }] }); await card.updateComplete;
  assert.equal(card.shadowRoot.querySelector('img'), null); assert.ok(card.shadowRoot.querySelector('.active'));
  let detail; card.addEventListener('hass-more-info', event => detail = event.detail); card.shadowRoot.querySelector('.sensor').click(); assert.equal(detail.entityId, id);
  card.hass.states[id] = state('unavailable'); card.hass = card.hass; await card.updateComplete;
  assert.equal(card.shadowRoot.querySelector('.active'), null); assert.equal(card.shadowRoot.querySelector('.since').textContent, 'Unavailable'); card.remove();
});
test('successful fetch records a fixed window and does not fake history from live state', async () => {
  let path; const card = fixture(async (method, url) => { assert.equal(method, 'GET'); path = url; return []; });
  await card._fetchHistory(); await card.updateComplete;
  assert.match(path, /history\/period/); assert.equal(card._status, 'ready'); assert.equal(card.shadowRoot.querySelector('.empty').textContent, 'No history'); assert.equal(card.shadowRoot.querySelector('.on'), null); assert.equal(card._snapshot.end - card._snapshot.start, 3600000); card.remove();
});
test('history errors are explicit, preserve old bounds, and retry recovers', async () => {
  let fail = false; const card = fixture(async () => { if (fail) throw new Error('offline'); return [[{ entity_id: id, state: 'on', last_changed: new Date(Date.now() - 7200000).toISOString() }]]; });
  await card._fetchHistory(); const snapshot = card._snapshot; fail = true; await card._fetchHistory(); await card.updateComplete;
  assert.equal(card._status, 'error'); assert.equal(card._snapshot, snapshot); assert.match(card.shadowRoot.querySelector('.error').textContent, /update failed/);
  fail = false; await card._fetchHistory(); assert.equal(card._status, 'ready'); card.remove();
});
test('late requests cannot overwrite a new configuration or detached card', async () => {
  let resolve; const card = fixture(() => new Promise(done => resolve = done)); const pending = card._fetchHistory();
  card.setConfig({ entities: ['binary_sensor.kitchen'] }); resolve([[{ entity_id: id, state: 'on', last_changed: new Date().toISOString() }]]); await pending; assert.equal(card._snapshot, undefined);
  const second = card._fetchHistory(); card.remove(); resolve([]); await second; assert.equal(card._snapshot, undefined); assert.equal(card._inflight, false);
});
test('polling is serialized and scheduled at the configured interval', async () => {
  let resolve, calls = 0; const card = fixture(() => { calls++; return new Promise(done => resolve = done); });
  card.setConfig({ ...config, refresh_interval: 45 }); const delays = []; card._schedule = delay => delays.push(delay);
  const first = card._fetchHistory(); await card._fetchHistory(); assert.equal(calls, 1); resolve([]); await first; assert.ok(delays.includes(45000)); card.remove();
});
test('hidden or offscreen cards skip polling and resume on visibility', async () => {
  let calls = 0; const card = fixture(async () => { calls++; return []; });
  card._visible = false; card._syncVisibility(); await card._fetchHistory(); assert.equal(calls, 0); assert.equal(card.hasAttribute('paused'), true);
  card._visible = true; card._syncVisibility(); await card._fetchHistory(); assert.equal(calls, 1); assert.equal(card.hasAttribute('paused'), false); card.remove();
});
test('states context updates and cleans up on removal, including late callbacks', async () => {
  let callback, releases = 0; const host = document.createElement('div'); document.body.append(host);
  host.addEventListener('context-request', event => callback = event.callback);
  const card = document.createElement('homeassistant-motion-history-card'); card.setConfig(config); host.append(card);
  callback({ [id]: state('off') }, () => releases++); await card.updateComplete; assert.match(card.shadowRoot.querySelector('.sensor').getAttribute('aria-label'), /Clear/);
  card.remove(); assert.equal(releases, 1); callback({ [id]: state('on') }, () => releases++); assert.equal(releases, 2); assert.equal(card._states, undefined); host.remove();
});
test('fresh editor bootstraps native HA selectors, preserves fields, edits and reorders sensors', async () => {
  let loads = 0; window.loadCardHelpers = async () => ({ createCardElement: () => ({ constructor: { getConfigElement: async () => { loads++; customElements.define('ha-form', class extends HTMLElement {}); } } }) });
  const Card = customElements.get('homeassistant-motion-history-card'); const editor = await Card.getConfigElement();
  editor.setConfig({ entities: [{ entity: id, extra: 7 }, { entity: 'binary_sensor.kitchen' }], custom_setting: true }); editor.hass = { states: {} }; document.body.append(editor); await editor.updateComplete;
  let result; editor.addEventListener('config-changed', event => result = event.detail.config);
  editor.shadowRoot.querySelector('ha-form').dispatchEvent(new CustomEvent('value-changed', { detail: { value: { name: 'Entry', icon: '' } } }));
  assert.equal(result.custom_setting, true); assert.equal(result.entities[0].extra, 7); assert.equal(result.entities[0].name, 'Entry'); assert.equal('icon' in result.entities[0], false);
  editor._move(0, 1); assert.equal(result.entities[1].entity, id); editor.shadowRoot.querySelector('.add').click(); assert.equal(result.entities.length, 3);
  await Card.getConfigElement(); assert.equal(loads, 1); editor.remove();
});
test('reconfiguration cancels the wait even when the underlying request never resolves', async () => {
  const card = fixture(() => new Promise(() => {})); const pending = card._fetchHistory();
  card.setConfig({ entities: ['binary_sensor.other'] }); await pending;
  assert.equal(card._snapshot, undefined); assert.equal(card._inflight, false); card.remove();
});
test('a previous context callback cannot overwrite a reconnected card', async () => {
  const callbacks = []; const host = document.createElement('div'); document.body.append(host);
  host.addEventListener('context-request', event => callbacks.push(event.callback));
  const card = document.createElement('homeassistant-motion-history-card'); card.setConfig(config); host.append(card); card.remove(); host.append(card);
  callbacks[1]({ [id]: state('off') }, () => {}); callbacks[0]({ [id]: state('on') }, () => {});
  await card.updateComplete; assert.match(card.shadowRoot.querySelector('.sensor').getAttribute('aria-label'), /Clear/); card.remove(); host.remove();
});
