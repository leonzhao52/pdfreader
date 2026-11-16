/**
 * sidebar.js - 侧边栏模块
 *
 * 职责：
 * 1. 管理缩略图导航面板
 * 2. 生成和渲染页面缩略图
 * 3. 实现缩略图懒加载（性能优化）
 * 4. 处理缩略图点击跳转
 * 5. 管理文件列表面板
 *
 * 性能优化：
 * - 缩略图懒加载（进入视口才渲染）
 * - 使用小尺寸canvas渲染缩略图
 * - 缓存已渲染的缩略图
 */

class Sidebar {
  /**
   * 构造函数
   * @param {Object} elements - DOM元素引用
   * @param {PDFViewer} pdfViewer - PDF查看器实例
   * @param {Function} onPageChange - 页面变化回调
   */
  constructor(elements, pdfViewer, onPageChange) {
    this.elements = elements;
    this.pdfViewer = pdfViewer;
    this.onPageChange = onPageChange;

    // 缩略图相关
    this.thumbnails = [];        // 缩略图元素数组
    this.thumbnailWidth = 120;   // 缩略图宽度（像素）
    this.renderedPages = new Set();  // 已渲染的页码集合
    this.observer = null;        // Intersection Observer

    this._init();
  }

  /**
   * 初始化
   * @private
   */
  _init() {
    // 初始化懒加载观察器
    this._initObserver();

    // 绑定缩略图面板滚动事件
    if (this.elements.thumbnailsPanel) {
      this.elements.thumbnailsPanel.addEventListener('scroll', () => {
        this._onThumbnailScroll();
      });
    }
  }

  /**
   * 初始化Intersection Observer（懒加载）
   * @private
   */
  _initObserver() {
    const options = {
      root: this.elements.thumbnailsPanel,
      rootMargin: '100px',  // 提前100px开始加载
      threshold: 0.01
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.dataset.page);
          this._renderThumbnail(pageNum, entry.target);
        }
      });
    }, options);
  }

  /**
   * 生成所有页面缩略图
   * @param {number} totalPages - 总页数
   * @param {number} currentPage - 当前页码
   */
  async generateThumbnails(totalPages, currentPage) {
    if (!this.pdfViewer || !this.pdfViewer.pdfDoc) {
      console.error('[Sidebar] PDF文档未加载');
      return;
    }

    // 清空现有缩略图
    this._clearThumbnails();

    // 重置渲染记录
    this.renderedPages.clear();

    // 创建缩略图容器
    const container = document.createElement('div');
    container.className = 'thumbnails-container';

    // 为每一页创建缩略图元素
    for (let i = 1; i <= totalPages; i++) {
      const thumbnailItem = this._createThumbnailItem(i);
      container.appendChild(thumbnailItem);

      // 添加到观察器（懒加载）
      this.observer.observe(thumbnailItem);
    }

    // 添加到面板
    this.elements.thumbnailsPanel.innerHTML = '';
    this.elements.thumbnailsPanel.appendChild(container);

    // 高亮当前页
    this.highlightThumbnail(currentPage);

    console.log(`[Sidebar] 已生成 ${totalPages} 个缩略图占位符`);
  }

  /**
   * 创建缩略图元素
   * @param {number} pageNum - 页码
   * @returns {HTMLElement} 缩略图元素
   * @private
   */
  _createThumbnailItem(pageNum) {
    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    item.dataset.page = pageNum;

    // 页码标签
    const pageLabel = document.createElement('div');
    pageLabel.className = 'thumbnail-label';
    pageLabel.textContent = pageNum;

    // 缩略图画布容器
    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'thumbnail-canvas-container';
    canvasContainer.appendChild(pageLabel);

    item.appendChild(canvasContainer);

    // 点击事件
    item.addEventListener('click', () => {
      this.onPageChange(pageNum);
    });

    return item;
  }

  /**
   * 渲染单个缩略图
   * @param {number} pageNum - 页码
   * @param {HTMLElement} element - 缩略图元素
   * @private
   */
  async _renderThumbnail(pageNum, element) {
    // 避免重复渲染
    if (this.renderedPages.has(pageNum)) {
      return;
    }

    try {
      this.renderedPages.add(pageNum);

      // 获取页面
      const page = await this.pdfViewer.pdfDoc.getPage(pageNum);

      // 计算缩略图尺寸
      const baseViewport = page.getViewport({ scale: 1.0 });
      const scale = this.thumbnailWidth / baseViewport.width;
      const viewport = page.getViewport({ scale: scale });

      // 创建canvas
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = 'thumbnail-canvas';

      // 渲染
      const context = canvas.getContext('2d');
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;

      // 替换占位符
      const container = element.querySelector('.thumbnail-canvas-container');
      container.insertBefore(canvas, container.firstChild);

      // 停止观察此元素
      this.observer.unobserve(element);

    } catch (error) {
      console.error(`[Sidebar] 渲染缩略图 ${pageNum} 失败:`, error);
      this.renderedPages.delete(pageNum);
    }
  }

  /**
   * 高亮当前页缩略图
   * @param {number} pageNum - 当前页码
   */
  highlightThumbnail(pageNum) {
    // 移除之前的高亮
    this.thumbnails.forEach(item => {
      item.classList.remove('active');
    });

    // 高亮当前页
    const currentItem = this.elements.thumbnailsPanel.querySelector(
      `.thumbnail-item[data-page="${pageNum}"]`
    );

    if (currentItem) {
      currentItem.classList.add('active');

      // 滚动到可见区域
      currentItem.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }

  /**
   * 缩略图滚动事件（预加载附近页面）
   * @private
   */
  _onThumbnailScroll() {
    // 这个方法可以用于额外的预加载逻辑
    // 目前Intersection Observer已经处理了懒加载
  }

  /**
   * 清空所有缩略图
   * @private
   */
  _clearThumbnails() {
    if (this.elements.thumbnailsPanel) {
      this.elements.thumbnailsPanel.innerHTML = '';
    }
    this.thumbnails = [];
    this.renderedPages.clear();
  }

  /**
   * 销毁侧边栏
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this._clearThumbnails();
  }

  /**
   * 渲染最近文件列表
   * @param {Array} files - 文件列表
   * @param {Function} onFileClick - 文件点击回调
   */
  renderRecentFiles(files, onFileClick) {
    if (!this.elements.recentFilesList) return;

    if (!files || files.length === 0) {
      this.elements.recentFilesList.innerHTML =
        '<li class="empty-state">暂无文件</li>';
      return;
    }

    // 清空列表
    this.elements.recentFilesList.innerHTML = '';

    // 添加文件项
    files.forEach(file => {
      const li = document.createElement('li');
      li.dataset.path = file.path;

      // 文件名
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = file.name;
      name.title = file.name;

      // 文件信息
      const meta = document.createElement('span');
      meta.className = 'file-meta';
      const date = new Date(file.lastOpened).toLocaleDateString();
      meta.textContent = `第 ${file.lastPage} 页 · ${date}`;

      li.appendChild(name);
      li.appendChild(meta);

      // 点击事件
      li.addEventListener('click', () => {
        onFileClick(file.path);
      });

      this.elements.recentFilesList.appendChild(li);
    });
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Sidebar;
}