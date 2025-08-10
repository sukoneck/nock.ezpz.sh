# Create the R2 bucket
npx wrangler r2 bucket create files

# Upload the example policy
npx wrangler r2 object put files/config/policy.json --file ../api/policy.json --remote

# Bootstrap folders (optional)
npx wrangler r2 object put files/pub/.keep --file /dev/null --remote
npx wrangler r2 object put files/priv/eccojxm/.keep --file /dev/null --remote
npx wrangler r2 object put files/priv/hamburger/.keep --file /dev/null --remote
npx wrangler r2 object put files/priv/sukoneck/.keep --file /dev/null --remote

npx wrangler r2 object put files/pub/gm.log --file gm.log --remote
npx wrangler r2 object put files/priv/eccojxm/gm.log --file gm.log --remote
npx wrangler r2 object put files/priv/hamburger/gm.log --file gm.log --remote
npx wrangler r2 object put files/priv/sukoneck/gm.log --file gm.log --remote
