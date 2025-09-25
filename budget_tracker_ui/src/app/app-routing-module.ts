import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { BudgetPlanner } from './budget-planner/budget-planner';
import { Home } from './home/home';
import { Transactions } from './transactions/transactions';

const routes: Routes = [
  { path: "planner", component: BudgetPlanner },
  { path: "transactions", component: Transactions },
  { path: "home", component: Home },
  { path: "", component: Home }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
