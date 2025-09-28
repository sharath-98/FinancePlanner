import { Component } from '@angular/core';import {
  inputStyleBordered,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ValueParserParams,
} from 'ag-grid-community';
import { TransactionService } from './transaction-service';
import { ToastrService } from 'ngx-toastr';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormGroup, Validators} from '@angular/forms';
import { map, Observable, startWith } from 'rxjs';

interface Category {
  id: number;
  name: string;
  type: string;
}

@Component({
  selector: 'app-transactions',
  standalone: false,
  templateUrl: './transactions.html',
  styleUrl: './transactions.css',
})
export class Transactions {
  categories = [];
  types = [];
  currencies = ['USD'];
  users = [
    { id: 1, name: 'Sharath' },
    { id: 2, name: 'Soundarya' },
  ];
  transactionForm!: FormGroup;
  filteredCategories!: Observable<Category[]>;
  filteredMerchants: any;

  merchants: any;
  isNewMerchantEntry!: boolean;

  constructor(
    private http: HttpClient,
    private transSrv: TransactionService,
    private toastr: ToastrService,
    private fb: FormBuilder
  ) {
    this.transactionForm = this.fb.group({
      category: ['', Validators.required],
      merchant: ['', Validators.required],
      date: ['', Validators.required],
      paidby: ['', Validators.required],
      amount: ['', [Validators.required, Validators.min(0.01)]],
      type: ['', Validators.required],
      currency: ['', Validators.required],
      details: [''],
    });
  }

  ngOnInit(): void {
    const currentYear = new Date().getFullYear();
    this.selectedYear = currentYear;
    for (let y = currentYear; y >= currentYear - 10; y--) {
      this.years.push(y);
    }
    this.transSrv.get_categories().subscribe((data) => {
      this.categories = data['categories'];
      this.types = data['types'];
    });

    this.filteredCategories = this.transactionForm.get('category')!.valueChanges.pipe(
      startWith(''),
      map((value) => (typeof value === 'string' ? value : value?.name)),
      map((name) => (name ? this._filterCategories(name) : this.categories.slice()))
    );

    this.transactionForm.get('merchant')?.valueChanges.subscribe((value) => {
      if (this.merchants.length > 0) {
        this.isNewMerchantEntry = value && !this.merchants.includes(value);
        this.filteredMerchants = this.merchants.filter((option: any) =>
          option.toLowerCase().includes((value || '').toLowerCase())
        );
      } else {
        this.isNewMerchantEntry = true;
      }
    });

    this.getInitialGrids();
  }

  OnCategorySelection() {
    this.merchants = [];
    this.filteredMerchants = [];
    this.isNewMerchantEntry = false;

    let payload = {
      category_id: this.transactionForm.value.category.id,
    };

    this.transSrv.get_subcategory(payload).subscribe((data) => {
      this.merchants = data;
    });
  }

  addNewMerchant() {
    let payload = {
      category_id: this.transactionForm.value.category.id,
      merchant: this.transactionForm.value.merchant,
    };

    this.transSrv.save_subcategory(payload).subscribe(
      (data) => {
        this.toastr.success('Added a new merchant.');
      },
      (error) => {
        this.toastr.error('Error is adding a new merchant');
      }
    );
  }

  onYearChange(event: any) {
    this.selectedYear = event.value;
    this.getInitialGrids();
  }

  private _filterCategories(name: string): Category[] {
    const filterValue = name.toLowerCase();
    return this.categories.filter((option: any) => option.name.toLowerCase().includes(filterValue));
  }

  private _filterMerchants(name: string): any {
    const filterValue = name.toLowerCase();
    return this.categories.filter((option: any) => option.toLowerCase().includes(filterValue));
  }

  displayCategory(category: any): string {
    return category && category.name ? category.name : '';
  }

  displayMerchants(merchant: any): string {
    return merchant ? merchant : '';
  }

  onSubmit() {
    // handle form submission
    if (this.transactionForm.valid) {
      let payload = {
        transaction: this.transactionForm.value,
      };
      payload['transaction']['date'] = new Date(payload['transaction']['date']).toISOString();
      console.log(payload);
      this.transSrv.save_expense(payload).subscribe(
        (data) => {
          this.toastr.success('Transaction saved');
          this.getInitialGrids();
        },
        (error) => {
          this.toastr.success('Error in saving the transaction.');
        }
      );
    }
  }

  gridApi!: GridApi<any>;
  selectedYear?: any;
  years: number[] = [];
  expenseRowData = [];

  colDefs = [
    { field: 'date', headerName: 'Date' },
    { field: 'type', headerName: 'Type' },
    { field: 'category', headerName: 'Category' },
    { field: 'merchant', headerName: 'Merchant' },
    { field: 'amount', headerName: 'Amount' },
    { field: 'details', headerName: 'Details' },
  ];

  defaultColDef: ColDef = {
    filter: true, // Enable filtering on all columns
    editable: true, // Enable editing on all columns
    sortable: true,
  };

  onGridReady(params: any) {
    this.gridApi = params.api;
  }

  autoSizeStrategy: any = {
    type: 'fitGridWidth',
    defaultMinWidth: 70,
    columnLimits: [
      {
        colId: 'category',
        minWidth: 250,
      },
    ],
  };

  getInitialGrids() {
    this.expenseRowData = [];
    this.transSrv.get_yearly_transactions({ year: this.selectedYear }).subscribe((data) => {
      this.expenseRowData = data;
      this.gridApi.refreshCells({ force: true });
    });
  }

  onCellValueChanged(event: any) {}
}
