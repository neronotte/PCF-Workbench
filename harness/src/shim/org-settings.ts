import type { HarnessStore } from '../store/harness-store';

/**
 * `context.orgSettings` — exposes the host organisation's systemsettings row.
 *
 * Real UCI populates this from the Dataverse `organization` entity. The
 * workbench ships sensible defaults that mirror an out-of-the-box Dataverse
 * environment (UTC, USD, 5 MB upload limit, audit off). Controls that read
 * `context.orgSettings.attributes.<setting>` will see these values.
 *
 * Common consumers:
 *   - `maxuploadfilesize` (NoteTakingCtrl, file-upload PCFs)
 *   - `isauditenabled`
 *   - `currencydecimalprecision`
 *   - `weekstartdayCode`
 *
 * Future enhancement: allow data.json to ship a top-level `orgSettings`
 * block to override these defaults per-control. For now they're constant.
 *
 * See: https://learn.microsoft.com/power-apps/developer/component-framework/reference/orgsettings
 */
export function createOrgSettingsShim(getState: () => HarnessStore) {
  const attributes: Record<string, unknown> = {
    // File upload — 5 MB Dataverse default. Required by NoteTakingCtrl.
    maxuploadfilesize: 5_242_880,

    // Audit / compliance
    isauditenabled: false,
    isfileservercopyenabled: true,

    // Number / currency formatting
    currencydecimalprecision: 2,
    currencydisplayoption: 0,
    pricingdecimalprecision: 2,

    // Calendar
    weekstartdayCode: 0, // Sunday
    fiscalyearstart: '1/1',
    fiscalperiodtype: 2000, // Annually

    // Date / time formats (Dataverse en-US defaults)
    dateformatstring: 'MM/dd/yyyy',
    timeformatstring: 'h:mm tt',
    timeformatcode: 0,
    dateformatcode: 1,
    timeseparator: ':',
    dateseparator: '/',

    // Negative number / currency
    negativeformatcode: 1,
    negativecurrencyformatcode: 0,
    numberformat: 0,

    // Misc commonly-read flags
    sharingmode: 1,
    isappointmentbillingenabled: false,
    isduplicatedetectionenabled: false,
    isdefaultcountrycodecheckenabled: false,
    enablebingmapsintegration: false,
    enablepricingcalculationonquoteandorderonsave: true,
    requireapprovaltoorderforquotes: false,
  };

  return {
    /**
     * Dictionary mirroring the Dataverse `organization` entity's columns.
     * Reads (`attributes.maxuploadfilesize`) return the seeded default.
     */
    attributes,

    /** Empty GUID — overridden by data.json `orgSettings.organizationId` in future. */
    organizationId: '00000000-0000-0000-0000-000000000000',

    /** Display name of the org; safe placeholder for workbench runs. */
    uniqueName: 'pcfworkbench',

    /** Default LCID; tracks the workbench user-language setting so locale-aware
     * controls behave consistently across `userSettings` and `orgSettings`. */
    get languageId() {
      return getState().userLanguageId;
    },

    /** Base currency — USD placeholder. */
    baseCurrencyId: '00000000-0000-0000-0000-000000000000',

    /** Autosave is off by default in workbench runs so authors can observe
     * explicit Save flows. */
    isAutoSaveEnabled: false,

    /** WebResource hash — empty placeholder. */
    webResourceHash: '',
  };
}
