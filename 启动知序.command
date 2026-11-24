#!/bin/zsh
cd -- "${0:A:h}" || exit 1
app_path="$HOME/Applications/知序.app"
if [[ -d "$app_path" ]]; then
  open "$app_path"
  exit $?
fi
if ! command -v npm >/dev/null 2>&1; then
  print '请先安装 Node.js 24 LTS，然后重新运行。'
  read '?按回车退出'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm install || exit 1
fi
npm run install:mac || exit 1
open "$app_path"
