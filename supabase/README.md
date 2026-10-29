# Backend (Supabase project: hilax-hospital)

- `migrations/` - SQL schema changes, applied in filename order.
- `functions/` - Edge Functions (server-side code that needs the service key).

Rule: every database or function change is saved here first, then applied to Supabase.
