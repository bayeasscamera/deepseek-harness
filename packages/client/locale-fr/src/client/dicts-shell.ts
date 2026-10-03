/**
 * French dictionaries for the shell namespaces: sidebars, workspaces,
 * reference menu, file browser, approvals, plans, goals, jobs, schedules,
 * and tool chrome. Each table mirrors its English source key for key; a
 * missing key falls back to English at lookup time, never to another
 * language.
 */

/** French rows for the `sidebar` namespace. */
export const sidebarFr: Record<string, string> = {
  'session.new': 'Nouvelle session',
  'session.new.label': 'Nouvelle session',
  'toggle.open': 'Ouvrir la barre latérale',
  'toggle.collapse': 'Réduire la barre latérale',
}

/** French rows for the `sidebarFiles` namespace. */
export const sidebarFilesFr: Record<string, string> = {
  'type.label': 'Fichiers',
  'guide.title': 'Fichiers',
  'guide.description':
    'Parcourez les fichiers de l’espace de travail de cette session et ouvrez-les.',
  loading: 'Lecture en cours…',
  empty: 'Répertoire vide',
  truncated: 'Trop d’entrées ; seules certaines sont affichées.',
  noWorkspace: 'Cette session n’a aucun répertoire d’espace de travail.',
  reload: 'Recharger',
  'entry.other': 'Ni fichier ni répertoire, impossible à ouvrir.',
  'error.notFound': 'Ce répertoire n’existe plus. Il a peut-être été déplacé ou supprimé.',
  'error.outsideWorkspace':
    'Ce répertoire est hors de l’espace de travail, la barre latérale ne le lira pas.',
  'error.notDirectory': 'Ce n’est pas un répertoire.',
  'error.unavailable': 'Échec de lecture : {message}',
}

/** French rows for the `sidebarRight` namespace. */
export const sidebarRightFr: Record<string, string> = {
  'chrome.expand': 'Ouvrir la barre latérale',
  'chrome.collapse': 'Fermer la barre latérale',
  'chrome.toFullscreen': 'Afficher la barre latérale en plein écran',
  'chrome.exitFullscreen': 'Quitter le plein écran de la barre latérale',
  'dock.emptyPane': 'Panneau vide',
  'dock.splitPane': 'Diviser vers la droite',
  'dock.splitPaneDisabled': 'Deux panneaux au maximum',
  'dock.splitPaneNarrow': 'Largeur insuffisante pour diviser ; élargissez la barre latérale',
  'dock.closeTab': 'Fermer',
  'dock.addTab': 'Nouvel onglet',
  'dock.dockFloat': 'Renvoyer vers la barre latérale',
  'dock.closeFloat': 'Fermer',
  'tab.guide.title': 'Démarrer',
  'tab.unavailable': 'Aucune vue disponible pour ce type de contenu pour l’instant.',
  'guide.lead': 'La barre latérale garde sous les yeux ce que vous voulez suivre.',
  'guide.body':
    'Les fichiers et productions de la conversation s’ouvrent dans cette colonne ; les entrées ci-dessous en ouvrent d’autres.',
}

/** French rows for the `sidebarTextpreview` namespace. */
export const sidebarTextpreviewFr: Record<string, string> = {
  loading: 'Lecture en cours…',
  loadMore: 'Charger plus',
  changed: 'Le fichier a changé ; le texte affiché est l’ancien.',
  reloadNow: 'Recharger',
  reload: 'Relire le fichier',
  wrap: 'Retour à la ligne automatique',
  'error.notFound': 'Ce fichier n’existe plus. Il a peut-être été déplacé ou supprimé.',
  'error.outsideWorkspace':
    'Ce fichier est hors de l’espace de travail, la barre latérale ne le lira pas.',
  'error.tooLarge':
    'Cette page est trop grande ; la barre latérale ne lit pas les pages au-delà de {limit}.',
  'error.notText': 'Ce n’est pas un fichier texte, impossible à afficher ici.',
  'error.notRegularFile': 'Ce n’est pas un fichier ordinaire, il n’a aucun texte à afficher.',
  'error.unavailable': 'Échec de lecture : {message}',
  retry: 'Réessayer',
}

