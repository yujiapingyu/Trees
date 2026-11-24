#!/bin/zsh
cd -- "${0:A:h}" || exit 1
app_path="$HOME/Applications/知序.app"
if /bin/ps -axo comm= | /usr/bin/grep -Fqx "$app_path/Contents/MacOS/知序"; then
  print '知序仍在运行。请先保存未保存的内容，再按 ⌘Q 退出（只关闭窗口不会退出）。'
  print '退出后重新双击本文件即可更新，学生数据和配置会保留。'
  read '?按回车关闭'
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  print '从源码更新需要 Node.js。也可直接使用已打包的新版知序.app替换旧应用。'
  read '?按回车关闭'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci || { read '?依赖安装失败，按回车关闭'; exit 1; }
fi
print '正在根据当前项目代码构建并安装新版，旧应用会备份，原有数据保持不变……'
npm run install:mac || { read '?更新失败，按回车关闭'; exit 1; }
open "$app_path"
print '更新完成，知序已打开。可以关闭这个终端窗口。'
