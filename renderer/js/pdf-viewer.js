/**
 * pdf-viewer.js - PDF查看器模块
 *
 * 职责：
 * 1. 封装PDF.js API，提供简洁的接口
 * 2. 处理PDF文件的加载和渲染
 * 3. 管理页码导航（上一页/下一页/跳转）
 * 4. 处理缩放功能
 * 5. 高DPI屏幕适配
 *
 * 主要功能：
 * - loadPdf(filePath): 加载PDF文件
 * - renderPage(pageNum): 渲染指定页面
 * - nextPage() / prevPage(): 翻页
 * - zoomIn() / zoomOut(): 缩放
 * - goToPage(pageNum): 跳转到指定页
 */

class PDFViewer {
  /**
   * 构造函数
   * @param {HTMLCanvasElement} canvas - 用于渲染PDF的canvas元素
   * @param {HTMLCanvasElement} canvasRight - 双页模式右侧canvas（可选）
   */
  constructor(canvas, canvasRight = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.canvasRight = canvasRight;
    this.ctxRight = canvasRight ? canvasRight.getContext('2d') : null;
    this.pdfDoc = null;          // PDF文档对象
    this.currentPage = 1;        // 当前页码
    this.totalPages = 0;         // 总页数
    this.zoom = 1.0;             // 缩放比例（1.0 = 100%）
    this.minZoom = 0.5;          // 最小缩放（50%）
    this.maxZoom = 4.0;          // 最大缩放（400%）
    this.renderTask = null;      // 当前渲染任务（用于取消）
    this.filePath = null;        // 当前文件路径
    this.dualPageMode = false;   // 是否双页模式
  }

  /**
   * 设置双页模式
   * @param {boolean} enabled - 是否启用双页模式
   */
  setDualPageMode(enabled) {
    this.dualPageMode = enabled;
    if (this.canvasRight) {
      this.canvasRight.style.display = enabled ? 'block' : 'none';
      if (enabled) {
        this.canvasRight.classList.remove('hidden');
      } else {
        this.canvasRight.classList.add('hidden');
      }
    }
  }

  /**
   * 加载PDF文件
   * @param {string} filePath - PDF文件绝对路径
   * @returns {Promise<void>}
   */
  async loadPdf(filePath) {
    try {
      // 取消之前的渲染任务
      if (this.renderTask) {
        this.renderTask.cancel();
        this.renderTask = null;
      }

      // 关闭之前的文档
      if (this.pdfDoc) {
        await this.pdfDoc.destroy();
        this.pdfDoc = null;
      }

      this.filePath = filePath;

      // 在Electron中，需要将文件路径转换为file://协议URL
      const fileUrl = this._pathToFileUrl(filePath);

      // 加载PDF文档
      const loadingTask = pdfjsLib.getDocument({
        url: fileUrl,
        cMapUrl: '../lib/pdfjs/cmaps/',
        cMapPacked: true
      });

      // 监听加载进度
      loadingTask.onProgress = (progress) => {
        if (progress.total > 0) {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          console.log(`[PDFViewer] 加载进度: ${percent}%`);
        }
      };

      this.pdfDoc = await loadingTask.promise;
      this.totalPages = this.pdfDoc.numPages;
      this.currentPage = 1;
      this.zoom = 1.0;

      // 渲染第一页
      await this.renderPage(this.currentPage);

      return {
        totalPages: this.totalPages,
        currentPage: this.currentPage
      };
    } catch (error) {
      console.error('[PDFViewer] 加载PDF失败:', error);
      throw error;
    }
  }

  /**
   * 渲染指定页面
   * @param {number} pageNum - 页码（从1开始）
   * @returns {Promise<void>}
   */
  async renderPage(pageNum) {
    if (!this.pdfDoc) {
      throw new Error('PDF文档未加载');
    }

    // 验证页码
    if (pageNum < 1 || pageNum > this.totalPages) {
      throw new Error(`页码超出范围: ${pageNum}`);
    }

    // 取消之前的渲染任务
    if (this.renderTask) {
      try {
        this.renderTask.cancel();
      } catch (e) {
        // 忽略取消错误
      }
      this.renderTask = null;
    }

    try {
      // 如果是双页模式，使用双页渲染
      if (this.dualPageMode) {
        await this._renderDualPage(pageNum);
        return;
      }

      // 单页模式渲染
      const page = await this.pdfDoc.getPage(pageNum);
      this.currentPage = pageNum;

      // 计算视口（考虑缩放和高DPI）
      const devicePixelRatio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({
        scale: this.zoom * devicePixelRatio
      });

      // 设置canvas尺寸（考虑高DPI）
      this.canvas.width = viewport.width;
      this.canvas.height = viewport.height;

      // CSS尺寸（实际显示大小）
      this.canvas.style.width = (viewport.width / devicePixelRatio) + 'px';
      this.canvas.style.height = (viewport.height / devicePixelRatio) + 'px';

      // 渲染参数
      const renderContext = {
        canvasContext: this.ctx,
        viewport: viewport
      };

      // 开始渲染
      this.renderTask = page.render(renderContext);
      await this.renderTask.promise;
      this.renderTask = null;

    } catch (error) {
      // 如果是取消操作，忽略错误
      if (error.name === 'RenderingCancelledException') {
        return;
      }
      console.error('[PDFViewer] 渲染页面失败:', error);
      throw error;
    }
  }

