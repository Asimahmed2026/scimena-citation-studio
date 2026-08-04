# SciMENA Citation Studio — AI Citation MVP v2

A standalone, Netlify-ready citation and reference manager prototype for the SciMENA / 10 Scholars research-writing application.

## Core citation features

- Search by DOI, PMID, article title, author, or keywords
- Crossref and PubMed integration
- Netlify Functions proxy fallback
- Local project reference library
- Automatic duplicate detection
- Insert one or multiple citations at the cursor
- Automatic Vancouver renumbering by first appearance
- Vancouver citation-range compression, for example `[3–6]`
- APA 7 in-text and bibliography preview
- Live formatted manuscript preview
- Automatic references section
- Citation audit
- Manual reference entry
- Local autosave using browser storage
- Export formatted manuscript as HTML

## AI Polish & Cite

The **AI Polish & Cite** button works on selected text or, when nothing is selected, the paragraph containing the cursor.

The workflow is:

1. OpenAI improves the wording or preserves it, depending on the selected mode.
2. OpenAI separates a long sentence or paragraph into independently citable claims.
3. OpenAI creates an English scholarly search query for each claim.
4. The Netlify Function searches real PubMed and Crossref records.
5. Candidate references are screened for relevance using their title and available abstract metadata.
6. The user reviews and selects the sources.
7. The app adds the selected sources to the project library and inserts citation tokens at the relevant claim markers.
8. Vancouver numbering and the reference list update automatically.

The system never asks OpenAI to invent a reference. Suggested references are generated only from records retrieved from PubMed or Crossref. Users must still review the abstract or full article before citing it.

## Required OpenAI setup

The OpenAI API key must be stored in Netlify, not in `app.js`, GitHub, or the browser.

1. Open the project in Netlify.
2. Go to **Site configuration → Environment variables**.
3. Add:

```text
Key: OPENAI_API_KEY
Value: your OpenAI API key
```

4. Optional model setting:

```text
Key: OPENAI_MODEL
Value: gpt-5.6-luna
```

5. Redeploy the site.

`gpt-5.6-luna` is the default model because this workflow is structured, high-volume, and cost-sensitive. The model can be changed using `OPENAI_MODEL` without changing the code.

## Deploy to Netlify

1. Upload all files to the GitHub repository root.
2. In Netlify, choose **Add new site → Import an existing project**.
3. Select the GitHub repository.
4. Netlify reads `netlify.toml` automatically.
5. No build command is required.
6. Publish directory: `.`
7. Functions directory: `netlify/functions`
8. Add the environment variable described above.
9. Deploy or trigger a new deployment.

## Updating an existing GitHub deployment

Upload and replace these files:

- `index.html`
- `styles.css`
- `app.js`
- `README.md`
- `netlify/functions/ai-citations.mjs`

Keep the existing Crossref and PubMed function files. After committing the files, Netlify should redeploy automatically.

## Local testing

For the static interface:

```bash
python -m http.server 8080
```

For Netlify Functions:

```bash
netlify dev
```

Create a local `.env` file for development only:

```text
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-5.6-luna
```

Do not commit `.env` to GitHub.

## Current limitations

- AI recommendations are candidate-screening suggestions, not confirmation that an article supports every word of a claim.
- Vancouver and APA formatting are implemented in-app rather than through a full CSL engine.
- Projects are stored in the current browser only.
- Export is HTML; DOCX integration remains a later stage.
- Citation tokens remain visible inside the plain-text editor and are rendered as formatted citations in Preview and Export.
