/**
 * Form state store backing the formContext shim (M1.P1).
 *
 * Mirrors the runtime state a model-driven form keeps: attributes (with
 * onChange handlers), controls (visibility, disabled, notifications, options),
 * tabs/sections (visibility, focus, label, displayState), and form-level
 * handlers (onLoad / onSave / onPostSave).
 *
 * Seeded from the active record in `data-store` plus the manifest's bound
 * properties on first call to `seedFormState`.
 */

import type { ManifestConfig } from '../types/manifest';
import { getEntityData } from './data-store';

export type RequiredLevel = 'none' | 'recommended' | 'required';
export type DisplayState = 'expanded' | 'collapsed';
export type FormType = 0 | 1 | 2 | 3 | 4 | 6 | 11; // Undefined / Create / Update / ReadOnly / Disabled / BulkEdit / ReadOptimized
export type NotificationLevel = 'ERROR' | 'WARNING' | 'RECOMMENDATION';

export interface AttributeState {
  name: string;
  value: any;
  initialValue: any;
  requiredLevel: RequiredLevel;
  attributeType: string; // 'string' | 'integer' | 'datetime' | 'lookup' | 'optionset' | 'boolean' | 'decimal' | …
  isDirty: boolean;
  submitMode: 'always' | 'never' | 'dirty';
  format?: string;
  maxLength?: number;
  // options for optionsets
  options?: Array<{ value: number; text: string }>;
}

export interface ControlNotification {
  notificationLevel?: NotificationLevel;
  uniqueId: string;
  messages: string[];
  actions?: Array<{ message?: string; actions?: Array<() => void> }>;
}

export interface ControlState {
  name: string;
  attributeName?: string; // null for sub-grids etc.
  controlType: string; // 'standard' | 'subgrid' | 'iframe' | 'kbsearch' | …
  visible: boolean;
  disabled: boolean;
  label?: string;
  notifications: Map<string, ControlNotification>;
}

export interface SectionState {
  name: string;
  label?: string;
  visible: boolean;
  parentTab: string;
  controls: string[];
}

export interface TabState {
  name: string;
  label?: string;
  visible: boolean;
  displayState: DisplayState;
  focused: boolean;
  sections: string[];
}

export type AttrChangeHandler = (executionContext: any) => void;
export type FormHandler = (executionContext: any) => void;

interface FormStateInternal {
  attributes: Map<string, AttributeState>;
  controls: Map<string, ControlState>;
  tabs: Map<string, TabState>;
  sections: Map<string, SectionState>;
  attrChangeHandlers: Map<string, Set<AttrChangeHandler>>;
  onLoadHandlers: Set<FormHandler>;
  onSaveHandlers: Set<FormHandler>;
  onPostSaveHandlers: Set<FormHandler>;
  formType: FormType;
  formId: string;
  primaryAttributeName?: string;
  sharedVariables: Map<string, any>;
}

const state: FormStateInternal = {
  attributes: new Map(),
  controls: new Map(),
  tabs: new Map(),
  sections: new Map(),
  attrChangeHandlers: new Map(),
  onLoadHandlers: new Set(),
  onSaveHandlers: new Set(),
  onPostSaveHandlers: new Set(),
  formType: 2, // Update
  formId: '00000000-0000-0000-0000-000000000000',
  sharedVariables: new Map(),
};

const listeners = new Set<() => void>();
let storeVersion = 0;

function notify(): void {
  storeVersion += 1;
  for (const l of listeners) {
    try { l(); } catch (e) { console.error('[pcf-workbench] form-store listener error', e); }
  }
}

export function subscribeFormState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFormStateVersion(): number {
  return storeVersion;
}

// ──────────────────────────────────────────────────────────────────────────
// Seeding
// ──────────────────────────────────────────────────────────────────────────

