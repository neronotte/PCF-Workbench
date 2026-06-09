import { useEffect, useState, useSyncExternalStore, useCallback, type ReactNode } from 'react';
import {
  makeStyles, mergeClasses, tokens, Input, Switch, Button, Badge, Divider, Text, Dropdown, Option,
} from '@fluentui/react-components';
import { ChevronDown16Regular, ChevronRight16Regular } from '@fluentui/react-icons';
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
  // h10/UX — collapsible section header. Clickable row with chevron + title.
  // Persists open/closed state per-section to localStorage so the user's
  // last layout survives reload.
  collapsibleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    userSelect: 'none' as const,
    padding: '2px 0',
    borderRadius: tokens.borderRadiusSmall,
    ':hover': { backgroundColor: tokens.colorNeutralBackground2 },
  },
  collapsibleChevron: {
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
    width: '16px',
    height: '16px',
  },
  collapsibleBody: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
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

const COLLAPSE_STORAGE_KEY = 'pcf-workbench:form-panel:collapsed';

function readCollapsedMap(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, boolean> : {};
  } catch { return {}; }
}

function writeCollapsedMap(map: Record<string, boolean>): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

interface CollapsibleSectionProps {
  /** Stable id used to persist open/closed state across reloads. */
  id: string;
  title: ReactNode;
  /** Optional tooltip on the header (mirrors what the section title already
   *  had so users get the same explanation when hovering). */
  titleTooltip?: string;
  /** When true, section starts collapsed unless the user has flipped it. */
  defaultCollapsed?: boolean;
  /** Stable test id for the section root. */
  testId?: string;
  children: ReactNode;
}

