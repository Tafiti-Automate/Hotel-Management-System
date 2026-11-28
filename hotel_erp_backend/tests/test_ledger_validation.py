from decimal import Decimal as D
import unittest
from apps.finance.ledger_validation import validate_lines


class LedgerValidationTests(unittest.TestCase):
    def test_opening(self):
        self.assertEqual(validate_lines([('asset', True, D('100'), D('0')), ('equity', False, D('0'), D('100'))], is_opening=True), D('100'))

    def test_unbalanced(self):
        with self.assertRaisesRegex(ValueError, 'Unbalanced'):
            validate_lines([('asset', True, D('100'), D('0')), ('equity', False, D('0'), D('99'))], is_opening=True)

    def test_invalid_precision(self):
        with self.assertRaisesRegex(ValueError, 'monetary'):
            validate_lines([('asset', True, D('1.001'), D('0')), ('equity', False, D('0'), D('1.001'))], is_opening=True)

    def test_invalid_opening_income(self):
        with self.assertRaisesRegex(ValueError, 'balance-sheet'):
            validate_lines([('asset', True, D('100'), D('0')), ('revenue', False, D('0'), D('100'))], is_opening=True)

    def test_cash_classification_required(self):
        with self.assertRaisesRegex(ValueError, 'Classify'):
            validate_lines([('asset', True, D('100'), D('0')), ('revenue', False, D('0'), D('100'))])

    def test_internal_transfer(self):
        self.assertEqual(validate_lines([('asset', True, D('100'), D('0')), ('asset', True, D('0'), D('100'))], cash_activity='internal_transfer'), D('100'))

    def test_depreciation_non_cash(self):
        self.assertEqual(validate_lines([('expense', False, D('10'), D('0')), ('asset', False, D('0'), D('10'))]), D('10'))

    def test_negative(self):
        with self.assertRaisesRegex(ValueError, 'monetary'):
            validate_lines([('asset', True, D('-100'), D('0')), ('equity', False, D('0'), D('-100'))])
