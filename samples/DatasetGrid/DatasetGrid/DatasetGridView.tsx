import * as React from 'react';
import {
  FluentProvider, webLightTheme,
  DataGrid, DataGridHeader, DataGridHeaderCell, DataGridBody, DataGridRow, DataGridCell,
  TableColumnDefinition, createTableColumn, Button, Text, Toolbar, ToolbarButton,
} from '@fluentui/react-components';

type Dataset = ComponentFramework.PropertyTypes.DataSet;

interface RowItem {
  id: string;
  primaryName: string;
  status: string;
}

export interface DatasetGridViewProps {
  dataset: Dataset;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
}

export const DatasetGridView: React.FC<DatasetGridViewProps> = ({ dataset, onOpen, onRefresh, onLoadMore }) => {
  const columns: TableColumnDefinition<RowItem>[] = React.useMemo(() => [
    createTableColumn<RowItem>({
      columnId: 'primaryName',
      compare: (a, b) => a.primaryName.localeCompare(b.primaryName),
      renderHeaderCell: () => dataset.columns.find(c => c.alias === 'primaryName')?.displayName ?? 'Name',
      renderCell: (item) => (
        <Button appearance="transparent" onClick={() => onOpen(item.id)}>
          {item.primaryName || '—'}
        </Button>
      ),
    }),
    createTableColumn<RowItem>({
      columnId: 'status',
      compare: (a, b) => a.status.localeCompare(b.status),
      renderHeaderCell: () => dataset.columns.find(c => c.alias === 'status')?.displayName ?? 'Status',
      renderCell: (item) => <Text>{item.status || '—'}</Text>,
    }),
  ], [dataset, onOpen]);

  const items: RowItem[] = (dataset.sortedRecordIds ?? []).map((id: string) => {
    const r = dataset.records[id];
    return {
      id,
      primaryName: r?.getFormattedValue?.('primaryName') ?? r?.getValue?.('primaryName')?.toString() ?? '',
      status: r?.getFormattedValue?.('status') ?? r?.getValue?.('status')?.toString() ?? '',
    };
  });

  const recordCount = items.length;
  const hasNextPage = dataset.paging?.hasNextPage ?? false;

  return (
    <FluentProvider theme={webLightTheme}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
        <Toolbar size="small">
          <ToolbarButton onClick={onRefresh}>↻ Refresh</ToolbarButton>
          <ToolbarButton onClick={onLoadMore} disabled={!hasNextPage}>
            ↓ Load more
          </ToolbarButton>
          <Text style={{ marginLeft: 'auto', fontSize: 12 }}>
            {recordCount} record{recordCount === 1 ? '' : 's'}{hasNextPage ? ' (more available)' : ''}
          </Text>
        </Toolbar>

        {recordCount === 0 ? (
          <Text italic>No records. Seed the dataset via data.json.</Text>
        ) : (
          <DataGrid items={items} columns={columns} sortable getRowId={(item) => item.id} resizableColumns>
            <DataGridHeader>
              <DataGridRow>
                {({ renderHeaderCell }) => (
                  <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                )}
              </DataGridRow>
            </DataGridHeader>
            <DataGridBody<RowItem>>
              {({ item, rowId }) => (
                <DataGridRow<RowItem> key={rowId}>
                  {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
                </DataGridRow>
              )}
            </DataGridBody>
          </DataGrid>
        )}
      </div>
    </FluentProvider>
  );
};
