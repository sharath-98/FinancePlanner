import { HttpClient } from '@angular/common/http';
import { Component, OnInit, ViewChild } from '@angular/core';
import { inputStyleBordered, type ColDef, type GridApi, type GridReadyEvent, type ValueParserParams } from "ag-grid-community";
import { BudgetPlannerService } from './budget-planner-service';
import { MatAccordion } from '@angular/material/expansion';
import { ToastrService } from 'ngx-toastr';

@Component({
  selector: 'app-budget-planner',
  templateUrl: './budget-planner.html',
  styleUrl: './budget-planner.css',
  standalone: false
})
export class BudgetPlanner implements OnInit{

  @ViewChild(MatAccordion) accordion!: MatAccordion;
  incomePanelOpenState = true;
  expensePanelOpenState = false;
  savingsPanelOpenState = true;
  debtPanelOpenState = true;
  
  years: number[] = [];
  selectedYear?: number;

  allocatedGridApi!: GridApi<any>;
  incomeGridApi!: GridApi<any>;
  expenseGridApi!: GridApi<any>;
  savingsGridApi!: GridApi<any>;
  debtGridApi!: GridApi<any>;
  
  grandAllocatedRow: any = {};
  grandTotalRow: any  = {}
  grandExpenseTotalRow: any = {}
  grandSavingsTotalRow: any = {}
  grandDebtTotalRow: any = {}
  
  allocatedRowData: any = []
  rowData: any = [];
  rowExpenseData: any = [];
  rowSavingsData: any = [];
  rowDebtData: any = [];

  months = ["Jan", "Feb", "Mar","Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  common_colDefs = [
    { field: 'Jan', headerName: 'Jan', valueParser: this.numberParser },
    { field: 'Feb', headerName: 'Feb', valueParser: this.numberParser },
    { field: 'Mar', headerName: 'Mar', valueParser: this.numberParser },
    { field: 'Apr', headerName: 'Apr', valueParser: this.numberParser },
    { field: 'May', headerName: 'May', valueParser: this.numberParser },
    { field: 'Jun', headerName: 'Jun', valueParser: this.numberParser },
    { field: 'Jul', headerName: 'Jul', valueParser: this.numberParser },
    { field: 'Aug', headerName: 'Aug', valueParser: this.numberParser },
    { field: 'Sep', headerName: 'Sep', valueParser: this.numberParser },
    { field: 'Oct', headerName: 'Oct', valueParser: this.numberParser },
    { field: 'Nov', headerName: 'Nov', valueParser: this.numberParser },
    { field: 'Dec', headerName: 'Dec', valueParser: this.numberParser },
    { field: 'Total', headerName: 'Total', cellStyle: { fontWeight: 'bold' }, 
    valueGetter: (params:any) => {
      const cols = this.months; // your month columns
      return cols.reduce((a, c) => a + (+params.data[c] || 0), 0);
    }}]

  colDefs = [ { field: 'Income', headerName: 'Income'}, ...this.common_colDefs ];
  colExpenseDefs = [ { field: 'Expenses', headerName: 'Expenses'}, ...this.common_colDefs ];
  colSavingsDefs = [ { field: 'Savings', headerName: 'Savings'}, ...this.common_colDefs ];
  colDebtsDefs = [ { field: 'Debts', headerName: 'Debts'}, ...this.common_colDefs ];

  defaultColDef: ColDef = {
    filter: true, // Enable filtering on all columns
    editable: true, // Enable editing on all columns
    sortable: true,
  };

  numberParser(params: ValueParserParams): number | string {
    return Number.isNaN(Number(params.newValue)) ? params.oldValue : Number(params.newValue);
  }

  onGridReady(params: GridReadyEvent<any>, category: string) {
    if (category == 'Income') {
      this.incomeGridApi = params.api;
    } else if(category == 'Expense') {
      this.expenseGridApi = params.api
    } else if(category == 'Debts') {
      this.debtGridApi = params.api
    } else if(category == 'Allocated') {
      this.allocatedGridApi = params.api
    } else {
      this.savingsGridApi = params.api
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
      monthCols.forEach(col => {
        grandTotal += Number(rowData[lastRowIndex][col]) || 0;
      });
      rowData[lastRowIndex]['Total'] = grandTotal;
    }
  }

  calGrandTotal(data: any, category: string) {
    if (category == "Income") {
      this.grandTotalRow = data[data.length - 1]
      this.grandTotalRow = Object.fromEntries(
        Object.entries(this.grandTotalRow).filter(([key, value]) => key !== "Income")
      );
    } else if (category == "Expense") {
      this.grandExpenseTotalRow = data[data.length - 1]
      this.grandExpenseTotalRow = Object.fromEntries(
        Object.entries(this.grandExpenseTotalRow).filter(([key, value]) => key !== "Expenses")
      );
    }
    else if (category == "Savings") {
      this.grandSavingsTotalRow = data[data.length - 1]
      this.grandSavingsTotalRow = Object.fromEntries(
        Object.entries(this.grandSavingsTotalRow).filter(([key, value]) => key !== "Savings")
      );
    }
    else if (category == "Debts") {
      this.grandDebtTotalRow = data[data.length - 1]
      this.grandDebtTotalRow = Object.fromEntries(
        Object.entries(this.grandDebtTotalRow).filter(([key, value]) => key !== "Debts")
      );
    }
  }

