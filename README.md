# Shelf Count

Blind, voice-assisted inventory counting for NG Advantage warehouses, one rack at a time.

A counter opens the page on a phone, picks a rack (for example `CI2`), announces the shelf ("shelf A"), and says part plus count ("EC350 one", "Lochinvar touch screen 1"). The app fuzzy-matches partial part numbers and descriptions against the ManagerPlus warehouse list. Counters never see system quantities. A manager PIN unlocks the variance view and export.

## Files

| File | What it is |
|---|---|
| `index.html` | Page markup and styles |
| `matcher.js` | Fuzzy part matcher: partial part numbers, descriptions, sound-alike characters, spoken numbers, shelf commands |
| `app.js` | App logic: warehouse upload, rack picker, counting, review, Excel/CSV export |

It's a static site with no build step. Vercel serves it as-is (Framework preset: Other).

## Using it

1. Export the whole warehouse from ManagerPlus as .xlsx. It needs `Part ID`, `Description`, `Bin Location`, `On Hand` and `Current Cost` columns.
2. Open the app, upload the export, and pick a rack. The list stays on that phone only and is never sent anywhere.
3. Count. Yellow cards need one tap; red cards are parts that aren't on that rack.
4. Finish:
   - **Save count file** is the blind export (counts only).
   - **Manager view** (PIN) shows variance and saves the CI5-format workbook with live formulas.

## Voice

- iPhone: tap the box, then the keyboard mic.
- Android Chrome and desktop Chrome: the round mic button streams speech and adds confident lines automatically.
- Say "next" between parts, or tap Add.

## Notes

- No inventory data is stored in this repo. Keep it that way, because a Vercel link is public.
- The manager PIN is light protection. System numbers live in the phone's browser storage after upload.
- Excel export uses SheetJS 0.18.5 from cdnjs.

## Roadmap

- n8n webhook that pulls a rack's list live from ManagerPlus (no upload).
- Submit counts to n8n, which appends them to a Google Sheet.
