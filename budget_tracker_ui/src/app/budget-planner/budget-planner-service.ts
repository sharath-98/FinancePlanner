// FILE: src/app/budget-planner/budget-planner-service.ts  (REPLACE existing file)
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../shared/app-config';

@Injectable({
  providedIn: 'root',
})
export class BudgetPlannerService {
  BASE_URL: string = API_BASE_URL;

  constructor(private http: HttpClient) {}

  update_src_data(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'updateSrc', payload);
  }

  /** What a planner cell holds and what the logged transactions add up to (read-only). */
  get_month_activity(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'plannerMonthActivity', payload);
  }

  get_monthly_income(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'income', payload);
  }

  get_monthly_expenses(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'expenses', payload);
  }

  get_monthly_savings(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'savings', payload);
  }

  get_monthly_debts(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'debt', payload);
  }
}
