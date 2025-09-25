import { Component, OnInit } from '@angular/core';
import { SpinnerService } from './services/spinner-service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.css',
})
export class App {
  loading$: Observable<boolean>;

  constructor(private loadingService: SpinnerService) {
    this.loading$ = this.loadingService.loading$;
  }
}
