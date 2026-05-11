import type { HarnessStore } from '../store/harness-store';
import { getEntityMetadata as getMetadataEntry } from '../store/metadata-store';
import { resolveEntitySetName } from '../api/dv-client';
import { pushDialog, type LookupDialogRequest } from './dialog-bus';

export function createUtilsShim(getState: () => HarnessStore) {
  const log = (method: string, args?: any) =>
    getState().addLogEntry({ category: 'utils', method, args });

  return {
    async getEntityMetadata(entityName: string, attributes?: string[]): Promise<any> {
      log('getEntityMetadata', { entityName, attributes });

      const meta = getMetadataEntry(entityName);
      const allColumns = meta ? Object.entries(meta.columns) : [];
      const filterSet = attributes && attributes.length > 0 ? new Set(attributes) : null;
      const matched = filterSet
        ? allColumns.filter(([logical]) => filterSet.has(logical))
        : allColumns;

      const buildAttribute = (logicalName: string, col?: { displayName: string; type?: string }) => ({
        LogicalName: logicalName,
        DisplayName: col?.displayName ?? logicalName,
        AttributeType: col?.type ?? 'String',
      });

      const attributesList = matched.length > 0
        ? matched.map(([logical, col]) => buildAttribute(logical, col))
        : (attributes ?? []).map(a => buildAttribute(a));

      // EntitySetName: in live mode, ask Dataverse via /EntityDefinitions
      // (cached per-session) so we get the correct plural for entities like
      // opportunity → opportunities and any custom table. In mock mode the
      // legacy `<logical>s` heuristic is fine because data.json keys match.
      const state = getState();
      let entitySetName = `${entityName}s`;
      if (state.dataSource === 'live' && state.liveProfile) {
        try {
          entitySetName = await resolveEntitySetName(state.liveProfile.orgUrl, entityName);
        } catch {
          // Fall back to the heuristic; resolveEntitySetName already logged it.
        }
      }

      return {
        LogicalName: entityName,
        EntitySetName: entitySetName,
        DisplayName: meta?.displayName ?? entityName,
        PrimaryIdAttribute: entityName + 'id',
        PrimaryNameAttribute: 'name',
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
