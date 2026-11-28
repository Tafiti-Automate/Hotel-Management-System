from datetime import date
from decimal import Decimal as D
import unittest
from apps.finance.statement_engine import Account, Line, Journal, calculate_statements


class StatementEngineTests(unittest.TestCase):
    def setUp(self):
        self.accounts = [Account('cash', 'Cash', 'asset', 'Cash', True),
                         Account('bank', 'Bank', 'asset', 'Bank', True),
                         Account('asset', 'Equipment', 'asset', 'Equipment'),
                         Account('dep', 'Accumulated depreciation', 'asset', 'Equipment'),
                         Account('capital', 'Capital', 'equity', 'Capital'),
                         Account('sales', 'Sales', 'revenue', 'Food'),
                         Account('expense', 'Expense', 'expense', 'Operations'),
                         Account('payable', 'Payable', 'liability', 'Trade creditors')]
        self.opening = self.j('opening', 1, 'cash', 'capital', '1000', is_opening=True)

    def j(self, key, day, debit, credit, amount, activity=None, **kw):
        return Journal('P1', key, date(2026, 4, day),
                       (Line(debit, D(amount)), Line(credit, credit=D(amount))), activity, **kw)

    def run_engine(self, journals):
        return calculate_statements(self.accounts, journals, property_id='P1',
                                    opening_date=date(2026, 4, 1), start=date(2026, 4, 2), end=date(2026, 4, 30))

    def test_all_statements_reconcile(self):
        result = self.run_engine([self.opening,
            self.j('sale', 2, 'cash', 'sales', '200', 'operating'),
            self.j('expense', 3, 'expense', 'cash', '50', 'operating'),
            self.j('purchase', 4, 'asset', 'cash', '300', 'investing'),
            self.j('depreciation', 5, 'expense', 'dep', '30'),
            self.j('credit', 6, 'expense', 'payable', '20'),
            self.j('transfer', 7, 'bank', 'cash', '100', 'internal_transfer')])
        self.assertEqual(result['profit_and_loss']['net_profit'], D('100'))
        self.assertEqual(result['balance_sheet']['assets'], D('1120'))
        self.assertEqual(result['balance_sheet']['liabilities'], D('20'))
        self.assertEqual(result['balance_sheet']['equity'], D('1100'))
        self.assertEqual(result['balance_sheet']['difference'], D('0'))
        self.assertEqual(result['cash_flow_direct']['closing_cash'], D('850'))
        self.assertEqual(result['cash_flow_direct']['difference'], D('0'))
        self.assertEqual(result['balance_sheet']['groups'][('asset', 'Equipment')], D('270'))

    def test_rejects_duplicate(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.run_engine([self.opening, self.opening])

    def test_rejects_cross_property(self):
        with self.assertRaisesRegex(ValueError, 'Cross-property'):
            self.run_engine([self.opening, Journal('P2', 'bad', date(2026,4,2), self.opening.lines)])

    def test_rejects_unbalanced(self):
        bad = Journal('P1','bad',date(2026,4,2),(Line('cash',D('20')),Line('sales',credit=D('10'))),'operating')
        with self.assertRaisesRegex(ValueError, 'Unbalanced'):
            self.run_engine([self.opening,bad])

    def test_requires_cash_classification(self):
        with self.assertRaisesRegex(ValueError, 'classification'):
            self.run_engine([self.opening,self.j('sale',2,'cash','sales','20')])

    def test_requires_opening(self):
        with self.assertRaisesRegex(ValueError, 'opening-balance'):
            self.run_engine([])

    def test_rejects_excess_precision(self):
        with self.assertRaisesRegex(ValueError, 'decimal places'):
            self.run_engine([self.opening,self.j('sale',2,'cash','sales','20.001','operating')])

    def test_non_cash_classification_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Zero net cash'):
            self.run_engine([self.opening,self.j('dep',2,'expense','dep','20','operating')])
