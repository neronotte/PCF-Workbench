/**
 * SearchPicker — reusable UCI-style searchable Combobox.
 *
 * Single picker we use anywhere the harness has to surface a list of things
 * fetched from Dataverse (system / personal views, entity tables, record
 * lookups, metadata attributes…). Mirrors the UCI view-selector UX: a
 * search-as-you-type filter, optional grouped sections, optional inline
 * "Default" / status badge, and an optional refresh button when the source
 * list can be re-fetched.
 *
 * Designed to be presentational only — the parent owns the fetched data,
 * loading + error state, and the refresh handler. Keeping it dumb means
 * Live Views, Entity Picker, Record Picker etc. can all share the same UX
 * without inheriting each other's data-fetching plumbing.
 *
 * Why Fluent v9 Combobox, not Dropdown:
 *   - Dropdown has no native filtering, and view lists can run to 30+ items
 *     on Field Service entities (or 500+ for entity pickers).
 *   - Combobox's freeform={false} + clearable={false} mode behaves like a
 *     filterable Dropdown — typing narrows the visible options.
 *
 * Why we cap visible options at `maxVisible`:
 *   - The Combobox listbox slows visibly past ~200 options. For the Entity
 *     picker (~500 tables on a Field Service org) the user has to type
 *     anyway. The "+N more — keep typing to narrow" hint matches the
 *     pattern already in DataPanel's record Combobox.
 */

import { useMemo, useRef, useState, useEffect } from 'react';
import {
  Combobox, Option, OptionGroup, Badge, Button, Tooltip, Spinner, tokens,
  makeStyles,
} from '@fluentui/react-components';
import { ArrowClockwise16Regular } from '@fluentui/react-icons';

export interface SearchPickerItem<T = unknown> {
  /** Stable unique key. Used as the Combobox option value. */
  value: string;
  /** Primary display text. Also the search target. */
  text: string;
  /** Optional muted secondary line (e.g. a GUID, schema name, target entity). */
  secondary?: string;
  /** Optional small inline badge text (e.g. "Default", "Custom"). */
  badge?: string;
  /** Optional group label — items with the same `group` render under one
   *  OptionGroup heading, in input order. Items without `group` render
   *  ungrouped at the top. */
  group?: string;
  /** Original payload handed back on select. */
  raw: T;
}

export interface SearchPickerProps<T = unknown> {
  items: SearchPickerItem<T>[];
  /** value of the currently-active item (renders as the picked option). */
  activeValue?: string | null;
  placeholder?: string;
  loading?: boolean;
  error?: string | null;
  /** Shown when the filtered list is empty (post-search). */
  emptyMessage?: string;
  /** Shown when items is empty AND no loading/error (i.e. nothing fetched yet). */
  unfetchedMessage?: string;
  onSelect: (item: SearchPickerItem<T>) => void;
  /** When provided, renders a refresh icon button next to the combobox. */
  onRefresh?: () => void;
  /** Prefix for data-test-id attributes. Combobox gets `${prefix}-combobox`,
   *  refresh button gets `${prefix}-refresh`. */
  testIdPrefix?: string;
  size?: 'small' | 'medium';
  /** Cap visible options. Default 50 — same as the existing record picker. */
  maxVisible?: number;
  /** Disable the picker (e.g. when prerequisites aren't met). */
  disabled?: boolean;
  /** Notify the parent of search-text changes so server-side filtering can
   *  re-query (e.g. live record search). When provided, the local in-memory
   *  `filtered` view is still applied as a client-side fallback. */
  onSearchChange?: (search: string) => void;
  /** When true, option text wraps to multiple lines instead of ellipsing. Use
   *  for pickers whose item labels are long compound strings (e.g. the
   *  relationship picker: `<child> · <fk> · <schema>`). */
  wrapOptionText?: boolean;
}

const useStyles = makeStyles({
  row: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  combobox: {
    flex: 1,
    minWidth: 0,
  },
  optionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    width: '100%',
  },
  optionText: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  optionTextWrap: {
    flex: 1,
    minWidth: 0,
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    lineHeight: '1.3',
  },
  optionSecondary: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontFamily: 'Consolas, monospace',
    marginLeft: '4px',
  },
  hint: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    padding: '2px 8px',
  },
  error: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorPaletteRedForeground1,
    padding: '2px 8px',
  },
});

