import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  makeStyles, mergeClasses, tokens, Input, Switch, Button, Badge, Divider, Text, Dropdown, Option,
} from '@fluentui/react-components';
import {
  subscribeFormState,
  getFormStateVersion,
  listAttributes,
  listControls,
  listTabs,
  setAttributeValue,
  setAttributeRequiredLevel,
  setControlVisible,
  setControlDisabled,
  setControlNotification,
  clearControlNotification,
  setTabVisible,
  setTabDisplayState,
  fireOnChange,
  isFormDirty,
  getDirtyAttributes,
  getFormType,
  type RequiredLevel,
} from '../../store/form-store';

const useStyles = makeStyles({
  root: {
    padding: '12px',
    boxSizing: 'border-box',
    fontSize: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    // Defense-in-depth — the parent sidePanelContent owns scrolling, but
    // if any row miscalculates we'd rather clip than spawn an inner
    // horizontal scrollbar inside the side panel.
    overflowX: 'hidden',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: 0,
    width: '100%',
  },
  sectionTitle: {
    fontWeight: 600,
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: tokens.colorNeutralForeground2,
  },
  // All three row types share a flex-wrap layout so that when the side
  // panel is narrow, action chips drop to the next line instead of
  // overflowing horizontally (which previously forced a scrollbar /
  // clipped the right-most action button at 280px widths).
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 6px',
    borderRadius: '4px',
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box',
  },
  rowDirty: {
    borderLeft: `3px solid ${tokens.colorPaletteYellowBorderActive}`,
  },
  attrCell: {
    flex: '1 1 110px',
    minWidth: 0,
    overflow: 'hidden',
  },
  attrName: {
    fontFamily: 'Consolas, monospace',
    fontSize: '11px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  attrType: {
    fontSize: '10px',
    color: tokens.colorNeutralForeground3,
  },
  attrInput: {
    flex: '1 1 140px',
    minWidth: 0,
  },
  attrRequired: {
    flex: '0 0 auto',
    minWidth: '88px',
  },
  attrFire: {
    flex: '0 0 auto',
  },
  controlRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 6px',
    borderRadius: '4px',
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box',
  },
  controlName: {
    flex: '1 1 100%',
    minWidth: 0,
  },
  tabRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 6px',
    borderRadius: '4px',
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
    width: '100%',
    boxSizing: 'border-box',
  },
  tabName: {
    flex: '1 1 100%',
    minWidth: 0,
  },
  emptyMsg: {
    color: tokens.colorNeutralForeground3,
    fontStyle: 'italic',
    fontSize: '11px',
  },
  toolbar: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
});

interface FormSnapshot {
  attributes: ReturnType<typeof listAttributes>;
  controls: ReturnType<typeof listControls>;
  tabs: ReturnType<typeof listTabs>;
  dirty: boolean;
  dirtyCount: number;
  formType: number;
  version: number;
}

let cachedSnapshot: FormSnapshot | null = null;
let cachedVersion = -1;

function getSnapshot(): FormSnapshot {
  const v = getFormStateVersion();
  if (cachedSnapshot && cachedVersion === v) return cachedSnapshot;
  cachedVersion = v;
  cachedSnapshot = {
    attributes: listAttributes(),
    controls: listControls(),
    tabs: listTabs(),
    dirty: isFormDirty(),
    dirtyCount: getDirtyAttributes().length,
    formType: getFormType(),
    version: v,
  };
  return cachedSnapshot;
}

/** Subscribe a React component to form-store mutations. */
function useFormSnapshot(): FormSnapshot {
  return useSyncExternalStore(subscribeFormState, getSnapshot, getSnapshot);
}

const REQUIRED_LEVELS: RequiredLevel[] = ['none', 'recommended', 'required'];

const FORM_TYPE_LABEL: Record<number, string> = {
  0: 'Undefined',
  1: 'Create',
  2: 'Update',
  3: 'ReadOnly',
  4: 'Disabled',
  6: 'BulkEdit',
  11: 'ReadOptimized',
};

/**
 * FormPanel — operator UI for poking the formContext store. Lets the developer
 * edit attribute values, fire onChange handlers, toggle control visibility/
 * disabled state, raise notifications, and toggle tabs without writing JS.
 *
 * Stable data-test-id attributes (`fp-attr-<name>`, `fp-ctrl-<name>`,
 * `fp-tab-<name>`) make the panel scriptable from the Playwright MCP.
 */
