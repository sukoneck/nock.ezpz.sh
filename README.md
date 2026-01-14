# 😌

## Summary

Generically this is a permissioned file storage system that uses Cloudflare R2
as a dynamic backend. This specific iteration serves chain snapshots for Nockchain.

## Admin notes

- Deployments to Cloudflare Wrangler triggered on push to `main`.
- New users: update `api/policy.json` and `scripts/kv.sh`. Apply with `scripts/r2.sh`.
