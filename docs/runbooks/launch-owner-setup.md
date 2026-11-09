# Launch: owner setup

Everything here needs your accounts, money, legal identity or a console only you can open. Agents do the rest (see the backlog in [pricing-and-v1-scope.md](../product/pricing-and-v1-scope.md)).

## How the agent/human split works

| | Agents | You |
| --- | --- | --- |
| Open, update and merge PRs into `main` once required CI is green | yes | yes |
| Deploy staging (Railway `staging` follows `main`) | yes, by merging | yes |
| Create `v*` tags, run the Release workflow | **no** | yes: `npm run release -- X.Y.Z` |
| Approve the `release` environment (production API, TestFlight, Play internal) | **no** | yes, one click in Actions |
| Put a build in front of testers (TestFlight external group, Play closed track) or users (App Store, Play production) | **no** | yes, in the store consoles |
| Change rulesets, protection, environments, secrets, Railway production | **no** | yes |

Three layers enforce it:

1. **Claude Code hook** (`.claude/hooks/release-guard.mjs`, wired in `.claude/settings.json`). It refuses tag, release, approval, guardrail-edit and Railway-production commands, and tells the agent to stop and ask you. Tests: `scripts/release-guard.test.mjs`.
2. **A separate GitHub identity for agents.** Agents push as a bot account with the Write role. Write cannot bypass rulesets, cannot create `v*` tags, cannot approve environments and cannot read environment secrets.
3. **GitHub rules** (`scripts/github-guardrails.sh`): required checks on `main` that also bind admins, a `v*` tag ruleset that only admins bypass, and a `release` environment that needs your approval and accepts only `v*` tags. All store and production secrets live in that environment, so nothing else can reach them.

The first layer alone can be talked around (for example by an unusual shell construction). Layers 2 and 3 are what actually stop it, so do steps 1 to 3 below before letting agents run unattended.

## 1. Bot account for agents (15 minutes)

1. In a private browser window, create a GitHub account, for example `crewcue-bot`, with its own email (a `+bot` alias of yours works). Turn on 2FA.
2. Sign the GitHub CLI in to the bot in its own config folder. Your normal `gh` login stays as it is:

   ```bash
   GH_CONFIG_DIR=~/.config/gh-crewcue-bot gh auth login --hostname github.com --git-protocol https --web
   ```

   Complete the browser step while signed in as the bot.
3. After step 2 below has sent the invite, accept it as the bot at `https://github.com/collinbrowse/CrewCue/invitations`.
4. Make Claude Code sessions in this repo use the bot for both `gh` and `git push`. Add this to `.claude/settings.local.json` in the main checkout (the file is ignored by git, so it stays on your machine):

   ```json
   {
     "env": {
       "GH_CONFIG_DIR": "/Users/collinbrowse/.config/gh-crewcue-bot",
       "GIT_CONFIG_COUNT": "2",
       "GIT_CONFIG_KEY_0": "credential.https://github.com.helper",
       "GIT_CONFIG_VALUE_0": "",
       "GIT_CONFIG_KEY_1": "credential.https://github.com.helper",
       "GIT_CONFIG_VALUE_1": "!gh auth git-credential"
     }
   }
   ```

   The empty first helper clears the macOS keychain helper (your admin login) for these sessions only. Your own terminal keeps using your login.
5. Start a new Claude Code session and check it with `gh api user -q .login`. It should print the bot's login.

Cloud sessions push through the Claude GitHub App, which is also not an admin, so they get the same limits.

## 2. GitHub guardrails (5 minutes)

From your own terminal, signed in as yourself:

```bash
bash scripts/github-guardrails.sh crewcue-bot --dry-run
```

```bash
bash scripts/github-guardrails.sh crewcue-bot
```

This turns on auto-merge, makes the required checks on `main` bind admins too (`dual-client-guard`, `checks`, `api-postgres-integration`, `pr-decision-doc-guard`, `ios`, `android`; a job that is skipped because a PR does not touch it counts as passing), adds the `release-tags` ruleset, creates the `release` environment with you as the required reviewer and `v*` tags as the only allowed refs, and invites the bot.

Then in **Settings → Environments → release**, add the secrets and variables from [mobile-release.md](mobile-release.md), plus `RAILWAY_TOKEN` (step 3). None of them should be repository-level secrets. Only `SENTRY_DSN` is repository-level today.

## 3. Railway production (20 minutes)

The production service deploys `main` automatically today, so every agent merge reaches production. Change it to deploy only from the Release workflow:

1. Railway → CrewCue project → **production** environment → **CrewCue** service → Settings → Source → **Disconnect** the GitHub repo. Leave staging connected to `main`.
2. Project Settings → Tokens → create a **project token** for the **production** environment. Save it as `RAILWAY_TOKEN` in the GitHub `release` environment.
3. Production service variables: `NODE_ENV=production`, `PERSISTENCE_MODE=postgres`, `DATABASE_URL` (reference the production Postgres), `AUTH0_ISSUER` and `AUTH0_AUDIENCE` (step 4), `SENTRY_DSN` (step 8), the RevenueCat webhook secret (step 7), and the APNs and FCM values (steps 5 and 6).
4. Add a custom domain such as `api.crewcue.app` (buy the domain first). Set `CREWCUE_API_BASE_URL` in the `release` environment to `https://api.crewcue.app`.
5. Turn on Postgres backups for the production database.

## 4. Auth0 production tenant (20 minutes)

