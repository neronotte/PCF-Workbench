/**
 * ScenarioHeader — promotes scenarios from "tab 4" to the persistent
 * workspace context at the top of the side panel.
 *
 *   [Scenario: <Dropdown ▼>•]  [+ New]  [📋 Copy]  [✏️]  [✨]  [💾]  [🗑]
 *
 * Scenario semantics (browser-tab pattern):
 *   - There is ALWAYS at least one scenario (no zero state). On first open of
 *     a control, either auto-prompt → generate N + a "Test scenario 1" active,
 *     or dismiss → silently create a "Default" scenario from manifest defaults
 *     and activate it.
 *   - Switching scenarios with unsaved changes pops the dirty-switch dialog
 *     (Discard / Save & Switch / Cancel).
 *   - `+ New` resets to manifest defaults and prompts for a name; if currently
 *     dirty, dirty-switch fires first.
 *   - `Generate` appends `Test scenario {nextIndex .. nextIndex+N-1}` so
 *     repeated clicks keep stepping the counter (1..5, 6..10, ...).
 *   - `Delete` is disabled when only one scenario remains (last-tab pattern).
 *
 * Single dialog state machine prevents Fluent v9 focus-trap conflicts that
 * arise if two `<Dialog>`s mount simultaneously.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  makeStyles, mergeClasses, tokens,
  Button, Dropdown, Option, Input, SpinButton, MessageBar, MessageBarBody,
  Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions,
  Tooltip, Checkbox,
} from '@fluentui/react-components';
import {
  Add20Regular, Copy20Regular, Rename20Regular, Wand24Regular,
  Save20Regular, Delete20Regular, Beaker24Regular, ArrowReset20Regular,
} from '@fluentui/react-icons';
import { useHarnessStore } from '../../store/harness-store';
import {
  type TestScenario,
  loadAllScenarios,
  loadScenariosFromStorage,
  saveScenariosToStorage,
  loadActiveScenarioName,
  applyScenarioAsActive,
  resetScenarioDefaults,
  buildDefaultScenario,
  captureScenarioFromStore,
  upsertScenario,
  renameScenario,
  deleteScenario,
  findUniqueCopyName,
  nextTestScenarioNames,
  findScenarioByName,
  isAutoGenPromptSuppressed,
  setAutoGenPromptSuppressed,
} from '../../lib/scenario-store';
import { generateScenarios as generateScenariosFromManifest } from '../../lib/scenario-heuristic';
import { getMockEntityDataSnapshot } from '../../store/data-store';

type DialogMode =
  | 'none'
  | 'auto-generate'
  | 'new-name'
  | 'copy-name'
  | 'rename'
  | 'generate-count'
  | 'dirty-switch'
  | 'discard-confirm'
  | 'delete-confirm';

const DEFAULT_GENERATE_COUNT = 5;
const MIN_GENERATE_COUNT = 1;
const MAX_GENERATE_COUNT = 20;

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    flexShrink: 0,
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  pickerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  pickerWrap: {
    position: 'relative',
    flex: 1,
    minWidth: 0,
  },
  dirtyDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: tokens.colorPaletteRedForeground1,
    flexShrink: 0,
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexWrap: 'wrap',
  },
  spacer: { flex: 1 },
  dialogForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  emptyPill: {
    fontSize: '10px',
    padding: '2px 8px',
    borderRadius: '999px',
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
  },
  pillRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  countRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: tokens.fontSizeBase200,
  },
});

interface ScenarioHeaderProps {
  controlId: string;
}

export function ScenarioHeader({ controlId }: ScenarioHeaderProps) {
  const styles = useStyles();

  const manifest = useHarnessStore(s => s.manifest);
  const activeScenarioName = useHarnessStore(s => s.activeScenarioName);
  const isDirty = useHarnessStore(s => s.isDirty);
  const addLogEntry = useHarnessStore(s => s.addLogEntry);

  const [scenarios, setScenarios] = useState<TestScenario[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>('none');
  const [pendingName, setPendingName] = useState('');
  const [generateCount, setGenerateCount] = useState(DEFAULT_GENERATE_COUNT);
  const [pendingSwitchTo, setPendingSwitchTo] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; intent: 'success' | 'error' } | null>(null);
  const [suppressAutoGenPrompt, setSuppressAutoGenPrompt] = useState(false);

  // Per-control gate so we run first-load logic exactly once per control swap.
  const firstLoadDoneFor = useRef<string | null>(null);

  // -------------------------------------------------------------------------
  // First-load: hydrate scenario list + ensure at least one scenario exists.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!manifest) return;
    if (firstLoadDoneFor.current === controlId) return;
    firstLoadDoneFor.current = controlId;
    setLoaded(false);

    (async () => {
      const list = await loadAllScenarios(controlId);
      setScenarios(list);
      saveScenariosToStorage(controlId, list);

      const persistedActive = loadActiveScenarioName(controlId);
      const persistedHit = persistedActive ? list.find(s => s.name === persistedActive) : null;

      if (persistedHit) {
        // Resume where the user left off.
        applyScenarioAsActive(controlId, persistedHit);
      } else if (list.length > 0) {
        // Have scenarios but no remembered active → activate the first.
        applyScenarioAsActive(controlId, list[0]);
      } else if (isAutoGenPromptSuppressed(controlId)) {
        // User (or Playwright/CI) opted out — silently create the Default
        // scenario without ever showing the prompt.
        const def = buildDefaultScenario(manifest, 'Default');
        saveScenariosToStorage(controlId, [def]);
        setScenarios([def]);
        applyScenarioAsActive(controlId, def);
      } else {
        // Zero scenarios → ask the user if they want auto-generation.
        setSuppressAutoGenPrompt(false);
        setDialogMode('auto-generate');
      }
      setLoaded(true);
    })();
  }, [controlId, manifest]);

  // Reset per-control gate when controlId actually changes.
  useEffect(() => {
    return () => {
      // No-op cleanup. Ref is intentionally kept across renders.
    };
  }, []);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const flash = useCallback((text: string, intent: 'success' | 'error' = 'success') => {
    setMessage({ text, intent });
    window.setTimeout(() => setMessage(null), 2500);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogMode('none');
    setPendingName('');
    setPendingSwitchTo(null);
  }, []);

  const persistList = useCallback((next: TestScenario[]) => {
    setScenarios(next);
    saveScenariosToStorage(controlId, next);
  }, [controlId]);

  /** Replace the current scenario on disk with whatever the store holds now. */
  const captureAndUpsertActive = useCallback((): TestScenario | null => {
    if (!activeScenarioName) return null;
    const snap = captureScenarioFromStore(activeScenarioName);
    persistList(upsertScenario(scenarios, snap));
    useHarnessStore.getState().clearDirty();
    return snap;
  }, [activeScenarioName, scenarios, persistList]);

  // -------------------------------------------------------------------------
  // Auto-generate (first-load) — Yes path
  // -------------------------------------------------------------------------
  const runAutoGenerate = useCallback((count: number) => {
    if (!manifest) return;
    setAutoGenPromptSuppressed(controlId, suppressAutoGenPrompt);
    // Sequential "Test scenario N" naming (user requirement) — override the
    // heuristic's `Populated` / toggle names.
    const pageTypeName = useHarnessStore.getState().pageEntityTypeName;
    const generated = generateScenariosFromManifest(manifest.properties, manifest.dataSets, {
      count,
      dataRecords: getMockEntityDataSnapshot(),
      pageEntityHint: { typeName: pageTypeName },
    });
    const names = nextTestScenarioNames([], generated.length);
    const renamed: TestScenario[] = generated.map((g, i) => ({
      ...(g as unknown as TestScenario),
      name: names[i],
      schemaVersion: 2 as const,
    }));
    persistList(renamed);
    if (renamed.length > 0) {
      applyScenarioAsActive(controlId, renamed[0]);
      flash(`Generated ${renamed.length} scenario(s)`);
      addLogEntry({ category: 'scenario', method: 'generate', args: { count: renamed.length } });
    }
    closeDialog();
  }, [manifest, controlId, persistList, flash, addLogEntry, closeDialog, suppressAutoGenPrompt]);

  // -------------------------------------------------------------------------
  // Auto-generate (first-load) — No path: silently create "Default"
  // -------------------------------------------------------------------------
  const declineAutoGenerate = useCallback(() => {
    if (!manifest) return;
    setAutoGenPromptSuppressed(controlId, suppressAutoGenPrompt);
    const def = buildDefaultScenario(manifest, 'Default');
    persistList([def]);
    applyScenarioAsActive(controlId, def);
    closeDialog();
  }, [manifest, controlId, persistList, closeDialog, suppressAutoGenPrompt]);

  // -------------------------------------------------------------------------
  // Generate more (from header ✨ action)
  // -------------------------------------------------------------------------
  const runGenerateMore = useCallback((count: number) => {
    if (!manifest) return;
    const pageTypeName = useHarnessStore.getState().pageEntityTypeName;
    const generated = generateScenariosFromManifest(manifest.properties, manifest.dataSets, {
      count,
      dataRecords: getMockEntityDataSnapshot(),
      pageEntityHint: { typeName: pageTypeName },
    });
    const names = nextTestScenarioNames(scenarios, generated.length);
    const renamed: TestScenario[] = generated.map((g, i) => ({
      ...(g as unknown as TestScenario),
      name: names[i],
      schemaVersion: 2 as const,
    }));
    persistList([...scenarios, ...renamed]);
    flash(`Generated ${renamed.length} more scenario(s)`);
    addLogEntry({ category: 'scenario', method: 'generate', args: { count: renamed.length } });
    closeDialog();
  }, [manifest, scenarios, persistList, flash, addLogEntry, closeDialog]);

  // -------------------------------------------------------------------------
  // Switch
  // -------------------------------------------------------------------------
  const performSwitch = useCallback((name: string) => {
    const target = scenarios.find(s => s.name === name);
    if (!target) return;
    applyScenarioAsActive(controlId, target);
    flash(`Loaded "${name}"`);
    addLogEntry({ category: 'scenario', method: 'switch', args: { name } });
  }, [scenarios, controlId, flash, addLogEntry]);

  const onSwitchRequest = useCallback((name: string) => {
    if (name === activeScenarioName) return;
    if (isDirty) {
      setPendingSwitchTo(name);
      setDialogMode('dirty-switch');
      return;
    }
    performSwitch(name);
  }, [activeScenarioName, isDirty, performSwitch]);

  // -------------------------------------------------------------------------
  // + New
  // -------------------------------------------------------------------------
  const openNewDialog = useCallback(() => {
    // Default-suggest the next Test-scenario name; user can override.
    setPendingName(nextTestScenarioNames(scenarios, 1)[0]);
    setDialogMode('new-name');
  }, [scenarios]);

  const confirmNew = useCallback(() => {
    if (!manifest) return;
    const name = pendingName.trim() || nextTestScenarioNames(scenarios, 1)[0];
    if (scenarios.some(s => s.name === name)) {
      flash(`"${name}" already exists`, 'error');
      return;
    }
    const fresh = resetScenarioDefaults(controlId, manifest, name);
    persistList(upsertScenario(scenarios, fresh));
    flash(`Created "${name}"`);
    addLogEntry({ category: 'scenario', method: 'new', args: { name } });
    closeDialog();
  }, [pendingName, scenarios, manifest, controlId, persistList, flash, addLogEntry, closeDialog]);

  const onNewClick = useCallback(() => {
    if (isDirty) {
      setPendingSwitchTo('__new__');
      setDialogMode('dirty-switch');
    } else {
      openNewDialog();
    }
  }, [isDirty, openNewDialog]);

  // -------------------------------------------------------------------------
  // Copy
  // -------------------------------------------------------------------------
  const openCopyDialog = useCallback(() => {
    if (!activeScenarioName) return;
    setPendingName(findUniqueCopyName(scenarios, activeScenarioName));
    setDialogMode('copy-name');
  }, [activeScenarioName, scenarios]);

  const confirmCopy = useCallback(() => {
    const name = pendingName.trim();
    if (!name) { flash('Name required', 'error'); return; }
    if (scenarios.some(s => s.name === name)) {
      flash(`"${name}" already exists`, 'error');
      return;
    }
    // Snapshot current store state under the new name so the user copies
    // whatever they're looking at (dirty edits included).
    const snap = captureScenarioFromStore(name);
    const next = upsertScenario(scenarios, snap);
    persistList(next);
    applyScenarioAsActive(controlId, snap);
    flash(`Copied to "${name}"`);
    addLogEntry({ category: 'scenario', method: 'copy', args: { name } });
    closeDialog();
  }, [pendingName, scenarios, controlId, persistList, flash, addLogEntry, closeDialog]);

  // -------------------------------------------------------------------------
  // Rename
  // -------------------------------------------------------------------------
  const openRenameDialog = useCallback(() => {
    if (!activeScenarioName) return;
    setPendingName(activeScenarioName);
    setDialogMode('rename');
  }, [activeScenarioName]);

  const confirmRename = useCallback(() => {
    if (!activeScenarioName) return;
    const next = pendingName.trim();
    if (!next) { flash('Name required', 'error'); return; }
    if (next === activeScenarioName) { closeDialog(); return; }
    try {
      const updated = renameScenario(scenarios, activeScenarioName, next);
      persistList(updated);
      useHarnessStore.getState().setActiveScenarioName(next);
      flash(`Renamed to "${next}"`);
      addLogEntry({ category: 'scenario', method: 'rename', args: { from: activeScenarioName, to: next } });
      closeDialog();
    } catch (e: any) {
      flash(e.message ?? 'Rename failed', 'error');
    }
  }, [pendingName, activeScenarioName, scenarios, persistList, flash, addLogEntry, closeDialog]);

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------
  const onSaveClick = useCallback(() => {
    if (!activeScenarioName) return;
    const snap = captureAndUpsertActive();
    if (snap) {
      flash(`Saved "${snap.name}"`);
      addLogEntry({ category: 'scenario', method: 'save', args: { name: snap.name } });
    }
  }, [activeScenarioName, captureAndUpsertActive, flash, addLogEntry]);

  // -------------------------------------------------------------------------
  // Discard / Restore — reload the saved scenario, wiping uncommitted edits
  // -------------------------------------------------------------------------
  const openDiscardConfirm = useCallback(() => setDialogMode('discard-confirm'), []);

  const confirmDiscard = useCallback(() => {
    if (!activeScenarioName) { closeDialog(); return; }
    const saved = scenarios.find(s => s.name === activeScenarioName);
    if (!saved) { closeDialog(); return; }
    applyScenarioAsActive(controlId, saved);
    flash(`Restored "${saved.name}" — unsaved edits discarded`);
    addLogEntry({ category: 'scenario', method: 'discard', args: { name: saved.name } });
    closeDialog();
  }, [activeScenarioName, scenarios, controlId, flash, addLogEntry, closeDialog]);

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------
  const openDeleteConfirm = useCallback(() => setDialogMode('delete-confirm'), []);

  const confirmDelete = useCallback(() => {
    if (!activeScenarioName) return;
    if (scenarios.length <= 1) { closeDialog(); return; }
    const next = deleteScenario(scenarios, activeScenarioName);
    persistList(next);
    if (next.length > 0) {
      applyScenarioAsActive(controlId, next[0]);
    }
    flash(`Deleted "${activeScenarioName}"`);
    addLogEntry({ category: 'scenario', method: 'delete', args: { name: activeScenarioName } });
    closeDialog();
  }, [activeScenarioName, scenarios, controlId, persistList, flash, addLogEntry, closeDialog]);

  // -------------------------------------------------------------------------
  // Dirty-switch resolution
  // -------------------------------------------------------------------------
  const resolvePendingSwitch = useCallback((discardOrSave: 'discard' | 'save') => {
    if (discardOrSave === 'save') {
      const snap = captureAndUpsertActive();
      if (snap) addLogEntry({ category: 'scenario', method: 'save', args: { name: snap.name } });
    } else {
      useHarnessStore.getState().clearDirty();
    }
    const target = pendingSwitchTo;
    closeDialog();
    if (target === '__new__') {
      openNewDialog();
    } else if (target) {
      performSwitch(target);
    }
  }, [captureAndUpsertActive, pendingSwitchTo, performSwitch, openNewDialog, closeDialog, addLogEntry]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const dropdownValue = activeScenarioName ?? '';
  const dropdownText = activeScenarioName
    ? (isDirty ? `${activeScenarioName} •` : activeScenarioName)
    : (loaded ? 'No scenario' : 'Loading…');

  const deleteDisabled = scenarios.length <= 1;

  return (
    <div className={styles.root}>
      <div className={styles.title}>
        <Beaker24Regular style={{ fontSize: 14 }} />
        <span>Test scenario</span>
        {isDirty && (
          <Tooltip content="Unsaved changes — click 💾 to save into the active scenario" relationship="label">
            <span className={styles.dirtyDot} aria-label="unsaved changes" />
          </Tooltip>
        )}
      </div>

      <div className={styles.pickerRow}>
        <div className={styles.pickerWrap}>
          <Dropdown
            size="small"
            value={dropdownText}
            selectedOptions={activeScenarioName ? [activeScenarioName] : []}
            onOptionSelect={(_, d) => d.optionValue && onSwitchRequest(d.optionValue)}
            disabled={!loaded || scenarios.length === 0}
            placeholder="No scenario"
            style={{ width: '100%' }}
          >
            {scenarios.map(s => (
              <Option key={s.name} value={s.name} text={s.name}>{s.name}</Option>
            ))}
          </Dropdown>
        </div>
      </div>

      <div className={styles.actionsRow}>
        <Tooltip content="New scenario from manifest defaults" relationship="label">
          <Button size="small" appearance="subtle" icon={<Add20Regular />} onClick={onNewClick} disabled={!manifest}>New</Button>
        </Tooltip>
        <Tooltip content="Copy current scenario" relationship="label">
          <span><Button size="small" appearance="subtle" icon={<Copy20Regular />} onClick={openCopyDialog} disabled={!activeScenarioName} aria-label="Copy" /></span>
        </Tooltip>
        <Tooltip content="Rename current scenario" relationship="label">
          <span><Button size="small" appearance="subtle" icon={<Rename20Regular />} onClick={openRenameDialog} disabled={!activeScenarioName} aria-label="Rename" /></span>
        </Tooltip>
        <Tooltip content="Generate up to N more scenarios from the heuristic" relationship="label">
          <span><Button size="small" appearance="subtle" icon={<Wand24Regular />} onClick={() => setDialogMode('generate-count')} disabled={!manifest} aria-label="Generate" /></span>
        </Tooltip>
        <div className={styles.spacer} />
        <Tooltip content={isDirty ? 'Save edits into the active scenario' : 'Re-save the active scenario (no unsaved edits detected)'} relationship="label">
          <span><Button size="small" appearance={isDirty ? 'primary' : 'subtle'} icon={<Save20Regular />} onClick={onSaveClick} disabled={!activeScenarioName} aria-label="Save" /></span>
        </Tooltip>
        <Tooltip content={isDirty ? 'Discard unsaved edits and restore the saved scenario' : 'No unsaved edits to discard'} relationship="label">
          <span><Button size="small" appearance="subtle" icon={<ArrowReset20Regular />} onClick={openDiscardConfirm} disabled={!isDirty || !activeScenarioName} aria-label="Discard changes" /></span>
        </Tooltip>
        <Tooltip content={deleteDisabled ? "Can't delete the only scenario — rename or modify it instead" : 'Delete current scenario'} relationship="label">
          <span><Button size="small" appearance="subtle" icon={<Delete20Regular />} onClick={openDeleteConfirm} disabled={deleteDisabled || !activeScenarioName} aria-label="Delete" /></span>
        </Tooltip>
      </div>

      {message && (
        <MessageBar intent={message.intent}>
          <MessageBarBody>{message.text}</MessageBarBody>
        </MessageBar>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Single dialog state machine — only one Dialog mounts at a time.    */}
      {/* ----------------------------------------------------------------- */}

      {/* Auto-generate on first load */}
      <Dialog open={dialogMode === 'auto-generate'} modalType="alert" onOpenChange={(_, d) => { if (!d.open) declineAutoGenerate(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Wand24Regular style={{ color: tokens.colorBrandForeground1 }} />
                Generate starter scenarios?
              </span>
            </DialogTitle>
            <DialogContent className={styles.dialogForm}>
              <div>
                This control has no test scenarios yet. We can generate a
                populated baseline plus single-prop variations across the most
                interesting properties — visual-mode toggles, boolean flips,
                numeric knobs.
              </div>
              <div className={styles.pillRow}>
                <span className={styles.emptyPill}>Populated</span>
                <span className={styles.emptyPill}>+ visual-mode toggles</span>
                <span className={styles.emptyPill}>+ boolean flips</span>
                <span className={styles.emptyPill}>+ numeric knobs</span>
              </div>
              <div className={styles.countRow}>
                <span>How many (max)?</span>
                <SpinButton
                  size="small"
                  value={generateCount}
                  min={MIN_GENERATE_COUNT}
                  max={MAX_GENERATE_COUNT}
                  onChange={(_, d) => {
                    if (typeof d.value === 'number') {
                      setGenerateCount(Math.max(MIN_GENERATE_COUNT, Math.min(MAX_GENERATE_COUNT, d.value)));
                    }
                  }}
                  style={{ width: 80 }}
                />
                <span style={{ fontSize: 11, color: tokens.colorNeutralForeground3 }}>(1–20)</span>
              </div>
              <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3 }}>
                We'll generate <strong>up to {generateCount}</strong> scenarios — fewer if the
                manifest doesn't have enough interesting properties to vary.
                Choosing <strong>No</strong> creates a single <em>Default</em>
                {' '}scenario from manifest defaults.
              </div>
              <Checkbox
                label="Don't show this again for this control"
                checked={suppressAutoGenPrompt}
                onChange={(_, d) => setSuppressAutoGenPrompt(!!d.checked)}
              />
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={declineAutoGenerate}>No thanks</Button>
              <Button appearance="primary" icon={<Wand24Regular />} onClick={() => runAutoGenerate(generateCount)}>
                Generate up to {generateCount}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Generate more (from header ✨) */}
      <Dialog open={dialogMode === 'generate-count'} modalType="modal" onOpenChange={(_, d) => { if (!d.open) closeDialog(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Generate more scenarios</DialogTitle>
            <DialogContent className={styles.dialogForm}>
              <div className={styles.countRow}>
                <span>How many (max)?</span>
                <SpinButton
                  size="small"
                  value={generateCount}
                  min={MIN_GENERATE_COUNT}
                  max={MAX_GENERATE_COUNT}
                  onChange={(_, d) => {
                    if (typeof d.value === 'number') {
                      setGenerateCount(Math.max(MIN_GENERATE_COUNT, Math.min(MAX_GENERATE_COUNT, d.value)));
                    }
                  }}
                  style={{ width: 80 }}
                />
                <span style={{ fontSize: 11, color: tokens.colorNeutralForeground3 }}>(1–20)</span>
              </div>
              <div style={{ fontSize: 11, color: tokens.colorNeutralForeground3 }}>
                We'll append <strong>up to {generateCount}</strong> as
                {' '}<code>Test scenario N</code>, continuing your numbering.
                Fewer are emitted if the manifest doesn't have enough
                interesting properties to vary.
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={closeDialog}>Cancel</Button>
              <Button appearance="primary" icon={<Wand24Regular />} onClick={() => runGenerateMore(generateCount)}>
                Generate up to {generateCount}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* New name */}
      <Dialog open={dialogMode === 'new-name'} modalType="modal" onOpenChange={(_, d) => { if (!d.open) closeDialog(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>New scenario</DialogTitle>
            <DialogContent className={styles.dialogForm}>
              <div>Reset to manifest defaults and save as:</div>
              <Input
                size="small"
                value={pendingName}
                onChange={(_, d) => setPendingName(d.value)}
                onKeyDown={e => e.key === 'Enter' && confirmNew()}
                autoFocus
              />
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={closeDialog}>Cancel</Button>
              <Button appearance="primary" onClick={confirmNew}>Create</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Copy name */}
      <Dialog open={dialogMode === 'copy-name'} modalType="modal" onOpenChange={(_, d) => { if (!d.open) closeDialog(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Copy scenario</DialogTitle>
            <DialogContent className={styles.dialogForm}>
              <div>Copy current scenario state as:</div>
              <Input
                size="small"
                value={pendingName}
                onChange={(_, d) => setPendingName(d.value)}
                onKeyDown={e => e.key === 'Enter' && confirmCopy()}
                autoFocus
              />
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={closeDialog}>Cancel</Button>
              <Button appearance="primary" onClick={confirmCopy}>Copy</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Rename */}
      <Dialog open={dialogMode === 'rename'} modalType="modal" onOpenChange={(_, d) => { if (!d.open) closeDialog(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Rename scenario</DialogTitle>
            <DialogContent className={styles.dialogForm}>
              <Input
                size="small"
                value={pendingName}
                onChange={(_, d) => setPendingName(d.value)}
                onKeyDown={e => e.key === 'Enter' && confirmRename()}
                autoFocus
              />
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={closeDialog}>Cancel</Button>
              <Button appearance="primary" onClick={confirmRename}>Rename</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Dirty-switch */}
      <Dialog open={dialogMode === 'dirty-switch'} modalType="alert" onOpenChange={(_, d) => { if (!d.open) closeDialog(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Unsaved changes in "{activeScenarioName}"</DialogTitle>
            <DialogContent>
              You've modified <strong>{activeScenarioName}</strong> since the last save.
              Save your edits, or discard and switch?
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={closeDialog}>Cancel</Button>
              <Button onClick={() => resolvePendingSwitch('discard')}>Discard</Button>
              <Button appearance="primary" onClick={() => resolvePendingSwitch('save')}>Save &amp; switch</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Discard / Restore confirm */}
      <Dialog open={dialogMode === 'discard-confirm'} modalType="alert" onOpenChange={(_, d) => { if (!d.open) closeDialog(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogContent>
              This restores <strong>{activeScenarioName}</strong> from its last saved state. Any uncommitted edits to property values, page context, network, device, data, or user settings will be lost.
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={closeDialog}>Cancel</Button>
              <Button appearance="primary" icon={<ArrowReset20Regular />} onClick={confirmDiscard}>Discard &amp; restore</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={dialogMode === 'delete-confirm'} modalType="alert" onOpenChange={(_, d) => { if (!d.open) closeDialog(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete "{activeScenarioName}"?</DialogTitle>
            <DialogContent>
              This removes the scenario from this control's saved list. You can't undo this.
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={closeDialog}>Cancel</Button>
              <Button appearance="primary" icon={<Delete20Regular />} onClick={confirmDelete}>Delete</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
