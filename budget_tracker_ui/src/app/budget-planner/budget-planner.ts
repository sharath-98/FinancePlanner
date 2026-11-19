// FILE: src/app/budget-planner/budget-planner.ts  (REPLACE existing file)
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, ViewChild } from '@angular/core';
import {
  type CellClassParams,
  type CellStyle,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type RowClassParams,
  type ValueParserParams,
} from 'ag-grid-community';
import { Observable, catchError, forkJoin, of } from 'rxjs';
import { BudgetPlannerService } from './budget-planner-service';
import { MatAccordion } from '@angular/material/expansion';
import { ToastrService } from 'ngx-toastr';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmReplaceDialog } from './confirm-replace-dialog';
import { gridTheme, moneyCellClass, moneyFormatter } from '../shared/grid-theme';
import { formatUsd } from '../shared/design-tokens';

@Component({
  selector: 'app-budget-planner',
  templateUrl: './budget-planner.html',
  styleUrl: './budget-planner.css',
  standalone: false,
})
export class BudgetPlanner implements OnInit {
  @ViewChild(MatAccordion) accordion!: MatAccordion;

  /* Income starts open; the other sections open on demand (or with "Expand all") */
  incomePanelOpenState = true;
  expensePanelOpenState = false;
  savingsPanelOpenState = false;
  debtPanelOpenState = false;

  years: number[] = [];
  selectedYear?: number;
  usd = formatUsd;

  allocatedGridApi!: GridApi<any>;
  incomeGridApi!: GridApi<any>;
  expenseGridApi!: GridApi<any>;
  savingsGridApi!: GridApi<any>;
  debtGridApi!: GridApi<any>;

  grandAllocatedRow: any = {};
  grandTotalRow: any = {};
  grandExpenseTotalRow: any = {};
  grandSavingsTotalRow: any = {};
  grandDebtTotalRow: any = {};

  allocatedRowData: any = [];
  rowData: any = [];
  rowExpenseData: any = [];
  rowSavingsData: any = [];
  rowDebtData: any = [];

  /** Year total of what is left after expenses, savings and debt (shown in the banner). */
  unallocatedTotal = 0;

  /* One shared grid theme, tinted per money category (see shared/grid-theme.ts) */
  incomeTheme = gridTheme('income');
  expenseTheme = gridTheme('expense');
  savingsTheme = gridTheme('savings');
  debtTheme = gridTheme('debt');
  allocatedTheme = gridTheme('neutral');

  /** Grids grow to fit their rows, so there are no fixed heights to break on small screens. */
  readonly domLayout = 'autoHeight' as const;

  /** Marks the Total row so styles.scss (.total-row) can emphasize it. */
  getRowClass = (params: RowClassParams): string | undefined => {
    const row = params.data;
    return row && Object.values(row).includes('Total') ? 'total-row' : undefined;
  };

  /** Column widths are chosen once, when the page loads. */
  private isPhone = window.matchMedia('(max-width: 720px)').matches;
  /** Fixed width of the pinned label column (category names). */
  private labelWidth = this.isPhone ? 150 : 210;

  months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  private monthCol(month: string): ColDef {
    return {
      field: month,
      headerName: month,
      valueParser: this.numberParser,
      valueFormatter: moneyFormatter,
      cellClass: moneyCellClass,
      type: 'rightAligned',
      // Never narrower than 100px; any spare width is shared between the month columns
      minWidth: 100,
      flex: 1,
    };
  }

  common_colDefs: ColDef[] = [
    ...this.months.map((m) => this.monthCol(m)),
    {
      field: 'Total',
      headerName: 'Total',
      editable: false,
      type: 'rightAligned',
      minWidth: 120,
      flex: 1,
      cellStyle: { fontWeight: 'bold' },
      valueFormatter: moneyFormatter,
      valueGetter: (params: any) => {
        const cols = this.months; // your month columns
        return cols.reduce((a, c) => a + (+params.data[c] || 0), 0);
      },
    },
  ];

  /* The label column stays pinned on the left so category names remain visible when scrolling months */
  colDefs: ColDef[] = [
    {
      field: 'Income',
      headerName: 'Income',
      editable: false,
      pinned: 'left',
      lockPinned: true,
      width: this.labelWidth,
    },
    ...this.common_colDefs,
  ];
  colExpenseDefs: ColDef[] = [
    {
      field: 'Expenses',
      headerName: 'Expenses',
      editable: false,
      pinned: 'left',
      lockPinned: true,
      width: this.labelWidth,
    },
    ...this.common_colDefs,
  ];
  colSavingsDefs: ColDef[] = [
    {
      field: 'Savings',
      headerName: 'Savings',
      editable: false,
      pinned: 'left',
      lockPinned: true,
      width: this.labelWidth,
    },
    ...this.common_colDefs,
  ];
  colDebtsDefs: ColDef[] = [
    {
      field: 'Debts',
      headerName: 'Debts',
      editable: false,
      pinned: 'left',
      lockPinned: true,
      width: this.labelWidth,
    },
    ...this.common_colDefs,
  ];

