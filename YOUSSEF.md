# Youssef's version of ClauTerm (AionUi)

Your own version of what runs in `clauterm-youssef`, built from three repositories:

| Repository                                                                                                                      | `main`                      | `youssef` (yours)                  | Deployed to    |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------- | -------------- |
| [sael-you/AionUi](https://github.com/sael-you/AionUi) — web UI + web host                                                       | exactly upstream **v2.2.2** | your AionUi                        | your container |
| [sael-you/AionCore](https://github.com/sael-you/AionCore) — Rust backend                                                        | exactly upstream **v0.2.2** | your AionCore                      | your container |
| [sael-you/clauterm](https://github.com/sael-you/clauterm) — `aionui/token-pool` (Token Pool, ClauTerm branding, ClauTerm tools) | ClauTerm                    | the Token Pool your container runs | your container |

Only the `youssef` branches are deployed, and only to **your** container. Nothing here touches the
other containers.

## Push = deploy

1. Push to `youssef` in **AionUi or AionCore**. GitHub Actions ("Youssef build") builds both
   `youssef` branches together: AionCore from source, then `aionui-web` (bun-compiled web host,
   static UI, bundled-aioncore). The layout is the same as production. The first build takes about
   30–40 min (Rust); later ones are faster thanks to the cache. The result is a prerelease
   `youssef-build-…` in that repo.
2. Every 2 minutes the server checks for a newer build. It never deploys one where AionUi or
   AionCore is older than what you run. Then it:
   - backs up your database (`aionui-backend.db`);
   - creates a new release folder and switches `/opt/aionui-tp/current`;
   - restarts only AionUi + the Token Pool gateway, for about 10 s. Open AionUi chats stop and
     resume on your next message. Your tmux sessions, dev servers and databases keep running;
   - runs a health check: the gateway answers and AionCore runs from the new release;
   - if that check fails, switches back automatically **and restores the database** from the backup.
3. A push to `youssef` in **sael-you/clauterm** that changes `aionui/token-pool` is deployed the
   same way, without a build.

Pushes that only change `*.md` or `docs/` don't build.

**See what happened**, in your container:

- `cat /root/.clauterm/aionui/deploy/status.json` shows the last deploy and its result;
- `tail /root/.clauterm/aionui/deploy/deploy.log` shows every step, with the AionUi log tail when
  a build did not start.

Build logs are in the repository's Actions tab.

A build that fails its health check is not retried. Push a fix: any newer commit gets a new build.

## Roll back

- **Keep your data:** revert the commit and push. The new build is deployed normally.
- **Back to the release before the last deploy, with the database as it was before that deploy:**
  ```sh
  touch /root/.clauterm/aionui/deploy/rollback-request
  ```
  Within 2 minutes the server switches back and restores the database. Anything written to AionUi
  since that deploy (new chats, messages, settings) is lost. The rolled-back build is not
  redeployed until you push something newer.

## Database migrations: 900–999 are yours

AionCore uses numbered sqlx migrations in `crates/aionui-db/migrations`. `main` keeps upstream's
numbering: v0.2.2 ends at `043`, and upstream continues `044`, `045`, …

**New migrations on `youssef` use 900–999**, for example `900_conversation_hierarchy.sql`. The
build fails if a migration added on `youssef` is outside that range.

- sqlx accepts gaps and applies lower numbers that arrive later. So upstream's `044…` can be merged
  into `youssef` after your `900` without conflict.
- **Never renumber or edit a migration after it ran on your database.** AionCore refuses to start
  when the database contains a migration it doesn't know or whose checksum changed. That's also why
  rolling back restores the database.

## Move a feature from `youssef` to `main`

1. Branch from `main`, then cherry-pick (or merge) the feature's commits from `youssef`.
2. **Keep its migration number** (`9xx`). Your database already ran it under that number, and
   `main` can carry it as is.
3. Open a pull request into `main` (AionUi, AionCore or clauterm). Pushing directly to `main` also
   works.

`main` of AionUi/AionCore is not deployed anywhere automatically. `main` of **sael-you/clauterm**
is: a push there runs "Deploy ClauTerm" for **everyone's** containers, so be careful with it.

Getting upstream updates: `main` is moved to a new upstream release tag, then `main` is merged
into `youssef`.

## What is yours and what is shared

**Yours only:**

- your AionUi database and data: `/root/.aionui-web` → `/root/.clauterm/aionui/aionui-web` in the
  `clauterm_youssef-clauterm` volume. No other container mounts it;
- your projects, `~/.claude`, `~/.codex` and `~/.gemini` (your own volumes);
- the releases in `/opt/aionui-tp`.

**Shared with the others:**

- **The Token Pool keys** (labels, keys, statuses). A small hub copies changes between all four
  containers, in both directions. A key you **add, replace, disable or remove** changes for
  everyone; the key you _use_ (active) stays yours. To fix a broken ChatGPT login, sign in again
  instead of removing it.
- The global config folder every container reads at boot (read-only for you).
- The Docker network (containers can reach each other) and the server's CPU, RAM and disk.

## Your first push: nested agents / conversation hierarchy

Your work in `/root/projects/clauterm-v2` and `/root/projects/clauterm-v2-core` is uncommitted.
It sits on upstream `main` from early November (v2.2.2 + 14 commits, v0.2.2 + 32 commits), so it
has to move onto `youssef`. In each repo:

```sh
git remote add fork git@github.com:sael-you/AionUi.git        # AionCore: sael-you/AionCore.git
git stash push -u -m hierarchy        # keeps your changes, including new files
git fetch fork youssef
git switch -c youssef --track fork/youssef
git stash apply                       # resolve conflicts if any
```

In AionCore, rename the migration before the first commit:

```sh
mv crates/aionui-db/migrations/045_conversation_hierarchy.sql \
   crates/aionui-db/migrations/900_conversation_hierarchy.sql
grep -rn "45" crates/*/src --include=*.rs | grep -i migrat    # anything that refers to the old number
```

Then commit and push AionCore first, then AionUi: `git push fork youssef`. Both pushes start a
build, and the newest complete one is deployed. Drop the stash (`git stash drop`) once the deploy
is OK.
