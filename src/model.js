export const PALETTE = { cyan: '#26bfd3', yellow: '#e4b73f', pink: '#e57da9', blue: '#529ee8', green: '#60b697', purple: '#ac8bdf', orange: '#e39957' };
export function validateConfig(config) {
  if (!config || !Array.isArray(config.entities) || config.entities.length < 1 || config.entities.length > 12) throw new Error('Select between 1 and 12 binary sensors.');
  const entities = config.entities.map((value, index) => {
    const row = typeof value === 'string' ? { entity: value } : value;
    if (!row || !/^binary_sensor\.[a-z0-9_]+$/.test(row.entity || '')) throw new Error('Select valid binary_sensor entities.');
    if (row.name !== undefined && typeof row.name !== 'string') throw new Error('Names must be text.');
    if (row.icon !== undefined && (typeof row.icon !== 'string' || !/^[a-z0-9_-]+:[a-z0-9_-]+$/.test(row.icon))) throw new Error('Use a valid icon, for example mdi:door.');
    if (row.color !== undefined && !PALETTE[row.color] && !/^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(row.color)) throw new Error('Use a palette color or a hex color.');
    return { color: ['cyan', 'yellow', 'pink'][index % 3], ...row };
  });
  if (new Set(entities.map(row => row.entity)).size !== entities.length) throw new Error('Each sensor can only appear once.');
  const hours = config.hours_to_show ?? 1;
  const refresh = config.refresh_interval ?? 30;
  if (!Number.isFinite(hours) || hours < 1 || hours > 24) throw new Error('History must be between 1 and 24 hours.');
  if (!Number.isInteger(refresh) || refresh < 10 || refresh > 3600) throw new Error('Refresh interval must be between 10 and 3600 seconds.');
  return { ...config, entities, hours_to_show: hours, refresh_interval: refresh };
}
export function historyPath(ids, start, end) {
  const query = new URLSearchParams({ filter_entity_id: ids.join(','), end_time: new Date(end).toISOString(), minimal_response: '1', no_attributes: '1' });
  return `history/period/${new Date(start).toISOString()}?${query}`;
}
export function parseHistory(response, ids) {
  if (!Array.isArray(response)) throw new Error('Invalid history response.');
  const result = Object.fromEntries(ids.map(id => [id, []]));
  for (const group of response) {
    if (!Array.isArray(group)) throw new Error('Invalid history series.');
    const id = group.find(row => row?.entity_id)?.entity_id;
    if (!ids.includes(id)) continue;
    result[id] = group.map(row => ({ time: Date.parse(row.last_changed || row.last_updated), state: row.state }))
      .filter(row => Number.isFinite(row.time) && typeof row.state === 'string').sort((a, b) => a.time - b.time);
  }
  return result;
}
// Missing prefixes stay unknown. Never infer recorded history from a current state.
export function segmentsFor(records, start, end) {
  if (!(end > start)) return [];
  const segments = [];
  let cursor = start, state = 'missing';
  for (const record of records || []) {
    if (record.time > end) break;
    if (record.time <= start) { state = record.state; continue; }
    if (record.time > cursor) segments.push({ start: cursor, end: record.time, state });
    cursor = record.time; state = record.state;
  }
  if (cursor < end) segments.push({ start: cursor, end, state });
  return segments;
}
export function relativeTime(value, now, language = 'en') {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '—';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  const unit = seconds < 60 ? 'second' : seconds < 3600 ? 'minute' : seconds < 86400 ? 'hour' : 'day';
  const divisor = { second: 1, minute: 60, hour: 3600, day: 86400 }[unit];
  return new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' }).format(-Math.floor(seconds / divisor), unit);
}
