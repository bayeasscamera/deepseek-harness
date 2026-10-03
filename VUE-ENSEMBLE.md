# Vue d'ensemble de DeepSeek Harness

> Document de travail personnel — état au 2026-10-03, branche `push/session` (HEAD `6574e7ba4e`, poussée sur le fork). Travail en cours non commité, index git préparé : le visualiseur de fichiers `packages/client/ui-sidebar-filepreview` (voir §4) et le mode PPT complet — écriture binaire dans `ctx.fs` puis l'outil `write_presentation` (voir §4, ligne 5b).

## 1. Objectif

### À quoi sert l'app

DeepSeek Harness (`dsh`) est un **agent harness** open source développé par DeepSeek AI : il exécute des agents de codage qui appellent un modèle DeepSeek et travaillent réellement sur un dépôt (shell, fichiers, LSP, web, sous-agents). Il tourne en CLI one-shot (`headless`), en UI web locale, en app desktop Electron, et expose des SDK TypeScript et Python. L'architecture « everything-is-a-plugin » repose sur Cordis : le modèle adapter, les outils, le log de session et même la boucle d'agent sont des plugins remplaçables depuis `cordis.yml`, sans noyau privilégié.

### Pour qui

Pour toi seul, en l'état : c'est un travail personnel sur un fork, dans un projet upstream en *developer preview* (des ruptures de compatibilité sont annoncées). Aucune visée client/equipe actuelle ; l'upstream vise une communauté de plugin (`dsh-plugin`).

### Ce qui le différencie d'un simple client de chat

- **Boucle agent complète** : le modèle appelle des outils (bash, fs, LSP, recherche web…), le résultat revient au modèle, itérations jusqu'à l'objectif — pas du texte en entrée/sortie.
- **Session log durable** : chaque fait visible par le modèle est un événement append-only (`session.vN.jsonl[.zstd]`) d'où l'historique, le fork, la reprise et les snapshots se dérivent.
- **Sandbox & approbation** : politique de permission et cloisonnement des processus (landlock sur Linux, providers locaux/pwsh).
- **Tout est patchable** : profils et bundles (`dsh web`, `headless`, `sdk`, `acp`) composés par couches de patches `cordis.yml`.

## 2. Stack technique

| Domaine | Choix |
|---|---|
| Langage principal | TypeScript strict (`strict: true`, `noImplicitAny`), ESM partout (`"type": "module"`) |
| Runtime Node | `^22.19.0 \|\| >=24.0.0` |
| Monorepo | pnpm workspaces (`pnpm@11.7.0`), packages `@deepseek-ai/dsh-*` |
| Build | `tsc -b` (faces Host/Client séparées) + `tsdown` pour les bundles runtime |
| Tests | Vitest (unit, coverage, e2e, snapshot, expected, web, bench) |
| Lint | oxlint (+ jscpd pour la détection de clones) |
| UI web | React (`@testing-library/react`), frontend `dsh-web-frontend`, dev via Vite |
| Desktop | Electron (`apps/desktop`) + `apps/desktop-host` (process Node hôte, RPC unary/streams, protocole `dsh-app://`, sans port loopback) |
| Python | SDK `python/sdk` + runtime wheel `python/sdk-runtime`, `requires-python >= 3.10`, pytest |
| Natif | `native/landlock-run` (addon Node, sandbox Linux Landlock) |
| Framework agent | Cordis (vendored dans `vendor/`, rescopé `@deepseek-ai/cordis`) |
| Stockage session | JSONL append-only zstd-able dans `$DSH_HOME`, migrations adjacentes `vN → vN+1`, domaines SQLite à `SCHEMA_VERSION` monotone |
| Stockage config | `$DSH_HOME/settings.yaml` (providers/modèles), `cordis.yml` + patches par profil, `~/.dsh/profiles`, `.env` racine pour les clés |
| Appel DeepSeek | API officielle par défaut (`DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` optionnel) via `packages/llm/llm-deepseek` + `llm-pi-ai` ; providers additionnels (protocoles `openai-completions`, `openai-responses`, `anthropic-messages`) configurables dans la page Models |

