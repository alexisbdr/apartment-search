# Brooklyn Apartment Search

A listing board and the interactive Brooklyn commute map. The map covers Fort Greene, Clinton Hill, Prospect Heights, Bed-Stuy, and the Brooklyn F corridor from York Street to Church Avenue.

## Run locally

Use Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Click **Add listing** and paste an individual StreetEasy or Zillow property link. Add an address or nickname, neighborhood, rent, bedroom count, and notes as needed. Listings start in **Interested**. Use each card’s status menu to move it to **Contacted**, **Applied**, or **Denied**. The last two statuses share a column.

By default the board saves in the current browser. The map works without a database and is bundled in `public/commute-map.html`. The app opens provider links in a new tab and uses the details you enter. Duplicate detection uses the provider listing ID or building and unit where the URL contains it.

```sh
npm test
npm run build
```

## Shared board for two people

The project supports a single shared board with Supabase Auth and Postgres.

1. Create a Supabase project and run the SQL in [the board migration](supabase/migrations/20261117000000_create_listing_board.sql) using the SQL Editor.
2. In Supabase Authentication, create confirmed email/password accounts for the board members. Give each person their own password. Use the dashboard to create and confirm the accounts if you want to avoid email delivery setup.
3. Add the two accounts to the board in the SQL Editor. Use the actual account emails in place of the example values.

   ```sql
   insert into public.board_members (user_id)
   select id from auth.users
   where email in ('first@example.com', 'second@example.com')
   on conflict do nothing;
   ```

4. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the Supabase project connection settings. Use `.env.local` locally and add both variables to the Vercel project when deploying. Use a publishable key. Keep administrative and secret keys outside the frontend.
5. Sign in on each device. Open or refocus the board to refresh changes from the other account.

Database policies restrict the board to the approved members. The commute map is public-source content bundled with the frontend. Device-only listings and shared listings use separate storage.

[Supabase password sign-in](https://supabase.com/docs/guides/auth/passwords) · [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)

## GitHub and Vercel

1. Push this directory as its own repository to a personal GitHub account. A private repository keeps the source within that account’s access settings.
2. Import the repository into Vercel with the **Vite** framework preset. The production build runs `npm run build` and writes to `dist`.
3. Add the two Supabase environment variables if you want listings shared between devices. Redeploy after changing build-time environment variables.

[Deploy Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel Git integration](https://vercel.com/docs/git)

## Future listing discovery

Start with rental searches saved on StreetEasy or Zillow and turn on their email alerts. Once you choose a mailbox to connect, read only the alerts you authorize, extract listing URLs, and show a shortlist for review. Reuse the board’s provider-level deduplication and require a deliberate save before a candidate enters **Interested**. A licensed provider feed is another option if its terms fit the project.

[StreetEasy saved searches](https://support.streeteasy.com/hc/en-us/articles/360024630671-StreetEasy-Search) · [Zillow saved-search alerts](https://zillow.zendesk.com/hc/en-us/articles/16115195331091-Email-types-consumers-can-receive) · [Zillow Terms of Use](https://www.zillow.com/corporate/terms-of-use/)