export function SearchPicker<T = unknown>({
  items,
  activeValue,
  placeholder = 'Search…',
  loading = false,
  error = null,
  emptyMessage = 'No matches',
  unfetchedMessage,
  onSelect,
  onRefresh,
  testIdPrefix,
  size = 'small',
  maxVisible = 50,
  disabled = false,
  onSearchChange,
  wrapOptionText = false,
}: SearchPickerProps<T>) {
  const styles = useStyles();
  const activeItem = useMemo(
    () => (activeValue ? items.find(i => i.value === activeValue) ?? null : null),
    [items, activeValue],
  );

  // Local search state. Seeded from the active item's text so the combobox
  // shows the current selection by name (not by value). Reset on blur.
  const [search, setSearch] = useState<string>(activeItem?.text ?? '');
  const dirtyRef = useRef(false);
  useEffect(() => {
    // When the active item changes (parent commits a new selection) and the
    // user isn't actively typing, sync the search box to the new label.
    if (!dirtyRef.current) {
      setSearch(activeItem?.text ?? '');
    }
  }, [activeItem]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || q === activeItem?.text.toLowerCase()) return items;
    return items.filter(i =>
      i.text.toLowerCase().includes(q)
      || (i.secondary?.toLowerCase().includes(q) ?? false)
    );
  }, [items, search, activeItem]);

  const overflow = Math.max(0, filtered.length - maxVisible);
  const visible = overflow > 0 ? filtered.slice(0, maxVisible) : filtered;

  // Group visible items in input order. Items without group render first,
  // ungrouped; subsequent groups appear in first-seen order.
  const groupedRender = useMemo(() => {
    const groups = new Map<string, SearchPickerItem<T>[]>();
    const ungrouped: SearchPickerItem<T>[] = [];
    for (const it of visible) {
      if (it.group) {
        const arr = groups.get(it.group) ?? [];
        arr.push(it);
        groups.set(it.group, arr);
      } else {
        ungrouped.push(it);
      }
    }
    return { ungrouped, groups };
  }, [visible]);

  const renderOption = (item: SearchPickerItem<T>) => (
    <Option key={item.value} value={item.value} text={item.text}>
      <span className={styles.optionRow}>
        <span className={wrapOptionText ? styles.optionTextWrap : styles.optionText}>{item.text}</span>
        {item.secondary && <span className={styles.optionSecondary}>{item.secondary}</span>}
        {item.badge && <Badge size="small" appearance="tint" color="brand">{item.badge}</Badge>}
      </span>
    </Option>
  );

  return (
    <div>
      <div className={styles.row}>
        <Combobox
          className={styles.combobox}
          size={size}
          value={search}
          selectedOptions={activeValue ? [activeValue] : []}
          freeform={false}
          clearable={false}
          placeholder={placeholder}
          disabled={disabled || loading}
          onInput={(e) => {
            dirtyRef.current = true;
            const next = (e.target as HTMLInputElement).value;
            setSearch(next);
            onSearchChange?.(next);
          }}
          onOptionSelect={(_, d) => {
            if (!d.optionValue) return;
            const picked = items.find(i => i.value === d.optionValue);
            if (picked) {
              dirtyRef.current = false;
              setSearch(picked.text);
              onSelect(picked);
            }
          }}
          onBlur={() => {
            dirtyRef.current = false;
            setSearch(activeItem?.text ?? '');
          }}
          data-test-id={testIdPrefix ? `${testIdPrefix}-combobox` : undefined}
        >
          {visible.length === 0 && (
            <Option key="__empty__" value="__empty__" text="" disabled>
              {items.length === 0
                ? (unfetchedMessage ?? emptyMessage)
                : emptyMessage}
            </Option>
          )}
          {groupedRender.ungrouped.map(renderOption)}
          {Array.from(groupedRender.groups.entries()).map(([label, list]) => (
            <OptionGroup key={label} label={label}>
              {list.map(renderOption)}
            </OptionGroup>
          ))}
          {overflow > 0 && (
            <Option key="__overflow__" value="__overflow__" text="" disabled>
              +{overflow} more — keep typing to narrow
            </Option>
          )}
        </Combobox>
        {loading && <Spinner size="tiny" />}
        {onRefresh && (
          <Tooltip content="Refresh" relationship="label">
            <Button
              appearance="subtle"
              size={size}
              icon={<ArrowClockwise16Regular />}
              disabled={loading}
              onClick={onRefresh}
              data-test-id={testIdPrefix ? `${testIdPrefix}-refresh` : undefined}
            />
          </Tooltip>
        )}
      </div>
      {error && <div className={styles.error} data-test-id={testIdPrefix ? `${testIdPrefix}-error` : undefined}>{error}</div>}
      {!error && !loading && items.length === 0 && unfetchedMessage && (
        <div className={styles.hint}>{unfetchedMessage}</div>
      )}
    </div>
  );
}