  /**
   * 渲染双页（当前页和下一页）
   * @param {number} pageNum - 左侧页码
   * @private
   */
  async _renderDualPage(pageNum) {
    const devicePixelRatio = window.devicePixelRatio || 1;

    // 渲染左侧页面
    const leftPage = await this.pdfDoc.getPage(pageNum);
    const leftViewport = leftPage.getViewport({
      scale: this.zoom * devicePixelRatio
    });

    this.canvas.width = leftViewport.width;
    this.canvas.height = leftViewport.height;
    this.canvas.style.width = (leftViewport.width / devicePixelRatio) + 'px';
    this.canvas.style.height = (leftViewport.height / devicePixelRatio) + 'px';

    await leftPage.render({
      canvasContext: this.ctx,
      viewport: leftViewport
    }).promise;

    // 渲染右侧页面（下一页）
    const rightPageNum = pageNum + 1;
    if (rightPageNum <= this.totalPages) {
      const rightPage = await this.pdfDoc.getPage(rightPageNum);
      const rightViewport = rightPage.getViewport({
        scale: this.zoom * devicePixelRatio
      });

      this.canvasRight.width = rightViewport.width;
      this.canvasRight.height = rightViewport.height;
      this.canvasRight.style.width = (rightViewport.width / devicePixelRatio) + 'px';
      this.canvasRight.style.height = (rightViewport.height / devicePixelRatio) + 'px';

      await rightPage.render({
        canvasContext: this.ctxRight,
        viewport: rightViewport
      }).promise;

      this.canvasRight.style.display = 'block';
    } else {
      // 没有下一页，隐藏右侧canvas
      this.canvasRight.style.display = 'none';
    }

    this.currentPage = pageNum;
  }

  /**
   * 下一页
   * @returns {Promise<number>} 新的页码
   */
  async nextPage() {
    if (this.currentPage < this.totalPages) {
      await this.renderPage(this.currentPage + 1);
    }
    return this.currentPage;
  }

  /**
   * 上一页
   * @returns {Promise<number>} 新的页码
   */
  async prevPage() {
    if (this.currentPage > 1) {
      await this.renderPage(this.currentPage - 1);
    }
    return this.currentPage;
  }

  /**
   * 跳转到指定页
   * @param {number} pageNum - 目标页码
   * @returns {Promise<number>} 实际跳转的页码
   */
  async goToPage(pageNum) {
    const target = Math.max(1, Math.min(pageNum, this.totalPages));
    await this.renderPage(target);
    return this.currentPage;
  }

  /**
   * 放大
   * @param {number} step - 缩放步长（默认0.1）
   * @returns {Promise<void>}
   */
  async zoomIn(step = 0.1) {
    const newZoom = Math.min(this.zoom + step, this.maxZoom);
    if (newZoom !== this.zoom) {
      this.zoom = newZoom;
      await this.renderPage(this.currentPage);
    }
  }

  /**
   * 缩小
   * @param {number} step - 缩放步长（默认0.1）
   * @returns {Promise<void>}
   */
  async zoomOut(step = 0.1) {
    const newZoom = Math.max(this.zoom - step, this.minZoom);
    if (newZoom !== this.zoom) {
      this.zoom = newZoom;
      await this.renderPage(this.currentPage);
    }
  }

  /**
   * 设置缩放比例
   * @param {number} scale - 缩放比例
   * @returns {Promise<void>}
   */
  async setZoom(scale) {
    const newZoom = Math.max(this.minZoom, Math.min(scale, this.maxZoom));
    if (newZoom !== this.zoom) {
      this.zoom = newZoom;
      await this.renderPage(this.currentPage);
    }
  }

  /**
   * 适应页面宽度
   * @param {number} containerWidth - 容器宽度（像素）
   * @returns {Promise<void>}
   */
  async fitToWidth(containerWidth) {
    if (!this.pdfDoc) return;

    const page = await this.pdfDoc.getPage(this.currentPage);
    const baseViewport = page.getViewport({ scale: 1.0 });
    const scale = containerWidth / baseViewport.width;

    await this.setZoom(scale);
  }

  /**
   * 获取当前状态
   * @returns {Object} 状态对象
   */
  getState() {
    return {
      currentPage: this.currentPage,
      totalPages: this.totalPages,
      zoom: this.zoom,
      filePath: this.filePath
    };
  }

  /**
   * 关闭当前PDF文档
   */
  async close() {
    if (this.renderTask) {
      try {
        this.renderTask.cancel();
      } catch (e) {
        // 忽略取消错误
      }
      this.renderTask = null;
    }

    if (this.pdfDoc) {
      await this.pdfDoc.destroy();
      this.pdfDoc = null;
    }

    this.currentPage = 1;
    this.totalPages = 0;
    this.zoom = 1.0;
    this.filePath = null;

    // 清空canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * 将文件路径转换为file://协议URL
   * @param {string} filePath - 文件路径
   * @returns {string} file:// URL
   * @private
   */
  _pathToFileUrl(filePath) {
    // 统一转换为正斜杠
    const normalizedPath = filePath.replace(/\\/g, '/');

    // 检测是否为Windows路径（包含盘符）
    if (/^[A-Za-z]:/.test(normalizedPath)) {
      return 'file:///' + normalizedPath;
    }

    // Unix/Linux/Mac路径
    return 'file://' + normalizedPath;
  }
}

// 导出模块（用于其他JS文件引用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PDFViewer;
}