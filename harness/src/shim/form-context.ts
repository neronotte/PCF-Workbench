/**
 * formContext + executionContext shim (M1.P1).
 *
 * Builds the model-driven form API surface that handlers in PCF / web-resource
 * code expect. The state lives in `store/form-store.ts`; this file is purely
 * the API facade.
 *
 * Coverage targets:
 *   - formContext.getAttribute(name)  — getValue/setValue/getRequiredLevel/setRequiredLevel/
 *                                       addOnChange/removeOnChange/fireOnChange/controls/
 *                                       getName/getAttributeType/getIsDirty/setSubmitMode/
 *                                       getSubmitMode/getValue/setValue/addOption/clearOptions
 *   - formContext.getControl(name)    — getVisible/setVisible/getDisabled/setDisabled/
 *                                       setNotification/clearNotification/setFocus/getName/
 *                                       getControlType/getAttribute/getParent
 *   - formContext.data.entity         — getId/getEntityName/getEntityReference/
 *                                       getPrimaryAttributeValue/getIsDirty/save/attributes/
 *                                       addOnSave/removeOnSave
 *   - formContext.ui                  — setFormNotification/clearFormNotification/getFormType/
 *                                       refreshRibbon/close/tabs/sections/formSelector/
 *                                       quickForms/process
 *   - formContext.context             — back-pointer to ComponentFramework.Context (when available)
 *   - executionContext                — getFormContext/getEventSource/getEventArgs/getDepth/
 *                                       getSharedVariable/setSharedVariable/getContext
 *
 * Behaviour for unimplemented members: log via the harness console (per project
 * preference: log only, don't throw).
 */

import * as fs from '../store/form-store';
import type { CoverageStatus } from '../store/harness-store';

type LogFn = (entry: { category: string; method: string; args?: any; result?: any; coverage?: CoverageStatus }) => void;

let logEntry: LogFn = () => {};

/** Wire the form-context shim to the harness log so calls show up in the console panel. */
export function setFormContextLogger(fn: LogFn): void {
  logEntry = fn;
}

function log(method: string, args?: any, coverage: CoverageStatus = 'implemented'): void {
  try { logEntry({ category: 'formContext', method, args, coverage }); } catch { /* swallow */ }
}

// ──────────────────────────────────────────────────────────────────────────
// Form-level notification store (separate from per-control notifications)
// Backed by the existing xrm-form module so existing notification UI works.
// ──────────────────────────────────────────────────────────────────────────

interface XrmFormApi {
  setFormNotification: (msg: string, level: string, id: string) => boolean;
  clearFormNotification: (id: string) => boolean;
}

function getFormNotificationApi(): XrmFormApi {
  const w = window as any;
  return w.Xrm?.Page?.ui ?? { setFormNotification: () => false, clearFormNotification: () => false };
}

// ──────────────────────────────────────────────────────────────────────────
// Attribute facade
// ──────────────────────────────────────────────────────────────────────────

