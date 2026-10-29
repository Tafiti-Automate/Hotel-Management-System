# Hotel ERP — Frontend Transformation Audit and Migration Record

## Source-verified baseline

Audited branch: `back$front`, starting commit `3eee89ef192f4e2a3fcbdd02ed49e2afcff310d1`.

- The frontend is in `frontend/`. Next.js App Router currently serves a client-only legacy React ERP composed of `App.tsx`, `AppContext.tsx`, role-specific screens, and substantial legacy CSS.
- The existing Django REST backend lives in `hotel_erp_backend/`, with real endpoints for accounts, stores/inventory, procurement, suppliers, approvals, finance and reporting.
- The frontend API client retains actual backend mappings and token-based authentication. The migration does **not** replace business records with dummy data, forge approvals or modify Django migrations.
- Permission checks exist in both frontend `lib/access.ts` and Django backend. Frontend checks are not the security boundary.
- The repository has many successive CSS layers. A single new, scoped foundation is a transition layer; consolidating individual screen CSS will require screen-by-screen migration and visual regression testing.
- App Router was serving the whole ERP from `/`, while screen navigation remained in React state. As an incremental migration, supported screens now have shareable `/workspace/{route}` URLs and browser history support. Document details continue to use in-memory context until stable record-specific URLs can be implemented safely.
- Frontend production configuration originally contained a Vite-only `VITE_API_BASE_URL`. Next.js requires a server-side `BACKEND_ORIGIN` for its same-origin `/api/v1` proxy. Never put tokens in public variables.

## Implemented in this change

1. Introduce an explicit route registry and URL synchronisation for already-implemented screens.
2. Keep role permissions on navigation and direct URL restoration.
3. Provide a reusable runtime error boundary around route content.
4. Show data-unavailable and connecting states instead of presenting zero counts as confirmed business metrics.
5. Introduce a consistent scoped dark-navy/blue visual foundation, responsive focus handling, and a calm light workspace.
6. Keep backend integrations, domain rules, and database unchanged.

## Still required before production acceptance

- **Critical:** Full per-role API and database UAT for request → approval → sourcing → purchase order → receipt → inventory → finance.
- **Critical:** Verify actual Vercel deployment and backend reachability, including Deployment Protection and authentication.
- Define stable deep links for individual requisitions, purchase orders, suppliers, GRNs and reports.
- Incrementally replace monolithic workflow screens with feature modules and typed API view models, without losing controls.
- Add consistent React Hook Form/Zod validation, common TanStack Table UI, and incremental Tailwind/shadcn adoption after verifying compatibility and field semantics.
- Validate mobile/tablet layouts, keyboard interaction, exports, cancellation, loading, and every submit/approve/reject/post action against real backend states.
- Run `npm ci && npm run typecheck && npm run build` inside `frontend/`, plus Django tests inside `hotel_erp_backend/` on a test database.
- This record is **code inspection**, not a claim of successful builds or production UAT.

## Local setup

```bash
cd frontend
npm ci
BACKEND_ORIGIN=http://127.0.0.1:8000 npm run dev
npm run typecheck
npm run build
```

Vercel: `Framework Preset=Next.js`, `Root Directory=frontend`, `Output Directory=automatic`. Set server-side `BACKEND_ORIGIN` to the trusted deployed Django origin. The browser calls relative `/api/v1/` paths.

Do not use a CDN cache for authenticated API responses.
