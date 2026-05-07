import * as React from "react";
import {
    FluentProvider,
    webLightTheme,
    Button,
    Badge,
    Text,
    Title3,
    Subtitle2,
    tokens,
    makeStyles,
    shorthands,
    Divider,
} from "@fluentui/react-components";

export interface IConformanceGridProps {
    context: ComponentFramework.Context<unknown>;
}

type Status = "idle" | "pass" | "fail" | "na";

interface TestRow {
    id: string;
    category: "Context" | "Xrm" | "formContext" | "executionContext";
    name: string;
    run: (ctx: ComponentFramework.Context<unknown>) => Promise<string> | string;
}

interface RowState {
    status: Status;
    detail: string;
}

const useStyles = makeStyles({
    root: {
        ...shorthands.padding("16px"),
        display: "flex",
        flexDirection: "column",
        rowGap: "12px",
        fontFamily: tokens.fontFamilyBase,
    },
    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        columnGap: "12px",
    },
    summary: {
        display: "flex",
        columnGap: "8px",
        alignItems: "center",
    },
    table: {
        display: "grid",
        gridTemplateColumns: "minmax(120px, 0.7fr) minmax(220px, 2fr) 90px minmax(180px, 2fr) auto",
        rowGap: "4px",
        columnGap: "12px",
        alignItems: "center",
    },
    headCell: {
        fontWeight: tokens.fontWeightSemibold,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
        ...shorthands.padding("4px", "0"),
    },
    cell: {
        fontSize: tokens.fontSizeBase300,
        ...shorthands.padding("6px", "0"),
        ...shorthands.overflow("hidden"),
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    detail: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
    },
    notifierBar: {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        columnGap: "8px",
        rowGap: "6px",
        ...shorthands.padding("8px", "12px"),
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
        borderRadius: tokens.borderRadiusMedium,
    },
    notifierLabel: {
        fontWeight: tokens.fontWeightSemibold,
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground2,
        marginRight: "4px",
    },
});

function getXrm(): any {
    return (typeof window !== "undefined" ? (window as any).Xrm : undefined);
}

function fmt(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "function") return "[function]";
    if (typeof value === "object") {
        try {
            return JSON.stringify(value).slice(0, 120);
        } catch {
            return "[object]";
        }
    }
    return String(value).slice(0, 120);
}

function expect(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
}