  /** Read-only monthly view; negative months turn red. */
  allocatedColDefs: ColDef[] = [
    {
      field: 'label',
      headerName: '',
      editable: false,
      pinned: 'left',
      lockPinned: true,
      width: this.labelWidth,
    },
    ...this.months.map(
      (m): ColDef => ({
        field: m,
        headerName: m,
        type: 'rightAligned',
        minWidth: 100,
        flex: 1,
        valueFormatter: moneyFormatter,
        cellStyle: (p: CellClassParams): CellStyle | null =>
          Number(p.value) < 0 ? { color: 'var(--negative)' } : null,
      }),
    ),
    {
      field: 'Total',
      headerName: 'Total',
      type: 'rightAligned',
      minWidth: 120,
      flex: 1,
      valueFormatter: moneyFormatter,
      cellStyle: (p: CellClassParams): CellStyle =>
        Number(p.value) < 0
          ? { color: 'var(--negative)', fontWeight: 'bold' }
          : { fontWeight: 'bold' },
    },
  ];

  defaultColDef: ColDef = {
    filter: true, // Enable filtering on all columns
    editable: true, // Enable editing on all columns
    sortable: true,
  };

  readOnlyColDef: ColDef = {
    editable: false,
    filter: false,
    sortable: false,
  };

  numberParser(params: ValueParserParams): number | string {
    return Number.isNaN(Number(params.newValue)) ? params.oldValue : Number(params.newValue);
  }

  onGridReady(params: GridReadyEvent<any>, category: string) {
    if (category == 'Income') {
      this.incomeGridApi = params.api;
    } else if (category == 'Expense') {
      this.expenseGridApi = params.api;
    } else if (category == 'Debts') {
      this.debtGridApi = params.api;
    } else if (category == 'Allocated') {
      this.allocatedGridApi = params.api;
    } else {
      this.savingsGridApi = params.api;
    }
  }

  calculateColTotals(rowData: any, colId: any) {
    const lastRowIndex = rowData.length - 1;

    // Calculate total for this column excluding the total row
    let colTotal = 0;
    for (let i = 0; i < lastRowIndex; i++) {
      colTotal += Number(rowData[i][colId]) || 0;
    }

    // Update total row value for this column
    rowData[lastRowIndex][colId] = colTotal;

    // Optionally, update grand total if you have a 'Total' column as well
    if (colId !== 'Total') {
      let grandTotal = 0;
      const monthCols = this.months; // Adjust as per your month columns
      monthCols.forEach((col) => {
        grandTotal += Number(rowData[lastRowIndex][col]) || 0;
      });
      rowData[lastRowIndex]['Total'] = grandTotal;
    }
  }

  /** Copies the Total row (without its label) so the banner and section headers can read it. */
  calGrandTotal(data: any, category: string) {
    const last = data?.length ? data[data.length - 1] : {};
    const labelKey = category === 'Expense' ? 'Expenses' : category;
    const totals = Object.fromEntries(Object.entries(last).filter(([key]) => key !== labelKey));

    if (category == 'Income') {
      this.grandTotalRow = totals;
    } else if (category == 'Expense') {
      this.grandExpenseTotalRow = totals;
    } else if (category == 'Savings') {
      this.grandSavingsTotalRow = totals;
    } else if (category == 'Debts') {
      this.grandDebtTotalRow = totals;
    }
  }

  /** Income minus expenses, savings and debt, per month and for the year. */
  getUnallocated() {
    const num = (row: any, key: string) => Number(row?.[key]) || 0;
    const row: any = { label: 'Unallocated' };
    let yearTotal = 0;

    for (const month of this.months) {
      const value =
        num(this.grandTotalRow, month) -
        (num(this.grandExpenseTotalRow, month) +
          num(this.grandSavingsTotalRow, month) +
          num(this.grandDebtTotalRow, month));
      row[month] = Math.round(value * 100) / 100;
      yearTotal += row[month];
    }
    row['Total'] = Math.round(yearTotal * 100) / 100;

    this.grandAllocatedRow = [row];
    this.allocatedRowData = [row];
    this.unallocatedTotal = row['Total'];
  }

