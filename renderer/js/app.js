/**
 * app.js - 渲染进程主入口
 *
 * 职责：
 * 1. 应用初始化
 * 2. 模块加载与协调
 * 3. 全局事件绑定
 * 4. 状态管理
 *
 * 注意：此文件在阶段1只实现基本骨架
 *       PDF渲染等功能将在后续阶段完善
 */

// 等待DOM加载完成
document.addEventListener('DOMContentLoaded', () => {
  console.log('[App] 初始化开始');

  // ========== 应用状态 ==========
  const state = {
    pdfDoc: null,           // 当前PDF文档对象
    currentPage: 1,         // 当前页码
    totalPages: 0,          // 总页数
    zoom: 1.0,              // 缩放比例
    filePath: null,         // 当前文件路径
    fileName: null,         // 当前文件名
    isDualPage: false,      // 是否双页模式
    sidebarVisible: true    // 侧边栏是否可见
  };

  // PDF查看器实例
  let pdfViewer = null;

  // 侧边栏实例
  let sidebar = null;

  // ========== DOM元素引用 ==========
  const elements = {
    // 工具栏按钮
    btnOpen: document.getElementById('btn-open'),
    btnSidebar: document.getElementById('btn-sidebar'),
    btnPrevPage: document.getElementById('btn-prev-page'),
    btnNextPage: document.getElementById('btn-next-page'),
    btnZoomIn: document.getElementById('btn-zoom-in'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    btnZoomFit: document.getElementById('btn-zoom-fit'),
    btnDualPage: document.getElementById('btn-dual-page'),
    btnTheme: document.getElementById('btn-theme'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    btnWelcomeOpen: document.getElementById('btn-welcome-open'),
    btnClearRecent: document.getElementById('btn-clear-recent'),
    btnErrorClose: document.getElementById('btn-error-close'),

    // 页码显示
    pageInput: document.getElementById('page-input'),
    pageTotal: document.getElementById('page-total'),
    zoomLevel: document.getElementById('zoom-level'),

    // 侧边栏
    sidebar: document.getElementById('sidebar'),
    tabThumbnails: document.querySelector('[data-tab="thumbnails"]'),
    tabFiles: document.querySelector('[data-tab="files"]'),
    thumbnailsPanel: document.getElementById('thumbnails-panel'),
    filesPanel: document.getElementById('files-panel'),
    recentFilesList: document.getElementById('recent-files-list'),

    // PDF显示区域
    pdfContainer: document.getElementById('pdf-container'),
    welcomeScreen: document.getElementById('welcome-screen'),
    pdfViewer: document.getElementById('pdf-viewer'),
    pdfCanvas: document.getElementById('pdf-canvas'),
    pdfCanvasRight: document.getElementById('pdf-canvas-right'),
    loadingOverlay: document.getElementById('loading-overlay'),
    errorMessage: document.getElementById('error-message'),
    errorText: document.getElementById('error-text'),

    // 状态栏
    statusBar: document.getElementById('status-bar'),
    statusText: document.getElementById('status-text'),
    fileInfo: document.getElementById('file-info')
  };

  // ========== 初始化 ==========

  /**
   * 初始化应用
   */
  async function init() {
    // 初始化PDF查看器（传入双页模式的右侧canvas）
    pdfViewer = new PDFViewer(elements.pdfCanvas, elements.pdfCanvasRight);

    // 初始化侧边栏
    sidebar = new Sidebar(elements, pdfViewer, async (pageNum) => {
      await goToPage(pageNum);
    });

    // 加载保存的设置
    await loadSettings();

    // 绑定事件监听器
    bindEvents();

    // 加载最近文件列表
    await loadRecentFiles();

    // 监听PDF加载事件（来自主进程）
    window.api.onPdfLoad(async (data) => {
      await handlePdfLoad(data.path);
    });

    console.log('[App] 初始化完成');
    updateStatus('就绪');
  }

  /**
   * 加载应用设置
   */
  async function loadSettings() {
    try {
      const settings = await window.api.getSettings();
      if (settings) {
        state.isDualPage = settings.dualPage || false;
        state.zoom = settings.zoom || 1.0;
        state.sidebarVisible = settings.sidebarVisible !== false;

        // 应用主题
        if (settings.theme === 'dark') {
          document.documentElement.setAttribute('data-theme', 'dark');
        }

        // 应用侧边栏状态
        if (!state.sidebarVisible) {
          elements.sidebar.classList.add('hidden-sidebar');
        }

        // 更新双页模式按钮状态
        elements.btnDualPage.classList.toggle('active', state.isDualPage);
      }
    } catch (error) {
      console.error('[App] 加载设置失败:', error);
    }
  }

  /**
   * 加载最近文件列表
   */
  async function loadRecentFiles() {
    try {
      const files = await window.api.getRecentFiles();
      sidebar.renderRecentFiles(files, async (filePath) => {
        await handlePdfLoad(filePath);
      });
    } catch (error) {
      console.error('[App] 加载最近文件失败:', error);
    }
  }

  /**
   * 处理PDF文件加载
   * @param {string} filePath - 文件路径
   */
  async function handlePdfLoad(filePath) {
    console.log('[App] 开始加载PDF:', filePath);

    try {
      // 显示加载指示器
      elements.loadingOverlay.classList.remove('hidden');
      updateStatus('正在加载...');

      // 提取文件名
      const fileName = filePath.split(/[\\/]/).pop();

      // 加载PDF
      const result = await pdfViewer.loadPdf(filePath);

      // 更新状态
      state.filePath = filePath;
      state.fileName = fileName;
      state.totalPages = result.totalPages;

      // 恢复阅读进度
      const progress = await window.api.getAllProgress();
      const lastPage = progress[filePath];
      if (lastPage && lastPage > 1 && lastPage <= state.totalPages) {
        state.currentPage = lastPage;
        await pdfViewer.goToPage(lastPage);
        updateStatus(`已恢复到第 ${lastPage} 页`);
      } else {
        state.currentPage = result.currentPage;
      }

      // 隐藏欢迎页面，显示PDF查看器
      elements.welcomeScreen.classList.add('hidden');
      elements.pdfViewer.classList.remove('hidden');

      // 启用工具栏按钮
      setToolbarEnabled(true);

      // 更新显示
      updatePageDisplay();
      updateWindowTitle();
      updateFileInfo();

      // 生成缩略图
      await sidebar.generateThumbnails(state.totalPages, state.currentPage);

      // 添加到最近文件列表
      window.api.addRecentFile({
        path: filePath,
        name: fileName,
        lastPage: state.currentPage,
        totalPages: state.totalPages
      });

      // 刷新最近文件列表
      await loadRecentFiles();

      if (!lastPage || lastPage <= 1) {
        updateStatus('就绪');
      }
      console.log('[App] PDF加载成功:', fileName);

    } catch (error) {
      console.error('[App] PDF加载失败:', error);

      // 根据错误类型显示不同的提示
      let errorMsg = '无法打开PDF文件';
      if (error.name === 'PasswordException') {
        errorMsg = '此PDF文件已加密，暂不支持带密码的PDF';
      } else if (error.name === 'InvalidPDFException') {
        errorMsg = '文件已损坏或不是有效的PDF文件';
      } else if (error.message.includes('ENOENT')) {
        errorMsg = '文件不存在或已被移动';
        // 从最近列表中移除
        await removeFileFromRecent(filePath);
      } else {
        errorMsg += ': ' + error.message;
      }

      showError(errorMsg);
      updateStatus('加载失败');
    } finally {
      // 隐藏加载指示器
      elements.loadingOverlay.classList.add('hidden');
    }
  }

  /**
   * 设置工具栏按钮启用/禁用状态
   * @param {boolean} enabled - 是否启用
   */
  function setToolbarEnabled(enabled) {
    elements.btnPrevPage.disabled = !enabled;
    elements.btnNextPage.disabled = !enabled;
    elements.pageInput.disabled = !enabled;
    elements.btnZoomIn.disabled = !enabled;
    elements.btnZoomOut.disabled = !enabled;
    elements.btnZoomFit.disabled = !enabled;
    elements.btnDualPage.disabled = !enabled;
  }

  /**
   * 绑定所有事件监听器
   */
  function bindEvents() {
    // 打开文件
    elements.btnOpen.addEventListener('click', () => {
      window.api.openFile();
    });

    elements.btnWelcomeOpen.addEventListener('click', () => {
      window.api.openFile();
    });

    // 侧边栏切换
    elements.btnSidebar.addEventListener('click', toggleSidebar);

    // 侧边栏标签页
    elements.tabThumbnails.addEventListener('click', () => switchTab('thumbnails'));
    elements.tabFiles.addEventListener('click', () => switchTab('files'));

    // 页码输入
    elements.pageInput.addEventListener('change', async (e) => {
      const page = parseInt(e.target.value);
      if (page >= 1 && page <= state.totalPages) {
        await goToPage(page);
      } else {
        e.target.value = state.currentPage;
      }
    });

    // 翻页按钮
    elements.btnPrevPage.addEventListener('click', () => goToPrevPage());
    elements.btnNextPage.addEventListener('click', () => goToNextPage());

    // 缩放按钮
    elements.btnZoomIn.addEventListener('click', () => zoomIn());
    elements.btnZoomOut.addEventListener('click', () => zoomOut());
    elements.btnZoomFit.addEventListener('click', () => zoomFit());

    // 双页模式
    elements.btnDualPage.addEventListener('click', toggleDualPage);

    // 夜间模式
    elements.btnTheme.addEventListener('click', toggleTheme);

    // 全屏
    elements.btnFullscreen.addEventListener('click', toggleFullscreen);

    // 清空最近文件
    elements.btnClearRecent.addEventListener('click', async () => {
      if (confirm('确定清空最近打开的文件列表吗？')) {
        await window.api.clearRecentFiles();
        await loadRecentFiles();
      }
    });

    // 错误提示关闭
    elements.btnErrorClose.addEventListener('click', () => {
      elements.errorMessage.classList.add('hidden');
    });

    // 拖拽文件支持
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.name.toLowerCase().endsWith('.pdf')) {
          await handlePdfLoad(file.path);
        } else {
          showError('仅支持 PDF 文件');
        }
      }
    });

    // PDF区域滚轮滚动支持
    elements.pdfContainer.addEventListener('wheel', (e) => {
      // 如果按住Ctrl键，进行缩放
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          zoomIn();
        } else {
          zoomOut();
        }
      }
      // 否则正常滚动（浏览器默认行为）
    }, { passive: false });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      handleKeyboard(e);
    });
  }

  /**
   * 切换侧边栏显示/隐藏
   */
  function toggleSidebar() {
    state.sidebarVisible = !state.sidebarVisible;
    elements.sidebar.classList.toggle('hidden-sidebar', !state.sidebarVisible);

    // 保存设置
    saveSettings();
  }

  /**
   * 切换侧边栏标签页
   * @param {string} tab - 标签页名称 ('thumbnails' 或 'files')
   */
  function switchTab(tab) {
    // 更新按钮状态
    elements.tabThumbnails.classList.toggle('active', tab === 'thumbnails');
    elements.tabFiles.classList.toggle('active', tab === 'files');

    // 更新面板显示
    elements.thumbnailsPanel.classList.toggle('active', tab === 'thumbnails');
    elements.filesPanel.classList.toggle('active', tab === 'files');
  }

  /**
   * 切换双页模式
   */
  async function toggleDualPage() {
    state.isDualPage = !state.isDualPage;
    elements.btnDualPage.classList.toggle('active', state.isDualPage);
    elements.pdfContainer.classList.toggle('dual-page', state.isDualPage);
    elements.pdfViewer.classList.toggle('dual-mode', state.isDualPage);

    // 更新PDF查看器的双页模式
    pdfViewer.setDualPageMode(state.isDualPage);

    // 重新渲染当前页
    if (state.totalPages > 0) {
      try {
        await pdfViewer.renderPage(state.currentPage);
      } catch (error) {
        console.error('[App] 双页模式切换失败:', error);
      }
    }

    // 保存设置
    saveSettings();

    updateStatus(state.isDualPage ? '已开启双页模式' : '已关闭双页模式');
  }

  /**
   * 切换日间/夜间模式
   */
  function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';

    if (isDark) {
      html.setAttribute('data-theme', 'light');
    } else {
      html.setAttribute('data-theme', 'dark');
    }

    // 保存设置
    saveSettings();

    updateStatus(isDark ? '已切换到日间模式' : '已切换到夜间模式');
  }

  /**
   * 切换全屏
   */
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  /**
   * 键盘快捷键处理
   * @param {KeyboardEvent} e - 键盘事件
   */
  function handleKeyboard(e) {
    // ← 左箭头：上一页
    if (e.key === 'ArrowLeft' && !e.ctrlKey && state.totalPages > 0) {
      e.preventDefault();
      goToPrevPage();
    }

    // → 右箭头：下一页
    if (e.key === 'ArrowRight' && !e.ctrlKey && state.totalPages > 0) {
      e.preventDefault();
      goToNextPage();
    }

    // Ctrl+= 或 Ctrl++：放大
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      zoomIn();
    }

    // Ctrl+-：缩小
    if (e.ctrlKey && e.key === '-') {
      e.preventDefault();
      zoomOut();
    }

    // Ctrl+0：重置缩放
    if (e.ctrlKey && e.key === '0') {
      e.preventDefault();
      resetZoom();
    }

    // F11：全屏
    if (e.key === 'F11') {
      e.preventDefault();
      toggleFullscreen();
    }

    // Ctrl+O：打开文件
    if (e.ctrlKey && e.key === 'o') {
      e.preventDefault();
      window.api.openFile();
    }

    // Esc：退出全屏
    if (e.key === 'Escape' && document.fullscreenElement) {
      document.exitFullscreen();
    }
  }

  /**
   * 翻到上一页
   */
  async function goToPrevPage() {
    if (!pdfViewer || state.totalPages === 0) return;

    try {
      const page = await pdfViewer.prevPage();
      state.currentPage = page;
      updatePageDisplay();
      updateWindowTitle();
      sidebar.highlightThumbnail(page);
      saveProgress();
    } catch (error) {
      console.error('[App] 翻页失败:', error);
    }
  }

  /**
   * 翻到下一页
   */
  async function goToNextPage() {
    if (!pdfViewer || state.totalPages === 0) return;

    try {
      const page = await pdfViewer.nextPage();
      state.currentPage = page;
      updatePageDisplay();
      updateWindowTitle();
      sidebar.highlightThumbnail(page);
      saveProgress();
    } catch (error) {
      console.error('[App] 翻页失败:', error);
    }
  }

  /**
   * 跳转到指定页
   * @param {number} page - 目标页码
   */
  async function goToPage(page) {
    if (!pdfViewer || state.totalPages === 0) return;

    try {
      const currentPage = await pdfViewer.goToPage(page);
      state.currentPage = currentPage;
      updatePageDisplay();
      updateWindowTitle();
      sidebar.highlightThumbnail(currentPage);
      saveProgress();
      updateStatus(`第 ${currentPage} 页`);
    } catch (error) {
      console.error('[App] 跳转失败:', error);
    }
  }

  /**
   * 放大
   */
  async function zoomIn() {
    if (!pdfViewer) return;

    try {
      await pdfViewer.zoomIn(0.1);
      state.zoom = pdfViewer.zoom;
      updatePageDisplay();
    } catch (error) {
      console.error('[App] 放大失败:', error);
    }
  }

  /**
   * 缩小
   */
  async function zoomOut() {
    if (!pdfViewer) return;

    try {
      await pdfViewer.zoomOut(0.1);
      state.zoom = pdfViewer.zoom;
      updatePageDisplay();
    } catch (error) {
      console.error('[App] 缩小失败:', error);
    }
  }

  /**
   * 重置缩放
   */
  async function resetZoom() {
    if (!pdfViewer) return;

    try {
      await pdfViewer.setZoom(1.0);
      state.zoom = pdfViewer.zoom;
      updatePageDisplay();
      updateStatus('缩放已重置为100%');
    } catch (error) {
      console.error('[App] 重置缩放失败:', error);
    }
  }

  /**
   * 适应页面宽度
   */
  async function zoomFit() {
    if (!pdfViewer) return;

    try {
      const containerWidth = elements.pdfContainer.clientWidth - 40;
      await pdfViewer.fitToWidth(containerWidth);
      state.zoom = pdfViewer.zoom;
      updatePageDisplay();
      updateStatus('已适应页面宽度');
    } catch (error) {
      console.error('[App] 适应页面失败:', error);
    }
  }

  /**
   * 保存应用设置
   */
  async function saveSettings() {
    const settings = {
      theme: document.documentElement.getAttribute('data-theme'),
      zoom: state.zoom,
      dualPage: state.isDualPage,
      sidebarVisible: state.sidebarVisible
    };

    await window.api.saveSettings(settings);
  }

  /**
   * 显示错误提示
   * @param {string} message - 错误信息
   */
  function showError(message) {
    elements.errorText.textContent = message;
    elements.errorMessage.classList.remove('hidden');
  }

  /**
   * 更新状态栏文本
   * @param {string} text - 状态文本
   */
  function updateStatus(text) {
    elements.statusText.textContent = text;
  }

  /**
   * 更新页码显示
   */
  function updatePageDisplay() {
    elements.pageInput.value = state.currentPage;
    elements.pageTotal.textContent = state.totalPages;
    elements.zoomLevel.textContent = Math.round(state.zoom * 100) + '%';

    // 更新翻页按钮状态
    elements.btnPrevPage.disabled = state.currentPage <= 1;
    elements.btnNextPage.disabled = state.currentPage >= state.totalPages;
  }

  /**
   * 更新窗口标题
   */
  function updateWindowTitle() {
    if (state.fileName) {
      document.title = `${state.fileName} - ${state.currentPage}/${state.totalPages}`;
    } else {
      document.title = 'PDF 阅读器';
    }
  }

  /**
   * 更新文件信息显示
   */
  function updateFileInfo() {
    if (state.fileName) {
      elements.fileInfo.textContent = `${state.fileName} (${state.totalPages} 页)`;
    } else {
      elements.fileInfo.textContent = '';
    }
  }

  /**
   * 保存阅读进度
   */
  function saveProgress() {
    if (state.filePath && state.totalPages > 0) {
      window.api.saveProgress({
        path: state.filePath,
        lastPage: state.currentPage
      });
    }
  }

  /**
   * 从最近列表中移除文件
   * @param {string} filePath - 文件路径
   */
  async function removeFileFromRecent(filePath) {
    try {
      const files = await window.api.getRecentFiles();
      const filtered = files.filter(f => f.path !== filePath);
      // 重新保存列表
      await window.api.clearRecentFiles();
      for (const file of filtered) {
        window.api.addRecentFile(file);
      }
      await loadRecentFiles();
    } catch (error) {
      console.error('[App] 移除文件失败:', error);
    }
  }

  // 启动应用
  init();
});