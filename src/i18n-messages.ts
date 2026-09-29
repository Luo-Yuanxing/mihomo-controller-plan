/**
 * 后端用户可见消息的双语表：中文（默认）与英语。
 *
 * 只放会送到界面上的文本（API 的 error 字段、状态页里的错误行）；
 * 日志与代码注释一律中文，不进这里。
 */
export const ZH = {
  /** 跨模块复用的一句话。 */
  'common.unknownReason': '未知原因',

  // 内核托管（core/manager.ts）
  'core.binaryMissing': '未找到内核文件：{path}',
  'core.precheckFailed': '配置预检未通过：\n{output}',
  'core.exitedUnexpectedly': '内核进程意外退出，退出码 {code}',
  'core.exitedImmediately': '内核启动后立即退出，退出码 {code}',
  'core.notReady': '内核 {ms} ms 内未就绪。内核日志尾部：\n{tail}',
  'core.noOutput': '（无输出）',
  'core.watchExited': '内核进程已退出，退出码 {code}',

  // 内核 REST 客户端（core/api.ts）
  'coreApi.unreachable': '连不上内核 {base}（{reason}）',
  'coreApi.httpError': '{method} {path} 返回 {status}{body}',

  // 失败连接采样（logs/connection-sampler.ts）：内核日志里没有、只能由连接快照判定的两种失败
  'failed.blocked': '连接被阻断（无数据回程）',
  'failed.stalled': '连接无响应（建立后零回程）',

  // 规则（rules/render.ts、rules/repo.ts、rules/sync.ts）
  'rules.invalid': '规则 id={id} 不合法：{message}',
  'rules.unknownType': '未知类型 {type}',
  'rules.emptyPolicy': '目标策略为空',
  'rules.emptyValue': '匹配值为空',
  'rules.notFound': '规则不存在：id={id}',
  'rules.syncFailed': '规则已落盘但热更新失败：{error}',

  // 内核路径（util/paths.ts）
  'paths.binaryEmpty': '内核路径不能为空',
  'paths.binaryMissing': '内核文件不存在或不可读：{path}',
  'paths.binaryNotFile': '内核路径不是文件：{path}',

  // 单实例锁（util/lock.ts）
  'lock.alreadyRunning': '已有实例在运行（PID {pid}），锁文件：{file}',
  'lock.acquireFailed': '无法获取锁文件：{file}',

  // 订阅下载（sub/download.ts）
  'sub.urlMissing': '订阅 URL 未配置',
  'sub.downloadFailed': '订阅下载失败：HTTP {status}',
  'sub.notYaml': '订阅不是合法 YAML',
  'sub.noProxies': '订阅内容缺少 proxies / proxy-providers 字段',

  // 系统代理守护（proxy/guard.ts）
  'guard.notifyFailed': '注册表已写入，但通知系统刷新失败：{error}',
  'guard.rewriteFailed': '回写系统代理失败：{error}',
  'guard.shutdownNotifyFailed': '系统代理已关闭，但通知系统刷新失败：{error}',

  // 服务与静态资源（server.ts）
  'server.pathEscape': '越界路径',
  'server.uiMissing': '未找到前端产物，请先执行 npm run build',
  'server.badToken': '缺少或错误的 X-Api-Token',
  'server.subscriptionRestartFailed': '订阅已更新，但内核重启失败',

  // 界面常量校验（ui-config.ts）
  'uiConfig.root': '配置',
  'uiConfig.issue': '{path}：{message}',
  'uiConfig.issueSeparator': '；',
  'uiConfig.mustBeObject': '必须是对象',
  'uiConfig.mustBeJsonObject': '必须是 JSON 对象',
  'uiConfig.mustBeArray': '必须是数组',
  'uiConfig.mustBeStringArray': '必须是字符串数组',
  'uiConfig.notEmpty': '不能为空',
  'uiConfig.notEmptyString': '不能为空字符串',
  'uiConfig.mustBeString': '必须是字符串',
  'uiConfig.tooManyItems': '最多 {max} 项',
  'uiConfig.ruleTypePattern': '只能是大写字母、数字或连字符',
  'uiConfig.duplicate': '重复项：{value}',
  'uiConfig.policyShape': '必须是 { value, label } 对象',
  'uiConfig.policyValueEmpty': '策略值不能为空',
  'uiConfig.policyLabelEmpty': '显示名不能为空',
  'uiConfig.policyValueComma': '策略值不能包含逗号',
  'uiConfig.defaultRuleTypeEmpty': '默认规则类型不能为空',
  'uiConfig.defaultPolicyEmpty': '默认目标策略不能为空',
  'uiConfig.notInRuleTypes': '不在规则类型列表里：{value}',
  'uiConfig.notInPolicies': '不在目标策略列表里：{value}',
  'uiConfig.mustBeInteger': '必须是整数',
  'uiConfig.outOfRange': '需在 {min}-{max} 之间',
  'uiConfig.languageUnsupported': '只支持 zh 或 en',
  'uiConfig.fileInvalid': '配置文件字段不合法：{file}',
  'uiConfig.fileMissing': '配置文件不存在或不可读：{file}',
  'uiConfig.fileEmpty': '配置文件是空文件（需要至少含 ruleTypes 等字段）：{file}',
  'uiConfig.fileNotJson': '配置文件不是合法 JSON：{file}（{reason}）',

  // 配置分享串（ui-config-share.ts）
  'share.empty': '导入串不能为空',
  'share.notBase64Url': '不是合法的 Base64URL 字符串',
  'share.decodedEmpty': '导入串解出来是空的',
  'share.tooLarge': '导入串过大（上限 {bytes} 字节）',
  'share.notJson': '导入串解出来不是合法 JSON',

  // REST 接口（routes.ts）
  'routes.ruleTypeNotAllowed': '类型不在白名单：{types}',
  'routes.invalidParams': '请求参数不合法：{detail}',
  'routes.badId': 'id 不合法',
  'routes.recover.configRewritten': '已按当前设置重写 config.yaml',
  'routes.recover.configFailed': '重写配置失败：{error}',
  'routes.recover.kernelRunning': '内核已在运行',
  'routes.recover.kernelFailed': '内核启动失败：{error}',
  'routes.recover.kernelStarted': '内核已启动',
  'routes.recover.proxyPointed': '内核已就绪，系统代理已指向内核',
  'routes.recover.proxyDisabled': '内核不可用，已关闭系统代理以免整机断网',
  'routes.settingsRestartFailed': '设置已保存，但内核重启失败：{error}',
  'routes.shareBinaryMissing': '分享串里的内核路径在本机不存在（{path}），已保留本机当前路径',
  'routes.proxyGroupMissing': '代理组不存在：{group}',
  'routes.nodeNotInGroup': '节点不在代理组 {group} 中：{name}',
} as const;