/** French rows for the `sidebarFilepreview` namespace. */
export const sidebarFilepreviewFr: Record<string, string> = {
  loading: 'Chargement…',
  reload: 'Recharger le fichier',
  retry: 'Réessayer',
  slide: 'Diapositive {n}',
  'table.truncated': 'Le fichier dépasse ce que l’aperçu dessine ; seul son début est affiché.',
  'document.empty': 'Ce document ne contient aucun texte affichable.',
  'error.notFound': 'Ce fichier n’existe plus. Il a peut-être été déplacé ou supprimé.',
  'error.outsideWorkspace':
    'Ce fichier est hors de l’espace de travail, la barre latérale ne le lira pas.',
  'error.notRegularFile': 'Ce n’est pas un fichier ordinaire, il n’y a rien à prévisualiser.',
  'error.tooLargeWindow':
    'Cette page est trop grande ; la barre latérale ne lit pas les pages au-delà de {limit}.',
  'error.tooLargePreview':
    'Ce fichier dépasse la limite d’aperçu de {limit} : impossible de l’ouvrir ici.',
  'error.unsupported': 'Ce type de fichier n’a pas d’aperçu intégré.',
  'error.unreadable': 'La lecture s’est arrêtée en cours de route ; le fichier est peut-être en cours d’écriture.',
  'error.malformed': 'Ce fichier n’a pas pu être lu selon son extension ; il est peut-être endommagé.',
  'error.unavailable': 'Échec de lecture : {message}',
}

/** French rows for the `workspace` namespace. */
export const workspaceFr: Record<string, string> = {
  'group.ungrouped': 'Non groupées',
  'branch.count': '{n} branches',
  'session.new': 'Nouvelle session',
  'section.workspaces': 'Espaces de travail',
  'section.sessions': 'Sessions',
  'viewOptions.label': 'Options d’affichage',
  'groupBy.label': 'Grouper par',
  'groupBy.workspace': 'Espace de travail',
  'groupBy.flat': 'Liste unique',
  'orderBy.label': 'Trier par',
  'orderBy.manual': 'Ordre manuel',
  'orderBy.updated': 'Dernière mise à jour',
  'sessions.expand': 'Afficher {n} sessions de plus',
  'sessions.collapse': 'Réduire',
  'empty.none': 'Aucune session pour l’instant',
  'empty.noMatches': 'Aucune correspondance',
  'workspace.add': 'Ajouter un espace de travail',
  'search.sessions.aria': 'Rechercher des sessions',
  'search.placeholder': 'Rechercher des sessions…',
  'search.clear': 'Effacer la recherche',
  'search.results.aria': 'Résultats de recherche',
  'search.pending': 'Recherche dans l’historique des sessions…',
  'search.unavailable':
    'Recherche de contenu temporairement indisponible. Noms correspondants affichés.',
  'search.noMatches': 'Aucune session correspondante',
  'search.hasMore': 'Affiche les {n} premiers résultats. Précisez votre recherche.',
  'menu.addWorkspace': 'Ajouter un espace de travail…',
  'picker.loading': 'Chargement des espaces de travail…',
  'conflict.named': 'Un espace de travail nommé « {name} » existe déjà.',
  'folderError.title': 'Impossible d’ouvrir le dossier',
  'folderError.retry': 'Choisir à nouveau',
  rename: 'Renommer',
  'rename.workspace.title': 'Renommer l’espace de travail',
  'rename.session.title': 'Renommer la session',
  'field.workspaceName': 'Nom de l’espace de travail',
  'field.sessionName': 'Nom de la session',
  'delete.workspace': 'Supprimer l’espace de travail',
  'delete.desc':
    'Retire « {name} » de la liste des espaces de travail. Le dossier et les historiques de session sont conservés. Ses sessions apparaîtront sous Non groupées.',
  'delete.pending': 'Suppression de l’espace de travail…',
  'menu.fork': 'Brancher la session',
  'menu.archiveSession': 'Archiver la session',
  'sessions.count.one': '{n} session',
  'sessions.count.other': '{n} sessions',
  'actions.workspace.aria': 'Actions de l’espace de travail {name}',
  'actions.session.aria': 'Actions de la session {name}',
  'actions.newSession.aria': 'Nouvelle session dans {name}',
  'status.running': 'En cours',
  'status.subagentsRunning.one': '{n} sous-agent en cours',
  'status.subagentsRunning.other': '{n} sous-agents en cours',
  'status.idle': 'Inactif',
  'status.waitingApproval': 'En attente d’approbation',
  'status.planReview': 'Plan à valider',
  'status.waitingAnswer': 'En attente de réponse',
  'status.completed': 'Terminé',
  'schedule.active': 'Tâche planifiée active',
  'hover.created': 'Créé le {time}',
  'hover.copied': 'Copié',
  'date.ymd': '{d}/{m}/{y}',
  'time.now': 'à l’instant',
  'time.minutes': 'il y a {n} min',
  'time.hours': 'il y a {n} h',
  'time.days': 'il y a {n} j',
  'time.months': 'il y a {n} mois',
  'time.years': 'il y a {n} an(s)',
  'time.ago': 'il y a {t}',
}

