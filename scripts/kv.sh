# Create KV for auth tokens (token→roles)
npx wrangler kv namespace create AUTH

# Create user tokens
source .env
npx wrangler kv key put --binding=AUTH --remote=true "${TOKEN_SUKONECK_RW}" "SUKONECK_RW"
