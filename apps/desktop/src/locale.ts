/** Typed English, French, and Chinese copy owned by the Electron shell. */

export const en = {
  application: 'Application',
  startupFailed: 'DeepSeek Harness could not start',
  pluginsMenu: 'Desktop Plugins…',
  pluginsMenuPackagedOnly: 'Desktop Plugins… (available in packaged applications)',
  checkUpdatesMenu: 'Check for Updates…',
  updateCheckFailedTitle: 'Update Check Failed',
  unknownError: 'Unknown error',
  updateCheckTitle: 'Check for Updates',
  updateCurrent: 'You already have the latest version.',
  updateTitle: 'DeepSeek Harness Update',
  updateAvailable: 'An update is available',
  updateDetail:
    'DeepSeek Harness {version}\n\nThis release includes its matching dsh version. The application will restart after installation.',
  installAndRestart: 'Install and Restart',
  later: 'Later',
  updateFailedTitle: 'Update Failed',
  pluginManagerTitle: 'Desktop Plugins',
  pluginWindowTitle: 'DeepSeek Harness — Desktop Plugins',
  pluginManagerDescription:
    'Plugins are installed only in the Desktop node_modules and are managed by the bundled pnpm.',
  refresh: 'Refresh',
  npmPackage: 'npm package',
  install: 'Install',
  installed: 'Installed',
  noPlugins: 'No Desktop plugins are installed.',
  remove: 'Remove',
  update: 'Update',
  targetVersion: 'Enter the target version for {name}',
  removing: 'Removing {name}…',
  updating: 'Updating {name}…',
  installing: 'Installing {spec}…',
  operationComplete: 'Done. The Desktop backend has restarted.',
  refreshing: 'Refreshing…',
  refreshed: 'Plugin list refreshed.',
  loadingPlugins: 'Reading Desktop plugins…',
} as const

/** Every Desktop locale supplies the complete English key set. */
export type DesktopMessages = { readonly [Key in keyof typeof en]: string }

export const fr = {
  application: 'Application',
  startupFailed: 'DeepSeek Harness n’a pas pu démarrer',
  pluginsMenu: 'Plugins de bureau…',
  pluginsMenuPackagedOnly: 'Plugins de bureau… (disponible dans les applications empaquetées)',
  checkUpdatesMenu: 'Vérifier les mises à jour…',
  updateCheckFailedTitle: 'Échec de la vérification des mises à jour',
  unknownError: 'Erreur inconnue',
  updateCheckTitle: 'Vérifier les mises à jour',
  updateCurrent: 'Vous disposez déjà de la dernière version.',
  updateTitle: 'Mise à jour de DeepSeek Harness',
  updateAvailable: 'Une mise à jour est disponible',
  updateDetail:
    'DeepSeek Harness {version}\n\nCette version inclut sa version dsh correspondante. L’application redémarrera après l’installation.',
  installAndRestart: 'Installer et redémarrer',
  later: 'Plus tard',
  updateFailedTitle: 'Échec de la mise à jour',
  pluginManagerTitle: 'Plugins de bureau',
  pluginWindowTitle: 'DeepSeek Harness — Plugins de bureau',
  pluginManagerDescription:
    'Les plugins sont installés uniquement dans le node_modules du Bureau et sont gérés par le pnpm intégré.',
  refresh: 'Actualiser',
  npmPackage: 'paquet npm',
  install: 'Installer',
  installed: 'Installé',
  noPlugins: 'Aucun plugin de bureau installé.',
  remove: 'Retirer',
  update: 'Mettre à jour',
  targetVersion: 'Saisissez la version cible pour {name}',
  removing: 'Retrait de {name}…',
  updating: 'Mise à jour de {name}…',
  installing: 'Installation de {spec}…',
  operationComplete: 'Terminé. Le backend de bureau a redémarré.',
  refreshing: 'Actualisation en cours…',
  refreshed: 'Liste des plugins actualisée.',
  loadingPlugins: 'Lecture des plugins de bureau…',
} as const satisfies DesktopMessages

export const zh = {
  application: '应用',
  startupFailed: 'DeepSeek Harness 无法启动',
  pluginsMenu: '桌面插件…',
  pluginsMenuPackagedOnly: '桌面插件…（打包应用中可用）',
  checkUpdatesMenu: '检查更新…',
  updateCheckFailedTitle: '更新检查失败',
  unknownError: '未知错误',
  updateCheckTitle: '检查更新',
  updateCurrent: '当前已是最新版本。',
  updateTitle: 'DeepSeek Harness 更新',
  updateAvailable: '发现可用更新',
  updateDetail: 'DeepSeek Harness {version}\n\n新版本绑定匹配的 dsh，安装后将重新启动。',
  installAndRestart: '安装并重启',
  later: '稍后',
  updateFailedTitle: '更新失败',
  pluginManagerTitle: '桌面插件',
  pluginWindowTitle: 'DeepSeek Harness — 桌面插件',
  pluginManagerDescription: '插件只安装到桌面端自己的 node_modules，并由内置 pnpm 管理。',
  refresh: '刷新',
  npmPackage: 'npm 包',
  install: '安装',
  installed: '已安装',
  noPlugins: '还没有安装桌面插件。',
  remove: '移除',
  update: '更新',
  targetVersion: '输入 {name} 的目标版本',
  removing: '正在移除 {name}…',
  updating: '正在更新 {name}…',
  installing: '正在安装 {spec}…',
  operationComplete: '操作完成，桌面后端已重新启动。',
  refreshing: '正在刷新…',
  refreshed: '插件列表已刷新。',
  loadingPlugins: '正在读取桌面插件…',
} as const satisfies DesktopMessages

/** Locale payload exposed to the Desktop-owned renderer. */
export interface DesktopLocale {
  readonly id: 'en' | 'zh-CN' | 'fr'
  readonly messages: DesktopMessages
}

/** Resolve Electron's locale to one shipped Desktop dictionary. */
export function resolveDesktopLocale(locale: string): DesktopLocale {
  const tag = locale.toLowerCase()
  if (tag.startsWith('zh')) return { id: 'zh-CN', messages: zh }
  if (tag.startsWith('fr')) return { id: 'fr', messages: fr }
  return { id: 'en', messages: en }
}

/** Replace named placeholders in one locale-owned message. */
export function formatDesktopMessage(
  message: string,
  values: Readonly<Record<string, string>>,
): string {
  return message.replaceAll(
    /\{([^{}]+)\}/gu,
    (placeholder, key: string) => values[key] ?? placeholder,
  )
}
