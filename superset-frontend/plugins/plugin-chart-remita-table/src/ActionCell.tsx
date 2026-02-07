import React, { memo, useRef } from 'react';
import { styled, useTheme } from '@apache-superset/core/ui';
import { Dropdown } from '@superset-ui/chart-controls';
import { Tooltip } from '@superset-ui/core/components';
import { EditOutlined, DeleteOutlined, EyeOutlined, LinkOutlined, CheckOutlined, KeyOutlined, TagOutlined, PlusOutlined, MoreOutlined } from '@ant-design/icons';

const ActionWrapper = styled.div`
  display: inline-block;
`;

/**
 * Helper: read RLS extra rules only from window.rls_extra_rules
 * This standardizes the source to a single, explicit global,
 * which should be set by the embedding host/backend.
 */
const getRlsExtraRules = (): Record<string, any> => {
  try {
    const fromWindow = (window as any).rls_extra_rules;
    if (fromWindow && typeof fromWindow === 'object') return fromWindow;

    // Fallback: attempt to decode rls_extra_rules from a stored JWT token
    const storedToken =
      (typeof localStorage !== 'undefined' && localStorage.getItem('access_token')) ||
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('access_token')) ||
      '';
    if (storedToken && storedToken.includes('.')) {
      try {
        const parts = storedToken.split('.');
        let payload = parts[1] || '';
        // Handle base64url -> base64 conversion
        payload = payload.replace(/-/g, '+').replace(/_/g, '/');
        while (payload.length % 4) payload += '=';
        const decoded = JSON.parse(atob(payload));
        if (decoded && typeof decoded === 'object' && decoded.rls_extra_rules) {
          return decoded.rls_extra_rules as Record<string, any>;
        }
      } catch {
        // ignore token decode errors
      }
    }
  } catch (error) {
    console.warn('Failed to get RLS extra rules:', error);
  }
  return {};
};

/**
 * Helper function to evaluate the visibility condition.
 * Expects a condition object with properties:
 * - source: 'column' (row data) or 'rls' (token data)
 * - column/rlsKey: the key to check
 * - operator: comparison operator
 * - value: value to compare against
 */
const evaluateVisibilityCondition = (
  condition: {
    source?: 'column' | 'rls';
    column?: string | string[];
    rlsKey?: string;
    operator?: string;
    value?: any;
  } | undefined,
  row: Record<string, any>,
) => {
  if (!condition || !condition.operator) return true;

  const source = condition.source || 'column';
  const operator = condition.operator;
  const condValue = condition.value;

  let rowValue: any;

  if (source === 'rls') {
    // Get value from RLS token
    if (!condition.rlsKey) return true;
    const rlsRules = getRlsExtraRules();
    rowValue = rlsRules[condition.rlsKey];
  } else {
    // Get value from row column (existing behavior)
    if (!condition.column) return true;
    const colKey = Array.isArray(condition.column)
      ? condition.column[0]
      : condition.column;
    rowValue = row[colKey as string];
  }

  // Improve numeric operator handling: if both values are numeric-like,
  // compare as numbers; otherwise fall back to safe string comparisons.
  const isNumericLike = (v: any) => {
    if (v === null || v === undefined || v === '') return false;
    const n = Number(v);
    return Number.isFinite(n);
  };
  const toNum = (v: any) => Number(v);

  switch (operator) {
    case "==":
      if (isNumericLike(rowValue) && isNumericLike(condValue)) return toNum(rowValue) === toNum(condValue);
      return String(rowValue) === String(condValue);
    case "!=":
      if (isNumericLike(rowValue) && isNumericLike(condValue)) return toNum(rowValue) !== toNum(condValue);
      return String(rowValue) !== String(condValue);
    case ">":
      if (isNumericLike(rowValue) && isNumericLike(condValue)) return toNum(rowValue) > toNum(condValue);
      return false;
    case "<":
      if (isNumericLike(rowValue) && isNumericLike(condValue)) return toNum(rowValue) < toNum(condValue);
      return false;
    case ">=":
      if (isNumericLike(rowValue) && isNumericLike(condValue)) return toNum(rowValue) >= toNum(condValue);
      return false;
    case "<=":
      if (isNumericLike(rowValue) && isNumericLike(condValue)) return toNum(rowValue) <= toNum(condValue);
      return false;
    case "IS NULL":
      return rowValue === null || rowValue === undefined;
    case "IS NOT NULL":
      return rowValue !== null && rowValue !== undefined;
    case "IN": {
      const list = String(condValue)
        .split(",")
        .map((s) => s.trim());
      return list.includes(String(rowValue));
    }
    case "NOT IN": {
      const list = String(condValue)
        .split(",")
        .map((s) => s.trim());
      return !list.includes(String(rowValue));
    }
    default:
      return true;
  }
};