  onCellValueChanged(event: any, category: any) {
    const colId = event.colDef.field;
    if (event.newValue === event.oldValue) {
      return;
    }
    const payload = {
      data: {
        month: colId,
        year: this.selectedYear,
        type: category,
        amount: event.data[colId],
        category: event.data[category],
      },
    };

    // Ask the API what this month already holds. If transactions are logged there, confirm first.
    const { amount, ...cell } = payload.data;
    this.bdjSrv.get_month_activity({ data: cell }).subscribe({
      next: (activity) => {
        if (Number(activity?.transaction_count) > 0) {
          this.dialog
            .open(ConfirmReplaceDialog, {
              width: '420px',
              maxWidth: '92vw',
              data: {
                category: payload.data.category,
                month: colId,
                year: this.selectedYear,
                transactionCount: Number(activity.transaction_count),
                transactionTotal: Number(activity.transaction_total),
                plannerAmount: Number(activity.planner_amount),
                newAmount: Number(amount),
              },
            })
            .afterClosed()
            .subscribe((confirmed) => {
              if (confirmed) {
                this.applyEdit(payload, colId, category);
              } else {
                this.getInitialGrids(); // put the saved number back in the cell
              }
            });
        } else {
          this.applyEdit(payload, colId, category);
        }
      },
      // If the check itself fails, do not block the edit; the save below reports any real problem.
      error: () => this.applyEdit(payload, colId, category),
    });
  }

  /** Updates the totals on screen and saves the typed amount. */
  private applyEdit(payload: any, colId: string, category: any) {
    if (category == 'Income') {
      this.calculateColTotals(this.rowData, colId);
      this.calGrandTotal(this.rowData, 'Income');
      this.incomeGridApi.refreshCells({ force: true });
    } else if (category == 'Expenses') {
      this.calculateColTotals(this.rowExpenseData, colId);
      this.calGrandTotal(this.rowExpenseData, 'Expense');
      this.expenseGridApi.refreshCells({ force: true });
    } else if (category == 'Savings') {
      this.calculateColTotals(this.rowSavingsData, colId);
      this.calGrandTotal(this.rowSavingsData, 'Savings');
      this.savingsGridApi.refreshCells({ force: true });
    } else if (category == 'Debts') {
      this.calculateColTotals(this.rowDebtData, colId);
      this.calGrandTotal(this.rowDebtData, 'Debts');
      this.debtGridApi.refreshCells({ force: true });
    }
    this.getUnallocated();

    this.bdjSrv.update_src_data(payload).subscribe({
      next: () => this.getInitialGrids(),
      error: () => {
        // The API answers with a real error when a save fails; show it and reload the saved numbers
        this.toastr.error(
          'Could not save that change. Check that the API is running and try again.',
        );
        this.getInitialGrids();
      },
    });
  }

  constructor(
    private http: HttpClient,
    private bdjSrv: BudgetPlannerService,
    private toastr: ToastrService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    const currentYear = new Date().getFullYear();
    this.selectedYear = currentYear;
    for (let y = currentYear; y >= currentYear - 10; y--) {
      this.years.push(y);
    }
    this.getInitialGrids();
  }

  /** Loads all four tables together, so the Unallocated banner is complete as soon as it appears. */
  getInitialGrids() {
    const year = { year: this.selectedYear };
    const load = (request: Observable<any>, label: string) =>
      request.pipe(
        catchError(() => {
          this.toastr.error(`Error in retrieving ${label} records.`);
          return of(null);
        }),
      );

    forkJoin({
      income: load(this.bdjSrv.get_monthly_income(year), 'income'),
      expenses: load(this.bdjSrv.get_monthly_expenses(year), 'expense'),
      savings: load(this.bdjSrv.get_monthly_savings(year), 'savings'),
      debts: load(this.bdjSrv.get_monthly_debts(year), 'debt'),
    }).subscribe(({ income, expenses, savings, debts }) => {
      this.rowData = Array.isArray(income) ? income : [];
      this.rowExpenseData = Array.isArray(expenses) ? expenses : [];
      this.rowSavingsData = Array.isArray(savings) ? savings : [];
      this.rowDebtData = Array.isArray(debts) ? debts : [];

      this.calGrandTotal(this.rowData, 'Income');
      this.calGrandTotal(this.rowExpenseData, 'Expense');
      this.calGrandTotal(this.rowSavingsData, 'Savings');
      this.calGrandTotal(this.rowDebtData, 'Debts');
      this.getUnallocated();
    });
  }

  onYearChange(event: any) {
    this.selectedYear = event.value;
    this.getInitialGrids();
  }
}
