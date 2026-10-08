window.__ModuleLoader__.load({
  id: '@scitiger-ai/lwb-dsh-bundle',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');
    const { createPortal } = require('react-dom');
    const { IconSettingsOutlineRegular, IconNewChatOutlineRegular, IconCordisPluginOutlineRegular, IconChevronLeftOutlineRegular, IconPanelLeftOutlineRegular, ShortcutKeys } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const LOGO_PATH = '/lwb/branding/logo.png';
    function LwbBrandMark({ size = 30, className } = {}) {
      return h('img', { src: LOGO_PATH, alt: 'Laofu Workbench', className,
        width: size, height: size, style: { width: size, height: size, objectFit: 'contain', flex: 'none' } });
    }

    // Browsers expose crypto.randomUUID only in secure contexts. The workbench
    // also supports authenticated plain-HTTP LAN previews, where getRandomValues
    // remains available; install the missing method once before packs load.
    function installLanCryptoCompatibility() {
      const cryptoApi = globalThis.crypto;
      if (!cryptoApi || typeof cryptoApi.randomUUID === 'function' || typeof cryptoApi.getRandomValues !== 'function') return;
      const randomUUID = () => {
        const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      };
      try { Object.defineProperty(cryptoApi, 'randomUUID', { value: randomUUID, configurable: true, writable: true }); } catch (_) {}
    }
    installLanCryptoCompatibility();

    const STORAGE_KEY = 'lwb.workbench.v3';
    const NAV_STORAGE_KEY = 'lwb.nav.v1';
    const BASE_CONTRACT_VERSION = 9;
    let services;
    const PAYMENT_POLL_INTERVAL_MS = 2500;
    // The Host serves the Alipay form for ten minutes; the extra two minutes let a
    // payment that started just before that deadline still be observed.
    const PAYMENT_POLL_BUDGET_MS = 12 * 60 * 1000;
    const PAYMENT_SUCCESS_DISMISS_MS = 8000;
    const PAID_ORDER_STATUSES = new Set(['paid', 'success', 'succeeded']);
    const TERMINAL_ORDER_STATUSES = new Map([['cancelled', 'cancelled'], ['canceled', 'cancelled'], ['failed', 'failed'], ['expired', 'expired'], ['closed', 'expired'], ['refunded', 'expired'], ['timeout', 'timeout'], ['timed-out', 'timeout']]);

    // The ATS order projection owns the outcome: `terminal` decides whether polling
    // may stop and `shouldRefreshAccount` whether the account is read again. The
    // known status names remain the fallback for ATS builds that omit both fields,
    // so an unrecognised terminal order never keeps the banner polling forever.
    function readOrderStatus(result) {
      const status = String(result?.status || result?.orderStatus || '').toLowerCase();
      if (result?.paid === true || PAID_ORDER_STATUSES.has(status)) return { status: 'paid', terminal: true, refreshAccount: result?.shouldRefreshAccount !== false };
      if (result?.terminal === true || TERMINAL_ORDER_STATUSES.has(status)) return { status: TERMINAL_ORDER_STATUSES.get(status) || 'expired', terminal: true, refreshAccount: result?.shouldRefreshAccount === true };
      return { status: 'pending', terminal: false, refreshAccount: false };
    }

    const defaultState = {
      baseContractVersion: BASE_CONTRACT_VERSION,
      page: 'conversation',
      capabilityPage: null,
    };

    let productState = readState();
    const productListeners = new Set();
    let lwbAccountState = { phase: 'anonymous', user: null, membership: null, points: null, entitlements: null, catalog: null, serviceError: null, error: null };
    let lwbAccountGeneration = 0;
    const lwbAccountListeners = new Set();
    let lwbAccountRequest;
    let packAccountSnapshot;
    let dshAccountState = { phase: 'unavailable', status: 'signed-out', attempt: null, error: null };
    const dshAccountListeners = new Set();
    let dshAccountStreamDispose;

    function cloneDefaults() {
      return JSON.parse(JSON.stringify(defaultState));
    }
    function normalizeState(source) {
      const fallback = cloneDefaults();
      const input = source && typeof source === 'object' ? source : {};
      return Object.assign(fallback, {
        baseContractVersion: BASE_CONTRACT_VERSION,
        page: ['packs', 'settings', 'capability'].includes(input.page) ? input.page : fallback.page,
        capabilityPage: typeof input.capabilityPage === 'string' ? input.capabilityPage : null,
        stateUpdatedAt: Number.isFinite(input.stateUpdatedAt) ? input.stateUpdatedAt : undefined,
      });
    }
    function readState() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return normalizeState(saved);
      } catch (_) {
        return cloneDefaults();
      }
    }
    function persistedSnapshot(state) {
      return {
        baseContractVersion: BASE_CONTRACT_VERSION,
        stateUpdatedAt: Number.isFinite(state.stateUpdatedAt) ? state.stateUpdatedAt : Date.now(),
        // The browser remembers where the user was; the Workbench does not keep a
        // server-side route, so this snapshot is the only place it can live.
        page: ['packs', 'settings', 'capability'].includes(state.page) ? state.page : 'conversation',
        capabilityPage: typeof state.capabilityPage === 'string' ? state.capabilityPage : null,
      };
    }
    function persist(state) {
      const snapshot = persistedSnapshot(state);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch (_) {}
      return Promise.resolve();
    }
    /**
     * Grouped capability navigation is shell chrome, so it belongs to the
     * browser rather than to a Session: a reload must show the same open groups.
     * The pack catalog stays authoritative for which ids exist, and a missing
     * record (null) is distinct from an empty one — "no preference yet" keeps the
     * first-run reveal rules alive, while an empty set is the user's own answer.
     */
    function navStorage(storage) {
      if (storage) return storage;
      return typeof globalThis === 'undefined' ? undefined : globalThis.localStorage;
    }
    function readNavPreference(storage) {
      const target = navStorage(storage);
      if (!target) return null;
      try {
        const saved = JSON.parse(target.getItem(NAV_STORAGE_KEY) || 'null');
        if (!saved || typeof saved !== 'object' || !Array.isArray(saved.expandedPacks)) return null;
        const ids = new Set();
        for (const id of saved.expandedPacks) if (typeof id === 'string' && PACK_ID.test(id)) ids.add(id);
        return ids;
      } catch (_) {
        return null;
      }
    }
    function writeNavPreference(expanded, storage) {
      const target = navStorage(storage);
      if (!target) return;
      try {
        target.setItem(NAV_STORAGE_KEY, JSON.stringify({ expandedPacks: [...expanded].sort(), updatedAt: Date.now() }));
      } catch (_) {}
    }
    function notify(listeners) {
      listeners.forEach((listener) => listener());
    }
    function updateProduct(update, shouldPersist = true) {
      productState = typeof update === 'function' ? update(productState) : Object.assign({}, productState, update);
      if (shouldPersist) {
        productState = Object.assign({}, productState, { stateUpdatedAt: Date.now() });
        const commit = persist(productState);
        notify(productListeners);
        return commit;
      }
      notify(productListeners);
      return Promise.resolve();
    }
    function useProduct() {
      return React.useSyncExternalStore(
        (listener) => { productListeners.add(listener); return () => productListeners.delete(listener); },
        () => productState,
        () => productState,
      );
    }
    function setLwbAccountState(next) {
      lwbAccountState = Object.assign({}, lwbAccountState, next);
      lwbAccountListeners.forEach((listener) => listener());
      if (['authenticated', 'anonymous'].includes(lwbAccountState.phase)) {
        const snapshot = JSON.stringify([lwbAccountState.user?.id, lwbAccountState.membership, lwbAccountState.entitlements]);
        if (snapshot !== packAccountSnapshot) {
          packAccountSnapshot = snapshot;
          void refreshPackCatalog({ retain: true }).catch(() => {});
        }
      }
    }
    function useLwbAccount() {
      return React.useSyncExternalStore(
        (listener) => { lwbAccountListeners.add(listener); return () => lwbAccountListeners.delete(listener); },
        () => lwbAccountState,
        () => lwbAccountState,
      );
    }
    async function lwbAccountRpc(method, args = {}) {
      if (!services?.connection?.rpc?.call) throw new Error('DSH 连接尚未就绪。');
      const response = await services.connection.rpc.call('/api', `lwbAccount/${method}`, { args });
      if (!response?.ok) {
        const error = new Error(response?.error?.message || 'LWB 账号操作未完成。');
        Object.assign(error, response?.error || {});
        throw error;
      }
      return response.value;
    }
    async function refreshLwbAccount(options) {
      if (lwbAccountRequest) {
        if (options?.force !== true) return lwbAccountRequest;
        // A settled payment must be read after it settled. Waiting out an in-flight
        // read keeps that request from being reported as the post-payment snapshot.
        try { await lwbAccountRequest; } catch (_) {}
      }
      const generation = lwbAccountGeneration;
      if (!lwbAccountState.user && lwbAccountState.phase !== 'anonymous') setLwbAccountState({ phase: 'loading', error: null });
      const request = lwbAccountRpc('status').then((value) => {
        if (generation !== lwbAccountGeneration) return null;
        setLwbAccountState({ phase: 'authenticated', user: value?.user || null, membership: value?.membership || null, points: value?.points || null, entitlements: value?.entitlements || null, catalog: value?.catalog || null, serviceError: value?.serviceError || null, error: null });
        return value;
      }).catch((error) => {
        if (generation !== lwbAccountGeneration) return null;
        if (['LWB_ATS_NOT_AUTHENTICATED', 'LWB_ATS_UNAUTHORIZED'].includes(error?.code) || /尚未登录|请先登录|not authenticated|log in/i.test(error?.message || '')) {
          setLwbAccountState({ phase: 'anonymous', user: null, membership: null, points: null, entitlements: null, catalog: null, serviceError: null, error: null });
          return null;
        }
        setLwbAccountState({ phase: 'error', error: error?.message || 'LWB 账号状态读取失败。' });
        return null;
      }).finally(() => { if (lwbAccountRequest === request) lwbAccountRequest = undefined; });
      lwbAccountRequest = request;
      return request;
    }
    async function lwbAccountAction(method, request) {
      lwbAccountGeneration += 1; lwbAccountRequest = undefined;
      setLwbAccountState({ phase: 'loading', error: null });
      try {
        const value = await lwbAccountRpc(method, request ? { request } : {});
        if (method === 'logout') {
          setLwbAccountState({ phase: 'anonymous', user: null, membership: null, points: null, entitlements: null, catalog: null, serviceError: null, error: null });
        } else {
          await refreshLwbAccount();
        }
        return value;
      } catch (error) {
        setLwbAccountState({ phase: 'error', error: error?.message || 'LWB 账号操作未完成。' });
        throw error;
      }
    }
    function setDshAccountState(next) {
      dshAccountState = Object.assign({}, dshAccountState, next);
      dshAccountListeners.forEach((listener) => listener());
    }
    function useDshAccount() {
      return React.useSyncExternalStore(
        (listener) => { dshAccountListeners.add(listener); return () => dshAccountListeners.delete(listener); },
        () => dshAccountState,
        () => dshAccountState,
      );
    }
    function dshAccountRemote() {
      return services?.remote?.account;
    }
    function dshClientMetadata() {
      const locale = services?.locale?.getSnapshot?.()?.active || 'zh';
      const version = globalThis.__DSH_CLIENT_VERSION__ || globalThis.__DSH_TRANSPORT__?.clientVersion || '0.2.0-rc.2';
      return { version, locale, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 };
    }
    function dshCallbackOrigin() {
      const streamBaseUrl = globalThis.__DSH_TRANSPORT__?.streamBaseUrl;
      try { return streamBaseUrl ? new URL(streamBaseUrl).origin : window.location.origin; } catch (_) { return window.location.origin; }
    }
    function applyDshAccountView(view) {
      if (!view || typeof view !== 'object') return;
      const status = view.status === 'credential-stored' ? 'credential-stored' : 'signed-out';
      const attempt = view.attempt || null;
      const attemptPhase = attempt?.phase;
      const signingIn = ['initializing', 'waiting-browser', 'exchanging', 'committing'].includes(attemptPhase);
      setDshAccountState({
        phase: signingIn ? 'signing-in' : status === 'credential-stored' ? 'authenticated' : 'available',
        status,
        attempt,
        error: null,
      });
    }
    function startDshAccountStream() {
      const remote = services?.remote;
      const account = remote?.account;
      if (!account?.watch) {
        setDshAccountState({ phase: 'unavailable', status: 'signed-out', attempt: null, error: null });
        return () => {};
      }
      let disposed = false;
      let controller;
      let stream;
      try {
        if (typeof remote.$stream === 'function') {
          stream = remote.$stream({ name: 'lwb-dsh-account', open: (signal) => account.watch(signal), ended: () => new Error('DSH account stream ended') });
        } else {
          controller = new AbortController();
          stream = account.watch(controller.signal);
        }
      } catch (error) {
        setDshAccountState({ phase: 'error', error: error?.message || 'DSH 账号状态暂时不可用。' });
        return () => {};
      }
      dshAccountStreamDispose = () => {
        if (disposed) return;
        disposed = true;
        try { stream?.dispose?.(); } catch (_) {}
        try { controller?.abort(); } catch (_) {}
        if (dshAccountStreamDispose) dshAccountStreamDispose = undefined;
      };
      void (async () => {
        try {
          for await (const frame of stream) {
            if (disposed) break;
            applyDshAccountView(frame?.value || frame);
            try { frame?.accept?.(); } catch (_) {}
          }
        } catch (error) {
          if (!disposed) setDshAccountState({ phase: 'error', error: error?.message || 'DSH 账号状态暂时不可用。' });
        }
      })();
      return dshAccountStreamDispose;
    }
    async function startDshSignIn() {
      const account = dshAccountRemote();
      if (!account?.startSignIn) {
        setDshAccountState({ phase: 'unavailable', error: 'DSH 账号服务暂不可用。' });
        return;
      }
      setDshAccountState({ phase: 'signing-in', error: null });
      try {
        const result = await account.startSignIn(dshClientMetadata(), dshCallbackOrigin(), 'desktop');
        if (!result?.ok) throw Object.assign(new Error(result?.error?.message || 'DSH 登录失败。'), result?.error || {});
        applyDshAccountView(result.value);
      } catch (error) {
        setDshAccountState({ phase: 'error', error: error?.message || 'DSH 登录失败，请重试。' });
      }
    }
    async function signOutDsh() {
      const account = dshAccountRemote();
      if (!account?.signOut) {
        setDshAccountState({ phase: 'unavailable', error: 'DSH 账号服务暂不可用。' });
        return;
      }
      try {
        if (account.hasRunningAccountTasks) {
          const result = await account.hasRunningAccountTasks();
          if (result?.ok === false) throw result.error || new Error('DSH 运行任务状态查询失败。');
          const running = result?.ok === true ? result.value : Boolean(result);
          if (running) {
            const message = currentLwbCopy().dshSignOutConfirm;
            if (!window.confirm(message)) return;
          }
        }
        setDshAccountState({ phase: 'signing-out', error: null });
        const result = await account.signOut(dshClientMetadata());
        if (!result?.ok) throw Object.assign(new Error(result?.error?.message || 'DSH 退出失败。'), result?.error || {});
        applyDshAccountView(result.value);
      } catch (error) {
        setDshAccountState({ phase: 'error', error: error?.message || 'DSH 退出失败，请稍后重试。' });
      }
    }
    function useObservable(observable, fallback) {
      return React.useSyncExternalStore(
        (listener) => observable?.subscribe ? observable.subscribe(listener) : () => {},
        () => observable?.getSnapshot ? observable.getSnapshot() : fallback,
        () => fallback,
      );
    }

    const LWB_COPY = {
      zh: {
        conversation: '对话', packs: '场景能力包', settings: '设置', capability: '能力包页面',
        packsHint: '可组合的场景能力包', settingsHint: '工作台的系统配置与偏好', capabilityHint: '已加载能力包的页面入口',
        workbench: '工作台', workbenchFeatures: '工作台功能', loadedPacks: '已加载能力包', localWorkbench: '本机单用户工作台',
        collapseSidebar: '收起侧栏', expandSidebar: '展开侧栏', closeNavigation: '关闭导航', openNavigation: '打开导航', openConversationList: '打开会话列表',
        expandPack: (name) => `展开${name}`, collapsePack: (name) => `收起${name}`,
        conversationModule: '对话模块', conversationHistory: '会话历史', closeConversationList: '关闭会话列表',
        session: '会话', newSession: '新会话', newSessionLabel: '新建会话', conversationPanels: '官方功能', readingWorkspaces: '正在读取工作区', searchConversations: '搜索对话…',
        searchResults: '搜索结果', workspaces: '工作区', addWorkspace: '添加工作区', loadingWorkspaces: '正在读取 DSH 工作区…',
        noWorkspaces: '尚未添加工作区。', unassignedSessions: '未归属会话', archivedSessions: '已归档会话',
        noArchivedSessions: '暂无已归档会话。', noMatchingSessions: '没有匹配的会话。', noSessionsInWorkspace: '该工作区暂无会话。',
        unnamedWorkspace: '未命名工作区', unnamedConversation: '未命名对话', unnamedFile: '未命名文件', count: (count) => `${count} 个`,
        workspaceAction: (title) => `工作区操作：${title}`, sessionAction: (title) => `会话操作：${title}`,
        newConversationInWorkspace: (title) => `在 ${title} 中新建对话`,
        restoreSession: '恢复会话', restoreToWorkspace: (title) => `恢复到工作区「${title}」`,
        rename: '重命名', forkConversation: '分叉会话', assignWorkspace: (title) => `加入工作区「${title}」`, archiveConversation: '归档会话', deleteWorkspace: '删除工作区',
        dialogNameRequired: '名称不能为空。', dialogProcessing: '正在处理…', close: '关闭', name: '名称', cancel: '取消',
        renameWorkspace: '重命名工作区', renameWorkspaceCopy: '名称只会更新此工作区在对话列表中的显示。', saveName: '保存名称',
        deleteWorkspaceCopy: (title) => `确定删除工作区「${title}」吗？该工作区内的会话、日志和目录都会保留，并显示为未归属会话。`,
        renameConversation: '重命名对话', renameConversationCopy: '名称将同步到 DSH 会话历史。',
        archiveConversationCopy: (title) => `确定归档对话「${title}」吗？归档后会从常规历史中隐藏，但对话内容会保留。`,
        createConversationFailed: '无法创建对话', addWorkspaceFailed: '无法添加工作区', operationFailed: '操作未完成，请稍后重试。',
        sessionAddedToWorkspace: (title) => `已将会话加入工作区「${title}」。`, sessionRestoredToWorkspace: (title) => `已将会话恢复到工作区「${title}」。`, sessionRestoredUnassigned: '已恢复会话；原工作区已不存在，因此会话显示为未归属会话。',
        active: '已加载', mounted: '已挂载', stopped: '已停用', installed: '已安装', available: '可加载', unavailable: '不可用',
        installedTab: '已安装', loadedTab: '已加载', market: '能力市场', updates: '可更新', availableLater: '后续版本开放',
        disable: '停用', reload: '重新加载', load: '加载', unload: '卸载', openMenu: '打开菜单', details: '详情', migrate: '迁移', accept: '验收',
        packFeatures: '包含哪些能力', packGettingStarted: '开始使用前', packJourney: '创作路径', packDataManagement: '数据管理', packLoadAction: '加载能力包', packStartAction: '开始使用', packLoadHint: '加载后，功能入口将出现在左侧导航。', packReadyHint: '能力包已加载，可以开始创作。', packManageHint: '卸载能力包后可管理业务数据与工作区。',
        packType: '场景能力包', noLoadedPacks: '暂无已加载能力包', noInstalledPacks: '尚未安装场景能力包',
        packsEmptyCopy: '尚未发现可加载的场景能力包。可通过通用安装命令注册任意独立能力包。', loadingPacks: '正在读取能力包市场…', packCatalogFailed: '无法读取能力包市场。',
        packDetails: (name) => `${name} 详情`, currentStatus: '当前状态', menuCount: '菜单数量', packDescription: '能力包说明', registeredMenus: '加载后菜单', firstPhaseEmpty: '第一期空态',
        marketSearch: '搜索能力包、标签或功能…', filterAll: '全部', filterLoaded: '已加载', filterAvailable: '可加载', filterCategory: '分类', noMatchingPacks: '没有匹配的能力包。', packWorkflow: '功能流程', packTags: '标签', packOrigin: '来源', loadingPack: '正在加载…', unloadingPack: '正在卸载…', packLoaded: '能力包已加载。', packUnloaded: '能力包已卸载。', workspacePack: '工作区包', localPack: '本地包', unavailablePack: '能力包源不可用，无法加载。',
        noCapability: '能力包尚未加载', noCapabilityCopy: '请在“场景能力包”中安装并加载领域能力包。', goToPacks: '前往能力包',
        capabilityPageCopy: (name) => `“${name}”没有提供此菜单对应的浏览器页面。`, clientUnavailable: '能力包客户端页面不可用',
        capabilityPageFailed: '能力包页面暂时不可用', capabilityPageFailedCopy: '该页面未能正常渲染。工作台导航仍可用，可返回对话或打开场景能力包。',
        returnToConversation: '返回对话', viewPacks: '查看能力包',
        about: '关于', runtime: '运行方式', runtimeHint: '基于 DeepSeek Harness（DSH）构建的本机单用户工作台。', connected: '已连接', connecting: '连接中', disconnected: '连接已断开', basicConfiguration: '基础配置', basicConfigurationHint: '进入 DSH 原生设置，并管理 DSH 账号。', systemSettings: 'DSH 系统设置', systemSettingsHint: '配置 DSH 的语言、外观、模型服务、权限、插件及 Agent 预设。', openRuntimeSettings: '打开设置', dshSignIn: '登录 DSH', dshSigningIn: '正在登录 DSH…', dshSignOut: '退出 DSH', dshSigningOut: '正在退出 DSH…', dshSignOutConfirm: '退出 DSH 登录吗？如果当前有使用 DSH 账号的任务，退出可能会中断这些任务。', dshSignInFailed: '登录 DSH 失败，请重试。', dshSignOutFailed: '退出 DSH 失败，请稍后重试。', dshAccountUnavailable: 'DSH 账号服务暂不可用。', accountReturnHint: '你正在为场景页面配置 LWB 账号，配置完成后可以返回继续。', accountReturn: '← 返回场景页面（保留草稿）',
        lwbAccount: 'LWB 账号', lwbAccountHint: '管理 LWB 服务账号、会员权益和可用积分。', lwbAccountNote: '不登录 LWB 账号也可以正常使用工作台：对话、DSH 系统设置以及自带凭据（BYOK）都不需要登录。LWB 账号主要用于加载部分场景能力包，以及使用这些能力包对应的语音服务和图片服务。', lwbLogin: '登录', lwbRegister: '注册', lwbLogout: '退出登录', lwbEmail: '账号或邮箱', lwbPassword: '密码', lwbConfirmPassword: '确认密码', lwbActivationCode: '激活码（可选）', lwbNotLoggedIn: '尚未登录 LWB 账号。', lwbAccountLoading: '正在读取账号状态…', lwbAccountFailed: '账号状态暂时不可用。', lwbLoginSuccess: '登录成功。', lwbRegisterSuccess: '注册成功。', lwbMembership: '会员套餐', lwbPoints: '可用积分', lwbFrozenPoints: '冻结积分', lwbNoMembership: '免费版', lwbPacksHint: '可在「场景能力包」中查看和管理当前可用的场景能力包。', lwbSwitchToRegister: '注册新账号', lwbSwitchToLogin: '已有账号，去登录', lwbSubmit: '提交', lwbPurchase: '购买积分与会员', lwbPurchaseHint: '选择套餐后打开支付宝收银台，支付成功后自动同步账户状态。', lwbRefreshPackages: '刷新套餐', lwbRechargePackages: '积分包', lwbMembershipPlans: '会员套餐', lwbNoPackages: '暂无可购买套餐。', lwbLoginToPurchase: '登录 LWB 账号后可查看和购买套餐。', lwbPointsAmount: '到账积分', lwbBonusPoints: '赠送积分', lwbMonthlyPoints: '每月赠送', lwbMonthlyPrice: '月费', lwbPriceDiscount: '模型折扣', lwbRpmLimit: '请求限制', lwbMaxApiKeys: 'API Key 数量', lwbCurrentPlan: '当前套餐', lwbPayAlipay: '支付宝支付', lwbOpenPayment: '打开收银台', lwbCheckPayment: '检查支付状态', lwbClearOrder: '清除订单', lwbFinishOrder: '完成', lwbCreatingOrder: '创建订单中…', lwbOrderCreated: (orderNo) => `订单 ${orderNo} 已创建，支付成功后将自动同步积分和会员状态。`, lwbOrderCreatedBlocked: (orderNo) => `订单 ${orderNo} 已创建，但收银台未打开，请重新打开。`, lwbOrderPending: '订单待支付，到账后将自动同步。', lwbPaymentSuccess: '支付成功，积分和会员状态已同步。', lwbPaymentCancelled: '订单已取消，未扣款。', lwbPaymentFailed: '订单支付失败，请重新创建订单。', lwbPaymentExpired: '订单已结束，请刷新账户确认到账状态。', lwbPaymentTimeout: '支付状态查询已超时，请稍后刷新账户状态。', lwbPackageLoadFailed: '套餐信息暂时不可用。',
        packsIntro: '基础版暂未预装场景能力包；加载后的能力包会实时注入左侧菜单。', settingsIntro: '管理工作台的系统配置与偏好。', capabilityIntro: '已加载能力包的页面入口。',
      },
      en: {
        conversation: 'Conversation', packs: 'Capability Packs', settings: 'Settings', capability: 'Capability Page',
        packsHint: 'Composable capability packs', settingsHint: 'Workbench system configuration and preferences', capabilityHint: 'Entry point for the loaded capability pack',
        workbench: 'WORKBENCH', workbenchFeatures: 'Workbench features', loadedPacks: 'Loaded capability packs', localWorkbench: 'Local single-user workbench',
        collapseSidebar: 'Collapse sidebar', expandSidebar: 'Expand sidebar', closeNavigation: 'Close navigation', openNavigation: 'Open navigation', openConversationList: 'Open conversation list',
        expandPack: (name) => `Expand ${name}`, collapsePack: (name) => `Collapse ${name}`,
        conversationModule: 'Conversation module', conversationHistory: 'Conversation history', closeConversationList: 'Close conversation list',
        session: 'Sessions', newSession: 'New session', newSessionLabel: 'New session', conversationPanels: 'Official panels', readingWorkspaces: 'Loading workspaces', searchConversations: 'Search conversations...',
        searchResults: 'Search results', workspaces: 'Workspaces', addWorkspace: 'Add workspace', loadingWorkspaces: 'Loading DSH workspaces...',
        noWorkspaces: 'No workspaces added yet.', unassignedSessions: 'Unassigned sessions', archivedSessions: 'Archived sessions',
        noArchivedSessions: 'No archived sessions.', noMatchingSessions: 'No matching sessions.', noSessionsInWorkspace: 'No sessions in this workspace.',
        unnamedWorkspace: 'Untitled workspace', unnamedConversation: 'Untitled conversation', unnamedFile: 'Untitled file', count: (count) => `${count}`,
        workspaceAction: (title) => `Workspace actions: ${title}`, sessionAction: (title) => `Conversation actions: ${title}`,
        newConversationInWorkspace: (title) => `New conversation in ${title}`,
        restoreSession: 'Restore conversation', restoreToWorkspace: (title) => `Restore to ${title}`,
        rename: 'Rename', forkConversation: 'Fork conversation', assignWorkspace: (title) => `Add to ${title}`, archiveConversation: 'Archive conversation', deleteWorkspace: 'Delete workspace',
        dialogNameRequired: 'Name is required.', dialogProcessing: 'Processing...', close: 'Close', name: 'Name', cancel: 'Cancel',
        renameWorkspace: 'Rename workspace', renameWorkspaceCopy: 'This changes only the workspace name shown in the conversation list.', saveName: 'Save name',
        deleteWorkspaceCopy: (title) => `Delete ${title}? Its sessions, logs, and directory will remain and appear as unassigned conversations.`,
        renameConversation: 'Rename conversation', renameConversationCopy: 'The new name will be synced to DSH conversation history.',
        archiveConversationCopy: (title) => `Archive ${title}? It will be hidden from the regular history, while its conversation content is retained.`,
        createConversationFailed: 'Unable to create conversation', addWorkspaceFailed: 'Unable to add workspace', operationFailed: 'The operation could not be completed. Please try again.',
        sessionAddedToWorkspace: (title) => `Added conversation to ${title}.`, sessionRestoredToWorkspace: (title) => `Restored conversation to ${title}.`, sessionRestoredUnassigned: 'The conversation was restored, but its original workspace no longer exists, so it is shown as unassigned.',
        active: 'Loaded', mounted: 'Mounted', stopped: 'Stopped', installed: 'Installed', available: 'Available', unavailable: 'Unavailable',
        installedTab: 'Installed', loadedTab: 'Loaded', market: 'Marketplace', updates: 'Updates', availableLater: 'Available in a later release',
        disable: 'Disable', reload: 'Reload', load: 'Load', unload: 'Unload', openMenu: 'Open menu', details: 'Details', migrate: 'Migrate', accept: 'Accept',
        packFeatures: 'Included capabilities', packGettingStarted: 'Before you start', packJourney: 'Workflow', packDataManagement: 'Data management', packLoadAction: 'Load capability pack', packStartAction: 'Start using', packLoadHint: 'Loading adds these features to the sidebar.', packReadyHint: 'The pack is loaded and ready to open.', packManageHint: 'Unload the pack to manage its data and workspace.',
        packType: 'Capability pack', noLoadedPacks: 'No capability packs loaded', noInstalledPacks: 'No capability packs installed',
        packsEmptyCopy: 'No loadable scenario capability pack was discovered. Register any standalone pack with the generic installer.', loadingPacks: 'Loading capability marketplace...', packCatalogFailed: 'Unable to load capability marketplace.',
        packDetails: (name) => `${name} details`, currentStatus: 'Current status', menuCount: 'Menu items', packDescription: 'Capability pack description', registeredMenus: 'Menus after loading', firstPhaseEmpty: 'First-release placeholder',
        marketSearch: 'Search packs, tags, or functions...', filterAll: 'All', filterLoaded: 'Loaded', filterAvailable: 'Available', filterCategory: 'Category', noMatchingPacks: 'No matching capability packs.', packWorkflow: 'Workflow', packTags: 'Tags', packOrigin: 'Source', loadingPack: 'Loading...', unloadingPack: 'Unloading...', packLoaded: 'Capability pack loaded.', packUnloaded: 'Capability pack unloaded.', workspacePack: 'Workspace pack', localPack: 'Local pack', unavailablePack: 'The package source is unavailable and cannot be loaded.',
        noCapability: 'No capability pack loaded', noCapabilityCopy: 'Install and load a domain capability pack from Capability Packs.', goToPacks: 'Go to capability packs',
        capabilityPageCopy: (name) => `${name} does not provide a browser page for this menu.`, clientUnavailable: 'Capability pack client page is unavailable',
        capabilityPageFailed: 'Capability page is temporarily unavailable', capabilityPageFailedCopy: 'This page could not render. Workbench navigation remains available, so you can return to the conversation or open capability packs.',
        returnToConversation: 'Back to conversation', viewPacks: 'View capability packs',
        about: 'ABOUT', runtime: 'Runtime', runtimeHint: 'A local single-user workbench built on DeepSeek Harness (DSH).', connected: 'Connected', connecting: 'Connecting', disconnected: 'Disconnected', basicConfiguration: 'BASIC CONFIGURATION', basicConfigurationHint: 'Open native DSH settings and manage the DSH account.', systemSettings: 'DSH system settings', systemSettingsHint: 'Configure DSH language, appearance, model providers, permissions, plugins, and agent presets.', openRuntimeSettings: 'Open settings', dshSignIn: 'Sign in to DSH', dshSigningIn: 'Signing in to DSH...', dshSignOut: 'Sign out of DSH', dshSigningOut: 'Signing out of DSH...', dshSignOutConfirm: 'Sign out of DSH? Running tasks that use the DSH account may be interrupted.', dshSignInFailed: 'DSH sign-in failed. Please try again.', dshSignOutFailed: 'DSH sign-out failed. Please try again later.', dshAccountUnavailable: 'The DSH account service is unavailable.', accountReturnHint: 'You are setting up the LWB account for a scene page. Return to it when you are done.', accountReturn: '← Back to the scene page (draft kept)',
        lwbAccount: 'LWB account', lwbAccountHint: 'Manage the LWB service account, membership, and available points.', lwbAccountNote: 'The Workbench works without an LWB account: conversations, DSH system settings, and bring-your-own-credential (BYOK) paths never require signing in. The LWB account mainly loads some capability packs and enables the voice and image services those packs use.', lwbLogin: 'Sign in', lwbRegister: 'Register', lwbLogout: 'Sign out', lwbEmail: 'Account or email', lwbPassword: 'Password', lwbConfirmPassword: 'Confirm password', lwbActivationCode: 'Activation code (optional)', lwbNotLoggedIn: 'No LWB account is signed in.', lwbAccountLoading: 'Loading account status...', lwbAccountFailed: 'Account status is temporarily unavailable.', lwbLoginSuccess: 'Signed in successfully.', lwbRegisterSuccess: 'Account created successfully.', lwbMembership: 'Membership', lwbPoints: 'Available points', lwbFrozenPoints: 'Frozen points', lwbNoMembership: 'Free', lwbPacksHint: 'View and manage available packs in Capability Packs.', lwbSwitchToRegister: 'Create an account', lwbSwitchToLogin: 'Already have an account? Sign in', lwbSubmit: 'Submit', lwbPurchase: 'Buy points and membership', lwbPurchaseHint: 'Choose a plan to open the Alipay checkout. Account status syncs after payment.', lwbRefreshPackages: 'Refresh plans', lwbRechargePackages: 'Point packages', lwbMembershipPlans: 'Membership plans', lwbNoPackages: 'No plans are available.', lwbLoginToPurchase: 'Sign in to view and buy plans.', lwbPointsAmount: 'Points', lwbBonusPoints: 'Bonus points', lwbMonthlyPoints: 'Monthly points', lwbMonthlyPrice: 'Monthly price', lwbPriceDiscount: 'Model discount', lwbRpmLimit: 'Request limit', lwbMaxApiKeys: 'API keys', lwbCurrentPlan: 'Current plan', lwbPayAlipay: 'Pay with Alipay', lwbOpenPayment: 'Open checkout', lwbCheckPayment: 'Check payment', lwbClearOrder: 'Clear order', lwbFinishOrder: 'Done', lwbCreatingOrder: 'Creating order...', lwbOrderCreated: (orderNo) => `Order ${orderNo} created. Points and membership will sync after payment.`, lwbOrderCreatedBlocked: (orderNo) => `Order ${orderNo} created, but checkout did not open. Reopen it below.`, lwbOrderPending: 'Order is pending. Account will sync after payment.', lwbPaymentSuccess: 'Payment succeeded. Points and membership are synced.', lwbPaymentCancelled: 'Order cancelled. No charge was made.', lwbPaymentFailed: 'Payment failed. Create a new order and try again.', lwbPaymentExpired: 'Order ended. Refresh the account to confirm the result.', lwbPaymentTimeout: 'Payment status polling timed out. Refresh the account later.', lwbPackageLoadFailed: 'Plans are temporarily unavailable.',
        packsIntro: 'The base release has no scenario capability packs preinstalled; loaded packs will appear in the left menu.', settingsIntro: 'Manage the workbench’s system configuration and preferences.', capabilityIntro: 'Entry point for the loaded capability pack.',
      },
    };
    function useLwbCopy() {
      const locale = useObservable(services?.locale, { active: 'zh' });
      return locale.active === 'en' ? LWB_COPY.en : LWB_COPY.zh;
    }
    function currentLwbCopy() {
      return services?.locale?.getSnapshot?.()?.active === 'en' ? LWB_COPY.en : LWB_COPY.zh;
    }

    const PACK_ID = /^[a-z][a-z0-9-]{1,62}$/;
    const PACK_MENU_ID = /^[a-z][a-z0-9-]{0,62}$/;
    let packCatalog = { phase: 'pending', packs: [], error: null };
    let packVisibility = null;
    const packCatalogListeners = new Set();
    let packMarket = { phase: 'pending', packs: [], error: null };
    let packCatalogGeneration = 0;
    const packMarketListeners = new Set();
    let lwbPackClient;
    let lwbPackClientRuntime;

    function capabilityRoute(packId, menuId) { return `${packId}:${menuId}`; }
    function capabilityAtRoute(packs, route) {
      if (typeof route !== 'string') return undefined;
      const separator = route.indexOf(':');
      if (separator < 1) return undefined;
      const packId = route.slice(0, separator);
      const menuId = route.slice(separator + 1);
      const pack = packs.find((candidate) => candidate.id === packId);
      const menu = pack?.menus.find((candidate) => candidate.id === menuId);
      return pack && menu ? { pack, menu } : undefined;
    }
    function normalizePackText(value, fallback, maxLength) {
      if (typeof value !== 'string') return fallback;
      const normalized = value.trim();
      return normalized && normalized.length <= maxLength ? normalized : fallback;
    }
    function normalizePackCatalog(value) {
      if (!value || typeof value !== 'object' || !Array.isArray(value.packs)) throw new Error('能力包目录返回了无效的数据。');
      const ids = new Set();
      const packs = value.packs.map((candidate) => {
        if (!candidate || typeof candidate !== 'object') throw new Error('能力包目录包含无效条目。');
        const id = normalizePackText(candidate.id, '', 63);
        if (!PACK_ID.test(id) || ids.has(id)) throw new Error('能力包目录包含重复或无效标识。');
        ids.add(id);
        const menuIds = new Set();
        if (!Array.isArray(candidate.menus) || candidate.menus.length === 0) throw new Error('能力包目录缺少菜单。');
        const menus = candidate.menus.map((menu) => {
          const menuId = normalizePackText(menu?.id, '', 63);
          if (!PACK_MENU_ID.test(menuId) || menuIds.has(menuId)) throw new Error('能力包目录包含重复或无效菜单。');
          menuIds.add(menuId);
          return {
            id: menuId,
            label: normalizePackText(menu.label, menuId, 80),
            glyph: normalizePackText(menu.glyph, '▦', 8),
            tone: ['blue', 'green', 'orange', 'pink', 'red', 'violet'].includes(menu.tone) ? menu.tone : 'blue',
          };
        });
        return {
          id,
          packageName: normalizePackText(candidate.packageName, '', 214),
          name: normalizePackText(candidate.name, id, 120),
          version: normalizePackText(candidate.version, '0.0.0', 64),
          description: normalizePackText(candidate.description, '', 500),
          menus,
          status: 'loaded',
        };
      });
      return { phase: 'ready', packs, error: null, visibility: packVisibility };
    }
    function setPackCatalog(next) {
      packCatalog = Object.assign({}, next, { visibility: packVisibility });
      packCatalogListeners.forEach((listener) => listener());
    }
    function usePackCatalog() {
      return React.useSyncExternalStore(
        (listener) => { packCatalogListeners.add(listener); return () => packCatalogListeners.delete(listener); },
        () => packCatalog,
        () => packCatalog,
      );
    }
    function setPackMarket(next) {
      packMarket = next;
      packMarketListeners.forEach((listener) => listener());
    }
    function usePackMarket() {
      return React.useSyncExternalStore(
        (listener) => { packMarketListeners.add(listener); return () => packMarketListeners.delete(listener); },
        () => packMarket,
        () => packMarket,
      );
    }
    function normalizePackMarket(value) {
      const base = normalizePackCatalog(value);
      const packs = base.packs.map((pack, index) => {
        const candidate = value.packs[index] || {};
        const status = ['loaded', 'available', 'unavailable'].includes(candidate.status) ? candidate.status : 'available';
        const market = candidate.market && typeof candidate.market === 'object' && !Array.isArray(candidate.market) ? candidate.market : {};
        const tags = Array.isArray(market.tags) ? market.tags.map((tag) => normalizePackText(tag, '', 32)).filter(Boolean).slice(0, 8) : [];
        const workflow = Array.isArray(market.workflow) ? market.workflow.map((step) => normalizePackText(step, '', 80)).filter(Boolean).slice(0, 16) : [];
        return Object.assign(pack, {
          status,
          origin: ['workspace', 'local'].includes(candidate.origin) ? candidate.origin : 'workspace',
          category: normalizePackText(market.category, '通用', 48),
          tags,
          workflow,
          introduction: normalizePackText(market.introduction, pack.description, 500),
          workflowHint: normalizePackText(market.workflowHint, '', 240),
          gettingStarted: Array.isArray(market.gettingStarted) ? market.gettingStarted.map((item) => normalizePackText(item, '', 240)).filter(Boolean).slice(0, 8) : [],
          features: pack.menus.map((menu) => {
            const feature = Array.isArray(market.features) ? market.features.find((item) => item?.menuId === menu.id) : null;
            return { menuId: menu.id, title: normalizePackText(feature?.title, menu.label, 80), description: normalizePackText(feature?.description, '', 240), icon: normalizePackText(feature?.icon, 'pack', 32), tone: menu.tone };
          }),
          icon: normalizePackText(market.icon, pack.menus[0]?.glyph || '▦', 8),
          error: typeof candidate.error === 'string' ? candidate.error.slice(0, 500) : null,
          accessRequired: candidate.required === true,
          accessAllowed: candidate.allowed !== false,
          accessReason: typeof candidate.reason === 'string' ? candidate.reason.slice(0, 240) : null,
        });
      });
      return { phase: 'ready', packs, error: null };
    }
    async function refreshPackCatalog(options = {}) {
      if (!services?.connection?.rpc?.call) return;
      const generation = ++packCatalogGeneration;
      const accountGeneration = lwbAccountGeneration;
      const retain = options.retain === true;
      if (!retain) {
        setPackCatalog({ phase: 'pending', packs: packCatalog.packs, error: null });
        setPackMarket({ phase: 'pending', packs: packMarket.packs, error: null });
      }
      try {
        const [activeResponse, marketResponse, visibilityResponse] = await Promise.all([
          services.connection.rpc.call('/api', 'lwbPacks/list', { args: {} }),
          services.connection.rpc.call('/api', 'lwbPacks/market', { args: {} }),
          services.connection.rpc.call('/api', 'lwbPacks/visibility', { args: {} }),
        ]);
        if (generation !== packCatalogGeneration || accountGeneration !== lwbAccountGeneration) return;
        if (!visibilityResponse?.ok) throw new Error(visibilityResponse?.error?.message || '无法读取能力包工作区归属。');
        packVisibility = visibilityResponse.value;
        if (!activeResponse?.ok) throw new Error(activeResponse?.error?.message || '无法读取已加载能力包。');
        setPackCatalog(normalizePackCatalog(activeResponse.value));
        if (!marketResponse?.ok) throw new Error(marketResponse?.error?.message || '无法读取能力包市场。');
        setPackMarket(normalizePackMarket(marketResponse.value));
      } catch (error) {
        if (generation !== packCatalogGeneration || accountGeneration !== lwbAccountGeneration) return;
        const message = error?.message || '无法读取能力包目录。';
        if (retain) {
          setPackCatalog({ phase: 'ready', packs: packCatalog.packs, error: message });
          setPackMarket({ phase: 'ready', packs: packMarket.packs, error: message });
        } else {
          setPackCatalog({ phase: 'error', packs: [], error: message });
          setPackMarket({ phase: 'error', packs: [], error: message });
        }
        throw error;
      }
    }
    class LwbPackClientRegistry {
      constructor() {
        this.pages = new Map();
        this.listeners = new Set();
        this.version = 0;
      }
      register(contribution) {
        if (!contribution || typeof contribution !== 'object' || !PACK_ID.test(contribution.packId || '')) {
          throw new Error('LWB capability pack client contribution requires a valid packId.');
        }
        if (!contribution.pages || typeof contribution.pages !== 'object' || Array.isArray(contribution.pages)) {
          throw new Error('LWB capability pack client contribution requires a pages object.');
        }
        const entries = Object.entries(contribution.pages);
        if (entries.length === 0) throw new Error('LWB capability pack client contribution requires at least one page.');
        const keys = entries.map(([menuId, Component]) => {
          if (!PACK_MENU_ID.test(menuId) || typeof Component !== 'function') {
            throw new Error('LWB capability pack client contribution contains an invalid page.');
          }
          return [capabilityRoute(contribution.packId, menuId), Component];
        });
        for (const [key] of keys) {
          if (this.pages.has(key)) throw new Error(`LWB capability pack client page is already registered: ${key}`);
        }
        keys.forEach(([key, Component]) => this.pages.set(key, Component));
        this.version += 1;
        this.listeners.forEach((listener) => listener());
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          keys.forEach(([key, Component]) => { if (this.pages.get(key) === Component) this.pages.delete(key); });
          this.version += 1;
          this.listeners.forEach((listener) => listener());
        };
      }
      page(packId, menuId) { return this.pages.get(capabilityRoute(packId, menuId)); }
      subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
      getSnapshot() { return this.version; }
    }
    function useLwbPackClient() {
      React.useSyncExternalStore(
        (listener) => lwbPackClient?.subscribe(listener) || (() => {}),
        () => lwbPackClient?.getSnapshot() || 0,
        () => 0,
      );
      return lwbPackClient;
    }

    // DSH owns browser entry reconciliation; LWB owns business registration.
    // Use the same serial controller as the official graph event stream.
    class LwbPackClientRuntime {
      constructor(modules) { this.modules = modules; }
      async sync(pack, loaded) {
        const response = await services.connection.rpc.call('/api', 'lwbPacks/clientGraph', { args: {} });
        if (!response?.ok) throw new Error(response?.error?.message || '无法同步能力包页面。');
        await this.modules.entries.sync(response.value);
        const failures = this.modules.entries.state.getSnapshot().failures;
        const failure = failures.find(row => row.id === pack.packageName);
        if (failure) throw new Error(failure.message);
        if (loaded && pack.menus.some(menu => !lwbPackClient.page(pack.id, menu.id))) {
          throw new Error('能力包浏览器页面尚未完成注册。');
        }
      }
    }
    async function archiveRemote(method, request) {
      if (!services?.connection?.rpc?.call) throw new Error('DSH 连接尚未就绪');
      const response = await services.connection.rpc.call('/api', `lwbArchives/${method}`, { args: { request } });
      if (!response?.ok) throw new Error(response?.error?.message || '归档操作失败');
      return response.value;
    }
    function navTo(page, capabilityPage) {
      // Persisted, not transient: a reload returns to the page the user left,
      // which is also what re-reveals that page's capability group.
      if (page === 'conversation') clearConversationPanel();
      updateProduct({ page, accountReturnRoute: null, capabilityPage: capabilityPage || null, mobileNavOpen: false, conversationPanelOpen: false });
    }
    function showConversation(sessionId) {
      if (sessionId) services?.uiWorkspace?.openSession?.(sessionId);
      // The conversation module shows the Conversation again rather than the
      // official panel the user last had open inside it.
      clearConversationPanel();
      updateProduct({ page: 'conversation', accountReturnRoute: null, capabilityPage: null, mobileNavOpen: false, conversationPanelOpen: false });
    }

    const css = `
      .lwb-task-model p { margin:0; line-height:1.6; } .lwb-task-model .lwb-field { display:grid; gap:8px; } .lwb-service-card { padding:18px; border:1px solid var(--lwb-line); border-radius:12px; background:var(--lwb-surface); display:grid; gap:12px; color:var(--lwb-ink); } .lwb-service-card p { margin:0; line-height:1.6; } .lwb-service-email { overflow-wrap:anywhere; color:var(--lwb-muted); } .lwb-service-card .lwb-account-metrics { display:grid; gap:16px; grid-template-columns:1fr 1fr; } .lwb-service-card .lwb-account-metrics > div { display:grid; gap:6px; min-width:0; } .lwb-service-card .lwb-account-metrics span { color:var(--lwb-muted); font-size:12px; } .lwb-service-card .lwb-account-metrics strong { overflow-wrap:anywhere; font-size:16px; } .lwb-account-return { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:15px 20px; } .lwb-account-return > span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.5; }
      :root { --lwb-text-xs:12px; --lwb-text-sm:13px; --lwb-text-base:14px; --lwb-text-md:15px; --lwb-text-lg:16px; --lwb-text-section:18px; --lwb-text-heading:20px; --lwb-text-title:24px; --lwb-sidebar-width:248px; --lwb-ink:#1d2733; --lwb-muted:#5f6f80; --lwb-line:#e5e9ee; --lwb-page:#f7f9fb; --lwb-surface:#fff; --lwb-blue:#2869d8; --lwb-blue-soft:#edf4ff; --lwb-green:#16865f; --lwb-green-soft:#eaf8f1; --lwb-warm:#b97016; --lwb-warm-soft:#fff5e7; }
      body[data-ds-dark-theme] { --lwb-ink:var(--dsw-alias-label-primary,#edf3f8); --lwb-muted:var(--dsw-alias-label-secondary,#a9b7c5); --lwb-line:var(--dsw-alias-border-l1,#334352); --lwb-page:var(--dsw-alias-bg-base,#131c25); --lwb-surface:var(--dsw-alias-bg-layer-1,#1c2733); --lwb-blue:#78adff; --lwb-blue-soft:#203f64; --lwb-green:#5bd0a0; --lwb-green-soft:#173f34; --lwb-warm:#f0b45b; --lwb-warm-soft:#49351c; }
      body[data-ds-dark-theme] .lwb-sidebar { background:var(--lwb-surface); } body[data-ds-dark-theme] .lwb-nav-caption { color:#91a2b3; } body[data-ds-dark-theme] .lwb-nav-item,body[data-ds-dark-theme] .lwb-cap-toggle,body[data-ds-dark-theme] .lwb-field label { color:var(--lwb-ink); } body[data-ds-dark-theme] .lwb-nav-item:hover,body[data-ds-dark-theme] .lwb-cap-toggle:hover { background:#25384b; } body[data-ds-dark-theme] .lwb-nav-item[data-icon="conversation"] { --nav-soft:#1d4058; } body[data-ds-dark-theme] .lwb-nav-item[data-icon="packs"] { --nav-soft:#52331f; } body[data-ds-dark-theme] .lwb-nav-item[data-icon="settings"],body[data-ds-dark-theme] .lwb-nav-item[data-tone="violet"] { --nav-soft:#303947; } body[data-ds-dark-theme] .lwb-nav-item[data-tone="orange"] { --nav-soft:#513522; } body[data-ds-dark-theme] .lwb-nav-item[data-tone="pink"] { --nav-soft:#4b2f40; } body[data-ds-dark-theme] .lwb-nav-item[data-tone="red"] { --nav-soft:#4c302b; } body[data-ds-dark-theme] .lwb-nav-item[data-tone="green"] { --nav-soft:#1d4438; }
      body[data-ds-dark-theme] .lwb-nav-count,body[data-ds-dark-theme] .lwb-menu-pill { color:#b3c0cc; background:#2a3948; } body[data-ds-dark-theme] .lwb-cap-mark,body[data-ds-dark-theme] .lwb-user-avatar { background:#223c59; } body[data-ds-dark-theme] .lwb-sidebar-foot { border-color:var(--lwb-line); color:var(--lwb-muted); } body[data-ds-dark-theme] .lwb-conversation-pane { background:var(--dsw-specific-sidebar-fill,var(--lwb-page)); box-shadow:8px 0 20px rgba(0,0,0,.16); } body[data-ds-dark-theme] .lwb-overlay-head { background:rgba(28,39,51,.96); } body[data-ds-dark-theme] .lwb-select,body[data-ds-dark-theme] .lwb-input,body[data-ds-dark-theme] .lwb-plain-button,body[data-ds-dark-theme] .lwb-detail-close { border-color:#405161; color:var(--lwb-ink); background:#23313f; } body[data-ds-dark-theme] .lwb-input:focus,body[data-ds-dark-theme] .lwb-select:focus { border-color:var(--lwb-blue); box-shadow:0 0 0 2px rgba(120,173,255,.2); }
      body[data-ds-dark-theme] .lwb-pack-card > p,body[data-ds-dark-theme] .lwb-detail-menu-row,body[data-ds-dark-theme] .lwb-detail-fact strong { color:var(--lwb-ink); } body[data-ds-dark-theme] .lwb-pack-empty,body[data-ds-dark-theme] .lwb-settings-group-head,body[data-ds-dark-theme] .lwb-detail-fact,body[data-ds-dark-theme] .lwb-detail-menu-row { border-color:var(--lwb-line); background:#202d3a; } body[data-ds-dark-theme] .lwb-detail-fact small,body[data-ds-dark-theme] .lwb-modal-copy,body[data-ds-dark-theme] .lwb-modal-title { color:var(--lwb-muted); } body[data-ds-dark-theme] .lwb-pack-tab { color:var(--lwb-muted); } body[data-ds-dark-theme] .lwb-pack-tab[data-active="true"] { border-color:#345f8f; } body[data-ds-dark-theme] .lwb-status[data-tone="muted"] { color:#bdc8d2; background:#344250; } body[data-ds-dark-theme] .lwb-danger-button { border-color:#814d4d; color:#ffabab; background:#45292b; } body[data-ds-dark-theme] .lwb-dialog-error { border-color:#804b4b; color:#ffb5b5; background:#48292c; } body[data-ds-dark-theme] .lwb-mobile-nav-trigger,body[data-ds-dark-theme] .lwb-mobile-conversation-trigger { border-color:#405161; color:var(--lwb-ink); background:#23313f; }
      .lwb-sidebar,.lwb-overlay,.lwb-conversation-pane { box-sizing:border-box; font-size:var(--lwb-text-base); line-height:1.55; font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif; color:var(--lwb-ink); }
      .lwb-sidebar *,.lwb-overlay *,.lwb-cap-flyout * { box-sizing:border-box; }
      .lwb-sidebar-head { display:flex; width:100%; align-items:center; flex-shrink:0; }
      .lwb-sidebar-head .lwb-brand { flex:1; width:auto; }
      .lwb-sidebar[data-collapsed="true"] .lwb-sidebar-head { flex-direction:column; gap:2px; margin-bottom:10px; }
      .lwb-sidebar[data-collapsed="true"] .lwb-sidebar-head .lwb-brand { flex:none; }
      .lwb-expand,.lwb-desktop-expand { display:grid; width:28px; height:28px; place-items:center; border:0; border-radius:6px; color:var(--lwb-muted); background:transparent; cursor:pointer; -webkit-app-region:no-drag; }
      .lwb-expand:hover,.lwb-desktop-expand:hover,.lwb-collapse:hover { color:var(--lwb-blue); background:var(--lwb-blue-soft); }
      .lwb-desktop-expand { position:fixed; top:calc((var(--dsh-windows-titlebar-height,36px) - 28px)/2); left:12px; z-index:30; }
      html[data-platform='darwin'] .lwb-desktop-expand { top:11px; left:88px; }
      html[data-platform='darwin'][data-fullscreen] .lwb-desktop-expand { left:12px; }
      .lwb-cap-flyout { position:fixed; z-index:40; display:flex; flex-direction:column; box-sizing:border-box; width:min(264px,calc(100vw - 16px)); max-height:calc(100dvh - 16px); padding:8px; border:1px solid var(--lwb-line); border-radius:10px; background:var(--lwb-surface); color:var(--lwb-ink); box-shadow:0 8px 28px rgba(20,34,49,.16); font:14px/1.55 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif; }
      .lwb-cap-flyout-title { flex:none; padding:7px 9px 10px; border-bottom:1px solid var(--lwb-line); margin-bottom:5px; font-weight:700; overflow-wrap:anywhere; }
      .lwb-cap-flyout-items { display:grid; min-height:0; gap:2px; overflow-y:auto; overscroll-behavior:contain; }
      .lwb-expand:focus-visible,.lwb-desktop-expand:focus-visible,.lwb-collapse:focus-visible,.lwb-cap-toggle:focus-visible,.lwb-nav-item:focus-visible { outline:2px solid var(--lwb-blue); outline-offset:2px; }
      .lwb-sidebar { display:flex; height:100%; overflow-x:hidden; overflow-y:auto; overscroll-behavior:contain; flex-direction:column; padding:16px 10px 10px; background:#fff; } html[data-platform='darwin'] .lwb-sidebar { padding-top:48px; }
      .lwb-brand,.lwb-nav-item { display:flex; width:100%; min-width:0; align-items:center; border:0; background:transparent; color:inherit; text-align:left; cursor:pointer; }
      .lwb-brand { flex-shrink:0; gap:10px; min-height:42px; padding:3px 8px 14px; }
      .lwb-brand-mark { display:block; width:30px; height:30px; flex:none; object-fit:contain; }
      .lwb-brand-copy { display:grid; min-width:0; gap:2px; }
      .lwb-brand-copy strong,.lwb-brand-copy small,.lwb-nav-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .lwb-brand-copy strong { font-size:var(--lwb-text-section,18px); } .lwb-brand-copy small { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .lwb-collapse { display:grid; flex:none; width:28px; height:28px; margin-left:auto; place-items:center; border:0; border-radius:6px; color:var(--lwb-muted); background:transparent; font-size:var(--lwb-text-section,18px); cursor:pointer; }
      .lwb-nav-group { display:grid; flex-shrink:0; gap:2px; margin:0 0 15px; } .lwb-nav-caption { padding:0 10px 6px; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); font-weight:700; letter-spacing:.08em; }
      .lwb-nav-item { min-height:42px; gap:9px; padding:0 9px; border-radius:6px; color:#566473; font-size:var(--lwb-text-base,14px); } .lwb-nav-item:hover { color:#273645; background:#f3f6fa; } .lwb-nav-item[data-active="true"] { color:var(--lwb-blue); background:var(--lwb-blue-soft); font-weight:700; }
      .lwb-nav-icon { display:grid; width:26px; height:26px; flex:none; place-items:center; border-radius:6px; color:var(--nav-color,#667788); background:var(--nav-soft,#edf1f5); } .lwb-nav-item[data-icon="conversation"] { --nav-color:#2579b9; --nav-soft:#e7f4fb; } .lwb-nav-item[data-icon="packs"] { --nav-color:#d57827; --nav-soft:#fff0e2; } .lwb-nav-item[data-icon="settings"] { --nav-color:#667789; --nav-soft:#edf1f5; } .lwb-nav-item[data-tone="violet"] { --nav-color:#8b5cc4; --nav-soft:#f2ebfb; } .lwb-nav-item[data-tone="orange"] { --nav-color:#cf762b; --nav-soft:#fff0e4; } .lwb-nav-item[data-tone="pink"] { --nav-color:#bc5f8c; --nav-soft:#faeaf1; } .lwb-nav-item[data-tone="red"] { --nav-color:#c25f4a; --nav-soft:#fdeae5; } .lwb-nav-item[data-tone="green"] { --nav-color:#238c67; --nav-soft:#e6f6ee; } .lwb-nav-item[data-active="true"] .lwb-nav-icon { color:#fff; background:var(--lwb-blue); }
      .lwb-nav-count { display:grid; min-width:17px; height:17px; margin-left:auto; place-items:center; border-radius:9px; color:#8090a0; background:#eef2f6; font-size:var(--lwb-text-xs,12px); }
      .lwb-capability-nav { gap:5px; } .lwb-cap-group { display:grid; min-width:0; gap:1px; } .lwb-cap-toggle { display:flex; width:100%; min-width:0; min-height:34px; align-items:center; gap:7px; padding:0 8px; border:0; border-radius:6px; color:#324458; background:transparent; font:inherit; font-size:var(--lwb-text-sm,13px); font-weight:700; text-align:left; cursor:pointer; } .lwb-cap-toggle:hover { color:#273645; background:#f3f6fa; } .lwb-cap-group[data-active="true"] .lwb-cap-toggle { color:var(--lwb-blue); } .lwb-cap-mark { display:grid; width:22px; height:22px; flex:none; place-items:center; border-radius:5px; color:var(--lwb-blue); background:#e9f1ff; font-size:var(--lwb-text-xs,12px); } .lwb-cap-chevron { display:grid; width:16px; height:16px; flex:none; place-items:center; color:#8b99a7; transform:rotate(180deg); transition:transform .14s ease; } .lwb-cap-toggle[aria-expanded="true"] .lwb-cap-chevron { transform:rotate(-90deg); } .lwb-cap-menu { display:grid; min-width:0; gap:1px; margin:0 0 3px 11px; padding-left:9px; border-left:1px solid var(--lwb-line); } .lwb-cap-menu .lwb-nav-item { min-height:34px; padding:0 8px; font-size:var(--lwb-text-sm,13px); } .lwb-cap-menu .lwb-nav-icon { width:22px; height:22px; border-radius:5px; font-size:var(--lwb-text-xs,12px); }
      .lwb-sidebar-foot { display:flex; min-height:35px; align-items:center; gap:8px; margin-top:auto; padding:10px 8px 0; border-top:1px solid #eef1f4; color:#768493; font-size:var(--lwb-text-sm,13px); } .lwb-user-avatar { display:grid; width:23px; height:23px; place-items:center; border-radius:50%; color:#2869d8; background:#e9f1ff; font-size:var(--lwb-text-xs,12px); font-weight:800; } .lwb-sidebar[data-collapsed="true"] { align-items:center; padding:14px 10px; } .lwb-sidebar[data-collapsed="true"] .lwb-brand { width:36px; justify-content:center; padding:2px 0 15px; } .lwb-sidebar[data-collapsed="true"] .lwb-nav-item,.lwb-sidebar[data-collapsed="true"] .lwb-cap-toggle { width:36px; justify-content:center; padding:0; } .lwb-sidebar[data-collapsed="true"] .lwb-nav-caption,.lwb-sidebar[data-collapsed="true"] .lwb-brand-copy,.lwb-sidebar[data-collapsed="true"] .lwb-collapse,.lwb-sidebar[data-collapsed="true"] .lwb-nav-label,.lwb-sidebar[data-collapsed="true"] .lwb-nav-count,.lwb-sidebar[data-collapsed="true"] .lwb-cap-chevron,.lwb-sidebar[data-collapsed="true"] .lwb-sidebar-foot span { display:none; } .lwb-sidebar[data-collapsed="true"] .lwb-nav-group,.lwb-sidebar[data-collapsed="true"] .lwb-sidebar-foot { width:36px; } .lwb-sidebar[data-collapsed="true"] .lwb-cap-menu { display:none; } .lwb-sidebar[data-collapsed="true"] .lwb-sidebar-foot { justify-content:center; padding:10px 0 0; }
      .lwb-overlay { position:absolute; z-index:1; inset:0 var(--lwb-rightbar-inset,0px) 0 var(--lwb-sidebar-width); display:flex; flex-direction:column; overflow:hidden; background:var(--lwb-page); } .lwb-conversation-overlay { position:absolute; z-index:1; inset:0 0 0 var(--lwb-sidebar-width); pointer-events:none; --lwb-conversation-panel-width:264px; } .lwb-conversation-pane { display:flex; width:var(--lwb-conversation-panel-width); height:100%; flex-direction:column; overflow:hidden; border-right:1px solid var(--lwb-line); background:var(--dsw-specific-sidebar-fill,#fbfcfd); box-shadow:8px 0 20px rgba(30,48,70,.025); pointer-events:auto; --dsh-sidebar-inline-padding:12px; --dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2); color:var(--dsw-alias-label-primary,var(--lwb-ink)); font-size:var(--lwb-text-base,14px); } .lwb-conversation-pane-head { display:flex; min-height:38px; align-items:center; justify-content:space-between; padding:0 var(--dsh-sidebar-inline-padding) 6px; padding-left:max(var(--dsh-sidebar-inline-padding),var(--dsh-frame-leading-clearance,0px)); } .lwb-conversation-pane-head button { width:28px; height:28px; border:0; border-radius:var(--dsw-radius-sm,5px); color:var(--dsw-alias-label-secondary,var(--lwb-blue)); background:transparent; font-size:var(--lwb-text-heading,20px); cursor:pointer; } .lwb-conversation-pane-head button:hover { background:var(--dsw-alias-interactive-bg-hover,var(--lwb-blue-soft)); } .lwb-conversation-close,.lwb-conversation-backdrop { display:none; } .lwb-conversation-region { display:flex; min-height:0; flex:1; flex-direction:column; overflow:hidden; padding-left:var(--dsh-sidebar-inline-padding); } .lwb-conversation-loading { display:grid; min-height:120px; place-items:center; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); } .lwb-embedded-conversation-shell { position:relative; display:flex; flex-direction:column; width:100%; height:100%; min-height:0; overflow:hidden; background:var(--lwb-surface); } .lwb-embedded-conversation-head { display:flex; min-width:0; flex:none; align-items:center; justify-content:space-between; gap:10px; padding:6px 10px 6px 12px; border-bottom:1px solid var(--lwb-line); background:var(--lwb-surface); } .lwb-embedded-conversation-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--lwb-text-sm,13px); font-weight:600; } .lwb-embedded-rightbar-toggle { display:inline-flex; flex:none; align-items:center; min-height:26px; padding:0 9px; border:1px solid var(--lwb-line); border-radius:6px; color:var(--lwb-muted); background:var(--lwb-page); font:inherit; font-size:var(--lwb-text-xs,12px); font-weight:600; cursor:pointer; } .lwb-embedded-rightbar-toggle:hover { border-color:var(--lwb-blue); color:var(--lwb-blue); } .lwb-embedded-rightbar-toggle[data-on="true"] { border-color:var(--lwb-blue); color:var(--lwb-blue); background:var(--lwb-blue-soft); } .lwb-embedded-conversation-main { width:100%; height:100%; min-height:0; flex:1; } .lwb-embedded-conversation-main > * { height:100%; min-height:0; } .lwb-readonly-conversation { display:flex; flex:1; min-height:0; flex-direction:column; } .lwb-readonly-conversation [data-conversation-region="composer"] { display:none; } .lwb-embedded-conversation-state { display:grid; min-height:220px; place-items:center; padding:24px; border:1px dashed var(--lwb-line); border-radius:7px; color:var(--lwb-muted); background:var(--lwb-surface); font-size:var(--lwb-text-sm,13px); text-align:center; } [data-lwb-conversation-active="true"] > div:nth-child(2) { box-sizing:border-box; padding-left:calc(var(--lwb-conversation-panel-width,264px) + 16px); }
      .lwb-conversation-actions { flex:none; padding:0 var(--dsh-sidebar-inline-padding) 6px; } .lwb-conversation-new { display:flex; width:100%; min-height:32px; align-items:center; gap:8px; padding:0 10px; border:1px solid var(--lwb-line); border-radius:var(--dsw-radius-sm,6px); color:var(--dsw-alias-label-primary,var(--lwb-ink)); background:var(--lwb-surface); font:inherit; font-size:var(--lwb-text-sm,13px); font-weight:600; text-align:left; cursor:pointer; } .lwb-conversation-new:hover { border-color:var(--lwb-blue); color:var(--lwb-blue); } .lwb-conversation-new-key { display:inline-flex; margin-left:auto; color:var(--lwb-muted); } .lwb-conversation-panels { display:grid; flex:none; gap:2px; padding:0 var(--dsh-sidebar-inline-padding) 6px; } .lwb-conversation-panel { display:flex; min-height:34px; align-items:center; gap:8px; padding:0 9px; border:0; border-radius:var(--dsw-radius-sm,6px); color:var(--dsw-alias-label-secondary,var(--lwb-muted)); background:transparent; font:inherit; font-size:var(--lwb-text-sm,13px); font-weight:600; text-align:left; cursor:pointer; } .lwb-conversation-panel:hover { color:var(--dsw-alias-label-primary,var(--lwb-ink)); background:var(--dsw-alias-interactive-bg-hover,var(--lwb-blue-soft)); } .lwb-conversation-panel[data-active="true"] { color:var(--lwb-blue); background:var(--lwb-blue-soft); } .lwb-conversation-panel-glyph { display:grid; width:18px; flex:none; place-items:center; } .lwb-conversation-panel-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .lwb-overlay-head { display:flex; min-height:58px; align-items:center; justify-content:space-between; padding:0 28px; padding-left:max(28px,var(--dsh-frame-leading-clearance,0px)); border-bottom:1px solid var(--lwb-line); background:rgba(255,255,255,.96); } .lwb-overlay-title { display:flex; min-width:0; gap:10px; align-items:center; } .lwb-overlay-title b { font-size:var(--lwb-text-lg,16px); } .lwb-overlay-title span { overflow:hidden; color:var(--lwb-muted); font-size:var(--lwb-text-base,14px); text-overflow:ellipsis; white-space:nowrap; } .lwb-overlay-body { min-height:0; flex:1; overflow:auto; } .lwb-page { width:min(1180px,100%); min-height:100%; margin:0 auto; padding:31px 36px 52px; } .lwb-page-capability { width:100%; max-width:none; margin:0; padding:20px clamp(20px,2.4vw,44px) 52px; } .lwb-page-intro { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; margin-bottom:22px; } .lwb-page-capability .lwb-page-intro { min-height:64px; margin-bottom:16px; padding-bottom:14px; border-bottom:1px solid var(--lwb-line); } .lwb-page-capability .lwb-eyebrow { margin-bottom:5px; } .lwb-eyebrow { margin-bottom:8px; color:var(--lwb-blue); font-size:var(--lwb-text-xs,12px); font-weight:800; letter-spacing:.12em; } .lwb-page-intro h1 { margin:0; font-size:var(--lwb-text-title,24px); line-height:1.2; } .lwb-page-capability .lwb-page-intro h1 { font-size:var(--lwb-text-heading,20px); } .lwb-page-intro p { max-width:650px; margin:8px 0 0; color:var(--lwb-muted); font-size:var(--lwb-text-md,15px); line-height:1.55; } .lwb-page-capability .lwb-page-intro p { max-width:900px; margin-top:4px; font-size:var(--lwb-text-base,14px); }
      .lwb-card { border:1px solid var(--lwb-line); border-radius:7px; background:var(--lwb-surface); box-shadow:0 2px 8px rgba(24,39,56,.025); } .lwb-card-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:15px 17px; border-bottom:1px solid var(--lwb-line); } .lwb-card-heading span { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); } .lwb-status { display:inline-flex; min-height:21px; align-items:center; padding:0 8px; border-radius:11px; color:var(--lwb-green); background:var(--lwb-green-soft); font-size:var(--lwb-text-sm,13px); font-weight:700; white-space:nowrap; } .lwb-status[data-tone="muted"] { color:#7c8996; background:#f0f3f5; } .lwb-status[data-tone="warm"] { color:var(--lwb-warm); background:var(--lwb-warm-soft); } .lwb-empty-state,.lwb-pack-empty { display:grid; min-height:280px; place-items:center; padding:36px; text-align:center; } .lwb-empty-state p { color:var(--lwb-muted); font-size:var(--lwb-text-base,14px); line-height:1.65; } .lwb-empty-glyph,.lwb-pack-icon { display:grid; place-items:center; border-radius:8px; color:var(--lwb-blue); background:var(--lwb-blue-soft); } .lwb-empty-glyph { width:50px; height:50px; margin:auto; font-size:var(--lwb-text-title,24px); } .lwb-row-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
      .lwb-plain-button,.lwb-primary-button,.lwb-danger-button { min-height:32px; padding:0 11px; border:1px solid #d7e0e9; border-radius:6px; background:#fff; color:#4f6071; font-size:var(--lwb-text-base,14px); font-weight:600; cursor:pointer; } .lwb-primary-button { border-color:var(--lwb-blue); color:#fff; background:var(--lwb-blue); } .lwb-danger-button { border-color:#dba8a8; color:#a44949; background:#fff7f7; }
      .lwb-pack-tabs { display:flex; gap:4px; margin-bottom:14px; } .lwb-pack-tab { min-height:32px; padding:0 12px; border:1px solid transparent; border-radius:6px; color:#6e7c8a; background:transparent; cursor:pointer; } .lwb-pack-tab[data-active="true"] { border-color:#d6e5f9; color:var(--lwb-blue); background:var(--lwb-blue-soft); } .lwb-market-controls { display:grid; grid-template-columns:minmax(220px,1fr) 142px 142px; gap:9px; margin-bottom:16px; } .lwb-market-search { width:100%; height:34px; padding:0 10px; border:1px solid #d8e2ec; border-radius:6px; outline:0; color:var(--lwb-ink); background:var(--lwb-surface); font-size:var(--lwb-text-base,14px); } .lwb-market-search:focus { border-color:var(--lwb-blue); box-shadow:0 0 0 2px var(--lwb-blue-soft); } .lwb-pack-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(248px,1fr)); gap:13px; } .lwb-pack-card { display:flex; min-height:258px; flex-direction:column; padding:17px; cursor:pointer; } .lwb-pack-card:hover { border-color:#b9d4f4; box-shadow:0 5px 17px rgba(39,78,123,.09); } .lwb-pack-card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:15px; } .lwb-pack-title { display:flex; min-width:0; align-items:center; gap:11px; } .lwb-pack-title > div { min-width:0; } .lwb-pack-icon { width:37px; height:37px; flex:none; font-size:var(--lwb-text-heading,20px); } .lwb-pack-title h3 { overflow:hidden; margin:0; font-size:var(--lwb-text-lg,16px); text-overflow:ellipsis; white-space:nowrap; } .lwb-pack-title p { margin:4px 0 0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); } .lwb-pack-card > p { margin:14px 0; color:#657586; font-size:var(--lwb-text-base,14px); line-height:1.6; } .lwb-pack-menu { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px; } .lwb-menu-pill { padding:4px 7px; border-radius:4px; color:#617183; background:#f2f5f8; font-size:var(--lwb-text-xs,12px); } .lwb-pack-actions { margin-top:auto; } .lwb-pack-card-note { min-height:16px; margin:0 0 10px; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); }
      .lwb-pack-empty { border:1px dashed #d6dee7; border-radius:7px; color:#82909e; background:#fbfcfd; font-size:var(--lwb-text-base,14px); }
      .lwb-settings { display:grid; gap:18px; } .lwb-settings-group { overflow:hidden; } .lwb-settings-group-head { display:flex; flex-wrap:wrap; align-items:flex-start; justify-content:space-between; gap:8px 14px; padding:15px 20px; border-bottom:1px solid var(--lwb-line); background:#f1f6fb; } .lwb-settings-group-title { display:flex; min-width:0; flex:1 1 auto; align-items:center; gap:11px; } .lwb-settings-group-title > div { min-width:0; } .lwb-settings-group-head h2 { margin:0; color:var(--lwb-ink); font-size:var(--lwb-text-lg,16px); line-height:1.35; } .lwb-settings-group-head p { margin:4px 0 0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.5; } .lwb-settings-group-head > .lwb-status { flex:none; margin-top:3px; } .lwb-settings-group-mark { display:grid; min-width:34px; height:30px; flex:none; padding:0 7px; place-items:center; border-radius:8px; color:#3b6ea8; background:#e8f1fc; font-size:11px; font-weight:800; letter-spacing:.02em; } .lwb-settings-group-mark[data-tone="teal"] { color:#fff; background:#287c78; } .lwb-settings-group-mark[data-tone="slate"] { color:#5b6c7e; background:#eef2f6; } .lwb-settings-group-body { display:grid; gap:16px; padding:18px 20px; } .lwb-setting-row { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:17px 20px; border-bottom:1px solid var(--lwb-line); } .lwb-setting-row:last-child { border-bottom:0; } .lwb-setting-copy > strong { display:block; font-size:var(--lwb-text-md,15px); } .lwb-setting-copy > span { display:block; margin-top:5px; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.5; } .lwb-select { min-width:110px; height:32px; padding:0 8px; border:1px solid #d7e0e9; border-radius:6px; color:#4f6071; background:#fff; font-size:var(--lwb-text-base,14px); } .lwb-field { display:grid; gap:6px; } .lwb-field label { color:#566879; font-size:var(--lwb-text-sm,13px); font-weight:700; } .lwb-input { width:100%; height:34px; padding:0 10px; border:1px solid #d8e2ec; border-radius:6px; outline:0; color:#40505f; background:#fff; font-size:var(--lwb-text-base,14px); } .lwb-input:focus,.lwb-select:focus { border-color:#9fc0f4; box-shadow:0 0 0 2px #eef5ff; } .lwb-form { display:grid; gap:14px; } .lwb-modal-title { margin:0; color:#253646; font-size:var(--lwb-text-heading,20px); } .lwb-modal-copy { margin:6px 0 0; color:#7a8997; font-size:var(--lwb-text-sm,13px); line-height:1.55; } .lwb-dialog-error { margin:0; padding:9px 10px; border:1px solid #efcfcf; border-radius:6px; color:#a54848; background:#fff7f7; font-size:var(--lwb-text-sm,13px); line-height:1.45; }
      .lwb-account-note { display:flex; gap:10px; margin:0; padding:12px 14px; border:1px solid #cbe0f4; border-radius:8px; color:#2c5578; background:#f4f9ff; font-size:var(--lwb-text-sm,13px); line-height:1.6; } .lwb-account-note-mark { display:grid; width:18px; height:18px; flex:none; margin-top:1px; place-items:center; border-radius:50%; color:#fff; background:#4b8ed6; font-size:11px; font-weight:800; } .lwb-account-panel { display:grid; gap:15px; padding:16px; border:1px solid var(--lwb-line); border-radius:7px; background:var(--lwb-page); } .lwb-account-meta { display:flex; min-width:0; align-items:baseline; justify-content:space-between; gap:12px; } .lwb-account-meta strong { overflow:hidden; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); text-overflow:ellipsis; white-space:nowrap; } .lwb-account-meta span,.lwb-account-muted { color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); } .lwb-account-stat-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; } .lwb-account-stat-grid > div { display:grid; gap:4px; min-width:0; padding:11px 12px; border:1px solid var(--lwb-line); border-radius:6px; background:var(--lwb-surface); } .lwb-account-stat-grid span,.lwb-account-stat-grid small { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); } .lwb-account-stat-grid strong { overflow:hidden; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); text-overflow:ellipsis; white-space:nowrap; } .lwb-account-form { max-width:520px; } .lwb-account-mode { display:flex; align-items:center; justify-content:space-between; gap:12px; } .lwb-link-button { padding:0; border:0; color:var(--lwb-blue); background:transparent; font:inherit; font-size:var(--lwb-text-sm,13px); cursor:pointer; } .lwb-link-button:hover { text-decoration:underline; } .lwb-account-notice { margin:0; padding:9px 10px; border:1px solid #b9dfca; border-radius:6px; color:#24714f; background:#f1fbf5; font-size:var(--lwb-text-sm,13px); line-height:1.45; }
      .lwb-purchase-section { display:grid; gap:13px; padding-top:2px; border-top:1px solid var(--lwb-line); } .lwb-purchase-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; } .lwb-purchase-heading strong { display:block; color:var(--lwb-ink); font-size:var(--lwb-text-md,15px); } .lwb-purchase-heading p { margin:4px 0 0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); line-height:1.45; } .lwb-purchase-tabs { display:flex; gap:4px; border-bottom:1px solid var(--lwb-line); } .lwb-purchase-tabs button { min-height:34px; padding:0 11px; border:0; border-bottom:2px solid transparent; color:var(--lwb-muted); background:transparent; font:inherit; font-size:var(--lwb-text-sm,13px); cursor:pointer; } .lwb-purchase-tabs button:hover { color:var(--lwb-blue); } .lwb-purchase-tabs button.active { border-bottom-color:var(--lwb-blue); color:var(--lwb-blue); font-weight:700; } .lwb-purchase-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:9px; } .lwb-purchase-card { display:grid; min-width:0; gap:7px; padding:12px; border:1px solid var(--lwb-line); border-radius:6px; background:var(--lwb-surface); } .lwb-purchase-card strong { overflow:hidden; color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); text-overflow:ellipsis; white-space:nowrap; } .lwb-purchase-card b { color:var(--lwb-blue); font-size:var(--lwb-text-lg,16px); font-variant-numeric:tabular-nums; } .lwb-purchase-card span { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); line-height:1.4; } .lwb-purchase-card .lwb-primary-button { width:100%; margin-top:3px; } .lwb-payment-status { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 11px; border:1px solid #c7d9ef; border-radius:6px; color:var(--lwb-ink); background:var(--lwb-blue-soft); } .lwb-payment-status > div:first-child { display:grid; min-width:0; gap:2px; } .lwb-payment-status strong { overflow:hidden; font-size:var(--lwb-text-sm,13px); text-overflow:ellipsis; white-space:nowrap; } .lwb-payment-status span { color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); } .lwb-payment-status[data-status="paid"] { border-color:#b9dfca; background:var(--lwb-green-soft); } .lwb-payment-status[data-status="cancelled"],.lwb-payment-status[data-status="canceled"],.lwb-payment-status[data-status="failed"],.lwb-payment-status[data-status="expired"] { border-color:#e7c6c6; background:#fff6f6; } .lwb-payment-status[data-status="timeout"] { border-color:#e7d4b0; background:var(--lwb-warm-soft); } .lwb-payment-status .lwb-row-actions { flex:none; }
      body[data-ds-dark-theme] .lwb-account-panel { border-color:var(--lwb-line); background:#1b2733; } body[data-ds-dark-theme] .lwb-account-stat-grid > div { border-color:var(--lwb-line); background:#23313f; } body[data-ds-dark-theme] .lwb-account-notice { border-color:#376b56; color:#8fe0b5; background:#17372d; } body[data-ds-dark-theme] .lwb-purchase-card { border-color:var(--lwb-line); background:#23313f; } body[data-ds-dark-theme] .lwb-payment-status[data-status="cancelled"],body[data-ds-dark-theme] .lwb-payment-status[data-status="canceled"],body[data-ds-dark-theme] .lwb-payment-status[data-status="failed"],body[data-ds-dark-theme] .lwb-payment-status[data-status="expired"] { border-color:#754b4b; background:#3f292b; } body[data-ds-dark-theme] .lwb-payment-status[data-status="timeout"] { border-color:#75603f; }
      .lwb-account-panel { background:var(--lwb-page); }
      body[data-ds-dark-theme] .lwb-account-note { border-color:#3a6d94; color:#bcdcf7; background:#172f3f; }
      .lwb-account-form { width:min(520px,100%); max-width:none; justify-self:center; gap:20px; padding:22px; border-color:#c9d9e5; border-left:3px solid #287c78; box-shadow:0 4px 16px rgba(31,58,75,.06); }
      .lwb-account-mode { align-items:flex-start; padding-bottom:16px; border-bottom:1px solid var(--lwb-line); }
      .lwb-account-mode-heading { display:flex; min-width:0; align-items:center; gap:10px; }
      .lwb-account-mode-mark { display:grid; width:32px; height:32px; flex:none; place-items:center; border-radius:6px; color:#16736e; background:#e5f5f1; font-size:19px; font-weight:700; line-height:1; }
      .lwb-account-mode-title { color:var(--lwb-ink); font-size:var(--lwb-text-lg,16px); line-height:32px; }
      .lwb-account-form-fields { display:grid; gap:16px; }
      .lwb-account-form .lwb-input { min-height:42px; }
      .lwb-account-switch-button { display:inline-flex; min-height:34px; align-items:center; justify-content:center; flex:none; padding:6px 11px; border:1px solid #9bbfd9; border-radius:6px; color:#155d94; background:#eef7fc; font-size:var(--lwb-text-sm,13px); font-weight:700; line-height:1.35; text-decoration:none; white-space:normal; }
      .lwb-account-switch-button:hover { border-color:#5e9cca; color:#104f81; background:#e1f1fa; text-decoration:none; }
      .lwb-account-submit-actions { padding-top:2px; }
      .lwb-account-submit-actions .lwb-primary-button { min-width:132px; min-height:40px; }
      body[data-ds-dark-theme] .lwb-settings-group-head h2 { color:var(--lwb-ink); }
      body[data-ds-dark-theme] .lwb-account-form { border-color:#3b6572; border-left-color:#48aba1; background:#1d2d36; box-shadow:none; }
      body[data-ds-dark-theme] .lwb-account-mode-mark { color:#8ce0d4; background:#21453f; }
      body[data-ds-dark-theme] .lwb-account-switch-button { border-color:#497f9f; color:#b6dfff; background:#23435a; }
      body[data-ds-dark-theme] .lwb-account-switch-button:hover { border-color:#73acd0; color:#e2f3ff; background:#2c536c; }
      .lwb-modal-backdrop { position:fixed; z-index:20; inset:0; display:grid; place-items:center; padding:24px; background:rgba(27,39,53,.28); pointer-events:auto; } .lwb-pack-drawer-backdrop { position:fixed; z-index:20; inset:0; display:flex; justify-content:flex-end; background:rgba(27,39,53,.28); pointer-events:auto; } .lwb-pack-detail { width:min(560px,100%); max-height:min(720px,calc(100vh - 48px)); overflow:auto; padding:21px; } .lwb-pack-drawer { width:min(510px,100%); height:100%; max-height:none; padding:24px; border-radius:0; box-shadow:-12px 0 32px rgba(20,34,49,.13); } .lwb-pack-detail-head { display:flex; align-items:flex-start; justify-content:space-between; gap:15px; margin-bottom:17px; } .lwb-pack-detail-head h2 { margin:0; font-size:var(--lwb-text-heading,20px); } .lwb-pack-detail-head p { margin:5px 0 0; color:var(--lwb-muted); font-size:var(--lwb-text-sm,13px); } .lwb-detail-close { width:30px; height:30px; border:1px solid #d7e0e9; border-radius:6px; color:#647487; background:#fff; cursor:pointer; } .lwb-detail-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; margin-bottom:17px; } .lwb-detail-fact { padding:12px; border:1px solid #e5e9ee; border-radius:6px; background:#fbfcfd; } .lwb-detail-fact small { display:block; color:var(--lwb-muted); font-size:var(--lwb-text-xs,12px); } .lwb-detail-fact strong { display:block; margin-top:5px; color:#334456; font-size:var(--lwb-text-base,14px); } .lwb-detail-section { padding:14px 0; border-top:1px solid var(--lwb-line); } .lwb-detail-section h3 { margin:0 0 10px; color:#5d6d7d; font-size:var(--lwb-text-sm,13px); letter-spacing:.04em; } .lwb-detail-menu { display:grid; gap:7px; } .lwb-detail-menu-row { display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid #e7ebef; border-radius:6px; color:#4d5e6f; background:#fff; font-size:var(--lwb-text-sm,13px); } .lwb-detail-menu-row b { color:var(--lwb-blue); font-size:var(--lwb-text-md,15px); } .lwb-workflow-list { display:grid; gap:7px; padding:0; margin:0; list-style:none; } .lwb-workflow-list li { display:flex; gap:8px; align-items:flex-start; color:var(--lwb-ink); font-size:var(--lwb-text-base,14px); line-height:1.5; } .lwb-workflow-list i { color:var(--lwb-blue); font-style:normal; }
      .lwb-mobile-nav-trigger,.lwb-mobile-conversation-trigger,.lwb-mobile-nav-backdrop { display:none; }
      @media (max-width:680px) { :root { --lwb-sidebar-width:0px !important; } .lwb-sidebar { position:fixed; z-index:80; top:0; bottom:0; left:0; width:248px; transform:translateX(-105%); transition:transform .18s ease; box-shadow:10px 0 30px rgba(24,39,56,.18); } .lwb-sidebar[data-mobile-open="true"] { transform:translateX(0); } .lwb-conversation-overlay,.lwb-overlay { inset:0; } .lwb-conversation-pane { position:fixed; z-index:60; top:0; bottom:0; left:0; transform:translateX(-105%); transition:transform .18s ease; box-shadow:8px 0 26px rgba(24,39,56,.18); } .lwb-conversation-overlay[data-open="true"] .lwb-conversation-pane { transform:translateX(0); } .lwb-conversation-pane-head { padding-left:var(--dsh-sidebar-inline-padding); } .lwb-conversation-backdrop { position:fixed; z-index:55; inset:0; border:0; background:rgba(24,39,56,.24); } .lwb-conversation-overlay[data-open="true"] .lwb-conversation-backdrop,.lwb-conversation-close { display:block; } .lwb-mobile-nav-trigger,.lwb-mobile-conversation-trigger { position:fixed; z-index:70; top:13px; display:grid; width:32px; height:32px; place-items:center; border:1px solid #dbe4ec; border-radius:6px; background:#fff; cursor:pointer; } .lwb-mobile-nav-trigger { left:12px; } .lwb-mobile-conversation-trigger { left:52px; } .lwb-mobile-nav-backdrop { position:fixed; z-index:75; inset:0; border:0; background:rgba(24,39,56,.24); } .lwb-overlay-head { padding-left:96px; } .lwb-page { padding:24px 16px 40px; } .lwb-page-intro,.lwb-setting-row { display:block; } .lwb-page-intro .lwb-row-actions { margin-top:14px; } .lwb-market-controls { grid-template-columns:1fr; } .lwb-pack-drawer { width:min(100%,430px); padding:20px; } }
      .lwb-dsh-settings-launcher { flex:0 0 auto; } .lwb-dsh-settings-launcher button[aria-haspopup="dialog"] { display:flex; min-height:32px; align-items:center; padding:0 11px; border:1px solid #b9d1e8; border-radius:5px; color:#245f9b; background:#f7fbff; font:inherit; cursor:pointer; } .lwb-dsh-settings-launcher button[aria-haspopup="dialog"]:hover { color:#174b7d; border-color:#8cb5dc; background:#edf6ff; } .lwb-dsh-settings-trigger { display:flex; align-items:center; gap:7px; font-size:var(--lwb-text-base,14px); font-weight:700; } body[data-ds-dark-theme] .lwb-dsh-settings-launcher button[aria-haspopup="dialog"] { border-color:#405b74; color:#9ecbff; background:#1d344a; } body[data-ds-dark-theme] .lwb-dsh-settings-launcher button[aria-haspopup="dialog"]:hover { color:#d2e8ff; background:#253f58; }

      /* Product controls share readable type and keyboard states; native settings owns its panel. */
      /* Modal drawers live inside the overlay's stacking context, below mobile navigation. */
      body:has(.lwb-overlay [aria-modal="true"]) :is(.lwb-mobile-nav-trigger,.lwb-mobile-conversation-trigger) { visibility:hidden; }
      .lwb-setting-copy { min-width:0; }
      .lwb-setting-copy > span { max-width:70ch; overflow-wrap:anywhere; }
      .lwb-setting-row { padding:20px; }
      .lwb-dsh-settings-launcher button[aria-haspopup="dialog"] { min-height:40px; padding:8px 14px; border-radius:8px; white-space:nowrap; }
      .lwb-dsh-settings-trigger { display:inline-flex; line-height:1.4; font-size:var(--lwb-text-base); }
      .lwb-dsh-settings-trigger svg { flex:none; }
      .lwb-dsh-settings-actions { display:flex; flex:0 0 auto; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:8px; }
      .lwb-dsh-account-button { min-height:40px; padding:8px 14px; border:1px solid #c6d9ec; border-radius:8px; color:#245f9b; background:#f7fbff; font:inherit; font-size:var(--lwb-text-base,14px); font-weight:700; line-height:1.4; cursor:pointer; }
      .lwb-dsh-account-button:hover { border-color:#8cb5dc; color:#174b7d; background:#edf6ff; }
      .lwb-dsh-account-button.is-signed-in { border-color:#d9b9b1; color:#9a4a3d; background:#fff8f5; }
      .lwb-dsh-account-button.is-signed-in:hover { border-color:#d79c90; color:#80392e; background:#fff0eb; }
      .lwb-dsh-account-button:disabled { opacity:.55; cursor:not-allowed; }
      body[data-ds-dark-theme] .lwb-dsh-account-button { border-color:#405b74; color:#9ecbff; background:#1d344a; }
      body[data-ds-dark-theme] .lwb-dsh-account-button:hover { border-color:#6b91b8; color:#d2e8ff; background:#253f58; }
      body[data-ds-dark-theme] .lwb-dsh-account-button.is-signed-in { border-color:#79534e; color:#ffb9ae; background:#422d2a; }
      body[data-ds-dark-theme] .lwb-dsh-account-button.is-signed-in:hover { border-color:#a16a61; color:#ffd6cf; background:#51332f; }
      .lwb-plain-button,.lwb-primary-button,.lwb-danger-button { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:38px; padding:7px 13px; line-height:1.4; }
      .lwb-plain-button:disabled,.lwb-primary-button:disabled,.lwb-danger-button:disabled { opacity:.5; cursor:not-allowed; }
      .lwb-input,.lwb-select,.lwb-market-search { min-height:38px; }
      .lwb-pack-tab { font:inherit; }
      .lwb-detail-close { min-width:32px; min-height:32px; flex:none; }
      .lwb-sidebar :is(button,a):focus-visible,.lwb-overlay :is(button,a,input,select,textarea,summary):focus-visible,.lwb-conversation-pane :is(button,input):focus-visible { outline:2px solid var(--lwb-blue); outline-offset:3px; }
      .lwb-overlay-title { flex-wrap:wrap; gap:3px 10px; }
      .lwb-overlay-head > button { flex:none; }
      .lwb-pack-grid { grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr)); }
      body[data-ds-dark-theme] .lwb-modal-title { color:var(--lwb-ink); }
      body[data-ds-dark-theme] .lwb-primary-button { color:#fff; background:#2869d8; border-color:#6898e6; }
      @media (max-width:1000px) { .lwb-market-controls { grid-template-columns:minmax(0,1fr) 120px; } .lwb-market-search { grid-column:1/-1; } }
      @media (max-width:680px) {
        .lwb-sidebar { width:264px; }
        .lwb-overlay-head { min-height:64px; gap:8px; padding-left:56px; padding-right:12px; }
        .lwb-overlay-title span { display:none; }
        .lwb-page-capability { padding:20px 16px 40px; }
        .lwb-dsh-settings-actions { justify-content:flex-start; margin-top:16px; }
        .lwb-dsh-settings-launcher { margin-top:0; }
        .lwb-setting-row > .lwb-status { margin-top:12px; }
        .lwb-market-controls { grid-template-columns:1fr; }
        .lwb-sidebar .lwb-nav-item,.lwb-plain-button,.lwb-primary-button,.lwb-danger-button { min-height:44px; }
        .lwb-input,.lwb-select,.lwb-market-search { font-size:16px; }
        .lwb-purchase-heading,.lwb-payment-status { display:grid; }
        .lwb-payment-status .lwb-row-actions { justify-content:flex-start; }
        .lwb-purchase-grid { grid-template-columns:1fr; }
        .lwb-settings-group-head { padding:14px 16px; }
        .lwb-settings-group-body { padding:16px; }
        .lwb-account-form { padding:18px; }
        .lwb-account-mode { flex-wrap:wrap; }
        .lwb-account-switch-button { width:100%; min-height:42px; }
        .lwb-account-submit-actions .lwb-primary-button { width:100%; }
      }
      /* Pack details: a native modal keeps background controls inert and traps focus. */
      .lwb-pack-dialog { box-sizing:border-box; position:fixed; inset:0 0 0 auto; margin:0; width:min(760px,100vw); max-width:100vw; height:100dvh; max-height:100dvh; padding:0; border:0; border-left:1px solid var(--lwb-line); border-radius:0; background:var(--lwb-surface); color:var(--lwb-ink); font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif; font-size:14px; line-height:1.6; box-shadow:-16px 0 60px rgba(20,34,49,.14); overflow:hidden; }
      .lwb-pack-dialog[open] { display:flex; flex-direction:column; }
      .lwb-pack-dialog::backdrop { background:rgba(15,23,42,.38); backdrop-filter:blur(3px); }
      .lwb-pack-dialog * { box-sizing:border-box; }
      .lwb-pack-dialog-head { display:flex; flex:none; align-items:flex-start; justify-content:space-between; gap:16px; padding:26px 28px 22px; border-bottom:1px solid var(--lwb-line); }
      .lwb-pack-heading { display:flex; align-items:center; gap:14px; min-width:0; }
      .lwb-pack-heading > div { min-width:0; }
      .lwb-pack-heading h2 { margin:3px 0 0; font-size:24px; line-height:1.35; letter-spacing:-.02em; overflow-wrap:anywhere; }
      .lwb-pack-emblem { display:grid; width:48px; height:48px; flex:none; place-items:center; border:1px solid color-mix(in srgb,var(--lwb-blue) 20%,transparent); border-radius:14px; color:var(--lwb-blue); background:var(--lwb-blue-soft); }
      .lwb-pack-emblem svg { width:26px; height:26px; }
      .lwb-pack-meta { margin:0; color:var(--lwb-muted); font-size:12px; }
      .lwb-pack-dialog-body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:24px 28px; scrollbar-gutter:stable; }
      .lwb-pack-overview { margin-bottom:26px; }
      .lwb-pack-intro { margin:12px 0 0; font-size:15px; line-height:1.85; color:var(--lwb-ink); }
      .lwb-pack-content-section { margin:0 0 26px; }
      .lwb-pack-dialog h3 { margin:0 0 12px; color:var(--lwb-ink); font-size:16px; font-weight:650; line-height:1.5; }
      .lwb-pack-journey { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; padding:0; margin:0; list-style:none; }
      .lwb-pack-journey li { display:flex; align-items:center; gap:9px; padding:10px 12px; border-radius:8px; background:var(--lwb-page); color:var(--lwb-ink); font-size:13px; }
      .lwb-pack-journey li > span { color:var(--lwb-blue); font-size:11px; font-weight:750; font-variant-numeric:tabular-nums; }
      .lwb-pack-section-note { margin:10px 0 0; color:var(--lwb-muted); font-size:13px; }
      .lwb-pack-features { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .lwb-pack-feature { display:flex; gap:12px; padding:16px 14px; border:1px solid var(--lwb-line); border-radius:12px; background:var(--lwb-surface); }
      .lwb-pack-feature > div { min-width:0; }
      .lwb-pack-feature h4 { margin:0 0 4px; color:var(--lwb-ink); font-size:14px; line-height:1.5; font-weight:650; }
      .lwb-pack-feature p { margin:0; color:var(--lwb-muted); font-size:14px; line-height:1.65; }
      .lwb-pack-feature-icon { display:grid; flex:none; width:34px; height:34px; place-items:center; border-radius:9px; color:var(--lwb-blue); background:var(--lwb-blue-soft); }
      .lwb-pack-feature[data-tone="violet"] .lwb-pack-feature-icon { color:light-dark(#7653ba,#c4a7ff); background:light-dark(#f3eefb,#31263f); }
      .lwb-pack-feature[data-tone="orange"] .lwb-pack-feature-icon { color:light-dark(#b36a19,#f6bd7c); background:light-dark(#fdf3e7,#3e3024); }
      .lwb-pack-feature[data-tone="green"] .lwb-pack-feature-icon { color:var(--lwb-green); background:var(--lwb-green-soft); }
      .lwb-pack-feature[data-tone="pink"] .lwb-pack-feature-icon { color:light-dark(#b04a87,#efacd4); background:light-dark(#fceef6,#41283a); }
      .lwb-pack-feature[data-tone="red"] .lwb-pack-feature-icon { color:light-dark(#bd534d,#ffb1aa); background:light-dark(#fcefed,#412b2a); }
      .lwb-pack-dialog { color-scheme:light; }
      body[data-ds-dark-theme] .lwb-pack-dialog { color-scheme:dark; }
      .lwb-pack-start-guide { padding:18px 20px; margin-bottom:20px; border:1px solid var(--lwb-line); border-radius:12px; background:var(--lwb-page); }
      .lwb-pack-start-guide ul { padding-left:18px; margin:0; display:grid; gap:8px; color:var(--lwb-muted); font-size:13px; }
      .lwb-pack-start-guide li::marker { color:var(--lwb-blue); }
      .lwb-pack-maintenance { padding-top:16px; border-top:1px solid var(--lwb-line); }
      .lwb-pack-maintenance summary { width:fit-content; cursor:pointer; color:var(--lwb-muted); font-size:13px; }
      .lwb-pack-maintenance[open] summary { margin-bottom:12px; color:var(--lwb-ink); }
      .lwb-pack-maintenance .lwb-modal-copy { font-size:13px; }
      .lwb-pack-dialog-foot { flex:none; padding:16px 28px 20px; border-top:1px solid var(--lwb-line); background:var(--lwb-surface); }
      .lwb-pack-footer-actions { display:flex; gap:16px; align-items:center; justify-content:space-between; }
      .lwb-pack-footer-actions > p { margin:0; flex:1; color:var(--lwb-muted); font-size:12px; }
      .lwb-pack-footer-actions .lwb-row-actions { flex:none; }
      .lwb-pack-footer-actions button { min-height:42px; padding:9px 18px; font-size:14px; }
      .lwb-pack-feedback { margin:0 0 12px; padding:10px 12px; border-radius:8px; background:var(--lwb-blue-soft); color:var(--lwb-ink); font-size:13px; overflow-wrap:anywhere; }
      .lwb-pack-feedback[data-tone="error"] { color:light-dark(#9a3434,#ffc0ba); background:light-dark(#fff0ee,#482b2b); }
      .lwb-pack-feedback[data-tone="success"] { color:var(--lwb-green); background:var(--lwb-green-soft); }
      .lwb-pack-dialog :is(button,summary,[tabindex]):focus-visible { outline:2px solid var(--lwb-blue); outline-offset:3px; }
      @media (max-width:560px) {
        .lwb-pack-dialog-head { padding:20px 18px 16px; gap:10px; }
        .lwb-pack-heading { gap:10px; }
        .lwb-pack-heading h2 { font-size:20px; }
        .lwb-pack-emblem { width:40px; height:40px; border-radius:11px; }
        .lwb-pack-dialog-body { padding:20px 18px; }
        .lwb-pack-features { grid-template-columns:1fr; }
        .lwb-pack-journey { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .lwb-pack-dialog-foot { padding:14px 18px max(16px,env(safe-area-inset-bottom)); }
        .lwb-pack-footer-actions { align-items:stretch; flex-direction:column; gap:10px; }
        .lwb-pack-footer-actions .lwb-row-actions { justify-content:flex-end; }
      }

    `;

    function installStyle() {
      if (document.getElementById('lwb-workbench-style')) return;
      const style = document.createElement('style');
      style.id = 'lwb-workbench-style';
      style.setAttribute('data-plugin', '@scitiger-ai/lwb-dsh-bundle');
      style.textContent = css;
      document.head.appendChild(style);
    }
    function installProductMetadata() {
      const previousTitle = document.title;
      const productTitle = '老傅工作台';
      const restoreTitle = () => { if (document.title !== productTitle) document.title = productTitle; };
      restoreTitle();
      const normalize = (root) => {
        if (!root || root.nodeType !== Node.TEXT_NODE || !root.nodeValue) return;
        const next = root.nodeValue.replace(/\btok\/s\b/g, 'tokens/s').replace(/\btok\b/g, 'token');
        if (next !== root.nodeValue) root.nodeValue = next;
      };
      const rewrite = (root) => {
        if (!root) return;
        if (root.nodeType === Node.TEXT_NODE) { normalize(root); return; }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) normalize(node);
      };
      rewrite(document.body);
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'characterData') normalize(record.target);
          else record.addedNodes.forEach((node) => rewrite(node));
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      const titleObserver = new MutationObserver(restoreTitle);
      titleObserver.observe(document.head, { subtree: true, childList: true, characterData: true });
      return () => { observer.disconnect(); titleObserver.disconnect(); document.title = previousTitle; };
    }
    function glyph(value) {
      const Icon = { '◌': IconNewChatOutlineRegular, '▦': IconCordisPluginOutlineRegular, '⚙': IconSettingsOutlineRegular }[value];
      return h('span', { className: 'lwb-nav-icon', 'aria-hidden': 'true' }, Icon ? h(Icon, { size: 18 }) : value);
    }
    function button(className, label, onClick, props = {}) {
      return h('button', Object.assign({ type: 'button', className, onClick }, props), label);
    }
    function statusLabel(status, copy = currentLwbCopy()) {
      if (status === 'mounted') return [copy.mounted, 'good'];
      if (status === 'loaded') return [copy.active, 'good'];
      if (status === 'available') return [copy.available, 'warm'];
      if (status === 'unavailable') return [copy.unavailable, 'muted'];
      if (status === 'stopped') return [copy.stopped, 'muted'];
      return [copy.installed, 'warm'];
    }
    function pageChrome(page, selected, copy = currentLwbCopy()) {
      if (page === 'capability' && selected) {
        return {
          title: selected.pack.name,
          hint: selected.menu.label,
          intro: selected.pack.description || copy.capabilityHint,
          eyebrow: 'CAPABILITY PACK',
          ariaLabel: `${selected.pack.name} · ${selected.menu.label}`,
        };
      }
      const pages = {
        packs: { title: copy.packs, hint: copy.packsHint, intro: copy.packsIntro, eyebrow: 'CAPABILITY PACKS' },
        settings: { title: copy.settings, hint: copy.settingsHint, intro: copy.settingsIntro, eyebrow: 'WORKBENCH' },
        capability: { title: copy.capability, hint: copy.capabilityHint, intro: copy.capabilityIntro, eyebrow: 'CAPABILITY PACK' },
      };
      const current = pages[page] || { title: copy.conversation, hint: '', intro: '', eyebrow: 'WORKBENCH' };
      return Object.assign({ ariaLabel: current.title }, current);
    }

    function createConversation(workspaceId) {
      try {
        if (typeof services?.uiWorkspace?.startSession !== 'function') {
          throw new Error(currentLwbCopy().createConversationFailed);
        }
        // DSH owns the selection policy: explicit workspace, current session's
        // workspace, recent workspace, then its native empty-session state.
        services.uiWorkspace.startSession(workspaceId);
        showConversation();
      } catch (error) { window.alert(error?.message || currentLwbCopy().createConversationFailed); }
    }

    /**
     * Bind one root selector Hook to a projection recomputed only when the
     * underlying snapshot changes. The official Workspace browser selects whole
     * snapshots (`useSessions(state => state)`), so the wrapper must keep
     * reference identity stable between store updates or it re-renders forever.
     */
    function projectedHook(hook, project) {
      let source;
      let projected;
      const stable = (value) => {
        if (value === source) return projected;
        source = value;
        projected = project(value);
        return projected;
      };
      return (selector, equal) => hook((value) => selector(stable(value)), equal);
    }

    /**
     * Whether one Session directory sits inside a pack-owned Workspace.
     *
     * A pack may run each task in its own directory below that Workspace (one
     * directory per model run, for example). Those Sessions are created while
     * the browser is open, so the ownership index read at page load cannot name
     * them yet; their directory is the durable fact that outlives the read.
     * @param cwd - the Session's working directory, as the list snapshot reports it.
     * @param roots - pack Workspace directories from `lwbPacks/visibility`.
     * @returns true when `cwd` is one of those directories or lies below one.
     */
    function insidePackWorkspace(cwd, roots) {
      if (typeof cwd !== 'string' || cwd === '') return false;
      for (const root of roots) {
        if (typeof root !== 'string' || root === '') continue;
        let end = root.length;
        while (end > 0 && (root[end - 1] === '/' || root[end - 1] === '\\')) end -= 1;
        const base = root.slice(0, end);
        // The separator is required, so a sibling directory sharing the prefix
        // (`/root/pack-2` beside `/root/pack`) is not swallowed.
        if (base !== '' && (cwd === base || cwd.startsWith(`${base}/`) || cwd.startsWith(`${base}\\`))) return true;
      }
      return false;
    }

    /** Drop pack-owned root Sessions from one Session list snapshot. */
    function projectSessionList(list, isPackSession) {
      const ids = list?.ids;
      const hidden = (id) => isPackSession(id, list?.byId?.[id]);
      if (!Array.isArray(ids) || !ids.some(hidden)) return list;
      const kept = [];
      const byId = {};
      for (const id of ids) {
        if (hidden(id)) continue;
        kept.push(id);
        byId[id] = list.byId[id];
      }
      return Object.assign({}, list, { ids: kept, byId });
    }

    /** Drop pack-owned Workspaces, and their Sessions, from one Workspace snapshot. */
    function projectWorkspaceList(snapshot, isPackWorkspace, isPackSession) {
      const items = snapshot?.items;
      if (!Array.isArray(items)) return snapshot;
      let changed = false;
      const kept = [];
      for (const workspace of items) {
        if (isPackWorkspace(workspace)) { changed = true; continue; }
        const sessionIds = workspace.sessionIds || [];
        if (!sessionIds.some((id) => isPackSession(id))) { kept.push(workspace); continue; }
        changed = true;
        kept.push(Object.assign({}, workspace, { sessionIds: sessionIds.filter((id) => !isPackSession(id)) }));
      }
      return changed ? Object.assign({}, snapshot, { items: kept }) : snapshot;
    }

    /**
     * The official global panel rows (Plugins and any later registrant) the
     * conversation column shows. Upstream `ui-sidebar` owns the seat and the row
     * chrome; this composition disables that shell and renders the seat itself,
     * so it reads the same registry the official shell reads. Rows are compared
     * by content because `entriesOfSlot` builds a fresh array per call and the
     * React store needs one stable snapshot between changes.
     */
    const conversationPanels = { rows: [], listeners: new Set() };
    /**
     * Resolve one slot entry's label, which a registrant supplies as a function
     * when it must follow locale changes. Same contract as the official
     * `resolveSlotLabel`; inlined because it is one pure expression and this
     * column needs no other part of the slot client API.
     */
    function resolvePanelLabel(label) { return typeof label === 'function' ? label() : label; }
    /** @returns the current `sidebar.panellist` rows, ordered and label-resolved. */
    function readConversationPanels() {
      const entries = services?.slots?.entriesOfSlot?.('sidebar.panellist');
      if (!Array.isArray(entries)) return [];
      return entries
        .map((entry) => ({
          id: entry?.options?.id,
          order: typeof entry?.options?.order === 'number' ? entry.options.order : 0,
          label: resolvePanelLabel(entry?.options?.label),
        }))
        .filter((row) => typeof row.id === 'string' && row.id !== '')
        .sort((left, right) => left.order - right.order)
        .map((row) => ({ id: row.id, label: row.label || row.id }));
    }
    function syncConversationPanels() {
      const next = readConversationPanels();
      const previous = conversationPanels.rows;
      if (previous.length === next.length && previous.every((row, index) => row.id === next[index].id && row.label === next[index].label)) return;
      conversationPanels.rows = next;
      conversationPanels.listeners.forEach((listener) => listener());
    }
    function useConversationPanels() {
      return React.useSyncExternalStore(
        (listener) => { conversationPanels.listeners.add(listener); return () => conversationPanels.listeners.delete(listener); },
        () => conversationPanels.rows,
        () => conversationPanels.rows,
      );
    }
    /**
     * Whether the official main slot currently registers one panel id. Selection
     * is guarded because `layout.selectPanel` throws for an unregistered key,
     * and a row can outlive the page that addresses it.
     */
    function conversationPanelRegistered(panelId) {
      const entries = services?.slots?.entries?.('main');
      return Array.isArray(entries) && entries.some((entry) => entry?.options?.key === panelId);
    }
    /**
     * Select one official main panel; an unregistered id is ignored, not thrown.
     * The call stays a method call on the service: `LayoutController.selectPanel`
     * reads its own fields (`hasMainPanel`, `panels`), so a reference detached
     * from the service would run with `this === undefined`.
     */
    function selectConversationPanel(panelId) {
      const layout = services?.layout;
      if (!layout || typeof layout.selectPanel !== 'function') return;
      if (panelId !== null && !conversationPanelRegistered(panelId)) return;
      layout.selectPanel(panelId);
    }
    /** Return the frame to the Conversation when a panel is still selected. */
    function clearConversationPanel() {
      const active = services?.layout?.panelInfo?.getSnapshot?.().activePanelId;
      if (active === undefined || active === null) return;
      selectConversationPanel(null);
    }
    /** Stand-in for the layout root binding when a composition lacks ui-layout. */
    function useNoActivePanel(selector) { return selector({ activePanelId: null }); }

    /**
     * The conversation module's left column: the official panel rows, the
     * official Workspace browser through the `sidebar.workspaces` seat, and the
     * official-shaped New Session control. LWB declares the seats (upstream
     * `ui-sidebar` is disabled for this composition) and hides capability-pack
     * Sessions, which the official browser has no way to know about.
     */
    function ConversationOverlay({ renderSlot, useSessions, useWorkspaces, usePanelInfo }) {
      const rootRef = React.useRef(null);
      const state = useProduct();
      const copy = useLwbCopy();
      // Host-owned membership of every capability-pack workspace and root
      // Session. It is absent until the ownership index has been read, and the
      // seat waits for it rather than letting pack Sessions flash into history.
      const catalog = usePackCatalog();
      const internal = catalog.visibility;
      // The official global panel rows and the layout's own selection, so the
      // row state stays the official one instead of a private mirror.
      const panels = useConversationPanels();
      const useActivePanel = typeof usePanelInfo === 'function' ? usePanelInfo : useNoActivePanel;
      const activePanel = useActivePanel((info) => info.activePanelId);
      const shortcutRows = useObservable(services?.shortcuts?.catalog, undefined);
      const newSessionShortcut = React.useMemo(
        () => (Array.isArray(shortcutRows) ? shortcutRows.find((row) => row?.id === 'session.new') : undefined),
        [shortcutRows],
      );

      React.useLayoutEffect(() => {
        const frame = rootRef.current?.closest?.('[data-shell-overlay]')?.parentElement;
        if (!frame) return undefined;
        frame.dataset.lwbConversationActive = 'true';
        return () => { delete frame.dataset.lwbConversationActive; };
      }, []);

      const packSessionHooks = React.useMemo(() => {
        if (!internal) return undefined;
        const sessionIds = new Set(internal.sessionIds || []);
        const workspaceIds = new Set(internal.workspaceIds || []);
        const workspacePaths = new Set(internal.workspacePaths || []);
        const roots = [...workspacePaths];
        return {
          // The id set is read once per catalog refresh, so a Session a pack
          // creates afterwards is only recognizable by its directory. Both facts
          // are durable host-owned state: the pack never writes the index itself
          // for a Session the browser has not seen, and its Workspace directory
          // outlives every task run.
          isPackSession: (id, summary) => sessionIds.has(id) || insidePackWorkspace(summary?.cwd, roots),
          isPackWorkspace: (workspace) => workspacePaths.has(workspace.path) || workspaceIds.has(workspace.workspaceId),
        };
      }, [internal]);
      // Owner props win in the renderer's merge order, so handing the official
      // browser its own two root Hooks is what keeps pack Sessions out of the
      // list without patching upstream or reimplementing the browser.
      const seatUseSessions = React.useMemo(
        () => (useSessions && packSessionHooks
          ? projectedHook(useSessions, (list) => projectSessionList(list, packSessionHooks.isPackSession))
          : undefined),
        [useSessions, packSessionHooks],
      );
      const seatUseWorkspaces = React.useMemo(
        () => (useWorkspaces && packSessionHooks
          ? projectedHook(useWorkspaces, (snapshot) => projectWorkspaceList(snapshot, packSessionHooks.isPackWorkspace, packSessionHooks.isPackSession))
          : undefined),
        [useWorkspaces, packSessionHooks],
      );

      return h('section', { ref: rootRef, className: 'lwb-conversation-overlay', 'data-open': state.conversationPanelOpen ? 'true' : 'false', 'aria-label': copy.conversationModule },
        h('button', { type: 'button', className: 'lwb-conversation-backdrop', 'aria-label': copy.closeConversationList, onClick: () => updateProduct({ conversationPanelOpen: false }, false) }),
        h('aside', { className: 'lwb-conversation-pane', 'aria-label': copy.conversationHistory },
          h('header', { className: 'lwb-conversation-pane-head' },
            h('strong', null, copy.session),
            h('button', { type: 'button', className: 'lwb-conversation-close', title: copy.closeConversationList, 'aria-label': copy.closeConversationList, onClick: () => updateProduct({ conversationPanelOpen: false }, false) }, '×'),
          ),
          // The official column's first action. Upstream hard-codes this control
          // in the sidebar shell it owns, so it cannot be borrowed through a
          // seat; the label, shortcut hint, and action are the official ones
          // (`uiWorkspace.startSession`), and it is usable from the first frame.
          h('div', { className: 'lwb-conversation-actions' },
            h('button', {
              type: 'button', className: 'lwb-conversation-new',
              title: copy.newSessionLabel, 'aria-label': copy.newSessionLabel,
              'aria-keyshortcuts': newSessionShortcut?.aria,
              onClick: () => createConversation(),
            },
              h(IconNewChatOutlineRegular, { size: 16, 'aria-hidden': true }),
              h('span', null, copy.newSession),
              newSessionShortcut && Array.isArray(newSessionShortcut.keys) && newSessionShortcut.keys.length > 0
                ? h('span', { className: 'lwb-conversation-new-key', 'aria-hidden': true }, h(ShortcutKeys, { keys: newSessionShortcut.keys }))
                : null,
            ),
          ),
          // One row per `sidebar.panellist` registration, in the official order.
          // The glyph is the registrant's own component; the row chrome, the
          // label, and the selection state are the shell's, exactly as they are
          // in the official sidebar.
          panels.length > 0 && h('nav', { className: 'lwb-conversation-panels', 'aria-label': copy.conversationPanels },
            panels.map((panel) => {
              const active = activePanel === panel.id;
              return h('button', {
                key: panel.id, type: 'button', className: 'lwb-conversation-panel',
                'data-active': active ? 'true' : 'false', 'aria-current': active ? 'page' : undefined,
                title: panel.label, 'aria-label': panel.label,
                onClick: () => selectConversationPanel(panel.id),
              },
                h('span', { className: 'lwb-conversation-panel-glyph', 'aria-hidden': 'true' },
                  renderSlot('sidebar.panellist', { size: 16, active }, { only: panel.id })),
                h('span', { className: 'lwb-conversation-panel-label' }, panel.label),
              );
            }),
          ),
          h('div', { className: 'lwb-conversation-region' },
            internal
              ? renderSlot('sidebar.workspaces', Object.assign(
                { wide: true, expandSidebar: () => {} },
                seatUseSessions ? { useSessions: seatUseSessions } : {},
                seatUseWorkspaces ? { useWorkspaces: seatUseWorkspaces } : {},
              ))
              : h('div', { className: 'lwb-conversation-loading', role: catalog.phase === 'error' ? 'alert' : 'status' },
                catalog.phase === 'error' ? (catalog.error || copy.operationFailed) : copy.readingWorkspaces),
          ),
        ),
      );
    }

    function LwbRuntimeSettingsTrigger({ openSettings }) {
      const copy = useLwbCopy();
      return h('button', { type: 'button', className: 'lwb-dsh-settings-trigger', 'aria-haspopup': 'dialog', onClick: openSettings }, h(IconSettingsOutlineRegular, { size: 18, 'aria-hidden': true }), h('span', null, copy.openRuntimeSettings));
    }

    function LwbSidebarExpand({ className = 'lwb-expand' }) {
      const copy = useLwbCopy();
      return button(className, h(IconPanelLeftOutlineRegular, { size: 18 }),
        () => services?.layout?.toggleSidebar?.(), { 'aria-label': copy.expandSidebar, title: copy.expandSidebar });
    }

    // Render outside the scrolling sidebar so the flyout is never clipped by
    // its compact column. This state is temporary, unlike expandedPacks.
    function LwbPackFlyout({ pack, anchor, state, onClose }) {
      const panel = React.useRef(null);
      const [position, setPosition] = React.useState({ left: 0, top: 0 });
      React.useLayoutEffect(() => {
        const place = () => {
          if (!anchor.isConnected) { onClose(); return; }
          const bounds = anchor.getBoundingClientRect();
          const box = panel.current.getBoundingClientRect();
          setPosition({
            left: Math.max(8, Math.min(bounds.right + 8, window.innerWidth - box.width - 8)),
            top: Math.max(8, Math.min(bounds.top, window.innerHeight - box.height - 8)),
          });
        };
        place();
        const selected = panel.current.querySelector('[aria-current="page"]') || panel.current.querySelector('button');
        selected?.focus();
        const outside = (event) => {
          if (!panel.current.contains(event.target) && !anchor.contains(event.target)) onClose();
        };
        const escape = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); }
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('focusin', outside);
        document.addEventListener('keydown', escape, true);
        window.addEventListener('resize', place);
        document.addEventListener('scroll', place, true);
        return () => {
          document.removeEventListener('pointerdown', outside, true);
          document.removeEventListener('focusin', outside);
          document.removeEventListener('keydown', escape, true);
          window.removeEventListener('resize', place);
          document.removeEventListener('scroll', place, true);
        };
      }, [anchor, pack, onClose]);
      const moveFocus = (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [...panel.current.querySelectorAll('button')];
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      };
      return createPortal(h('div', {
        ref: panel, id: `lwb-cap-flyout-${pack.id}`, className: 'lwb-cap-flyout',
        role: 'dialog', 'aria-modal': 'false', 'aria-label': pack.name,
        style: position, onKeyDown: moveFocus,
      }, h('div', { className: 'lwb-cap-flyout-title' }, pack.name),
      h('nav', { className: 'lwb-cap-flyout-items', 'aria-label': pack.name }, pack.menus.map((item) => {
        const route = capabilityRoute(pack.id, item.id);
        const active = state.page === 'capability' && state.capabilityPage === route;
        return h('button', {
          key: route, type: 'button', className: 'lwb-nav-item', title: item.label,
          'data-tone': item.tone || 'blue', 'data-active': active ? 'true' : 'false',
          'aria-current': active ? 'page' : undefined,
          onClick: () => { onClose(true); navTo('capability', route); },
        }, glyph(item.glyph), h('span', { className: 'lwb-nav-label' }, item.label));
      }))), document.body);
    }

    function LwbSidebar({ collapsed, width }) {
      const state = useProduct();
      const copy = useLwbCopy();
      const catalog = usePackCatalog();
      const [mobile, setMobile] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 680px)').matches);
      // Read once per mount: null means no recorded preference yet, so the
      // first-run reveal rules below still apply. An empty set is a real answer.
      const navPreference = React.useRef(readNavPreference());
      const [expandedPacks, setExpandedPacks] = React.useState(() => new Set(navPreference.current || undefined));
      const knownPackIds = React.useRef(new Set());
      /** The pack whose capability route is already accounted for; undefined means "not on one". */
      const revealedPackId = React.useRef(undefined);
      /** Writing before the catalog is ready would erase a preference with an empty frame. */
      const navReady = React.useRef(false);
      const sidebarCollapsed = collapsed && !mobile && !state.mobileNavOpen;
      const wide = !sidebarCollapsed;
      const packs = catalog.packs;
      const activePackId = state.page === 'capability' ? capabilityAtRoute(packs, state.capabilityPage)?.pack.id : undefined;
      const [flyout, setFlyout] = React.useState(null);
      const closeFlyout = React.useCallback((restoreFocus = false) => {
        if (restoreFocus && flyout?.anchor.isConnected) flyout.anchor.focus();
        setFlyout(null);
      }, [flyout]);
      React.useEffect(() => { setFlyout(null); }, [wide, width, packs, catalog.phase, state.page, state.capabilityPage]);

      React.useEffect(() => {
        document.documentElement.style.setProperty('--lwb-sidebar-width', `${width}px`);
      }, [width]);
      React.useEffect(() => {
        const query = window.matchMedia('(max-width: 680px)');
        const update = () => setMobile(query.matches);
        query.addEventListener?.('change', update);
        return () => query.removeEventListener?.('change', update);
      }, []);
      React.useEffect(() => {
        if (!navReady.current) return;
        navPreference.current = expandedPacks;
        writeNavPreference(expandedPacks);
      }, [expandedPacks]);
      React.useEffect(() => {
        // A pending or failed catalog says nothing about which packs exist, so it
        // must not prune the recorded groups — an RPC hiccup would erase them.
        if (catalog.phase !== 'ready') return;
        const current = new Set(packs.map((pack) => pack.id));
        const previousPackIds = knownPackIds.current;
        const firstCatalog = previousPackIds.size === 0;
        const activePack = activePackId && current.has(activePackId) ? activePackId : undefined;
        // Entering a capability route reveals that pack. A catalog refresh is not
        // an entry and a restored route is not an entry either when the user has a
        // recorded preference, so a group closed by hand stays closed.
        const revealActive = Boolean(activePack) && revealedPackId.current === undefined && (firstCatalog ? !navPreference.current : true);
        setExpandedPacks((previous) => {
          const next = new Set([...previous].filter((id) => current.has(id)));
          if (firstCatalog) {
            if (packs.length === 1 && !navPreference.current) next.add(packs[0].id);
          } else {
            for (const pack of packs) if (!previousPackIds.has(pack.id)) next.add(pack.id);
          }
          if (revealActive) next.add(activePack);
          if (next.size === previous.size && [...next].every((id) => previous.has(id))) return previous;
          return next;
        });
        knownPackIds.current = current;
        revealedPackId.current = activePack;
        navReady.current = true;
      }, [packs, activePackId, catalog.phase]);

      const navItem = (id, label, symbol, count) => h('button', {
        key: id, type: 'button', className: 'lwb-nav-item', title: label,
        'data-icon': id, 'aria-label': label, 'aria-current': state.page === id ? 'page' : undefined,
        'data-active': state.page === id ? 'true' : 'false',
        onClick: () => navTo(id),
      }, glyph(symbol), wide && h('span', { className: 'lwb-nav-label' }, label), wide && count !== undefined && h('span', { className: 'lwb-nav-count' }, String(count)));
      const togglePack = (pack, anchor) => {
        if (!wide) {
          setFlyout((previous) => previous?.id === pack.id ? null : { id: pack.id, anchor });
          return;
        }
        setExpandedPacks((previous) => {
          const next = new Set(previous);
          if (next.has(pack.id)) next.delete(pack.id);
          else next.add(pack.id);
          return next;
        });
      };
      const capabilityGroups = packs.map((pack) => {
        const expanded = expandedPacks.has(pack.id);
        const active = activePackId === pack.id;
        const menuId = `lwb-cap-menu-${pack.id}`;
        return h('section', { key: pack.id, className: 'lwb-cap-group', 'data-active': active ? 'true' : 'false', 'data-expanded': expanded ? 'true' : 'false' },
          h('button', {
            type: 'button', className: 'lwb-cap-toggle', title: pack.name,
            'aria-label': wide ? (expanded ? copy.collapsePack(pack.name) : copy.expandPack(pack.name)) : pack.name,
            'aria-expanded': wide ? expanded : flyout?.id === pack.id,
            'aria-controls': wide ? menuId : flyout?.id === pack.id ? `lwb-cap-flyout-${pack.id}` : undefined,
            'aria-haspopup': wide ? undefined : 'dialog',
            onClick: (event) => togglePack(pack, event.currentTarget),
            onKeyDown: (event) => {
              if (!wide && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault(); setFlyout({ id: pack.id, anchor: event.currentTarget });
              }
            },
          }, h('span', { className: 'lwb-cap-mark', 'aria-hidden': 'true' }, pack.name.slice(0, 1)), wide && h('span', { className: 'lwb-nav-label' }, pack.name), wide && h('span', { className: 'lwb-cap-chevron', 'aria-hidden': 'true' }, h(IconChevronLeftOutlineRegular, { size: 14 }))),
          wide && expanded && h('div', { id: menuId, className: 'lwb-cap-menu' }, pack.menus.map((item) => h('button', {
            key: capabilityRoute(pack.id, item.id), type: 'button', className: 'lwb-nav-item', title: item.label,
            'data-tone': item.tone || 'blue', 'aria-label': item.label,
            'aria-current': state.page === 'capability' && state.capabilityPage === capabilityRoute(pack.id, item.id) ? 'page' : undefined,
            'data-active': state.page === 'capability' && state.capabilityPage === capabilityRoute(pack.id, item.id) ? 'true' : 'false',
            onClick: () => navTo('capability', capabilityRoute(pack.id, item.id)),
          }, glyph(item.glyph), h('span', { className: 'lwb-nav-label' }, item.label)))),
        );
      });

      const flyoutPack = !wide && flyout && packs.find((pack) => pack.id === flyout.id);
      // A zero-width column is the desktop hidden-sidebar contract: the frame
      // keeps no rail there, and every LWB surface starts at the window's left
      // edge, covering the frame's own window-chrome seat. The reopen control
      // therefore leaves the clipped column, is portalled to the body above the
      // shell overlay layer, and is positioned by the stylesheet (macOS window
      // chrome, Windows caption). The same stylesheet pads LWB's top-left chrome
      // by the frame's published leading clearance so page titles clear the
      // traffic lights while the column is hidden.
      const desktopCollapsed = sidebarCollapsed && width === 0;
      return h('aside', { className: 'lwb-sidebar', 'data-collapsed': sidebarCollapsed ? 'true' : 'false', 'data-mobile-open': state.mobileNavOpen ? 'true' : 'false', 'aria-label': copy.workbenchFeatures },
        h('div', { className: 'lwb-sidebar-head' },
          h('button', { type: 'button', className: 'lwb-brand', title: '老傅工作台', onClick: () => navTo('conversation') },
            h(LwbBrandMark, { className: 'lwb-brand-mark' }),
            wide && h('span', { className: 'lwb-brand-copy' }, h('strong', null, '老傅工作台'), h('small', null, 'Laofu Workbench')),
          ),
          wide ? button('lwb-collapse', h(IconChevronLeftOutlineRegular, { size: 18 }),
            () => mobile ? updateProduct({ mobileNavOpen: false }) : services?.layout?.toggleSidebar?.(),
            { 'aria-label': mobile ? copy.closeNavigation : copy.collapseSidebar, title: mobile ? copy.closeNavigation : copy.collapseSidebar })
            : h(LwbSidebarExpand),
        ),
        h('nav', { className: 'lwb-nav-group', 'aria-label': copy.workbenchFeatures },
          wide && h('div', { className: 'lwb-nav-caption' }, copy.workbench),
          navItem('conversation', copy.conversation, '◌'),
          navItem('packs', copy.packs, '▦'),
          navItem('settings', copy.settings, '⚙'),
        ),
        packs.length > 0 && h('nav', { className: 'lwb-nav-group lwb-capability-nav', 'aria-label': copy.loadedPacks },
          wide && h('div', { className: 'lwb-nav-caption' }, copy.loadedPacks),
          capabilityGroups,
        ),
        h('div', { className: 'lwb-sidebar-foot', title: copy.localWorkbench }, h('span', { className: 'lwb-user-avatar' }, '老'), wide && h('span', null, copy.localWorkbench)),
        flyoutPack && h(LwbPackFlyout, { key: flyoutPack.id, pack: flyoutPack, anchor: flyout.anchor, state, onClose: closeFlyout }),
        desktopCollapsed && createPortal(h(LwbSidebarExpand, { className: 'lwb-desktop-expand' }), document.body),
      );
    }

    async function packOperation(method, request) {
      const response = await services.connection.rpc.call('/api', `lwbPacks/${method}`, { args: { request } });
      if (!response?.ok) throw new Error(response?.error?.message || '能力包操作失败。');
      return response.value;
    }

    function PackWorkspaceSettings({ pack }) {
      const copy = useLwbCopy();
      const [message, setMessage] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [confirmation, setConfirmation] = React.useState(null);
      React.useEffect(() => { setMessage(''); setConfirmation(null); }, [pack.id, pack.status]);
      const execute = async (method) => {
        if (busy) return;
        setBusy(true); setMessage('');
        try {
          const value = await packOperation(method, { id: pack.id, confirm: true });
          setMessage(method === 'clearData' ? `业务数据已清空。可恢复副本：${value.retainedDataPath}`
            : '工作区注册已解除，文件和历史记录保留。');
          setConfirmation(null);
          await refreshPackCatalog({ retain: true });
        } catch (error) { setMessage(error.message); }
        finally { setBusy(false); }
      };
      return h('details', { className: 'lwb-pack-maintenance' },
        h('summary', null, copy.packDataManagement),
        pack.status === 'loaded' && h('p', { className: 'lwb-modal-copy' }, copy.packManageHint),
        h('p', { className: 'lwb-modal-copy' }, '加载后自动使用专属工作区，AI 任务沿用 DSH 的模型配置。卸载会保留工作区和数据。'),
        pack.status !== 'loaded' && h('div', { className: 'lwb-row-actions' },
          h('button', { type: 'button', className: 'lwb-plain-button', disabled: busy, onClick: () => setConfirmation('clearData') }, '清空业务数据'),
          h('button', { type: 'button', className: 'lwb-plain-button', disabled: busy, onClick: () => setConfirmation('unregisterWorkspace') }, '解除工作区注册')),
        confirmation && h('div', { role: 'alert' },
          h('p', null, confirmation === 'clearData' ? '清空该包的账号、素材、内容产物、任务及安排？保留工作区注册、连接配置和可恢复副本。'
            : '解除工作区注册？文件继续保留，再次加载会恢复登记。'),
          h('button', { type: 'button', className: 'lwb-danger-button', disabled: busy, onClick: () => void execute(confirmation) }, '确认'),
          h('button', { type: 'button', className: 'lwb-plain-button', disabled: busy, onClick: () => setConfirmation(null) }, '取消')),
        message && h('p', { role: 'status' }, message));
    }

    function PackFeatureIcon({ name = 'pack' }) {
      const paths = {
        pack: ['M12 3 3 8l9 5 9-5-9-5Z', 'M3 8v9l9 5 9-5V8', 'M12 13v9'],
        target: ['M12 3a9 9 0 1 0 9 9', 'M12 7a5 5 0 1 0 5 5', 'M12 12 21 3', 'M16 3h5v5'],
        signal: ['M4 16v4', 'M9 12v8', 'M14 8v12', 'M19 4v16'],
        idea: ['M9 18h6', 'M9 21h6', 'M8 15c0-2-3-3-3-6a7 7 0 0 1 14 0c0 3-3 4-3 6H8Z', 'M12 6v5'],
        write: ['M14 4H5v16h14v-9', 'm10 14 1-4 8-8 3 3-8 8-4 1Z'],
        audio: ['M3 10v4', 'M7 6v12', 'M12 3v18', 'M17 6v12', 'M21 10v4'],
        video: ['M3 5h18v14H3Z', 'm10 9 5 3-5 3V9Z'],
        publish: ['M12 15V3', 'm7 8 5-5 5 5', 'M4 13v7h16v-7'],
        calendar: ['M3 5h18v16H3Z', 'M7 3v4', 'M17 3v4', 'M3 10h18', 'm8 15 3 3 5-5'],
      };
      return h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        (paths[name] || paths.pack).map((d, index) => h('path', { key: index, d })));
    }

    function PackDetailDialog({ pack, onClose, action, notice, busy }) {
      const copy = useLwbCopy();
      const dialogRef = React.useRef(null);
      const [status, tone] = statusLabel(pack.status, copy);
      React.useLayoutEffect(() => {
        const dialog = dialogRef.current;
        const opener = document.activeElement;
        dialog.showModal();
        return () => {
          dialog.close();
          if (opener?.isConnected) opener.focus({ preventScroll: true });
        };
      }, []);
      return h('dialog', {
        ref: dialogRef, className: 'lwb-pack-dialog', 'aria-labelledby': 'lwb-pack-detail-title', 'aria-describedby': 'lwb-pack-detail-intro',
        onCancel: (event) => { event.preventDefault(); if (!busy) onClose(); },
        onKeyDown: (event) => {
          if (event.key !== 'Tab') return;
          const targets = [...event.currentTarget.querySelectorAll('button,summary,[href],input,select,textarea,[tabindex]')]
            .filter((element) => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0);
          const first = targets[0];
          const last = targets[targets.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        },
        onClick: (event) => {
          if (busy || event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
        },
      },
        h('header', { className: 'lwb-pack-dialog-head' },
          h('div', { className: 'lwb-pack-heading' },
            h('span', { className: 'lwb-pack-emblem' }, h(PackFeatureIcon, { name: 'pack' })),
            h('div', null, h('p', { className: 'lwb-pack-meta' }, `${pack.category} · ${copy.packType} · v${pack.version}`), h('h2', { id: 'lwb-pack-detail-title' }, pack.name))),
          h('button', { type: 'button', className: 'lwb-detail-close', disabled: busy, onClick: onClose, 'aria-label': copy.close }, '×')),
        h('div', { className: 'lwb-pack-dialog-body', tabIndex: 0, 'aria-label': copy.packDetails(pack.name) },
          h('div', { className: 'lwb-pack-overview' },
            h('span', { className: 'lwb-status', 'data-tone': tone }, status),
            h('p', { id: 'lwb-pack-detail-intro', className: 'lwb-pack-intro' }, pack.introduction)),
          pack.workflow.length > 0 && h('section', { className: 'lwb-pack-content-section' },
            h('h3', null, copy.packJourney),
            h('ol', { className: 'lwb-pack-journey' }, pack.workflow.map((step, index) => h('li', { key: step }, h('span', { 'aria-hidden': true }, String(index + 1).padStart(2, '0')), step))),
            pack.workflowHint && h('p', { className: 'lwb-pack-section-note' }, pack.workflowHint)),
          h('section', { className: 'lwb-pack-content-section' }, h('h3', null, copy.packFeatures),
            h('div', { className: 'lwb-pack-features' }, pack.features.map((feature) => h('article', { key: feature.menuId, className: 'lwb-pack-feature', 'data-tone': feature.tone },
              h('span', { className: 'lwb-pack-feature-icon' }, h(PackFeatureIcon, { name: feature.icon })),
              h('div', null, h('h4', null, feature.title), feature.description && h('p', null, feature.description)))))),
          pack.gettingStarted.length > 0 && h('section', { className: 'lwb-pack-start-guide' }, h('h3', null, copy.packGettingStarted),
            h('ul', null, pack.gettingStarted.map((item) => h('li', { key: item }, item)))),
          h(PackWorkspaceSettings, { key: pack.id, pack }),
        ),
        h('footer', { className: 'lwb-pack-dialog-foot', 'aria-busy': busy },
          (notice || pack.error) && h('p', { className: 'lwb-pack-feedback', role: notice?.kind === 'error' || pack.error ? 'alert' : 'status', 'data-tone': notice?.kind || 'error' }, notice?.text || pack.error),
          h('div', { className: 'lwb-pack-footer-actions' }, h('p', null, pack.status === 'loaded' ? copy.packReadyHint : pack.status === 'unavailable' ? copy.unavailablePack : copy.packLoadHint), action)),
      );
    }

    function orderMarketplacePacks(packs) {
      const priority = (pack) => pack.id === 'spoken-video' ? 0 : 1;
      return [...packs].sort((left, right) => priority(left) - priority(right));
    }

    function PacksPage() {
      const copy = useLwbCopy();
      const market = usePackMarket();
      React.useEffect(() => { void refreshPackCatalog({ retain: true }).catch(() => {}); }, []);
      const [detailPack, setDetailPack] = React.useState(null);
      const [query, setQuery] = React.useState('');
      const [statusFilter, setStatusFilter] = React.useState('all');
      const [category, setCategory] = React.useState('all');
      const [operation, setOperation] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const packs = orderMarketplacePacks(market.packs);
      const categories = [...new Set(packs.map((pack) => pack.category).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
      const normalizedQuery = query.trim().toLowerCase();
      const filtered = packs.filter((pack) => {
        if (statusFilter !== 'all' && pack.status !== statusFilter) return false;
        if (category !== 'all' && pack.category !== category) return false;
        if (!normalizedQuery) return true;
        return [pack.name, pack.description, pack.category, ...pack.tags, ...pack.menus.map((menu) => menu.label)]
          .join('\n').toLowerCase().includes(normalizedQuery);
      });
      const switchPack = async (pack, method) => {
        if (operation) return;
        setOperation(`${method}:${pack.id}`);
        setNotice(null);
        try {
          if (!services?.connection?.rpc?.call) throw new Error('DSH 连接尚未就绪。');
          if (!lwbPackClientRuntime) throw new Error('能力包浏览器运行时尚未就绪。');
          const response = await services.connection.rpc.call('/api', `lwbPacks/${method}`, { args: { request: { id: pack.id } } });
          if (!response?.ok) throw new Error(response?.error?.message || '能力包操作未完成。');
          try {
            await lwbPackClientRuntime.sync(pack, method === 'load');
          } catch (error) {
            if (method === 'load') {
              await services.connection.rpc.call('/api', 'lwbPacks/unload', { args: { request: { id: pack.id } } }).catch(() => {});
              await lwbPackClientRuntime.sync(pack, false).catch(() => {});
            }
            throw error;
          }
          await refreshPackCatalog({ retain: true });
          setNotice({ kind: 'success', text: method === 'load' ? copy.packLoaded : copy.packUnloaded });
        } catch (error) {
          setNotice({ kind: 'error', text: error?.message || copy.operationFailed });
        } finally {
          setOperation(null);
        }
      };
      const packAction = (selected, drawer = false) => {
        const pack = packs.find((item) => item.id === selected.id) || selected;
        const busy = operation !== null;
        if (pack.status === 'loaded') {
          return h('div', { className: 'lwb-row-actions' },
            h('button', { type: 'button', className: 'lwb-primary-button', disabled: busy, onClick: (event) => { event.stopPropagation(); if (drawer) setDetailPack(null); navTo('capability', capabilityRoute(pack.id, pack.menus[0].id)); } }, drawer ? copy.packStartAction : copy.openMenu),
            h('button', { type: 'button', className: 'lwb-plain-button', disabled: busy, onClick: (event) => { event.stopPropagation(); void switchPack(pack, 'unload'); } }, busy ? copy.unloadingPack : copy.unload),
          );
        }
        return h('div', { className: 'lwb-row-actions' },
          h('button', { type: 'button', className: 'lwb-primary-button', disabled: busy || pack.status === 'unavailable' || pack.accessAllowed === false, title: pack.status === 'unavailable' ? copy.unavailablePack : pack.accessAllowed === false ? (pack.accessReason || '当前账号无权使用此能力包。') : undefined, onClick: (event) => { event.stopPropagation(); void switchPack(pack, 'load'); } }, busy ? copy.loadingPack : pack.accessAllowed === false ? '需要会员' : drawer ? copy.packLoadAction : copy.load),
          !drawer && h('button', { type: 'button', className: 'lwb-plain-button', onClick: (event) => { event.stopPropagation(); setNotice(null); setDetailPack(pack); }, title: copy.packDetails(pack.name) }, copy.details),
        );
      };
      if (market.phase === 'pending') {
        return h('div', { className: 'lwb-pack-empty' }, h('div', null, h('strong', null, copy.loadingPacks)));
      }
      if (market.phase === 'error') {
        return h('div', { className: 'lwb-pack-empty' }, h('div', null, h('strong', null, copy.packCatalogFailed), h('p', null, market.error)));
      }
      return h(React.Fragment, null,
        h('div', { className: 'lwb-market-controls' },
          h('input', { className: 'lwb-market-search', type: 'search', value: query, placeholder: copy.marketSearch, onChange: (event) => setQuery(event.target.value) }),
          h('select', { className: 'lwb-select', value: statusFilter, onChange: (event) => setStatusFilter(event.target.value), 'aria-label': copy.currentStatus }, h('option', { value: 'all' }, copy.filterAll), h('option', { value: 'loaded' }, copy.filterLoaded), h('option', { value: 'available' }, copy.filterAvailable)),
          h('select', { className: 'lwb-select', value: category, onChange: (event) => setCategory(event.target.value), 'aria-label': copy.filterCategory }, h('option', { value: 'all' }, copy.filterCategory), categories.map((item) => h('option', { key: item, value: item }, item))),
        ),
        notice && !detailPack && h('p', { className: 'lwb-pack-feedback', role: notice.kind === 'error' ? 'alert' : 'status', 'data-tone': notice.kind }, notice.text),
        filtered.length ? h('div', { className: 'lwb-pack-grid' }, filtered.map((pack) => {
          const [status, tone] = statusLabel(pack.status, copy);
          return h('article', { key: pack.id, className: 'lwb-card lwb-pack-card', tabIndex: 0, onClick: (event) => { event.currentTarget.focus(); setNotice(null); setDetailPack(pack); }, onKeyDown: (event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setNotice(null); setDetailPack(pack); } } },
            h('div', { className: 'lwb-pack-card-top' }, h('div', { className: 'lwb-pack-title' }, h('span', { className: 'lwb-pack-icon' }, pack.icon), h('div', null, h('h3', null, pack.name), h('p', null, `${pack.category} · v${pack.version}`))), h('span', { className: 'lwb-status', 'data-tone': tone }, status)),
            h('p', null, pack.description),
            h('div', { className: 'lwb-pack-menu' }, (pack.tags.length ? pack.tags : pack.menus.map((item) => item.label)).slice(0, 4).map((item) => h('span', { key: item, className: 'lwb-menu-pill' }, item))),
            h('p', { className: 'lwb-pack-card-note' }, pack.error || `${copy.menuCount} ${pack.menus.length}`),
            h('div', { className: 'lwb-pack-actions' }, packAction(pack)),
          );
        })) : h('div', { className: 'lwb-pack-empty' }, h('div', null, h('strong', null, packs.length ? copy.noMatchingPacks : copy.noLoadedPacks), h('p', null, copy.packsEmptyCopy))),
        detailPack && h(PackDetailDialog, {
          pack: packs.find((item) => item.id === detailPack.id) || detailPack,
          onClose: () => setDetailPack(null),
          action: packAction(detailPack, true), notice, busy: operation !== null,
        })
      );
    }

    function openLwbAccountSettings() {
      updateProduct({ page: 'settings', accountReturnRoute: productState.capabilityPage, mobileNavOpen: false });
    }
    function LwbServiceCard({ service, description }) {
      const account = useLwbAccount();
      const state = account.catalog?.services?.[service];
      const points = Number(account.points?.availablePoints);
      const insufficient = state?.available && Number.isFinite(points) && points < Number(state.minimumPoints || 0);
      return h('section', { className: 'lwb-service-card', 'aria-label': 'LWB 账号服务' },
        h('strong', null, 'LWB 账号'),
        h('p', null, description),
        account.user ? h(React.Fragment, null,
          h('span', { className: 'lwb-service-email' }, account.user.email),
          h('div', { className: 'lwb-account-metrics' },
            h('div', null, h('span', null, '会员等级'), h('strong', null, account.membership?.planName || account.membership?.planCode || '免费用户')),
            h('div', null, h('span', null, '可用积分'), h('strong', null, Number.isFinite(points) ? points.toLocaleString('zh-CN') : '—'))),
          h('p', { role: 'status', className: insufficient || account.error || account.serviceError || !state?.available ? 'lwb-dialog-error' : 'lwb-account-muted' }, account.error || account.serviceError || (insufficient ? '积分不足，请购买积分后再提交任务。' : state?.available ? 'LWB 服务已就绪，选择此服务后将按实际用量扣除账号积分。' : state?.reason || '服务暂未开放。')),
          h('div', { className: 'lwb-row-actions' }, button('lwb-primary-button', '购买积分 / 会员', openLwbAccountSettings), button('lwb-plain-button', '刷新账号', () => { void refreshLwbAccount(); })),
        ) : h(React.Fragment, null,
          h('p', { role: 'status' }, account.phase === 'loading' ? '正在读取账号…' : account.error || '登录后即可使用 LWB 提供的服务。'),
          button('lwb-primary-button', '前往设置登录 LWB', openLwbAccountSettings),
          account.error && button('lwb-plain-button', '重新读取', () => { void refreshLwbAccount(); })),
      );
    }
    const lwbAccountFacade = Object.freeze({ useAccount: useLwbAccount, refresh: refreshLwbAccount, openSettings: openLwbAccountSettings, ServiceCard: LwbServiceCard });
    function TaskModelSetting() {
      const account = useLwbAccount();
      const [value, setValue] = React.useState(null);
      const [draft, setDraft] = React.useState({ mode: 'follow-dsh', key: '' });
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const load = React.useCallback(async () => {
        try { const next = await lwbAccountRpc('taskModel'); setValue(next); setDraft({ mode: next.config.mode, key: next.config.provider ? JSON.stringify([next.config.provider, next.config.model]) : '' }); setError(''); }
        catch (cause) { setError(cause.message); }
      }, []);
      React.useEffect(() => { void load(); }, [load, account.user?.id]);
      const groupById = new Map((value?.groups || []).map(group => [group.id, group]));
      const models = (value?.groups || []).flatMap((group) => (group.models || []).map((model) => ({
        key: JSON.stringify([group.id, model.id]),
        label: `${group.name || group.id} · ${model.name || model.id}`,
        auth: group.auth || null,
      })));
      // Availability is stated, never enforced: a route with no credential yet
      // is a legitimate staging choice, but the operator must see that scoped
      // tasks on it will fail on their first model request.
      const authNote = (auth) => {
        if (!auth) return '';
        if (auth.state === 'missing-credential') return ` · 未配置凭据（${auth.ref || 'API Key'}）`;
        if (auth.state === 'unverifiable') return ' · 凭据状态未知';
        return '';
      };
      const selectedModel = models.find(model => model.key === draft.key) || null;
      const selectedAuth = draft.mode === 'specified'
        ? (selectedModel?.auth || (draft.key ? groupById.get(JSON.parse(draft.key || '[]')[0])?.auth || null : null))
        : null;
      const save = async () => {
        setBusy(true); setNotice('');
        try {
          const [provider, model] = draft.mode === 'specified' ? JSON.parse(draft.key || '[]') : [];
          const next = await lwbAccountRpc('setTaskModel', { request: { mode: draft.mode, ...(draft.mode === 'specified' ? { provider, model } : {}) } });
          setValue(next); setError(''); setNotice('已保存，将用于后续新建场景任务。');
        } catch (cause) { setError(cause.message); } finally { setBusy(false); }
      };
      return h('section', { className: 'lwb-card lwb-settings-group lwb-task-model' },
        h('header', { className: 'lwb-settings-group-head' },
          h('div', { className: 'lwb-settings-group-title' },
            h('span', { className: 'lwb-settings-group-mark', 'data-tone': 'slate', 'aria-hidden': 'true' }, 'AI'),
            h('div', null,
              h('h2', null, '场景任务默认模型'),
              h('p', null, '统一用于场景包的文本创作、视频 Agent、子任务和自动化任务。配音、字幕和封面服务在各自模块单独选择。'),
            ),
          ),
        ),
        h('div', { className: 'lwb-settings-group-body' },
          h('label', { className: 'lwb-field' }, h('span', null, '选择方式'), h('select', { className: 'lwb-select', value: draft.mode, disabled: !value || busy, onChange: event => { setDraft({ ...draft, mode: event.target.value }); setNotice(''); } }, h('option', { value: 'follow-dsh' }, '跟随 DSH 默认模型'), h('option', { value: 'specified' }, '指定场景任务模型'))),
          draft.mode === 'specified' && h('label', { className: 'lwb-field' }, h('span', null, '场景任务模型'), h('select', { className: 'lwb-select', value: draft.key, disabled: busy, onChange: event => { setDraft({ ...draft, key: event.target.value }); setNotice(''); } }, h('option', { value: '' }, '请选择模型'), draft.key && !models.some(model => model.key === draft.key) && h('option', { value: draft.key }, '已保存的模型当前不可用，请检查账号或服务'), models.map(model => h('option', { key: model.key, value: model.key }, `${model.label}${authNote(model.auth)}`)))),
          draft.mode === 'specified' && selectedAuth?.state === 'missing-credential' && h('p', { className: 'lwb-account-muted' }, `该模型服务尚未配置凭据（${selectedAuth.ref || 'API Key'}）：场景包的选题、写稿和定时任务会在第一次请求时失败。请先点击「打开设置」在「模型」中完成配置，或改选其他模型。`),
          draft.mode === 'specified' && selectedAuth?.state === 'unverifiable' && h('p', { className: 'lwb-account-muted' }, `无法确认该模型服务的凭据状态（${selectedAuth.ref || 'API Key'}）：账号、设备或 OAuth 认证的路由请忽略此提示。`),
          draft.mode === 'follow-dsh' && h('p', { className: 'lwb-account-muted' }, '保留当前行为：新任务读取 DSH 默认选择；对话中切换模型并保存默认值后，也会影响后续场景任务。'),
          account.user && account.catalog?.models?.map(model => !model.available && h('p', { key: model.id, className: 'lwb-account-muted' }, `LWB · ${model.name}：${model.reason || '暂不可用'}`)),
          account.serviceError && h('p', { className: 'lwb-dialog-error' }, account.serviceError),
          error && h('p', { className: 'lwb-dialog-error', role: 'alert' }, error), notice && h('p', { role: 'status' }, notice),
          h('div', { className: 'lwb-row-actions' }, button('lwb-primary-button', busy ? '保存中…' : '保存模型设置', () => { void save(); }, { disabled: busy || !value || (draft.mode === 'specified' && !draft.key) }), button('lwb-plain-button', '刷新模型列表', () => { void load(); })),
        ),
      );
    }

    function SettingsPage({ renderSlot }) {
      const product = useProduct();
      React.useEffect(() => { if (product.accountReturnRoute) document.getElementById('lwb-account-section')?.scrollIntoView({ block: 'start' }); }, [product.accountReturnRoute]);
      const copy = useLwbCopy();
      const connectionState = useObservable(services?.connection?.state, 'connecting');
      const account = useLwbAccount();
      const dshAccount = useDshAccount();
      const [mode, setMode] = React.useState('login');
      const [accountValue, setAccountValue] = React.useState('');
      const [password, setPassword] = React.useState('');
      const [confirmPassword, setConfirmPassword] = React.useState('');
      const [activationCode, setActivationCode] = React.useState('');
      const [formError, setFormError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [purchaseTab, setPurchaseTab] = React.useState('membership');
      const [purchaseOptions, setPurchaseOptions] = React.useState({ phase: 'idle', packages: [], plans: [], error: null });
      const [pendingPayment, setPendingPayment] = React.useState(null);
      const [purchasingCode, setPurchasingCode] = React.useState('');
      const connectionLabel = connectionState === 'connected' ? copy.connected : connectionState === 'disconnected' ? copy.disconnected : copy.connecting;
      const dshAccountBusy = dshAccount.phase === 'signing-in' || dshAccount.phase === 'signing-out';
      const dshAccountButton = dshAccount.phase === 'unavailable' ? null : h('button', {
        type: 'button',
        className: dshAccount.phase === 'authenticated' ? 'lwb-dsh-account-button is-signed-in' : 'lwb-dsh-account-button',
        onClick: dshAccount.phase === 'authenticated' ? () => { void signOutDsh(); } : () => { void startDshSignIn(); },
        disabled: dshAccountBusy,
        'aria-busy': dshAccountBusy ? 'true' : 'false',
        title: dshAccount.error || undefined,
      }, dshAccount.phase === 'authenticated' ? copy.dshSignOut : dshAccount.phase === 'signing-out' ? copy.dshSigningOut : dshAccount.phase === 'signing-in' ? copy.dshSigningIn : copy.dshSignIn);
      React.useEffect(() => {
        if (connectionState === 'connected') void refreshLwbAccount();
      }, [connectionState]);
      React.useEffect(() => {
        if (account.phase === 'authenticated') void loadPurchaseOptions(false);
        else setPurchaseOptions({ phase: 'idle', packages: [], plans: [], error: null });
      }, [account.phase]);
      React.useEffect(() => {
        if (!pendingPayment || pendingPayment.status !== 'pending') return undefined;
        const orderId = pendingPayment.orderId;
        let cancelled = false;
        let timer;
        const deadline = Date.now() + PAYMENT_POLL_BUDGET_MS;
        const poll = async () => {
          if (Date.now() >= deadline) {
            setPendingPayment((current) => current?.orderId === orderId ? Object.assign({}, current, { status: 'timeout' }) : current);
            setNotice(copy.lwbPaymentTimeout);
            return;
          }
          try {
            const result = await lwbAccountRpc('orderStatus', { request: { orderId } });
            if (cancelled) return;
            const next = readOrderStatus(result);
            if (next.terminal) { await applyOrderResult(orderId, next); return; }
          } catch (_) {}
          if (!cancelled) timer = window.setTimeout(() => void poll(), PAYMENT_POLL_INTERVAL_MS);
        };
        timer = window.setTimeout(() => void poll(), 1200);
        return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
      }, [pendingPayment?.orderId, pendingPayment?.status]);
      React.useEffect(() => {
        if (pendingPayment?.status !== 'paid') return undefined;
        const timer = window.setTimeout(() => setPendingPayment((current) => current?.status === 'paid' ? null : current), PAYMENT_SUCCESS_DISMISS_MS);
        return () => window.clearTimeout(timer);
      }, [pendingPayment?.orderId, pendingPayment?.status]);
      function orderStatusText(status) {
        return status === 'pending' ? copy.lwbOrderPending
          : status === 'paid' ? copy.lwbPaymentSuccess
            : status === 'cancelled' ? copy.lwbPaymentCancelled
              : status === 'failed' ? copy.lwbPaymentFailed
                : status === 'timeout' ? copy.lwbPaymentTimeout
                  : copy.lwbPaymentExpired;
      }
      async function applyOrderResult(orderId, result) {
        setPendingPayment((current) => current?.orderId === orderId ? Object.assign({}, current, { status: result.status }) : current);
        if (result.refreshAccount) await refreshLwbAccount({ force: true });
        setNotice(orderStatusText(result.status));
      }
      async function loadPurchaseOptions(showNotice = true) {
        if (account.phase !== 'authenticated') return;
        setPurchaseOptions((current) => Object.assign({}, current, { phase: 'loading', error: null }));
        try {
          const [packages, plans] = await Promise.all([
            lwbAccountRpc('rechargePackages'),
            lwbAccountRpc('membershipPlans'),
          ]);
          setPurchaseOptions({ phase: 'ready', packages: Array.isArray(packages) ? packages : [], plans: Array.isArray(plans) ? plans : [], error: null });
        } catch (error) {
          setPurchaseOptions({ phase: 'error', packages: [], plans: [], error: error?.message || copy.lwbPackageLoadFailed });
          if (showNotice) setNotice(error?.message || copy.lwbPackageLoadFailed);
        }
      }
      async function openPayment(payment) {
        const opened = window.open(payment.paymentPageUrl, '_blank', 'noopener,noreferrer');
        return Boolean(opened);
      }
      async function createPurchase(type, code) {
        if (account.phase !== 'authenticated') { setNotice(copy.lwbLoginToPurchase); return; }
        setPurchasingCode(`${type}:${code}`); setNotice('');
        try {
          const payment = await lwbAccountRpc('createPayment', { request: { type, code } });
          const pending = { orderId: payment.orderId, orderNo: payment.orderNo, paymentPageUrl: payment.paymentPageUrl, type, status: 'pending' };
          const opened = await openPayment(pending);
          setPendingPayment(pending);
          setNotice(opened ? copy.lwbOrderCreated(payment.orderNo) : copy.lwbOrderCreatedBlocked(payment.orderNo));
        } catch (error) { setNotice(error?.message || copy.lwbPaymentFailed); }
        finally { setPurchasingCode(''); }
      }
      async function checkPendingPayment() {
        const current = pendingPayment;
        if (!current || (current.status !== 'pending' && current.status !== 'timeout')) return;
        try {
          const result = await lwbAccountRpc('orderStatus', { request: { orderId: current.orderId } });
          const next = readOrderStatus(result);
          if (next.terminal) { await applyOrderResult(current.orderId, next); return; }
          setPendingPayment((value) => value?.orderId === current.orderId ? Object.assign({}, value, { status: 'pending' }) : value);
          setNotice(copy.lwbOrderPending);
        } catch (error) { setNotice(error?.message || copy.lwbPaymentTimeout); }
      }
      const submitAccount = async (event) => {
        event.preventDefault();
        if (account.phase === 'loading') return;
        setFormError(''); setNotice('');
        if (!accountValue.trim() || !password) { setFormError(copy.lwbAccountFailed); return; }
        if (mode === 'register' && password !== confirmPassword) { setFormError(copy.lwbAccountFailed); return; }
        try {
          await lwbAccountAction(mode === 'login' ? 'login' : 'register', mode === 'login'
            ? { account: accountValue.trim(), password }
            : { email: accountValue.trim(), password, confirmPassword, activationCode: activationCode.trim() });
          setNotice(mode === 'login' ? copy.lwbLoginSuccess : copy.lwbRegisterSuccess);
          setPassword(''); setConfirmPassword(''); setActivationCode('');
        } catch (error) { setFormError(error?.message || copy.lwbAccountFailed); }
      };
      const membership = account.membership || {};
      const points = account.points || {};
      const expiresAt = membership.expiresAt ? new Date(membership.expiresAt).toLocaleDateString() : null;
      const accountPanel = account.phase === 'authenticated'
        ? h('div', { className: 'lwb-account-panel' },
          h('div', { className: 'lwb-account-meta' },
            h('strong', null, account.user?.email || account.user?.username || 'LWB'),
            h('span', null, account.user?.role || 'user')),
          h('div', { className: 'lwb-account-stat-grid' },
            h('div', null, h('span', null, copy.lwbMembership), h('strong', null, membership.planName || membership.planCode || copy.lwbNoMembership), expiresAt && h('small', null, expiresAt)),
            h('div', null, h('span', null, copy.lwbPoints), h('strong', null, String(points.availablePoints ?? 0)), points.frozenPoints ? h('small', null, `${copy.lwbFrozenPoints}: ${points.frozenPoints}`) : null),
          ),
          h('p', { className: 'lwb-account-muted' }, copy.lwbPacksHint),
          h('section', { className: 'lwb-purchase-section' },
            h('div', { className: 'lwb-purchase-heading' },
              h('div', null, h('strong', null, copy.lwbPurchase), h('p', null, copy.lwbPurchaseHint)),
              button('lwb-plain-button', purchaseOptions.phase === 'loading' ? copy.lwbAccountLoading : copy.lwbRefreshPackages, () => { void loadPurchaseOptions(true); }, { disabled: purchaseOptions.phase === 'loading' }),
            ),
            pendingPayment && h('div', { className: 'lwb-payment-status', 'data-status': pendingPayment.status },
              h('div', null, h('strong', null, pendingPayment.orderNo), h('span', null, orderStatusText(pendingPayment.status))),
              h('div', { className: 'lwb-row-actions' }, pendingPayment.status === 'pending' && button('lwb-plain-button', copy.lwbOpenPayment, () => { void openPayment(pendingPayment); }), (pendingPayment.status === 'pending' || pendingPayment.status === 'timeout') && button('lwb-primary-button', copy.lwbCheckPayment, () => { void checkPendingPayment(); }), button('lwb-plain-button', pendingPayment.status === 'paid' ? copy.lwbFinishOrder : copy.lwbClearOrder, () => setPendingPayment(null))),
            ),
            purchaseOptions.error && h('p', { className: 'lwb-dialog-error', role: 'alert' }, purchaseOptions.error),
            h('div', { className: 'lwb-purchase-tabs', role: 'tablist' },
              h('button', { type: 'button', role: 'tab', 'aria-selected': purchaseTab === 'membership', className: purchaseTab === 'membership' ? 'active' : '', onClick: () => setPurchaseTab('membership') }, copy.lwbMembershipPlans),
              h('button', { type: 'button', role: 'tab', 'aria-selected': purchaseTab === 'recharge', className: purchaseTab === 'recharge' ? 'active' : '', onClick: () => setPurchaseTab('recharge') }, copy.lwbRechargePackages),
            ),
            purchaseTab === 'recharge'
              ? h('div', { className: 'lwb-purchase-grid' }, purchaseOptions.packages.length ? purchaseOptions.packages.map((item) => h('article', { className: 'lwb-purchase-card', key: item.code }, h('strong', null, item.name), h('b', null, `¥${(Number(item.amountCents || 0) / 100).toFixed(2)}`), h('span', null, `${copy.lwbPointsAmount}: ${item.totalPoints || item.pointsAmount || 0}`), item.bonusPoints ? h('span', null, `${copy.lwbBonusPoints}: ${item.bonusPoints}`) : null, h('button', { type: 'button', className: 'lwb-primary-button', disabled: Boolean(purchasingCode), onClick: () => { void createPurchase('recharge', item.code); } }, purchasingCode === `recharge:${item.code}` ? copy.lwbCreatingOrder : copy.lwbPayAlipay))) : h('p', { className: 'lwb-account-muted' }, copy.lwbNoPackages))
              : h('div', { className: 'lwb-purchase-grid' }, purchaseOptions.plans.length ? purchaseOptions.plans.map((item) => h('article', { className: 'lwb-purchase-card', key: item.code }, h('strong', null, item.name), h('b', null, `¥${(Number(item.monthlyPriceCents || 0) / 100).toFixed(2)} / 月`), h('span', null, `${copy.lwbMonthlyPoints}: ${item.monthlyPointsGrant || 0}`), item.priceDiscount < 1 ? h('span', null, `${copy.lwbPriceDiscount}: ${Math.round(item.priceDiscount * 100)}%`) : null, item.rpmLimit ? h('span', null, `${copy.lwbRpmLimit}: ${item.rpmLimit}`) : null, h('button', { type: 'button', className: 'lwb-primary-button', disabled: Boolean(purchasingCode), onClick: () => { void createPurchase('membership', item.code); } }, purchasingCode === `membership:${item.code}` ? copy.lwbCreatingOrder : copy.lwbPayAlipay))) : h('p', { className: 'lwb-account-muted' }, copy.lwbNoPackages)),
          ),
          h('div', { className: 'lwb-row-actions' }, button('lwb-plain-button', copy.lwbLogout, () => { void lwbAccountAction('logout').catch(() => {}); }, { disabled: account.phase === 'loading' })),
        )
        : h('form', { className: 'lwb-account-panel lwb-account-form', 'data-mode': mode, onSubmit: submitAccount },
          h('div', { className: 'lwb-account-mode' },
            h('div', { className: 'lwb-account-mode-heading' },
              h('span', { className: 'lwb-account-mode-mark', 'aria-hidden': 'true' }, mode === 'login' ? '↪' : '+'),
              h('strong', { className: 'lwb-account-mode-title' }, mode === 'login' ? copy.lwbLogin : copy.lwbRegister),
            ),
            button('lwb-link-button lwb-account-switch-button', mode === 'login' ? copy.lwbSwitchToRegister : copy.lwbSwitchToLogin, () => { setMode(mode === 'login' ? 'register' : 'login'); setFormError(''); setNotice(''); }, { 'aria-controls': 'lwb-account-form-fields' }),
          ),
          h('div', { id: 'lwb-account-form-fields', className: 'lwb-account-form-fields' },
            h('div', { className: 'lwb-field' }, h('label', { htmlFor: 'lwb-account-email' }, mode === 'login' ? copy.lwbEmail : copy.lwbEmail), h('input', { id: 'lwb-account-email', className: 'lwb-input', type: mode === 'login' ? 'text' : 'email', value: accountValue, autoComplete: mode === 'login' ? 'username' : 'email', onChange: (event) => setAccountValue(event.target.value) })),
            h('div', { className: 'lwb-field' }, h('label', { htmlFor: 'lwb-account-password' }, copy.lwbPassword), h('input', { id: 'lwb-account-password', className: 'lwb-input', type: 'password', value: password, autoComplete: mode === 'login' ? 'current-password' : 'new-password', onChange: (event) => setPassword(event.target.value) })),
            mode === 'register' && h('div', { className: 'lwb-field' }, h('label', { htmlFor: 'lwb-account-confirm-password' }, copy.lwbConfirmPassword), h('input', { id: 'lwb-account-confirm-password', className: 'lwb-input', type: 'password', value: confirmPassword, autoComplete: 'new-password', onChange: (event) => setConfirmPassword(event.target.value) })),
            mode === 'register' && h('div', { className: 'lwb-field' }, h('label', { htmlFor: 'lwb-account-activation' }, copy.lwbActivationCode), h('input', { id: 'lwb-account-activation', className: 'lwb-input', value: activationCode, onChange: (event) => setActivationCode(event.target.value) })),
          ),
          (formError || account.error) && h('p', { className: 'lwb-dialog-error', role: 'alert' }, formError || account.error),
          notice && h('p', { className: 'lwb-account-notice', role: 'status' }, notice),
          h('div', { className: 'lwb-row-actions lwb-account-submit-actions' }, button('lwb-primary-button', account.phase === 'loading' ? copy.lwbAccountLoading : (mode === 'login' ? copy.lwbLogin : copy.lwbRegister), () => {}, { type: 'submit', disabled: account.phase === 'loading' })),
        );
      const accountStatusLabel = account.phase === 'authenticated' ? (account.user?.email || account.user?.username || 'LWB') : account.phase === 'loading' ? copy.lwbAccountLoading : copy.lwbNotLoggedIn;
      return h('div', { className: 'lwb-settings' },
        h('section', { className: 'lwb-card lwb-settings-group' },
          h('header', { className: 'lwb-settings-group-head' },
            h('div', { className: 'lwb-settings-group-title' },
              h('span', { className: 'lwb-settings-group-mark', 'aria-hidden': 'true' }, 'DSH'),
              h('div', null, h('h2', null, copy.basicConfiguration), h('p', null, copy.basicConfigurationHint)),
            ),
          ),
          h('div', { className: 'lwb-setting-row' }, h('div', { className: 'lwb-setting-copy' }, h('strong', null, copy.systemSettings), h('span', null, copy.systemSettingsHint)), h('div', { className: 'lwb-dsh-settings-actions' }, h('div', { className: 'lwb-dsh-settings-launcher' }, renderSlot('sidebar.settings', { wide: true })), dshAccountButton)),
        ),
        h(TaskModelSetting),
        product.accountReturnRoute && h('div', { className: 'lwb-card lwb-account-return' },
          h('span', null, copy.accountReturnHint),
          button('lwb-plain-button', copy.accountReturn, () => updateProduct({ page: 'capability', capabilityPage: product.accountReturnRoute })),
        ),
        h('section', { id: 'lwb-account-section', className: 'lwb-card lwb-settings-group' },
          h('header', { className: 'lwb-settings-group-head' },
            h('div', { className: 'lwb-settings-group-title' },
              h('span', { className: 'lwb-settings-group-mark', 'data-tone': 'teal', 'aria-hidden': 'true' }, 'LWB'),
              h('div', null, h('h2', null, copy.lwbAccount), h('p', null, copy.lwbAccountHint)),
            ),
            h('span', { className: 'lwb-status', role: 'status', 'data-tone': account.phase === 'authenticated' ? 'good' : account.phase === 'error' ? 'warm' : 'muted' }, accountStatusLabel),
          ),
          h('div', { className: 'lwb-settings-group-body' },
            h('p', { className: 'lwb-account-note' },
              h('span', { className: 'lwb-account-note-mark', 'aria-hidden': 'true' }, 'i'),
              h('span', null, copy.lwbAccountNote),
            ),
            accountPanel,
          ),
        ),
        h('section', { className: 'lwb-card lwb-settings-group' },
          h('header', { className: 'lwb-settings-group-head' },
            h('div', { className: 'lwb-settings-group-title' },
              h('span', { className: 'lwb-settings-group-mark', 'data-tone': 'slate', 'aria-hidden': 'true' }, 'i'),
              h('div', null, h('h2', null, copy.about)),
            ),
          ),
          h('div', { className: 'lwb-setting-row' }, h('div', { className: 'lwb-setting-copy' }, h('strong', null, copy.runtime), h('span', null, copy.runtimeHint)), h('span', { className: 'lwb-status', role: 'status', 'data-tone': connectionState === 'connected' ? undefined : 'warm' }, connectionLabel)),
        ),
      );
    }

    class CapabilityPageBoundary extends React.Component {
      constructor(props) { super(props); this.state = { failed: false }; }
      static getDerivedStateFromError() { return { failed: true }; }
      render() {
        if (!this.state.failed) return this.props.children;
        const { copy, onReturnToConversation, onViewPacks } = this.props;
        return h('div', { className: 'lwb-card lwb-empty-state' }, h('div', null,
          h('div', { className: 'lwb-empty-glyph' }, '⚠'), h('h2', null, copy.capabilityPageFailed), h('p', null, copy.capabilityPageFailedCopy),
          h('div', { className: 'lwb-row-actions', style: { justifyContent: 'center' } }, button('lwb-plain-button', copy.returnToConversation, onReturnToConversation), button('lwb-primary-button', copy.viewPacks, onViewPacks)),
        ));
      }
    }

    /**
     * One pack Session's conversation, rendered inside a pack page.
     *
     * This uses the official `conversation.content` factory — the seam DSH
     * publishes for embedding a Session conversation in another surface — with
     * its own Session scope. Pack mode replaces the frame Conversation with a
     * placeholder while the official right Sidebar follows the focused card.
     */
    function FixedEmbeddedConversationView({ renderSlot }) {
      return renderSlot('conversation.session', { view: 'chat' });
    }


    function ReadOnlyConversationSurface({ sessionId, children }) {
      const root = React.useRef(null);
      React.useLayoutEffect(() => {
        const blocks = services.composerBlocks?.();
        if (!blocks) return;
        const previous = blocks.storeFor(sessionId).getSnapshot();
        const block = { reason: '比赛会话只读，请通过竞技台控制比赛。' };
        blocks.set(sessionId, block);
        return () => {
          if (blocks.storeFor(sessionId).getSnapshot() === block) blocks.set(sessionId, previous);
        };
      }, [sessionId]);
      React.useLayoutEffect(() => {
        const element = root.current;
        if (!element) return;
        const lock = () => {
          for (const seat of element.querySelectorAll('[data-conversation-region="composer"]')) {
            // Keep the composer dock mounted: DSH puts the session statistics
            // pills there. Only the editable input card is hidden and disabled.
            seat.style.display = 'contents';
            const card = seat.querySelector('[data-composer-card]');
            if (card) {
              card.hidden = true;
              card.inert = true;
              for (const control of card.querySelectorAll('button,input,textarea,select')) control.disabled = true;
            }
          }
          const branchLabel = services.locale?.bind?.('chat')?.('message.branch');
          for (const control of element.querySelectorAll('[data-turn-tail] button')) {
            if (branchLabel && control.getAttribute('aria-label') === branchLabel) {
              control.disabled = true;
              control.title = '比赛会话只读';
            }
          }
        };
        lock();
        const observer = new MutationObserver(lock);
        observer.observe(element, { childList: true, subtree: true });
        return () => observer.disconnect();
      }, []);
      const guard = event => {
        if (event.target.closest?.('[data-composer-card],[data-composer-input]')) {
          event.preventDefault(); event.stopPropagation();
        }
      };
      return h('div', { ref: root, className: 'lwb-readonly-conversation',
        onClickCapture: guard, onKeyDownCapture: guard, onSubmitCapture: guard,
      }, children);
    }


    /**
     * Sessions a pack page is rendering right now, with a mount count each.
     *
     * While any of them is mounted the host runs in "pack Session mode": the
     * frame's current Session follows the card the user is working in, so the
     * official right Sidebar (and everything else the frame renders for the
     * current Session) applies to that card's Session instead of the user's own
     * conversation. The conversation itself is never reimplemented.
     */
    /** Sessions this host has rendered since load; a chip inside one is never the user's own file. */
    const packSessionRendered = new Set();
    const embeddedHostSessions = new Map();
    /** Bumped by every focus; a queued collapse only acts while its epoch is current. */
    let packPanelEpoch = 0;
    /** The collapse one card focus still owes; started once the focusing gesture ends. */
    let pendingPanelCollapse;
    /** The Session the frame showed before pack Session mode armed, restored when it ends. */
    let packSessionRestore = null;
    /** Pending right-Sidebar inset observer, armed with pack Session mode. */
    let packSessionInset = null;
    let packConversationDispose;

    function currentSessionId() {
      return services?.uiSession?.adapter?.current?.getSnapshot?.()?.key
        ?? services?.sessions?.list?.getSnapshot?.()?.current;
    }

    // Keep the main panel selection intact for the official right Sidebar,
    // but mount the Conversation itself only in the pack's visible cards.
    function PackConversationPlaceholder() {
      return h('div', { 'data-lwb-pack-conversation': '' });
    }

    /**
     * The Session one resource address names, when it names one at all.
     *
     * A file opened from a conversation is addressed
     * `dsh-resource://file/session/<sessionId>/<path>`; the `absolute` scope of
     * the same scheme carries no Session. The route below intervenes only for a
     * pack Session, so an address that names none stays `undefined` and travels
     * the official path untouched.
     */
    function sessionIdFromResourceAddress(address) {
      const match = /^dsh-resource:\/\/[^/]+\/session\/([^/]+)/.exec(String(address || ''));
      if (!match) return undefined;
      // Every id segment is component-encoded; a malformed escape names no
      // Session here rather than failing the open.
      try { return decodeURIComponent(match[1]); } catch (_) { /* malformed escape */ return undefined; }
    }

    function packSessionArmed() {
      return embeddedHostSessions.size > 0;
    }
    /** The card whose right-Sidebar seat is mounted right now, when it is one of ours. */
    function mountedPackPanelSession() {
      const mounted = services?.sidebarRight?.mounted?.getSnapshot?.();
      return typeof mounted === 'string' && mounted && embeddedHostSessions.has(mounted) ? mounted : null;
    }
    /**
     * Close a card's panel through the official toggle; an already collapsed column
     * is left alone.
     */
    function collapsePackPanel() {
      const sidebarRight = services?.sidebarRight;
      if (!mountedPackPanelSession()) return;
      if (typeof sidebarRight?.isExpanded !== 'function' || typeof sidebarRight?.toggleExpanded !== 'function') return;
      try { if (sidebarRight.isExpanded()) sidebarRight.toggleExpanded(); } catch (_) { /* no surface mounted */ }
    }
    /**
     * A plainly focused card never inherits an expanded panel.
     *
     * The official store remembers a panel per Session, so a card that was left
     * expanded — or restored from storage — would show its panel again the moment
     * it is focused. On this page the panel is one surface: leaving it closed must
     * keep it closed, so the target is collapsed once its seat is mounted.
     */
    function collapseWhenSettled(sessionId, epoch) {
      const sidebarRight = services?.sidebarRight;
      if (typeof sidebarRight?.isExpanded !== 'function' || typeof sidebarRight?.toggleExpanded !== 'function') return;
      let attempts = 0;
      const step = () => {
        // A later panel gesture owns the outcome now: a queued collapse must not
        // close a panel the user asked for in the meantime.
        if (epoch !== packPanelEpoch) return;
        if (sidebarRight.mounted?.getSnapshot?.() === sessionId) {
          try { if (sidebarRight.isExpanded()) sidebarRight.toggleExpanded(); } catch (_) { /* no surface mounted */ }
          return;
        }
        if (attempts > 40) return;
        attempts += 1;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    /**
     * Point the frame at one pack Session so the official surfaces follow it.
     *
     * One surface, one panel: a plainly focused card collapses its own remembered
     * panel. That collapse waits for the gesture to end, because the same gesture
     * may be an official control opening a file — the open arrives after this
     * focus, and what the user asked to see decides the column. `keepExpanded` is
     * for the gestures that are themselves about the panel (its toggle, or an
     * official control opening a file in it): those own the result at once.
     */
    function focusSession(sessionId, options) {
      if (!embeddedHostSessions.has(sessionId)) return;
      // An explicit panel gesture supersedes a queued collapse. Repeated plain
      // focus in the same pointer gesture must leave its owed collapse intact.
      if (options?.keepExpanded) {
        packPanelEpoch += 1;
        pendingPanelCollapse = undefined;
      }
      const current = currentSessionId();
      if ((current ?? services?.sidebarRight?.mounted?.getSnapshot?.()) === sessionId) {
        if (services?.layout?.panelInfo?.getSnapshot?.()?.activePanelId != null) services.layout.selectPanel(null);
        return;
      }
      if (!options?.keepExpanded) packPanelEpoch += 1;
      services?.uiWorkspace?.openSession?.(sessionId);
      if (!options?.keepExpanded) pendingPanelCollapse = { sessionId, epoch: packPanelEpoch };
    }
    /**
     * Start the collapse a card focus owes, once its gesture has ended.
     *
     * Pointing the frame at the arriving card happens immediately; only the
     * collapse waits, so an official control inside that same gesture supersedes
     * it by taking a newer epoch. A gesture that owes nothing settles nothing.
     */
    function settlePanelGesture() {
      const pending = pendingPanelCollapse;
      pendingPanelCollapse = undefined;
      if (pending === undefined) return;
      collapseWhenSettled(pending.sessionId, pending.epoch);
    }
    /** The official service's refusal while a Session's Sidebar surface is not minted yet. */
    const PACK_SURFACE_PENDING = 'no session surface is mounted';
    /**
     * Open one official resource in a pack card's Session.
     *
     * The official call acts on the Session its seat publishes AND on that
     * Session's adopted surface, which the seat mints one render after `mounted`
     * names it — its own refusal names the missing surface, and that is the one
     * failure worth waiting for. Every other refusal is a wiring mistake the
     * caller must see now. The open is also what leaves the column expanded: the
     * official store expands only when it places a new tab, so an address it
     * merely reveals would otherwise leave an earlier collapse in force.
     * @param sidebarRight - the official Sidebar service.
     * @param openResource - its original `openResource`, bound.
     * @param sessionId - the pack Session whose own file is being opened.
     * @param address - the resource address to open.
     * @param options - placement and navigation parameters, passed through.
     */
    function openPackResource(sidebarRight, openResource, sessionId, address, options) {
      const mounted = () => sidebarRight.mounted?.getSnapshot?.();
      let attempts = 0;
      const open = () => {
        // A wait that ran out must not act on the previous Session: the official
        // call would land in the wrong Surface.
        if (mounted() !== sessionId) {
          if (attempts > 40) return;
          attempts += 1;
          requestAnimationFrame(open);
          return;
        }
        try {
          openResource(address, options);
        } catch (error) {
          // Its refusal is matched by name, not by class: the service and this
          // bundle cross no realm here, but the message is the whole signal.
          const message = typeof error?.message === 'string' ? error.message : '';
          if (!message.includes(PACK_SURFACE_PENDING) || attempts > 40) throw error;
          attempts += 1;
          requestAnimationFrame(open);
          return;
        }
        try { if (!sidebarRight.isExpanded?.()) sidebarRight.toggleExpanded?.(); } catch (_) { /* no surface mounted */ }
      };
      open();
    }
    /**
     * The panel column drawn right now.
     *
     * A Session that has opened a tab keeps its own panel in the DOM after the
     * frame moves on; that one is hidden with its view, so the element to read is
     * the first that no hidden ancestor covers.
     */
    function onScreenPanel() {
      for (const panel of document.querySelectorAll('[data-sidebar-right-panel]')) {
        if (panel.closest('[hidden]') === null) return panel;
      }
      return undefined;
    }
    /**
     * The official right Sidebar is the frame's own third column, so a pack page
     * only has to stop covering it: its width is published as a CSS variable the
     * overlay subtracts from its right edge. Collapsed, fullscreen and narrow
     * viewports inset nothing — the panel itself covers or the frame has no
     * track.
     */
    function installPackSessionInset() {
      if (packSessionInset) return packSessionInset;
      const panelOf = onScreenPanel;
      const apply = () => {
        const panel = panelOf();
        const open = Boolean(panel?.hasAttribute('data-sidebar-right-open'));
        const push = panel?.getAttribute('data-sidebar-right-panel') === 'push';
        const width = open && push ? panel.offsetWidth : 0;
        document.documentElement.style.setProperty('--lwb-rightbar-inset', `${width}px`);
      };
      apply();
      let observed = null;
      const observer = new MutationObserver(apply);
      const resize = new ResizeObserver(apply);
      // The conversation streams constantly, so the frame watcher only re-binds
      // when the panel in view is replaced — a card switch hides one view and
      // reveals the next without touching the tree. Widths come from the panel's
      // own observers, never from a body mutation.
      const observe = () => {
        const panel = panelOf();
        if (panel === observed) return;
        observer.disconnect();
        resize.disconnect();
        observed = panel;
        if (panel) {
          observer.observe(panel, { attributes: true, attributeFilter: ['data-sidebar-right-open', 'data-sidebar-right-panel', 'style'] });
          resize.observe(panel);
        }
        apply();
      };
      observe();
      const frameObserver = new MutationObserver(observe);
      frameObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
      packSessionInset = () => {
        observer.disconnect();
        frameObserver.disconnect();
        resize.disconnect();
        document.documentElement.style.removeProperty('--lwb-rightbar-inset');
        packSessionInset = null;
      };
      return packSessionInset;
    }
    function armPackSession(sessionId) {
      const count = embeddedHostSessions.get(sessionId) || 0;
      if (count === 0 && !packSessionArmed()) {
        const current = currentSessionId();
        packSessionRestore = typeof current === 'string' && current ? current : null;
        packConversationDispose = services.slots.inject('main.conversation', () => services.slots.register({
          name: 'main.conversation', priority: -10, registrant: 'lwb-pack-conversation',
        }, PackConversationPlaceholder));
        installPackSessionInset();
      }
      embeddedHostSessions.set(sessionId, count + 1);
    }
    function releasePackSession(sessionId) {
      const count = embeddedHostSessions.get(sessionId) || 0;
      if (count === 0) return;
      if (count > 1) {
        embeddedHostSessions.set(sessionId, count - 1);
        return;
      }
      if (embeddedHostSessions.size === 1) collapsePackPanel();
      embeddedHostSessions.delete(sessionId);
      if (packSessionArmed()) return;
      packSessionInset?.();
      const restore = packSessionRestore;
      packSessionRestore = null;
      // Only hand the frame back while it still shows one of our Sessions: a
      // navigation the user made in the meantime must win.
      const current = currentSessionId();
      try {
        if (restore && current && packSessionRendered.has(current)
          && services?.sessions?.list?.getSnapshot?.().byId?.[restore]) services.uiWorkspace.openSession(restore);
      } finally {
        packConversationDispose?.();
        packConversationDispose = undefined;
      }
    }
    /**
     * Toggle the official right Sidebar for one embedded Session.
     *
     * `toggleExpanded()` acts on the mounted seat, so the card is focused first
     * and the call waits for that seat to publish the Session — the same order
     * the file-chip route uses, and the reason a keyboard-activated click works
     * as well as a pointer one.
     */
    function toggleEmbeddedRightbar(sessionId, expanded) {
      const sidebarRight = services?.sidebarRight;
      if (typeof sidebarRight?.toggleExpanded !== 'function') return;
      focusSession(sessionId, { keepExpanded: true });
      const epoch = packPanelEpoch;
      const mounted = () => sidebarRight.mounted?.getSnapshot?.();
      let attempts = 0;
      const run = () => {
        if (epoch !== packPanelEpoch || !embeddedHostSessions.has(sessionId)) return;
        if (mounted() === sessionId) {
          try {
            if (sidebarRight.isExpanded() !== expanded) sidebarRight.toggleExpanded();
          } catch (_) { /* no surface mounted yet */ }
          return;
        }
        // Never toggle whatever else is mounted: a wait that ran out simply
        // leaves the panel alone.
        if (attempts > 40) return;
        attempts += 1;
        requestAnimationFrame(run);
      };
      run();
    }

    /**
     * Whether the official panel column is showing a panel right now.
     *
     * The service publishes the on-screen Session but not that Session's layout,
     * so the marker its seat renders is the observable fact — the same element
     * this page's own width report measures.
     */
    function readPanelOpen() {
      return Boolean(onScreenPanel()?.hasAttribute('data-sidebar-right-open'));
    }
    /** Observe that marker, re-binding as a card switch puts another panel in view. */
    function subscribePanelOpen(listener) {
      let observed = null;
      const marker = new MutationObserver(listener);
      const rebind = () => {
        const panel = onScreenPanel();
        if (panel === observed) return;
        marker.disconnect();
        observed = panel;
        if (panel) marker.observe(panel, { attributes: true, attributeFilter: ['data-sidebar-right-open'] });
        listener();
      };
      const frame = new MutationObserver(rebind);
      frame.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
      rebind();
      return () => { marker.disconnect(); frame.disconnect(); };
    }
    /** One card head's panel control: the column is showing a panel for THIS card. */
    function panelControlState(mounted, sessionId, open) {
      return { expanded: mounted === sessionId && open === true };
    }
    /**
     * The control the official conversation header would have carried.
     *
     * The official expand button sits in `conversation.session.header.corner`,
     * which belongs to the frame's main panel chain — an embedded conversation
     * renders only the `conversation.content` factory, so it has no header to put
     * it in. This strip restores that affordance with the official action and the
     * column's own rendered state; nothing about the panel is reimplemented.
     */
    function EmbeddedConversationHead({ sessionId }) {
      const sessions = useObservable(services?.sessions?.list, undefined);
      const mounted = useObservable(services?.sidebarRight?.mounted, undefined);
      const open = React.useSyncExternalStore(subscribePanelOpen, readPanelOpen, () => false);
      const { expanded } = panelControlState(mounted, sessionId, open);
      const title = sessions?.byId?.[sessionId]?.displayTitle || '会话';
      const keys = services?.shortcuts?.catalog?.getSnapshot?.()?.find?.((entry) => entry.id === 'sidebar.right.toggle')?.keys?.[0];
      const label = expanded ? '收起右侧栏' : '展开右侧栏（产物、文件、终端等）';
      return h('div', { className: 'lwb-embedded-conversation-head' },
        h('strong', { className: 'lwb-embedded-conversation-title', title }, title),
        h('button', {
          type: 'button', className: 'lwb-embedded-rightbar-toggle',
          'data-lwb-session-control': '',
          'data-on': expanded ? 'true' : undefined,
          'aria-pressed': expanded ? 'true' : 'false',
          'aria-label': label,
          title: keys ? `${label} · ${keys}` : label,
          onClick: () => toggleEmbeddedRightbar(sessionId, !expanded),
        }, expanded ? '收起右栏' : '右侧栏'));
    }

    function retainEmbeddedSession(sessionId, onReady, onError, timeoutMs = 15000) {
      let active = true;
      let reference;
      const controller = new AbortController();
      const release = () => {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        controller.abort();
        reference?.release();
      };
      const fail = (error) => {
        if (!active) return;
        release();
        onError(error);
      };
      const timer = setTimeout(() => fail(new Error('会话加载超时，请重试。')), timeoutMs);
      try {
        reference = services.sessions.retain(sessionId, { source: 'gateway', signal: controller.signal });
        Promise.resolve(reference.ready).then(() => {
          if (!active) return;
          clearTimeout(timer);
          onReady(reference);
        }, fail);
      } catch (error) {
        fail(error);
      }
      return release;
    }

    function EmbeddedConversationHost({ sessionId, SessionProvider, renderFactorySlot }) {
      const renderSlot = arguments[0].renderSlot;
      const readOnly = arguments[0].readOnly === true;
      const [state, setState] = React.useState({ reference: null, error: null });
      const [attempt, setAttempt] = React.useState(0);
      React.useEffect(() => {
        packSessionRendered.add(sessionId);
        armPackSession(sessionId);
        return () => releasePackSession(sessionId);
      }, [sessionId]);
      React.useEffect(() => {
        setState({ reference: null, error: null });
        const release = retainEmbeddedSession(sessionId,
          (reference) => setState({ reference, error: null }),
          (error) => setState({ reference: null, error: error?.message || '会话加载失败。' }));
        return release;
      }, [sessionId, attempt]);
      if (state.error) return h('div', { className: 'lwb-embedded-conversation-state', role: 'alert' },
        h('p', null, state.error), button('lwb-plain-button', '重试', () => setAttempt(value => value + 1)));
      if (!SessionProvider || !renderFactorySlot) return h('div', { className: 'lwb-embedded-conversation-state', role: 'alert' }, '当前环境无法显示会话。');
      if (!state.reference || state.reference.sessionId !== sessionId) return h('div', { className: 'lwb-embedded-conversation-state' }, '正在加载对话…');
      return h('div', { className: 'lwb-embedded-conversation-shell', 'data-session-id': sessionId, 'data-read-only': readOnly || undefined },
        h(EmbeddedConversationHead, { sessionId }),
        h(SessionProvider, { session: state.reference },
          h('div', { className: 'lwb-embedded-conversation-main' },
            h(readOnly ? ReadOnlyConversationSurface : React.Fragment, readOnly ? { sessionId } : null,
              renderFactorySlot('conversation.content', {
            variant: 'embedded', phase: 'active', hero: false,
          }, { slots: { views: FixedEmbeddedConversationView } })))));

    }


    function CapabilityPage({ renderConversation, focusSession }) {
      const state = useProduct();
      const copy = useLwbCopy();
      const catalog = usePackCatalog();
      const registry = useLwbPackClient();
      const selected = capabilityAtRoute(catalog.packs, state.capabilityPage);
      if (!selected) return h('div', { className: 'lwb-card lwb-empty-state' }, h('div', null, h('div', { className: 'lwb-empty-glyph' }, '▦'), h('h2', null, copy.noCapability), h('p', null, copy.noCapabilityCopy), button('lwb-primary-button', copy.goToPacks, () => navTo('packs'))));
      const { pack, menu } = selected;
      const Component = registry?.page(pack.id, menu.id);
      if (Component) return h(CapabilityPageBoundary, {
        key: capabilityRoute(pack.id, menu.id), copy,
        onReturnToConversation: () => showConversation(), onViewPacks: () => navTo('packs'),
      }, h(Component, {
        pack,
        menu,
        packId: pack.id,
        lwbAccount: lwbAccountFacade,
        renderConversation,
        focusSession,
        openConversation: () => showConversation(),
        openPacks: () => navTo('packs'),
        openPackMenu: (menuId) => { if (pack.menus.some((item) => item.id === menuId)) navTo('capability', capabilityRoute(pack.id, menuId)); },
      }));
      return h('div', { className: 'lwb-card lwb-empty-state' }, h('div', null,
        h('div', { className: 'lwb-empty-glyph' }, menu.glyph), h('h2', null, copy.clientUnavailable),
        h('p', null, copy.capabilityPageCopy(pack.name)),
        h('div', { className: 'lwb-row-actions', style: { justifyContent: 'center' } }, button('lwb-plain-button', copy.returnToConversation, () => showConversation()), button('lwb-primary-button', copy.viewPacks, () => navTo('packs'))),
      ));
    }

    function MobileNavToggle() {
      const state = useProduct();
      const copy = useLwbCopy();
      return h(React.Fragment, null,
        state.mobileNavOpen && h('button', { type: 'button', className: 'lwb-mobile-nav-backdrop', 'aria-label': copy.closeNavigation, onClick: () => updateProduct({ mobileNavOpen: false }, false) }),
        h('button', {
          type: 'button', className: 'lwb-mobile-nav-trigger', title: state.mobileNavOpen ? copy.closeNavigation : copy.openNavigation,
          'aria-label': state.mobileNavOpen ? copy.closeNavigation : copy.openNavigation,
          onClick: () => updateProduct({ mobileNavOpen: !state.mobileNavOpen, conversationPanelOpen: false }, false),
        }, state.mobileNavOpen ? '×' : '☰'),
        state.page === 'conversation' && h('button', {
          type: 'button', className: 'lwb-mobile-conversation-trigger', title: copy.openConversationList, 'aria-label': copy.openConversationList,
          onClick: () => updateProduct({ conversationPanelOpen: true, mobileNavOpen: false }, false),
        }, '◌'),
      );
    }

    function WorkbenchOverlay({ renderSlot, renderFactorySlot, SessionProvider, useSessions, useWorkspaces }) {
      const state = useProduct();
      const copy = useLwbCopy();
      const catalog = usePackCatalog();
      const selected = state.page === 'capability' ? capabilityAtRoute(catalog.packs, state.capabilityPage) : undefined;
      const chrome = pageChrome(state.page, selected, copy);
      if (state.page === 'conversation') return h(React.Fragment, null, h(MobileNavToggle), h(ConversationOverlay, { renderSlot, useSessions, useWorkspaces }));
      // Pack pages live inside this overlay, so a Session shown there is rendered
      // by the pack page itself. Focusing one of those Sessions is what makes the
      // frame's own right Sidebar (and the rest of the official current-Session
      // surface) follow that card; the overlay yields the Sidebar's column for as
      // long as a pack Session is on screen.
      const renderConversation = ({ sessionId, readOnly = false }) => h(EmbeddedConversationHost, { sessionId, readOnly, SessionProvider, renderFactorySlot, renderSlot });
      const body = h(React.Fragment, null,
        (state.page === 'capability' || (state.page === 'settings' && state.accountReturnRoute)) && h('div', { key: 'capability', hidden: state.page !== 'capability', style: state.page !== 'capability' ? { display: 'none' } : undefined }, h(CapabilityPage, { renderConversation, focusSession })),
        state.page === 'packs' ? h(PacksPage, { key: 'packs' }) : state.page === 'settings' ? h(SettingsPage, { key: 'settings', renderSlot }) : null);
      return h(React.Fragment, null, h(MobileNavToggle), h('section', { className: 'lwb-overlay', 'aria-label': chrome.ariaLabel },
        h('header', { className: 'lwb-overlay-head' }, h('div', { className: 'lwb-overlay-title' }, h('b', null, chrome.title), h('span', null, chrome.hint)), button('lwb-plain-button', `← ${copy.conversation}`, () => showConversation())),
        h('main', { className: 'lwb-overlay-body' }, h('div', { className: state.page === 'capability' ? 'lwb-page lwb-page-capability' : 'lwb-page' },
          h('div', { className: 'lwb-page-intro' }, h('div', null, h('div', { className: 'lwb-eyebrow' }, chrome.eyebrow), h('h1', null, chrome.title), h('p', null, chrome.intro)),
            null,
          ), body,
        )),
      ));
    }

    function apply(ctx) {
      lwbPackClient = new LwbPackClientRegistry();
      ctx.provide('lwbPackClient', lwbPackClient);
      lwbPackClientRuntime = new LwbPackClientRuntime(ctx.get('modules'));
      services = {
        slots: ctx.get('slots'), connection: ctx.get('connection'), sessions: ctx.get('sessions'), workspaces: ctx.get('workspaces'), uiWorkspace: ctx.get('uiWorkspace'), layout: ctx.get('layout'), locale: ctx.get('locale'), remote: ctx.get('remote'),
        // Both are looked up rather than injected: an embedded conversation only
        // loses its right-Sidebar control when the composition lacks them.
        sidebarRight: ctx.get('sidebarRight'), shortcuts: ctx.get('shortcuts'),
        uiSession: ctx.get('uiSession'),
        composerBlocks: () => ctx.get('conversation')?.blocks,
      };
      installStyle();
      // A file chip inside an embedded conversation asks the Sidebar to open a
      // resource. The official Sidebar serves the frame's current Session, so a
      // resource of a pack Session is routed the same way: focus that card's
      // Session, then let the official call do the rest once its own surface is
      // ready. Anything else keeps the untouched official path.
      const sidebarRight = ctx.get('sidebarRight');
      let restoreOpenResource;
      if (sidebarRight && typeof sidebarRight.openResource === 'function') {
        const openResource = sidebarRight.openResource.bind(sidebarRight);
        sidebarRight.openResource = (address, options) => {
          const sessionId = sessionIdFromResourceAddress(address);
          if (!sessionId || !embeddedHostSessions.has(sessionId)) {
            openResource(address, options);
            return;
          }
          focusSession(sessionId, { keepExpanded: true });
          openPackResource(sidebarRight, openResource, sessionId, address, options);
        };
        restoreOpenResource = () => { sidebarRight.openResource = openResource; };
      }
      const disposeProductMetadata = installProductMetadata();
      const disposeDshAccount = startDshAccountStream();
      void refreshPackCatalog();
      const refreshAccountWhenVisible = () => { if (document.visibilityState !== 'hidden') void refreshLwbAccount(); };
      refreshAccountWhenVisible();
      const accountTimer = setInterval(refreshAccountWhenVisible, 15000);
      window.addEventListener('focus', refreshAccountWhenVisible);
      document.addEventListener('visibilitychange', refreshAccountWhenVisible);
      // A card focus owes its collapse only until the gesture that focused it
      // ends: that gesture's own click is what may carry the official open which
      // supersedes it. Document-level, so a gesture leaving the card still settles.
      document.addEventListener('pointerup', settlePanelGesture, true);
      document.addEventListener('pointercancel', settlePanelGesture, true);
      document.addEventListener('click', settlePanelGesture, false);
      const disposePackCatalogReset = ctx.on('connection/reset', () => {
        void refreshPackCatalog();
        });
      ctx.effect(() => {
        // The Desktop serves its initial HTML directly; update its favicon too.
        const oldIcons = Array.from(document.querySelectorAll('link[rel="icon"]'));
        oldIcons.forEach(icon => icon.remove());
        const favicon = document.createElement('link');
        favicon.rel = 'icon';
        favicon.type = 'image/png';
        favicon.href = LOGO_PATH;
        document.head.append(favicon);
        const disposeHeroBrand = ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
          name: 'conversation.hero.brand.mark', registrant: 'lwb-workbench',
        }, LwbBrandMark));
        let disposeSidebar;
        const enableSidebar = () => {
          if (disposeSidebar) return;
          disposeSidebar = ctx.slots.inject('sidebar', () => ctx.slots.register({
            name: 'sidebar', priority: -10, registrant: 'lwb-workbench',
          }, LwbSidebar));
        };
        const disableSidebar = () => {
          disposeSidebar?.();
          disposeSidebar = undefined;
        };
        enableSidebar();
        // The conversation column renders `sidebar.panellist`, so its rows are
        // projected here for the same reason the official shell projects them:
        // registration and locale changes both move a row's label, and a later
        // registrant adds its own panel without a reload.
        const disposeConversationPanels = typeof ctx.slots.subscribe === 'function'
          ? ctx.slots.subscribe('sidebar.panellist', syncConversationPanels)
          : () => {};
        const disposeConversationPanelLabels = typeof services.locale?.subscribe === 'function'
          ? services.locale.subscribe(syncConversationPanels)
          : () => {};
        syncConversationPanels();
        const disposeRuntimeSettingsTrigger = ctx.slots.inject('settings.launcher', () => ctx.slots.register({
          name: 'settings.launcher', priority: -10, registrant: 'lwb-workbench',
        }, LwbRuntimeSettingsTrigger));
        const disposeOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay', id: 'lwb-workbench-management', order: 10, registrant: 'lwb-workbench',
            children: {
              'sidebar.settings': { kind: 'single', scope: 'root' },
              // The conversation module renders the official browsing region, so
              // the declaration has to sit on THIS entry: the slot kit binds
              // renderSlot per registration and rejects any key the rendering
              // entry did not declare. Declaring the seat is also what activates
              // `ui-workspace`'s Workspace browser, since upstream `ui-sidebar`
              // is disabled for this composition.
              'sidebar.workspaces': { kind: 'single', scope: 'root' },
              // The official global panel rows (the Plugins entry today) belong
              // to the conversation column for the same reason, and declaring
              // the seat is what activates `ui-plugin-manager`'s registration.
              // Row labels and selection stay the shell's; the glyph is the
              // registrant's.
              'sidebar.panellist': { kind: 'list', scope: 'root' },
              // Declaring one Session-scoped child is what makes the slot kit
              // hand this overlay a SessionProvider; pack pages use it to render
              // an official conversation for one of their own Sessions.
              'lwb.embedded.conversation': { kind: 'single', scope: 'session' },
              // `sidebar.workspaces.directoryFlow` is deliberately absent: the
              // Workspace browser declares its own flow seat, and declaring it
              // twice fails at load. DSH activates its picker once the browser
              // has declared the sidebar half and ui-workspace the hero half.
            },
          }, WorkbenchOverlay));
        return () => {
          disposeHeroBrand?.();
          favicon.remove();
          oldIcons.forEach(icon => document.head.append(icon));
          disableSidebar();
          disposeConversationPanels?.();
          disposeConversationPanelLabels?.();
          conversationPanels.rows = [];
          disposeRuntimeSettingsTrigger?.();
          disposeOverlay?.();
          packConversationDispose?.();
          packConversationDispose = undefined;
          disposePackCatalogReset?.();
          restoreOpenResource?.();
          disposeDshAccount?.();
          clearInterval(accountTimer);
          window.removeEventListener('focus', refreshAccountWhenVisible);
          document.removeEventListener('visibilitychange', refreshAccountWhenVisible);
          document.removeEventListener('pointerup', settlePanelGesture, true);
          document.removeEventListener('pointercancel', settlePanelGesture, true);
          document.removeEventListener('click', settlePanelGesture, false);
          disposeProductMetadata();
          lwbPackClient = undefined;
          lwbPackClientRuntime = undefined;
          document.getElementById('lwb-workbench-style')?.remove();
          document.documentElement.style.removeProperty('--lwb-sidebar-width');
        };
      }, 'lwb: unified workbench shell');
    }

    // The right Sidebar and the workspace-files namespace are looked up at use
    // time, not declared here: a composition without either must still boot the
    // workbench, and the artifact panel says so instead of blocking the shell.
    exports.inject = ['slots', 'connection', 'sessions', 'workspaces', 'uiWorkspace', 'layout', 'locale', 'remote', 'remote.account', 'loader', 'modules'];
    exports.apply = apply;
    return module.exports;
  },
});