/**
 * Evaluate grouped visibility conditions.
 * Supports both flat arrays of RLS conditions and grouped conditions with
 * joinOperator/groupJoinOperator where entries may be source: 'column' or 'rls'.
 */
const evaluateGroupedVisibilityConditions = (
  groupsOrConds:
    | Array<{
        rlsKey?: string;
        operator: string;
        value: any;
        source?: 'column' | 'rls';
        column?: string | string[];
      }>
    | Array<{
        conditions: Array<{
          rlsKey?: string;
          operator: string;
          value: any;
          source?: 'column' | 'rls';
          column?: string | string[];
        }>;
        joinOperator?: 'AND' | 'OR' | string;
        groupJoinOperator?: 'AND' | 'OR' | string;
      }>
    | undefined,
  row: Record<string, any>,
): { visible: boolean; matchingConditions: Record<string, any> } => {
  if (!groupsOrConds || groupsOrConds.length === 0) {
    return { visible: true, matchingConditions: {} };
  }

  const matchingRls: Record<string, any> = {};
  const rlsRules = getRlsExtraRules();

  const evalSingle = (cond: any): boolean => {
    const src = (cond?.source as string) || 'rls';
    if (src === 'column') {
      return evaluateVisibilityCondition(cond, row);
    }
    // RLS-based
    const rlsKey = cond?.rlsKey;
    const op = String(cond?.operator || '').toUpperCase();
    const val = cond?.value;
    const rlsVal = rlsRules[rlsKey];
    let passes = false;
    switch (op) {
      case '==':
        passes = rlsVal == val;
        break;
      case '!=':
        passes = rlsVal != val;
        break;
      case 'IN': {
        const list = String(val).split(',').map((s: string) => s.trim());
        passes = list.includes(String(rlsVal));
        break;
      }
      case 'NOT IN': {
        const list = String(val).split(',').map((s: string) => s.trim());
        passes = !list.includes(String(rlsVal));
        break;
      }
      default:
        passes = false;
    }
    if (passes && rlsKey) matchingRls[rlsKey] = rlsVal;
    return passes;
  };

  const isGroup = Array.isArray((groupsOrConds as any)[0]?.conditions);
  if (!isGroup) {
    // Flat array of conditions; all must pass
    for (const c of groupsOrConds as any[]) {
      if (!evalSingle(c)) return { visible: false, matchingConditions: {} };
    }
    return { visible: true, matchingConditions: matchingRls };
  }

  // Grouped conditions
  const groups = groupsOrConds as any[];
  const groupResults: boolean[] = groups.map(g => {
    const join = String(g?.joinOperator || 'AND').toUpperCase();
    const conds = Array.isArray(g?.conditions) ? g.conditions : [];
    if (conds.length === 0) return true;
    if (join === 'OR') {
      return conds.some(evalSingle);
    }
    // AND default
    return conds.every(evalSingle);
  });

  // Combine across groups using the first group's groupJoinOperator (default AND)
  const groupJoin = String(groups[0]?.groupJoinOperator || 'AND').toUpperCase();
  const visible = groupJoin === 'OR' ? groupResults.some(Boolean) : groupResults.every(Boolean);
  return { visible, matchingConditions: visible ? matchingRls : {} };
};

type RowActionPayload = {
  action: 'table-action';
  chartId?: string | number;
  key: string;
  value: any[];
  matchingRlsConditions?: Record<string, any>; // RLS conditions that matched
};

export type RowActionConfig = {
  key: string;
  label: string;
  icon?: 'plus' | 'edit' | 'delete' | 'eye' | 'link' | 'check' | 'key' | 'tag' | 'more';
  style?: 'default' | 'primary' | 'danger' | 'success' | 'warning';
  tooltip?: string;
  valueColumns?: string[];
  // Either a simple selection-based condition, or a column/RLS condition
  visibilityCondition?:
    | 'all'
    | 'selected'
    | 'unselected'
    | {
        source?: 'column' | 'rls';
        column?: string | string[];
        rlsKey?: string;
        operator?: string;
        value?: any;
      };
  rlsVisibilityConditions?: Array<{
    rlsKey: string;
    operator: string;
    value: any;
  }>;
  publishEvent?: boolean;
  // Per-action override to open target in new tab
  openInNewTab?: boolean;
};

