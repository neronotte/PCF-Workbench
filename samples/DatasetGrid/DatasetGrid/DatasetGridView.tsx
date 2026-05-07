import * as React from 'react';
import {
  FluentProvider, webLightTheme,
  Button, Text,
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
  const primaryHeader = dataset.columns.find(c => c.alias === 'primaryName')?.displayName ?? 'Name';
  const statusHeader = dataset.columns.find(c => c.alias === 'status')?.displayName ?? 'Status';

  const cellStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderBottom: '1px solid #e5e5e5',
    textAlign: 'left',
    verticalAlign: 'middle',
  };
  const headerCellStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: 600,
    backgroundColor: '#f3f2f1',
    borderBottom: '2px solid #d1d1d1',
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button size="small" onClick={onRefresh}>↻ Refresh</Button>
          <Button size="small" onClick={onLoadMore} disabled={!hasNextPage}>↓ Load more</Button>
          <Text style={{ marginLeft: 'auto', fontSize: 12 }}>
            {recordCount} record{recordCount === 1 ? '' : 's'}{hasNextPage ? ' (more available)' : ''}
          </Text>
        </div>

        {recordCount === 0 ? (
          <Text italic>No records. Seed the dataset via data.json.</Text>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th style={headerCellStyle}>{primaryHeader}</th>
                <th style={headerCellStyle}>{statusHeader}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td style={cellStyle}>
                    <Button appearance="transparent" onClick={() => onOpen(item.id)}>
                      {item.primaryName || '—'}
                    </Button>
                  </td>
                  <td style={cellStyle}>{item.status || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </FluentProvider>
  );
};
