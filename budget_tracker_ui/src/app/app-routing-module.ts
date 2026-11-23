// FILE: src/app/app-routing-module.ts  (REPLACE existing file)
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { BudgetPlanner } from './budget-planner/budget-planner';
import { Home } from './home/home';
import { Transactions } from './transactions/transactions';
import { Login } from './auth/login';
import { authGuard } from './auth/auth.gaurd';
import { Debt } from './debt/debt';
import { Investments } from './investments/investments';

const routes: Routes = [
  { path: 'login', component: Login },
  { path: 'planner', component: BudgetPlanner, canActivate: [authGuard] },
  { path: 'transactions', component: Transactions, canActivate: [authGuard] },
  { path: 'home', component: Home, canActivate: [authGuard] },
  { path: 'debt', component: Debt, canActivate: [authGuard] },
  { path: 'investments', component: Investments, canActivate: [authGuard] },
  { path: '', component: Home, canActivate: [authGuard] },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
