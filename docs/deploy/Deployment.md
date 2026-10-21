# Zipwyn Serverless: Production Deployment Guide

This guide takes you from an empty AWS account to a running production deployment, and then through migrating the
existing (manually created) setup. Follow the sections in order.

- [1. What you are deploying](#1-what-you-are-deploying)
- [2. Prerequisites](#2-prerequisites)
- [3. Authenticate to AWS](#3-authenticate-to-aws)
- [4. Create the Terraform state bucket (one time)](#4-create-the-terraform-state-bucket-one-time)
- [5. Configure Terraform](#5-configure-terraform)
- [6. Deploy, phase 1: infrastructure and certificate](#6-deploy-phase-1-infrastructure-and-certificate)
- [7. Name.com, part 1: certificate validation records](#7-namecom-part-1-certificate-validation-records)
- [8. Deploy, phase 2: custom domains](#8-deploy-phase-2-custom-domains)
- [9. Name.com, part 2: point the domains at AWS](#9-namecom-part-2-point-the-domains-at-aws)
- [10. Verify the deployment](#10-verify-the-deployment)
- [11. Migrate from the existing setup](#11-migrate-from-the-existing-setup)
- [12. Connect the Zipwyn web app](#12-connect-the-zipwyn-web-app)
- [13. Harden and finish](#13-harden-and-finish)
- [14. Day-2 operations](#14-day-2-operations)
- [15. Troubleshooting](#15-troubleshooting)

---

## 1. What you are deploying

| Hostname                   | Purpose                              | Backed by                          |
|----------------------------|--------------------------------------|------------------------------------|
| `zip.navindalc.app`        | Public short links `/{shortCode}`    | Redirect API, `zipwyn-redirect`    |
| `zipwyn-api.navindalc.app` | Management API for the web app       | Management API, 3 Lambda functions |
| `zipwyn.navindalc.app`     | Zipwyn web app                       | Hosted separately (not in this repo) |

Terraform creates the DynamoDB table `zipwyn-urls`, four Lambda functions with individual IAM roles, two API Gateway
HTTP APIs, an ACM certificate, the custom domains, log groups and (optionally) alarms.

DNS for `navindalc.app` is managed at **Name.com**, which Terraform cannot change. That is why deployment is split into
two applies, with manual DNS steps in between:

```
apply #1  ->  add 2 certificate-validation CNAMEs  ->  apply #2  ->  add 2 domain CNAMEs
```

You will create exactly **four DNS records** at Name.com in total (plus one more if you keep a legacy domain, see
[section 11](#11-migrate-from-the-existing-setup)).

Subdomain names are variables (`redirect_subdomain`, `api_subdomain`, `frontend_subdomain`). Change them in
`terraform.tfvars` before the first apply if you prefer different names; everything else follows automatically.

## 2. Prerequisites

| Requirement | Notes |
|---|---|
| AWS account | A dedicated account or a clean region. All resources go to `ap-southeast-1` (Singapore) by default |
| AWS CLI v2 | `aws --version` |
| Terraform 1.10 or newer | `terraform version`. 1.10+ is required for native S3 state locking |
| Name.com access | Ability to edit DNS records for `navindalc.app` |
| Git, Node.js 24, pnpm | Only needed to run tests and the migration script |

**Permissions of the deploying AWS identity.** The simplest option for a personal account is an administrator role
(preferably via IAM Identity Center, not the root user). If you use a scoped policy it needs: DynamoDB, Lambda, IAM
(create roles and inline policies, `iam:PassRole`), API Gateway, ACM, CloudWatch Logs (including log delivery and
resource policies, which API Gateway access logging requires), CloudWatch alarms, SNS, and S3 on the state bucket.

Make sure the repository is up to date and the code passes its checks:

```bash
git clone https://github.com/paradocx96/zipwyn-serverless.git
cd zipwyn-serverless
pnpm install
pnpm test
```

## 3. Authenticate to AWS

```bash
aws configure sso --profile zipwyn        # or: aws configure --profile zipwyn
aws sso login --profile zipwyn
export AWS_PROFILE=zipwyn
export AWS_REGION=ap-southeast-1

aws sts get-caller-identity               # confirm the right account
```

## 4. Create the Terraform state bucket (one time)

Terraform keeps its state in a private, versioned S3 bucket. Create it once, outside Terraform:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="zipwyn-terraform-state-${ACCOUNT_ID}"

aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"

aws s3api put-bucket-versioning \
  --bucket "$BUCKET" --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "$BUCKET"
```

## 5. Configure Terraform

```bash
cd infra/terraform
cp backend.hcl.example backend.hcl
cp terraform.tfvars.example terraform.tfvars
```

**`backend.hcl`**: put your bucket name in `bucket`:

```hcl
bucket       = "zipwyn-terraform-state-123456789012"
key          = "zipwyn-serverless/terraform.tfstate"
region       = "ap-southeast-1"
encrypt      = true
use_lockfile = true
```

**`terraform.tfvars`**: for the first apply, make sure these are set:

```hcl
aws_region            = "ap-southeast-1"
root_domain           = "navindalc.app"
redirect_subdomain    = "zip"
api_subdomain         = "zipwyn-api"
frontend_subdomain    = "zipwyn"
enable_custom_domains = false          # stays false until section 8

alarm_email           = "you@example.com"   # recommended
```

> **About `management_api_key`.** Leave it unset for now. You will enable it in [section 13](#13-harden-and-finish)
> after the web app has been updated to send it. Both files are git-ignored; never commit them.

Initialise Terraform:

```bash
terraform init -backend-config=backend.hcl
```

`init` creates `.terraform.lock.hcl`. **Commit that file**; it pins the provider versions.

## 6. Deploy, phase 1: infrastructure and certificate

```bash
terraform plan -out=tfplan
terraform apply tfplan
```

Review the plan before applying. A fresh deployment adds about 40 resources and changes nothing else. This step creates
the table, functions, roles, APIs, log groups and **requests** the ACM certificate. The certificate stays
`PENDING_VALIDATION` until you add DNS records.

Show the records ACM needs:

```bash
terraform output acm_validation_records
```

Example output (your values differ):

```
acm_validation_records = [
  {
    domain = "zip.navindalc.app"
    host   = "_9f2c1a7e.zip"
    type   = "CNAME"
    value  = "_4b8d0c33.xlfgrmvvlj.acm-validations.aws."
  },
  {
    domain = "zipwyn-api.navindalc.app"
    host   = "_3a6e5d10.zipwyn-api"
    type   = "CNAME"
    value  = "_7c1f9b42.xlfgrmvvlj.acm-validations.aws."
  },
]
```

You can already smoke-test the APIs on their default AWS endpoints (`terraform output default_endpoints`):

```bash
MGMT=$(terraform output -json default_endpoints | jq -r .management)
curl -X POST "$MGMT/urls" -H "Content-Type: application/json" -d '{"url":"https://example.com"}'
```

## 7. Name.com, part 1: certificate validation records

1. Sign in to Name.com, open **My Domains**, choose `navindalc.app`, then **Manage DNS Records** (the menu wording can
   vary slightly).
2. Add one record per entry from the output above:

   | Field  | Value                                                   |
   |--------|---------------------------------------------------------|
   | Type   | `CNAME`                                                 |
   | Host   | the `host` value, e.g. `_9f2c1a7e.zip`                  |
   | Answer | the `value`, e.g. `_4b8d0c33.xlfgrmvvlj.acm-validations.aws` |
   | TTL    | `300` (or the default)                                  |

   - Enter **only the `host` part**. Name.com appends `navindalc.app` itself; entering the full name produces a doubled
     name such as `_9f2c1a7e.zip.navindalc.app.navindalc.app` and validation will never succeed.
   - If Name.com rejects the trailing dot in the answer, remove it.
3. Wait for ACM to validate (usually 2 to 10 minutes, sometimes longer):

   ```bash
   aws acm describe-certificate \
     --certificate-arn "$(terraform output -raw certificate_arn)" \
     --query Certificate.Status --output text
   ```

   Continue when it prints `ISSUED`. Check DNS propagation with
   `dig +short CNAME _9f2c1a7e.zip.navindalc.app`.

## 8. Deploy, phase 2: custom domains

Edit `terraform.tfvars`:

```hcl
enable_custom_domains = true
```

```bash
terraform plan -out=tfplan
terraform apply tfplan
```

This creates the two API Gateway custom domains and maps each to its API. Then list the CNAMEs to create:

```bash
terraform output dns_records
```

```
dns_records = [
  { host = "zip",        type = "CNAME", value = "d-abc123xyz.execute-api.ap-southeast-1.amazonaws.com" },
  { host = "zipwyn-api", type = "CNAME", value = "d-def456uvw.execute-api.ap-southeast-1.amazonaws.com" },
]
```

## 9. Name.com, part 2: point the domains at AWS

Add these two records in the same DNS screen:

| Type  | Host         | Answer (from `dns_records`)                         | TTL |
|-------|--------------|-----------------------------------------------------|-----|
| CNAME | `zip`        | `d-abc123xyz.execute-api.ap-southeast-1.amazonaws.com` | 300 |
| CNAME | `zipwyn-api` | `d-def456uvw.execute-api.ap-southeast-1.amazonaws.com` | 300 |

Keep the validation CNAMEs from section 7: ACM uses them to renew the certificate automatically.

Final DNS checklist for `navindalc.app` at Name.com:

| Host                      | Type  | Purpose                              |
|---------------------------|-------|--------------------------------------|
| `_xxxx.zip`               | CNAME | ACM validation / auto-renewal        |
| `_yyyy.zipwyn-api`        | CNAME | ACM validation / auto-renewal        |
| `zip`                     | CNAME | Short links, to API Gateway          |
| `zipwyn-api`              | CNAME | Management API, to API Gateway       |
| `zipwyn`                  | (existing) | Zipwyn web app, not changed here |

## 10. Verify the deployment

Wait a few minutes for DNS, then:

```bash
dig +short CNAME zip.navindalc.app
dig +short CNAME zipwyn-api.navindalc.app

# Create a link through the management API
curl -s -X POST https://zipwyn-api.navindalc.app/urls \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hello","customCode":"smoke-test"}'

# Follow it on the redirect domain (expect HTTP 302 and a Location header)
curl -i https://zip.navindalc.app/smoke-test

# Stats should now show clicks: 1
curl -s https://zipwyn-api.navindalc.app/urls/smoke-test/stats

# Unknown codes return the Zipwyn 404 page
curl -i https://zip.navindalc.app/does-not-exist

# CORS preflight from the web app origin
curl -i -X OPTIONS https://zipwyn-api.navindalc.app/urls \
  -H "Origin: https://zipwyn.navindalc.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"

# Watch the logs
aws logs tail /aws/lambda/zipwyn-redirect --follow
```

Remember the `smoke-test` link is real data in the table. If `management_api_key` is already set, add
`-H "x-api-key: <key>"` to the management calls.

If you set `alarm_email`, open the AWS confirmation email (subject "AWS Notification - Subscription Confirmation") and
click **Confirm subscription**; alarms stay silent until you do.

## 11. Migrate from the existing setup

Skip this section if you are starting fresh. If the project is already live with manually created resources (the old
DynamoDB table `url-shortener-urls`, hand-made Lambdas, an API Gateway and the domain `short.navindalc.app`), do the
migration below. Nothing here touches the old resources until you decide to delete them in the last step.

### 11.1 Back up the old table

```bash
aws dynamodb create-backup \
  --table-name url-shortener-urls \
  --backup-name pre-zipwyn-migration-$(date +%Y%m%d)
```

### 11.2 Copy the data

The script copies every item and, by default, **never overwrites** items that already exist in the target, so it is safe
to run repeatedly. Always try a dry run first:

```bash
# from the repository root, with AWS credentials for the same account/region
node scripts/migrate-table.mjs --source url-shortener-urls --target zipwyn-urls --dry-run
node scripts/migrate-table.mjs --source url-shortener-urls --target zipwyn-urls
```

Check the counts:

```bash
aws dynamodb scan --table-name url-shortener-urls --select COUNT
aws dynamodb scan --table-name zipwyn-urls        --select COUNT
```

### 11.3 Switch the web app to the new API

Follow [section 12](#12-connect-the-zipwyn-web-app). From this moment new links are created in `zipwyn-urls` and use
`https://zip.navindalc.app/<code>`. Existing links keep working on the old stack for now.

### 11.4 Keep old short links working (legacy domain)

Links already shared look like `https://short.navindalc.app/<code>`. To keep them alive, serve that hostname from the
new redirect API too. Before you start, check what `short.navindalc.app` currently serves; the steps below assume it is
only used for redirects.

1. **Lower the DNS TTL** of the existing `short` record at Name.com to 300 seconds, and wait for the old TTL to expire.
2. **Final data sync**, right before the switch. This refreshes click counts and picks up links created since step 11.2:

   ```bash
   node scripts/migrate-table.mjs --source url-shortener-urls --target zipwyn-urls --overwrite
   ```

   `--overwrite` replaces items that exist in both tables with the old table's version. It only touches codes that
   exist in the old table, so links created after the web app switch are not affected.
3. **Remove the old custom domain.** API Gateway domain names are unique per region, so the hand-made one must go before
   Terraform can create it (the old API's traffic stops here, which starts the short downtime window):
   - API Gateway console, region `ap-southeast-1`, **Custom domain names**, select `short.navindalc.app`, delete its API
     mappings, then delete the domain name.
4. **Add the domain in Terraform** (`terraform.tfvars`):

   ```hcl
   redirect_extra_domains = ["short.navindalc.app"]
   ```

   ```bash
   terraform plan -out=tfplan
   terraform apply tfplan
   ```

   Adding a hostname replaces the certificate with one that also covers it. ACM validation records are the same for
   the same domain and account, so the existing `_xxxx.short` CNAME at Name.com normally validates it immediately. If
   the apply waits at `aws_acm_certificate_validation`, open **ACM** in the console, find the pending certificate and
   add any missing CNAME at Name.com. The apply continues by itself.
5. **Repoint DNS.** Get the target and update the existing `short` record at Name.com:

   ```bash
   terraform output dns_records
   ```

   | Type  | Host    | Answer                                                    |
   |-------|---------|-----------------------------------------------------------|
   | CNAME | `short` | the `d-xxxx.execute-api.ap-southeast-1.amazonaws.com` value listed for `short` |

6. **Verify** an old link:

   ```bash
   curl -i https://short.navindalc.app/<an-old-code>      # 302 to the original destination
   curl -s https://zipwyn-api.navindalc.app/urls/<an-old-code>/stats
   ```

New links always use the primary redirect domain (`zip.navindalc.app`); the legacy domain only exists so old links
continue to resolve.

### 11.5 Decommission the old stack (after a quiet period)

Wait a few weeks, confirm in CloudWatch that the old Lambdas and API receive no traffic, then delete:

- the old Lambda functions, their IAM roles and log groups
- the old API Gateway API
- the old ACM certificate, if nothing else uses it
- the old DynamoDB table `url-shortener-urls` (keep the backup from 11.1 for as long as you want a fallback)

## 12. Connect the Zipwyn web app

Update the web app's configuration (in its hosting environment, for example environment variables in AWS Amplify) so
that:

| Setting                      | Value                                   |
|------------------------------|-----------------------------------------|
| Management API base URL      | `https://zipwyn-api.navindalc.app`      |
| Short-link domain            | taken from the API response (`shortUrl`), currently `https://zip.navindalc.app` |

Use the variable names your web app already defines for its API base URL.

- **CORS.** The management API allows `https://zipwyn.navindalc.app` by default. If the web app is served from other
  origins (for example an Amplify preview URL), list them in `cors_allowed_origins` and apply. Server-side calls from
  the web app's backend are not subject to CORS.
- **API key (when enabled in section 13).** Send it as the `x-api-key` header **from server-side code only**. Never
  expose it through a browser-visible variable such as `NEXT_PUBLIC_*`.

Redeploy the web app and create a test link from its UI.

## 13. Harden and finish

Do these once everything above works:

1. **Require an API key on the management API.** Generate a key, add it to `terraform.tfvars`, update the web app to
   send `x-api-key`, then apply:

   ```bash
   openssl rand -hex 32
   ```

   ```hcl
   management_api_key = "<generated key>"
   ```

   Order matters: deploy the web app change first (sending a header the API ignores is harmless), then apply Terraform.
   Keep the key in `terraform.tfvars` (not only in a shell variable) so later applies do not remove it. The key is also
   stored in Terraform state and the Lambda configuration, which is why the state bucket is private and encrypted.
2. **Make the custom domains the only way in.** Once both domains work:

   ```hcl
   disable_default_endpoints = true
   ```

3. **Confirm alarms.** Accept the SNS subscription email, and optionally create an
   [AWS Budget](https://console.aws.amazon.com/billing/home#/budgets) alert as a safety net.
4. **Review throttling.** `redirect_throttle` (default 100 requests per second, burst 200) and `management_throttle`
   (10 per second, burst 20) are conservative. Raise them if you expect more traffic.
5. **Delete the `smoke-test` link** created during verification (via the web app or a direct `DeleteItem`).
6. **Commit** `.terraform.lock.hcl`.

## 14. Day-2 operations

**Deploy a code change.** Terraform packages `src/` automatically and updates the functions when its hash changes:

```bash
pnpm test
cd infra/terraform
terraform plan -out=tfplan
terraform apply tfplan
```

**Change configuration.** Edit `terraform.tfvars` and apply.

**Rotate the API key.** Generate a new key, update `terraform.tfvars`, update the web app, apply (both sides briefly
disagree, so do it at a quiet time or update the web app first to send the new key after the apply).

**Roll back code.** `git revert` the change and apply again.

**Restore data.** Point-in-time recovery restores into a new table; it never overwrites in place:

```bash
aws dynamodb restore-table-to-point-in-time \
  --source-table-name zipwyn-urls \
  --target-table-name zipwyn-urls-restored \
  --use-latest-restorable-time
```

Then copy items back with `node scripts/migrate-table.mjs --source zipwyn-urls-restored --target zipwyn-urls --overwrite`.

**Logs and metrics.**

```bash
aws logs tail /aws/lambda/zipwyn-redirect --since 1h
aws logs tail /aws/apigateway/zipwyn-redirect-api --since 1h
```

**Tear everything down.** The table has deletion protection. Disable it, apply, then destroy:

```hcl
dynamodb_deletion_protection = false
```

```bash
terraform apply
terraform destroy
```

Then remove the DNS records at Name.com and, if no longer needed, the state bucket.

## 15. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `terraform apply` sits at `aws_acm_certificate_validation` (phase 2) | The validation CNAMEs are missing or wrong. Check `dig +short CNAME <host>.navindalc.app`; the host must not be doubled (`...navindalc.app.navindalc.app`). The step times out after 45 minutes; fix DNS and re-run |
| `ConflictException: ... domain name already exists` | A custom domain with that name already exists in the region (typically the old manual `short.navindalc.app`). Delete the old one first, see [11.4](#114-keep-old-short-links-working-legacy-domain) |
| `ResourceInUseException` / table already exists | `zipwyn-urls` already exists. Either delete it (if empty) or import it: `terraform import aws_dynamodb_table.urls zipwyn-urls` |
| Browser says certificate error or `curl` fails TLS | Phase 2 not applied yet, or DNS still points elsewhere. Check the CNAME values against `terraform output dns_records` |
| `{"message":"Forbidden"}` from API Gateway | The path does not exist on that API, for example `/urls` on the redirect domain or `/{code}` on the management domain |
| `401 Unauthorized` | `management_api_key` is set and the request lacks a matching `x-api-key` header |
| CORS error in the browser | The web app's origin is not in `cors_allowed_origins`, or a custom header other than `content-type` / `x-api-key` is being sent |
| `Insufficient permissions to enable logging` | The deploying identity lacks CloudWatch Logs delivery or resource-policy permissions. Grant them and re-apply |
| Link works but `clicks` stays 0 | Check `aws logs tail /aws/lambda/zipwyn-redirect` for `Failed to record click`; usually an IAM or table-name mismatch |
| Alarm emails never arrive | The SNS subscription was not confirmed. Click the link in the AWS confirmation email |
| `Error acquiring the state lock` | A previous run was interrupted. Confirm nothing is running, then `terraform force-unlock <LOCK_ID>` |
| `Unsupported Terraform Core version` | Upgrade to Terraform 1.10 or newer |

If something is not covered here, the Terraform and AWS error messages are usually precise; search them together with
the resource name shown in the error.
