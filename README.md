# Boutique Photo Processor

A single Vercel serverless function that takes a clothing/footwear photo from an
iOS Shortcut, runs it through Gemini 2.5 Flash Image with a catalog-style prompt,
and returns a clean white-background product photo.

## Endpoint

`POST /api/process-photo`

Headers:
- `Content-Type: application/json`
- `x-app-secret: <your shared secret>`

Body:
```json
{
  "image": "<base64-encoded JPEG>",
  "itemType": "top" | "jeans" | "shoes"
}
```

Response:
```json
{ "image": "<base64-encoded processed JPEG>" }
```

## Environment variables (set in Vercel project settings)

- `GEMINI_API_KEY` — from aistudio.google.com → Get API key
- `APP_SECRET` — any long random string you invent; the iOS Shortcut sends the
  same value in the `x-app-secret` header

## Deploy

```bash
# from this folder
git init
git add .
git commit -m "Initial boutique photo processor"
# create a GitHub repo and push, then import into Vercel,
# OR deploy directly:
npx vercel --prod
```

After deploy, set the two environment variables in the Vercel dashboard
(Settings → Environment Variables), then redeploy so they take effect.

## Item types

- `top` — converts any top to an overhead flat lay
- `jeans` — converts any bottoms to an overhead flat lay
- `shoes` — converts footwear to a clean side-profile shot (not a flat lay)