/** French rows for the `reference` namespace. */
export const referenceFr: Record<string, string> = {
  'section.files': 'Fichiers et dossiers',
  'section.sessions': 'Conversations',
  'candidate.noCwd': '(sans répertoire de travail)',
  'crumb.root': 'Espace de travail',
  'time.now': 'à l’instant',
  'time.minutes': '{n} min',
  'time.hours': '{n} h',
  'time.days': '{n} j',
  'time.months': '{n} mois',
  'time.years': '{n} an(s)',
}

/** French rows for the `directory-browser` namespace. */
export const directoryBrowserFr: Record<string, string> = {
  'browser.title': 'Choisir le répertoire de l’espace de travail',
  'browser.home': 'Dossier personnel',
  'browser.newFolder': 'Nouveau dossier',
  'browser.folderName': 'Nom du dossier',
  'browser.createIn': 'Nouveau dossier dans « {name} »',
  'browser.untitledFolder': 'Dossier sans titre',
  'browser.create': 'Créer',
  'browser.cancel': 'Annuler',
  'browser.open': 'Ouvrir',
  'browser.editPath': 'Modifier le chemin',
  'browser.loading': 'Chargement en cours…',
  'browser.truncated': 'Trop de dossiers à lister ; seul le début est affiché.',
  'browser.showHidden': 'Afficher les fichiers cachés',
}

/** French rows for the `open-in-app` namespace. */
export const openInAppFr: Record<string, string> = {
  'open.title': 'Ouvrir l’espace de travail dans {app}',
  'open.tooltip': 'Ouvrir en local',
  'open.error': 'Échec de l’ouverture',
  'menu.toggle': 'Choisir une application pour ouvrir',
  'menu.aria': 'Ouvrir dans',
  // Product names render verbatim in every locale (owned by
  // dsh-client-ui-open-in-app); repeated here so the French table stays
  // complete without inventing translations for proper nouns.
  /* jscpd:ignore-start */
  'app.cursor': 'Cursor',
  'app.vscode': 'VS Code',
  'app.vscodeinsiders': 'VS Code Insiders',
  'app.windsurf': 'Windsurf',
  'app.zed': 'Zed',
  'app.sublimetext': 'Sublime Text',
  'app.xcode': 'Xcode',
  'app.androidstudio': 'Android Studio',
  'app.intellij': 'IntelliJ IDEA',
  'app.pycharm': 'PyCharm',
  'app.webstorm': 'WebStorm',
  'app.phpstorm': 'PhpStorm',
  'app.goland': 'GoLand',
  'app.rider': 'Rider',
  'app.rustrover': 'RustRover',
  'app.fork': 'Fork',
  'app.sourcetree': 'Sourcetree',
  'app.github': 'GitHub Desktop',
  'app.tower': 'Tower',
  'app.gitkraken': 'GitKraken',
  'app.smartgit': 'SmartGit',
  'app.sublimemerge': 'Sublime Merge',
  'app.ghostty': 'Ghostty',
  'app.warp': 'Warp',
  'app.iterm': 'iTerm2',
  'app.kitty': 'kitty',
  'app.windowsterminal': 'Windows Terminal',
  'app.gitbash': 'Git Bash',
  'app.gnometerminal': 'Terminal GNOME',
  'app.konsole': 'Konsole',
  /* jscpd:ignore-end */
  'app.finder': 'Finder',
  'app.explorer': 'Explorateur de fichiers',
  'app.filemanager': 'Fichiers',
  'app.terminal': 'Terminal',
}

/** French rows for the `approval` namespace. */
export const approvalFr: Record<string, string> = {
  waiting: 'En attente d’approbation',
  'detail.aria': 'Détails de l’approbation',
  escalation: 'L’outil {toolName} demande une exécution privilégiée',
  reject: 'Refuser',
  allowOnce: 'Autoriser une fois',
}

/** French rows for the `plan` namespace. */
export const planFr: Record<string, string> = {
  'chip.label': 'Plan',
  'chip.on.aria': 'Mode plan activé, appuyez pour désactiver',
  'chip.on.title': 'Mode plan activé — cliquez pour désactiver (/plan off)',
  'chip.off.aria': 'Mode plan désactivé, appuyez pour activer',
  'chip.off.title': 'Mode plan désactivé — cliquez pour activer (/plan)',
  'chip.exitFailed': 'Échec de la sortie du mode plan',
}

