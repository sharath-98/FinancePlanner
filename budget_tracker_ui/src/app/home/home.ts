import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { MatDatepicker } from '@angular/material/datepicker';
import { AgCharts } from 'ag-charts-angular';
import { AgChartOptions } from 'ag-charts-community';
import * as _moment from 'moment';
import { Moment } from 'moment';
import { HomeService } from './home-service';

@Component({
  selector: 'app-home',
  standalone: false,
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit {
  range = new FormGroup({
    start: new FormControl<Date | null>(new Date()),
    end: new FormControl<Date | null>(new Date()),
  });

  public summaryChartOptions: AgChartOptions;
  public expenseChartOptions: AgChartOptions;
  public debtChartOptions: AgChartOptions;
  public savingsChartOptions: AgChartOptions;

  summaryChartData: any;

  constructor(private homeSrv: HomeService) {
    this.summaryChartOptions = {
      title: {
        text: 'Income vs Expenditure (Tracked)',
      },
      data: this.summaryChartData,
      series: [
        {
          type: 'line',
          xKey: 'month',
          yKey: 'income',
          yName: 'Income',
        },
        {
          type: 'line',
          xKey: 'month',
          yKey: 'expense',
          yName: 'Expense',
        },
        {
          type: 'line',
          xKey: 'month',
          yKey: 'debt',
          yName: 'Debt',
        },
        {
          type: 'line',
          xKey: 'month',
          yKey: 'savings',
          yName: 'Savings',
        },
      ],

      width: 1100, // Fixed width in pixels
      height: 380,
    };

    this.expenseChartOptions = {
      // Data: Data to be displayed in the chart
      data: [
        { month: 'Jan', avgTemp: 2.3, iceCreamSales: 162000 },
        { month: 'Mar', avgTemp: 6.3, iceCreamSales: 302000 },
        { month: 'May', avgTemp: 16.2, iceCreamSales: 800000 },
        { month: 'Jul', avgTemp: 22.8, iceCreamSales: 1254000 },
        { month: 'Sep', avgTemp: 14.5, iceCreamSales: 950000 },
        { month: 'Nov', avgTemp: 8.9, iceCreamSales: 200000 },
      ],
      // Series: Defines which chart type and data to use
      series: [{ type: 'bar', xKey: 'month', yKey: 'iceCreamSales' }],
      width: 373, // Fixed width in pixels
      height: 360,
    };

    this.debtChartOptions = {
      // Data: Data to be displayed in the chart
      data: [
        { month: 'Jan', avgTemp: 2.3, iceCreamSales: 162000 },
        { month: 'Mar', avgTemp: 6.3, iceCreamSales: 302000 },
        { month: 'May', avgTemp: 16.2, iceCreamSales: 800000 },
        { month: 'Jul', avgTemp: 22.8, iceCreamSales: 1253600 },
        { month: 'Sep', avgTemp: 14.5, iceCreamSales: 950000 },
        { month: 'Nov', avgTemp: 8.9, iceCreamSales: 200000 },
      ],
      // Series: Defines which chart type and data to use
      series: [{ type: 'bar', xKey: 'month', yKey: 'iceCreamSales' }],
      width: 373, // Fixed width in pixels
      height: 360,
    };

    this.savingsChartOptions = {
      // Data: Data to be displayed in the chart
      data: [
        { month: 'Jan', avgTemp: 2.3, iceCreamSales: 162000 },
        { month: 'Mar', avgTemp: 6.3, iceCreamSales: 302000 },
        { month: 'May', avgTemp: 16.2, iceCreamSales: 800000 },
        { month: 'Jul', avgTemp: 22.8, iceCreamSales: 1254000 },
        { month: 'Sep', avgTemp: 14.5, iceCreamSales: 950000 },
        { month: 'Nov', avgTemp: 8.9, iceCreamSales: 200000 },
      ],
      // Series: Defines which chart type and data to use
      series: [{ type: 'bar', xKey: 'month', yKey: 'iceCreamSales' }],
      width: 373, // Fixed width in pixels
      height: 360,
    };
  }

  ngOnInit(): void {
    this.onDatePickerClosed()
  }

  onDatePickerClosed() {
    let payload = {
      start: this.range.value.start?.toISOString(),
      end: this.range.value.end?.toISOString(),
    };
    console.log(payload)
    this.homeSrv.get_summary_chart(payload).subscribe((data) => {
      this.summaryChartOptions = {
        ...this.summaryChartOptions,
        data: data,
      };
    });
  }

}
