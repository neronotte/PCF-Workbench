import type { HarnessStore } from '../store/harness-store';
import { getEntityMetadata as getMetadataEntry } from '../store/metadata-store';
import { resolveEntityMetadata, ensureLiveAttributeMetadata } from '../api/dv-client';
import { pushDialog, type LookupDialogRequest } from './dialog-bus';

export function createUtilsShim(getState: () => HarnessStore) {
  const log = (method: string, args?: any) =>
    getState().addLogEntry({ category: 'utils', method, args, coverage: 'implemented' });

  return {
    async getEntityMetadata(entityName: string, attributes?: string[]): Promise<any> {
      log('getEntityMetadata', { entityName, attributes });

      // Live mode (M2.P5): hydrate from real org before reading the metadata
      // store so display names + attribute types + option-set labels are
      // accurate. ensureLiveAttributeMetadata is idempotent + once-per-entity.
      const state = getState();
      let entitySetName = `${entityName}s`;
      let primaryIdAttribute = `${entityName}id`;
      let primaryNameAttribute = 'name';
      if (state.dataSource === 'live' && state.liveProfile) {
        try {
          const resolved = await resolveEntityMetadata(state.liveProfile.orgUrl, entityName);
          entitySetName = resolved.entitySetName;
          if (resolved.primaryIdAttribute) primaryIdAttribute = resolved.primaryIdAttribute;
          if (resolved.primaryNameAttribute) primaryNameAttribute = resolved.primaryNameAttribute;
        } catch {
          // Fall back to heuristics; resolveEntityMetadata already logged it.
        }
        try {
          await ensureLiveAttributeMetadata(state.liveProfile.orgUrl, entityName);
        } catch {
          // Attribute hydration is best-effort; mock fallback below still
          // yields a usable shape.
        }
      }

      const meta = getMetadataEntry(entityName);
      const allColumns = meta ? Object.entries(meta.columns) : [];
      const filterSet = attributes && attributes.length > 0 ? new Set(attributes) : null;
      const matched = filterSet
        ? allColumns.filter(([logical]) => filterSet.has(logical))
        : allColumns;

      const buildAttribute = (logicalName: string, col?: { displayName: string; type?: string; options?: Array<{ value: number; text: string }> }) => ({
        LogicalName: logicalName,
        DisplayName: col?.displayName ?? logicalName,
        AttributeType: col?.type ?? 'String',
        // M2.P5: surface OptionSet labels for picklist/state/status attributes
        // when present. Real Dataverse returns this nested under
        // `OptionSet.Options[].Label.UserLocalizedLabel.Label`; controls
        // typically just want `{ Value, Label }`. Provide both shapes for
        // compatibility with controls written against either form.
        ...(col?.options && col.options.length > 0
          ? {
              OptionSet: {
                Options: col.options.map(o => ({
                  Value: o.value,
                  Label: { UserLocalizedLabel: { Label: o.text }, LocalizedLabels: [{ Label: o.text }] },
                })),
              },
            }
          : {}),
      });

      const attributesList = matched.length > 0
        ? matched.map(([logical, col]) => buildAttribute(logical, col))
        : (attributes ?? []).map(a => buildAttribute(a));

      return {
        LogicalName: entityName,
        EntitySetName: entitySetName,
        DisplayName: meta?.displayName ?? entityName,
        PrimaryIdAttribute: primaryIdAttribute,
        PrimaryNameAttribute: primaryNameAttribute,
        Attributes: {
          getAll() {
            return attributesList;
          },
          getByName(name: string) {
            const col = meta?.columns[name];
            return buildAttribute(name, col);
          },
        },
      };
    },
    hasEntityPrivilege(
      _entityTypeName: string,
      _privilegeType: number,
      _privilegeDepth: number
    ): boolean {
      return true;
    },
    lookupObjects(lookupOptions: any): Promise<any[]> {
      log('lookupObjects', lookupOptions);
      return new Promise(resolve => {
        pushDialog<LookupDialogRequest>({
          kind: 'lookup',
          options: lookupOptions,
          resolve,
        });
      });
    },
  };
}
