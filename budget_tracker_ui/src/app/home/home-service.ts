import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class HomeService {
  BASE_URL: string = 'http://127.0.0.1:5000/';

  constructor(private http: HttpClient) {}

  get_summary_chart(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'summaryChart', payload);
  }

  get_sub_chart(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'subCharts', payload);
  }
}