function buildAttribute(name: string): any {
  const facade: any = {
    getName: () => name,
    getAttributeType: () => fs.getAttributeState(name)?.attributeType ?? 'string',
    getValue: () => fs.getAttributeState(name)?.value ?? null,
    setValue: (v: any) => {
      log('attribute.setValue', { name, value: v });
      fs.setAttributeValue(name, v);
    },
    getIsDirty: () => fs.getAttributeState(name)?.isDirty ?? false,
    getRequiredLevel: () => fs.getAttributeState(name)?.requiredLevel ?? 'none',
    setRequiredLevel: (level: fs.RequiredLevel) => {
      log('attribute.setRequiredLevel', { name, level });
      fs.setAttributeRequiredLevel(name, level);
    },
    getSubmitMode: () => fs.getAttributeState(name)?.submitMode ?? 'dirty',
    setSubmitMode: (mode: 'always' | 'never' | 'dirty') => {
      log('attribute.setSubmitMode', { name, mode });
      const a = fs.getAttributeState(name);
      if (a) a.submitMode = mode;
    },
    addOnChange: (handler: fs.AttrChangeHandler) => {
      log('attribute.addOnChange', { name });
      fs.addAttrOnChange(name, handler);
    },
    removeOnChange: (handler: fs.AttrChangeHandler) => {
      log('attribute.removeOnChange', { name });
      fs.removeAttrOnChange(name, handler);
    },
    fireOnChange: () => {
      log('attribute.fireOnChange', { name });
      const ctx = buildExecutionContext('attribute.fireOnChange', facade);
      fs.fireOnChange(name, ctx);
    },
    getFormat: () => fs.getAttributeState(name)?.format,
    getMaxLength: () => fs.getAttributeState(name)?.maxLength ?? -1,
    getOptions: () => fs.getAttributeState(name)?.options ?? [],
    getOption: (val: number | string) => {
      const opts = fs.getAttributeState(name)?.options ?? [];
      return opts.find(o => o.value === val || o.text === val);
    },
    getSelectedOption: () => {
      const a = fs.getAttributeState(name);
      if (!a?.options) return null;
      return a.options.find(o => o.value === a.value) ?? null;
    },
    getInitialValue: () => fs.getAttributeState(name)?.initialValue ?? null,
    getUserPrivilege: () => ({ canRead: true, canUpdate: true, canCreate: true }),
    controls: {
      get: (filter?: number | string | ((c: any, i: number) => boolean)) => {
        const c = buildControl(name);
        if (!c) return null;
        if (filter == null) return [c];
        if (typeof filter === 'number') return filter === 0 ? c : null;
        if (typeof filter === 'string') return c.getName() === filter ? c : null;
        return [c].filter((x, i) => filter(x, i));
      },
      getAll: () => {
        const c = buildControl(name);
        return c ? [c] : [];
      },
      forEach: (cb: (c: any, i: number) => void) => {
        const c = buildControl(name);
        if (c) cb(c, 0);
      },
      getLength: () => (fs.getControlState(name) ? 1 : 0),
    },
  };
  return facade;
}

// ──────────────────────────────────────────────────────────────────────────
// Control facade
// ──────────────────────────────────────────────────────────────────────────

function buildControl(name: string): any | null {
  const ctrl = fs.getControlState(name);
  if (!ctrl) return null;
  const facade: any = {
    getName: () => name,
    getControlType: () => ctrl.controlType,
    getLabel: () => ctrl.label ?? name,
    setLabel: (label: string) => {
      log('control.setLabel', { name, label });
      ctrl.label = label;
    },
    getVisible: () => fs.getControlState(name)?.visible ?? true,
    setVisible: (v: boolean) => {
      log('control.setVisible', { name, visible: v });
      fs.setControlVisible(name, v);
    },
    getDisabled: () => fs.getControlState(name)?.disabled ?? false,
    setDisabled: (d: boolean) => {
      log('control.setDisabled', { name, disabled: d });
      fs.setControlDisabled(name, d);
    },
    setFocus: () => { log('control.setFocus', { name }, 'stub'); },
    setNotification: (message: string, uniqueId: string) => {
      log('control.setNotification', { name, message, uniqueId });
      fs.setControlNotification(name, {
        notificationLevel: 'ERROR',
        uniqueId: uniqueId ?? `default-${name}`,
        messages: [message],
      });
      return true;
    },
    clearNotification: (uniqueId?: string) => {
      log('control.clearNotification', { name, uniqueId });
      fs.clearControlNotification(name, uniqueId);
      return true;
    },
    addNotification: (n: fs.ControlNotification) => {
      log('control.addNotification', { name, uniqueId: n.uniqueId });
      fs.setControlNotification(name, n);
      return true;
    },
    getAttribute: () => (ctrl.attributeName ? buildAttribute(ctrl.attributeName) : null),
    getParent: () => buildSection(findParentSection(name)),
    // OptionSet-only helpers — log + best-effort
    addOption: (option: { value: number; text: string }, _index?: number) => {
      log('control.addOption', { name, option });
      const a = ctrl.attributeName ? fs.getAttributeState(ctrl.attributeName) : undefined;
      if (a) {
        a.options = a.options ?? [];
        a.options.push(option);
      }
    },
    removeOption: (value: number) => {
      log('control.removeOption', { name, value });
      const a = ctrl.attributeName ? fs.getAttributeState(ctrl.attributeName) : undefined;
      if (a?.options) a.options = a.options.filter(o => o.value !== value);
    },
    clearOptions: () => {
      log('control.clearOptions', { name });
      const a = ctrl.attributeName ? fs.getAttributeState(ctrl.attributeName) : undefined;
      if (a) a.options = [];
    },
  };
  return facade;
}

