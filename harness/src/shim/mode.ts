import type { HarnessStore } from '../store/harness-store';

export function createModeShim(getState: () => HarnessStore) {
  return {
    // When the user pins a Custom Size container (containerWidth/Height set),
    // the control should see the container as its allocated space — not the
    // outer viewport. Otherwise the control sizes itself to the viewport
    // (e.g. 1280×720) while the harness clips it at 620×472 and internal
    // scrollers never trigger because the control thinks it has plenty of
    // room. Falls back to viewport dims when no container is pinned (fluid
    // / fill mode), matching real UCI where allocated == form region.
    get allocatedHeight() {
      const s = getState();
      return s.containerHeight ?? s.viewportHeight;
    },
    get allocatedWidth() {
      const s = getState();
      return s.containerWidth ?? s.viewportWidth;
    },
    get isControlDisabled() { return getState().isControlDisabled; },
    get isVisible() { return true; },
    get isAuthoringMode() { return getState().isAuthoringMode; },
    label: '',
    get contextInfo() {
      const s = getState();
      // Synthesise stable form/role identifiers from the page entity so
      // controls that key off contextInfo.formId / roleName see deterministic
      // values across renders.
      const formId = s.pageEntityTypeName
        ? `00000000-0000-0000-0000-${s.pageEntityTypeName.padEnd(12, '0').slice(0, 12)}`
        : '00000000-0000-0000-0000-000000000000';
      return {
        entityId: s.pageEntityId,
        entityTypeName: s.pageEntityTypeName,
        entityRecordName: s.pageEntityRecordName,
        formId,
        roleName: 'Main',
      };
    },
    setControlState(_state: Record<string, any>): boolean {
      getState().addLogEntry({ category: 'mode', method: 'setControlState', args: _state, coverage: 'stub' });
      return true;
    },
    setFullScreen(value: boolean): void {
      const s = getState();
      s.addLogEntry({ category: 'mode', method: 'setFullScreen', args: value, coverage: 'implemented' });
      s.setFullscreen(value);
    },
    trackContainerResize(value: boolean): void {
      getState().addLogEntry({ category: 'mode', method: 'trackContainerResize', args: value, coverage: 'stub' });
    },
  };
}