const TESTS: TestRow[] = [
    // ─── Context.* ──────────────────────────────────────────────
    {
        id: "context-parameters-record",
        category: "Context",
        name: "context.parameters.record",
        run: (ctx) => fmt((ctx as any).parameters?.record?.raw ?? (ctx as any).parameters?.record),
    },
    {
        id: "context-parameters-textInput",
        category: "Context",
        name: "context.parameters.textInput.raw",
        run: (ctx) => fmt((ctx as any).parameters?.textInput?.raw),
    },
    {
        id: "context-client-getClient",
        category: "Context",
        name: "context.client.getClient()",
        run: (ctx) => fmt(ctx.client.getClient()),
    },
    {
        id: "context-client-getFormFactor",
        category: "Context",
        name: "context.client.getFormFactor()",
        run: (ctx) => fmt(ctx.client.getFormFactor()),
    },
    {
        id: "context-userSettings-userId",
        category: "Context",
        name: "context.userSettings.userId",
        run: (ctx) => fmt(ctx.userSettings?.userId),
    },
    {
        id: "context-utils-getEntityMetadata",
        category: "Context",
        name: "context.utils.getEntityMetadata",
        run: async (ctx) => {
            const md = await ctx.utils.getEntityMetadata("account");
            return fmt({ logicalName: (md as any)?.LogicalName, primaryId: (md as any)?.PrimaryIdAttribute });
        },
    },
    {
        id: "context-webAPI-retrieveMultiple",
        category: "Context",
        name: "context.webAPI.retrieveMultipleRecords",
        run: async (ctx) => {
            const res = await ctx.webAPI.retrieveMultipleRecords("account", "?$top=1");
            return fmt({ count: res.entities.length });
        },
    },
    {
        id: "context-resources-getString",
        category: "Context",
        name: "context.resources.getString",
        run: (ctx) => fmt(ctx.resources.getString("missing-key")),
    },
    {
        id: "context-mode-isVisible",
        category: "Context",
        name: "context.mode.isVisible",
        run: (ctx) => fmt(ctx.mode.isVisible),
    },
    {
        id: "context-factory-requestRender",
        category: "Context",
        name: "context.factory.requestRender",
        run: (ctx) => {
            (ctx as any).factory?.requestRender?.();
            return "called";
        },
    },
    {
        id: "context-factory-fireEvent",
        category: "Context",
        name: "context.factory.fireEvent",
        run: (ctx) => {
            const fn = (ctx as any).factory?.fireEvent;
            expect(typeof fn === "function", "context.factory.fireEvent missing");
            fn("ConformanceProbe", { value: 1 });
            return "ok";
        },
    },
    {
        id: "context-mode-contextInfo-formId",
        category: "Context",
        name: "context.mode.contextInfo.formId",
        run: (ctx) => {
            const ci = (ctx as any).mode?.contextInfo;
            expect(!!ci, "contextInfo missing");
            expect(typeof ci.formId === "string" && ci.formId.length > 0, `formId missing: ${fmt(ci.formId)}`);
            expect(typeof ci.roleName === "string" && ci.roleName.length > 0, `roleName missing: ${fmt(ci.roleName)}`);
            return fmt({ formId: ci.formId, roleName: ci.roleName });
        },
    },
    {
        id: "context-page-getClientUrl",
        category: "Context",
        name: "context.page.getClientUrl()",
        run: (ctx) => {
            const fn = (ctx as any).page?.getClientUrl;
            expect(typeof fn === "function", "page.getClientUrl missing");
            const url = fn();
            expect(typeof url === "string" && url.length > 0, `expected non-empty url, got ${fmt(url)}`);
            return fmt(url);
        },
    },
    {
        id: "context-accessibility-getState",
        category: "Context",
        name: "context.accessibility.getAccessibilityState()",
        run: (ctx) => {
            const fn = (ctx as any).accessibility?.getAccessibilityState;
            expect(typeof fn === "function", "accessibility.getAccessibilityState missing");
            const state = fn();
            expect(state && typeof state === "object", "did not return object");
            expect(typeof state.isHighContrastEnabled === "boolean", "isHighContrastEnabled missing");
            expect(typeof state.isReducedMotionEnabled === "boolean", "isReducedMotionEnabled missing");
            return fmt(state);
        },
    },
    {
        id: "context-theming-getThemeKind",
        category: "Context",
        name: "context.theming.getThemeKind()",
        run: (ctx) => {
            const fn = (ctx as any).theming?.getThemeKind;
            expect(typeof fn === "function", "theming.getThemeKind missing");
            const kind = fn();
            expect(["light", "dark", "highContrast"].includes(kind), `unexpected kind: ${kind}`);
            return fmt(kind);
        },
    },
    {
        id: "context-theming-getCustomColors",
        category: "Context",
        name: "context.theming.getCustomColors()",
        run: (ctx) => {
            const fn = (ctx as any).theming?.getCustomColors;
            expect(typeof fn === "function", "theming.getCustomColors missing");
            const colors = fn();
            expect(!!colors && typeof colors.brandPrimary === "string", `bad colors: ${fmt(colors)}`);
            return fmt(colors);
        },
    },
    {
        id: "context-events-proxy",
        category: "Context",
        name: "context.events Proxy auto-handler",
        run: (ctx) => {
            const ev = (ctx as any).events;
            expect(!!ev, "events missing");
            // Any property access should return a function (auto-created by the Proxy).
            const fn = ev.OnConformanceProbe;
            expect(typeof fn === "function", "Proxy did not auto-create handler");
            fn({ probe: true });
            return "ok";
        },
    },
    {
        id: "context-copilot-shim",
        category: "Context",
        name: "context.copilot.getRecommendations",
        run: async (ctx) => {
            const fn = (ctx as any).copilot?.getRecommendations;
            expect(typeof fn === "function", "copilot.getRecommendations missing");
            const r = await fn({});
            expect(Array.isArray(r), `expected array, got ${fmt(r)}`);
            return fmt({ length: r.length });
        },
    },
    {
        id: "context-fluentDesign-tokens",
        category: "Context",
        name: "context.fluentDesignLanguage.tokenTheme",
        run: (ctx) => {
            const fd = (ctx as any).fluentDesignLanguage;
            expect(!!fd, "fluentDesignLanguage missing");
            expect(typeof fd.tokenTheme === "object" && fd.tokenTheme !== null, "tokenTheme missing");
            expect(typeof fd.isDarkTheme === "boolean", "isDarkTheme missing");
            return fmt({ isDarkTheme: fd.isDarkTheme });
        },
    },

    // ─── Xrm.* ──────────────────────────────────────────────────
    {
        id: "xrm-global",
        category: "Xrm",
        name: "window.Xrm exists",
        run: () => {
            expect(!!getXrm(), "Xrm not defined on window");
            return "ok";
        },
    },
    {
        id: "xrm-page-alias",
        category: "Xrm",
        name: "Xrm.Page === formContext (alias)",
        run: () => {
            const Xrm = getXrm();
            expect(!!Xrm?.Page, "Xrm.Page missing");
            expect(typeof Xrm.Page.getAttribute === "function", "Xrm.Page.getAttribute missing");
            return "ok";
        },
    },
    {
        id: "xrm-utility-alertDialog",
        category: "Xrm",
        name: "Xrm.Utility.alertDialog",
        run: async () => {
            const Xrm = getXrm();
            const fn = Xrm?.Utility?.alertDialog;
            expect(typeof fn === "function", "Xrm.Utility.alertDialog missing");
            // Awaits real round-trip through the dialog bus.
            // Playwright auto-dismisses by clicking the dialog's primary button.
            await fn({ text: "conformance probe", title: "ct alert" });
            return "resolved";
        },
    },
    {
        id: "xrm-utility-confirmDialog",
        category: "Xrm",
        name: "Xrm.Utility.confirmDialog",
        run: async () => {
            const Xrm = getXrm();
            const fn = Xrm?.Utility?.confirmDialog;
            expect(typeof fn === "function", "Xrm.Utility.confirmDialog missing");
            const result = await fn({ text: "ct probe", title: "ct confirm" });
            expect(!!result && typeof result.confirmed === "boolean", `unexpected confirm result: ${fmt(result)}`);
            return fmt(result);
        },
    },
    {
        id: "xrm-utility-showProgressIndicator",
        category: "Xrm",
        name: "Xrm.Utility.show/closeProgressIndicator",
        run: () => {
            const Xrm = getXrm();
            expect(typeof Xrm?.Utility?.showProgressIndicator === "function", "showProgressIndicator missing");
            expect(typeof Xrm?.Utility?.closeProgressIndicator === "function", "closeProgressIndicator missing");
            Xrm.Utility.showProgressIndicator("ct probe");
            Xrm.Utility.closeProgressIndicator();
            return "ok";
        },
    },
    {
        id: "xrm-navigation-openUrl",
        category: "Xrm",
        name: "Xrm.Navigation.openUrl",
        run: () => {
            const Xrm = getXrm();
            expect(typeof Xrm?.Navigation?.openUrl === "function", "missing");
            return "fn present";
        },
    },
    {
        id: "xrm-webapi",
        category: "Xrm",
        name: "Xrm.WebApi.retrieveMultipleRecords",
        run: async () => {
            const Xrm = getXrm();
            expect(typeof Xrm?.WebApi?.retrieveMultipleRecords === "function", "missing");
            const res = await Xrm.WebApi.retrieveMultipleRecords("account", "?$top=1");
            return fmt({ count: res.entities.length });
        },
    },
    {
        id: "xrm-encoding-htmlEncode",
        category: "Xrm",
        name: "Xrm.Encoding.htmlEncode",
        run: () => {
            const Xrm = getXrm();
            const fn = Xrm?.Encoding?.htmlEncode;
            expect(typeof fn === "function", "htmlEncode missing");
            const got = fn("<b>x</b>");
            expect(got === "&lt;b&gt;x&lt;/b&gt;", `unexpected encode: ${got}`);
            return fmt(got);
        },
    },
    {
        id: "xrm-encoding-htmlDecode",
        category: "Xrm",
        name: "Xrm.Encoding.htmlDecode",
        run: () => {
            const Xrm = getXrm();
            const fn = Xrm?.Encoding?.htmlDecode;
            expect(typeof fn === "function", "htmlDecode missing");
            const got = fn("&lt;b&gt;x&lt;/b&gt;");
            expect(got === "<b>x</b>", `unexpected decode: ${got}`);
            return fmt(got);
        },
    },
    {
        id: "xrm-encoding-xmlEncode",
        category: "Xrm",
        name: "Xrm.Encoding.xmlEncode",
        run: () => {
            const Xrm = getXrm();
            const fn = Xrm?.Encoding?.xmlEncode;
            expect(typeof fn === "function", "xmlEncode missing");
            const got = fn("<a&b>");
            expect(got === "&lt;a&amp;b&gt;", `unexpected xmlEncode: ${got}`);
            return fmt(got);
        },
    },
    {
        id: "xrm-device-getCurrentPosition",
        category: "Xrm",
        name: "Xrm.Device.getCurrentPosition",
        run: () => {
            const Xrm = getXrm();
            const fn = Xrm?.Device?.getCurrentPosition;
            expect(typeof fn === "function", "Xrm.Device.getCurrentPosition missing");
            const p = fn();
            expect(p && typeof (p as Promise<unknown>).then === "function", "getCurrentPosition did not return a Promise");
            return "returned Promise";
        },
    },
    {
        id: "xrm-app-addGlobalNotification",
        category: "Xrm",
        name: "Xrm.App.addGlobalNotification",
        run: async () => {
            const Xrm = getXrm();
            expect(typeof Xrm?.App?.addGlobalNotification === "function", "addGlobalNotification missing");
            const id = await Xrm.App.addGlobalNotification({ type: 2, level: 2, message: "ct probe" });
            expect(typeof id === "string" && id.length > 0, `expected string id, got ${fmt(id)}`);
            await Xrm.App.clearGlobalNotification(id);
            return fmt(id);
        },
    },
    {
        id: "xrm-app-clearGlobalNotification",
        category: "Xrm",
        name: "Xrm.App.clearGlobalNotification",
        run: () => {
            const Xrm = getXrm();
            expect(typeof Xrm?.App?.clearGlobalNotification === "function", "clearGlobalNotification missing");
            const p = Xrm.App.clearGlobalNotification("nonexistent");
            expect(p && typeof (p as Promise<unknown>).then === "function", "did not return Promise");
            return "ok";
        },
    },
    {
        id: "xrm-app-sidePanes-createPane",
        category: "Xrm",
        name: "Xrm.App.sidePanes.createPane",
        run: async () => {
            const Xrm = getXrm();
            expect(typeof Xrm?.App?.sidePanes?.createPane === "function", "sidePanes.createPane missing");
            const pane = await Xrm.App.sidePanes.createPane({ title: "ct probe", paneId: "ct-pane" });
            expect(!!pane && pane.paneId === "ct-pane", `unexpected pane: ${fmt(pane)}`);
            expect(typeof pane.close === "function", "pane.close missing");
            await pane.close();
            return fmt({ paneId: pane.paneId });
        },
    },
    {
        id: "xrm-panel-loadPanel",
        category: "Xrm",
        name: "Xrm.Panel.loadPanel",
        run: () => {
            const Xrm = getXrm();
            expect(typeof Xrm?.Panel?.loadPanel === "function", "Xrm.Panel.loadPanel missing");
            Xrm.Panel.loadPanel("https://example.invalid/ct", "ct probe");
            return "ok";
        },
    },

    // ─── formContext.* ──────────────────────────────────────────
    {
        id: "fc-getAttribute-record",
        category: "formContext",
        name: "formContext.getAttribute('record').getValue()",
        run: () => {
            const fc = getXrm()?.Page;
            const attr = fc?.getAttribute?.("record");
            expect(!!attr, "attribute 'record' not found");
            return fmt(attr.getValue());
        },
    },
    {
        id: "fc-attribute-setValue",
        category: "formContext",
        name: "attribute.setValue + getValue round-trip",
        run: () => {
            const fc = getXrm()?.Page;
            const attr = fc.getAttribute("record") || fc.getAttribute("textInput");
            expect(!!attr, "no attribute");
            const original = attr.getValue();
            attr.setValue("conformance-probe-value");
            const got = attr.getValue();
            attr.setValue(original);
            expect(got === "conformance-probe-value", `expected probe value, got ${got}`);
            return "ok";
        },
    },
    {
        id: "fc-attribute-onChange",
        category: "formContext",
        name: "addOnChange + fireOnChange",
        run: () => {
            const fc = getXrm()?.Page;
            const attr = fc.getAttribute("record") || fc.getAttribute("textInput");
            expect(!!attr, "no attribute");
            let fired = 0;
            const handler = () => { fired += 1; };
            attr.addOnChange(handler);
            attr.fireOnChange();
            attr.removeOnChange(handler);
            expect(fired === 1, `expected 1 fire, got ${fired}`);
            return "ok";
        },
    },
    {
        id: "fc-attribute-required",
        category: "formContext",
        name: "attribute.set/getRequiredLevel",
        run: () => {
            const fc = getXrm()?.Page;
            const attr = fc.getAttribute("record") || fc.getAttribute("textInput");
            const before = attr.getRequiredLevel();
            attr.setRequiredLevel("required");
            const after = attr.getRequiredLevel();
            attr.setRequiredLevel(before);
            expect(after === "required", `expected required, got ${after}`);
            return "ok";
        },
    },
    {
        id: "fc-getControl",
        category: "formContext",
        name: "formContext.getControl",
        run: () => {
            const fc = getXrm()?.Page;
            const controls = (fc.ui?.controls) || null;
            const ctrl = fc.getControl?.("record") || fc.getControl?.("textInput");
            expect(!!ctrl, "no control");
            return fmt({ name: ctrl.getName?.(), type: ctrl.getControlType?.() });
        },
    },
    {
        id: "fc-control-setVisible",
        category: "formContext",
        name: "control.set/getVisible",
        run: () => {
            const fc = getXrm()?.Page;
            const ctrl = fc.getControl("record") || fc.getControl("textInput");
            const before = ctrl.getVisible();
            ctrl.setVisible(!before);
            const after = ctrl.getVisible();
            ctrl.setVisible(before);
            expect(after === !before, "visibility not toggled");
            return "ok";
        },
    },
    {
        id: "fc-control-setNotification",
        category: "formContext",
        name: "control.setNotification/clearNotification",
        run: () => {
            const fc = getXrm()?.Page;
            const ctrl = fc.getControl("record") || fc.getControl("textInput");
            ctrl.setNotification("conformance test", "ct-probe");
            ctrl.clearNotification("ct-probe");
            return "ok";
        },
    },
    {
        id: "fc-data-entity-getId",
        category: "formContext",
        name: "data.entity.getId",
        run: () => {
            const fc = getXrm()?.Page;
            return fmt(fc.data?.entity?.getId?.());
        },
    },
    {
        id: "fc-data-entity-getEntityName",
        category: "formContext",
        name: "data.entity.getEntityName",
        run: () => {
            const fc = getXrm()?.Page;
            return fmt(fc.data?.entity?.getEntityName?.());
        },
    },
    {
        id: "fc-ui-setFormNotification",
        category: "formContext",
        name: "ui.setFormNotification/clearFormNotification",
        run: () => {
            const fc = getXrm()?.Page;
            fc.ui.setFormNotification("conformance probe", "INFO", "ct-form-probe");
            fc.ui.clearFormNotification("ct-form-probe");
            return "ok";
        },
    },
    {
        id: "fc-ui-tabs",
        category: "formContext",
        name: "ui.tabs.forEach",
        run: () => {
            const fc = getXrm()?.Page;
            const names: string[] = [];
            fc.ui.tabs?.forEach?.((t: any) => names.push(t.getName?.()));
            return fmt({ count: names.length, names });
        },
    },

    // ─── executionContext.* ─────────────────────────────────────
    {
        id: "ec-from-onChange",
        category: "executionContext",
        name: "executionContext.getFormContext (via addOnChange)",
        run: () => {
            const fc = getXrm()?.Page;
            const attr = fc.getAttribute("record") || fc.getAttribute("textInput");
            let received: any = null;
            const handler = (ec: any) => { received = ec; };
            attr.addOnChange(handler);
            attr.fireOnChange();
            attr.removeOnChange(handler);
            expect(!!received, "handler did not receive executionContext");
            const echoed = received.getFormContext?.();
            expect(!!echoed, "executionContext.getFormContext returned nothing");
            return "ok";
        },
    },
    {
        id: "ec-shared-variable",
        category: "executionContext",
        name: "executionContext.set/getSharedVariable",
        run: () => {
            const fc = getXrm()?.Page;
            const attr = fc.getAttribute("record") || fc.getAttribute("textInput");
            let result: any = null;
            const h1 = (ec: any) => { ec.setSharedVariable("ct-key", "ct-value"); };
            const h2 = (ec: any) => { result = ec.getSharedVariable("ct-key"); };
            attr.addOnChange(h1);
            attr.addOnChange(h2);
            attr.fireOnChange();
            attr.removeOnChange(h1);
            attr.removeOnChange(h2);
            expect(result === "ct-value", `expected ct-value, got ${result}`);
            return "ok";
        },
    },
];