function findParentSection(controlName: string): string {
  for (const s of fs.listSections()) {
    if (s.controls.includes(controlName)) return s.name;
  }
  return 'general';
}

// ──────────────────────────────────────────────────────────────────────────
// Section / Tab facades
// ──────────────────────────────────────────────────────────────────────────

function buildSection(name: string): any | null {
  const s = fs.getSectionState(name);
  if (!s) return null;
  return {
    getName: () => name,
    getLabel: () => s.label ?? name,
    setLabel: (label: string) => { log('section.setLabel', { name, label }); s.label = label; },
    getVisible: () => fs.getSectionState(name)?.visible ?? true,
    setVisible: (v: boolean) => { log('section.setVisible', { name, visible: v }); fs.setSectionVisible(name, v); },
    getParent: () => buildTab(s.parentTab),
    controls: {
      get: (filter?: number | string | ((c: any, i: number) => boolean)) => {
        const list = s.controls.map(buildControl).filter(Boolean) as any[];
        if (filter == null) return list;
        if (typeof filter === 'number') return list[filter] ?? null;
        if (typeof filter === 'string') return list.find(c => c.getName() === filter) ?? null;
        return list.filter((c, i) => filter(c, i));
      },
      getAll: () => s.controls.map(buildControl).filter(Boolean) as any[],
      forEach: (cb: (c: any, i: number) => void) => s.controls.map(buildControl).forEach((c, i) => c && cb(c, i)),
      getLength: () => s.controls.length,
    },
  };
}

