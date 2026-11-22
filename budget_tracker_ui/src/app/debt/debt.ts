// FILE: src/app/debt/debt.ts  (NEW file)
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { AgChartOptions } from 'ag-charts-community';
import { MatDialog } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { chartTheme, toneColor } from '../shared/chart-theme';
import { formatUsd, formatUsdExact } from '../shared/design-tokens';
import { DebtHistoryMonth, DebtLoan, DebtService, DebtSummary } from './debt-service';
import { LoanSetupData, LoanSetupDialog } from './loan-setup-dialog';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Component({
  selector: 'app-debt',
  standalone: false,
  templateUrl: './debt.html',
  styleUrl: './debt.css',
})
export class Debt implements OnInit, OnDestroy {
  summary: DebtSummary | null = null;
  state: 'loading' | 'ready' | 'unavailable' = 'loading';

  /** The loan shown in the detail section (history chart + "pay extra"). */
  selected: DebtLoan | null = null;
  history: DebtHistoryMonth[] = [];
  historyState: 'idle' | 'loading' | 'ready' | 'unavailable' = 'idle';
  historyChartOptions!: AgChartOptions;

  scenarioForm = new FormGroup({
    extra: new FormControl<number | null>(200, [Validators.min(0)]),
    lump: new FormControl<number | null>(0, [Validators.min(0)]),
  });
  scenario: any = null;
  scenarioBusy = false;

  usd = formatUsd;
  usdExact = formatUsdExact;

  private dark = false;
  private themeObserver?: MutationObserver;

