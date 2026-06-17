import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { ConformanceGrid } from "./ConformanceGrid";
import * as React from "react";

export class ConformanceTester implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;
    // Held across the getOutputs cycle so conformance writeback rows can mutate
    // the harness's bound/input values and observe the glow animation.
    private pendingOutputs: Partial<IOutputs> = {};

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
        return React.createElement(ConformanceGrid, {
            context: context,
            writeOutput: (name, value) => {
                (this.pendingOutputs as Record<string, unknown>)[name] = value;
            },
            notifyOutputChanged: () => this.notifyOutputChanged(),
        });
    }

    public getOutputs(): IOutputs {
        const out = this.pendingOutputs as IOutputs;
        // Clear after the harness has read them — match real UCI semantics where
        // notifyOutputChanged → getOutputs is a one-shot drain.
        this.pendingOutputs = {};
        return out;
    }

    public destroy(): void {
        // no-op
    }
}