1. Create a new tenant, for example `crewcue`, in the US region, on the free plan.
2. APIs → create an API with identifier `https://api.crewcue.app`. That is `AUTH0_AUDIENCE` and `CREWCUE_AUTH0_AUDIENCE`.
3. Applications → create one **Native** app. Allowed Callback and Logout URLs: `crewcue://auth` and `crewcue://<tenant-domain>/android/com.crewcue.android/callback`.
4. Set the release variables `CREWCUE_AUTH0_DOMAIN` and `CREWCUE_AUTH0_CLIENT_ID`. Set the Railway variable `AUTH0_ISSUER=https://<tenant-domain>/`.
5. Social connections: follow [auth0-and-social-idp-setup.md](auth0-and-social-idp-setup.md). If you offer Google sign-in on iOS, App Review also requires Sign in with Apple (Guideline 4.8).

## 5. Apple (you have the account) (1 to 2 hours, then Apple's review times)

1. **Agreements, Tax, and Banking** in App Store Connect: accept the **Paid Apps** agreement, then add bank and tax details. In-app purchases do not work until this shows Active, which can take a day or more.
2. Enroll in the **App Store Small Business Program** (15% commission instead of 30%).
3. Identifiers: register `com.crewcue.ios` with the Push Notifications and Sign in with Apple capabilities.
4. App Store Connect → New App → `com.crewcue.ios`.
5. Users and Access → Integrations → App Store Connect API → generate a key with the **App Manager** role. Save `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` and `APPLE_TEAM_ID` in the `release` environment.
6. Keys → create an **APNs** auth key (.p8). Put the key, the key id and the team id in the Railway production variables that the push work names (agents add them with #563).
7. In-app purchases → create three **consumables**: `race_pass` ($14.99), `crew_upgrade` ($9.99), `race_pass_full_crew` ($19.99), each with a display name, a description and a review screenshot.
8. In-app purchase key (Users and Access → Integrations → In-App Purchase) for RevenueCat (step 7).
9. TestFlight: create an **internal** group (you) and an **external** group (beta testers). Builds reach the internal group as soon as they finish processing. The external group needs Beta App Review the first time, which usually takes about a day.
10. App Privacy: answer from the table in [release/readiness.md](../release/readiness.md#privacy-inputs). Add Sentry crash data once #564 lands.

## 6. Google Play (start today: this sets the Android date)

1. **Pick the account type.**
   - **Personal** ($25, a few days of ID checks). New personal accounts must run a **closed test with at least 12 testers for 14 days in a row** before they can apply for production access ([Google Play Help](https://support.google.com/googleplay/android-developer/answer/14151465)). Your beta testers can be those 12, so the 14 days run while agents finish features.
   - **Organization** ($25). It needs a legal entity and a D-U-N-S number (free, but it can take up to about 30 days to issue), and it skips the 12-tester rule.
   - If you have no company yet, a personal account is the faster path.
2. Create the app `com.crewcue.android`. Keep Play App Signing on (the default).
3. Create the upload keystore and the Play service account as described in [mobile-release.md](mobile-release.md#github). Back the `.jks` file up somewhere outside the repo, such as your password manager.
4. **Payments profile** (Settings → Payments profile) so the app can sell in-app products. Create the same three one-time products with the same ids and prices.
5. Settings → License testing: add your beta testers' Google accounts so their purchases are free test purchases.
6. Upload the first `.aab` by hand to **Internal testing** (Play's API cannot create the first release). Set `PLAY_RELEASE_STATUS=draft` in the `release` environment until the app's first review passes.
7. Create the **Closed testing** track, add the tester list (an email list or a Google Group), and start the 14-day clock as soon as one build works end to end.
8. Firebase: create a project, add the Android app `com.crewcue.android`, download `google-services.json` for the push work (#563), and create a service-account key for the API to send FCM messages.
9. Complete the forms: Data safety (same privacy table), content rating, target audience, and the background-location declaration with a short video once #562 ships.

## 7. RevenueCat (30 minutes)

1. Sign up (free). Create a project with an iOS app (bundle id, in-app purchase key from Apple step 8) and an Android app (package name, Play service-account JSON).
2. Import the three products. Create an entitlement per product type, or leave the mapping to the billing PR, which will say exactly what it expects.
3. Integrations → Webhooks → URL `https://api.crewcue.app/billing/revenuecat` (the billing PR confirms the path), with an authorization header value. Save that value in Railway production as the webhook secret.
4. Copy the public SDK keys for iOS and Android into the `release` environment variables the billing PR names.

## 8. Sentry (10 minutes)

Free Developer plan. Create three projects: `crewcue-ios`, `crewcue-android`, `crewcue-api`. Put the API DSN in Railway production and the app DSNs in the `release` environment variables that #564 names.

## 9. Domain, legal and support pages (1 hour, mostly reading)

1. Buy a domain (for example `crewcue.app`). Point `api.` at Railway and the root at GitHub Pages.
2. Agents draft the privacy policy, terms, support page and account-deletion page (backlog item 9). **Read them and approve them yourself.** They are legal commitments. Paying a lawyer to review them or using a reputable generator is worth considering.
3. Create a support email address, for example `support@crewcue.app`.

## 10. Store listings (2 hours)

Name, subtitle, description, keywords, category (Health & Fitness), screenshots (6.9-inch iPhone and an Android phone; agents can capture them from simulators), a 512 px Play icon, a feature graphic, the support URL, the privacy URL, and the age rating and content rating questionnaires.

## Releasing

1. Agents merge to `main`, and staging updates.
2. When you want a build: from your own terminal on an up-to-date `main`, run

   ```bash
   npm run release -- 0.1.0
   ```

3. In GitHub → Actions → Release, click **Review deployments → Approve** (once for preflight, once for the deploy jobs).
4. The workflow deploys the production API, uploads iOS to TestFlight (internal group) and uploads Android to Play internal testing.
5. Try the build yourself. Then **you** add it to the TestFlight external group or the Play closed track. That is the moment testers see it.
6. Store launch later: submit for App Store review, and promote to Play production after the 14-day test.
