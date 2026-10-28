import importlib.util, sys, types, unittest
from pathlib import Path
for n, attrs in {'subscription': {}, 'subscription.models': {'Withdraw': object}, 'referral': {}, 'referral.models': {'Referral': object}}.items():
    m = types.ModuleType(n); m.__dict__.update(attrs); sys.modules[n] = m
sys.modules['subscription'].__path__ = []
spec = importlib.util.spec_from_file_location('subscription.withdraw_services', Path(__file__).resolve().parent.parent / 'subscription' / 'withdraw_services.py', submodule_search_locations=None)
ws = importlib.util.module_from_spec(spec); ws.__package__ = 'subscription'; spec.loader.exec_module(ws)
parse = ws.get_withdraw_data_from_input

class T(unittest.TestCase):
    def test_valid(self): self.assertEqual(parse({'name': ' Ada ', 'payout_email': ' Ada@Example.COM ', 'amount': '25'}), {'name': 'Ada', 'payout_email': 'ada@example.com', 'amount': 25})
    def test_card_fields_are_ignored_never_returned(self):
        r = parse({'name': 'A', 'payout_email': 'a@b.co', 'amount': 5, 'card_number': '4242424242424242', 'cvc': '123', 'expiry_date': '12/30'})
        self.assertEqual(set(r), {'name', 'payout_email', 'amount'}); self.assertNotIn('4242', str(r))
    def test_rejects_bad_input(self):
        for bad in ({}, {'name': '', 'payout_email': 'a@b.co', 'amount': 5}, {'name': 'A', 'payout_email': 'not-an-email', 'amount': 5}, {'name': 'A', 'payout_email': 'a@b.co', 'amount': 0},
                    {'name': 'A', 'payout_email': 'a@b.co', 'amount': -3}, {'name': 'A', 'payout_email': 'a@b.co', 'amount': 'ten'}, {'name': 'A', 'payout_email': 'a b@c.co', 'amount': 1}, None, 'str'):
            self.assertIsNone(parse(bad), str(bad))
    def test_validate_withdraw(self):
        R = lambda w, s: types.SimpleNamespace(wallet=w, subs=s)
        self.assertTrue(ws.validate_withdraw(R(50, 3), 50)); self.assertFalse(ws.validate_withdraw(R(40, 3), 50)); self.assertFalse(ws.validate_withdraw(R(100, 2), 50)); self.assertFalse(ws.validate_withdraw(None, 5)); self.assertFalse(ws.validate_withdraw(R(100, 5), 0))
if __name__ == '__main__': unittest.main()
