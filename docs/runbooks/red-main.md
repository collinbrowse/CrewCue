# Red main

`main` is red when a CI run on `main` fails. Merging continues while it is red. Cutting a release does not.

## How you find out

The **Main CI alert** workflow posts to Slack after each CI run on `main`:

| Message | When |
| --- | --- |
| **main is red** | The first failed run after a green one. Names the failed jobs and lists the commits since the last green run. |
| main is still red | Each failed run after that, with the count. |
| **main is green again** | The first green run after red. |

A run that was cancelled because a newer commit took its place says nothing.

To ask at any time:

```bash
npm run ci:main-status
```

It prints whether `main` is green, and if not, the commit of the last green run.

## What to do

1. **Claim it.** Reply in the Slack thread so two people do not fix the same thing.
2. **Read the failed job's name in the alert.**
   - `ios (no runner started it)`: GitHub had no macOS machine. Nothing is wrong with the code. The next run that touches iOS tests it again, or re-run the job.
   - A device smoke step (`ios`, `android`): the job already retried in CI, so this is more likely real than a flake. Look at the run's warnings for the test names.
   - `checks`, `dual-client-guard`, `api-postgres-integration`: these passed on the PR, so two changes that each passed alone probably broke together. Start with the commits listed in the alert.
3. **Re-run the failed job once.** If it passes on the same commit, it is a flaky test: open an issue with a link to the run.
4. **If it fails again, find the commit.** With a few commits in the alert, read their diffs. With many, run the failing job on the middle one and narrow from there.
5. **Fix or revert.** If the fix is obvious and takes under 30 minutes, fix forward. Otherwise open a revert PR. Both go through the normal PR checks.
6. **Wait for "main is green again"** and say so in the thread.

## Sending an alert again

Actions → **Main CI alert** → Run workflow, with a CI run id from that run's URL. The message is marked `[replay]`. Use it to check the Slack connection.

## Setup

`SLACK_CI_WEBHOOK` is a repository secret holding a Slack incoming webhook. The webhook decides the channel; to move the alerts, create a webhook for the new channel and replace the secret. Without the secret the workflow logs the message and sends nothing.
