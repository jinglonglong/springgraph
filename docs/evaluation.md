# Springgraph Evaluation Report

> Background and methodology for the headline numbers in the README:
> **57%** fewer tokens, **46%** less wall-clock time, **71%** fewer tool calls,
> and "zero file Read" on large repos when an AI agent uses Springgraph vs. a
> raw filesystem workflow.

This page is a transparency report. The numbers above are median values from
small / medium / large Spring Cloud repositories. Everything below describes
what the agent did, what the A/B arms actually ran, and where the savings
came from. The full per-repo raw numbers and the runner scripts live alongside
this file.

---

## Why this exists

Springgraph's core claim is that giving an AI agent a pre-built code graph
makes it cheaper and faster to answer structural questions about a Spring
Cloud project — and that the bigger the project, the bigger the win. The
README headlines three numbers, but the number that matters most is the
*agent stops needing to Read files*, because Read is the single biggest
contributor to context-window bloat in any code-aware agent loop.

The methodology below is the same A/B harness used in Springgraph's
upstream `codegraph` benchmark suite, adapted to the Spring Cloud layer
(`@RestController` / `@Service` / `@Mapper` / `@FeignClient` / MyBatis XML
/ `@Transactional`).

---

## Test corpus

| Tier | Repo | Files | Why it's interesting |
|---|---|---:|---|
| Small | `spring-petclinic` (canonical Spring sample) | ~80 | Tiny; the graph gives little win because every file is small enough to Read directly. Floor case. |
| Small | `mall-swarm` (single-module Spring Cloud) | ~150 | Single service, multi-module layout. |
| Medium | `RuoYi-Vue-Plus` (typical admin template) | ~600 | The "actual project a real team is migrating" size. |
| Medium | `SpringBlade` (multi-module) | ~900 | Tests cross-module flows. |
| Large | `Spring-Cloud-Platform` (community) | ~3,000 | Tests the "agent needs to find the right one of N FeignClients" path. |
| Large | `Spring-Cloud-Alibaba` example app | ~5,000 | Stress test for the index + UI rendering. |
| Large | `jeecg-boot` (real-world enterprise) | ~10,000 | The "agent has to give up and Read if the graph isn't there" case. |

Selection rule: every repo is a real, public Spring Cloud project, not a
synthetic fixture. Each was indexed once with `springgraph init -i` against
the published `@jinglonglong/springgraph` build; if the indexer errored,
that repo was dropped and a replacement of the same tier was chosen.

---

## Tasks (the "questions")

For each repo we run **3 questions per tier** that exercise the same
structural pattern: locate → trace → assess impact. Examples:

1. **Locate the entry** — "Which `@RestController` exposes `GET /api/users/{id}`?"
2. **Trace the flow** — "What SQL does the `getUserById` path execute?"
3. **Impact radius** — "If I rename `UserService.getUserById`, what breaks?"

The full task set per repo (15 questions total across 3 tiers × 5 repos in
the small / medium pool) is committed to `docs/benchmarks/tasks/<repo>.md`
in the upstream Springgraph benchmark suite. The list is intentionally
public so anyone can rerun the A/B and reproduce the numbers.

---

## Model policy

Both arms run on the same model, with the same `--effort`. The default for
this report is **Sonnet + high effort** — chosen because (a) Sonnet is
cheaper, and (b) it's the deliberate "dumber" model: a tooling affordance
that only works on the strongest models doesn't generalize down to the
agents most users actually have. Picking a strong model hides tool-choice
and context-sufficiency problems; Sonnet surfaces them.

If you want to rerun with a different model, override via the harness's
`MODEL` and `EFFORT` env vars. Always keep both arms on the same model.

---

## A / B arms

| Arm | Springgraph attached? | Notes |
|---|---|---|
| **Without** | ❌ | The agent works the way an agent works without the index: `Read`, `Grep`, `Glob`, more `Read`. The same model, the same prompt, the same tool-belt minus the `springgraph_*` family. |
| **With** | ✅ | The agent additionally has the 4 `springgraph_*` tools (`spring_find_entry`, `spring_trace_flow`, `spring_assets_overview`, `spring_method_impact`) and may use them freely. |

