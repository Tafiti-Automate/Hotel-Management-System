# Client materials close-out — 24 November 2026

Baseline d577456: frontend CI, system and migration checks, and both Vercel deployments succeeded. Django: 550 passed, one outdated Store Keeper access assertion failed. This change corrects that regression contract while preserving transfer and ledger scope checks.

Approved purchase statistics exclude draft, rejected and cancelled orders. Detail evidence uses base units and line destination filtering. Supplier and article summaries use additive values only; the receiving deviation report distinguishes posted delivered, accepted and rejected quantities. Current price statistics exclude expired and future quotations. Receiving workflow tests include report assertions.

Outstanding: new CI, witnessed role UAT and PostgreSQL restore/concurrency checks; exact print samples and calculations; custom reports and report batches; sales tax data, complete F&B reconciliation, original-account returns, and valuation/provenance resolution for unrecorded physical stock. The actual chart of accounts and client acceptance are required. Market lists and GRNI reconciliation have dedicated current automated tests; the older certification gate register predates these implementations. No certification or live accounting reconciliation is claimed.
