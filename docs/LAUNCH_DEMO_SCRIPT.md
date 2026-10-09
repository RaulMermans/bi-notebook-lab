# Launch demo script

A 30-second screen recording for the README, LinkedIn, X and Show HN. This environment produced no video, so this is the exact shot list to record by hand. Static screenshots for the README already exist in [`docs/screenshots/`](./screenshots/).

- **Target length:** 28–32 s, no audio required (captions carry it).
- **Aspect ratio:** record at 1440×900; export 16:9 (1920×1080) for GitHub, X and Show HN, plus a 4:5 crop (1080×1350) centred on the notebook column for LinkedIn.
- **Data:** built-in synthetic sample data only. Start from a fresh browser profile so nothing personal is in IndexedDB.
- **Setup:** `npm run dev`, browser zoom 110%, hide bookmarks bar, cursor highlighting on.
- **Export:** MP4 (H.264) under 8 MB, plus a looping WebM/GIF under 5 MB of shots 4–6 only, if a README preview is wanted later.

## Shot list

| # | Time | Click sequence | On-screen caption |
| --- | --- | --- | --- |
| 1 | 0–3 s | Land on **Free Lab**. Hover the four practice-project cards. | **How does DAX actually evaluate?** |
| 2 | 3–7 s | Click **+ Add Data → Load Power Query Lab Dataset**. On `Customers_Dirty` click **Transform Data**, apply **Remove Duplicates** by `CustomerID`, click the previous Applied Step to show the "before" table. | Power Query as typed, inspectable steps |
| 3 | 7–11 s | Go back to Free Lab and open **Filter Context Lab**. Scroll to the **Retail Model** cell and pause on the star schema canvas. | A real semantic model, validated against the rows |
| 4 | 11–16 s | Click **+ New measure**, name it `Spain Revenue`, enter `CALCULATE([Total Revenue], Customers[Country] = "Spain")`, run it. | Write a measure. Same engine as everything else |
| 5 | 16–21 s | **+ Add Visual → Slicer** on `Customers[Country]`, pick **France**. Show `Total Revenue` change and `Spain Revenue` stay fixed. | `CALCULATE` replaces the filter, it doesn't intersect it |
| 6 | 21–27 s | Expand the **Retail Model** cell → **Context Explorer** tab → pick `Total Revenue`, add `Customers[Country] = France`. Let the propagation diagram and the row count animate. | Follow the filter through the relationships to the rows |
| 7 | 27–31 s | Cut to the repo page or a title card. | **Open source. Find a case where it disagrees with Power BI.** github.com/RaulMermans/bi-notebook-lab |

## Notes

- Keep shot 6 longest; it is the thing nobody else shows.
- If shot 2 runs long, drop the "previous Applied Step" click before dropping anything else.
- Don't caption any claim that isn't in the README (no "Power BI-compatible", no speed claims).
- Final CTA in the post text, not just the video: ask for divergence reports and link the issue template.
