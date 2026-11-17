# Releasing TEX Wallet

A release ships the extension through two channels: a **GitHub Release** (zip + SHA-256) and the **Chrome Web
Store**. Both come from `.github/workflows/release.yml`, which runs when `production` changes.

## Branches

| Branch | Role | What runs |
| --- | --- | --- |
| `main` | Development. Every change lands here through a pull request | CI (`ci.yml`): typecheck, lint, tests, build, zip as a run artifact |
| `release/<version>-<date>` | Snapshot of `main` for one release, kept afterwards | CI on its pull request into `production` |
| `production` | What users get. Only changed by merging a release branch or a hotfix | CI, then `release.yml` |

## Cut a release

1. On `main`, bump the version in `packages/extension/package.json` **and** `packages/extension/public/manifest.json`
   (the same value; the workflow fails if they differ). Merge that through a pull request.
2. `git switch main && git pull && git switch -c release/<version>-<yyyy-mm-dd> && git push -u origin HEAD`
3. Open a pull request from the release branch into `production`. Bách reviews and merges it.
4. The workflow then:
   - runs `npm run check` and builds the extension;
   - stops without publishing if the tag `v<version>` already exists (bump the version to release again);
   - creates the tag and the GitHub Release `TEX Wallet <version>` with `tex-wallet-<version>.zip` and its `.sha256`;
   - uploads the zip to the Chrome Web Store and submits it for review (published right after approval).
5. Check the run in **Actions → Release**, the release page, and the item in the Chrome Web Store dashboard.

Store review usually takes from a few hours to a few days. Visibility (Unlisted or Public) is set in the dashboard
and stays as set; the workflow does not change it.

## Hotfix

Branch `hotfix/<TICKET>-<desc>` from `production`, bump the patch version, open a pull request into `production`,
then merge `production` back into `main`.

## Roll back

- **Chrome Web Store:** in the dashboard, roll back to the previous version (the v2 API also has a `rollback`
  method). Then fix forward with a new version: a store version can never be reused.
- **GitHub Release:** mark the bad release as pre-release or delete it; keep the tag history.
- **Code:** `git revert -m 1 <merge commit>` on `production`, so the next release does not bring the change back.

## One-time setup of the Chrome Web Store upload (Bách)

Done once. The workflow skips the store step (with a warning) until the four repository variables below exist; the
GitHub Release still works without them.

The upload uses a Google service account through **Workload Identity Federation**: GitHub Actions exchanges its
short-lived OIDC token for a short-lived Google access token. There is no key file, refresh token or other secret
to store or rotate, and only runs on `production` of this repository can use it.

### 1. First upload by hand

The store needs the item to exist before the API can update it.

1. Build: `npm ci && npm run build`, then zip the contents of `packages/extension/dist` (or download the zip
   artifact of the latest CI run on `main`).
2. Developer Dashboard → **Add new item** → upload the zip.
3. Fill in the listing from `docs/store/` (AI-53), set visibility to **Unlisted**, and submit.
4. Note the **item ID** (the 32-letter ID in the item URL) and the **publisher ID** (**Publisher → Settings**).

### 2. Google Cloud (run once, as a project owner)

```bash
PROJECT_ID=<a Google Cloud project owned by TexLabs>
REPO=Tech-Expansion/tex-cwallet
SA=tex-wallet-release

gcloud services enable chromewebstore.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project "$PROJECT_ID"
gcloud iam service-accounts create "$SA" --display-name "TEX Wallet release (GitHub Actions)" --project "$PROJECT_ID"
gcloud iam workload-identity-pools create github --location global --display-name "GitHub Actions" --project "$PROJECT_ID"
gcloud iam workload-identity-pools providers create-oidc tex-cwallet \
  --location global --workload-identity-pool github --project "$PROJECT_ID" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition "assertion.repository=='$REPO' && assertion.ref=='refs/heads/production'"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding "$SA@$PROJECT_ID.iam.gserviceaccount.com" --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
echo "GCP_WORKLOAD_IDENTITY_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/tex-cwallet"
echo "GCP_SERVICE_ACCOUNT=$SA@$PROJECT_ID.iam.gserviceaccount.com"
```

### 3. Developer Dashboard

**Account** → add the service account email (`GCP_SERVICE_ACCOUNT` above). A publisher can have only one
service account.

### 4. GitHub repository variables

None of these are secrets. **Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
| --- | --- |
| `CWS_PUBLISHER_ID` | Publisher ID from the dashboard |
| `CWS_EXTENSION_ID` | Item ID from step 1 |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Printed by step 2 |
| `GCP_SERVICE_ACCOUNT` | Printed by step 2 |

The next merge into `production` with a new version uploads to the store.
