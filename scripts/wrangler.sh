pushd api
npx wrangler deploy
popd

pushd ui
npx wrangler deploy
popd

npx wrangler tail --format pretty nock-ezpz-api
