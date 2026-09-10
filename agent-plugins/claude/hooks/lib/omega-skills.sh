#!/usr/bin/env bash
# omega skill map — sourced by the hooks that answer "which skill owns this?"
# (inject, gate). ONE home for the framework → skill table and for the brand
# walk. The two hooks share the map but ask different questions of it: inject
# also reads config target keys, while the gate resolves a target from its
# manifest alone — a config-declared target with no manifest yet is asked for
# and not gated (fail-open by design).
# Every function fails open: unreadable files and unparseable JSON answer
# "nothing here", never an error.

# omega_skill_for <token>
# The one table — every hook that maps a thing to a skill reads THIS. Takes a
# package name (@omega.js/web), a config target key (web), or a monorepo
# package directory name (web): three spellings of the same fact. Prints the
# skill, or nothing when no skill owns the token:
# a custom target, `mobile` (parked), and the internal packages (devkit,
# config, account, analytics, monitoring, template-kit, mcp-router) all land
# here deliberately.
omega_skill_for() {
  case "$1" in
    @omega.js/web|web|website)         echo 'omega:web' ;;
    @omega.js/backend|backend)         echo 'omega:backend' ;;
    @omega.js/desktop|desktop)         echo 'omega:desktop' ;;
    @omega.js/extension|extension)     echo 'omega:extension' ;;
    @omega.js/manager|manager)         echo 'omega:manager' ;;
    @omega.js/client|client)           echo 'omega:client' ;;
    omega)                             echo 'omega:main' ;;
  esac
}

# omega_manifest_deps <manifest>
# Every dependency name in a package.json, both blocks, one per line.
omega_manifest_deps() {
  [ -f "$1" ] || return 0
  jq -r '((.dependencies // {}) | keys) + ((.devDependencies // {}) | keys) | .[]' "$1" 2>/dev/null || true
}

# omega_brand_root <dir>
# Walks up from a directory to the git root (inclusive) and prints the first
# BRAND root it finds: a directory carrying config/omega.json5, or one whose
# package.json depends on @omega.js/manager. Prints nothing when the walk
# leaves no brand behind — a framework package, a plain project, the monorepo
# root itself.
omega_brand_root() {
  local dir="$1"
  [ -n "$dir" ] || return 0
  # `dirname` bottoms out at "." for a relative path and stays there forever,
  # so the walk below would never terminate. Nothing to resolve, answer nothing.
  case "$dir" in /*) ;; *) return 0 ;; esac
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if [ -f "$dir/config/omega.json5" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
    if [ -f "$dir/package.json" ] && omega_manifest_deps "$dir/package.json" | grep -qxF '@omega.js/manager'; then
      printf '%s\n' "$dir"
      return 0
    fi
    [ -e "$dir/.git" ] && return 0
    dir=$(dirname "$dir")
  done
}

# omega_config_target_keys <config/omega.json5>
# The immediate child keys of the config's `targets` block, one per line. The
# config is JSON5 (comments, unquoted keys, trailing commas), so jq cannot read
# it and a key scan is the whole job: brace-depth tracking from the `targets:`
# line, printing keys at depth 1. Nothing here is load-bearing — a miss just
# means the key's skill has to come from the target's own manifest.
omega_config_target_keys() {
  [ -r "$1" ] || return 0
  awk '
    BEGIN { started = 0; depth = 0 }
    {
      line = $0
      # A comment starts at line start or after whitespace — never mid-token,
      # which is what keeps a "https://…" value from eating its own braces.
      sub(/^[[:space:]]*\/\/.*$/, "", line)
      sub(/[[:space:]]\/\/.*$/, "", line)
    }
    !started {
      if (line ~ /^[[:space:]]*"?targets"?[[:space:]]*:[[:space:]]*\{/) { started = 1; depth = 1 }
      next
    }
    {
      if (depth == 1 && line ~ /^[[:space:]]*["'"'"']?[A-Za-z_][A-Za-z0-9_-]*["'"'"']?[[:space:]]*:/) {
        key = line
        sub(/^[[:space:]]*/, "", key)
        sub(/[[:space:]]*:.*$/, "", key)
        gsub(/["'"'"']/, "", key)
        print key
      }
      depth += gsub(/\{/, "{", line) - gsub(/\}/, "}", line)
      if (depth <= 0) exit
    }
  ' "$1" 2>/dev/null || true
}