/** French rows for the `goal` namespace. */
export const goalFr: Record<string, string> = {
  'phase.active': 'Objectif en cours',
  'phase.paused': 'Objectif en pause',
  'phase.blocked': 'Objectif bloqué',
  'objective.aria': 'Contenu de l’objectif',
  'commandInput.aria': 'Saisie de commande',
  'action.save': 'Enregistrer l’objectif',
  'action.cancel': 'Annuler la modification',
  'action.pause': 'Suspendre l’objectif',
  'action.resume': 'Reprendre l’objectif',
  'action.edit': 'Modifier l’objectif',
  'action.clear': 'Effacer l’objectif',
}

/** French rows for the `job` namespace. */
export const jobFr: Record<string, string> = {
  'count.live.one': '{count} tâche de fond en cours',
  'count.live.other': '{count} tâches de fond en cours',
  'count.idle.one': '{count} tâche de fond',
  'count.idle.other': '{count} tâches de fond',
  'list.aria': 'Tâches de fond',
  'status.running': 'en cours',
  'status.stopping': 'arrêt en cours',
  'status.completed': 'terminée',
  'status.killed': 'annulée',
  'status.failed': 'échouée',
  'duration.seconds': '{seconds} s',
  'duration.minutes': '{minutes} min {seconds} s',
  'duration.hours': '{hours} h {minutes} min',
  'duration.title.live': 'En cours depuis {duration}',
  'duration.title.done': 'Durée {duration}',
}

/** French rows for the `schedule.catalog` namespace. */
export const scheduleCatalogFr: Record<string, string> = {
  'trigger.one': '{count} rappel',
  'trigger.other': '{count} rappels',
  'list.aria': 'Rappels actifs',
  'status.scheduled': 'Planifié',
  'status.overdue': 'En retard',
  'frequency.once': 'Une fois',
  'frequency.every': 'Tous les {value} {unit}',
  'unit.day.one': 'jour',
  'unit.day.other': 'jours',
  'unit.hour.one': 'heure',
  'unit.hour.other': 'heures',
  'unit.minute.one': 'minute',
  'unit.minute.other': 'minutes',
  'unit.second.one': 'seconde',
  'unit.second.other': 'secondes',
  'relative.now': 'Échéance immédiate',
  'relative.future': 'dans {value} {unit}',
  'relative.overdue': 'en retard de {value} {unit}',
}

/** French rows for the `workflowRun` namespace. */
export const workflowRunFr: Record<string, string> = {
  'run.title': '{name}',
  'run.members.one': '{count} membre',
  'run.members.other': '{count} membres',
  'run.empty': 'Aucun membre démarré',
  'phase.unassigned': 'Hors phase',
  'phase.empty': 'Nom de phase vide',
  'statusCount.running': '{count} en cours',
  'statusCount.completed': '{count} terminés',
  'statusCount.failed': '{count} échoués',
  'statusCount.cancelled': '{count} annulés',
  'statusCount.interrupted': '{count} interrompus',
  'member.empty': 'Nom de membre vide',
  'member.open': 'Ouvrir {name}',
  'status.running': 'En cours',
  'status.completed': 'Terminé',
  'status.failed': 'Échoué',
  'status.cancelled': 'Annulé',
  'status.interrupted': 'Interrompu',
}

/** French rows for the `deliverables` namespace. */
export const deliverablesFr: Record<string, string> = {
  'produced.label': 'Productions',
  'produced.moreOne': '+ 1 fichier',
  'produced.more': '+ {count} fichiers',
  'produced.open': 'Ouvrir {name}',
}

/** French rows for the `command` namespace. */
export const commandFr: Record<string, string> = {
  'search.placeholder': 'Rechercher…',
  'search.aria': 'Filtrer les options',
  'status.loading': 'Chargement des options…',
  'status.applying': 'Application en cours…',
  'status.empty': 'Aucune option',
  'overlay.aria': 'Options de /{command}',
  'listbox.aria': 'Correspondances de /{command}',
  'notice.attachmentsUnsupported':
    '/{command} n’accepte pas les pièces jointes ; retirez-les d’abord',
}

/** French rows for the `slash.menu` namespace. */
export const slashMenuFr: Record<string, string> = {
  command: 'Commandes',
  skill: 'Skills',
  subagent: 'Sous-agents',
  loading: 'Chargement en cours…',
  'drill.aria': 'Parcourir le dossier',
  'drill.hint': 'Parcourir le dossier',
  'drill.key': 'Tab',
  'crumbs.aria': 'Navigation dans les dossiers',
  'suggestions.aria': 'Déclencher les suggestions',
}