/** 所有消息的 key 由中文表决定，英文表必须一条不漏。 */
export type MessageKey = keyof typeof ZH;

export const EN: Record<MessageKey, string> = {
  'common.unknownReason': 'unknown reason',

  'core.binaryMissing': 'Kernel binary not found: {path}',
  'core.precheckFailed': 'Config pre-check failed:\n{output}',
  'core.exitedUnexpectedly': 'Kernel process exited unexpectedly with code {code}',
  'core.exitedImmediately': 'Kernel exited right after start with code {code}',
  'core.notReady': 'Kernel was not ready within {ms} ms. Tail of the kernel log:\n{tail}',
  'core.noOutput': '(no output)',
  'core.watchExited': 'Kernel process has exited with code {code}',

  'coreApi.unreachable': 'Cannot reach the kernel at {base} ({reason})',
  'coreApi.httpError': '{method} {path} returned {status}{body}',
  'failed.blocked': 'Connection blocked (no data returned)',
  'failed.stalled': 'Connection unresponsive (established, zero bytes back)',

  'rules.invalid': 'Rule id={id} is invalid: {message}',
  'rules.unknownType': 'unknown type {type}',
  'rules.emptyPolicy': 'target policy is empty',
  'rules.emptyValue': 'match value is empty',
  'rules.notFound': 'Rule not found: id={id}',
  'rules.syncFailed': 'Rules were written but hot reload failed: {error}',

  'paths.binaryEmpty': 'Kernel path must not be empty',
  'paths.binaryMissing': 'Kernel file does not exist or is not readable: {path}',
  'paths.binaryNotFile': 'Kernel path is not a file: {path}',

  'lock.alreadyRunning': 'Another instance is running (PID {pid}), lock file: {file}',
  'lock.acquireFailed': 'Cannot acquire the lock file: {file}',

  'sub.urlMissing': 'Subscription URL is not configured',
  'sub.downloadFailed': 'Subscription download failed: HTTP {status}',
  'sub.notYaml': 'Subscription is not valid YAML',
  'sub.noProxies': 'Subscription has neither proxies nor proxy-providers',

  'guard.notifyFailed': 'Registry written, but notifying the system to refresh failed: {error}',
  'guard.rewriteFailed': 'Failed to rewrite the system proxy: {error}',
  'guard.shutdownNotifyFailed':
    'System proxy disabled, but notifying the system to refresh failed: {error}',

  'server.pathEscape': 'path escapes the UI directory',
  'server.uiMissing': 'UI build not found, run npm run build first',
  'server.badToken': 'Missing or wrong X-Api-Token',
  'server.subscriptionRestartFailed': 'Subscription updated, but the kernel failed to restart',

  'uiConfig.root': 'config',
  'uiConfig.issue': '{path}: {message}',
  'uiConfig.issueSeparator': '; ',
  'uiConfig.mustBeObject': 'must be an object',
  'uiConfig.mustBeJsonObject': 'must be a JSON object',
  'uiConfig.mustBeArray': 'must be an array',
  'uiConfig.mustBeStringArray': 'must be an array of strings',
  'uiConfig.notEmpty': 'must not be empty',
  'uiConfig.notEmptyString': 'must not be an empty string',
  'uiConfig.mustBeString': 'must be a string',
  'uiConfig.tooManyItems': 'at most {max} items',
  'uiConfig.ruleTypePattern': 'only uppercase letters, digits and hyphens',
  'uiConfig.duplicate': 'duplicate entry: {value}',
  'uiConfig.policyShape': 'must be a { value, label } object',
  'uiConfig.policyValueEmpty': 'policy value must not be empty',
  'uiConfig.policyLabelEmpty': 'display name must not be empty',
  'uiConfig.policyValueComma': 'policy value must not contain a comma',
  'uiConfig.defaultRuleTypeEmpty': 'default rule type must not be empty',
  'uiConfig.defaultPolicyEmpty': 'default target policy must not be empty',
  'uiConfig.notInRuleTypes': 'not in the rule type list: {value}',
  'uiConfig.notInPolicies': 'not in the target policy list: {value}',
  'uiConfig.mustBeInteger': 'must be an integer',
  'uiConfig.outOfRange': 'must be between {min} and {max}',
  'uiConfig.languageUnsupported': 'only zh or en is supported',
  'uiConfig.fileInvalid': 'Invalid fields in the config file: {file}',
  'uiConfig.fileMissing': 'Config file missing or unreadable: {file}',
  'uiConfig.fileEmpty': 'Config file is empty (it needs at least ruleTypes): {file}',
  'uiConfig.fileNotJson': 'Config file is not valid JSON: {file} ({reason})',

  'share.empty': 'The pasted string must not be empty',
  'share.notBase64Url': 'not a valid Base64URL string',
  'share.decodedEmpty': 'the pasted string decoded to nothing',
  'share.tooLarge': 'the pasted string is too large (limit {bytes} bytes)',
  'share.notJson': 'the pasted string did not decode to valid JSON',

  'routes.ruleTypeNotAllowed': 'type is not in the allow list: {types}',
  'routes.invalidParams': 'Invalid request parameters: {detail}',
  'routes.badId': 'invalid id',
  'routes.recover.configRewritten': 'config.yaml rewritten from the current settings',
  'routes.recover.configFailed': 'Rewriting the config failed: {error}',
  'routes.recover.kernelRunning': 'the kernel is already running',
  'routes.recover.kernelFailed': 'The kernel failed to start: {error}',
  'routes.recover.kernelStarted': 'the kernel has started',
  'routes.recover.proxyPointed': 'the kernel is ready, the system proxy now points to it',
  'routes.recover.proxyDisabled': 'the kernel is unavailable, the system proxy was disabled',
  'routes.settingsRestartFailed': 'Settings saved, but the kernel failed to restart: {error}',
  'routes.shareBinaryMissing':
    'The kernel path from the pasted string does not exist here ({path}); the local path was kept',
  'routes.proxyGroupMissing': 'Proxy group not found: {group}',
  'routes.nodeNotInGroup': 'Node is not in proxy group {group}: {name}',
};