function inferAttrType(value: any, ofType?: string): string {
  if (ofType) {
    const t = ofType.toLowerCase();
    if (t.includes('lookup')) return 'lookup';
    if (t.includes('optionset')) return 'optionset';
    if (t === 'twooptions' || t === 'boolean') return 'boolean';
    if (t === 'datetime' || t === 'datentime') return 'datetime';
    if (t === 'decimal') return 'decimal';
    if (t === 'whole.none' || t === 'integer') return 'integer';
    if (t === 'currency') return 'money';
    if (t.includes('multiple')) return 'memo';
    return 'string';
  }
  if (value == null) return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'decimal';
  if (value instanceof Date) return 'datetime';
  return 'string';
}

/**
 * Seed the form state from the manifest and the active record in data-store.
 * Idempotent — calling again resets the form to its initial state.
 */
export function seedFormState(
  manifest: ManifestConfig,
  pageEntityTypeName: string,
  pageEntityId: string,
  pageEntityRecordName: string,
): void {
  state.attributes.clear();
  state.controls.clear();
  state.tabs.clear();
  state.sections.clear();
  state.attrChangeHandlers.clear();
  state.onLoadHandlers.clear();
  state.onSaveHandlers.clear();
  state.onPostSaveHandlers.clear();
  state.sharedVariables.clear();
  state.formType = pageEntityId ? 2 : 1; // Update if there's an id, Create otherwise
  state.formId = '00000000-0000-0000-0000-000000000000';

  // Find the active record in data.json
  const records = pageEntityTypeName ? getEntityData(pageEntityTypeName) : [];
  const active = pageEntityId
    ? records.find(r =>
        Object.keys(r).some(k => k.toLowerCase() === `${pageEntityTypeName}id` && String(r[k]).toLowerCase() === pageEntityId.toLowerCase()),
      )
    : records[0];

  if (active) {
    for (const [key, raw] of Object.entries(active)) {
      // Skip OData annotation keys (foo@OData.Community.Display.V1.FormattedValue)
      if (key.includes('@')) continue;
      const attrName = key.startsWith('_') && key.endsWith('_value')
        ? key.slice(1, -'_value'.length)
        : key;
      addAttributeInternal({
        name: attrName,
        value: raw,
        initialValue: raw,
        requiredLevel: 'none',
        attributeType: inferAttrType(raw),
        isDirty: false,
        submitMode: 'dirty',
      });
    }
    // Heuristic primary attribute: 'name' or first string field
    state.primaryAttributeName = state.attributes.has('name')
      ? 'name'
      : Array.from(state.attributes.values()).find(a => a.attributeType === 'string')?.name;
  }

  // Add manifest-bound properties as attributes if not already present
  for (const prop of manifest.properties) {
    if (prop.usage !== 'bound') continue;
    if (state.attributes.has(prop.name)) continue;
    addAttributeInternal({
      name: prop.name,
      value: null,
      initialValue: null,
      requiredLevel: prop.required ? 'required' : 'none',
      attributeType: inferAttrType(null, prop.ofType),
      isDirty: false,
      submitMode: 'dirty',
    });
  }

  // For every attribute, register a default control of the same name
  for (const attr of state.attributes.values()) {
    if (state.controls.has(attr.name)) continue;
    state.controls.set(attr.name, {
      name: attr.name,
      attributeName: attr.name,
      controlType: 'standard',
      visible: true,
      disabled: false,
      label: attr.name,
      notifications: new Map(),
    });
  }

  // Default tab + section so getControl().getParent() lookups don't crash
  state.sections.set('general', {
    name: 'general',
    label: 'General',
    visible: true,
    parentTab: 'tab_general',
    controls: Array.from(state.controls.keys()),
  });
  state.tabs.set('tab_general', {
    name: 'tab_general',
    label: 'General',
    visible: true,
    displayState: 'expanded',
    focused: true,
    sections: ['general'],
  });

  notify();
}

