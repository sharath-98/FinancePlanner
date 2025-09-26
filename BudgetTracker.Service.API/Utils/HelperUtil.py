import calendar
from datetime import datetime, timedelta

class HelperUtil:
    def __init__(self):
        pass

    def month_iter(self, start, end):
        result = []
        d = datetime(start.year, start.month, 1)
        # Calculate last day of end month
        end_last_day = calendar.monthrange(end.year, end.month)[1]
        end_date = datetime(end.year, end.month, end_last_day)
        while d <= end_date:
            result.append((d.strftime("%b"), d.year, d.month))
            # move to 1st day of next month
            d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
        return result

    def get_last_day_of_month(self, year, month):
        last_day = calendar.monthrange(year, month)[1]
        return datetime(year, month, last_day)
