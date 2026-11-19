// FILE: src/app/app.spec.ts  (REPLACE existing file)
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { MaterialModule } from './material-module';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    // The theme choice is remembered in localStorage, so start each test clean
    try {
      localStorage.removeItem('ledger-theme');
    } catch {
      // storage can be unavailable; the tests still work
    }

    await TestBed.configureTestingModule({
      imports: [RouterModule.forRoot([]), MaterialModule],
      declarations: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show the Ledger name in the header', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand-name')?.textContent).toContain('Ledger');
  });

  it('should link to the three pages in the main navigation', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('nav a').length).toBe(3);
  });

  it('should switch theme when the theme button is pressed', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const before = document.documentElement.getAttribute('data-theme');

    (compiled.querySelector('.icon-btn') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(document.documentElement.getAttribute('data-theme')).not.toBe(before);
  });
});