function buildTab(name: string): any | null {
  const t = fs.getTabState(name);
  if (!t) return null;
  return {
    getName: () => name,
    getLabel: () => t.label ?? name,
    setLabel: (label: string) => { log('tab.setLabel', { name, label }); t.label = label; },
    getVisible: () => fs.getTabState(name)?.visible ?? true,
    setVisible: (v: boolean) => { log('tab.setVisible', { name, visible: v }); fs.setTabVisible(name, v); },
    getDisplayState: () => fs.getTabState(name)?.displayState ?? 'expanded',
    setDisplayState: (d: fs.DisplayState) => { log('tab.setDisplayState', { name, d }); fs.setTabDisplayState(name, d); },
    setFocus: () => { log('tab.setFocus', { name }, 'stub'); t.focused = true; },
    sections: {
      get: (filter?: number | string | ((c: any, i: number) => boolean)) => {
        const list = t.sections.map(buildSection).filter(Boolean) as any[];
        if (filter == null) return list;
        if (typeof filter === 'number') return list[filter] ?? null;
        if (typeof filter === 'string') return list.find(c => c.getName() === filter) ?? null;
        return list.filter((c, i) => filter(c, i));
      },
      getAll: () => t.sections.map(buildSection).filter(Boolean) as any[],
      forEach: (cb: (c: any, i: number) => void) => t.sections.map(buildSection).forEach((c, i) => c && cb(c, i)),
      getLength: () => t.sections.length,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// data.entity
// ──────────────────────────────────────────────────────────────────────────

function buildEntity(getPageEntityId: () => string, getPageEntityType: () => string, getPageEntityName: () => string): any {
  const attributesCollection = {
    get: (filter?: number | string | ((a: any, i: number) => boolean)) => {
      const list = fs.listAttributes().map(a => buildAttribute(a.name));
      if (filter == null) return list;
      if (typeof filter === 'number') return list[filter] ?? null;
      if (typeof filter === 'string') return list.find(a => a.getName() === filter) ?? null;
      return list.filter((a, i) => filter(a, i));
    },
    forEach: (cb: (a: any, i: number) => void) => fs.listAttributes().forEach((a, i) => cb(buildAttribute(a.name), i)),
    getAll: () => fs.listAttributes().map(a => buildAttribute(a.name)),
    getLength: () => fs.listAttributes().length,
  };

  return {
    getId: () => `{${getPageEntityId()}}`,
    getEntityName: () => getPageEntityType(),
    getPrimaryAttributeValue: () => {
      const primary = fs.getPrimaryAttributeName();
      return primary ? fs.getAttributeState(primary)?.value ?? getPageEntityName() : getPageEntityName();
    },
    getEntityReference: () => ({
      id: `{${getPageEntityId()}}`,
      entityType: getPageEntityType(),
      name: (() => {
        const primary = fs.getPrimaryAttributeName();
        return primary ? fs.getAttributeState(primary)?.value ?? getPageEntityName() : getPageEntityName();
      })(),
    }),
    getIsDirty: () => fs.isFormDirty(),
    isValid: () => true,
    save: (saveOption?: string) => {
      log('entity.save', { saveOption });
      const ctx = buildExecutionContext('entity.save', null);
      fs.fireOnSave(ctx);
      fs.resetDirty();
      // PCF returns a Promise<void>
      const p = Promise.resolve();
      // Fire post-save asynchronously
      p.then(() => fs.fireOnPostSave(buildExecutionContext('entity.postSave', null)));
      return p;
    },
    addOnSave: (handler: fs.FormHandler) => { log('entity.addOnSave'); fs.addOnSave(handler); },
    removeOnSave: (handler: fs.FormHandler) => { log('entity.removeOnSave'); fs.removeOnSave(handler); },
    addOnPostSave: (handler: fs.FormHandler) => { log('entity.addOnPostSave'); fs.addOnPostSave(handler); },
    removeOnPostSave: (handler: fs.FormHandler) => { log('entity.removeOnPostSave'); fs.removeOnPostSave(handler); },
    attributes: attributesCollection,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// formContext.ui
// ──────────────────────────────────────────────────────────────────────────

function buildUi(): any {
  const tabsCollection = {
    get: (filter?: number | string | ((t: any, i: number) => boolean)) => {
      const list = fs.listTabs().map(t => buildTab(t.name)).filter(Boolean) as any[];
      if (filter == null) return list;
      if (typeof filter === 'number') return list[filter] ?? null;
      if (typeof filter === 'string') return list.find(t => t.getName() === filter) ?? null;
      return list.filter((t, i) => filter(t, i));
    },
    getAll: () => fs.listTabs().map(t => buildTab(t.name)).filter(Boolean) as any[],
    forEach: (cb: (t: any, i: number) => void) => fs.listTabs().forEach((t, i) => {
      const tab = buildTab(t.name);
      if (tab) cb(tab, i);
    }),
    getLength: () => fs.listTabs().length,
  };

  // formContext.ui.controls — collection over every known control on the form.
  // @types/xrm exposes this at the form root in addition to per-section/tab.
  const controlsCollection = {
    get: (filter?: number | string | ((c: any, i: number) => boolean)) => {
      const list = fs.listControls().map(c => buildControl(c.name)).filter(Boolean) as any[];
      if (filter == null) return list;
      if (typeof filter === 'number') return list[filter] ?? null;
      if (typeof filter === 'string') return list.find(c => c.getName() === filter) ?? null;
      return list.filter((c, i) => filter(c, i));
    },
    getAll: () => fs.listControls().map(c => buildControl(c.name)).filter(Boolean) as any[],
    forEach: (cb: (c: any, i: number) => void) => fs.listControls().forEach((c, i) => {
      const ctrl = buildControl(c.name);
      if (ctrl) cb(ctrl, i);
    }),
    getLength: () => fs.listControls().length,
  };

  // formContext.ui.sections — flat collection of every section across all tabs.
  const sectionsCollection = {
    get: (filter?: number | string | ((s: any, i: number) => boolean)) => {
      const list = fs.listSections().map(s => buildSection(s.name)).filter(Boolean) as any[];
      if (filter == null) return list;
      if (typeof filter === 'number') return list[filter] ?? null;
      if (typeof filter === 'string') return list.find(s => s.getName() === filter) ?? null;
      return list.filter((s, i) => filter(s, i));
    },
    getAll: () => fs.listSections().map(s => buildSection(s.name)).filter(Boolean) as any[],
    forEach: (cb: (s: any, i: number) => void) => fs.listSections().forEach((s, i) => {
      const sec = buildSection(s.name);
      if (sec) cb(sec, i);
    }),
    getLength: () => fs.listSections().length,
  };

  return {
    setFormNotification: (msg: string, level: string, id: string) => {
      log('ui.setFormNotification', { msg, level, id });
      return getFormNotificationApi().setFormNotification(msg, level, id);
    },
    clearFormNotification: (id: string) => {
      log('ui.clearFormNotification', { id });
      return getFormNotificationApi().clearFormNotification(id);
    },
    getFormType: () => fs.getFormType(),
    refreshRibbon: (refreshAll?: boolean) => { log('ui.refreshRibbon', { refreshAll }, 'stub'); },
    close: () => { log('ui.close', undefined, 'stub'); },
    getViewPortHeight: () => window.innerHeight,
    getViewPortWidth: () => window.innerWidth,
    addOnLoad: (handler: fs.FormHandler) => { log('ui.addOnLoad'); fs.addOnLoad(handler); },
    removeOnLoad: (handler: fs.FormHandler) => { log('ui.removeOnLoad'); fs.removeOnLoad(handler); },
    tabs: tabsCollection,
    controls: controlsCollection,
    sections: sectionsCollection,
    formSelector: {
      getCurrentItem: () => ({
        getId: () => fs.getFormId(),
        getLabel: () => 'Default Form',
        navigate: () => log('formSelector.navigate', undefined, 'stub'),
      }),
      items: {
        get: () => [],
        forEach: () => {},
        getLength: () => 0,
      },
    },
    quickForms: {
      get: () => [],
      forEach: () => {},
      getLength: () => 0,
    },
    process: {
      getActiveProcess: () => null,
      getActiveStage: () => null,
      getProcessInstances: (cb: (i: any) => void) => cb({}),
      reset: () => log('ui.process.reset', undefined, 'stub'),
    },
    headerSection: {
      getBodyVisible: () => true,
      setBodyVisible: (v: boolean) => log('headerSection.setBodyVisible', { v }, 'stub'),
      getCommandBarVisible: () => true,
      setCommandBarVisible: (v: boolean) => log('headerSection.setCommandBarVisible', { v }, 'stub'),
      getTabNavigatorVisible: () => true,
      setTabNavigatorVisible: (v: boolean) => log('headerSection.setTabNavigatorVisible', { v }, 'stub'),
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// formContext root
// ──────────────────────────────────────────────────────────────────────────

let _activeFormContext: any = null;
let _pageEntityIdGetter: () => string = () => '';
let _pageEntityTypeGetter: () => string = () => '';
let _pageEntityNameGetter: () => string = () => '';

export interface FormContextHooks {
  getPageEntityId: () => string;
  getPageEntityTypeName: () => string;
  getPageEntityRecordName: () => string;
  getPcfContext?: () => any;
}

export function buildFormContext(hooks: FormContextHooks): any {
  _pageEntityIdGetter = hooks.getPageEntityId;
  _pageEntityTypeGetter = hooks.getPageEntityTypeName;
  _pageEntityNameGetter = hooks.getPageEntityRecordName;

  const fc: any = {
    getAttribute: (name: string) => {
      const a = fs.getAttributeState(name);
      if (!a) {
        log('getAttribute.missing', { name }, 'unimplemented');
        return null;
      }
      return buildAttribute(name);
    },
    getControl: (name: string) => {
      const c = fs.getControlState(name);
      if (!c) {
        log('getControl.missing', { name }, 'unimplemented');
        return null;
      }
      return buildControl(name);
    },
    data: {
      entity: buildEntity(hooks.getPageEntityId, hooks.getPageEntityTypeName, hooks.getPageEntityRecordName),
      isValid: () => true,
      refresh: (save?: boolean) => { log('data.refresh', { save }, 'stub'); return Promise.resolve(); },
      save: () => {
        log('data.save');
        return fc.data.entity.save();
      },
      addOnLoad: (handler: fs.FormHandler) => { log('data.addOnLoad'); fs.addOnLoad(handler); },
      removeOnLoad: (handler: fs.FormHandler) => { log('data.removeOnLoad'); fs.removeOnLoad(handler); },
      attributes: {
        get: (filter?: any) => fc.data.entity.attributes.get(filter),
        forEach: (cb: any) => fc.data.entity.attributes.forEach(cb),
        getLength: () => fc.data.entity.attributes.getLength(),
      },
    },
    ui: buildUi(),
    // Convenience back-pointer to the PCF context. Lazy getter (rather than
    // eager assignment) because buildFormContext() runs BEFORE createContext()
    // in control-host.ts — capturing `hooks.getPcfContext()` eagerly snapshots
    // `undefined` and crashes any legacy `Xrm.Page.context.client.getClient()`
    // path with "Cannot read properties of null (reading 'client')".
    get context() {
      const pcf = hooks.getPcfContext?.();
      if (pcf) return pcf;
      // Final fallback: legacy code that expected Xrm.Page.context to be the
      // *global* Xrm context (with .client / .organizationSettings / .userSettings).
      try { return (window as any).Xrm?.Utility?.getGlobalContext?.() ?? null; } catch { return null; }
    },
  };

  // addOnLoad/Save/PostSave at the root level, mirroring real Xrm.Page semantics
  fc.addOnSave = (handler: fs.FormHandler) => { log('formContext.addOnSave'); fs.addOnSave(handler); };
  fc.removeOnSave = (handler: fs.FormHandler) => { log('formContext.removeOnSave'); fs.removeOnSave(handler); };
  fc.addOnLoad = (handler: fs.FormHandler) => { log('formContext.addOnLoad'); fs.addOnLoad(handler); };
  fc.removeOnLoad = (handler: fs.FormHandler) => { log('formContext.removeOnLoad'); fs.removeOnLoad(handler); };
  fc.addOnPostSave = (handler: fs.FormHandler) => { log('formContext.addOnPostSave'); fs.addOnPostSave(handler); };
  fc.removeOnPostSave = (handler: fs.FormHandler) => { log('formContext.removeOnPostSave'); fs.removeOnPostSave(handler); };

  _activeFormContext = fc;
  // Inject the rich builder into form-store so any minimalExecutionContext
  // fallback (e.g. harness-UI-driven fireOnChange) still receives a real
  // formContext.
  fs.setExecutionContextBuilder(buildExecutionContext);
  return fc;
}

export function getActiveFormContext(): any | null { return _activeFormContext; }

// ──────────────────────────────────────────────────────────────────────────
// executionContext
// ──────────────────────────────────────────────────────────────────────────

export function buildExecutionContext(eventSource: string, payload: any, depth = 1): any {
  const eventArgs = {
    isDefaultPrevented: () => !!payload?._defaultPrevented,
    preventDefault: () => { if (payload) payload._defaultPrevented = true; },
    getSaveMode: () => payload?.saveMode ?? 1,
  };
  return {
    getFormContext: () => _activeFormContext,
    getEventSource: () => payload ?? { getName: () => eventSource },
    getEventArgs: () => eventArgs,
    getDepth: () => depth,
    getSharedVariable: <T = any>(key: string): T | undefined => fs.getSharedVariable<T>(key),
    setSharedVariable: (key: string, value: any) => fs.setSharedVariable(key, value),
    getContext: () => _activeFormContext, // legacy alias
  };
}
