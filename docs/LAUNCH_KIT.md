# Launch kit

Copy for the v1.0 launch. The angle everywhere: *I built this to see what Power BI was actually doing under filter context, and I want to know where it's wrong.* Ask for criticism, not stars. Edit the wording so it sounds like you; don't post all of it on the same day.

Links used below:

- Repo: https://github.com/RaulMermans/bi-notebook-lab
- Divergence report: https://github.com/RaulMermans/bi-notebook-lab/issues/new?template=dax-divergence.yml
- Live demo: add once GitHub Pages is enabled and verified (see the PR notes). Until then, the run command is the demo.

## A. LinkedIn

> I spent the last few months building a DAX engine in the browser, mostly because I wanted to see what Power BI is actually doing when a slicer changes a number.
>
> BI Notebook Lab is open source now. You load a sample dataset, shape it with Power Query steps, build a star schema, write measures, and then open a "Context Explorer" that walks the filter through each relationship down to the rows that were evaluated.
>
> What's under it: one lexer → parser → binder → evaluator shared by calculated columns, measures, visuals and the exercise grader. Exercises are graded by running your model under several filter contexts, so a hard-coded number can't pass.
>
> What it isn't: Power BI. It's a deliberately bounded subset. There are 83 hand-verified DAX conformance cases; 82 pass, and the one that doesn't (`BLANK() + 5`) is documented as a known divergence rather than hidden.
>
> What I'd really like: if you know DAX well, try to break it. Every case where it disagrees with real Power BI becomes a test.
>
> [repo link] · 30-second video below

## B. Show HN

**Title:** Show HN: BI Notebook Lab – a browser DAX engine for learning filter context

**Text:**

> I built a browser-based lab for learning how Power BI's DAX evaluates, because I kept getting surprised by filter context and couldn't see inside Power BI to understand why.
>
> It's TypeScript with no backend: a typed Power Query step model (no M interpreter), a semantic model with 1:\*, 1:1, \*:\* and bidirectional relationships, and one expression engine shared by calculated columns, measures, visuals and the grader. A Context Explorer traces a filter through relationships to the evaluated rows.
>
> It's a bounded subset, not a reimplementation. Correctness is checked by 83 hand-verified conformance cases run through the public runtime APIs; 82 pass, and the remaining one (blank coercion in `+`) is an explicit, documented divergence. None are verified against Power BI itself yet, which is the main thing I'm asking for help with.
>
> Things I'd find most useful: expressions where it gives a different answer from Power BI, and opinions on the CALCULATE/filter-propagation design (docs/FILTER_CONTEXT.md, docs/CALCULATE.md).
>
> [repo link]

## C. Reddit (r/PowerBI, r/BusinessIntelligence)

Check each subreddit's self-promotion rules first; on r/PowerBI, post as a discussion/learning resource, not an ad.

**Title:** I built an open-source browser lab that shows how a DAX measure is evaluated under filter context. Looking for cases where it gets DAX wrong

**Body:**

> When I was learning Power BI, the part that took longest to click was filter context: why `CALCULATE` replaces a filter instead of intersecting it, how a filter travels across a bidirectional relationship, why `USERELATIONSHIP` changes a total.
>
> So I built a small DAX engine in the browser that shows its work. You build a star schema, write a measure, add a slicer, and a Context Explorer walks the filter through each relationship to the rows that were actually summed. There are guided exercises that grade your model by running it, plus four free practice projects. Runs locally, nothing uploaded.
>
> It's a deliberately limited subset (CALCULATE, iterators, classic time intelligence, VAR/RETURN, the main relationship types; no calculated tables yet). I've written 83 conformance cases by hand. One known divergence: `BLANK() + 5` returns BLANK here and 5 in Power BI.
>
> If you have a measure you think it will get wrong, I'd love to hear it. There's an issue template for exactly that.
>
> [repo link]

## D. X / short post

> I built a DAX engine in the browser so I could watch filter context happen.
>
> Slicer → relationships → rows → measure, traced step by step. 82/83 hand-verified conformance cases. The one that fails is documented.
>
> Open source. Try to break it: [repo link]

## E. Direct expert outreach

Short, specific, no favour bigger than ten minutes.

> Hi [name], I've learned a lot from your writing on [specific article/topic, e.g. CALCULATE filter arguments].
>
> I built an open-source, browser-based DAX engine for teaching filter context: [repo link]. It's a bounded subset, with hand-verified conformance cases and documented divergences.
>
> If you had ten minutes, I'd value one thing: a DAX expression you'd expect a simplified engine like this to get wrong. I'll add it as a test and credit you in the case notes if you'd like.
>
> No worries at all if not. Thanks either way.

## F. Follow-up technical posts

1. **Implementing CALCULATE: replacement, not intersection.** How filter arguments replace same-column filters, how `KEEPFILTERS` changes that, and the conformance cases that prove it (`docs/CALCULATE.md`).
2. **The `BLANK() + 5` problem.** Why uniform blank propagation is simpler, how DAX's per-operator coercion table differs, and why the divergence is tracked as a skipped test instead of fixed quietly.
3. **Grading by execution instead of string matching.** Why `[Total Revenue] = 4200` must not pass, how checkpoints evaluate under several filter contexts, and the staleness fingerprint.

Also worth writing later: filter propagation across bidirectional and \*:\* relationships, and fail-closed handling of ambiguous relationship paths.

## G. Audiences

- **Power BI community:** r/PowerBI, the Microsoft Fabric Community forums (Power BI section), LinkedIn Power BI hashtags.
- **DAX educators and authors** (outreach in E): people who publish DAX reference material and courses, for example the SQLBI authors and the Power BI YouTube educators you already follow. Pick three to five, personalise each message.
- **Engineers interested in language implementation:** Hacker News (Show HN), r/ProgrammingLanguages if framed around the binder/evaluator design.
- **Data teams and learners:** r/BusinessIntelligence, r/dataengineering (only if the post is about the engine, not promotion).

## H. Validation metrics

Track weekly for the first month. Stars are the least informative of these.

| Metric | Where | Why it matters |
| --- | --- | --- |
| Divergence reports opened | Issues, `semantic-divergence` label | Direct evidence of expert scrutiny |
| Conformance cases contributed / `power-bi-verified` cases | `npm run conformance` report | Turns feedback into correctness |
| External PRs opened and merged | Pull requests | Contribution path works |
| `good first issue` pickup time | Issues | Issue quality |
| Unique cloners and visitors | Insights → Traffic | Reach |
| Stars and forks | Repo header | Social proof (lagging) |
| Substantive comments on HN / Reddit / LinkedIn | Threads | Quality of attention, not volume |

A good first month: a handful of real divergence reports, at least one `power-bi-verified` case, and one external PR merged.
