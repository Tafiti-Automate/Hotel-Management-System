# Role-aware dashboards

Implemented first phase:

- Stores Manager
- Department Head
- Procurement Manager
- Finance Controller
- General Manager
- HR Administrator

The dashboard selects its configuration from the authenticated user's role and builds charts only from API collections already returned to that signed-in account. Department Head and branch restrictions remain enforced by the existing Django queryset permission filters; the frontend does not request a hotel-wide hidden dashboard payload.

Features included:

- Role-specific KPI cards
- Six-month trend charts
- Status donut charts
- Department, category or store bar charts
- UGX formatting
- Exact-value tooltips using native hover titles
- Empty-data states
- Click-through action queues
- Responsive layouts
- Live-data/connection state indicator

Validation note: frontend and backend dependency folders were deliberately excluded from the returned archive. Run `npm ci && npm run build` in `frontend/`, and install backend requirements before running Django checks. The execution environment used to prepare this archive could not download one npm transitive package and did not have Django installed, so dependency-based builds could not be completed here.
