Cron Runbook

- Endpoints:
  - `/api/cron` (Vercel scheduled, every minute)
    - Calls `/api/queue/process` and `/api/cron/gmb-refresh` with `Authorization: Bearer $CRON_SECRET`.
  - `/api/cron/gmb-refresh` (guarded): also accepts `x-cron-secret: $CRON_SECRET`.

- Scheduling:
  - GitHub Actions workflow: .github/workflows/cron.yml (every 5 minutes)
  - Vercel cron removed from vercel.json; cron is handled via GitHub exclusively.

- Secrets:
  - Set `CRON_SECRET` in environment (Vercel and local). Already present in `.env.vercel`.
  - Set `APP_URL` in GitHub repo secrets to the deployed base URL.

- Test locally:
  - `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/queue/process -X POST`
  - `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/gmb-refresh`

- Logs:
  - Decryption failures are logged as `security_event` with event `token_decryption_failed`.
  - Queue processor logs failures to `publishing_history.last_error` and triggers in-app notifications.
