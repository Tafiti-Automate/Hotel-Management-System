# Hotel / Branch Setup Changes

This update adds a proper hotel registration layer for the Hotel Management System.

## Added

### New app: `apps.organization`

#### Hotel model
Captures the parent hotel or hotel group profile:

- Hotel name
- Legal name
- Business type: single hotel or hotel group
- Registration number
- TIN
- Email and phone contacts
- Website
- Logo
- Address, city, country
- Currency and timezone
- Active/inactive status

API endpoint:

```text
/api/v1/hotels/
```

## Updated

### Branch model
Branches now belong to a hotel and support both single-property and multi-branch hotels.

Added fields:

- hotel
- branch_code
- branch_type
- physical_address
- city
- country
- email
- is_head_office

Branch rules added:

- Branch names are unique per hotel
- Branch codes are unique per hotel when provided

API endpoint remains:

```text
/api/v1/branches/
```

## Recommended setup flow

### Single hotel

```text
Create Hotel: Palm Suites Hotel
    ↓
Create Branch: Main Property
```

### Hotel with branches

```text
Create Hotel: Serena Hotel Group
    ↓
Create Branch: Kampala
Create Branch: Entebbe
Create Branch: Mbale
```

Other modules such as departments, employees, stores, stock, requisitions, and procurement can continue using the Branch model.
