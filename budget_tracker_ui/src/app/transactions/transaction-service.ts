// FILE: src/app/transactions/transaction-service.ts  (REPLACE existing file)
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../shared/app-config';

@Injectable({
  providedIn: 'root',
})
export class TransactionService {
  BASE_URL: string = API_BASE_URL;

  constructor(private http: HttpClient) {}

  get_categories(): Observable<any> {
    return this.http.get<any>(this.BASE_URL + 'categories');
  }

  /** Every category with the merchants saved under it (read-only). */
  get_category_mappings(): Observable<any> {
    return this.http.get<any>(this.BASE_URL + 'categoryMappings');
  }

  save_category(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'saveCategory', payload);
  }

  /** Newest entries first; {query, limit} are optional. */
  search_transactions(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'searchTransactions', payload);
  }

  update_transaction(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'updateTransaction', payload);
  }

  delete_transaction(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'deleteTransaction', payload);
  }

  get_users(): Observable<any> {
    return this.http.get<any>(this.BASE_URL + 'users');
  }

  get_yearly_transactions(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'transactions', payload);
  }

  get_subcategory(payload: any) {
    return this.http.post<any>(this.BASE_URL + 'getsubcategory', payload);
  }

  save_subcategory(payload: any) {
    return this.http.post<any>(this.BASE_URL + 'savesubcategory', payload);
  }

  save_expense(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'saveTransaction', payload);
  }
}
