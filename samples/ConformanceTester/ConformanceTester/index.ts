import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ConformanceGrid } from "./ConformanceGrid";
import * as React from "react";

export class ConformanceTester implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;

    constructor() {
        // Empty
    }

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        return React.createElement(ConformanceGrid, { context: context as ComponentFramework.Context<unknown> });
    }

    public getOutputs(): IOutputs {
        return {};
    }

    public destroy(): void {
        // no-op
    }
}