export const ActionCell: React.FC<{
  rowId: string | number;
  actions: Set<RowActionConfig> | RowActionConfig[];
  row: Record<string, any>;
  chartId?: string | number;
  idColumn?: string;
  onActionClick: (actionInfo: RowActionPayload) => void;
  isSelected?: boolean;
}> = memo(({
                             rowId,
                             actions,
                             row,
                             chartId,
                             idColumn,
                           onActionClick,
                           isSelected = false,
                         }) => {
  const theme = useTheme();
  const handleActionClick = (
    e: any,
    config: any,
    matchingRlsConditions?: Record<string, any>,
  ) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    // If valueColumns are specified, trim the row payload to those keys
    let payloadRow = row;
    try {
      if (Array.isArray(config?.valueColumns) && config.valueColumns.length > 0) {
        const trimmed: Record<string, any> = {};
        config.valueColumns.forEach((k: string) => {
          if (k in row) trimmed[k] = row[k];
        });
        payloadRow = trimmed;
      }
    } catch {}
    const configExtended = config as any;
    const payload: RowActionPayload = {
      action: 'table-action',
      chartId: chartId,
      key: configExtended?.key,
      value: [payloadRow],
    };
    // Include matching RLS conditions if action publishes events and conditions exist
    if (configExtended?.publishEvent && matchingRlsConditions && Object.keys(matchingRlsConditions).length > 0) {
      payload.matchingRlsConditions = matchingRlsConditions;
    }
    onActionClick(payload);
  };

  // Filter and track RLS matching conditions for each action
  const visibleActionsWithRls = Array.from(actions as any)
    .map((config: RowActionConfig) => {
      // Check single visibility condition
      let passesBasicVisibility = true;
      const vc = config?.visibilityCondition as any;
      if (vc) {
        if (typeof vc === 'string') {
          // Selection-based condition
          passesBasicVisibility =
            vc === 'all' ||
            (vc === 'selected' && isSelected) ||
            (vc === 'unselected' && !isSelected);
        } else {
          // Column/RLS-based condition
          passesBasicVisibility = evaluateVisibilityCondition(vc, row);
        }
      }

      if (!passesBasicVisibility) {
        return null;
      }

      // Check grouped visibility conditions (RLS and column-based), if any
      const rlsResult = evaluateGroupedVisibilityConditions(
        (config as any).rlsVisibilityConditions,
        row,
      );
      if (!rlsResult.visible) {
        return null;
      }

      return { config, matchingRlsConditions: rlsResult.matchingConditions };
    })
    .filter((item) => item !== null);

  const visibleActions = visibleActionsWithRls.map((item: any) => item.config);

  const renderIcon = (name?: string, color?: string) => {
    switch (name) {
      case 'plus':
        return <PlusOutlined style={{ color }} />;
      case 'edit':
        return <EditOutlined style={{ color }} />;
      case 'delete':
        return <DeleteOutlined style={{ color }} />;
      case 'eye':
        return <EyeOutlined style={{ color }} />;
      case 'link':
        return <LinkOutlined style={{ color }} />;
      case 'check':
        return <CheckOutlined style={{ color }} />;
      case 'key':
        return <KeyOutlined style={{ color }} />;
      case 'tag':
        return <TagOutlined style={{ color }} />;
      case 'more':
        return <MoreOutlined style={{ color }} />;
      default:
        return undefined;
    }
  };

  const getStyleColor = (style?: string) => {
    switch (style) {
      case 'primary':
        return theme?.colorPrimary || '#1677ff';
      case 'danger':
        return (theme as any)?.colorError || '#ff4d4f';
      case 'success':
        return (theme as any)?.colorSuccess || '#52c41a';
      case 'warning':
        return (theme as any)?.colorWarning || '#faad14';
      case 'default':
      default:
        return theme?.colorTextSecondary || '#8c8c8c';
    }
  };

  const menuItems = visibleActions.map((config: RowActionConfig, index: number) => {
    const color = getStyleColor(config?.style);
    const content = (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color }}>
        {renderIcon(config?.icon, color)}
        <span>{config?.label}</span>
      </span>
    );
    return {
      key: String(config?.key || index),
      label: config?.tooltip ? (
        <Tooltip title={config?.tooltip}>{content}</Tooltip>
      ) : (
        content
      ),
    } as any;
  });

  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const onKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      triggerRef.current?.click();
    }
  };

  return (
    <td
      className="dt-is-filter right-border-only remita-action-col pinned-right"
      style={{
        textAlign: 'center',
        width: 28,
        position: 'sticky',
        right: 0,
        zIndex: 3,
        background: (theme as any)?.colorBgBase || '#fff'
      }}
    >
      <ActionWrapper>
        <Dropdown
          menu={{
            items: menuItems,
            onClick: ({ key, domEvent }: any) => {
              const item = visibleActionsWithRls.find(
                (item: any) => String(item.config?.key) === String(key),
              );
              if (item) {
                handleActionClick(domEvent, item.config, item.matchingRlsConditions);
              }
            },
          }}
          trigger={["click"]}
          placement="bottomRight"
        >
          <span
            ref={triggerRef}
            className="dt-ellipsis-button"
            role="button"
            aria-label="More options"
            tabIndex={0}
            onKeyDown={onKeyDown}
          >
            ⋮
          </span>
        </Dropdown>
      </ActionWrapper>
    </td>
  );
});

ActionCell.displayName = 'ActionCell';
