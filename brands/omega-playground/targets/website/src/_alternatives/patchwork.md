---
# ═══ OMEGA Playground alternatives fixture (#609). The playground has no real
# competitors, so the four entries name the four things a team actually does
# INSTEAD of one stack — wire tools together, buy an all-in-one, generate a
# starter, or hand-roll it. Framework-facing purpose: give /alternatives a hub
# with real rows and descriptions, and each comparison page a real table.
layout: blueprint/alternatives/alternative
alternative:
  competitor:
    name: "Patchwork"
    description: "Four good tools, four repos, and a CI file holding hands with all of them."
  comparison:
    features:
      - name: "Website, backend, desktop app, extension"
        ours:
          value: "One repo"
        theirs:
          value: "Four repos"
      - name: "One config file for the whole brand"
        ours:
          value: true
        theirs:
          value: false
      - name: "Same sign-in on every surface"
        ours:
          value: true
        theirs:
          value: "Wire it yourself"
      - name: "Deploy every surface with one verb"
        ours:
          value: true
        theirs:
          value: false
      - name: "Upgrades arrive everywhere at once"
        ours:
          value: true
        theirs:
          value: "Four upgrade days"
---

Patchwork isn't a product — it's what most brands end up with. Nothing here is
real, including the comparison, but the shape of the problem is: four surfaces
that each know your brand name, your auth, and your prices, and four places to
change them when one of those moves.
