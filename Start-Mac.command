#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "请先在打开的官网安装 Node.js 24 或以上版本，然后重新双击本文件。"
  open "https://nodejs.org/zh-cn/download"
  read -r -p "按回车键关闭此窗口…"
  exit 1
fi
node scripts/open-local.mjs
read -r -p "按回车键关闭此窗口…"
