# SciMENA Citation Studio — AI v3

A standalone, Netlify-ready citation manager prototype for the SciMENA / 10 Scholars research-writing application.

## Included in this MVP

- Search by DOI, PMID, article title, author, or keywords
- Crossref and PubMed integration
- Netlify Functions proxy fallback
- Local project reference library
- Automatic duplicate detection
- Insert one or multiple citation tokens at the cursor
- Automatic Vancouver renumbering by first appearance
- Vancouver citation-range compression, e.g. `[3–6]`
- APA 7 in-text and bibliography preview
- Live formatted manuscript preview
- Automatic references section
- Citation audit
- Manual reference entry
- Local autosave using browser storage
- Export formatted manuscript as HTML
- Responsive user interface
- Five-stage AI progress bar with estimated percentage
- Stronger publication-ready academic rewrite mode
- Demo references for offline interface testing

## Deploy to Netlify

### Recommended: Git deployment

1. Upload this folder to a GitHub repository.
2. In Netlify, choose **Add new site → Import an existing project**.
3. Select the repository.
4. Netlify will detect `netlify.toml` automatically.
5. No build command is required.
6. Publish directory: `.`
7. Deploy.

The Git deployment method activates the included Crossref and PubMed proxy functions.

### Static drag-and-drop test

You may drag the folder into Netlify Drop. The interface will work and will first attempt direct calls to Crossref and PubMed. Netlify Functions are not included in a simple static drop, so Git deployment is recommended for reliable API access.

## Local preview

Because this is a static app, run any local static server, for example:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

To test Netlify Functions locally, use Netlify CLI:

```bash
netlify dev
```

## Important MVP limitations

- Formatting is currently optimized for journal articles.
- Vancouver and APA are implemented in-app rather than through a full CSL engine.
- Projects are stored in the current browser only; Supabase sync is a later integration step.
- Export is HTML. DOCX export should be added during integration with the main research app.
- Full reference editing, RIS/BibTeX import, and collaborative projects are planned for the next stage.

## Recommended integration stage

After user testing, integrate the module into the existing app with:

- Supabase `project_references` and `citation_instances` tables
- User authentication and multi-device sync
- Full CSL/citeproc engine
- DOCX export with real Word citation fields or stable rendered citations
- Zotero/RIS/BibTeX/NBIB import
- Reference metadata verification workflow
