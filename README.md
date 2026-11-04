# CampusTools — starter project

A responsive browser-first productivity toolkit with Supabase authentication and mandatory TOTP MFA.

## Included in this starter

- Responsive landing page and signed-in workspace
- Email/password registration and login
- Email confirmation support
- Required TOTP authenticator enrollment and login challenge
- Supabase profile roles (`user` / `admin`)
- SQL schema, RLS policies and manual first-admin promotion
- Image conversion, resizing and compression (PNG/JPG/WebP)
- Background removal integration (see licensing note below)
- Merge PDFs, extract selected pages, images-to-PDF, PDF-to-PNG
- Text-to-PDF
- DOCX text extraction and text-only PDF export
- XLS/XLSX first-sheet-to-CSV

## Requirements

- Node.js 20 or newer recommended
- A free Supabase project
- An authenticator app such as Aegis, 2FAS or Google Authenticator
- GitHub account for source control and optional GitHub Pages hosting

## 1. Install dependencies

```bash
npm install
```

## 2. Configure Supabase

1. Create a project at https://supabase.com/dashboard.
2. In Project Settings, copy the Project URL and publishable key (or legacy anon key).
3. Copy `.env.example` to `.env`.
4. Fill in:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
VITE_BASE_PATH=./
```

The publishable/anon key is intended for browser use. NEVER place a `service_role` key, secret key, database password, or other privileged credential in `.env` for this frontend.

## 3. Create the database schema

In Supabase Dashboard > SQL Editor, run the contents of `supabase/schema.sql`.

The schema creates profiles and usage_events, defaults all new registrations to the `user` role, enables RLS, and restricts profile role changes.

## 4. Configure Supabase Auth

In Authentication settings:

- Enable Email provider.
- Enable email confirmations if desired.
- Set Site URL to your local development URL while testing, then your deployed site URL.
- Add your local and deployed app URLs to the allowed redirect URLs. Password recovery returns to the current app URL.
- Configure an SMTP provider under Authentication > SMTP Settings for reliable recovery-email delivery. Supabase's default email service is rate-limited and intended for testing.
- Customize the password recovery email template under Authentication > Email Templates if needed.
- Keep TOTP MFA enabled.

For local development, allow `http://localhost:5173/**`.
For a GitHub Pages project site, allow `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/**`.

## 5. Run locally

```bash
npm run dev
```

Open the local URL printed by Vite.

## 6. Create your first administrator

1. Register your own account using the site.
2. Confirm your email if email confirmation is enabled.
3. Sign in and complete authenticator enrollment.
4. In Supabase Dashboard > Authentication > Users, copy your user's UUID.
5. Open SQL Editor and run:

```sql
update public.profiles
set role = 'admin'
where id = 'YOUR-AUTH-USER-UUID';
```

Only run this manually for your own trusted account. The browser never gets permission to update `role`. Never add a public "make me admin" form or endpoint.

## 7. Deploy to GitHub Pages

GitHub Pages serves static files; it does not run Node.js as a server. Build the app first:

```bash
npm run build
```

Publish the contents of `dist/` using GitHub Actions or your preferred static deployment workflow. Configure `VITE_BASE_PATH=./` before building for a repository subpath. Add the deployed URL to Supabase Auth's allowed redirect URLs.

Do not commit `.env`. Configure build-time environment variables in your deployment workflow's repository secrets/variables. The publishable key is public by design; privileged keys are not.

## MFA and authorization notes

- The frontend requires a verified TOTP factor and checks for `aal2` before rendering the workspace.
- Database RLS policies also require `aal2` for protected profile updates and usage records.
- Admin role assignment is a manual trusted SQL operation.
- For production, add server-side authorization for every privileged admin action. Do not rely only on hiding UI elements.
- Provide a tested recovery process (backup codes or administrator-assisted identity verification) before broad public launch.
- Consider rate limits, abuse controls, CAPTCHA on signup, email deliverability and monitoring before launch.

## File processing limitations

- Image conversion/resize/compression, PDF merge/split, image-to-PDF, PDF-to-PNG, text-to-PDF, DOCX text extraction and XLSX-to-CSV are implemented in-browser.
- DOCX-to-PDF currently extracts text and creates a simple PDF. It does NOT preserve original Word layout, tables, headers, footers or images.
- Full PDF-to-editable-DOCX, PowerPoint-to-PDF and high-fidelity office conversions are not included in this browser-only starter. They need a separate conversion engine, e.g. a self-hosted LibreOffice service.
- Background removal uses `@imgly/background-removal`. Review the package's current AGPL/commercial licensing terms before public/commercial use; "free to install" does not automatically mean unrestricted commercial use. It may download model assets on first use and can be resource-intensive.
- Large files can exhaust browser memory. Set upload size limits and test on mobile devices.

## Suggested next development stages

1. Add password reset, account recovery and authenticator replacement flows.
2. Add a proper admin console with user search and usage analytics.
3. Add file size/type validation, progress indicators and processing queues.
4. Add a self-hosted conversion backend for high-fidelity DOCX/PPTX/PDF conversions.
5. Add accessibility tests, security review and production monitoring.