## 3. Architecture

### Arborescence

```
vendor/      Cordis source vendored (manifeste + procédure de sync)
packages/    Workspaces @deepseek-ai/dsh-<pkg> par domaine
  core/        colonne vertébrale : session, system-prompt, tools, agent, agent-loop
  llm/         capacité LLM : Service Definition/Consumer + providers DeepSeek
  shell/       capacité bash : providers local/pwsh
  subprocess/  processus locaux + lib Win32 partagée
  fs/          capacité filesystem + politique
  lsp/         capacité language server
  skill/       registre de skills + outil catalogue/loader
  web/         recherche/fetch + outil Consumer
  compaction/  compaction de contexte + provider
  subagent/    délégation à sous-agents
  workflow/    workflows + provider worker-thread
  session/     données durables : persistance, projection, titres, télémétrie
  guard/       hygiène de boucle : auto-continue, timeout, reminder
  plan/        mode plan comme état journalisé
  preset/      composition d'agent par session depuis des presets cordis.yml
  interaction/ approbation, permissions, commandes, ask-user
  hooks/       ponts hooks Claude Code/Codex + bibliothèque wire-protocol
  sdk/         protocole JSON-RPC + client/serveur TS
  acp/         serveur ACP automation-only
  bundle/      bundles installables (base, web-app, headless, sdk-app…)
  boot/        démarrage profil/app partagé
  settings/ credentials/ identity/ webhook/ todo/ mcp/ memory/ jobs/ …
  experimental/ prototypes privés (agent-team, inspector…) exclus des releases
  support/ util/ test-support/   infra
apps/        cli (dsh), desktop (Electron), desktop-host, web
python/      SDK Python + runtime
native/      addon landlock-run
benchmarks/  gates de perf
snapshots/   sessions enregistrées rejouées sans clé
docs/        architecture, catalogues générés, postmortems, guide utilisateur
scripts/     gates et générateurs (run-gates.ts)
website/     projection VitePress des docs
.agents/     workflows agent et Agent Notes
```

### Fichier central de la boucle d'agent

`packages/core/agent-loop/src/agent.ts` (driver par défaut, `ctx.agentLoop`) — avec `index.ts`, `tool-calls.ts`, `inbox.ts`, `assistant-stream.ts`. Il implémente l'interface `Agent` de `core/agent` (`ctx.agents`). Le flux : `turn/start` → claim d'entrée (inbox) → assembly prompt + tool schemas → waterfall `agent/pre-step` (réécriture/refus) → `step/start` → `agent/request` → `llm/stream` → `tool/call*` → `tools/pre-execute → tools/execute → tools/post-execute` → `step/end` → boucle tant que des tools sont dus → `agent/turn-stopping` → `turn/end`. Les `turn/*`, `step/*`, `user/message`, `assistant/message`, `tool/*` sont des événements durables dans le log de session. Changer la boucle exige de mettre à jour `docs/architecture.md` — le principe est « plugins, pas modifications de la boucle ».

### Comment les outils sont définis et exécutés

- Définition : chaque plugin contribue ses outils via le registre scope-é (`ctx.tools`, primitive dans `core/scope`) ; les schemas vont dans l'assemblage `core/system-prompt`. Catalogue généré : `docs/tool-catalog.md`.
- Exécution : pipeline gardé, waterfall `tools/pre-execute → tools/execute → tools/post-execute`, chaque listener doit appeler `next()` ; timeouts/garde-fous via `packages/guard`. Détail : `docs/tool-execution-pipeline.md`.
- Présentation UI : chaque outil a sa présentation définie d'avance (host pures, cartes web dérivées des événements bruts) — voir `docs/cookbook/adding-a-tool.md`.

### Comment le contexte / la mémoire est géré

