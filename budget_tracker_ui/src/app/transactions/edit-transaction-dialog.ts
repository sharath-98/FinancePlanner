// FILE: src/app/transactions/edit-transaction-dialog.ts  (NEW file)
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Inject } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { formatUsdExact } from '../shared/design-tokens';
import { ConfirmDialog } from './confirm-dialog';
import { TransactionService } from './transaction-service';

export interface Entry {
  id: number;
  date: string; // YYYY-MM-DD
  type: string;
  category_id: number;
  category: string;
  amount: number | string;
  merchant: string;
  details: string;
  paidby: number;
  paid_by_name: string | null;
}

export interface EditDialogData {
  entry: Entry;
  categories: { id: number; type: string; name: string }[];
  users: { id: number; name: string }[];
}

const TYPE_LABELS: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  saving: 'Savings',
  debt: 'Debt',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-03-09" -> a local Date (no time zone shift). */
export const parseDay = (text: string): Date => {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(y, m - 1, d);
};
/** A local Date -> "2026-03-09". */
export const formatDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

@Component({
  selector: 'app-edit-transaction-dialog',
  templateUrl: './edit-transaction-dialog.html',
  styleUrl: './edit-transaction-dialog.css',
  standalone: false,
})
export class EditTransactionDialog {
  form: FormGroup<{
    type: FormControl<string | null>;
    category: FormControl<number | null>;
    merchant: FormControl<string | null>;
    date: FormControl<Date | null>;
    amount: FormControl<number | null>;
    paidby: FormControl<number | null>;
    details: FormControl<string | null>;
  }>;
  readonly types = Object.keys(TYPE_LABELS);
  saving = false;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private transSrv: TransactionService,
    private toastr: ToastrService,
    private dialog: MatDialog,
    private dialogRef: MatDialogRef<EditTransactionDialog, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: EditDialogData,
  ) {
    const e = data.entry;
    this.form = this.fb.group({
      type: [e.type, Validators.required],
      category: [e.category_id as number | null, Validators.required],
      merchant: [e.merchant, [Validators.required, Validators.maxLength(200)]],
      date: [parseDay(e.date) as Date | null, Validators.required],
      amount: [Number(e.amount) as number | null, [Validators.required, Validators.min(0.01)]],
      paidby: [e.paidby as number | null, Validators.required],
      details: [e.details ?? '', Validators.maxLength(255)],
    });
  }

  typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  /** Categories that fit the chosen type. */
  get categoryChoices() {
    return this.data.categories.filter((c) => c.type === this.form.controls.type.value);
  }

  onTypeChange(): void {
    const current = this.form.controls.category.value;
    if (!this.categoryChoices.some((c) => c.id === current)) {
      this.form.controls.category.setValue(null);
    }
  }

  private categoryName(id: number | null): string {
    return this.data.categories.find((c) => c.id === id)?.name ?? '';
  }

  private monthLabel(date: Date): string {
    return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  }

  /** Plain-language lines describing what the save will change. Empty when nothing changed. */
  private changes(): string[] {
    const e = this.data.entry;
    const v = this.form.getRawValue();
    const lines: string[] = [];
    const newAmount = Math.round(Number(v.amount) * 100) / 100;
    const oldAmount = Math.round(Number(e.amount) * 100) / 100;
    const newDay = formatDay(v.date as Date);

    if (v.type !== e.type)
      lines.push(`Type: ${this.typeLabel(e.type)} → ${this.typeLabel(v.type!)}`);
    if (v.category !== e.category_id)
      lines.push(`Category: ${e.category} → ${this.categoryName(v.category)}`);
    if ((v.merchant ?? '').trim() !== e.merchant)
      lines.push(`Merchant: ${e.merchant} → ${(v.merchant ?? '').trim()}`);
    if (newDay !== e.date) lines.push(`Date: ${e.date} → ${newDay}`);
    if (newAmount !== oldAmount)
      lines.push(`Amount: ${formatUsdExact(oldAmount)} → ${formatUsdExact(newAmount)}`);
    if (v.paidby !== e.paidby) {
      const payer = this.data.users.find((u) => u.id === v.paidby)?.name ?? '';
      lines.push(`Paid by: ${e.paid_by_name ?? ''} → ${payer}`);
    }
    if ((v.details ?? '').trim() !== (e.details ?? '')) lines.push('Details changed');
    return lines;
  }

  get hasChanges(): boolean {
    return this.form.valid && this.changes().length > 0;
  }

  /** How the planner will move, so the confirmation shows the effect on the numbers. */
  private plannerLines(): string[] {
    const e = this.data.entry;
    const v = this.form.getRawValue();
    const oldDate = parseDay(e.date);
    const newDate = v.date as Date;
    const newAmount = Math.round(Number(v.amount) * 100) / 100;
    const oldAmount = Math.round(Number(e.amount) * 100) / 100;
    const sameCell =
      v.type === e.type &&
      v.category === e.category_id &&
      oldDate.getFullYear() === newDate.getFullYear() &&
      oldDate.getMonth() === newDate.getMonth();
    const signed = (n: number) => `${n < 0 ? '−' : '+'}${formatUsdExact(Math.abs(n))}`;

    if (sameCell) {
      const diff = Math.round((newAmount - oldAmount) * 100) / 100;
      return diff === 0
        ? []
        : [`Planner: ${e.category}, ${this.monthLabel(oldDate)} ${signed(diff)}`];
    }
    return [
      `Planner: ${e.category}, ${this.monthLabel(oldDate)} ${signed(-oldAmount)}`,
      `Planner: ${this.categoryName(v.category)}, ${this.monthLabel(newDate)} ${signed(newAmount)}`,
    ];
  }

  save(): void {
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }
    const lines = this.changes();
    if (lines.length === 0) {
      this.errorMessage = 'Nothing has changed.';
      return;
    }

    this.dialog
      .open(ConfirmDialog, {
        width: '460px',
        maxWidth: '92vw',
        data: {
          title: 'Save these changes?',
          message: `${this.data.entry.merchant}, ${this.data.entry.category}`,
          details: [...lines, ...this.plannerLines()],
          confirmLabel: 'Save changes',
        },
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed) {
          this.send();
        }
      });
  }

  private send(): void {
    const v = this.form.getRawValue();
    this.saving = true;
    this.errorMessage = '';

    this.transSrv
      .update_transaction({
        transaction: {
          id: this.data.entry.id,
          type: v.type,
          category: v.category,
          paidby: v.paidby,
          amount: v.amount,
          date: formatDay(v.date as Date), // a plain date, so no time zone can shift the day
          merchant: (v.merchant ?? '').trim(),
          details: (v.details ?? '').trim(),
        },
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.toastr.success('Transaction updated.');
          this.dialogRef.close(true);
        },
        error: (error: HttpErrorResponse) => {
          this.saving = false;
          this.errorMessage =
            error.status === 0
              ? 'Cannot reach the server. Check that the API is running.'
              : (error.error?.error ?? 'Could not save the changes.');
        },
      });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