  getUnallocated() {
    let result: any = {}
    for(const key in this.grandTotalRow) {
      result[key] = this.grandTotalRow[key] - (this.grandExpenseTotalRow[key] + this.grandSavingsTotalRow[key] + this.grandDebtTotalRow[key])
    }
    this.grandAllocatedRow = [result]
    this.allocatedRowData = [result]
    this.allocatedGridApi.refreshCells({ force: true });
  }

  onCellValueChanged(event: any, category: any) {
    const colId = event.colDef.field;

    if (category == 'Income') {
      this.calculateColTotals(this.rowData, colId)
      this.calGrandTotal(this.rowData, "Income")
      this.incomeGridApi.refreshCells({ force: true });
    } 
    else if (category == 'Expense') {
      this.calculateColTotals(this.rowExpenseData, colId)
      this.calGrandTotal(this.rowExpenseData, "Expense")
      this.expenseGridApi.refreshCells({ force: true });
    }
    else if (category == 'Savings') {
      this.calculateColTotals(this.rowSavingsData, colId)
      this.calGrandTotal(this.rowSavingsData, "Savings")
      this.savingsGridApi.refreshCells({ force: true });
    }
    else if (category == 'Debts') {
      this.calculateColTotals(this.rowDebtData, colId)
      this.calGrandTotal(this.rowDebtData, "Debts")
      this.debtGridApi.refreshCells({ force: true });
    }
    this.getUnallocated()
  }

  autoSizeStrategy : any = {
    type: 'fitGridWidth',
    defaultMinWidth: 70,
    columnLimits: [
        {
            colId: 'Income',
            minWidth: 250
        },
        {
            colId: 'Expenses',
            minWidth: 250
        },
        {
            colId: 'Savings',
            minWidth: 250
        },
        {
            colId: 'Debts',
            minWidth: 250
        }
    ]
  };

  constructor(private http: HttpClient, private bdjSrv: BudgetPlannerService, private toastr: ToastrService) { }

  ngOnInit(): void {
    const currentYear = new Date().getFullYear();
    this.selectedYear = currentYear
    for (let y = currentYear; y >= currentYear - 10; y--) {
      this.years.push(y);
    }
    this.getInitialGrids()
  }

  getInitialGrids() {
    this.bdjSrv.get_monthly_income({"year":this.selectedYear}).subscribe(data => {
      this.rowData = data
      this.calGrandTotal(data, "Income")
    }, error => {
      this.rowData = []
      this.toastr.error("Error in retrieving income records.")
    })

    this.bdjSrv.get_monthly_expenses({"year":this.selectedYear}).subscribe(data => {
      this.rowExpenseData = data;
      this.calGrandTotal(data, "Expense")
    }, error => {
      this.rowExpenseData = []
      this.toastr.error("Error in retrieving expense records.")
    })

    this.bdjSrv.get_monthly_savings({"year":this.selectedYear}).subscribe(data => {
      this.rowSavingsData = data
      this.calGrandTotal(data, "Savings")
    }, error => {
      this.rowSavingsData = []
      this.toastr.error("Error in retrieving savings records.")
    })

    this.bdjSrv.get_monthly_debts({"year":this.selectedYear}).subscribe(data => {
      this.rowDebtData = data
      this.calGrandTotal(data, "Debts")
    }, error => {
      this.rowSavingsData = []
      this.toastr.error("Error in retrieving debt records.")
    })
  }

  onYearChange(event: any) {
    this.selectedYear = event.value;
    this.getInitialGrids()
  }
  addNewRowBeforeTotal() {
  if (!this.rowData || this.rowData.length === 0) return;

  // Remove the last row (assumed total row)
  const totalRow = this.rowData[this.rowData.length - 1];
  const dataWithoutTotal = this.rowData.slice(0, this.rowData.length - 1);

  // Create new empty row (customize fields as needed)
  const newRow = { /* empty or default fields */ };

  // Insert the new row before total
  const newData = [...dataWithoutTotal, newRow, totalRow];

  // Update row data, triggering grid refresh
  this.rowData = newData;

  // Optionally focus and start editing new row
  setTimeout(() => {
    const newRowIndex = this.rowData.length - 2;
    this.incomeGridApi.setFocusedCell(newRowIndex, this.colDefs[0].field);
    this.incomeGridApi.startEditingCell({ rowIndex: newRowIndex, colKey: this.colDefs[0].field });
  });
}

}
