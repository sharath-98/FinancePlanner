// FILE: src/app/transactions/entry-finder-dialog.ts  (NEW file)
import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subscription, debounceTime, distinctUntilChanged, startWith, switchMap, tap } from 'rxjs';
import { formatUsdExact } from '../shared/design-tokens';
import { EditDialogData, Entry, parseDay } from './edit-transaction-dialog';
import { TransactionActions } from './transaction-actions';
import { TransactionService } from './transaction-service';

export interface FinderData {
  categories: EditDialogData['categories'];
  users: EditDialogData['users'];
  /** Called after an entry is edited or deleted, so the page behind can reload its list. */
  onChanged?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  saving: 'Savings',
  debt: 'Debt',
};
const TYPE_TONES: Record<string, string> = {
  expense: 'tone-expense',
  income: 'tone-income',
  saving: 'tone-savings',
  debt: 'tone-debt',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Component({
  selector: 'app-entry-finder-dialog',
  templateUrl: './entry-finder-dialog.html',
  styleUrl: './entry-finder-dialog.css',
  standalone: false,
})
export class EntryFinderDialog implements OnInit, OnDestroy {
  query = new FormControl('', { nonNullable: true });
  entries: Entry[] = [];
  loading = true;
  loadFailed = false;
  /** Set while an entry is being deleted, so its buttons cannot be pressed twice. */
  busyId: number | null = null;
  readonly limit = 25;

  private subscription?: Subscription;

  constructor(
    private transSrv: TransactionService,
    private actions: TransactionActions,
    private dialogRef: MatDialogRef<EntryFinderDialog>,
    @Inject(MAT_DIALOG_DATA) public data: FinderData,
  ) {}

  ngOnInit(): void {
    // Shows the newest entries first, then searches shortly after typing stops.
    this.subscription = this.query.valueChanges
      .pipe(
        startWith(this.query.value),
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => (this.loading = true)),
        switchMap((text) =>
          this.transSrv.search_transactions({ query: text.trim(), limit: this.limit }),
        ),
      )
      .subscribe({
        next: (rows) => this.show(rows),
        error: () => this.fail(),
      });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private show(rows: unknown): void {
    this.entries = Array.isArray(rows) ? rows : [];
    this.loading = false;
    this.loadFailed = false;
  }

  private fail(): void {
    this.loading = false;
    this.loadFailed = true;
  }

  /** Runs the current search again (after an edit or delete). */
  private refresh(): void {
    this.loading = true;
    this.transSrv
      .search_transactions({ query: this.query.value.trim(), limit: this.limit })
      .subscribe({
        next: (rows) => this.show(rows),
        error: () => this.fail(),
      });
  }

  typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  tone(type: string): string {
    return TYPE_TONES[type] ?? 'tone-neutral';
  }

  money(amount: number | string): string {
    return formatUsdExact(Number(amount));
  }

  dayLabel(day: string): string {
    const d = parseDay(day);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  edit(entry: Entry): void {
    this.actions.edit(entry, this.data.categories, this.data.users, () => this.changed());
  }

  remove(entry: Entry): void {
    this.busyId = entry.id;
    this.actions.remove(
      entry,
      () => this.changed(),
      () => (this.busyId = null),
    );
  }

  private changed(): void {
    this.refresh();
    this.data.onChanged?.();
  }

  close(): void {
    this.dialogRef.close();
  }
}