function statusBadge(status: Status): React.ReactElement {
    if (status === "pass") return <span data-status="pass"><Badge appearance="filled" color="success">PASS</Badge></span>;
    if (status === "fail") return <span data-status="fail"><Badge appearance="filled" color="danger">FAIL</Badge></span>;
    if (status === "na") return <span data-status="na"><Badge appearance="outline" color="warning">N/A</Badge></span>;
    return <span data-status="idle"><Badge appearance="outline">—</Badge></span>;
}

const NotificationTester: React.FC = () => {
    const styles = useStyles();
    const appIdsRef = React.useRef<string[]>([]);

    const fireFormNotification = (level: "ERROR" | "WARNING" | "INFORMATION") => {
        const Xrm = getXrm();
        const ui = Xrm?.Page?.ui;
        if (!ui?.setFormNotification) {
            console.warn("[ct] Xrm.Page.ui.setFormNotification not available");
            return;
        }
        const w = window as any;
        w.__ctNotifSeq = (w.__ctNotifSeq ?? 0) + 1;
        const id = `ct-form-${w.__ctNotifSeq}`;
        ui.setFormNotification(`${level}: form notification ${id}`, level, id);
    };

    const clearFormNotifications = () => {
        const Xrm = getXrm();
        const ui = Xrm?.Page?.ui;
        if (!ui?.clearFormNotification) return;
        const seq = (window as any).__ctNotifSeq ?? 0;
        for (let i = 1; i <= seq; i++) {
            ui.clearFormNotification(`ct-form-${i}`);
        }
        (window as any).__ctNotifSeq = 0;
    };

    const fireAppNotification = async (level: 1 | 2 | 3 | 4) => {
        const Xrm = getXrm();
        const addFn = Xrm?.App?.addGlobalNotification;
        if (typeof addFn !== "function") {
            console.warn("[ct] Xrm.App.addGlobalNotification not available");
            return;
        }
        const labels = { 1: "Success", 2: "Error", 3: "Warning", 4: "Information" } as const;
        const id = await Xrm.App.addGlobalNotification({
            type: 2,
            level,
            message: `${labels[level]}: app notification fired from Conformance Tester`,
            showCloseButton: true,
        });
        if (typeof id === "string") appIdsRef.current.push(id);
    };

    const clearAppNotifications = async () => {
        const Xrm = getXrm();
        const clearFn = Xrm?.App?.clearGlobalNotification;
        if (typeof clearFn !== "function") return;
        for (const id of appIdsRef.current) {
            await Xrm.App.clearGlobalNotification(id);
        }
        appIdsRef.current = [];
    };

    return (
        <div className={styles.notifierBar} data-test-id="ct-notifier">
            <span className={styles.notifierLabel}>Form notification:</span>
            <Button size="small" data-test-id="ct-notifier-form-error" onClick={() => fireFormNotification("ERROR")}>Error</Button>
            <Button size="small" data-test-id="ct-notifier-form-warning" onClick={() => fireFormNotification("WARNING")}>Warning</Button>
            <Button size="small" data-test-id="ct-notifier-form-info" onClick={() => fireFormNotification("INFORMATION")}>Info</Button>
            <Button size="small" appearance="subtle" data-test-id="ct-notifier-form-clear" onClick={clearFormNotifications}>Clear</Button>
            <span className={styles.notifierLabel} style={{ marginLeft: "12px" }}>App notification:</span>
            <Button size="small" data-test-id="ct-notifier-app-success" onClick={() => fireAppNotification(1)}>Success</Button>
            <Button size="small" data-test-id="ct-notifier-app-error" onClick={() => fireAppNotification(2)}>Error</Button>
            <Button size="small" data-test-id="ct-notifier-app-warning" onClick={() => fireAppNotification(3)}>Warning</Button>
            <Button size="small" data-test-id="ct-notifier-app-info" onClick={() => fireAppNotification(4)}>Info</Button>
            <Button size="small" appearance="subtle" data-test-id="ct-notifier-app-clear" onClick={clearAppNotifications}>Clear</Button>
        </div>
    );
};

