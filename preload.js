/**
 * preload.js - Electron 预加载脚本
 *
 * 职责：
 * 1. 在渲染进程加载之前执行
 * 2. 通过 contextBridge 安全暴露API给渲染进程
 * 3. 作为主进程和渲染进程之间的通信桥梁
 *
 * 安全原则：
 * - 只暴露必要的API方法（白名单）
 * - 不暴露Node.js原生模块
 * - 使用IPC进行跨进程通信
 */

const { contextBridge, ipcRenderer } = require('electron');

// 通过 contextBridge 暴露API给渲染进程
// 渲染进程通过 window.api.* 访问这些方法
contextBridge.exposeInMainWorld('api', {

  /**
   * 打开文件对话框
   * 触发主进程显示文件选择对话框
   */
  openFile: () => {
    ipcRenderer.invoke('dialog:openFile');
  },

  /**
   * 监听PDF加载事件
   * 当用户选择文件后，主进程通过此事件发送文件路径
   * @param {Function} callback - 回调函数，接收 {path} 参数
   */
  onPdfLoad: (callback) => {
    ipcRenderer.on('pdf:load', (event, data) => {
      callback(data);
    });
  },

  /**
   * 添加文件到最近打开列表
   * @param {Object} fileInfo - 文件信息
   * @param {string} fileInfo.path - 文件绝对路径
   * @param {string} fileInfo.name - 文件名
   * @param {number} fileInfo.lastPage - 最后阅读页码
   * @param {number} fileInfo.totalPages - 总页数
   */
  addRecentFile: (fileInfo) => {
    ipcRenderer.send('recent:add', fileInfo);
  },

  /**
   * 获取最近打开的文件列表
   * @returns {Promise<Array>} 文件列表数组
   */
  getRecentFiles: () => {
    return ipcRenderer.invoke('recent:getAll');
  },

  /**
   * 清空最近打开的文件列表
   */
  clearRecentFiles: () => {
    ipcRenderer.send('recent:clear');
  },

  /**
   * 保存阅读进度
   * @param {Object} progress - 进度信息
   * @param {string} progress.path - 文件路径
   * @param {number} progress.lastPage - 最后阅读页码
   */
  saveProgress: (progress) => {
    ipcRenderer.send('progress:save', progress);
  },

  /**
   * 获取所有阅读进度
   * @returns {Promise<Object>} 进度映射表 {filePath: lastPage}
   */
  getAllProgress: () => {
    return ipcRenderer.invoke('progress:getAll');
  },

  /**
   * 保存应用设置
   * @param {Object} settings - 设置对象
   */
  saveSettings: (settings) => {
    ipcRenderer.send('settings:save', settings);
  },

  /**
   * 获取应用设置
   * @returns {Promise<Object>} 设置对象
   */
  getSettings: () => {
    return ipcRenderer.invoke('settings:get');
  }
});