function addAttributeInternal(attr: AttributeState): void {
  state.attributes.set(attr.name, attr);
  if (!state.attrChangeHandlers.has(attr.name)) {
    state.attrChangeHandlers.set(attr.name, new Set());
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Read / write helpers
// ──────────────────────────────────────────────────────────────────────────

export function getAttributeState(name: string): AttributeState | undefined {
  return state.attributes.get(name);
}

export function getControlState(name: string): ControlState | undefined {
  return state.controls.get(name);
}

export function getTabState(name: string): TabState | undefined {
  return state.tabs.get(name);
}

export function getSectionState(name: string): SectionState | undefined {
  return state.sections.get(name);
}

export function listAttributes(): AttributeState[] { return Array.from(state.attributes.values()); }
export function listControls(): ControlState[] { return Array.from(state.controls.values()); }
export function listTabs(): TabState[] { return Array.from(state.tabs.values()); }
export function listSections(): SectionState[] { return Array.from(state.sections.values()); }

export function setAttributeValue(name: string, value: any, fromHandler = false): boolean {
  const attr = state.attributes.get(name);
  if (!attr) return false;
  if (Object.is(attr.value, value)) return false;
  attr.value = value;
  attr.isDirty = !Object.is(attr.value, attr.initialValue);
  notify();
  if (!fromHandler) fireOnChange(name);
  return true;
}

export function setAttributeRequiredLevel(name: string, level: RequiredLevel): boolean {
  const attr = state.attributes.get(name);
  if (!attr) return false;
  attr.requiredLevel = level;
  notify();
  return true;
}

export function setControlVisible(name: string, visible: boolean): boolean {
  const c = state.controls.get(name);
  if (!c) return false;
  c.visible = visible;
  notify();
  return true;
}

export function setControlDisabled(name: string, disabled: boolean): boolean {
  const c = state.controls.get(name);
  if (!c) return false;
  c.disabled = disabled;
  notify();
  return true;
}

export function setControlNotification(name: string, n: ControlNotification): boolean {
  const c = state.controls.get(name);
  if (!c) return false;
  c.notifications.set(n.uniqueId, n);
  notify();
  return true;
}

export function clearControlNotification(name: string, uniqueId?: string): boolean {
  const c = state.controls.get(name);
  if (!c) return false;
  if (uniqueId) c.notifications.delete(uniqueId); else c.notifications.clear();
  notify();
  return true;
}

export function setTabVisible(name: string, visible: boolean): boolean {
  const t = state.tabs.get(name);
  if (!t) return false;
  t.visible = visible;
  notify();
  return true;
}

export function setTabDisplayState(name: string, displayState: DisplayState): boolean {
  const t = state.tabs.get(name);
  if (!t) return false;
  t.displayState = displayState;
  notify();
  return true;
}

export function setTabFocus(name: string): boolean {
  const target = state.tabs.get(name);
  if (!target) return false;
  let changed = false;
  for (const t of state.tabs.values()) {
    const shouldFocus = t.name === name;
    if (t.focused !== shouldFocus) {
      t.focused = shouldFocus;
      changed = true;
    }
  }
  if (changed) notify();
  return true;
}

export function setSectionVisible(name: string, visible: boolean): boolean {
  const s = state.sections.get(name);
  if (!s) return false;
  s.visible = visible;
  notify();
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// Handler registration
// ──────────────────────────────────────────────────────────────────────────

export function addAttrOnChange(name: string, handler: AttrChangeHandler): void {
  if (!state.attrChangeHandlers.has(name)) state.attrChangeHandlers.set(name, new Set());
  state.attrChangeHandlers.get(name)!.add(handler);
}

export function removeAttrOnChange(name: string, handler: AttrChangeHandler): void {
  state.attrChangeHandlers.get(name)?.delete(handler);
}

export function fireOnChange(name: string, executionContext?: any): void {
  const handlers = state.attrChangeHandlers.get(name);
  if (!handlers || handlers.size === 0) return;
  const ctx = executionContext ?? minimalExecutionContext(name);
  for (const h of handlers) {
    try { h(ctx); } catch (e) { console.error(`[pcf-workbench] onChange(${name}) threw`, e); }
  }
}

/**
 * Minimal executionContext used when fireOnChange is triggered by a non-shim
 * mutation (e.g. the harness UI directly calling setAttributeValue). When the
 * form-context shim is active it injects a richer builder via
 * `setExecutionContextBuilder` so handlers always receive a real
 * `getFormContext()` regardless of who triggered the change.
 */
type ExecutionContextBuilder = (eventSource: string, payload: any, depth?: number) => any;
let _executionContextBuilder: ExecutionContextBuilder | null = null;
export function setExecutionContextBuilder(builder: ExecutionContextBuilder | null): void {
  _executionContextBuilder = builder;
}

function minimalExecutionContext(attrName: string): any {
  if (_executionContextBuilder) {
    return _executionContextBuilder(`attribute.${attrName}.fireOnChange`, { getName: () => attrName }, 1);
  }
  return {
    getFormContext: () => null,
    getEventSource: () => ({ getName: () => attrName }),
    getEventArgs: () => ({ isDefaultPrevented: () => false, preventDefault: () => {}, getSaveMode: () => 1 }),
    getDepth: () => 1,
    getSharedVariable: <T = any>(key: string): T | undefined => state.sharedVariables.get(key) as T | undefined,
    setSharedVariable: (key: string, value: any) => { state.sharedVariables.set(key, value); },
    getContext: () => null,
  };
}

export function addOnLoad(handler: FormHandler): void { state.onLoadHandlers.add(handler); }
export function removeOnLoad(handler: FormHandler): void { state.onLoadHandlers.delete(handler); }
export function addOnSave(handler: FormHandler): void { state.onSaveHandlers.add(handler); }
export function removeOnSave(handler: FormHandler): void { state.onSaveHandlers.delete(handler); }
export function addOnPostSave(handler: FormHandler): void { state.onPostSaveHandlers.add(handler); }
export function removeOnPostSave(handler: FormHandler): void { state.onPostSaveHandlers.delete(handler); }

export function fireOnLoad(executionContext: any): void {
  for (const h of state.onLoadHandlers) {
    try { h(executionContext); } catch (e) { console.error('[pcf-workbench] onLoad threw', e); }
  }
}

export function fireOnSave(executionContext: any): void {
  for (const h of state.onSaveHandlers) {
    try { h(executionContext); } catch (e) { console.error('[pcf-workbench] onSave threw', e); }
  }
}

export function fireOnPostSave(executionContext: any): void {
  for (const h of state.onPostSaveHandlers) {
    try { h(executionContext); } catch (e) { console.error('[pcf-workbench] onPostSave threw', e); }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Form-level metadata
// ──────────────────────────────────────────────────────────────────────────

export function getFormType(): FormType { return state.formType; }
export function setFormType(t: FormType): void { state.formType = t; notify(); }
export function getFormId(): string { return state.formId; }
export function getPrimaryAttributeName(): string | undefined { return state.primaryAttributeName; }

export function getSharedVariable<T = any>(key: string): T | undefined { return state.sharedVariables.get(key); }
export function setSharedVariable(key: string, value: any): void { state.sharedVariables.set(key, value); }

export function getFormSnapshot() {
  return {
    formType: state.formType,
    formId: state.formId,
    primaryAttributeName: state.primaryAttributeName,
    attributes: Array.from(state.attributes.values()),
    controls: Array.from(state.controls.values()),
    tabs: Array.from(state.tabs.values()),
    sections: Array.from(state.sections.values()),
    onLoadHandlerCount: state.onLoadHandlers.size,
    onSaveHandlerCount: state.onSaveHandlers.size,
    onPostSaveHandlerCount: state.onPostSaveHandlers.size,
  };
}

export function isFormDirty(): boolean {
  for (const a of state.attributes.values()) if (a.isDirty) return true;
  return false;
}

export function getDirtyAttributes(): AttributeState[] {
  return Array.from(state.attributes.values()).filter(a => a.isDirty);
}

export function resetDirty(): void {
  for (const a of state.attributes.values()) {
    a.initialValue = a.value;
    a.isDirty = false;
  }
  notify();
}