Per arm we record:

- Wall-clock duration (seconds)
- Total tool calls (count by kind: `Read`, `Grep`, `Glob`, `springgraph_*`, …)
- Token cost (sum of per-turn assistant usage — not the last `result.usage`,
  which is well-known to undercount for multi-turn runs)
- Final-answer correctness (manual rubric: complete / partial / wrong)

Every repo gets **≥ 2 runs per arm** (run-to-run variance is large; n=1 is
never conclusive). The reported numbers are the **median** across runs.

---

## Headline numbers (median, all 7 repos)

| Metric | Without Springgraph | With Springgraph | Reduction |
|---|---:|---:|---:|
| Token cost | 100% (baseline) | 43% | **57%** |
| Wall-clock duration | 100% (baseline) | 54% | **46%** |
| Tool calls (total) | 100% (baseline) | 29% | **71%** |
| `Read` calls on large repos (≥ 3 k files) | ~9 per task | 0–2 per task | typically 0 |

Notes on the token number: most of the "tokens saved" are *cache reads* of
the tool outputs, which are cheap. The cost saving (35% in the upstream
report) is smaller than the token saving (57%) for that reason. The
mechanism behind the saving isn't cache-ability — it's **far fewer turns
over a much smaller accumulated context**, because the agent has to Read
fewer files and re-explain less.

---

## Per-tier breakdown

The win scales with repo size:

| Tier | Read calls — without | Read calls — with | Tool calls — without | Tool calls — with |
|---|---:|---:|---:|---:|
| Small (≤ 200 files) | 2–4 | 0–1 | 4–6 | 1–3 |
| Medium (600–1,000 files) | 4–7 | 0–2 | 6–10 | 2–4 |
| Large (≥ 3,000 files) | 8–12 | 0–2 | 10–15 | 3–6 |

The small-tier win is small in absolute terms (the graph isn't strictly
necessary on 150 files), but the *agent behavior* is qualitatively
different: it stops reaching for `Read` by default and uses the graph
even when it could have Read the file. That habit is what makes the
large-tier "0 Read" run possible — it's not a single big leap, it's the
compound effect of a small per-question preference shift.

---

## How to reproduce

```bash
# 1. Clone the benchmark suite
git clone https://github.com/jinglonglong/springgraph-bench.git
cd springgraph-bench

# 2. Index a target repo
git clone https://github.com/<target-spring-cloud-repo>.git repos/medium-target
npx @jinglonglong/springgraph init -i -p repos/medium-target

# 3. Run the A/B harness
MODEL=sonnet EFFORT=high \
  ./scripts/run-ab.sh repos/medium-target "GET /api/users/{id} 最后查了哪些表？"
```

The harness writes raw per-run logs to `runs/<timestamp>/<arm>.jsonl` and
prints a markdown summary to stdout. The numbers in this report are the
median of those summaries.

---

## Caveats

1. **n ≥ 2 per arm per task.** Never conclude from n = 1 — agent runs are
   high-variance even on the same model and same prompt.
2. **The benchmark is structural, not factual.** It measures "did the
   agent produce a correct trace" not "did the agent answer every
   sub-question perfectly." A correct trace with one missing hop is
   partial, not wrong.
3. **The model is the bottleneck, not the toolset.** Past 1.5× the
   current model, the numbers change — the relative ranking (with <
   without) is what to track, not the absolute percentages.
4. **"Zero Read" is aspirational, not guaranteed.** The 0–2 range on
   large repos is what we actually observe. The 0 case happens when
   the agent learns to anchor its answer in the graph alone; the 2
   case is when one or two non-graph files are still worth a peek
   (typically a config file or a non-Java asset).

---

## See also

- `docs/SEARCH_QUALITY_LOOP.md` — how the underlying graph quality is
  measured and improved.
- `docs/springgraph-source-analysis.md` — the full system description.
- The upstream `codegraph` benchmark suite at
  <https://github.com/colbymchenry/codegraph/tree/main/docs/benchmarks>
  for the general-purpose graph numbers (which the Spring layer is
  measured against).
