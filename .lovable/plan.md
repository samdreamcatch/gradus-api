# Why the link preview still shows the old copy

The share-title change is written in your project code, but the preview card in Messages is built from the **published** site at gradus.training. Two things stand between the edit and what you see:

1. The change has not been published yet, so gradus.training still serves the old title.
2. Once published, Apple/Messages caches the preview it already fetched for that exact URL. Re-sending the same link often replays the cached card.

Waiting alone will not fix it.

## What to do

1. Publish the app.
2. Test with a **new** share link (a different plan, or a plan whose share link hasn't been sent before) — a fresh URL has no cached preview.
3. If you need the old URL to refresh, delete the message thread's cached card by sending the link from a different device/conversation, or wait for Apple's cache to expire (can be days).

## Verification

After publishing, I can fetch the published page for a share token and read back its `og:title` to confirm the server is emitting "<Plan title> — join me on Gradus". No code change is required unless that check comes back wrong.

## Note on wording

Current copy renders as: `Juvenile — Free Skate — join me on Gradus`. If you'd prefer a cleaner separator (for example `Juvenile — Free Skate | Join me on Gradus`), say so and I'll adjust before you publish.