function CollapsibleSection({ id, title, titleTooltip, defaultCollapsed = false, testId, children }: CollapsibleSectionProps): JSX.Element {
  const styles = useStyles();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const map = readCollapsedMap();
    return id in map ? map[id] : defaultCollapsed;
  });
  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      const map = readCollapsedMap();
      map[id] = next;
      writeCollapsedMap(map);
      return next;
    });
  }, [id]);
  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }, [toggle]);
  return (
    <div className={styles.section} data-test-id={testId}>
      <div
        className={mergeClasses(styles.sectionTitle, styles.collapsibleHeader)}
        onClick={toggle}
        onKeyDown={onKey}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        title={titleTooltip}
        data-test-id={testId ? `${testId}-header` : undefined}
      >
        {collapsed
          ? <ChevronRight16Regular className={styles.collapsibleChevron} />
          : <ChevronDown16Regular className={styles.collapsibleChevron} />}
        <span>{title}</span>
      </div>
      {!collapsed && (
        <div className={styles.collapsibleBody} data-test-id={testId ? `${testId}-body` : undefined}>
          {children}
        </div>
      )}
    </div>
  );
}

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
      <CollapsibleSection
        id="form"
        title="Form metadata"
        titleTooltip="Use this panel to simulate the surrounding Dynamics 365 form: edit attribute values and fire onChange events, toggle control visibility / disabled state, raise notifications, and show/hide tabs — without needing a real form. Useful for any PCF that reads formContext or Xrm.Page."
        testId="fp-section-form"
      >
        <div className={styles.toolbar}>
          <span title="Form type — what kind of form is open (Create, Update, ReadOnly, Disabled, BulkEdit, etc.)">
            <Badge appearance="outline" data-test-id="fp-form-type">
              FormType: {FORM_TYPE_LABEL[snap.formType] ?? snap.formType}
            </Badge>
          </span>
          <span title="Dirty — how many attribute values have changed since the last seed or save">
            <Badge
              appearance={snap.dirty ? 'filled' : 'outline'}
              color={snap.dirty ? 'warning' : undefined}
              data-test-id="fp-form-dirty"
            >
              {snap.dirty ? `Dirty (${snap.dirtyCount})` : 'Clean'}
            </Badge>
          </span>
        </div>
      </CollapsibleSection>

      <Divider />

      <CollapsibleSection
        id="attributes"
        title={`Attributes (${snap.attributes.length})`}
        titleTooltip="Attributes — the data fields on the form's record. Each attribute is the underlying column value (formContext.getAttribute(name).getValue()) that controls read from and write to. Edits here fire onChange handlers attached to that attribute, just like typing into a real form field."
        defaultCollapsed={true}
        testId="fp-section-attributes"
      >
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
                title={`${a.name} — column name on the entity record; edit the value and click fire to trigger onChange`}
              >
                {a.name}
              </div>
              <div
                className={styles.attrType}
                title={`Attribute type — determines what values are accepted (string, integer, boolean, lookup, etc.)`}
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
              title="Value — edit and tab away to update the attribute; booleans accept true/false, empty = null"
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
              title="Required level — none, recommended, or required; tests mandatory-field behaviour"
            >
              {REQUIRED_LEVELS.map(l => <Option key={l} value={l}>{l}</Option>)}
            </Dropdown>
            <Button
              size="small"
              appearance="subtle"
              onClick={() => fireOnChange(a.name)}
              data-test-id={`fp-attr-${a.name}-fire`}
              className={styles.attrFire}
              title="Fire onChange — trigger all registered onChange callbacks for this attribute"
            >
              fire
            </Button>
          </div>
        ))}
      </CollapsibleSection>

      <Divider />

      <CollapsibleSection
        id="controls"
        title={`Controls (${snap.controls.length})`}
        titleTooltip="Controls — the UI widgets bound to attributes. The same attribute can have multiple controls (e.g. a quick-view form). Controls expose visibility, disabled state, and notification banners that the bound control can react to or trigger."
        defaultCollapsed={true}
        testId="fp-section-controls"
      >
        {snap.controls.map(c => (
          <div key={c.name} className={styles.controlRow} data-test-id={`fp-ctrl-${c.name}`}>
            <span
              className={mergeClasses(styles.attrName, styles.controlName)}
              title={`${c.name} — toggle visibility or disabled state to test how your PCF reacts`}
            >
              {c.name}
            </span>
            <Switch
              size="small"
              checked={c.visible}
              onChange={(_, d) => setControlVisible(c.name, d.checked)}
              label="visible"
              data-test-id={`fp-ctrl-${c.name}-visible`}
              title="Visibility — show or hide this control on the form"
            />
            <Switch
              size="small"
              checked={c.disabled}
              onChange={(_, d) => setControlDisabled(c.name, d.checked)}
              label="disabled"
              data-test-id={`fp-ctrl-${c.name}-disabled`}
              title="Disabled — make this control read-only on the form"
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
      </CollapsibleSection>

      <Divider />

      <CollapsibleSection
        id="tabs"
        title={`Tabs (${snap.tabs.length})`}
        titleTooltip="Tabs — the top-level form sections (General, Details, Related, etc.). A real form is organised into tabs containing sections containing controls. Toggle visibility and expand/collapse to test PCFs that change layout based on which tab is active."
        defaultCollapsed={true}
        testId="fp-section-tabs"
      >
        {snap.tabs.map(t => (
          <div key={t.name} className={styles.tabRow} data-test-id={`fp-tab-${t.name}`}>
            <span
              className={mergeClasses(styles.attrName, styles.tabName)}
              title={`${t.label ?? t.name} — toggle visibility and display state for this tab`}
            >
              {t.label ?? t.name} <Text size={100}>({t.name})</Text>
            </span>
            <Switch
              size="small"
              checked={t.visible}
              onChange={(_, d) => setTabVisible(t.name, d.checked)}
              label="visible"
              data-test-id={`fp-tab-${t.name}-visible`}
              title="Visibility — show or hide this tab on the form"
            />
            <Button
              size="small"
              appearance="subtle"
              onClick={() => setTabDisplayState(t.name, t.displayState === 'expanded' ? 'collapsed' : 'expanded')}
              data-test-id={`fp-tab-${t.name}-toggle`}
              title="Display state — expand or collapse this tab's sections"
            >
              {t.displayState}
            </Button>
          </div>
        ))}
      </CollapsibleSection>
    </div>
  );
}