  constructor(
    private debtSrv: DebtService,
    private toastr: ToastrService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.dark = this.isDarkTheme();
    this.themeObserver = new MutationObserver(() => {
      const dark = this.isDarkTheme();
      if (dark !== this.dark) {
        this.dark = dark;
        this.buildHistoryChart();
      }
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    this.load();
  }

  ngOnDestroy(): void {
    this.themeObserver?.disconnect();
  }

  load(): void {
    this.state = 'loading';
    this.debtSrv.summary().subscribe({
      next: (data) => {
        this.summary = data;
        this.state = 'ready';
        // Open the first active loan (else the first set-up loan) so the page is never empty.
        const keep = this.selected && data.loans.find((l) => l.category_id === this.selected!.category_id);
        const first =
          keep ??
          data.loans.find((l) => l.status === 'active') ??
          data.loans.find((l) => !l.setup_needed) ??
          null;
        if (first) this.select(first);
      },
      error: () => {
        this.summary = null;
        this.state = 'unavailable';
        this.toastr.error('Could not load debt payoff. Check that the API is running and up to date.');
      },
    });
  }

  select(loan: DebtLoan): void {
    this.selected = loan;
    this.scenario = null;
    if (loan.setup_needed) {
      this.history = [];
      this.historyState = 'idle';
      return;
    }
    this.historyState = 'loading';
    this.debtSrv.history(loan.category_id).subscribe({
      next: (data) => {
        this.history = data?.months ?? [];
        this.historyState = 'ready';
        this.buildHistoryChart();
      },
      error: () => {
        this.history = [];
        this.historyState = 'unavailable';
      },
    });
  }

  runScenario(): void {
    if (!this.selected || this.scenarioForm.invalid) return;
    const extra = Number(this.scenarioForm.value.extra) || 0;
    const lump = Number(this.scenarioForm.value.lump) || 0;
    this.scenarioBusy = true;
    this.debtSrv.scenario(this.selected.category_id, extra, lump).subscribe({
      next: (data) => {
        this.scenario = data;
        this.scenarioBusy = false;
      },
      error: (err) => {
        this.scenarioBusy = false;
        this.toastr.error(err?.error?.error ?? 'Could not calculate that scenario.');
      },
    });
  }

  // ---------- Set up / edit loans ----------

  /** A brand-new loan: creates its debt category, then its details. */
  addLoan(): void {
    this.openDialog({ mode: 'account' });
  }

  /** Set up a category that has no details yet, or edit saved details. */
  editLoan(loan: DebtLoan): void {
    if (loan.setup_needed) {
      this.openDialog({ mode: 'account', categoryId: loan.category_id, categoryName: loan.category, account: null });
      return;
    }
    this.debtSrv.accounts().subscribe({
      next: (rows) => {
        const row = rows.find((r) => r.category_id === loan.category_id);
        this.openDialog({
          mode: 'account',
          categoryId: loan.category_id,
          categoryName: loan.category,
          account: row?.account ?? null,
        });
      },
      error: () => this.toastr.error('Could not load the loan details.'),
    });
  }

  /** Record a balance from the lender's app or statement. */
  updateBalance(loan: DebtLoan): void {
    this.openDialog({ mode: 'balance', categoryId: loan.category_id, categoryName: loan.category });
  }

  private openDialog(data: LoanSetupData): void {
    this.dialog
      .open(LoanSetupDialog, { width: '620px', maxWidth: '94vw', maxHeight: '90vh', autoFocus: 'dialog', data })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) this.load();
      });
  }

  // ---------- Display helpers ----------

  statusLabel(loan: DebtLoan): string {
    if (loan.status === 'paid_off') return 'Paid off';
    if (loan.status === 'setup_needed') return 'Not set up';
    return 'Active';
  }

  statusTone(loan: DebtLoan): string {
    if (loan.status === 'paid_off') return 'tone-income';
    if (loan.status === 'setup_needed') return 'tone-neutral';
    return 'tone-debt';
  }

  /** "2027-03" -> "Mar 2027" */
  monthText(key: string | null | undefined): string {
    if (!key) return '—';
    const [y, m] = key.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }

  /** "2026-11-28" -> "Nov 28, 2026" */
  dayText(iso: string | null | undefined): string {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  }

  progress(loan: DebtLoan): number {
    return Math.max(0, Math.min(100, loan.progress_pct ?? 0));
  }

  /** Rough balance once the future-dated payments go through (interest left out). */
  afterScheduled(loan: DebtLoan): number {
    return Math.max(0, (loan.balance ?? 0) - loan.scheduled.total);
  }

  paymentsLeft(loan: DebtLoan): string {
    const months = loan.projection?.months;
    if (months == null) return '—';
    return `${months} ${months === 1 ? 'payment' : 'payments'}`;
  }

  /** Short explanation of the gap between the app's estimate and the lender's balance. */
  correctionNote(loan: DebtLoan): string | null {
    const s = loan.last_statement;
    if (!s) return null;
    const gap = Math.abs(s.correction);
    if (gap < 1) return `Matches the lender balance from ${this.dayText(s.date)}.`;
    const direction = s.correction < 0 ? 'lower' : 'higher';
    return (
      `Lender balance on ${this.dayText(s.date)} was ${this.usdExact(gap)} ${direction} than the ` +
      `payments in the app explain` +
      (s.correction < 0 ? ', so some payments may not be entered.' : '.')
    );
  }

  // ---------- Chart ----------

  private buildHistoryChart(): void {
    const tracked = this.history.filter((m) => m.balance_end !== null);
    const data = tracked.map((m) => ({
      label: m.label.replace('-', ' '),
      principal: m.principal ?? 0,
      interest: m.interest ?? 0,
      balance: m.balance_end,
    }));
    const debtColor = toneColor('debt', this.dark);
    const interestColor = toneColor('expense', this.dark);
    const balanceColor = toneColor('savings', this.dark);

    this.historyChartOptions = {
      theme: chartTheme(this.dark),
      background: { visible: false },
      data,
      series: [
        {
          type: 'bar',
          xKey: 'label',
          yKey: 'principal',
          yName: 'Paid off the loan',
          stacked: true,
          fill: debtColor,
          stroke: debtColor,
          tooltip: { renderer: (p: any) => ({ title: p.datum.label, content: `Principal ${formatUsdExact(p.datum.principal)}` }) },
        },
        {
          type: 'bar',
          xKey: 'label',
          yKey: 'interest',
          yName: 'Interest',
          stacked: true,
          fill: interestColor,
          stroke: interestColor,
          tooltip: { renderer: (p: any) => ({ title: p.datum.label, content: `Interest ${formatUsdExact(p.datum.interest)}` }) },
        },
        {
          type: 'line',
          xKey: 'label',
          yKey: 'balance',
          yName: 'Balance owed',
          stroke: balanceColor,
          strokeWidth: 2.5,
          marker: { size: 5, fill: balanceColor, stroke: balanceColor },
          tooltip: { renderer: (p: any) => ({ title: p.datum.label, content: `Owed ${formatUsdExact(p.datum.balance)}` }) },
        },
      ],
      axes: [
        { type: 'category', position: 'bottom' },
        {
          type: 'number',
          position: 'left',
          keys: ['principal', 'interest'],
          title: { text: 'Paid per month' },
          label: { formatter: (p: any) => formatUsd(p.value) },
        },
        {
          type: 'number',
          position: 'right',
          keys: ['balance'],
          title: { text: 'Balance owed' },
          label: { formatter: (p: any) => formatUsd(p.value) },
        },
      ],
      legend: { position: 'bottom' },
    } as AgChartOptions;
  }

  private isDarkTheme(): boolean {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }
}
