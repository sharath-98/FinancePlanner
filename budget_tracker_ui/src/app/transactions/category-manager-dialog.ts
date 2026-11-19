// FILE: src/app/transactions/category-manager-dialog.ts  (NEW file)
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { TransactionService } from './transaction-service';

interface CategoryMapping {
  id: number;
  name: string;
  type: string;
  merchants: string[];
}

interface Group {
  type: string;
  label: string;
  tone: string;
  items: { category: CategoryMapping; merchants: string[] }[];
}

const TYPE_ORDER = ['expense', 'income', 'saving', 'debt'];
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

@Component({
  selector: 'app-category-manager-dialog',
  templateUrl: './category-manager-dialog.html',
  styleUrl: './category-manager-dialog.css',
  standalone: false,
})
export class CategoryManagerDialog implements OnInit {
  mappings: CategoryMapping[] = [];
  query = '';
  loading = true;
  loadFailed = false;

  addOpen = false;
  saving = false;
  addError = '';
  form: FormGroup<{ name: FormControl<string | null>; type: FormControl<string | null> }>;
  readonly typeChoices = TYPE_ORDER.map((type) => ({ type, label: TYPE_LABELS[type] }));

  constructor(
    private transSrv: TransactionService,
    private toastr: ToastrService,
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<CategoryManagerDialog>,
    /** onAdded runs after a category is saved, so the page behind can refresh its list. */
    @Inject(MAT_DIALOG_DATA) private data: { onAdded?: () => void } | null,
  ) {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      type: ['expense', Validators.required],
    });
  }

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.transSrv.get_category_mappings().subscribe({
      next: (data) => {
        this.mappings = Array.isArray(data) ? data : [];
        this.loading = false;
        this.loadFailed = false;
      },
      error: () => {
        this.loading = false;
        this.loadFailed = true;
      },
    });
  }

  /** Categories grouped by type. A search matches category names and merchant names. */
  get groups(): Group[] {
    const q = this.query.trim().toLowerCase();
    const groups: Group[] = [];

    for (const type of TYPE_ORDER) {
      const items = this.mappings
        .filter((category) => category.type === type)
        .map((category) => {
          if (!q || category.name.toLowerCase().includes(q)) {
            return { category, merchants: category.merchants };
          }
          // The category name did not match: keep it only if some merchant under it did
          return {
            category,
            merchants: category.merchants.filter((m) => m.toLowerCase().includes(q)),
          };
        })
        .filter(
          (item) => !q || item.category.name.toLowerCase().includes(q) || item.merchants.length > 0,
        );

      if (items.length > 0) {
        groups.push({ type, label: TYPE_LABELS[type], tone: TYPE_TONES[type], items });
      }
    }
    return groups;
  }

  get matchCount(): number {
    return this.groups.reduce((total, group) => total + group.items.length, 0);
  }

  /** Splits text so the part that matches the search can be highlighted. */
  parts(text: string): { text: string; hit: boolean }[] {
    const q = this.query.trim().toLowerCase();
    const at = q ? text.toLowerCase().indexOf(q) : -1;
    if (at < 0) {
      return [{ text, hit: false }];
    }
    return [
      { text: text.slice(0, at), hit: false },
      { text: text.slice(at, at + q.length), hit: true },
      { text: text.slice(at + q.length), hit: false },
    ].filter((part) => part.text.length > 0);
  }

  toggleAdd(): void {
    this.addOpen = !this.addOpen;
    this.addError = '';
  }

  addCategory(): void {
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, type } = this.form.getRawValue();
    this.saving = true;
    this.addError = '';

    this.transSrv.save_category({ name: (name ?? '').trim(), type }).subscribe({
      next: (created) => {
        this.saving = false;
        this.data?.onAdded?.();
        this.toastr.success(`Category "${created.name}" added.`);
        this.form.controls.name.reset('');
        this.form.markAsUntouched();
        this.query = created.name; // show the new category straight away
        this.addOpen = false;
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.saving = false;
        this.addError =
          error.status === 0
            ? 'Cannot reach the server. Check that the API is running.'
            : (error.error?.error ?? 'Could not add the category.');
      },
    });
  }

  close(): void {
    this.dialogRef.close();
  }
}
