// ==UserScript==
// @name         QQ频道板块与关键词屏蔽器 (QQ Guild Board & Keyword Filter)
// @namespace    https://github.com/fisherbio/qq-channel-filter
// @version      1.6.0
// @description  在QQ频道网页版(pd.qq.com)的“全部”、“最新”、“最热”、“热门”等混合帖子流中屏蔽指定板块、关键词或发帖人，支持Pinia响应式无缝排版（自动回补缺额帖子）、事件捕获级快速屏蔽按钮、极速Toast撤销提示与可视化设置面板。
// @author       fisherbio
// @match        https://pd.qq.com/*
// @homepage     https://github.com/fisherbio/qq-channel-filter
// @updateURL    https://raw.githubusercontent.com/fisherbio/qq-channel-filter/main/qq-channel-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/fisherbio/qq-channel-filter/main/qq-channel-filter.user.js
// @license      MIT
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Storage Wrapper (synced between GM storage and localStorage)
    const storage = {
        get(key, defaultValue) {
            let val;
            if (typeof GM_getValue !== 'undefined') {
                val = GM_getValue(key, undefined);
            }
            if (val === undefined) {
                try {
                    const localVal = localStorage.getItem('qq_filter_' + key);
                    if (localVal !== null) val = JSON.parse(localVal);
                } catch (e) {}
            }
            return val !== undefined ? val : defaultValue;
        },
        set(key, value) {
            if (typeof GM_setValue !== 'undefined') {
                try { GM_setValue(key, value); } catch (e) {}
            }
            try {
                localStorage.setItem('qq_filter_' + key, JSON.stringify(value));
            } catch (e) {}
        }
    };

    // Configuration
    const config = {
        enabled: storage.get('enabled', true),
        onlyInMixedFeed: storage.get('onlyInMixedFeed', true),
        showBadges: storage.get('showBadges', true),
        blockedBoards: storage.get('blockedBoards', []),       // List of board names
        blockedKeywords: storage.get('blockedKeywords', []),   // List of keyword strings
        blockedUsers: storage.get('blockedUsers', []),         // List of blocked usernames or IDs
        boardMap: storage.get('boardMap', {
            "661239308": "各类交易",
            "661240977": "学习互助",
            "661241170": "校园灌水区",
            "661241413": "袁家岗专区",
            "661241544": "校/院通知转发",
            "661242841": "各类招募（禁宣传兼职）",
            "661242944": "商品评价/美食分享",
            "661247771": "渝小医二创",
            "661252779": "猫鸟日记",
            "661263773": "情感树洞",
            "661290947": "游戏开黑",
            "661304472": "其他校区",
            "661307459": "租房/寝室",
            "687873199": "校园摄影",
            "691249651": "失物招领",
            "703678343": "新生咨询",
            "703837856": "Day0",
            "704873767": "拼车/搭子",
            "709370275": "料理鼠王",
            "714070364": "爱好｜分享",
            "714204830": "🐭窝の精品",
            "714423716": "研究生相关",
            "716040332": "医科社畜",
            "716292546": "西迁生物志",
            "718992586": "版规/声明",
            "722912974": "期末博物馆",
            "733501873": "神人列传",
            "736436444": "资料分享版",
            "742935467": "天堂鸡汤"
        })
    };

    let stats = {
        hiddenCount: 0,
        boardHidden: 0,
        keywordHidden: 0,
        userHidden: 0
    };

    let isScanningBoards = false;

    // Save config
    function saveConfig() {
        storage.set('enabled', config.enabled);
        storage.set('onlyInMixedFeed', config.onlyInMixedFeed);
        storage.set('showBadges', config.showBadges);
        storage.set('blockedBoards', config.blockedBoards);
        storage.set('blockedKeywords', config.blockedKeywords);
        storage.set('blockedUsers', config.blockedUsers);
        storage.set('boardMap', config.boardMap);
        if (typeof storeManager !== 'undefined' && storeManager.replenishBudget !== undefined) {
            storeManager.replenishBudget = storeManager.MAX_BUDGET;
        }
    }

    // Reload config from storage
    function reloadConfig() {
        config.enabled = storage.get('enabled', true);
        config.onlyInMixedFeed = storage.get('onlyInMixedFeed', true);
        config.showBadges = storage.get('showBadges', true);
        config.blockedBoards = storage.get('blockedBoards', []);
        config.blockedKeywords = storage.get('blockedKeywords', []);
        config.blockedUsers = storage.get('blockedUsers', []);
        config.boardMap = storage.get('boardMap', config.boardMap);
    }

    // Determine if current view is a mixed feed (全部 / 热门 / 最新 / 最热)
    function isCurrentMixedFeed() {
        const activeTab = document.querySelector('.tab-bar__item.is-active');
        if (!activeTab) return true;
        const text = activeTab.textContent.trim();
        return ['全部', '热门', '最新', '最热'].includes(text);
    }

    // Elegant Toast Notification with Undo Button
    function showToast(message, undoCallback) {
        let container = document.getElementById('qq-filter-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'qq-filter-toast-container';
            container.style.cssText = `
                position: fixed;
                top: 24px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 1000000;
                display: flex;
                flex-direction: column;
                gap: 8px;
                align-items: center;
                pointer-events: none;
            `;
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.style.cssText = `
            pointer-events: auto;
            display: inline-flex;
            align-items: center;
            gap: 12px;
            background: rgba(30, 32, 40, 0.96);
            color: #ffffff;
            padding: 9px 18px;
            border-radius: 24px;
            font-size: 13px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(8px);
            animation: qqToastIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            transition: all 0.25s ease;
            user-select: none;
        `;

        const textSpan = document.createElement('span');
        textSpan.textContent = message;
        toast.appendChild(textSpan);

        if (undoCallback) {
            const undoBtn = document.createElement('button');
            undoBtn.textContent = '↩️ 撤销';
            undoBtn.style.cssText = `
                background: #2b7fff;
                color: #fff;
                border: none;
                border-radius: 12px;
                padding: 3px 10px;
                font-size: 12px;
                cursor: pointer;
                font-weight: 500;
                transition: background 0.15s ease;
            `;
            undoBtn.onmouseenter = () => undoBtn.style.background = '#1a6ff0';
            undoBtn.onmouseleave = () => undoBtn.style.background = '#2b7fff';
            undoBtn.onclick = (e) => {
                e.stopPropagation();
                undoCallback();
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(-10px)';
                setTimeout(() => toast.remove(), 250);
            };
            toast.appendChild(undoBtn);
        }

        container.appendChild(toast);

        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(-10px)';
                setTimeout(() => toast.remove(), 250);
            }
        }, 4000);
    }

    // Extract text from feed item object
    function extractItemText(item) {
        if (!item) return '';
        const parts = [];
        if (item.title?.contents) {
            for (const c of item.title.contents) {
                if (c.text_content?.text) parts.push(c.text_content.text);
            }
        }
        if (item.contents?.contents) {
            for (const c of item.contents.contents) {
                if (c.text_content?.text) parts.push(c.text_content.text);
            }
        } else if (Array.isArray(item.contents)) {
            for (const c of item.contents) {
                if (c.text_content?.text) parts.push(c.text_content.text);
            }
        }
        if (item.feed_abstract?.title) parts.push(item.feed_abstract.title);
        if (item.poster?.nick) parts.push(item.poster.nick);
        return parts.join(' ');
    }

    // Determine if an item object should be blocked
    function shouldBlockItem(item) {
        if (!config.enabled) return { blocked: false };
        if (config.onlyInMixedFeed && !isCurrentMixedFeed()) return { blocked: false };

        // 1. Author / User check
        const posterNick = item.poster?.nick || item.author?.nick || '';
        const posterId = String(item.poster?.id || item.poster?.tiny_id || item.author?.id || '');
        if (config.blockedUsers.length > 0) {
            if ((posterNick && config.blockedUsers.includes(posterNick)) ||
                (posterId && config.blockedUsers.includes(posterId))) {
                return { blocked: true, reason: `用户: ${posterNick || posterId}`, type: 'user' };
            }
        }

        // 2. Board check
        const subc = String(item.channelInfo?.sign?.channel_id || item.channelInfo?.channel_id || item.subChannelId || item.channelId || '');
        const boardName = item.channelInfo?.name || item.channelName || config.boardMap[subc] || (subc ? ('板块' + subc) : '');

        // Auto-learn board mapping
        if (subc && boardName && !config.boardMap[subc]) {
            config.boardMap[subc] = boardName;
            saveConfig();
        }

        if (boardName && (config.blockedBoards.includes(boardName) || config.blockedBoards.includes(subc))) {
            return { blocked: true, reason: `板块: ${boardName}`, type: 'board' };
        }

        // 3. Keyword check
        if (config.blockedKeywords.length > 0) {
            const text = extractItemText(item);
            for (const kw of config.blockedKeywords) {
                if (kw && text.includes(kw)) {
                    return { blocked: true, reason: `关键词: ${kw}`, type: 'keyword' };
                }
            }
        }

        return { blocked: false };
    }

    // =========================================================================
    // Pinia Store Manager: Seamless Reactive Layout Synchronization & Auto-Replenish
    // =========================================================================
    const storeManager = {
        pinia: null,
        mainFeedsStore: null,
        mainStore: null,
        channelStore: null,
        rawFeedsMap: new Map(),     // feedId -> rawFeedItem
        rawFeedsList: [],           // Preserves original order
        rawTopFeedsList: [],        // Preserves original top feeds
        isFiltering: false,
        initialized: false,

        // --- Backfill & Auto-Replenish Controls ---
        isReplenishing: false,
        replenishBudget: 3,         // Max consecutive automatic backfill requests
        MAX_BUDGET: 3,
        SAFE_MIN_ITEMS: 15,         // Safe watermark threshold to fill viewport
        lastErrorTime: 0,
        COOL_DOWN_MS: 15000,        // Circuit breaker cool-down (15s)
        replenishTimer: null,

        getPinia() {
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            try {
                if (win.useNuxtApp) {
                    return win.useNuxtApp()?.vueApp?.config?.globalProperties?.$pinia || null;
                }
            } catch (e) {}
            return null;
        },

        init() {
            if (this.initialized) return;
            const pinia = this.getPinia();
            if (!pinia || !pinia._s) return;

            this.pinia = pinia;
            this.mainFeedsStore = pinia._s.get('mainFeedsStore');
            this.mainStore = pinia._s.get('mainStore');
            this.channelStore = pinia._s.get('channelStore');

            if (!this.mainFeedsStore) return;
            this.initialized = true;

            // Ingest current items
            this.ingestFeeds();

            // Hook store mutations ($subscribe)
            this.mainFeedsStore.$subscribe((mutation, state) => {
                if (this.isFiltering) return;
                this.ingestFeeds();
                this.syncFeeds();
            });

            // Hook actions ($onAction) for infinite scroll & refreshes
            if (this.mainFeedsStore.$onAction) {
                this.mainFeedsStore.$onAction(({ name, after, onError }) => {
                    if (['fetchFeeds', 'insertFeedItem', 'resetFeedsData'].includes(name)) {
                        after(() => {
                            setTimeout(() => {
                                this.ingestFeeds();
                                this.syncFeeds();
                            }, 30);
                        });
                    }
                    if (onError) {
                        onError((err) => {
                            console.warn('[QQ-Filter] fetchFeeds encountered error, entering cooldown.', err);
                            this.lastErrorTime = Date.now();
                            this.isReplenishing = false;
                        });
                    }
                });
            }

            // Hook user scroll to refresh replenish budget
            const bindScrollListener = () => {
                const scroller = document.getElementById('scrollableDiv') || document.querySelector('.game-guild-main__waterfalls-scroller');
                if (scroller && !scroller._qqFilterBound) {
                    scroller._qqFilterBound = true;
                    scroller.addEventListener('scroll', () => {
                        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 300) {
                            this.replenishBudget = this.MAX_BUDGET;
                        }
                    }, { passive: true });
                }
            };
            bindScrollListener();
            setTimeout(bindScrollListener, 1000);

            // Hook tab switching
            if (this.mainStore && this.mainStore.$subscribe) {
                this.mainStore.$subscribe(() => {
                    this.rawFeedsMap.clear();
                    this.rawFeedsList = [];
                    this.rawTopFeedsList = [];
                    this.replenishBudget = this.MAX_BUDGET;
                    setTimeout(() => {
                        this.ingestFeeds();
                        this.syncFeeds();
                        bindScrollListener();
                    }, 60);
                });
            }

            this.syncFeeds();
            console.log('[QQ-Channel-Filter] Pinia store reactive synchronization & auto-replenish active.');
        },

        ingestFeeds() {
            if (!this.mainFeedsStore) return;
            const currentItems = this.mainFeedsStore.items || [];
            const currentTop = this.mainFeedsStore.topFeeds || [];

            // Reset cache if completely switched tabs/channel
            if (currentItems.length > 0 && this.rawFeedsList.length > 0) {
                const firstId = currentItems[0]?.id;
                if (firstId && !this.rawFeedsMap.has(firstId)) {
                    this.rawFeedsMap.clear();
                    this.rawFeedsList = [];
                    this.rawTopFeedsList = [];
                    this.replenishBudget = this.MAX_BUDGET;
                }
            }

            // Ingest main feed items
            for (const item of currentItems) {
                if (item && item.id && !this.rawFeedsMap.has(item.id)) {
                    this.rawFeedsMap.set(item.id, item);
                    this.rawFeedsList.push(item);
                }
            }

            // Ingest top pinned feeds
            if (currentTop.length > 0 && this.rawTopFeedsList.length === 0) {
                this.rawTopFeedsList = [...currentTop];
            }
        },

        syncFeeds() {
            if (!this.mainFeedsStore || this.isFiltering) return;
            this.isFiltering = true;

            try {
                let blockedCount = 0;
                let boardCount = 0;
                let kwCount = 0;
                let userCount = 0;

                // 1. Filter main feeds
                const targetItems = [];
                for (const item of this.rawFeedsList) {
                    const res = shouldBlockItem(item);
                    if (res.blocked) {
                        blockedCount++;
                        if (res.type === 'board') boardCount++;
                        else if (res.type === 'keyword') kwCount++;
                        else if (res.type === 'user') userCount++;
                    } else {
                        targetItems.push(item);
                    }
                }

                const curItems = this.mainFeedsStore.items;
                let needUpdateItems = curItems.length !== targetItems.length;
                if (!needUpdateItems) {
                    for (let i = 0; i < curItems.length; i++) {
                        if (curItems[i]?.id !== targetItems[i]?.id) {
                            needUpdateItems = true;
                            break;
                        }
                    }
                }

                if (needUpdateItems) {
                    curItems.splice(0, curItems.length, ...targetItems);
                    // Force scroller update
                    const scroller = document.getElementById('scrollableDiv') || document.querySelector('.game-guild-main__waterfalls-scroller');
                    if (scroller) {
                        scroller.scrollTop += 1;
                        scroller.scrollTop -= 1;
                    }
                }

                // 2. Filter top feeds
                if (this.rawTopFeedsList.length > 0) {
                    const targetTop = this.rawTopFeedsList.filter(item => !shouldBlockItem(item).blocked);
                    const curTop = this.mainFeedsStore.topFeeds;
                    let needUpdateTop = curTop.length !== targetTop.length;
                    if (!needUpdateTop) {
                        for (let i = 0; i < curTop.length; i++) {
                            if (curTop[i]?.id !== targetTop[i]?.id) {
                                needUpdateTop = true;
                                break;
                            }
                        }
                    }
                    if (needUpdateTop) {
                        curTop.splice(0, curTop.length, ...targetTop);
                    }
                }

                // 3. Immediate DOM safeguard
                const cards = document.querySelectorAll('.game-guild-main__waterfalls__item');
                cards.forEach(card => {
                    const a = card.querySelector('a.game-guild-main__short-content');
                    const match = (a?.href || '').match(/subc=([0-9]+)/);
                    const subc = match ? match[1] : null;
                    const boardName = config.boardMap[subc] || (subc ? ('板块' + subc) : '');
                    const nickEl = card.querySelector('.nick');
                    const nick = nickEl ? nickEl.textContent.trim() : '';

                    let hide = false;
                    if (nick && config.blockedUsers.includes(nick)) hide = true;
                    if (boardName && (config.blockedBoards.includes(boardName) || config.blockedBoards.includes(subc))) hide = true;

                    if (hide) {
                        card.style.display = 'none';
                        const itemView = card.closest('.vue-recycle-scroller__item-view');
                        if (itemView) itemView.style.display = 'none';
                    } else {
                        card.style.display = '';
                        const itemView = card.closest('.vue-recycle-scroller__item-view');
                        if (itemView && !itemView.style.transform.includes('-9999px')) {
                            itemView.style.display = '';
                        }
                    }
                });

                // Update stats
                stats.hiddenCount = blockedCount;
                stats.boardHidden = boardCount;
                stats.keywordHidden = kwCount;
                stats.userHidden = userCount;
                updateStatsDisplay();

                // 4. Trigger Auto-Replenish / Backfill evaluation
                this.checkAndReplenish();
            } catch (err) {
                console.error('[QQ-Channel-Filter] syncFeeds error:', err);
            } finally {
                this.isFiltering = false;
            }
        },

        // --- Backfill Evaluation & Dispatcher ---
        checkAndReplenish() {
            if (!this.mainFeedsStore) return;
            if (!config.enabled) return;
            if (config.onlyInMixedFeed && !isCurrentMixedFeed()) return;

            // Guard 1: Concurrency and active request check
            if (this.isReplenishing || this.mainFeedsStore.isRequesting || this.mainFeedsStore.isLoading) return;

            // Guard 2: End-of-feed check (server has no more items)
            if (this.mainFeedsStore.isFinish === 1 || this.mainFeedsStore.isFinish === true) {
                return;
            }

            // Guard 3: Circuit breaker cooldown check
            if (Date.now() - this.lastErrorTime < this.COOL_DOWN_MS) {
                return;
            }

            // Guard 4: Budget exhaustion check
            if (this.replenishBudget <= 0) {
                return;
            }

            // Check if replenish is actually needed
            const curItemsCount = this.mainFeedsStore.items?.length || 0;
            const scroller = document.getElementById('scrollableDiv') || document.querySelector('.game-guild-main__waterfalls-scroller');
            const isUnderflowByCount = curItemsCount < this.SAFE_MIN_ITEMS;
            const isUnderflowByHeight = scroller && (scroller.scrollHeight <= scroller.clientHeight * 1.5);

            if (!isUnderflowByCount && !isUnderflowByHeight) {
                return; // Healthy watermark reached
            }

            // Debounce & dispatch
            if (this.replenishTimer) clearTimeout(this.replenishTimer);
            this.replenishTimer = setTimeout(() => {
                this.executeReplenish();
            }, 350); // 350ms gentle pacing to avoid burst rate-limiting
        },

        async executeReplenish() {
            if (this.isReplenishing || !this.mainFeedsStore) return;
            if (this.mainFeedsStore.isRequesting || this.mainFeedsStore.isLoading) return;
            if (this.replenishBudget <= 0) return;

            this.isReplenishing = true;
            this.replenishBudget--;

            // Dynamically resolve context arguments
            const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const route = win.useNuxtApp?.()._route;
            const guildNum = this.channelStore?.currentChannelInfo?.guild_number 
                          || route?.params?.guildNum 
                          || '';
            const selectedTab = this.mainStore?.currentTab 
                             || route?.query?.subc 
                             || '';

            try {
                console.log(`[QQ-Filter] Auto-replenishing feeds (Remaining budget: ${this.replenishBudget}, Current visible: ${this.mainFeedsStore.items?.length || 0})...`);
                const params = { isFirstPage: false };
                if (selectedTab) params.selectedTab = selectedTab;
                if (guildNum) params.guildNum = guildNum;

                if (typeof this.mainFeedsStore.fetchFeeds === 'function') {
                    const res = this.mainFeedsStore.fetchFeeds(params);
                    if (res && typeof res.then === 'function') {
                        await res;
                    }
                } else {
                    // Fallback: trigger native infinite scroller
                    const scroller = document.getElementById('scrollableDiv') || document.querySelector('.game-guild-main__waterfalls-scroller');
                    if (scroller) {
                        scroller.scrollTop = scroller.scrollHeight;
                        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
                    }
                }
            } catch (e) {
                console.warn('[QQ-Filter] Auto-replenish failed:', e);
                this.lastErrorTime = Date.now();
            } finally {
                this.isReplenishing = false;
            }
        }
    };

    // Extract subchannel ID from DOM card link href
    function getSubcFromCard(card) {
        const a = card.querySelector('a.game-guild-main__short-content');
        if (!a) return null;
        const match = (a.href || '').match(/subc=([0-9]+)/);
        return match ? match[1] : null;
    }

    // Get board name from subc
    function getBoardName(subc) {
        if (!subc) return '';
        return config.boardMap[subc] || ('板块' + subc);
    }

    // Universal Capture-Phase Event Stopper
    function bindCaptureStop(el, action) {
        ['click', 'mousedown', 'mouseup', 'pointerdown'].forEach(evt => {
            el.addEventListener(evt, (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if (evt === 'click' && action) {
                    action();
                }
                return false;
            }, true);
        });
    }

    // Attach stylish action buttons to post card
    function attachActions(card) {
        const base = card.querySelector('.user-info__base') || card.querySelector('.user-info');
        if (!base) return;

        // Clean any old badge
        card.querySelectorAll('.qq-filter-badge').forEach(b => b.remove());

        // Find nick
        const nickEl = base.querySelector('.nick') || card.querySelector('.nick');
        const nick = nickEl ? nickEl.textContent.trim() : '';

        // Find subc and board name
        const subc = getSubcFromCard(card);
        const boardName = getBoardName(subc);

        // 1. Author Block Button (👤🚫)
        let userBtn = base.querySelector('.qq-filter-user-btn');
        if (nick && !userBtn) {
            userBtn = document.createElement('span');
            userBtn.className = 'qq-filter-action-btn qq-filter-user-btn';
            userBtn.title = `一键拉黑作者【${nick}】（不再显示TA的所有帖子）`;
            userBtn.innerHTML = `👤🚫 ${nick}`;

            bindCaptureStop(userBtn, () => {
                if (!config.blockedUsers.includes(nick)) {
                    config.blockedUsers.push(nick);
                    saveConfig();
                    renderUI();
                    storeManager.syncFeeds();
                    showToast(`已拉黑作者【${nick}】，屏蔽其所有帖子`, () => {
                        config.blockedUsers = config.blockedUsers.filter(u => u !== nick);
                        saveConfig();
                        renderUI();
                        storeManager.syncFeeds();
                    });
                }
            });

            if (nickEl) {
                nickEl.insertAdjacentElement('afterend', userBtn);
            } else {
                base.appendChild(userBtn);
            }
        }

        // 2. Board Block Button (🏷️🚫)
        let boardBtn = base.querySelector('.qq-filter-board-btn');
        if (boardName && !boardBtn) {
            boardBtn = document.createElement('span');
            boardBtn.className = 'qq-filter-action-btn qq-filter-board-btn';
            boardBtn.title = `一键屏蔽板块【${boardName}】（不再显示该板块的任何帖子）`;
            boardBtn.innerHTML = `🏷️🚫 ${boardName}`;

            bindCaptureStop(boardBtn, () => {
                if (!config.blockedBoards.includes(boardName)) {
                    config.blockedBoards.push(boardName);
                    saveConfig();
                    renderUI();
                    storeManager.syncFeeds();
                    showToast(`已屏蔽【${boardName}】板块下的所有帖子`, () => {
                        config.blockedBoards = config.blockedBoards.filter(b => b !== boardName);
                        saveConfig();
                        renderUI();
                        storeManager.syncFeeds();
                    });
                }
            });

            base.appendChild(boardBtn);
        }
    }

    // Core Filter Function for a Single DOM Card
    function filterCard(card) {
        if (storeManager.initialized) {
            attachActions(card);
            return false;
        }

        // DOM Fallback if Pinia is unavailable
        if (!config.enabled || (config.onlyInMixedFeed && !isCurrentMixedFeed())) {
            card.style.display = '';
            return false;
        }

        const subc = getSubcFromCard(card);
        const boardName = getBoardName(subc);
        const textContent = (card.textContent || '').trim();
        const nickEl = card.querySelector('.nick');
        const posterNick = nickEl ? nickEl.textContent.trim() : '';

        let shouldHide = false;
        let hideReason = '';

        // User check
        if (posterNick && config.blockedUsers.includes(posterNick)) {
            shouldHide = true;
            hideReason = `屏蔽用户: ${posterNick}`;
            stats.userHidden++;
        }

        // Board check
        if (!shouldHide && boardName && (config.blockedBoards.includes(boardName) || config.blockedBoards.includes(subc))) {
            shouldHide = true;
            hideReason = `屏蔽板块: ${boardName}`;
            stats.boardHidden++;
        }

        // Keyword check
        if (!shouldHide && config.blockedKeywords.length > 0) {
            for (let kw of config.blockedKeywords) {
                if (kw && textContent.includes(kw)) {
                    shouldHide = true;
                    hideReason = `屏蔽关键词: ${kw}`;
                    stats.keywordHidden++;
                    break;
                }
            }
        }

        if (shouldHide) {
            card.style.display = 'none';
            card.setAttribute('data-qq-filter-hidden', hideReason);
            stats.hiddenCount++;
            return true;
        } else {
            card.style.display = '';
            card.removeAttribute('data-qq-filter-hidden');
            attachActions(card);
            return false;
        }
    }

    // Apply filter to all visible cards
    function applyFilterAll() {
        if (!storeManager.initialized) {
            storeManager.init();
        }

        if (storeManager.initialized) {
            storeManager.syncFeeds();
        }

        const cards = document.querySelectorAll('.game-guild-main__waterfalls__item');
        cards.forEach(card => filterCard(card));
        updateStatsDisplay();
    }

    // Scan all tabs in the channel to update boardMap
    async function scanChannelBoards() {
        if (isScanningBoards) return;
        isScanningBoards = true;
        updateScanButtonText('正在扫描板块...');

        const tabs = Array.from(document.querySelectorAll('.tab-bar__item'));
        const activeTab = document.querySelector('.tab-bar__item.is-active');

        for (let i = 0; i < tabs.length; i++) {
            const tab = tabs[i];
            const name = tab.textContent.trim();
            if (['全部', '热门', '最新', '最热'].includes(name)) continue;

            tab.click();
            await new Promise(r => setTimeout(r, 65));

            const subcMatch = location.search.match(/subc=([0-9]+)/);
            if (subcMatch) {
                config.boardMap[subcMatch[1]] = name;
            }
        }

        if (activeTab) {
            activeTab.click();
            await new Promise(r => setTimeout(r, 60));
        }

        isScanningBoards = false;
        saveConfig();
        renderUI();
        updateScanButtonText('🔄 重新扫描板块');
        applyFilterAll();
    }

    function updateScanButtonText(txt) {
        const btn = document.getElementById('qq-filter-scan-btn');
        if (btn) btn.textContent = txt;
    }

    // Observer and periodic checker
    function setupObserver() {
        let debounceTimer = null;
        const triggerDebouncedFilter = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                applyFilterAll();
            }, 40);
        };

        const observer = new MutationObserver((mutations) => {
            let shouldCheck = false;
            for (let m of mutations) {
                if (m.addedNodes && m.addedNodes.length > 0) {
                    shouldCheck = true;
                    break;
                }
            }
            if (shouldCheck) triggerDebouncedFilter();
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Regular check every 500ms
        setInterval(() => {
            if (!storeManager.initialized) {
                storeManager.init();
            }
            const cards = document.querySelectorAll('.game-guild-main__waterfalls__item');
            if (cards.length > 0) {
                let needsUpdate = false;
                for (let c of cards) {
                    if (!c.querySelector('.qq-filter-action-btn') && c.style.display !== 'none') {
                        needsUpdate = true;
                        break;
                    }
                }
                if (needsUpdate) applyFilterAll();
            }
        }, 500);

        // Tab switching listener
        document.addEventListener('click', (e) => {
            const tab = e.target.closest('.tab-bar__item');
            if (tab) {
                setTimeout(() => {
                    applyFilterAll();
                }, 80);
            }
        }, true);
    }

    // UI Styles
    function injectStyles() {
        if (document.getElementById('qq-filter-custom-css')) return;
        const css = `
            /* Suppress virtual scroller recycled off-screen items */
            .vue-recycle-scroller__item-view[style*="-9999px"] {
                display: none !important;
            }

            @keyframes qqToastIn {
                from { opacity: 0; transform: translateY(-16px) scale(0.95); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }

            /* Action Buttons */
            .qq-filter-action-btn {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                margin-left: 8px;
                padding: 1px 7px;
                font-size: 11px;
                line-height: 18px;
                border-radius: 10px;
                cursor: pointer;
                user-select: none;
                transition: all 0.15s ease;
                vertical-align: middle;
                font-weight: 500;
            }

            /* Author Block Button */
            .qq-filter-user-btn {
                background: rgba(255, 77, 79, 0.12);
                color: #ff6b6d;
                border: 1px solid rgba(255, 77, 79, 0.3);
            }
            .qq-filter-user-btn:hover {
                background: rgba(255, 77, 79, 0.28);
                border-color: rgba(255, 77, 79, 0.6);
                color: #ff4d4f;
                transform: translateY(-1px);
            }

            /* Board Block Button */
            .qq-filter-board-btn {
                background: rgba(250, 140, 22, 0.12);
                color: #fa8c16;
                border: 1px solid rgba(250, 140, 22, 0.3);
            }
            .qq-filter-board-btn:hover {
                background: rgba(250, 140, 22, 0.28);
                border-color: rgba(250, 140, 22, 0.6);
                color: #d46b08;
                transform: translateY(-1px);
            }

            /* Floating Trigger Button */
            #qq-filter-fab {
                position: fixed;
                right: 24px;
                bottom: 80px;
                z-index: 99999;
                display: flex;
                align-items: center;
                gap: 6px;
                background: #2b7fff;
                color: #ffffff;
                padding: 8px 14px;
                border-radius: 20px;
                box-shadow: 0 4px 16px rgba(43, 127, 255, 0.35);
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                transition: all 0.2s ease;
                border: none;
                outline: none;
            }
            #qq-filter-fab:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(43, 127, 255, 0.5);
                background: #1a6ff0;
            }
            #qq-filter-fab .fab-badge {
                background: #ff4d4f;
                color: #fff;
                font-size: 10px;
                padding: 0 5px;
                border-radius: 10px;
                line-height: 16px;
                height: 16px;
            }

            /* Settings Modal */
            #qq-filter-modal-backdrop {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.45);
                backdrop-filter: blur(2px);
                z-index: 100000;
                justify-content: center;
                align-items: center;
            }
            #qq-filter-modal {
                background: #1f2228;
                color: #e4e7eb;
                width: 520px;
                max-width: 90vw;
                max-height: 85vh;
                border-radius: 14px;
                box-shadow: 0 12px 36px rgba(0,0,0,0.6);
                border: 1px solid rgba(255,255,255,0.1);
                display: flex;
                flex-direction: column;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                overflow: hidden;
                animation: qqFilterFadeIn 0.2s ease;
            }
            @keyframes qqFilterFadeIn {
                from { opacity: 0; transform: scale(0.95); }
                to { opacity: 1; transform: scale(1); }
            }
            .qq-filter-header {
                padding: 16px 20px;
                border-bottom: 1px solid rgba(255,255,255,0.08);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .qq-filter-header h3 {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                color: #fff;
            }
            .qq-filter-close {
                cursor: pointer;
                color: #8c939d;
                font-size: 20px;
                line-height: 1;
                border: none;
                background: transparent;
            }
            .qq-filter-close:hover {
                color: #fff;
            }
            .qq-filter-body {
                padding: 16px 20px;
                overflow-y: auto;
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            .qq-filter-section-title {
                font-size: 13px;
                font-weight: 600;
                color: #9aa1a9;
                margin-bottom: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .qq-filter-toggle-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                background: rgba(255,255,255,0.03);
                padding: 10px 14px;
                border-radius: 8px;
            }
            .qq-filter-toggle-row label {
                font-size: 13px;
                cursor: pointer;
            }
            .qq-filter-chip-container {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                max-height: 150px;
                overflow-y: auto;
                padding: 8px;
                background: rgba(0,0,0,0.25);
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.05);
            }
            .qq-filter-chip {
                padding: 4px 10px;
                border-radius: 14px;
                font-size: 12px;
                cursor: pointer;
                user-select: none;
                border: 1px solid rgba(255,255,255,0.12);
                background: rgba(255,255,255,0.04);
                color: #b0b6be;
                transition: all 0.15s ease;
            }
            .qq-filter-chip:hover {
                border-color: #2b7fff;
                color: #fff;
            }
            .qq-filter-chip.is-blocked {
                background: rgba(255, 77, 79, 0.18);
                color: #ff6b6d;
                border-color: rgba(255, 77, 79, 0.4);
            }
            .qq-filter-input {
                width: 100%;
                background: rgba(0,0,0,0.25);
                border: 1px solid rgba(255,255,255,0.1);
                color: #fff;
                border-radius: 8px;
                padding: 6px 10px;
                font-size: 12px;
                box-sizing: border-box;
            }
            .qq-filter-input:focus {
                border-color: #2b7fff;
                outline: none;
            }
            .qq-filter-textarea {
                width: 100%;
                background: rgba(0,0,0,0.25);
                border: 1px solid rgba(255,255,255,0.1);
                color: #fff;
                border-radius: 8px;
                padding: 8px 10px;
                font-size: 12px;
                box-sizing: border-box;
                resize: vertical;
                min-height: 50px;
            }
            .qq-filter-textarea:focus {
                border-color: #2b7fff;
                outline: none;
            }
            .qq-filter-footer {
                padding: 12px 20px;
                border-top: 1px solid rgba(255,255,255,0.08);
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: rgba(0,0,0,0.15);
            }
            .qq-filter-btn {
                padding: 6px 14px;
                border-radius: 6px;
                font-size: 12px;
                cursor: pointer;
                font-weight: 500;
                border: none;
            }
            .qq-filter-btn-primary {
                background: #2b7fff;
                color: #fff;
            }
            .qq-filter-btn-secondary {
                background: rgba(255,255,255,0.1);
                color: #d1d5db;
            }
            .qq-filter-stats-text {
                font-size: 12px;
                color: #8c939d;
            }
        `;
        const style = document.createElement('style');
        style.id = 'qq-filter-custom-css';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // Setup Floating Button & Modal
    function setupUI() {
        if (document.getElementById('qq-filter-fab')) return;

        const fab = document.createElement('button');
        fab.id = 'qq-filter-fab';
        fab.innerHTML = `🛡️ 频道过滤 <span class="fab-badge" id="qq-filter-badge-count" style="display:none">0</span>`;
        fab.onclick = openModal;
        document.body.appendChild(fab);

        const backdrop = document.createElement('div');
        backdrop.id = 'qq-filter-modal-backdrop';
        backdrop.onclick = (e) => {
            if (e.target === backdrop) closeModal();
        };

        const modal = document.createElement('div');
        modal.id = 'qq-filter-modal';
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        renderUI();
    }

    function openModal() {
        reloadConfig();
        renderUI();
        document.getElementById('qq-filter-modal-backdrop').style.display = 'flex';
    }

    function closeModal() {
        document.getElementById('qq-filter-modal-backdrop').style.display = 'none';
    }

    function renderUI() {
        const modal = document.getElementById('qq-filter-modal');
        if (!modal) return;

        const detectedBoards = new Set(Object.values(config.boardMap));
        document.querySelectorAll('.tab-bar__item').forEach(t => {
            const name = t.textContent.trim();
            if (name && !['全部', '热门', '最新', '最热'].includes(name)) {
                detectedBoards.add(name);
            }
        });

        const sortedBoards = Array.from(detectedBoards).sort();

        modal.innerHTML = `
            <div class="qq-filter-header">
                <h3>🛡️ QQ频道板块、关键词与用户屏蔽器 (v1.5.0)</h3>
                <button class="qq-filter-close" id="qq-filter-close-btn">&times;</button>
            </div>
            <div class="qq-filter-body">
                <!-- Toggles -->
                <div class="qq-filter-toggle-row">
                    <label for="qq-filter-enable-chk">启用屏蔽过滤功能</label>
                    <input type="checkbox" id="qq-filter-enable-chk" ${config.enabled ? 'checked' : ''} />
                </div>
                <div class="qq-filter-toggle-row">
                    <label for="qq-filter-mixed-chk">仅在【全部 / 最新 / 热门】混合流生效</label>
                    <input type="checkbox" id="qq-filter-mixed-chk" ${config.onlyInMixedFeed ? 'checked' : ''} />
                </div>
                <div class="qq-filter-toggle-row">
                    <label for="qq-filter-badge-chk">在帖子卡片显示板块与作者一键屏蔽按钮</label>
                    <input type="checkbox" id="qq-filter-badge-chk" ${config.showBadges ? 'checked' : ''} />
                </div>

                <!-- User Blocklist -->
                <div>
                    <div class="qq-filter-section-title">
                        <span>👤 用户黑名单 (${config.blockedUsers.length} 人)</span>
                    </div>
                    <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                        <input type="text" id="qq-filter-user-input" class="qq-filter-input" placeholder="输入要拉黑的用户昵称并回车..." style="flex: 1;" />
                        <button class="qq-filter-btn qq-filter-btn-secondary" id="qq-filter-add-user-btn" style="white-space: nowrap;">➕ 添加</button>
                    </div>
                    <div class="qq-filter-chip-container" id="qq-filter-user-chips">
                        ${config.blockedUsers.length === 0 ? '<span style="color:#666;font-size:12px;padding:4px;">暂无拉黑用户</span>' : 
                          config.blockedUsers.map(user => `
                            <div class="qq-filter-chip is-blocked" data-user="${user}">
                                🚫 ${user} <span class="chip-del" title="解除拉黑" style="margin-left:4px;cursor:pointer;">&times;</span>
                            </div>
                          `).join('')}
                    </div>
                </div>

                <!-- Board Blocklist -->
                <div>
                    <div class="qq-filter-section-title">
                        <span>📋 板块屏蔽 (点击快速切换屏蔽状态)</span>
                        <button class="qq-filter-btn qq-filter-btn-secondary" id="qq-filter-scan-btn" style="padding: 2px 8px; font-size: 11px;">
                            ${isScanningBoards ? '正在扫描...' : '🔄 自动扫描板块'}
                        </button>
                    </div>
                    <div class="qq-filter-chip-container" id="qq-filter-chips">
                        ${sortedBoards.map(board => {
                            const isBlocked = config.blockedBoards.includes(board);
                            return `<div class="qq-filter-chip ${isBlocked ? 'is-blocked' : ''}" data-board="${board}">
                                ${isBlocked ? '🚫 ' : ''}${board}
                            </div>`;
                        }).join('')}
                    </div>
                </div>

                <!-- Keyword Blocklist -->
                <div>
                    <div class="qq-filter-section-title">
                        <span>🔤 关键词屏蔽 (逗号、空格或换行分隔)</span>
                    </div>
                    <textarea class="qq-filter-textarea" id="qq-filter-keywords-input" placeholder="输入要屏蔽的关键词，如：租房, 拼车, 美甲">${config.blockedKeywords.join(', ')}</textarea>
                </div>
            </div>
            <div class="qq-filter-footer">
                <span class="qq-filter-stats-text" id="qq-filter-stats-info">
                    当前屏蔽: ${stats.hiddenCount} 篇 (板块: ${stats.boardHidden}, 关键词: ${stats.keywordHidden}, 用户: ${stats.userHidden})
                </span>
                <div style="display: flex; gap: 8px;">
                    <button class="qq-filter-btn qq-filter-btn-secondary" id="qq-filter-reset-btn">清空所有屏蔽</button>
                    <button class="qq-filter-btn qq-filter-btn-primary" id="qq-filter-save-btn">保存并生效</button>
                </div>
            </div>
        `;

        document.getElementById('qq-filter-close-btn').onclick = closeModal;

        document.getElementById('qq-filter-enable-chk').onchange = (e) => {
            config.enabled = e.target.checked;
        };
        document.getElementById('qq-filter-mixed-chk').onchange = (e) => {
            config.onlyInMixedFeed = e.target.checked;
        };
        document.getElementById('qq-filter-badge-chk').onchange = (e) => {
            config.showBadges = e.target.checked;
        };

        // Add user handler
        const addUser = () => {
            const input = document.getElementById('qq-filter-user-input');
            const nick = input.value.trim();
            if (nick && !config.blockedUsers.includes(nick)) {
                config.blockedUsers.push(nick);
                input.value = '';
                saveConfig();
                renderUI();
                applyFilterAll();
            }
        };
        document.getElementById('qq-filter-add-user-btn').onclick = addUser;
        document.getElementById('qq-filter-user-input').onkeydown = (e) => {
            if (e.key === 'Enter') addUser();
        };

        // User chip remove handler
        document.querySelectorAll('#qq-filter-user-chips .qq-filter-chip').forEach(chip => {
            chip.onclick = () => {
                const u = chip.getAttribute('data-user');
                config.blockedUsers = config.blockedUsers.filter(x => x !== u);
                saveConfig();
                renderUI();
                applyFilterAll();
            };
        });

        // Board chips handler
        document.querySelectorAll('#qq-filter-chips .qq-filter-chip').forEach(chip => {
            chip.onclick = () => {
                const board = chip.getAttribute('data-board');
                if (config.blockedBoards.includes(board)) {
                    config.blockedBoards.push(board);
                } else {
                    config.blockedBoards.push(board);
                }
                saveConfig();
                renderUI();
                applyFilterAll();
            };
        });

        document.getElementById('qq-filter-scan-btn').onclick = scanChannelBoards;

        document.getElementById('qq-filter-reset-btn').onclick = () => {
            if (confirm('确定清空所有已屏蔽的板块、关键词和用户吗？')) {
                config.blockedBoards = [];
                config.blockedKeywords = [];
                config.blockedUsers = [];
                document.getElementById('qq-filter-keywords-input').value = '';
                saveConfig();
                renderUI();
                applyFilterAll();
            }
        };

        document.getElementById('qq-filter-save-btn').onclick = () => {
            const kwText = document.getElementById('qq-filter-keywords-input').value;
            config.blockedKeywords = kwText
                .split(/[,，\n\s]+/)
                .map(k => k.trim())
                .filter(k => k.length > 0);

            saveConfig();
            closeModal();
            applyFilterAll();
        };
    }

    function updateStatsDisplay() {
        const badge = document.getElementById('qq-filter-badge-count');
        if (badge) {
            if (stats.hiddenCount > 0) {
                badge.style.display = 'inline-block';
                badge.textContent = stats.hiddenCount;
            } else {
                badge.style.display = 'none';
            }
        }
        const statsInfo = document.getElementById('qq-filter-stats-info');
        if (statsInfo) {
            statsInfo.textContent = `当前屏蔽: ${stats.hiddenCount} 篇 (板块: ${stats.boardHidden}, 关键词: ${stats.keywordHidden}, 用户: ${stats.userHidden})`;
        }
    }

    // Expose programmatic API on window.__QQ_FILTER__
    window.__QQ_FILTER__ = {
        config,
        stats,
        storeManager,
        applyFilterAll,
        saveConfig,
        reloadConfig,
        scanChannelBoards,
        openModal,
        closeModal,
        showToast
    };

    // Initialization
    function init() {
        injectStyles();
        setupUI();
        setupObserver();

        // Initialize store manager
        let retryCount = 0;
        const checkStore = () => {
            retryCount++;
            if (!storeManager.initialized) {
                storeManager.init();
            }
            if (!storeManager.initialized && retryCount < 50) {
                setTimeout(checkStore, 100);
            } else {
                applyFilterAll();
            }
        };
        checkStore();

        if (typeof GM_registerMenuCommand !== 'undefined') {
            GM_registerMenuCommand('⚙️ 打开屏蔽设置面板', openModal);
            GM_registerMenuCommand('🔄 自动扫描板块', scanChannelBoards);
        }

        console.log('[QQ-Channel-Filter] v1.5.0 loaded successfully.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();