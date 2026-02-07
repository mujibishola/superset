# Remita Table Plugin

Remita Table extends the core Table visualization with server pagination, selection-aware bulk/row actions, advanced per-column filters, header pinning/visibility, and hardened URL/event handling.

Quick links:
- Production readiness: PRODUCTION_READINESS.md
- Security notes and fixes: SECURITY_FIXES.md, HIGH_PRIORITY_FIXES.md
- Backward compatibility aids: BACKWARD_COMPATIBILITY.md
- Column presets UX: COLUMN_PRESETS.md

## Overview

- Reuses the core Table chart component; enhances data transforms, UX, and security.
- Registered through Superset’s preset like other charts; build/query/transform props are plugin-specific.
- Compiled output in `lib/` and `esm/` references the local base table plugin via relative paths for robustness during development.

## Getting Started

1) Add a new chart with type “Remita Table”.
2) Data tab: configure columns/metrics/filters as with the core Table.
3) Customize tab:
   - Actions section: set up bulk and row actions (details below)
   - Column options: visibility, pinning, resizing
   - Advanced filters: enable per-column advanced filters (optional)

Build/dev tips:
- After editing code under `src/`, rebuild the workspace plugins to refresh `lib/`/`esm/`:
  - From `superset-frontend/`: `npm run plugins:build`

## Server Pagination

- Controls:
  - `Server pagination` (on/off)
  - `Server Page Length` (> 0 to paginate)
  - `Exact total row count` (adds a COUNT(*) query for precise page counts)
- Exact totals: backend should return a second query with `data: [{ rowcount: <number> }]` for precise pagination.
- Fallback estimation: when exact totals are not returned, page count is estimated conservatively from the current page size and row count.

## Selection and Actions

### Bulk actions (top bar)

- Types:
  - Split actions (dropdown) – optionally moved to slice header
  - Non-split actions (inline buttons)
- Key fields (per action):
  - `key`, `label`, optional `style` (default/primary/danger/success/warning), `icon`, `tooltip`
  - `boundToSelection` (true = uses selected rows; false = may act on all/none)
  - `visibilityCondition`: 'all' | 'selected' | 'unselected'
  - `showInSliceHeader` (for non-split)
  - `publishEvent` (default true) vs `actionUrl` navigation (when false)
  - `openInNewTab` (navigation only)
  - `includeDashboardFilters` (include native filters and extras in URL/query params)

### Row actions (per-row menu)

- Key fields:
  - `key`, `label`, optional `style`, `icon`, `tooltip`
  - `valueColumns` (string[]) – trim the event payload to specific fields
  - `visibilityCondition`:
    - 'all' | 'selected' | 'unselected' (selection-aware), or
    - object with `{ source: 'column' | 'rls', column|rlsKey, operator, value }`
  - `rlsVisibilityConditions`: supports arrays of groups with `conditions` and `joinOperator` (AND/OR) and a `groupJoinOperator` across groups.
  - `publishEvent`/`actionUrl`/`openInNewTab`/`includeDashboardFilters` as above

#### Visibility evaluation order
1) Selection-based visibility ('selected'/'unselected'/'all')
2) Single column/RLS condition in `visibilityCondition` (if object)
3) Grouped conditions `rlsVisibilityConditions` (supports column + RLS entries, AND/OR at condition and group level)

#### Event payloads
- Bulk action publish-event payload:
  ```json
  {
    "action": "bulk-action",
    "chartId": <slice id>,
    "actionType": "<action key>",
    "values": [ { /* selected row objects (trimmed by valueColumns if set) */ } ],
    "origin": "bulk",
    "nativeFilters": { /* optional */ },
    "nativeParams": { /* optional */ },
    "queryParams": { /* optional, sanitized */ },
    "resolvedUrl": "https://..." /* when includeDashboardFilters = true and navigation is expected */
  }
  ```
- Row action publish-event payload:
  ```json
  {
    "action": "table-action",
    "chartId": <slice id>,
    "key": "<action key>",
    "value": [ { /* single row object (trimmed by valueColumns if set) */ } ],
    "matchingRlsConditions": { /* optional: matched RLS key/values */ }
  }
  ```

## Filters

- Quick filters: lightweight contains-search per column
- Advanced column filters: when enabled, a “Filters” tag appears next to the header controls and a per-column advanced filter UI is available in the header menu.
- The Filters tag only renders when “Enable advanced column filters” is on.
- On server pagination, “Apply Filters” updates data by pushing filters to `ownState` for backend processing.

## Columns: Visibility, Pinning, Resizing

- Visibility: toggle per-column visibility; persistent via localStorage (`visibleColumns_<sliceId>`)
- Pinning: pin left/right per column; persisted
- Resizing: per-column width; auto-size helpers; persisted (`columnWidths_<sliceId>`)
- Column order is persisted as stable keys (`columnOrder_<sliceId>`); the selection column stays first.

## Security Model (summary)

- URL navigation is sanitized client-side:
  - Blocks `javascript:`, `data:`, `vbscript:`, `file:` schemes
  - Requires `http:` or `https:`
  - Validates target origin against an allowlist (`window.REMITA_TABLE_ALLOWED_ACTION_ORIGINS`), with current origin always allowed
- Dashboard/native filter params are sanitized before inclusion in URLs (control chars/XSS vectors removed; length limited)
- See SECURITY_FIXES.md and PRODUCTION_READINESS.md for details.

## Performance Notes

- Server pagination: use a practical `Server Page Length`; enable “Exact total row count” when precise page counts matter
- Search highlighting is optimized; only rebuilds regex when query changes
- Exports are chunked for large datasets to keep the UI responsive

## Known Limitations

- Percentage time comparison intentionally caps division-by-zero to ±100% (documented in PRODUCTION_READINESS.md)
- Header humanization is heuristic; acronyms may need manual labels
- Grouped visibilityConditions are supported as documented above; ensure JSON structure follows `{ conditions, joinOperator, groupJoinOperator }`

## Backward Compatibility

- See BACKWARD_COMPATIBILITY.md for migrated/aliased option names and safe defaults that prevent breaking existing charts.

## Local Base Plugin Reuse (for maintainers)

- The compiled `esm/` and `lib/` import the local base table plugin via `../../plugin-chart-table/src/*` to avoid brittle package subpaths during dev.
- Webpack aliasing under the monorepo maps to `src/` for consistent local development.