- **Le log de session est la source unique** : `deriveMessages()` projette l'historique modèle depuis les événements `SessionEvent` ; tout input visible par le modèle est journalisé (règle « model-visible ⟺ logged »).
- **Compaction** : capability `packages/compaction`, policy par modèle (compacte à 0.8 de la fenêtre, garde 0.16 récent, résumé par modèle dédié ou conversation), configurable dans `$DSH_HOME/settings.yaml`.
- **Inbox** : un seul point d'entrée ; messages qui réveillent la boucle immédiatement, contexte injecté en attente.
- **Fork/branching** : chaque branche est une session enfant ; le « cut » vit dans le corps de l'enfant (colonne de projection `forkCut`).
- **Persistance** : JSONL par génération (`session.vN.jsonl[.zstd]`), jamais renommé/écrasé ; migrations adjacentes une seule étape `vN → vN+1`.

## 4. Fonctionnalités

### Nouveautés de cette version (cible)

Les six axes voulus pour cette version, avec l'état réel dans le dépôt au 2026-10-03 :

| # | Nouveauté | Statut | Où / preuve |
|---|---|---|---|
| 1a | Desktop native autonome — macOS arm64 + Windows x64, Node embarqué (pas d'install Node séparée) | **Livré** | `apps/desktop` + `apps/desktop-host`, seed offline installé via pnpm bundled, scripts `package:desktop:mac/win:x64` |
| 1b | Workspaces — sélecteur de dossiers pour basculer entre projets | **Livré** | `packages/workspace` (liste durable de projets + groupement des sessions) + `packages/host/directory-picker-native` (dialogues natifs macOS et win32) |
| 1c | Phone Access — coupler un téléphone (Wi-Fi local ou tunnel sécurisé) pour suivre/poursuivre les sessions | **À faire** | aucun code dédié ; seul signal : transport tunnel testé dans `packages/experimental/webworker-runtime` |
| 2a | Creator Mode — l'agent conçoit, teste et déploie ses propres plugins en langage naturel | **Expérimental** | `packages/self-modification` (l'agent inspecte/monte ses plugins) ; pas de flux produit fini |
| 2b | Inspection du runtime en mémoire | **Expérimental** | `packages/experimental/inspector` (`pnpm run demo:inspector`) |
| 3a | PTC (Programmatic Tool Calling) — orchestration TypeScript d'appels d'outils en un bloc | **Livré** | `pnpm run demo:ptc`, preset PTC (`packages/preset/agent-presets`, `display.ts`) |
| 3b | Mode Minimal — shell persistant + éditeur basique, référence de benchmark | **Partiel** | profil `sdk-minimal` + variante « jsonrpc-agent minimal » (`BENCHMARK.md`) ; pas d'UI éditeur/shell dédiée |
| 3c | Sous-agents & Agent Teams — agents parallèles sur un même répertoire | **Expérimental** | `packages/experimental/agent-team` (+ `tool-agent-team`, profiles dédiés) ; exclu des releases ; sous-agents classiques stables (`subagent/`) |
| 4 | Tâches automatisées planifiées + fuseaux horaires (ex. « tous les lundis 9h ») | **Existant, à étendre** | `packages/schedule` : rappels à heure absolue/relative/intervalle, fuseaux gérés (`domain.ts`, `tools.ts`) ; récurrence hebdo type cron à vérifier/ajouter |
| 5a | Visualiseur multi-format dans la barre latérale (HTML, PDF, images, Office) | **Livré** (aperçu de contenu, pas de mise en page pour Office) | `packages/client/ui-sidebar-filepreview` : type de tab `preview` en bande `builtin`, lecture `workspaceFiles.readBytes` par fenêtres puis rendu direct (`<img>`, `<iframe sandbox="allow-scripts">`, `<embed>`) ou conversion (CSV/TSV → table ; xlsx → feuilles de lignes ; docx → HTML ; pptx → texte des diapositives, via `fflate` + `DOMParser`) ; plafonds 32 MiB / 500 lignes / 40 colonnes |
| 5b | Mode PPT — génération .pptx depuis modèles | **Livré** (3 mises en page + 3 modèles intégrés ; pas de gabarit fourni par l'appelant) | `packages/office/tool-slides` : l'outil modèle `write_presentation` + un écrivain OOXML pur (`src/pptx.ts`, ZIP via `fflate`) qui produit le graphe complet (content types, relations, presentation, maître, 3 masques, thème, props, une part par diapositive) ; écriture via `ctx.fs.writeBytes` (phase 1), donc mêmes gardes, verrou et clôture de sandbox — y compris un trou de clôture trouvé par les tests et corrigé dans `fs-sandbox`. Validé par `python-pptx` et Quick Look. |
| 6a | File d'envoi : Queue / Steer pendant l'exécution | **Partiel** | file d'attente présente dans l'inbox du agent-loop (`inbox.ts`) et API live `agent/*` ; UI de steer/pause côté client non trouvée |
| 6b | Traçabilité append-only (raisonnement, invites système, tool calls) | **Livré** | log `SessionEvent` + snapshots de sessions rejouables |

### Stable et vérifié

- Boucle agent, log de session, assembly prompt/tools — couverts par tests unit + snapshots rejouables sans clé (`pnpm run test:snapshot`).
- UI web, CLI `dsh web` / `--profile headless`, SDK TS/Python (profils `sdk`, `sdk-minimal`).
- Outils : shell, fs, LSP, web (search/fetch), skills, sous-agents, workflows, todo, plan mode, compaction, guard auto-continue (finir une réponse tronquée `max-tokens` dans le même tour).
- **Branche de session (Branche)** : fork, copie isolée de fichiers optionnelle, marque du message de bifurcation, handoff brouillon, strings FR — complet, poussé, gates verts.
- App desktop macOS : packagée, signée ad-hoc, installée localement ; audits desktop 2026-10 (rôle `editMenu`, icône, profil `~/.dsh`) corrigés et vérifiés.

### Codé mais pas vérifié / fragile

- **e2e réels** : auto-skip sans `DEEPSEEK_API_KEY` — donc jamais exécutés dans un environnement sans clé.
- **`packages/experimental/`** : agent-team, inspector, code-runtime-python, webworker — prototypes privés, exclus des releases.
- **Pipeline de release/signature** : le gate de seed (TeamIdentifier) bloque le pipeline standard en local ; seule la build locale ad-hoc est validée.
- Plateformes autres que macOS arm64 : Windows/Wine et Linux ne sont validés que côté CI.

### En cours

- Rien de déferé sur le branching : le regroupement parent/enfant est livré (une branche se niche sous sa session d'origine dans la liste groupée ; la liste plate reste sans adjacence).

### Prévu (pour cette version)

- **Gabarits PPT fournis par l'appelant** — le mode livré offre trois mises en page (titre, section, puces) et trois modèles intégrés (`default`, `dark`, `print`) ; accepter un gabarit d'entreprise (masque, images, notes) est le prolongement naturel.
- **Fidélité Office** — les aperçus Word/Excel/PowerPoint gardent le texte, pas la mise en page (pas de styles, images, numérotation ; dates en numéros de série) ; une montée en fidélité demanderait mammoth/SheetJS.
- **Phone Access** (suivi à distance des sessions, Wi-Fi local ou tunnel).
- **Récurrence cron** dans `schedule` (« tous les lundis à 9h ») au-delà des rappels absolu/intervalle.
- **Sortie de l'expérimental** : promouvoir Agent Teams et le Creator Mode (self-modification + inspector) en features produit stables.
- **UI Queue/Steer** côté client (la file existe dans la boucle, il manque le contrôle visible).

### À arbitrer (hors version)

- Stabiliser le packaging desktop officiel (sortir du build local ad-hoc).
- Décider du sort des branches ouvertes (`refactor/isolate-wip`, `refactor/jsonrpc-directional`, backups) : merger ou abandonner.
- Statut des packages « release members » achevés mais non montés par design — les monter ou les documenter comme tels.

## 5. Configuration

### Modèles

- Sélection par défaut via `@deepseek-ai/dsh-agent-default-model` (champ `model`, id propriétaire du provider) ; chaque session conserve le modèle enregistré dans son propre log.
- Le catalogue DeepSeek installé fournit endpoints/modèles (les entrées conseillées actuelles sont du type V4 Flash / V4 Pro / V4 Flash Vision Exp) ; les modèles d'entrée manuelle sont texte-only sauf déclaration `input: image`.
- Providers custom : page Models du Web UI ou `$DSH_HOME/settings.yaml` (base URL, protocole, `apiKeyEnv`, fenêtre de contexte, `reasoningEfforts`…).

### Variables d'environnement (noms seulement)

- `DEEPSEEK_API_KEY` — clé API (ou racine `.env` ; jamais commitée).
- `DEEPSEEK_BASE_URL` — point d'entrée alternatif, optionnel.
- `DSH_HOME` — répertoire Harness home (profiles, settings, sessions).
- `DSH_SNAPSHOT` — mode des tests snapshot (`record` / `refresh`).
- `DSH_DESKTOP_LOCAL_BUILD` — build desktop locale sans credentials.

### Réglages importants

- `$DSH_HOME/settings.yaml` : providers, modèles, fenêtres de contexte, politique de compaction, retries, reasoning — relu à la requête, pas de redémarrage.
- Profils/bundles + `cordis.patch.yml` : composition de l'arbre de plugins (`dsh --profile web --dump-config` pour voir l'arbre réel).
- Politique d'approbation/sandbox et timeouts : champs `Config` des plugins correspondants, jamais de constante hardcodée.

## 6. Problèmes connus

### Bugs / limitations ouvertes

- **Pas de regroupement des sessions parent/enfant** dans la liste — reproduction : créer plusieurs forks d'une session, la liste les montre à plat, sans hiérarchie (item déferé du travail branching).
- **Gate de seed desktop** : `pnpm run package:desktop:mac:arm64` échoue localement faute du seed signé TeamIdentifier ; contournement : build locale `DSH_DESKTOP_LOCAL_BUILD=1` + installation ad-hoc dans `/Applications`.
- **e2e silencieux sans clé** : `pnpm run test:e2e` se self-skip — un vert local ne prouve rien sur les providers.

### Limites actuelles

- *Developer preview* : ruptures de compatibilité annoncées par l'upstream (`SAFETY.md`).
- Un provider ne parle qu'un protocole ; servir deux protocoles impose deux providers.
- La découverte de modèles (`Fetch available models`) dépend du format publié par l'endpoint — pas garanti.
- Le mode plan, les hooks et les sous-agents reposent sur des waterfalls : un listener qui n'appelle pas `next()` casse la chaîne en silence.

### Dette technique

- Nombreux gates générés bilingues à resynchroniser à chaque changement de doc/catalogue (`doc-sync`) — coût de maintenance réel mais assumé.
- Branches de travail anciennes accumulées (`backup-master-46`, `refactor/*`) à fusionner ou supprimer.
- Le fork est très en avance sur `master` local : rebase/merge-forward à planifier avant toute reprise d'upstream.

## 7. Priorités

### Les 3 prochaines choses (cible version)

1. **Phone Access** — seul axe de la liste encore totalement absent ; s'appuyer sur le tunnel esquissé dans `experimental/webworker-runtime`.
2. **Récurrence hebdomadaire de `schedule`** (« tous les lundis à 9h ») — touche l'union de records durables, donc une migration de format de session à assumer.
3. **Gabarits appelant et fidélité** — accepter un gabarit PPT fourni, et éventuellement mammoth/SheetJS pour la mise en page Office (décision de poids de bundle à assumer).

En parallèle, restent ouverts : la sortie de l'expérimental (Agent Teams, Creator Mode), le regroupement parent/enfant des sessions, et le gate de seed desktop.

### Ce que je veux que tu fasses en premier

**Récurrence hebdomadaire de `schedule`** (« tous les lundis à 9h ») — le format n'est pas un obstacle (la note de mécanisme dit que les ajouts de payload ne changent pas la version), mais l'occurrence doit être calculée juste à travers les passages à l'heure d'été et le contrat de dispatch étendu : un chantier à faire proprement, pas à moitié. **Phone Access** reste refusé par sécurité (`dsh web --host 0.0.0.0`) : l'ouvrir demande une décision de posture. **Vérification du PDF desktop** : impossible dans cet environnement — Electron ne démarre pas ici (son IPC Mach est refusé : `bootstrap_look_up ... Permission denied (1100)`), même hors sandbox ; à refaire sur une machine où l'app peut tourner.

## 8. Règles de travail

### Conventions de code

- TypeScript strict, `const` par défaut, `any` justifié, ESM partout, imports relatifs avec `.ts`.
- **Les registrations sont des effets** : tout passe par `ctx.effect()` / `ctx.on()`, `register()` retourne le disposer.
- Waterfalls : les listeners DOIVENT appeler `next()`.
- Unions fermées terminées par `assertNever`, unions extensibles par défaut documenté.
- Visible par le modèle ⟺ journalisé : tout nouveau input modèle exige un événement de session.
- Nouveau comportement = plugin sur point d'extension ; toucher `agent-loop` impose une mise à jour de `docs/architecture.md`.
- Ids cross-boundary brandés (`Branded<B>`), jamais `string` nu.
- JSDoc sur chaque export public (`verify-export-jsdoc`), commentaires locaux uniquement, prose concrète sans métaphore.
- **Tout changement non trivial inclut une Agent Note dans la même PR** (dans `.agents/notes/<cycle>/<classe>/`, ajout avec `git add -f` — le gitignore global bloque `.agents/`).
- UI client : copie passée par les dictionnaires localisés (`verify-client-ui-i18n` rejette le texte hardcodé).
- Commits : Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`…), une seule ligne de fin de fichier (`git diff --cached --check`).

### Commandes

```sh
pnpm install                       # installer
pnpm run build                     # builder (tsc + tsdown)
pnpm dsh web                       # lancer l'UI web (ou --profile headless "task")
pnpm run dev:desktop               # dev desktop
pnpm run package:desktop:mac:arm64:dir   # packager desktop (voir gate de seed §6)
pnpm run test                      # tests unitaires
pnpm run test:coverage             # gate CI de couverture
pnpm run test:snapshot             # replay de sessions sans clé (-t <nom>)
pnpm run test:e2e                  # e2e réels (self-skip sans clé)
pnpm run typecheck && pnpm run lint
pnpm run doc-sync                  # tous les gates de doc
pnpm run hygiene                   # publint + checks workspace
```

Avant push : skill `dsh-pre-push-checks` ; ne rapporter que les commandes réellement lancées. CI possède la couverture exhaustive — ne pas relancer toute la suite localement sans raison.

### Ce que je ne dois jamais toucher

- **`vendor/`** autre que par la procédure de sync de `vendor/README.md`.
- **Les générations de sessions committées** (`session.vN.jsonl*`) : jamais renommées, écrasées, supprimées ; les migrations sont adjacentes.
- **Les credentials** : aucun secret en dur, jamais de `.env` commité, jamais de clé dans le code ou les docs.
- **Les fixtures de snapshots** : corriger les fixtures, pas les normaliseurs.
- **Les Agent Notes archivées** : gelées, jamais éditées.
- **`master`/push distant sans tests verts** ; jamais de `--force` brut (uniquement `--force-with-lease`, en annulant si le distant a bougé).
- **Les gates en les désactivant globalement** — exceptions étroites et justifiées seulement.
- La boucle `agent-loop` sans mettre à jour `docs/architecture.md`, et sans nécessité prouvée (les extensions vont sur les plugins).
