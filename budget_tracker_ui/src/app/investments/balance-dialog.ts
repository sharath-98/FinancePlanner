// FILE: src/app/investments/balance-dialog.ts  (NEW file)
// "Update balance": today's total from an app or statement (401K, HSA, HYSA, gold, property),
// or the uninvested cash of a Stocks/Crypto account.
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Inject, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { MaterialModule } from '../material-module';
import { InvestmentService, localIso } from './investment-service';

export interface BalanceDialogData {
  categoryId: number;
  name: string;
  kind: string;
  current: number | null | undefined;
}

@Component({
  selector: 'app-balance-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <h2 mat-dialog-title>{{ title }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <mat-dialog-content>
        <p class="intro">{{ intro }}</p>
        <div class="fields">
          <mat-form-field appearance="outline">
            <mat-label>{{ valueLabel }}</mat-label>
            <span matTextPrefix>$&nbsp;</span>
            <input matInput type="number" step="0.01" min="0" formControlName="value" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>As of</mat-label>
            <input matInput type="date" [max]="today" formControlName="date" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="wide">
            <mat-label>Note (optional)</mat-label>
            <input matInput formControlName="note" maxlength="255" [placeholder]="notePlaceholder" autocomplete="off" />
          </mat-form-field>
        </div>
        <p class="error" role="alert" aria-live="polite">{{ errorText }}</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button type="button" class="btn btn-secondary" (click)="ref.close(false)">Cancel</button>
        <button type="submit" class="btn" [disabled]="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: [
    `
      .intro { margin: 0 0 var(--space-3); color: var(--text-muted); font-size: var(--fs-sm); line-height: 1.45; }
      .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2) var(--space-3); padding-top: var(--space-2); }
      .wide { grid-column: 1 / -1; }
      .error { min-height: 1.25em; margin: var(--space-2) 0 0; color: var(--negative); font-size: var(--fs-sm); }
      @media (max-width: 520px) { .fields { grid-template-columns: 1fr; } }
    `,
  ],
})
export class BalanceDialog {
  private fb = inject(FormBuilder);
  readonly today = localIso();
  saving = false;
  errorText = '';

  form = this.fb.group({
    value: [null as number | null, [Validators.required, Validators.min(0)]],
    date: [localIso(), Validators.required],
    note: ['', Validators.maxLength(255)],
  });

  constructor(
    private invest: InvestmentService,
    private toastr: ToastrService,
    public ref: MatDialogRef<BalanceDialog, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: BalanceDialogData,
  ) {
    if (data.current != null) this.form.patchValue({ value: data.current });
  }

  get holdingsAccount(): boolean {
    return this.data.kind === 'brokerage' || this.data.kind === 'crypto';
  }

  get title(): string {
    if (this.holdingsAccount) return `Cash in ${this.data.name}`;
    return `${this.data.kind === 'property' ? 'Value' : 'Balance'}: ${this.data.name}`;
  }

  get valueLabel(): string {
    if (this.holdingsAccount) return 'Uninvested cash';
    return this.data.kind === 'property' ? 'Property value' : 'Balance';
  }

  get intro(): string {
    if (this.holdingsAccount)
      return 'The cash sitting in the account, not invested. The holdings themselves are valued from their prices.';
    if (this.data.kind === 'property')
      return 'What the property is worth (purchase price at first, your estimate later). The loan left on the Debt page is subtracted to give your equity.';
    return 'Copy the total from the app or statement. From this date on, your new savings, interest and moves are added to it.';
  }

  get notePlaceholder(): string {
    return this.data.kind === 'retirement' ? 'e.g. Empower' : this.data.kind === 'hsa' ? 'e.g. Health Equity' : 'e.g. Marcus app';
  }

  save(): void {
    if (this.saving) return;
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    if (this.form.invalid || v.value == null || !v.date) {
      this.errorText = 'Enter the amount and its date.';
      return;
    }
    if (v.date > this.today) {
      this.errorText = 'The date cannot be in the future.';
      return;
    }
    this.saving = true;
    this.errorText = '';
    this.invest
      .saveValuation({ category_id: this.data.categoryId, date: v.date, value: Number(v.value), note: (v.note ?? '').trim() })
      .subscribe({
        next: () => {
          this.saving = false;
          this.toastr.success('Saved.');
          this.ref.close(true);
        },
        error: (err: HttpErrorResponse) => {
          this.saving = false;
          this.errorText = err.status === 0 ? 'Cannot reach the server.' : err.error?.error ?? 'Could not save.';
        },
      });
  }
}
