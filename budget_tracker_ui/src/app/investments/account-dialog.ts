// FILE: src/app/investments/account-dialog.ts  (NEW file)
// "Add account" / "Edit": makes a Savings category an investment account (or changes its type and links).
// Children's accounts named with 529, NJBEST or Trump are also added automatically.
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Inject, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { MaterialModule } from '../material-module';
import { AccountChoices, AccountKind, InvestmentCard, InvestmentService } from './investment-service';

export const KIND_LABELS: { kind: AccountKind; label: string }[] = [
  { kind: 'brokerage', label: 'Stocks / brokerage (tracks shares)' },
  { kind: 'crypto', label: 'Crypto (tracks coins)' },
  { kind: 'cash', label: 'HYSA / savings account' },
  { kind: 'retirement', label: '401K / retirement' },
  { kind: 'hsa', label: 'HSA' },
  { kind: 'child', label: "Child's account (529, NJBEST, Trump)" },
  { kind: 'property', label: 'Real estate (property)' },
  { kind: 'metal', label: 'Gold / metals' },
  { kind: 'other', label: 'Other' },
];

/** Without a card: add a new account. With a card: edit that one. */
export interface AccountDialogData {
  card?: InvestmentCard;
}

@Component({
  selector: 'app-account-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <h2 mat-dialog-title>{{ data.card ? 'Edit ' + data.card.name : 'Add account' }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <mat-dialog-content>
        <p class="intro" *ngIf="!data.card">
          Pick a Savings category (create one first in Transactions → Categories). Children's accounts with 529,
          NJBEST or Trump in the name appear on their own.
        </p>
        <div class="fields">
          <mat-form-field appearance="outline" class="wide" *ngIf="!data.card">
            <mat-label>Savings category</mat-label>
            <mat-select formControlName="category_id" (selectionChange)="onCategory()">
              <mat-option *ngFor="let c of choices?.unlinked_savings" [value]="c.id">{{ c.name }}</mat-option>
            </mat-select>
            <mat-hint *ngIf="choices && !choices.unlinked_savings.length">Every Savings category is already set up.</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" class="wide">
            <mat-label>Type</mat-label>
            <mat-select formControlName="kind">
              <mat-option *ngFor="let k of kinds" [value]="k.kind">{{ k.label }}</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" *ngIf="form.value.kind === 'child'">
            <mat-label>Child's name</mat-label>
            <input matInput formControlName="beneficiary" maxlength="60" autocomplete="off" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Bank / broker (optional)</mat-label>
            <input matInput formControlName="institution" maxlength="100" autocomplete="off" placeholder="e.g. Fidelity" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="wide" *ngIf="hasIncome">
            <mat-label>{{ form.value.kind === 'cash' ? 'Interest' : 'Dividends' }} category (optional)</mat-label>
            <mat-select formControlName="income_category_id">
              <mat-option [value]="null">None</mat-option>
              <mat-option *ngFor="let c of choices?.income_categories" [value]="c.id">{{ c.name }}</mat-option>
            </mat-select>
            <mat-hint>The Income category you log its {{ form.value.kind === 'cash' ? 'interest' : 'dividends' }} under</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" class="wide" *ngIf="form.value.kind === 'property'">
            <mat-label>Loan (optional)</mat-label>
            <mat-select formControlName="debt_category_id">
              <mat-option [value]="null">No loan</mat-option>
              <mat-option *ngFor="let c of choices?.debt_categories" [value]="c.id">{{ c.name }}</mat-option>
            </mat-select>
            <mat-hint>Its balance on the Debt page is subtracted to show your equity</mat-hint>
          </mat-form-field>
        </div>
        <p class="note" *ngIf="data.card && data.card.tracks_holdings !== isHoldings">
          Changing between a share-tracking type and a balance type changes how the value is worked out.
        </p>
        <p class="error" role="alert" aria-live="polite">{{ errorText }}</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button type="button" class="btn btn-secondary" (click)="ref.close(false)">Cancel</button>
        <button type="submit" class="btn" [disabled]="saving">{{ saving ? 'Saving…' : data.card ? 'Save' : 'Add account' }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: [
    `
      .intro, .note { margin: 0 0 var(--space-3); color: var(--text-muted); font-size: var(--fs-sm); line-height: 1.45; }
      .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2) var(--space-3); padding-top: var(--space-2); }
      .wide { grid-column: 1 / -1; }
      .error { min-height: 1.25em; margin: var(--space-2) 0 0; color: var(--negative); font-size: var(--fs-sm); }
      @media (max-width: 520px) { .fields { grid-template-columns: 1fr; } }
    `,
  ],
})
export class AccountDialog implements OnInit {
  private fb = inject(FormBuilder);
  readonly kinds = KIND_LABELS;
  choices: AccountChoices | null = null;
  saving = false;
  errorText = '';

  form = this.fb.group({
    category_id: [null as number | null],
    kind: [null as AccountKind | null, Validators.required],
    beneficiary: [''],
    institution: [''],
    income_category_id: [null as number | null],
    debt_category_id: [null as number | null],
  });

  constructor(
    private invest: InvestmentService,
    private toastr: ToastrService,
    public ref: MatDialogRef<AccountDialog, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: AccountDialogData,
  ) {
    const c = data.card;
    if (c) {
      this.form.patchValue({
        category_id: c.category_id,
        kind: c.kind,
        beneficiary: c.beneficiary ?? '',
        institution: c.institution ?? '',
        income_category_id: c.income_category_id ?? null,
        debt_category_id: c.debt_category_id ?? null,
      });
    }
  }

  ngOnInit(): void {
    this.invest.accountChoices().subscribe({
      next: (c) => (this.choices = c),
      error: () => (this.errorText = 'Could not load your categories.'),
    });
  }

  get hasIncome(): boolean {
    return ['brokerage', 'crypto', 'cash'].includes(this.form.value.kind ?? '');
  }

  get isHoldings(): boolean {
    return ['brokerage', 'crypto'].includes(this.form.value.kind ?? '');
  }

  /** Guess the type and child's name from the category name. */
  onCategory(): void {
    const name = this.choices?.unlinked_savings.find((c) => c.id === this.form.value.category_id)?.name ?? '';
    const n = name.toLowerCase();
    const guess: AccountKind | null =
      /529|njbest|trump/.test(n) ? 'child' :
      /hysa|savings acc/.test(n) ? 'cash' :
      /401k|ira|roth/.test(n) ? 'retirement' :
      /hsa/.test(n) ? 'hsa' :
      /crypto|coin/.test(n) ? 'crypto' :
      /stock|brokerage/.test(n) ? 'brokerage' :
      /real estate|property|house|rental/.test(n) ? 'property' :
      /gold|silver/.test(n) ? 'metal' : null;
    if (guess && !this.form.value.kind) this.form.patchValue({ kind: guess });
    if (guess === 'child' && !this.form.value.beneficiary) {
      const parts = name.split(/[-–]/);
      if (parts.length > 1) this.form.patchValue({ beneficiary: parts[parts.length - 1].trim() });
    }
  }

  save(): void {
    if (this.saving) return;
    const v = this.form.getRawValue();
    if (!v.category_id) {
      this.errorText = 'Choose the Savings category.';
      return;
    }
    if (!v.kind) {
      this.errorText = 'Choose the type.';
      return;
    }
    if (v.kind === 'child' && !(v.beneficiary ?? '').trim()) {
      this.errorText = "Enter the child's name.";
      return;
    }
    this.saving = true;
    this.errorText = '';
    this.invest
      .saveAccount({
        category_id: v.category_id,
        kind: v.kind,
        institution: (v.institution ?? '').trim(),
        income_category_id: this.hasIncome ? v.income_category_id : null,
        debt_category_id: v.kind === 'property' ? v.debt_category_id : null,
        beneficiary: v.kind === 'child' ? (v.beneficiary ?? '').trim() : null,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.toastr.success(this.data.card ? 'Account updated.' : 'Account added.');
          this.ref.close(true);
        },
        error: (err: HttpErrorResponse) => {
          this.saving = false;
          this.errorText = err.status === 0 ? 'Cannot reach the server.' : err.error?.error ?? 'Could not save.';
        },
      });
  }
}
