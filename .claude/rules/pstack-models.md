# pstack model configuration for cart-campuss. One line per role. Delete a line to fall back to the global rule.
# `inherit-parent` as a value: the role runs on the parent chat model (omit Task `model`). Alias entries in a panel list still count toward its fan-out.
# budget: medium (high)
feature, refactoring: haiku high
bug-fix: haiku high
perf-issue: haiku high
hillclimb: haiku high
judgment and prose: haiku high
hardest tasks: haiku high
how explorer: haiku high
how explainer: haiku high
why investigators: haiku high
why synthesizer: haiku high
reflect tooling: haiku high
reflect judgment, divergent, synthesizer: haiku high
arena runners: haiku high
arena cross-judge pool: inherit-parent
swarm workers: haiku high
architect runners: haiku high
interrogate reviewers: haiku high
