# Commercial ERP Refinement

This pass removes instructional copy from operational screens and standardizes day-to-day workflows.

## Implemented
- Silent session expiry redirect without the intrusive expiry message.
- Persistent light/dark appearance using local storage.
- Dark-mode fixes for table headers, footers, alerts, page chrome, and native controls.
- Concise role-aware sidebar labels.
- Units of Measure and Unit Conversions available in inventory navigation.
- Requester and request-type fields removed from requisition creation forms where the system already determines them.
- Store request rows now preview requested items instead of exposing raw UUID values.
- Saved-view controls removed.
- Search, status, from-date, and to-date filters added to standard record tables.
- Instructional stock-unit paragraphs removed from operational forms.
- Store request terminology standardized across records and workflow screens.

## Validation
- TypeScript compilation passed.
- Vite production build passed.