# omega_brand_skills <brand_root>
# Every skill a brand session needs, one per line, unsorted and possibly
# repeated: omega:main and omega:manager (always, in a brand), plus one skill
# per target — read from every targets/*/package.json (and the functions/
# manifest a Firebase backend keeps its framework in) AND from the config's
# own target keys, so a target declared before its directory exists still
# counts. A target no framework owns contributes nothing.
omega_brand_skills() {
  local root="$1" manifest dep key
  echo 'omega:main'
  echo 'omega:manager'

  for manifest in "$root"/targets/*/package.json "$root"/targets/*/functions/package.json; do
    [ -f "$manifest" ] || continue
    while read -r dep; do
      [ -n "$dep" ] || continue
      omega_skill_for "$dep"
    done < <(omega_manifest_deps "$manifest")
  done

  while read -r key; do
    [ -n "$key" ] || continue
    omega_skill_for "$key"
  done < <(omega_config_target_keys "$root/config/omega.json5")
}

# omega_theme_surface <path-relative-to-a-package-or-target-root>
# Whether a path is one of the theme cascade's OWN surfaces — the layers
# `resolveThemeLayers`/`overrideLanes` walk (packages/web's packaged themes, a
# consumer-local theme at src/themes/<id>, the section folders a consumer
# shadows — `_sections` AND `_components`, which overrideLanes resolves as one
# lane — and the tier-1 scss entry). One table serves the monorepo and a
# brand alike, since the caller passes the path relative to the package or
# target root.
omega_theme_surface() {
  case "$1" in
    themes/*|src/themes/*|src/_sections/*|src/_components/*|src/assets/css/main.scss) return 0 ;;
  esac
  return 1
}

# omega_skill_for_file <file_path>
# The skill(s) that OWN an editable surface, one per line, or nothing when no
# skill does. The surface's own skill comes first; omega:theme joins it on a
# theme surface (omega_theme_surface above), so a theme edit answers to both.
# Three surfaces gate, and only these three:
#   <brand>/targets/<t>/**   the target's own framework skill
#   <brand>/config/omega.json5   omega:manager — the file the manage walk reconciles
#   <monorepo>/packages/<pkg>/** that package's skill, where one exists
# Everything else — docs, scripts, the plugin's own files, a brand's root
# files, an internal package — answers nothing and stays free.
omega_skill_for_file() {
  local file_path="$1"
  [ -n "$file_path" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local brand rest target manifest skill

  # The monorepo's own packages, ASKED FIRST: a package tree owns everything
  # inside it, so a brand-shaped fixture living in one (devkit's test fixtures)
  # is that package's business and never a brand of its own. The FIRST
  # packages/ segment names the package — a nested packages/ inside a fixture
  # cannot answer — and the manifest has to BE @omega.js/<pkg>; any other
  # repo's packages/ directory falls through to the brand walk below.
  case "$file_path" in
    */packages/*/*)
      rest="${file_path#*/packages/}"
      target="${rest%%/*}"
      manifest="${file_path%/packages/"$rest"}/packages/$target/package.json"
      if [ -f "$manifest" ] && [ "$(jq -r '.name // ""' "$manifest" 2>/dev/null || true)" = "@omega.js/$target" ]; then
        skill=$(omega_skill_for "@omega.js/$target")
        [ -n "$skill" ] && printf '%s\n' "$skill"
        if [ "$skill" = 'omega:web' ] && omega_theme_surface "${rest#"$target"/}"; then
          echo 'omega:theme'
        fi
        return 0
      fi
      ;;
  esac

  brand=$(omega_brand_root "$(dirname "$file_path")")
  if [ -n "$brand" ]; then
    case "$file_path" in
      "$brand"/config/omega.json5)
        echo 'omega:manager'
        return 0
        ;;
      "$brand"/targets/*/*)
        rest="${file_path#"$brand"/targets/}"
        target="${rest%%/*}"
        for manifest in "$brand/targets/$target/package.json" "$brand/targets/$target/functions/package.json"; do
          [ -f "$manifest" ] || continue
          while read -r dep; do
            [ -n "$dep" ] || continue
            skill=$(omega_skill_for "$dep")
            if [ -n "$skill" ]; then
              printf '%s\n' "$skill"
              # The cascade is a web mechanism, so only a website target's own
              # theme surfaces add it — a themes/ dir in a backend is not one.
              if [ "$skill" = 'omega:web' ] && omega_theme_surface "${rest#"$target"/}"; then
                echo 'omega:theme'
              fi
              return 0
            fi
          done < <(omega_manifest_deps "$manifest")
        done
        return 0
        ;;
    esac
  fi
}
