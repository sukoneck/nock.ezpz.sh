# Hello world
curl -sS "https://api.nock.ezpz.sh/pub/gm"

# List public files
curl -sS "https://api.nock.ezpz.sh/ls?prefix=pub/" | jq .

# Download a public file
curl -o latest.jam "https://api.nock.ezpz.sh/pub/file.txt"

# Download a private file (requires authentication)
curl -o file.txt "https://api.nock.ezpz.sh/priv/dir/file.txt"

# Upload a private file (requires authentication)
curl -sST file.txt "https://api.nock.ezpz.sh/priv/writable/file.txt"

# Check permissions
curl -sS "https://api.nock.ezpz.sh/auth/verify" | jq .

# Endpoints that require authentication may use either:
  -H "Authorization: Bearer YOUR_TOKEN"
# or
  ?key=YOUR_TOKEN
