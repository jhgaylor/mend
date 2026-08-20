# Mend

**See what [`chant audit`](https://intentius.io/chant/cli/audit/) finds in a
repo's infrastructure — then see what an agent does with it once you hand it
the tool.**

chant is a type system for operations, and `chant audit` is the part of it you
can point at any repo today. It reads the CI workflows, Kubernetes manifests,
Dockerfiles, Helm charts, CloudFormation, ARM and Config Connector templates it
finds, runs a few hundred security and correctness checks over them, and — the
part that matters — sorts what it finds by *how confident the fix is*:

| tier | chant's position |
|---|---|
| **quick win** (merge-worthy, deterministic) | it knows the exact fix and ships the unified diff |
| **needs review** (merge-worthy, guidance) | it is confident something is wrong, and will not guess at the fix |
| **hygiene** (report-only) | worth knowing, not worth a PR |

Most tools stop at a list. That middle tier is why this app exists: it is
precisely the work that needs judgement and a real machine — read the file,
understand what the job is for, decide whether the change preserves behaviour.
So Mend gives chant to an agent (Claude, on a computer of its own) and lets it
finish the job: it applies the mechanical fixes, reasons through the judgement
calls, refuses the ones that turn on intent it cannot see, verifies by
re-running the audit, and hands back one reviewable patch — or opens the pull
request from your browser.

Nothing here is hosted magic. The audit is the same CLI you can run yourself:

```sh
npx -p @intentius/chant -p @intentius/chant-lexicon-github …  chant audit .
```

The same engine runs hosted at [blacklight](https://blacklight.intentius.io).
This page is the version with an agent attached.

**Where Fountain comes in:** the agent needs a real computer — a shell, git, and
chant on the PATH — and something has to hand the browser a stream of what it is
doing. That is [Fountain](https://github.com/BinaryBourbon/fountain), and that is
all it is here: the stagehand. Mend is a static page with no backend of its own;
it talks to the Fountain API for the sandbox and to api.github.com for the pull
request. Client patterns (OAuth, SSE, API client) follow
[repo-sage](https://github.com/jhgaylor/repo-sage) /
[dns-desk](https://github.com/jhgaylor/dns-desk).

## Run it

```bash
bun install
bun run dev        # http://localhost:5180
```

On first load, enter your Fountain URL and **Sign in with Fountain** (OAuth
code + PKCE; the token is an API key), or paste an API key. Then name a repo —
`owner/name`, or a URL on `github.com`, `gitlab.com` or `codeberg.org`, public
repos only. The app hires one mender per repo (an agent named
`Mend: host/owner/name`, added to your team), sends it off to audit, and
remembers the pairing per Fountain URL in this browser.

Server-side requirements, same as any external Fountain client:

```
API_CORS_ORIGINS=http://localhost:5180     # or wherever you host the build

# only for "Sign in with Fountain" — JSON, redirect URIs match exactly:
OAUTH_CLIENTS='[{"id":"mend","name":"Mend","redirect_uris":["http://localhost:5180/"]}]'
```

The production deployment at `mend.inevitable.fyi` needs the same two entries
with `https://mend.inevitable.fyi` / `https://mend.inevitable.fyi/`.

## The toolkit environment

The first time you add a repo, the app creates one Fountain **Environment**
called `Mend toolkit` (`src/lib/spec.ts`) and every mender is created on it:
`npm` packages `@intentius/chant` plus the ten audit lexicons blacklight runs
(GitHub, GitLab, Forgejo, k8s, Docker, AWS, Azure, GCP, Helm, Fountain), and
`apt` `jq`. That is what puts `chant audit` on the sandbox's PATH. If the
environment cannot be created the mender still works — the prompt falls back to
an `npx -p …` invocation of the same packages.

Nothing else belongs in that environment — in particular **no GitHub token**.
Menders clone over anonymous https and never push. The pull request is opened by
the app, from your browser, with your own credential (see below).

## How it works: the mend protocol

The app and the agent share five fenced blocks, parsed out of the agent's
replies (`src/lib/protocol.ts`; the agent's side of the contract is
`src/lib/spec.ts` — change one, change both).

On its first message the mender clones the repo and runs the audit twice (JSON
for structure, Markdown because that is where chant renders the ready-to-apply
quick-win diffs). It reports the audit:

    ```audit-report
    {"branch":"main","commit":"9f1c4a2…","scanned":14,
     "summary":{"total":9,"quickWin":3,"needsReview":4,"reportOnly":2,…},
     "findings":[{"checkId":"GHA033","severity":"error","file":".github/workflows/ci.yml",
                  "entity":"build","tier":"merge-worthy","fixKind":"deterministic",
                  "category":"security","title":"Blanket write-all permissions",
                  "remediation":"Set a least-privilege permissions block.",
                  "authority":{"name":"OSSF Scorecard — Token-Permissions","url":"…"}}],
     "omitted":0}
    ```

The app renders that the way a chant report reads: tier counts, quick wins
grouped by file, guidance clustered under the standard it cites, hygiene folded
away. Every rule id links to its entry in the
[audit rules reference](https://intentius.io/chant/lint-rules/audit-rules/);
every file links into the repo on its host.

Then you press **Mend it**, and the agent works on a branch in its clone and
comes back with a plan and a patch:

    ```mend-plan
    {"before":{"mergeWorthy":7},"after":{"mergeWorthy":1},
     "fixes":[{"id":1,"status":"applied","checkIds":["GHA033"],
               "files":[".github/workflows/ci.yml"],
               "title":"Least-privilege workflow permissions",
               "note":"The build only reads the repo, so contents: read."}],
     "pr":{"title":"ci: harden config per chant audit","body":"…"}}
    ```

    ```mend-patch
    diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
    …
    ```

Fixes are grouped by what *you* have to do about them, which is the honest axis:

| status | means |
|---|---|
| `applied` | a mechanical fix from chant's own diff — read it if you like |
| `proposed` | the agent's judgement call, made because it was confident — review before merging |
| `skipped` | the right answer depends on intent the agent cannot see, with a note on what to decide |

Alongside the plan the mender sends **one `mend-fix <id>` block per fix**,
each carrying only that fix's diff and applying on its own against the
audited commit. That is what makes the fixes independently selectable — the app can
build a commit from exactly the ones you tick.

The patch renders as a diff per file and downloads as a `.patch` you apply
yourself (`git apply mend-owner-name.patch`). Ask for changes in the composer
("drop fix 3", "only the security ones", "split this per finding") and it
revises the working tree and re-emits the blocks; the app shows the newest set.

## Opening a pull request

The agent never opens PRs and never pushes. The app does it, in the browser:

1. **Tick the fixes** you want. Every applied/proposed fix has an *add to PR*
   box; skipped ones cannot be ticked (nothing was changed for them).
2. **Connect GitHub** with your own personal access token (`public_repo`
   scope), stored in this browser under `mend.github`. It is deliberately not a
   shared token — Mend is a public page, so anything the app could read, every
   visitor could read. The PR is authored by you, from a credential you revoke.
3. **Draft the description.** The app asks the mender to write a title and body
   for *exactly* the ticked fixes; it comes back as a `pr-draft` block and lands
   in an editable form.
4. **Open pull request.** The app merges the selected fixes' diffs, reads each
   file from GitHub at the current head, applies the hunks, and creates blobs, a
   tree, a commit, a branch and the PR — forking first when you lack push
   access. `api.github.com` allows this from a page, so no backend is involved.

Every context and deletion line is verified against the file as it is on GitHub
*right now*. If the branch moved since the audit, the app refuses and tells you
to re-audit rather than committing a file it cannot vouch for. Opening a PR is
GitHub-only; on GitLab and Codeberg you get the patch.

The conversation is the system of record: the report, the plan and the patch
are all derived from turns + blocks on load, and from one `/api/team/stream`
SSE connection while live. The clone and the branch persist on the mender's
computer between messages.

## Development

```bash
bun test           # protocol, hosts, diff parsing + application, ACP blocks, SSE, render smoke
bun run typecheck
bun run build      # tsc + vite
```

To work on the UI without a live Fountain, run the mock (`bun run mock`), start
the app through the dev proxy (`FOUNTAIN_PROXY=http://localhost:8789 bun run
dev`), and enter `http://localhost:5180` as the Fountain URL with any string as
the API key — you land on a mender that has already audited a repo, mended it
and drafted a PR, with a full report, per-fix diffs, patch and draft form.

No state outside the browser: settings in `localStorage` (`mend.settings`), the
repo → mender pairings per Fountain URL (`mend.repos`), and your GitHub token
(`mend.github`). Nothing is stored on a server.

## Deploy

Static files behind nginx, same as the other demos: CI builds the bundle, bakes
`ghcr.io/jhgaylor/mend`, pins the sha tag into `k8s/deployment.yaml`, and Flux
rolls it out (home-cloud) at `mend.inevitable.fyi`.

## License

MIT
