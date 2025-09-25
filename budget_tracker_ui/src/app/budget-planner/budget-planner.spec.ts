import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BudgetPlanner } from './budget-planner';

describe('BudgetPlanner', () => {
  let component: BudgetPlanner;
  let fixture: ComponentFixture<BudgetPlanner>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [BudgetPlanner]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BudgetPlanner);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
