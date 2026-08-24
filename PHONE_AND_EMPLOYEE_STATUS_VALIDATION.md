# Uganda Phone Validation and Employee Status Registration

## Implemented

- Uganda phone numbers are validated in both frontend and backend.
- Accepted examples include `0701234567` and `+256701234567`.
- Spaces, dashes, parentheses, `256...`, and `00256...` forms are accepted and normalized to `+256XXXXXXXXX`.
- Validation applies to employee contacts, supplier phones, hotel phones, branch contacts, and system-account phones.
- New employee registration no longer displays Employment Status.
- Every newly registered employee is forced to `Active` by the backend.
- Employment Status appears when editing an existing employee so the employee can be deactivated/reactivated.
- User login activation continues to follow employee active status during employee edits.
