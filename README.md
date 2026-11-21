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

1. Sign in with your name and PIN (same people and PINs as the Parts Receiving app).
2. Pick a warehouse and tap **Load from ManagerPlus**. The app pulls that warehouse's parts, bins and on-hand live through n8n. Uploading a ManagerPlus .xlsx export still works as a fallback.
3. Pick a rack and count. Yellow cards need one tap; red cards are parts that aren't on that rack, and the app shows where the system thinks they are.
4. Every line saves to the server a few seconds after you count it, with the time it was counted. With no signal, lines wait on the phone and upload when signal returns (the badge in the header shows how many are waiting).
5. **Finish this count** sends every line, with anything not counted saved as 0 "not found", and marks the count finished.
6. Managers see the variance view; counters never see system quantities. Saving the Excel/CSV files still works.

## Back end

| Piece | Where |
|---|---|
| n8n workflow **Inventory Count API** | webhook `POST /webhook/inventory-count`, actions `names`, `login`, `load`, `save`, `sessions`, `session` |
| Data table `count_sessions` | one row per count: warehouse, rack/area, counter, started/finished time |
| Data table `count_lines` | one row per counted line: part, qty counted, **system on-hand at count time**, system bin vs bin found, counted-at timestamp, notes |
| `n8n/` | source of the workflow's Code nodes |
| `tools/import_counts.py` | loads old count spreadsheets as dated sessions |

People, PINs and the warehouse list live in the workflow's **Gatekeeper** node (edit the block at the top). Put `| manager` after a PIN to let that person see variances.

## Reconcile (managers)

**Open reconcile board** on the start screen (managers only). **Run reconcile now** makes n8n:

1. take the newest count of every rack/area in every warehouse,
2. pull current ManagerPlus stock for all warehouses, the work-order parts used on counted parts, the work orders since the first count (for dates), and recent POs,
3. sort every difference into one action:

| Action | Meaning |
|---|---|
| Adjust quantity | Counted vs system at count time, minus parts used and plus parts received since that count date. Shows what ManagerPlus should be now. |
| Transfers | Extra in one warehouse, short in another: record a transfer instead of two adjustments. |
| Wrong shelf | Found on a different bin than ManagerPlus says (including old "found on shelf H" notes). |
| Look elsewhere first | Short here, but ManagerPlus shows stock in a warehouse/bin nobody has counted yet. |
| Assign a bin | Found on a shelf, no bin in ManagerPlus. |
| Part # mix-ups | Counted number is a near-miss of a real part number (0/O, 5/S…). |
| Not in ManagerPlus | On the shelf, no similar part number at all. |
| Explained by work orders | The shortage was a part pulled before the count whose work order was entered after; nothing to adjust. |

Approve / Done in ManagerPlus / Dismiss are saved in the `recon_actions` table and kept across re-runs. **Save action list** exports open and approved actions to Excel. Nothing is written to ManagerPlus. The engine's source is `n8n/recon_core.js`.

## Locations without bins

Service warehouses and vans often have no bin, and ManagerPlus leaves `Bin Location` blank. That's fine:

- The export doesn't need a `Bin Location` column at all.
- Parts with no bin are grouped under the warehouse name. That comes from a `Warehouse` column if the export has one, otherwise from the file name (e.g. `Service Van 15.xlsx`).
- With no bins there are no shelf chips. Just say part and count.
- Sizes and ratings are specs, not quantities: "Habonim 2 inch kit one" logs 1, and "2 and a half inch" or "100 psi" never become counts.

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
