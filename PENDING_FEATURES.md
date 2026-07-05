# Pending Features — Blocked by Cost or External Approval

A running log of features that are built (or partially built) but can't go live yet because they require a paid service, an API partnership application, or external account setup.

---

## 🔴 Not Built Yet — Needs Paid Service

### Twilio — Automatic SMS for Callout Coverage
**What it unlocks:** The "Find cover" callout flow currently sends emails automatically but texts require manual sending. Twilio would make "Notify all" send a text to every eligible employee at the same time as the email.
**What's needed:**
- Sign up at twilio.com
- Buy a phone number (~$1/month)
- Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` to Vercel env vars
- ~10 minutes of code to wire in

**Cost:** ~$1/month + $0.0079 per outbound text (e.g. 5 employees texted = $0.04)

---

## 🟡 Built — Waiting on Application / Approval

### Indeed — Direct Job Posting API
**Current state:** Clicking "Post to Indeed" opens a pre-filled Indeed job page (deep link). The job isn't actually posted from the app — the owner still has to submit it manually on Indeed's site.
**What it unlocks:** One-click job posting directly from the Jobs page, with status sync back (how many views/applications).
**What's needed:** Apply for Indeed Publisher Partnership at indeed.com/publisher. Approval can take several weeks and requires demonstrating a live product.

---

### Gusto — Payroll Sync
**Current state:** The OAuth connect/callback and sync routes are built and connected in the Integrations page. The sync maps employees and pay rates. However, Gusto's production API requires Partner approval.
**What it unlocks:** Two-way sync of employees, pay rates, and pay periods between Helpdesk and Gusto. Run payroll from Gusto without re-entering data.
**What's needed:** Apply for Gusto Partner API access at gusto.com/developer. Requires a live product and review process.

---

### QuickBooks — Accounting Sync
**Current state:** OAuth connect/callback/sync routes are built. The sync pushes employee payroll data to QuickBooks. Blocked at the production key stage.
**What it unlocks:** Automatically push payroll costs and employee records to QuickBooks for bookkeeping.
**What's needed:** Apply for a QuickBooks production app at developer.intuit.com. Development sandbox works; production requires Intuit review.

---

### Google Calendar — Shift Sync
**Current state:** OAuth connect/callback/sync routes are built. Shift scheduling can push events to the owner's Google Calendar.
**What it unlocks:** Shifts automatically appear in Google Calendar; changes sync both ways.
**What's needed:** Google Cloud Console OAuth app needs to be verified for production (currently in "unverified" mode which shows a scary warning to users). Submit for verification at console.cloud.google.com — requires a privacy policy URL and domain verification.

---

## 🔵 Planned — Ready to Build When Needed

### AI Chatbot — Full App Control
**Current state:** The chatbot can already handle: list employees, analytics summary, approve/deny time off, move applicants, generate and post jobs, clock in/out (employee), check PTO, request time off, view schedule.
**What's missing (owner side):**
- Add / update / terminate an employee
- Send an announcement to all employees
- Add or remove a shift
- Mark a callout and trigger the find-coverage flow
- Generate an onboarding link for a new hire
- Write or view check-in notes for an employee
- See who has incomplete compliance paperwork
- View timesheets and time entries

**What's missing (employee side):**
- View announcements from their employer
- View pay stubs

**What's needed:** All additive — each missing action is one new tool definition + one case in the executeTool switch in `src/app/api/ai/chat/route.ts`. No architectural changes required.

---

## 🟢 Live (No Restrictions)

| Feature | Service | Notes |
|---|---|---|
| Emails (onboarding, announcements, callouts) | Resend | Free tier: 3,000 emails/month |
| AI check-in notes & assistant | Anthropic | Pay-per-token |
| File uploads | Supabase Storage | Included in Supabase plan |
| Auth & database | Supabase | Free tier up to 500MB |
| Hosting | Vercel | Free hobby tier |

---

*Last updated: July 2026*

