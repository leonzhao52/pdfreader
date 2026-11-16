/**
 * main.js - Electron 主进程
 *
 * 职责：
 * 1. 创建应用窗口
 * 2. 管理应用生命周期
 * 3. 处理文件对话框（打开PDF）
 * 4. 维护最近文件列表
 * 5. 读写配置（通过 electron-store）
 *
 * 安全原则：
 * - contextIsolation: true（渲染进程与Node隔离）
 * - nodeIntegration: false（禁用渲染进程直接访问Node）
 * - 通过 preload.js 白名单暴露API
 */

const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

// 初始化本地存储
const store = new Store({
  defaults: {
    recentFiles: [],
    settings: {
      theme: 'light',
      zoom: 1.0,
      dualPage: false,
      sidebarVisible: true
    }
  }
});

// 保持对窗口对象的全局引用，避免被垃圾回收
let mainWindow = null;

/**
 * 创建主窗口
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'PDF 阅读器',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      // 安全配置
      contextIsolation: true,      // 启用上下文隔离
      nodeIntegration: false,      // 禁用Node集成
      preload: path.join(__dirname, 'preload.js'),  // 预加载脚本
      sandbox: false               // 允许PDF.js正常工作
    },
    show: false  // 先不显示，等ready-to-show事件
  });

  // 加载主界面
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 窗口准备好后显示，避免白屏
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // 开发模式下打开DevTools（可通过 --dev 参数启用）
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools();
    }
  });

  // 窗口关闭时清理引用
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 阻止默认标题，由渲染进程动态设置
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });
}

/**
 * 创建应用菜单
 */
function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开...',
          accelerator: 'Ctrl+O',
          click: () => openFile()
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'Alt+F4',
          role: 'quit'
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '全屏',
          accelerator: 'F11',
          click: () => {
            if (mainWindow) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          }
        },
        { type: 'separator' },
        {
          label: '重新加载',
          accelerator: 'Ctrl+R',
          role: 'reload'
        },
        {
          label: '开发者工具',
          accelerator: 'F12',
          role: 'toggleDevTools'
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: 'PDF 阅读器 v0.1.0',
              detail: '轻量级桌面PDF阅读器\n基于 Electron + PDF.js'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * 打开文件对话框并加载PDF
 */
async function openFile() {
  if (!mainWindow) return;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开 PDF 文件',
    filters: [
      { name: 'PDF 文件', extensions: ['pdf'] }
    ],
    properties: ['openFile']
  });

  // 用户取消选择
  if (result.canceled || result.filePaths.length === 0) {
    return;
  }

  const filePath = result.filePaths[0];
  await loadPdfFile(filePath);
}

/**
 * 加载PDF文件
 * @param {string} filePath - PDF文件绝对路径
 */
async function loadPdfFile(filePath) {
  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    dialog.showErrorBox('错误', '文件不存在或已被移动');
    return;
  }

  // 检查文件扩展名
  if (path.extname(filePath).toLowerCase() !== '.pdf') {
    dialog.showErrorBox('错误', '仅支持 PDF 文件');
    return;
  }

  // 发送给渲染进程
  mainWindow.webContents.send('pdf:load', { path: filePath });
}

/**
 * IPC 处理器注册
 */
function registerIpcHandlers() {
  // 打开文件对话框
  ipcMain.handle('dialog:openFile', async () => {
    await openFile();
  });

  // 添加到最近文件列表
  ipcMain.on('recent:add', (event, fileInfo) => {
    addRecentFile(fileInfo);
  });

  // 获取最近文件列表
  ipcMain.handle('recent:getAll', () => {
    return store.get('recentFiles');
  });

  // 清空最近文件列表
  ipcMain.on('recent:clear', () => {
    store.set('recentFiles', []);
  });

  // 保存阅读进度
  ipcMain.on('progress:save', (event, { path, lastPage }) => {
    updateProgress(path, lastPage);
  });

  // 获取所有阅读进度
  ipcMain.handle('progress:getAll', () => {
    const files = store.get('recentFiles');
    const progressMap = {};
    files.forEach(file => {
      progressMap[file.path] = file.lastPage;
    });
    return progressMap;
  });

  // 保存设置
  ipcMain.on('settings:save', (event, settings) => {
    store.set('settings', settings);
  });

  // 获取设置
  ipcMain.handle('settings:get', () => {
    return store.get('settings');
  });
}

/**
 * 添加文件到最近文件列表
 * @param {Object} fileInfo - 文件信息 {path, name, totalPages}
 */
function addRecentFile(fileInfo) {
  let recentFiles = store.get('recentFiles');

  // 如果文件已存在，先移除
  recentFiles = recentFiles.filter(f => f.path !== fileInfo.path);

  // 添加到列表开头
  recentFiles.unshift({
    path: fileInfo.path,
    name: fileInfo.name,
    lastPage: fileInfo.lastPage || 1,
    totalPages: fileInfo.totalPages || 0,
    lastOpened: Date.now()
  });

  // 限制最多20个
  if (recentFiles.length > 20) {
    recentFiles = recentFiles.slice(0, 20);
  }

  store.set('recentFiles', recentFiles);
}

/**
 * 更新阅读进度
 * @param {string} filePath - 文件路径
 * @param {number} lastPage - 最后阅读页码
 */
function updateProgress(filePath, lastPage) {
  const recentFiles = store.get('recentFiles');
  const index = recentFiles.findIndex(f => f.path === filePath);

  if (index !== -1) {
    recentFiles[index].lastPage = lastPage;
    recentFiles[index].lastOpened = Date.now();
    store.set('recentFiles', recentFiles);
  }
}

/**
 * 应用生命周期管理
 */

// 应用初始化完成
app.whenReady().then(() => {
  createWindow();
  createMenu();
  registerIpcHandlers();

  // macOS: 点击Dock图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时退出应用（Windows/Linux）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 导出给渲染进程使用的API（通过IPC）
// 注意：实际暴露通过 preload.js 完成