export const ConformanceGrid: React.FC<IConformanceGridProps> = ({ context }) => {
    const styles = useStyles();
    const [rows, setRows] = React.useState<Record<string, RowState>>(() => {
        const init: Record<string, RowState> = {};
        for (const t of TESTS) init[t.id] = { status: "idle", detail: "" };
        return init;
    });

    const runOne = React.useCallback(async (test: TestRow) => {
        try {
            const out = await Promise.resolve(test.run(context));
            const isNa = typeof out === "string" && out.startsWith("N/A");
            setRows((prev) => ({
                ...prev,
                [test.id]: { status: isNa ? "na" : "pass", detail: String(out) },
            }));
        } catch (err: any) {
            setRows((prev) => ({
                ...prev,
                [test.id]: { status: "fail", detail: err?.message ?? String(err) },
            }));
        }
    }, [context]);

    const runAll = React.useCallback(async () => {
        for (const t of TESTS) {
            await runOne(t);
        }
    }, [runOne]);

    const counts = React.useMemo(() => {
        let pass = 0, fail = 0, na = 0, idle = 0;
        for (const id of Object.keys(rows)) {
            const s = rows[id].status;
            if (s === "pass") pass++;
            else if (s === "fail") fail++;
            else if (s === "na") na++;
            else idle++;
        }
        return { pass, fail, na, idle, total: TESTS.length };
    }, [rows]);

    return (
        <FluentProvider theme={webLightTheme}>
            <div className={styles.root} data-test-id="ct-root">
                <div className={styles.headerRow}>
                    <Title3>PCF Conformance Tester</Title3>
                    <div className={styles.summary} data-test-id="ct-summary">
                        <span data-test-id="ct-summary-pass"><Badge color="success" appearance="tint">{counts.pass} pass</Badge></span>
                        <span data-test-id="ct-summary-fail"><Badge color="danger" appearance="tint">{counts.fail} fail</Badge></span>
                        <span data-test-id="ct-summary-na"><Badge color="warning" appearance="tint">{counts.na} n/a</Badge></span>
                        <span data-test-id="ct-summary-idle"><Badge appearance="outline">{counts.idle} idle</Badge></span>
                        <span data-test-id="ct-run-all"><Button appearance="primary" onClick={runAll}>Run all</Button></span>
                    </div>
                </div>
                <Subtitle2>Each row exercises one shim member. Click "Run" or "Run all" to populate.</Subtitle2>
                <NotificationTester />
                <Divider />
                <div className={styles.table} role="table" data-test-id="ct-table">
                    <div className={styles.headCell}>Category</div>
                    <div className={styles.headCell}>API</div>
                    <div className={styles.headCell}>Status</div>
                    <div className={styles.headCell}>Last result</div>
                    <div className={styles.headCell}></div>
                    {TESTS.map((t) => {
                        const r = rows[t.id];
                        return (
                            <React.Fragment key={t.id}>
                                <div className={styles.cell} data-test-id={`ct-row-${t.id}-category`}>
                                    <Text size={200}>{t.category}</Text>
                                </div>
                                <div className={styles.cell} data-test-id={`ct-row-${t.id}-name`} title={t.name}>
                                    <Text font="monospace" size={200}>{t.name}</Text>
                                </div>
                                <div data-test-id={`ct-row-${t.id}-status`}>{statusBadge(r.status)}</div>
                                <div className={`${styles.cell} ${styles.detail}`} data-test-id={`ct-row-${t.id}-detail`} title={r.detail}>
                                    {r.detail || "—"}
                                </div>
                                <div data-test-id={`ct-run-${t.id}`}>
                                    <Button size="small" onClick={() => runOne(t)}>Run</Button>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
        </FluentProvider>
    );
};
