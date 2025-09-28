import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgCharts, AgChartsModule } from 'ag-charts-angular';
import { AgGridModule } from 'ag-grid-angular';
import { Home } from './home';
import { MaterialModule } from '../material-module';
import { MatMomentDateModule, MomentDateAdapter } from '@angular/material-moment-adapter';
import { ReactiveFormsModule } from '@angular/forms';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
import * as _moment from 'moment';
import { MatNativeDateModule } from '@angular/material/core';

const moment = _moment;

export const MY_FORMATS = {
  parse: { dateInput: 'MM/YYYY' },
  display: {
    dateInput: 'MM/YYYY',
    monthYearLabel: 'MMM YYYY',
    dateA11yLabel: 'LL',
    monthYearA11yLabel: 'MMMM YYYY',
  },
};

@NgModule({
  declarations: [Home],
  imports: [
    CommonModule,
    AgGridModule,
    AgCharts,
    AgChartsModule,
    MaterialModule,
    MatMomentDateModule,
    ReactiveFormsModule,
  ],
  providers: [
    { provide: DateAdapter, useClass: MomentDateAdapter, deps: [MAT_DATE_LOCALE] },
    { provide: MAT_DATE_FORMATS, useValue: MY_FORMATS },
  ],
})
export class HomeModule {}
