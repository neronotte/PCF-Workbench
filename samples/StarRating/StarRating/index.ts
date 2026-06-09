import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { StarRating as StarRatingComponent } from './StarRating';

export class StarRating implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private notifyOutputChanged: () => void = () => undefined;
  private currentValue: number | null = null;
  /** True once the user has interacted at least once. Suppresses spurious 0-writes on form load. */
  private dirty = false;

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    _state: ComponentFramework.Dictionary,
  ): void {
    this.notifyOutputChanged = notifyOutputChanged;
    this.currentValue = context.parameters.value.raw ?? null;
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    if (!this.dirty) {
      this.currentValue = context.parameters.value.raw ?? null;
    }
    const maxStars = context.parameters.maxStars.raw ?? 5;
    const allowClear = context.parameters.allowClear.raw ?? true;
    const disabled = context.mode.isControlDisabled === true;
    const isAuthoringMode = (context.mode as { isAuthoringMode?: boolean }).isAuthoringMode === true;

    return React.createElement(StarRatingComponent, {
      value: this.currentValue,
      maxStars,
      allowClear,
      disabled,
      isAuthoringMode,
      onChange: (next: number | null) => {
        this.currentValue = next;
        this.dirty = true;
        this.notifyOutputChanged();
      },
    });
  }

  public getOutputs(): IOutputs {
    return this.dirty ? { value: this.currentValue ?? undefined } : {};
  }

  public destroy(): void {
    // React root is owned by the framework for virtual controls — nothing to clean up.
  }
}
