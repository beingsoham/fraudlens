import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatTile } from '../src/components/layout/StatTile.jsx';
import { Pagination, EmptyState, ErrorBlock, Modal } from '../src/components/ui/index.jsx';
import {
  AlertStatusBadge,
  OutcomeBadge,
  RiskBadge,
  RiskScoreBar,
} from '../src/components/ui/StatusBadges.jsx';
import { RiskDistributionChart, TopRulesChart } from '../src/components/charts/index.jsx';
import { ApiError } from '../src/services/api.js';

/**
 * Component tests.
 *
 * These check the behaviour that matters to a person using the tool: that a
 * figure carries its definition, that a risk score is never presented as proof
 * of fraud, that pagination reports the real row window, and that an empty
 * chart says so rather than drawing an empty frame.
 */

describe('StatTile', () => {
  it('renders the label and value', () => {
    render(<StatTile label="Open alerts" value="42" />);
    expect(screen.getByText('Open alerts')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('exposes the metric definition to assistive technology', () => {
    render(
      <StatTile
        label="Flagged value"
        value="₹1.00"
        definition="Sum of the amounts of transactions whose latest assessment is HIGH."
      />,
    );
    // Every figure on a dashboard must carry its definition, reachable by
    // keyboard and screen reader rather than hover alone.
    expect(
      screen.getByRole('button', { name: /Definition: Sum of the amounts/ }),
    ).toBeInTheDocument();
  });

  it('shows a placeholder while loading instead of a stale value', () => {
    const { container } = render(<StatTile label="Total" value="99" isLoading />);
    expect(screen.queryByText('99')).not.toBeInTheDocument();
    expect(container.querySelector('.skeleton')).toBeTruthy();
  });
});

describe('risk presentation', () => {
  it('shows the category and score together', () => {
    render(<RiskBadge category="HIGH" score={84} />);
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('84')).toBeInTheDocument();
  });

  it('states that a risk score is not a finding of fraud', () => {
    render(<RiskBadge category="HIGH" score={95} withTooltip />);
    const tip = screen.getByRole('button', { name: /Definition:/ });
    expect(tip.getAttribute('aria-label')).toMatch(/not a finding of fraud/i);
  });

  it('describes the score as a meter with its bounds', () => {
    render(
      <RiskScoreBar
        score={72}
        thresholds={{ mediumThreshold: 30, highThreshold: 70, alertThreshold: 70 }}
      />,
    );
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '72');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText(/Medium at 30/)).toBeInTheDocument();
  });

  it('says a transaction is unassessed rather than showing a zero score', () => {
    render(<RiskScoreBar score={null} />);
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('keeps workflow status and investigation outcome visually separate', () => {
    render(
      <div>
        <AlertStatusBadge status="RESOLVED" />
        <OutcomeBadge outcome="CONFIRMED_FRAUD" />
      </div>,
    );
    // Two distinct statements: where the alert sits, and what was concluded.
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('Confirmed fraud')).toBeInTheDocument();
  });

  it('labels an unresolved alert as having no conclusion', () => {
    render(<OutcomeBadge outcome="PENDING" />);
    expect(screen.getByText('No conclusion yet')).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  const meta = {
    page: 2,
    pageSize: 25,
    total: 137,
    totalPages: 6,
    hasNextPage: true,
    hasPreviousPage: true,
  };

  it('reports the row window, not just the page number', () => {
    render(<Pagination meta={meta} onPageChange={() => {}} />);
    expect(screen.getByText('26')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('137')).toBeInTheDocument();
  });

  it('moves between pages', async () => {
    const onPageChange = vi.fn();
    render(<Pagination meta={meta} onPageChange={onPageChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenCalledWith(1);

    await userEvent.click(screen.getByRole('button', { name: 'Last' }));
    expect(onPageChange).toHaveBeenCalledWith(6);
  });

  it('disables navigation at the ends of the range', () => {
    render(
      <Pagination meta={{ ...meta, page: 1, hasPreviousPage: false }} onPageChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'First' })).toBeDisabled();
  });

  it('renders nothing when there are no rows', () => {
    const { container } = render(
      <Pagination meta={{ ...meta, total: 0 }} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ErrorBlock', () => {
  it('shows the message and the request id for correlation', () => {
    const error = new ApiError('Something failed', { status: 500, requestId: 'req-abc-123' });
    render(<ErrorBlock error={error} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something failed')).toBeInTheDocument();
    expect(screen.getByText(/req-abc-123/)).toBeInTheDocument();
  });

  it('offers a retry for a transient failure', async () => {
    const onRetry = vi.fn();
    render(<ErrorBlock error={new ApiError('Network down', { status: 0 })} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('does not offer a retry for a permission failure, which retrying cannot fix', () => {
    render(
      <ErrorBlock
        error={new ApiError('Your role does not include audit:read', { status: 403 })}
        onRetry={() => {}}
      />,
    );
    // The heading names the class of problem, the body gives the API's reason.
    expect(screen.getByText('Not permitted')).toBeInTheDocument();
    expect(screen.getByText('Your role does not include audit:read')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
  });

  it('renders nothing without an error', () => {
    const { container } = render(<ErrorBlock error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Modal', () => {
  it('renders only when open', () => {
    const { rerender } = render(
      <Modal open={false} title="Resolve alert" onClose={() => {}}>
        body
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <Modal open title="Resolve alert" onClose={() => {}}>
        body
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('closes on the close button and on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Resolve alert" onClose={onClose}>
        body
      </Modal>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('charts', () => {
  it('says there is no data rather than drawing an empty frame', () => {
    render(<RiskDistributionChart categories={[]} />);
    expect(screen.getByText('No data in this range')).toBeInTheDocument();
  });

  it('explains how to get data when a rule chart is empty', () => {
    render(<TopRulesChart rules={[]} />);
    expect(screen.getByText(/No detection rule has triggered/)).toBeInTheDocument();
  });

  it('renders a chart when data is present', () => {
    const { container } = render(
      <RiskDistributionChart
        categories={[
          { category: 'LOW', count: 80, value: 1000, share: 80 },
          { category: 'HIGH', count: 20, value: 500, share: 20 },
        ]}
      />,
    );
    expect(screen.queryByText('No data in this range')).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it('says what would make rows appear', () => {
    render(
      <EmptyState
        title="No transactions match these filters"
        hint="Try widening the date range."
      />,
    );
    expect(screen.getByText('No transactions match these filters')).toBeInTheDocument();
    expect(screen.getByText('Try widening the date range.')).toBeInTheDocument();
  });
});
