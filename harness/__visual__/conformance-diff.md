# PCF Workbench — UCI Conformance Diff

Generated 2026-05-07T08:27:05.538Z from `node_modules\@types\xrm\index.d.ts` and `node_modules\@types\powerapps-component-framework\componentframework.d.ts`.

| Namespace | Source | Total | Implemented | Stub/Missing | Coverage |
|-----------|--------|------:|------------:|-------------:|---------:|
| `WebApi` | @types/xrm | 2 | 2 | 0 | 100% |
| `Navigation` | @types/xrm | 9 | 7 | 2 | 78% |
| `Utility` | @types/xrm | 16 | 10 | 6 | 63% |
| `Encoding` | @types/xrm | 5 | 5 | 0 | 100% |
| `Device` | @types/xrm | 6 | 6 | 0 | 100% |
| `App` | @types/xrm | 3 | 3 | 0 | 100% |
| `Panel` | @types/xrm | 1 | 1 | 0 | 100% |
| `FormContext` | @types/xrm | 4 | 4 | 0 | 100% |
| `Context` | @types/powerapps-component-framework | 15 | 15 | 0 | 100% |
| **Total** | | **61** | **53** | **8** | **87%** |


## WebApi (@types/xrm)

**Implemented (2):** `online`, `offline`

<sub>Intentionally omitted: `isAvailableOffline`</sub>


## Navigation (@types/xrm)

**Implemented (7):** `navigateTo`, `openAlertDialog`, `openConfirmDialog`, `openErrorDialog`, `openFile`, `openForm`, `openUrl`

**Missing (2):** `items`, `openWebResource`


## Utility (@types/xrm)

**Implemented (10):** `closeProgressIndicator`, `getEntityMetadata`, `getGlobalContext`, `getResourceString`, `invokeProcessAction`, `lookupObjects`, `refreshParentGrid`, `showProgressIndicator`, `alertDialog`, `confirmDialog`

**Missing (6):** `getAllowedStatusTransitions`, `getPageContext`, `isActivityType`, `openQuickCreate`, `openEntityForm`, `openWebResource`

<sub>Intentionally omitted: `getLearningPathAttributeName`</sub>


## Encoding (@types/xrm)

**Implemented (5):** `htmlAttributeEncode`, `htmlDecode`, `htmlEncode`, `xmlAttributeEncode`, `xmlEncode`


## Device (@types/xrm)

**Implemented (6):** `captureAudio`, `captureImage`, `captureVideo`, `getBarcodeValue`, `getCurrentPosition`, `pickFile`


## App (@types/xrm)

**Implemented (3):** `addGlobalNotification`, `clearGlobalNotification`, `sidePanes`


## Panel (@types/xrm)

**Implemented (1):** `loadPanel`


## FormContext (@types/xrm)

**Implemented (4):** `data`, `ui`, `getAttribute`, `getControl`


## Context (@types/powerapps-component-framework)

**Implemented (15):** `client`, `device`, `factory`, `formatting`, `mode`, `navigation`, `resources`, `userSettings`, `utils`, `webAPI`, `parameters`, `updatedProperties`, `events`, `fluentDesignLanguage`, `copilot`
