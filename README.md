# Brooklyn Apartment Search

A listing board and the interactive Brooklyn commute map. The map covers Fort Greene, Clinton Hill, Prospect Heights, Bed-Stuy, Brooklyn Heights, Williamsburg, and the Brooklyn F corridor from York Street to Church Avenue.

## Run locally

Use Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Click **Add listing** and paste an individual StreetEasy or Zillow property link. Review the details and fill in anything missing. Listings start in **Interested**. Use the status menu to move a listing to **Contacted**, **Visited**, **Applied**, or **Denied**. Use **Move to trash** in the edit form to hide a listing and its map pin. **Restore** in the bottom-right Trash bin returns it to its previous stack.

Listings with matched addresses appear on **Commute map** as soon as they are saved. Click a pin for a small listing pop-up or use **View on map** from a card to go directly to it. The app looks up Brooklyn street addresses using [NYC Planning GeoSearch](https://geosearch.planninglabs.nyc/docs/). It can suggest a location from a link when the link contains a numbered street address. Listings outside the map coverage or without a matched address remain on the board. To place a pin for an existing listing, edit its street address and save.

On the shared board, address lookups also try the [U.S. Census Geocoder](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html/) when NYC Planning returns no matching address. The fallback requires a single matching Brooklyn house number and street. Census coordinates are estimated along the street address range. To retry an existing listing without a pin, open its edit form and save it.

By default the board saves in the current browser. The map works without a database and is bundled in `public/commute-map.html`. When a listing has a photo URL, its pin pop-up shows the photo. Duplicate detection uses the provider listing ID or building and unit where the URL contains it.

```sh
npm test
npm run build
```

## Shared board for two people

The project supports a single shared board with Supabase Auth and Postgres.

1. Create a Supabase project and run the SQL in the [database migrations](supabase/migrations) in filename order using the SQL Editor. When upgrading an existing board, apply only the new migrations. Apply the workflow migration before deploying the code that uses it.
2. In Supabase Authentication, create confirmed email/password accounts for the board members. Give each person their own password. Use the dashboard to create and confirm the accounts if you want to avoid email delivery setup.
3. Add the two accounts to the board in the SQL Editor. Use the actual account emails in place of the example values.

   ```sql
   insert into public.board_members (user_id)
   select id from auth.users
   where email in ('first@example.com', 'second@example.com')
   on conflict do nothing;
   ```

4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the Supabase project connection settings. Use `.env.local` locally and add both variables to the Vercel project when deploying. Use a publishable key. Keep administrative and secret keys outside the frontend.
5. Sign in on each device. Supabase Realtime syncs shared-board changes. Refocusing the app also refreshes the board.

Database policies restrict the board to the approved members. The commute map is public-source content bundled with the frontend. Device-only listings and shared listings use separate storage.

[Supabase password sign-in](https://supabase.com/docs/guides/auth/passwords) · [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)

## GitHub and Vercel

1. Push this directory as its own repository to a personal GitHub account. A private repository keeps the source within that account’s access settings.
2. Import the repository into Vercel with the **Vite** framework preset. The production build runs `npm run build` and writes to `dist`.
3. Add the two Supabase environment variables if you want listings shared between devices. Redeploy after changing build-time environment variables.

[Deploy Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel Git integration](https://vercel.com/docs/git)

## Automatic listing details and daily suggestions

1. Add a project API key from [OpenAI API Platform](https://platform.openai.com/api-keys) as the server-only `OPENAI_API_KEY` in Vercel's Production environment. Requests are billed to that key’s API project. The shared board uses OpenAI web and image search for published listing details. Missing or unverified details stay blank and can be entered by hand.
2. Add a random `CRON_SECRET` in Production for Vercel's scheduled request. The scheduled job uses the integration’s `SUPABASE_SERVICE_ROLE_KEY` or a server-only `SUPABASE_SECRET_KEY` from the same Supabase project.
3. Deploy. On the shared board, open **Suggestions → Daily search preferences**, choose neighborhoods, set your maximum rent and minimum bedrooms, and turn on daily matches. The search runs once a day at 15:00 UTC when enabled.
4. Review suggested listings on the site. **Save to Interested** adds the listing to the main board and looks up its map pin. **Dismiss** moves it to Trash. The search can miss listings that aren’t indexed yet, and availability can change after a match appears.

Daily searches use up to 24 saved apartments as preference examples, prioritizing **Applied**, **Visited**, **Contacted**, then **Interested**, with recent updates first within each stage. The model looks for similar neighborhoods, rents, bedrooms, bathrooms, and floor areas within your saved search filters. Trashed, denied, and unaccepted suggestions are excluded from preference examples. All previously saved listings are excluded from new results. Only these property attributes and interest weights are sent as examples. The search refreshes its examples from the board on every run.

[OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search) · [Vercel Cron Jobs](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs)

## Nightly availability cleanup

The shared board checks every saved listing outside Trash around 11 p.m. Pacific, including Suggestions. Two daily Vercel schedules cover daylight saving time. The endpoint checks the local hour and each listing's last check date so only one pass applies per night.

Confirmed removals move to Trash and disappear from the active stacks and map. The listing retains its original stage, notes, and details. Open Trash to see the provider result and date, or restore it for review. Restored listings are eligible for the next night's check. Inaccessible pages, redirects to unrelated pages, provider blocks, timeouts, and ambiguous results stay visible with an unconfirmed availability label.

Apply `20261118010000_add_availability_checks.sql` before deploying this version. The cleanup uses the existing `CRON_SECRET`, Supabase URL, and server-only Supabase key. It checks provider HTTP responses, explicit removal headings, and structured availability attached to the exact listing. It works independently of the daily suggestions setting and uses no OpenAI calls. Provider pages that need JavaScript or block server requests may stay unconfirmed.

The scan records each result as it completes, and concurrent edits take precedence over a scan result. It checks up to four listings concurrently within Vercel's five-minute limit. A partial scan returns an error status for visibility in Vercel logs. A repeat invocation during the cleanup hour resumes unchecked listings.
