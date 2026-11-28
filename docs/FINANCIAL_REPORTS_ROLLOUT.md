# Financial Reports rollout — initial integration
This commit introduces the staged internal GL and a property-scoped Financial Reports workspace.
Only Cost Controller, Financial Manager and General Manager groups with an active assigned property may access it.
No historical data is inserted; the supplied balance sheet has a UGX 104,228,011 difference and the asset schedule differs from accumulated depreciation in the balance sheet.
Reports are provisional and require verified opening balances; operating integrations are deliberately not auto-posted.
Current scope: account creation, journal preparation, independent approval, posting, trial balance, P&L, balance sheet, direct cash movement, CSV and browser print.
Not complete: asset register/depreciation events, indirect cash flow, source-to-GL mapping and posting, bank/inventory/AR/AP reconciliation, reversal controls and close integration, exact client templates, full POS settlement and front office checkout, inquiry/tentative workflow. Existing POS and PMS are unchanged.
The existing GitHub Actions workflow must validate migrations, backend tests and frontend build. Do not use this as certified financial statements.
