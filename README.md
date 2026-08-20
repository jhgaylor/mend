# Mend

Find the misconfigurations in a repo's infrastructure — then fix them.

Name a public repo and Mend hires a *mender*: an agent on its own computer
that clones the repo, runs a [`chant audit`](https://intentius.io/chant/cli/audit/)
over its CI workflows, Kubernetes manifests, Dockerfiles, Helm charts and
cloud templates, and then does something an audit tool cannot — applies the
mechanical fixes, reasons through the judgement calls, refuses to guess at the
ones that turn on intent it cannot see, and hands you one reviewable patch.

The audit half is the engine behind [blacklight](https://blacklight.intentius.io)
(a hosted `chant audit`) running locally on the sandbox instead of at the edge.
The mending half is the point of the demo: a report tells you what is wrong, an
agent with a real computer can go and change it.

It is a static single-page app with no backend of its own — it talks only to
the [Fountain](https://github.com/BinaryBourbon/fountain) API, where each mender
runs as a teammate (an agent in a sandbox with a real shell, git, and the chant
CLI). Client patterns (OAuth, SSE, API client) follow
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

Two optional things you can add to that environment yourself, in Fountain:

- a `GITHUB_TOKEN` secret — lets a mender open a pull request when you ask it
  to (`gh pr create`), instead of only handing back a patch.
- nothing else. Menders clone over anonymous https and never push without that
  token.

## How it works: the mend protocol

The app and the agent share three fenced blocks, parsed out of the agent's
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

The patch renders as a diff per file and downloads as a `.patch` you apply
yourself (`git apply mend-owner-name.patch`) — the agent never pushes. Ask for
changes in the composer ("drop fix 3", "only the security ones", "split this
per finding") and it revises the working tree and re-emits both blocks; the app
shows the newest pair. Ask it to open a PR and it will, if the environment has
a `GITHUB_TOKEN`.

The conversation is the system of record: the report, the plan and the patch
are all derived from turns + blocks on load, and from one `/api/team/stream`
SSE connection while live. The clone and the branch persist on the mender's
computer between messages.

## Development

```bash
bun test           # protocol, hosts, diff parsing, ACP block parsing, SSE, render smoke
bun run typecheck
bun run build      # tsc + vite
```

To work on the UI without a live Fountain, run the mock (`bun run mock`), start
the app through the dev proxy (`FOUNTAIN_PROXY=http://localhost:8789 bun run
dev`), and enter `http://localhost:5180` as the Fountain URL with any string as
the API key — you land on a mender that has already audited a repo and mended
it, with a full report, plan and patch.

No state outside the browser: settings in `localStorage` (`mend.settings`), the
repo → mender pairings per Fountain URL (`mend.repos`).

## Deploy

Static files behind nginx, same as the other demos: CI builds the bundle, bakes
`ghcr.io/jhgaylor/mend`, pins the sha tag into `k8s/deployment.yaml`, and Flux
rolls it out (home-cloud) at `mend.inevitable.fyi`.

## License

MIT
