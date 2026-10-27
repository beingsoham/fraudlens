import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CHART_COLORS,
  formatCurrencyCompact,
  formatNumber,
  riskStyle,
} from '../../utils/format.js';
import { formatBucketLabel } from '../../utils/dateRanges.js';
import { EmptyState } from '../ui/index.jsx';

/**
 * Chart components.
 *
 * Shared conventions, applied to every chart here:
 *  - axis and grid colours come from `CHART_COLORS`, so charts sit on the dark
 *    surface without glare;
 *  - risk series always use the risk palette, so "high" is the same red
 *    everywhere;
 *  - a chart with no data renders an explicit empty state rather than an empty
 *    axis frame, which otherwise reads as "zero" instead of "nothing to show".
 */

const axisProps = {
  stroke: CHART_COLORS.axis,
  tick: { fill: CHART_COLORS.axis, fontSize: 11 },
  tickLine: false,
};

/** Dark-surface tooltip shared by every chart. */
function ChartTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/80 bg-white/90 px-3 py-2 shadow-glass backdrop-blur-md">
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-fg-muted">
        {labelFormatter ? labelFormatter(label) : label}
      </p>
      {payload.map((entry) => (
        <p key={entry.dataKey ?? entry.name} className="tabular flex items-center gap-2 text-xs">
          <span
            className="h-2 w-2 shrink-0 rounded-sm"
            style={{ backgroundColor: entry.color ?? entry.fill }}
            aria-hidden="true"
          />
          <span className="text-fg-muted">{entry.name}</span>
          <span className="ml-auto font-medium text-fg">
            {formatter ? formatter(entry.value, entry.dataKey) : formatNumber(entry.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

function NoChartData({ hint }) {
  return (
    <EmptyState
      title="No data in this range"
      hint={hint ?? 'Widen the date range, or run the simulator to generate activity.'}
      className="py-10"
    />
  );
}

/** Transaction count and value over time, as a stacked risk breakdown. */
export function TransactionVolumeChart({ points, interval, height = 260 }) {
  if (!points?.length || points.every((point) => point.count === 0)) {
    return <NoChartData />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <defs>
          {['low', 'medium', 'high'].map((key) => (
            <linearGradient key={key} id={`vol-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS[key]} stopOpacity={0.45} />
              <stop offset="100%" stopColor={CHART_COLORS[key]} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="bucket"
          {...axisProps}
          tickFormatter={(value) => formatBucketLabel(value, interval)}
          minTickGap={24}
        />
        <YAxis {...axisProps} allowDecimals={false} width={44} />
        <Tooltip
          content={<ChartTooltip labelFormatter={(value) => formatBucketLabel(value, interval)} />}
        />
        <Legend
          iconType="circle"
          iconSize={7}
          wrapperStyle={{ fontSize: 11, color: CHART_COLORS.axis, paddingTop: 8 }}
        />
        {/* Stacked so the total height is the transaction count and the bands
            show how that total splits by risk. */}
        <Area
          type="monotone"
          dataKey="lowRisk"
          name="Low risk"
          stackId="risk"
          stroke={CHART_COLORS.low}
          fill="url(#vol-low)"
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="mediumRisk"
          name="Medium risk"
          stackId="risk"
          stroke={CHART_COLORS.medium}
          fill="url(#vol-medium)"
          strokeWidth={1.5}
        />
        <Area
          type="monotone"
          dataKey="highRisk"
          name="High risk"
          stackId="risk"
          stroke={CHART_COLORS.high}
          fill="url(#vol-high)"
          strokeWidth={1.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Transaction value over time. */
export function TransactionValueChart({ points, interval, height = 220 }) {
  if (!points?.length || points.every((point) => point.value === 0)) return <NoChartData />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <defs>
          <linearGradient id="value-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS.accent} stopOpacity={0.4} />
            <stop offset="100%" stopColor={CHART_COLORS.accent} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="bucket"
          {...axisProps}
          tickFormatter={(value) => formatBucketLabel(value, interval)}
          minTickGap={24}
        />
        <YAxis {...axisProps} width={56} tickFormatter={formatCurrencyCompact} />
        <Tooltip
          content={
            <ChartTooltip
              formatter={(value) => formatCurrencyCompact(value)}
              labelFormatter={(value) => formatBucketLabel(value, interval)}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="value"
          name="Transaction value"
          stroke={CHART_COLORS.accent}
          fill="url(#value-grad)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Risk-category distribution as a donut. */
export function RiskDistributionChart({ categories, height = 240 }) {
  const data = (categories ?? []).filter((entry) => entry.count > 0);
  if (!data.length) return <NoChartData />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="category"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
          stroke="none"
        >
          {data.map((entry) => (
            <Cell key={entry.category} fill={riskStyle(entry.category).hex} />
          ))}
        </Pie>
        <Tooltip
          content={
            <ChartTooltip
              formatter={(value) => formatNumber(value)}
              labelFormatter={(value) => riskStyle(value).label}
            />
          }
        />
        <Legend
          iconType="circle"
          iconSize={7}
          formatter={(value) => riskStyle(value).label}
          wrapperStyle={{ fontSize: 11, color: CHART_COLORS.axis }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Alert creation versus resolution, with confirmed fraud called out. */
export function AlertTrendChart({ points, interval, height = 240 }) {
  if (!points?.length || points.every((point) => point.created === 0 && point.resolved === 0)) {
    return <NoChartData hint="No alerts were created or resolved in this range." />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="bucket"
          {...axisProps}
          tickFormatter={(value) => formatBucketLabel(value, interval)}
          minTickGap={24}
        />
        <YAxis {...axisProps} allowDecimals={false} width={40} />
        <Tooltip
          content={<ChartTooltip labelFormatter={(value) => formatBucketLabel(value, interval)} />}
        />
        <Legend
          iconType="circle"
          iconSize={7}
          wrapperStyle={{ fontSize: 11, color: CHART_COLORS.axis, paddingTop: 8 }}
        />
        <Line
          type="monotone"
          dataKey="created"
          name="Alerts created"
          stroke={CHART_COLORS.accent}
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="resolved"
          name="Alerts resolved"
          stroke={CHART_COLORS.low}
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="confirmedFraud"
          name="Confirmed fraud"
          stroke={CHART_COLORS.critical}
          strokeWidth={2}
          strokeDasharray="4 3"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bar chart of the most frequently triggered rules. */
export function TopRulesChart({ rules, height = 280 }) {
  if (!rules?.length) {
    return <NoChartData hint="No detection rule has triggered in this range." />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rules} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" {...axisProps} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="ruleId"
          {...axisProps}
          width={150}
          tick={{ fill: CHART_COLORS.axis, fontSize: 10 }}
          tickFormatter={(value) => value.replace(/_/g, ' ').toLowerCase()}
        />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="triggerCount" name="Times triggered" radius={[0, 3, 3, 0]}>
          {rules.map((rule) => {
            // Coloured by the share of this rule's firings that landed on a
            // HIGH-risk assessment, so the chart distinguishes rules that
            // actually drive alerts from those that merely fire often. A plain
            // "has it ever contributed to a HIGH score" test colours every bar
            // the same once the dataset is large enough to be interesting.
            const highShare = rule.triggerCount > 0 ? rule.highRiskCount / rule.triggerCount : 0;
            const fill =
              highShare >= 0.25
                ? CHART_COLORS.high
                : highShare >= 0.1
                  ? CHART_COLORS.medium
                  : CHART_COLORS.accent;
            return <Cell key={rule.ruleId} fill={fill} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Risk-score histogram with the configured thresholds marked. */
export function ScoreHistogramChart({ bands, thresholds, height = 240 }) {
  if (!bands?.length || bands.every((band) => band.count === 0)) return <NoChartData />;

  const colourFor = (band) => {
    if (thresholds && band.min >= thresholds.highThreshold) return CHART_COLORS.high;
    if (thresholds && band.min >= thresholds.mediumThreshold) return CHART_COLORS.medium;
    return CHART_COLORS.low;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={bands} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} allowDecimals={false} width={44} />
        <Tooltip content={<ChartTooltip labelFormatter={(value) => `Score ${value}`} />} />
        <Bar dataKey="count" name="Transactions" radius={[3, 3, 0, 0]}>
          {bands.map((band) => (
            <Cell key={band.band} fill={colourFor(band)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Confirmed fraud versus legitimate outcomes. */
export function OutcomeChart({ outcomes, height = 240 }) {
  const data = (outcomes ?? []).filter((entry) => entry.count > 0);
  if (!data.length) {
    return (
      <NoChartData hint="No alert has been resolved with a conclusive outcome in this range." />
    );
  }

  const colours = {
    CONFIRMED_FRAUD: CHART_COLORS.critical,
    LEGITIMATE: CHART_COLORS.low,
    INCONCLUSIVE: CHART_COLORS.medium,
    PENDING: CHART_COLORS.muted,
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="outcome"
          {...axisProps}
          tickFormatter={(value) => value.replace(/_/g, ' ').toLowerCase()}
        />
        <YAxis {...axisProps} allowDecimals={false} width={40} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="count" name="Alerts" radius={[3, 3, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.outcome} fill={colours[entry.outcome] ?? CHART_COLORS.muted} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export { ChartTooltip, NoChartData };
