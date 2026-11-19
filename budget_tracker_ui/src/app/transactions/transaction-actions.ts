// FILE: src/app/transactions/transaction-actions.ts  (NEW file)
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { Observable, map } from 'rxjs';
import { formatUsdExact } from '../shared/design-tokens';
import { ConfirmDialog } from './confirm-dialog';
import { EditDialogData, EditTransactionDialog, Entry, parseDay } from './edit-transaction-dialog';
import { TransactionService } from './transaction-service';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Edit and delete, shared by the grid buttons and the "Find entry" window so both behave the same. */
@Injectable({ providedIn: 'root' })
export class TransactionActions {
  constructor(
    private dialog: MatDialog,
    private transSrv: TransactionService,
    private toastr: ToastrService,
  ) {}

  /** The full stored transaction (the grid rows do not carry the category id or payer). */
  loadEntry(id: number): Observable<Entry | null> {
    return this.transSrv
      .search_transactions({ id })
      .pipe(map((rows) => (Array.isArray(rows) && rows[0]) || null));
  }

  /** Opens the edit form. onDone runs after a successful save. */
  edit(
    entry: Entry,
    categories: EditDialogData['categories'],
    users: EditDialogData['users'],
    onDone: () => void,
  ): void {
    this.dialog
      .open(EditTransactionDialog, {
        width: '560px',
        maxWidth: '94vw',
        maxHeight: '92vh',
        data: { entry, categories, users } as EditDialogData,
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) onDone();
      });
  }

  /** Asks first, then deletes. onDone runs after a successful delete; onSettled after any outcome. */
  remove(entry: Entry, onDone: () => void, onSettled?: () => void): void {
    const d = parseDay(entry.date);
    const amount = formatUsdExact(Number(entry.amount));

    this.dialog
      .open(ConfirmDialog, {
        width: '460px',
        maxWidth: '92vw',
        data: {
          title: 'Delete this transaction?',
          message: 'This cannot be undone.',
          details: [
            `${entry.merchant} · ${entry.category}`,
            `${amount} on ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
            `Planner: ${entry.category}, ${MONTHS[d.getMonth()]} ${d.getFullYear()} −${amount}`,
          ],
          confirmLabel: 'Delete',
          danger: true,
        },
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (!confirmed) {
          onSettled?.();
          return;
        }
        this.transSrv.delete_transaction({ id: entry.id }).subscribe({
          next: () => {
            this.toastr.success('Transaction deleted.');
            onDone();
            onSettled?.();
          },
          error: (error: HttpErrorResponse) => {
            this.toastr.error(
              error.status === 0
                ? 'Cannot reach the server. Check that the API is running.'
                : (error.error?.error ?? 'Could not delete the transaction.'),
            );
            // The entry may already be gone (deleted elsewhere), so the lists reload either way.
            onDone();
            onSettled?.();
          },
        });
      });
  }
}
