import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BudgetPlanner } from './budget-planner';
import { AgGridModule } from 'ag-grid-angular';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { MaterialModule } from '../material-module';

@NgModule({
  declarations: [
    BudgetPlanner
  ],
  imports: [
    CommonModule,
    HttpClientModule,
    BrowserModule,
    AgGridModule,
    MaterialModule,
  ]
})
export class BudgetPlannerModule { }
