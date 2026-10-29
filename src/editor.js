import { LitElement, html, css, nothing } from 'lit';
import { textFor } from './localize.js';
export class MotionHistoryEditor extends LitElement {
  static properties = { hass: { attribute: false, hasChanged: () => true }, _config: { state: true } };
  setConfig(config) { this._config = { ...config, entities: (config.entities || []).map(row => typeof row === 'string' ? { entity: row } : { ...row }) }; }
  _emit(config) { this._config = config; this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true })); }
  _rowChange(index, event) {
    event.stopPropagation();
    const entities = this._config.entities.map(row => ({ ...row }));
    entities[index] = { ...entities[index], ...event.detail.value };
    for (const key of ['name', 'icon', 'color']) if (entities[index][key] === '' || entities[index][key] == null) delete entities[index][key];
    this._emit({ ...this._config, entities });
  }
  _move(index, delta) {
    const entities = [...this._config.entities];
    [entities[index], entities[index + delta]] = [entities[index + delta], entities[index]];
    this._emit({ ...this._config, entities });
  }
  render() {
    if (!this.hass || !this._config) return nothing;
    const t = textFor(this.hass);
    const rowSchema = [
      { name: 'entity', required: true, selector: { entity: { domain: 'binary_sensor' } } },
      { name: 'name', selector: { text: {} } },
      { name: 'icon', selector: { icon: {} } },
      { name: 'color', selector: { text: {} } },
    ];
    return html`<p>${t.hint}</p>${this._config.entities.map((row, index) => html`<section>
      <div class="row-title"><strong>${index + 1}. ${row.name || row.entity || t.entity}</strong><div>
        <button aria-label=${`${t.up}: ${index + 1}`} ?disabled=${index === 0} @click=${() => this._move(index, -1)}>↑</button>
        <button aria-label=${`${t.down}: ${index + 1}`} ?disabled=${index === this._config.entities.length - 1} @click=${() => this._move(index, 1)}>↓</button>
        <button aria-label=${`${t.remove}: ${index + 1}`} @click=${() => this._emit({ ...this._config, entities: this._config.entities.filter((_, i) => i !== index) })}>×</button>
      </div></div>
      <ha-form .hass=${this.hass} .data=${row} .schema=${rowSchema} .computeLabel=${field => t[field.name]} @value-changed=${event => this._rowChange(index, event)}></ha-form>
    </section>`)}
    <button class="add" ?disabled=${this._config.entities.length >= 12} @click=${() => this._emit({ ...this._config, entities: [...this._config.entities, { entity: '' }] })}>+ ${t.add}</button>
    <ha-form class="settings" .hass=${this.hass} .data=${{ hours_to_show: 1, refresh_interval: 30, ...this._config }} .schema=${[
      { name: 'hours_to_show', selector: { number: { min: 1, max: 24, step: 1, mode: 'box' } } },
      { name: 'refresh_interval', selector: { number: { min: 10, max: 3600, step: 1, mode: 'box' } } },
    ]} .computeLabel=${field => t[field.name]} @value-changed=${event => { event.stopPropagation(); this._emit({ ...this._config, ...event.detail.value }); }}></ha-form>`;
  }
  static styles = css`:host{display:block}p{color:var(--secondary-text-color)}section{border:1px solid var(--divider-color);border-radius:12px;padding:12px;margin-bottom:12px}.row-title{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}.row-title strong{overflow-wrap:anywhere;min-width:0}.row-title>div{display:flex}button{min-width:44px;min-height:44px;border:0;border-radius:8px;background:transparent;color:var(--primary-color);font:inherit;cursor:pointer}button:disabled{opacity:.35;cursor:default}button:focus-visible{outline:2px solid var(--primary-color)}.add{margin-bottom:16px;padding:0 12px;background:var(--secondary-background-color)}`;
}
if (!customElements.get('homeassistant-motion-history-card-editor')) customElements.define('homeassistant-motion-history-card-editor', MotionHistoryEditor);
