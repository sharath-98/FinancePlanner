import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { SpinnerService } from '../services/spinner-service';
import { Observable, finalize } from 'rxjs';

@Injectable()
export class LoadingInterceptor implements HttpInterceptor {
  constructor(private loadingService: SpinnerService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    this.loadingService.show();
    return next.handle(req).pipe(finalize(() => this.loadingService.hide()));
  }
}
