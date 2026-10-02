---
name: init
description: Use when someone wants to start a new OMEGA brand, asks what state a folder is in, or runs in a folder that may already hold a brand, a template copy or a half-finished setup.
user-invocable: true
---

# OMEGA init: start a brand, or report the one you are in

This skill holds no facts of its own. It reads the folder through `omega status --json`, and the docs own everything else: the onboarding flags are `docs/manager/index.md` § Onboarding (and the manager README it points at), the brand-root verbs are `docs/manager/brand.md`, the logs are `docs/shared/logging.md`. In a brand those docs sit under `node_modules/@omega.js/manager/docs/`.

It is safe to run again anywhere. It creates only in an empty folder or a new subfolder, and only after one yes.

## 1. Read the folder

`omega` is not a global command. It is a bin inside a brand's `node_modules`, and `npx omega` in a folder with nothing installed fetches an unrelated npm package. So a folder with no OMEGA installed gets three file checks, in this order:

1. The folder is empty: create a brand (step 2).
2. `package.json` carries the template mark (`"omega": { "template": true }`): gather the answers (step 2), then run `npm start` with them as flags (step 4). The repo already exists, so skip step 3.
3. `config/omega.json5` exists: run `npm install`, then read `npx omega status --json`.

Anything else is unrelated files: touch nothing, and offer a new subfolder for the brand.

Where OMEGA is installed, read `npx omega status --json` and act on its `state`:

| `state` | What to do |
|---|---|
| `empty` | Create a brand (step 2) |
| `template` | Gather the answers (step 2), then `npm start` with them as flags (step 4); skip step 3 |
| `half-done` | Run the `next` command the report names, then read the status again |
| `brand` | Report it: it runs locally now with `npm start`. Name the keys `missing.env` lists as the ones for going live, which `npm run manage` asks for, the `optional` ones as for later. Then stop |
| `legacy` | Point at `npx omega migrate` and `docs/manager/migration.md`; change nothing |
| `unrelated` | Touch nothing; offer a new subfolder |

Inside a target the report is already the brand root's, and `inTarget` names the target: report from the brand root.

## 2. Idea first, one card

Ask what the person is building. From the answer, propose ONE card: brand id, name, tagline, description and targets, each the shape `docs/manager/index.md` § Onboarding gives. The person corrects it or says go. Ask only for what you cannot infer, plus the GitHub owner.

## 3. One yes, then the repo

- Check `gh auth status` first. When `gh` is missing or not signed in, say so, name the fix (`gh auth login`), and stop.
- Show the repo name `<brand-id>-omega`, the owner, and that the repo is private. Ask once.
- On yes, create it from the template so GitHub shows "generated from": `gh repo create <owner>/<brand-id>-omega --private --template Omega-JS-Stack/brand-template`.
- Wait until the new repo shows its first commit: `gh api repos/<owner>/<brand-id>-omega/commits` answers with one.
- Clone it: in place for an empty folder (`gh repo clone <owner>/<brand-id>-omega .`), else into a new subfolder.

## 4. Run the first `npm start`, with the answers as flags

In the clone (or the template copy), run in the background, because the dev stack keeps running:

`OMEGA_NON_INTERACTIVE=1 npm start -- --id=<brand-id> --name="<name>" --tagline="<tagline>" --description="<description>" --targets=<targets> --org=<owner>`

Flags after `npm start --` reach the onboarding wizard. Add `--company=<company-id>` or `--admins=<emails>` only when the person named them. Follow the run in its output or `<brandRoot>/logs/dev.log` until the local site answers, then open it in the browser. The skill ends here, on a running local site.

## 5. Going live, each step on its own yes

1. `npm run manage`: the manage walk, which asks before each outside thing (a real Firebase project, DNS, payments). Its questions need the person, so they run it in their own terminal at the brand root.
2. `npx omega deploy`: the deliberate publish, `docs/shared/deploys.md`. Only after manage, and only on its own yes.

The skill keeps no list of what either step does. The walk and the docs are the list.
