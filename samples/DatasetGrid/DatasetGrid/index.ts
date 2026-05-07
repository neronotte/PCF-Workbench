/**
 * DatasetGrid — minimal dataset-bound PCF for harness validation.
 *
 * Renders the bound `records` dataset as a small Fluent v9 DataGrid with two
 * columns. Used as a harness regression target for the dataset shim:
 *   - context.parameters.records.columns        (column metadata)
 *   - context.parameters.records.sortedRecordIds (current page record order)
 *   - records[id].getFormattedValue / getValue / getNamedReference
 *   - openDatasetItem(reference)                (UCI navigation)
 *   - refresh() + paging.loadNextPage()
 *
 * No live org required — data comes from the harness's data.json seed.
 */
import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { DatasetGridView } from './DatasetGridView';

export class DatasetGrid implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  public init(
    _context: ComponentFramework.Context<IInputs>,
    _notifyOutputChanged: () => void,
  ): void {
    // no-op — dataset values arrive on first updateView
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    const dataset = context.parameters.records;
    return React.createElement(DatasetGridView, {
      dataset,
      onOpen: (id: string) => {
        const ref = dataset.records[id]?.getNamedReference?.();
        if (ref) dataset.openDatasetItem?.(ref);
      },
      onRefresh: () => dataset.refresh?.(),
      onLoadMore: () => dataset.paging?.loadNextPage?.(),
    });
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // no-op
  }
}
