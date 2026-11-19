import { Component, Inject, OnInit } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { SpinnerService } from './services/spinner-service';
import { Observable } from 'rxjs';

type Theme = 'light' | 'dark';
const THEME_KEY = 'ledger-theme';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.css',
})
export class App implements OnInit {
  loading$: Observable<boolean>;
  isDark = false;

  constructor(
    private loadingService: SpinnerService,
    @Inject(DOCUMENT) private document: Document,
  ) {
    this.loading$ = this.loadingService.loading$;
  }

  ngOnInit(): void {
    this.applyTheme(this.initialTheme());
  }

  toggleTheme(): void {
    this.applyTheme(this.isDark ? 'light' : 'dark');
  }

  private initialTheme(): Theme {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // storage can be unavailable (private mode); fall through to system preference
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private applyTheme(theme: Theme): void {
    this.isDark = theme === 'dark';
    this.document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }
}
