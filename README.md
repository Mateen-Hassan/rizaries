# Rizaries AI Room Matcher — Groq + Netlify

This version adds a camera upload option, moves the AI backend from Vercel/Gemini to Netlify/Groq, and reduces unnecessary image/API work.

## What changed

- **Camera option:** mobile users can tap **Take a photo** using the device camera (`capture="environment"`). A separate **Choose photo** option is available for gallery/files.
- **Client-side image optimization:** the selected image is resized to a maximum 1280px side and converted to JPEG before processing. The same optimized image is used for palette extraction and AI, reducing upload size and latency.
- **Groq Vision:** uses `qwen/qwen3.6-27b` with JSON mode and `reasoning_effort=none` for fast structured room analysis.
- **Parallel processing:** local color extraction and the Groq request start without waiting for the UI animation to finish.
- **AI stays server-side:** `GROQ_API_KEY` is only available to the Netlify Function.
- **Fallback:** if Groq is unavailable, the existing local color matcher still produces results.
- **Netlify Function:** `netlify/functions/analyze-room.mjs` is exposed through `/api/analyze-room` using `netlify.toml`.
- **Efficient product loading:** product requests are kept limited to the best match and three runners.

## Netlify deployment

### Option A — GitHub (recommended)

1. Push this folder to GitHub.
2. In Netlify, choose **Add new project → Import an existing project** and select the repository.
3. No build command is required for this plain HTML + Function project.
4. Deploy.
5. In **Project configuration → Environment variables**, add:
   - `GROQ_API_KEY` = your Groq API key
   - `GROQ_MODEL` = `qwen/qwen3.6-27b`
   - `ALLOWED_ORIGIN` = `*` for initial testing
6. Redeploy after adding/changing environment variables.

### Option B — Netlify Drop

For the static UI, Netlify supports drag-and-drop deployment. However, this project also contains a serverless Function, so for the complete AI version use a Git-connected deploy or the Netlify CLI so the `netlify/functions` directory is deployed as a Function.

## Shopify production setup

Once the test site works, set:

`ALLOWED_ORIGIN=https://rizaries.com`

If the page is loaded from `https://www.rizaries.com`, use that exact origin instead. If multiple storefront origins need access, separate them with commas.

Keep the API key in Netlify environment variables. Never paste it into Shopify Liquid, `index.html`, or browser JavaScript.

## Groq limits / image handling

The browser intentionally compresses images before sending them. Groq's vision API supports base64 image data URLs and the Qwen 3.6 27B model supports image input and JSON mode. The frontend keeps the AI image comfortably below the base64 request limit.

## Local testing

You need Node.js and the Netlify CLI for local Function testing. From this folder:

```bash
npm install -g netlify-cli
netlify dev
```

Then open the local URL shown by Netlify.