export function FormPanel(): JSX.Element {
  const styles = useStyles();
  const snap = useFormSnapshot();
  const [editing, setEditing] = useState<Record<string, string>>({});

  // Re-seed local edit buffer when the underlying store changes
  useEffect(() => {
    setEditing(prev => {
      const next: Record<string, string> = {};
      for (const a of snap.attributes) {
        next[a.name] = prev[a.name] ?? (a.value == null ? '' : String(a.value));
      }
      return next;
    });
  }, [snap.version]);

  return (
    <div className={styles.root} data-test-id="form-panel">
      <div className={styles.section}>
        <div
          className={styles.sectionTitle}
          title="Form-level state the host would expose at runtime — what type of form the user opened (Create / Update / ReadOnly / Disabled / BulkEdit / ReadOptimized) and whether unsaved changes exist. Controls can read this via formContext.ui.getFormType() and formContext.data.getIsDirty()."
        >
          Form metadata
        </div>
        <div className={styles.toolbar}>
          <span title="formContext.ui.getFormType() — the lifecycle stage the form is in. Create = brand-new record, Update = editing an existing record, ReadOnly = view-only, Disabled = all fields locked, BulkEdit = editing multiple records, ReadOptimized = high-performance read view.">
            <Badge appearance="outline" data-test-id="fp-form-type">
              FormType: {FORM_TYPE_LABEL[snap.formType] ?? snap.formType}
            </Badge>
          </span>
          <span title="formContext.data.getIsDirty() — true if any attribute value has been changed in the harness since the last seed/save. The count shows how many attributes are currently dirty. Use the 'fire' button on an attribute row to push edits through onChange handlers.">
            <Badge
              appearance={snap.dirty ? 'filled' : 'outline'}
              color={snap.dirty ? 'warning' : undefined}
              data-test-id="fp-form-dirty"
            >
              {snap.dirty ? `Dirty (${snap.dirtyCount})` : 'Clean'}
            </Badge>
          </span>
        </div>
      </div>

      <Divider />

      <div className={styles.section}>
        <div
          className={styles.sectionTitle}
          title="Attributes — the data fields on the form's record. Each attribute is the underlying column value (formContext.getAttribute(name).getValue()) that controls read from and write to. Edits here fire onChange handlers attached to that attribute, just like typing into a real form field."
        >
          Attributes ({snap.attributes.length})
        </div>
        {snap.attributes.length === 0 && (
          <div className={styles.emptyMsg}>
            No attributes seeded. Add records to <code>data.json</code> or bound
            properties to the manifest.
          </div>
        )}
        {snap.attributes.map(a => (
          <div
            key={a.name}
            className={`${styles.row} ${a.isDirty ? styles.rowDirty : ''}`}
            data-test-id={`fp-attr-${a.name}`}
          >
            <div className={styles.attrCell}>
              <div
                className={styles.attrName}
                title={`Attribute logical name: ${a.name}. This is the column on the entity record that the control binds to. Edit the value in the next field; click 'fire' to push the change through any registered onChange handlers.`}
              >
                {a.name}
              </div>
              <div
                className={styles.attrType}
                title={`Attribute type — controls what kind of value the field accepts. Examples: string, integer, decimal, money, boolean, datetime, optionset, lookup. Editing the value box will coerce input to this type.`}
              >
                {a.attributeType}
              </div>
            </div>
            <Input
              size="small"
              value={editing[a.name] ?? ''}
              onChange={(_, d) => setEditing(prev => ({ ...prev, [a.name]: d.value }))}
              onBlur={() => {
                const raw = editing[a.name] ?? '';
                let parsed: any = raw;
                if (a.attributeType === 'integer' || a.attributeType === 'decimal' || a.attributeType === 'money') {
                  const n = Number(raw);
                  parsed = Number.isFinite(n) ? n : null;
                } else if (a.attributeType === 'boolean') {
                  parsed = raw === 'true' || raw === '1';
                } else if (raw === '') {
                  parsed = null;
                }
                setAttributeValue(a.name, parsed);
              }}
              data-test-id={`fp-attr-${a.name}-input`}
              className={styles.attrInput}
              title="Attribute value — calls formContext.getAttribute(name).setValue(...) on blur. Empty string is treated as null. Booleans accept true/false/1/0. Numbers are parsed; non-numeric input becomes null."
            />
            <Dropdown
              size="small"
              value={a.requiredLevel}
              selectedOptions={[a.requiredLevel]}
              onOptionSelect={(_, d) => {
                if (d.optionValue) setAttributeRequiredLevel(a.name, d.optionValue as RequiredLevel);
              }}
              className={styles.attrRequired}
              data-test-id={`fp-attr-${a.name}-required`}
              title="Required level — none / recommended / required. Equivalent to formContext.getAttribute(name).setRequiredLevel(...). Tests how the control behaves when the field is marked mandatory."
            >
              {REQUIRED_LEVELS.map(l => <Option key={l} value={l}>{l}</Option>)}
            </Dropdown>
            <Button
              size="small"
              appearance="subtle"
              onClick={() => fireOnChange(a.name)}
              data-test-id={`fp-attr-${a.name}-fire`}
              className={styles.attrFire}
              title="Fire onChange handlers — manually triggers every callback registered with formContext.getAttribute(name).addOnChange(). Useful for testing handler logic without re-typing the value."
            >
              fire
            </Button>
          </div>
        ))}
      </div>

      <Divider />

      <div className={styles.section}>
        <div
          className={styles.sectionTitle}
          title="Controls — the UI widgets bound to attributes. The same attribute can have multiple controls (e.g. a quick-view form). Controls expose visibility, disabled state, and notification banners that the bound control can react to or trigger."
        >
          Controls ({snap.controls.length})
        </div>
        {snap.controls.map(c => (
          <div key={c.name} className={styles.controlRow} data-test-id={`fp-ctrl-${c.name}`}>
            <span
              className={mergeClasses(styles.attrName, styles.controlName)}
              title={`Control name: ${c.name}. The control element on the form (formContext.getControl(name)). Toggle visibility/disabled to test how your PCF reacts to host-driven state changes.`}
            >
              {c.name}
            </span>
            <Switch
              size="small"
              checked={c.visible}
              onChange={(_, d) => setControlVisible(c.name, d.checked)}
              label="visible"
              data-test-id={`fp-ctrl-${c.name}-visible`}
              title="Visibility — calls formContext.getControl(name).setVisible(...). Off hides the control's container. Tests how a PCF behaves when the host shows/hides its host element."
            />
            <Switch
              size="small"
              checked={c.disabled}
              onChange={(_, d) => setControlDisabled(c.name, d.checked)}
              label="disabled"
              data-test-id={`fp-ctrl-${c.name}-disabled`}
              title="Disabled — calls formContext.getControl(name).setDisabled(...). Disabled controls receive disabled=true via context. Tests read-only rendering."
            />
            <Button
              size="small"
              appearance="subtle"
              onClick={() => {
                if (c.notifications.size > 0) {
                  clearControlNotification(c.name);
                } else {
                  setControlNotification(c.name, {
                    notificationLevel: 'ERROR',
                    uniqueId: `fp-${c.name}`,
                    messages: [`Test notification on ${c.name}`],
                  });
                }
              }}
              data-test-id={`fp-ctrl-${c.name}-notify`}
              title={c.notifications.size > 0
                ? 'Clear all notifications on this control (formContext.getControl(name).clearNotification(...)).'
                : 'Raise a test ERROR notification on this control (formContext.getControl(name).setNotification(...)). Useful for verifying that the field-level error indicator appears.'}
            >
              {c.notifications.size > 0 ? `clr (${c.notifications.size})` : 'notify'}
            </Button>
          </div>
        ))}
      </div>

      <Divider />

      <div className={styles.section}>
        <div
          className={styles.sectionTitle}
          title="Tabs — the top-level form sections (General, Details, Related, etc.). A real form is organised into tabs containing sections containing controls. Toggle visibility and expand/collapse to test PCFs that change layout based on which tab is active."
        >
          Tabs ({snap.tabs.length})
        </div>
        {snap.tabs.map(t => (
          <div key={t.name} className={styles.tabRow} data-test-id={`fp-tab-${t.name}`}>
            <span
              className={mergeClasses(styles.attrName, styles.tabName)}
              title={`Tab: ${t.label ?? t.name} (${t.name}). Access at formContext.ui.tabs.get(name).`}
            >
              {t.label ?? t.name} <Text size={100}>({t.name})</Text>
            </span>
            <Switch
              size="small"
              checked={t.visible}
              onChange={(_, d) => setTabVisible(t.name, d.checked)}
              label="visible"
              data-test-id={`fp-tab-${t.name}-visible`}
              title="Tab visibility — calls formContext.ui.tabs.get(name).setVisible(...). Hidden tabs disappear from the chrome strip."
            />
            <Button
              size="small"
              appearance="subtle"
              onClick={() => setTabDisplayState(t.name, t.displayState === 'expanded' ? 'collapsed' : 'expanded')}
              data-test-id={`fp-tab-${t.name}-toggle`}
              title="Display state — expanded shows the tab's sections, collapsed hides them. Equivalent to formContext.ui.tabs.get(name).setDisplayState('expanded'|'collapsed')."
            >
              {t.displayState}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
