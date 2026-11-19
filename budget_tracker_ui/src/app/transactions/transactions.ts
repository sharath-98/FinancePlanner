// FILE: src/app/transactions/transactions.ts  (REPLACE existing file)
import { Component, OnInit, ViewChild } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  FormGroupDirective,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatSelectChange } from '@angular/material/select';
import { type CellClassParams, type CellStyle, type ColDef } from 'ag-grid-community';
import { ToastrService } from 'ngx-toastr';
import { Observable, combineLatest, map, startWith } from 'rxjs';
import { TransactionService } from './transaction-service';
import { gridTheme, moneyFormatter } from '../shared/grid-theme';
import { formatUsd } from '../shared/design-tokens';

interface Category {
  id: number;
  name: string;
  type: string;
}

interface SummaryCard {
  key: string;
  label: string;
  value: number;
  note: string;
  /** Class from styles.scss that sets the card's accent color */
  tone: 'tone-income' | 'tone-expense' | 'tone-savings' | 'tone-debt';
}

interface TopCategory {
  name: string;
  amount: number;
  /** Share of all expenses in the period, as a whole percent */
  share: number;
  /** Bar length as a percent of the biggest category */
  width: number;
}

/** Transaction types as stored in the database, with the words shown on screen. */
const TYPE_LABELS: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  saving: 'Savings',
  debt: 'Debt',
};
const TYPE_ORDER = ['expense', 'income', 'saving', 'debt'];
const TYPE_COLORS: Record<string, string> = {
  expense: 'var(--expense)',
  income: 'var(--income)',
  saving: 'var(--savings)',
  debt: 'var(--debt)',
};

/** The category box must hold a category picked from the list, not free text. */
function categoryPicked(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  return value && typeof value === 'object' && value.id ? null : { categoryPicked: true };
}

/** The API sends dates as MM-DD-YYYY text; sort them as real dates. */
function dateKey(value?: string): number {
  if (!value) return 0;
  const [month, day, year] = value.split('-').map(Number);
  return year * 10000 + month * 100 + day;
}

@Component({
  selector: 'app-transactions',
  standalone: false,
  templateUrl: './transactions.html',
  styleUrl: './transactions.css',
  // Full dates (day included) in the date picker, whatever the rest of the app uses
  providers: [provideNativeDateAdapter()],
})
export class Transactions implements OnInit {
  @ViewChild(FormGroupDirective) formDir!: FormGroupDirective;

  categories: Category[] = [];
  types: string[] = [];
  currencies = ['USD'];
  users: { id: number; name: string }[] = [];

  transactionForm: FormGroup;
  filteredCategories!: Observable<Category[]>;
  merchants: string[] = [];
  filteredMerchants: string[] = [];
  isNewMerchantEntry = false;

  saving = false;
  /** On phones the form is collapsed until "Add transaction" is tapped. */
  formOpen = false;

  years: number[] = [];
  selectedYear!: number;
  /** 0 means the whole year; otherwise 1-12. Starts on the current month. */
  selectedMonth = new Date().getMonth() + 1;
  readonly months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  /** Every transaction in the selected year. */
  private allRows: any[] = [];
  /** The rows for the chosen month (or the whole year). Totals and top categories use these. */
  private monthRows: any[] = [];
  /** What the grid shows: monthRows, narrowed to one category when a top category is selected. */
  rowData: any[] = [];
  rowsLoaded = false;

  usd = formatUsd;
  summaryCards: SummaryCard[] = [];
  topCategories: TopCategory[] = [];
  selectedCategory = '';
  search = '';

  theme = gridTheme('neutral');

  /** Column choices for small screens are made once, when the page loads. */
  private isPhone = window.matchMedia('(max-width: 720px)').matches;

