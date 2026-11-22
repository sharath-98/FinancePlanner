// FILE: src/app/app-module.ts  (REPLACE existing file)
import { NgModule, provideBrowserGlobalErrorListeners } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing-module';
import { App } from './app';
import { AgGridModule } from 'ag-grid-angular';
import { MaterialModule } from './material-module';
import { BudgetPlannerModule } from './budget-planner/budget-planner-module';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { HTTP_INTERCEPTORS, HttpClientModule } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { ToastrModule } from 'ngx-toastr';
import { HomeModule } from './home/home-module';
import { TransactionModule } from './transactions/transaction-module';
import { SpinnerService } from './services/spinner-service';
import { LoadingInterceptor } from './interceptor/loading.interceptor';
import { AuthInterceptor } from './auth/auth.interceptor';
import { AuthModule } from './auth/auth-module';
import { AgChartsModule } from 'ag-charts-angular';
import { MatMomentDateModule, MomentDateAdapter } from '@angular/material-moment-adapter';
import { DebtModule } from './debt/debt-module';

// Register all Community features
ModuleRegistry.registerModules([AllCommunityModule]);

@NgModule({
  declarations: [App],
  imports: [
    BrowserModule,
    HttpClientModule,
    AppRoutingModule,
    AgGridModule,
    MaterialModule,
    BudgetPlannerModule,
    HomeModule,
    TransactionModule,
    DebtModule,
    AuthModule,
    FontAwesomeModule,
    ToastrModule.forRoot(),
  ],
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideNativeDateAdapter(),
    SpinnerService,
    {
      provide: HTTP_INTERCEPTORS,
      useClass: LoadingInterceptor,
      multi: true,
    },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true,
    },
  ],
  exports: [MaterialModule, AgChartsModule],
  bootstrap: [App],
})
export class AppModule {}