  colDefs: ColDef[] = [
    {
      field: 'date',
      headerName: 'Date',
      minWidth: 120,
      flex: 1,
      comparator: (a: string, b: string) => dateKey(a) - dateKey(b),
      sort: 'desc',
    },
    {
      field: 'type',
      headerName: 'Type',
      hide: this.isPhone,
      minWidth: 110,
      flex: 1,
      valueFormatter: (p) => TYPE_LABELS[p.value] ?? p.value,
      cellStyle: (p: CellClassParams): CellStyle | null => {
        const color = TYPE_COLORS[p.value];
        return color ? { color, fontWeight: 600 } : null;
      },
    },
    { field: 'category', headerName: 'Category', minWidth: this.isPhone ? 160 : 200, flex: 2 },
    { field: 'merchant', headerName: 'Merchant', minWidth: this.isPhone ? 140 : 180, flex: 2 },
    {
      field: 'amount',
      headerName: 'Amount',
      type: 'rightAligned',
      minWidth: 120,
      flex: 1,
      valueFormatter: moneyFormatter,
    },
    { field: 'details', headerName: 'Details', hide: this.isPhone, minWidth: 240, flex: 3 },
  ];

  defaultColDef: ColDef = {
    filter: true,
    sortable: true,
    resizable: true,
    editable: false, // there is no update endpoint yet, so edits would not be saved
  };

  constructor(
    private transSrv: TransactionService,
    private toastr: ToastrService,
    private fb: FormBuilder,
  ) {
    this.transactionForm = this.fb.group({
      type: ['expense', Validators.required],
      category: ['', [Validators.required, categoryPicked]],
      merchant: ['', Validators.required],
      date: [new Date(), Validators.required],
      amount: ['', [Validators.required, Validators.min(0.01)]],
      paidby: ['', Validators.required],
      currency: ['USD', Validators.required],
      details: [''],
    });
  }

  ngOnInit(): void {
    const currentYear = new Date().getFullYear();
    this.selectedYear = currentYear;
    for (let y = currentYear; y >= currentYear - 10; y--) {
      this.years.push(y);
    }

    this.transSrv.get_users().subscribe((data) => {
      this.users = Array.isArray(data) ? data : [];
    });

    this.transSrv.get_categories().subscribe((data) => {
      this.categories = data?.['categories'] ?? [];
      const types: string[] = data?.['types'] ?? [];
      this.types = [...types].sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));
      // Re-run the category filter now that the list has arrived
      this.transactionForm.get('category')!.updateValueAndValidity();
    });

    const typeControl = this.transactionForm.get('type')!;
    const categoryControl = this.transactionForm.get('category')!;
    const merchantControl = this.transactionForm.get('merchant')!;

    // Category choices follow the selected type
    this.filteredCategories = combineLatest([
      typeControl.valueChanges.pipe(startWith(typeControl.value)),
      categoryControl.valueChanges.pipe(startWith(categoryControl.value)),
    ]).pipe(
      map(([type, category]) =>
        this.filterCategories(type, typeof category === 'string' ? category : category?.name),
      ),
    );

    // Changing the type clears the category and merchant, which belong to the old type
    typeControl.valueChanges.subscribe(() => {
      categoryControl.setValue('');
      merchantControl.setValue('');
      this.clearMerchants();
    });

    merchantControl.valueChanges.subscribe((value) => this.onMerchantInput(value));

    this.loadTransactions();
  }

  /* ---------- Form helpers ---------- */

  typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  displayCategory(category: any): string {
    return category && category.name ? category.name.trim() : '';
  }

  private filterCategories(type: string, text?: string): Category[] {
    const needle = (text ?? '').toLowerCase();
    return this.categories.filter(
      (c) => (!type || c.type === type) && c.name.toLowerCase().includes(needle),
    );
  }

  onCategorySelected(): void {
    const category = this.transactionForm.value.category;
    this.clearMerchants();
    this.transactionForm.patchValue({ merchant: '' });

    if (!category?.id) return;
    this.transSrv.get_subcategory({ category_id: category.id }).subscribe((data) => {
      this.merchants = Array.isArray(data) ? data : [];
      this.filteredMerchants = [...this.merchants];
    });
  }

  private clearMerchants(): void {
    this.merchants = [];
    this.filteredMerchants = [];
    this.isNewMerchantEntry = false;
  }

  private onMerchantInput(value: string): void {
    const text = (value ?? '').trim().toLowerCase();
    this.filteredMerchants = this.merchants.filter((m) => m.toLowerCase().includes(text));
    const hasCategory = !!this.transactionForm.value.category?.id;
    this.isNewMerchantEntry =
      hasCategory && text.length > 0 && !this.merchants.some((m) => m.toLowerCase() === text);
  }

  addNewMerchant(): void {
    const { category, merchant } = this.transactionForm.value;
    const name = String(merchant ?? '').trim();
    if (!category?.id || !name) return;

    this.transSrv.save_subcategory({ category_id: category.id, merchant: name }).subscribe({
      next: (rows) => {
        this.merchants = Array.isArray(rows)
          ? rows.map((r: any) => r.merchant)
          : [...this.merchants, name];
        this.filteredMerchants = [...this.merchants];
        this.isNewMerchantEntry = false;
        this.toastr.success('Merchant added.');
      },
      error: () =>
        this.toastr.error(
          'Could not add the merchant. Check that the API is running and try again.',
        ),
    });
  }

  /* ---------- Save and reset ---------- */

  onSubmit(): void {
    if (this.transactionForm.invalid || this.saving) return;

    const value = this.transactionForm.value;
    const payload = {
      transaction: {
        ...value,
        date: new Date(value.date).toISOString(),
        details: value.details ?? '',
      },
    };

    this.saving = true;
    this.transSrv.save_expense(payload).subscribe({
      next: () => {
        this.saving = false;
        this.toastr.success('Transaction saved.');
        // Keep type, date, payer and currency so a run of entries is quick to enter
        this.formDir.resetForm({
          ...this.defaultValues(),
          type: value.type,
          date: value.date,
          paidby: value.paidby,
          currency: value.currency,
        });
        this.clearMerchants();
        this.formOpen = false;
        this.showMonthOf(value.date);
        this.loadTransactions();
      },
      error: () => {
        this.saving = false;
        this.toastr.error(
          'Could not save the transaction. Check the fields and that the API is running.',
        );
      },
    });
  }

  onReset(): void {
    this.formDir.resetForm(this.defaultValues());
    this.clearMerchants();
  }

  private defaultValues() {
    return {
      type: 'expense',
      category: '',
      merchant: '',
      date: new Date(),
      amount: '',
      paidby: '',
      currency: 'USD',
      details: '',
    };
  }

  /* ---------- Grid ---------- */

  onYearChange(event: MatSelectChange): void {
    this.selectedYear = event.value;
    this.selectedCategory = '';
    this.loadTransactions();
  }

  onMonthChange(event: MatSelectChange): void {
    this.selectedMonth = event.value;
    this.selectedCategory = '';
    this.applyMonthFilter();
  }

  /** "November 2026", or just "2026" when the whole year is shown. */
  get periodLabel(): string {
    return this.selectedMonth === 0
      ? String(this.selectedYear)
      : `${this.months[this.selectedMonth - 1]} ${this.selectedYear}`;
  }

  /** After saving, jump to the month of the new transaction so it is visible in the list. */
  private showMonthOf(date: Date | string): void {
    this.selectedCategory = '';
    const saved = new Date(date);
    if (this.years.includes(saved.getFullYear())) {
      this.selectedYear = saved.getFullYear();
      if (this.selectedMonth !== 0) {
        this.selectedMonth = saved.getMonth() + 1;
      }
    }
  }

  /** Rows arrive as MM-DD-YYYY text, so the month is the part before the first dash. */
  private monthOf(row: any): number {
    return Number(String(row.date).split('-')[0]);
  }

  private applyMonthFilter(): void {
    this.monthRows =
      this.selectedMonth === 0
        ? this.allRows
        : this.allRows.filter((row) => this.monthOf(row) === this.selectedMonth);
    this.buildSummary();
    this.applyCategoryFilter();
  }

  private applyCategoryFilter(): void {
    this.rowData = this.selectedCategory
      ? this.monthRows.filter((row) => String(row.category).trim() === this.selectedCategory)
      : this.monthRows;
  }

  /** Tapping a top category narrows the list to it; tapping it again shows everything. */
  toggleCategory(name: string): void {
    this.selectedCategory = this.selectedCategory === name ? '' : name;
    this.applyCategoryFilter();
  }

  clearCategory(): void {
    this.selectedCategory = '';
    this.applyCategoryFilter();
  }

  /** Sums amounts per transaction type (the API may send amounts as text, so convert). */
  private totals(rows: any[]): Record<string, number> {
    const sums: Record<string, number> = { income: 0, expense: 0, saving: 0, debt: 0 };
    for (const row of rows) {
      if (row.type in sums) {
        sums[row.type] += Number(row.amount) || 0;
      }
    }
    return sums;
  }

  /** Builds the summary cards and top expense categories from the rows for the period shown. */
  private buildSummary(): void {
    const current = this.totals(this.monthRows);

    // Compare with the month before, when it is in the same year (so not for January or All year)
    const canCompare = this.selectedMonth >= 2;
    const previous = canCompare
      ? this.totals(this.allRows.filter((row) => this.monthOf(row) === this.selectedMonth - 1))
      : null;
    const previousName = canCompare ? this.months[this.selectedMonth - 2] : '';

    const change = (key: string): string | null => {
      if (!previous) return null;
      const before = previous[key];
      if (before === 0) return `None recorded in ${previousName}`;
      const pct = Math.round(((current[key] - before) / before) * 100);
      if (pct === 0) return `Same as ${previousName}`;
      return pct > 0
        ? `Up ${pct}% from ${previousName}`
        : `Down ${Math.abs(pct)}% from ${previousName}`;
    };

    const countNote = (type: string): string => {
      const n = this.monthRows.filter((row) => row.type === type).length;
      return `${n} ${n === 1 ? 'transaction' : 'transactions'}`;
    };

    this.summaryCards = [
      {
        key: 'expense',
        label: 'Expenses',
        value: current['expense'],
        tone: 'tone-expense',
        note: change('expense') ?? countNote('expense'),
      },
      {
        key: 'income',
        label: 'Income',
        value: current['income'],
        tone: 'tone-income',
        note: change('income') ?? countNote('income'),
      },
      {
        key: 'saving',
        label: 'Savings',
        value: current['saving'],
        tone: 'tone-savings',
        note: change('saving') ?? countNote('saving'),
      },
      {
        key: 'debt',
        label: 'Debt',
        value: current['debt'],
        tone: 'tone-debt',
        note: change('debt') ?? countNote('debt'),
      },
    ];

    // Top five expense categories
    const byCategory = new Map<string, number>();
    for (const row of this.monthRows) {
      if (row.type !== 'expense') continue;
      const name = String(row.category).trim();
      byCategory.set(name, (byCategory.get(name) ?? 0) + (Number(row.amount) || 0));
    }
    const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const biggest = top.length ? top[0][1] : 0;
    const expenseTotal = current['expense'];

    this.topCategories = top.map(([name, amount]) => ({
      name,
      amount,
      share: expenseTotal > 0 ? Math.round((amount / expenseTotal) * 100) : 0,
      width: biggest > 0 ? Math.max(4, (amount / biggest) * 100) : 0,
    }));
  }

  loadTransactions(): void {
    this.transSrv.get_yearly_transactions({ year: this.selectedYear }).subscribe({
      next: (data) => {
        this.allRows = Array.isArray(data) ? data : [];
        this.applyMonthFilter();
        this.rowsLoaded = true;
      },
      error: () => {
        // The API answers with an error when a year has no transactions yet
        this.allRows = [];
        this.applyMonthFilter();
        this.rowsLoaded = true;
      },
    });
  }
}
