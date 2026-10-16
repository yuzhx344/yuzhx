# 帧序 FrameFlow 2.0 交付下载

本分支用于提供已验收的在线部署包与离线包，不改动 main 分支。

## 下载

- [下载在线部署 ZIP](https://github.com/yuzhx344/yuzhx/raw/refs/heads/frameflow-delivery-20261016/FrameFlow-online.zip)
- [下载离线 ZIP](https://github.com/yuzhx344/yuzhx/raw/refs/heads/frameflow-delivery-20261016/FrameFlow-offline.zip)

若仓库为私有，请先登录有访问权限的 GitHub 账号。也可打开 ZIP 文件页面后点击 Download raw file。

## 使用

在线包：解压后阅读 README.md，包含 Python 应用源码、HTTPS Docker 部署配置、测试和验收报告。首个注册账号为管理员，其余成员通过邀请码加入。此包没有预置账号或业务数据，也没有发布公网网站。

离线包：解压后打开“帧序-离线视频评测.html”。无需安装依赖；数据和导入视频保存在当前浏览器，支持完整备份。离线版不跨电脑实时同步。若公司策略限制本地 HTML 或浏览器存储，请由公司确认目标机器允许使用。

线上业务 JSON 不含素材二进制，完整迁移请按包内手册备份数据目录。详细验证结果和适用范围见在线包的“验收报告.md”。

SHA-256 校验值见 [SHA256SUMS.txt](SHA256SUMS.txt)。包内视频测试图案由项目生成，不是真实客户素材。

## 无需解压的在线启动文件

- [Windows 单文件启动器 FrameFlow-Online.cmd](https://github.com/yuzhx344/yuzhx/blob/frameflow-delivery-20261016/FrameFlow-Online.cmd)：打开文件页，点击右上角 Download raw file 下载，安装 Python 3.12+ 后双击运行。
- [通用 Python 单文件启动器 FrameFlow-Online.py](https://github.com/yuzhx344/yuzhx/blob/frameflow-delivery-20261016/FrameFlow-Online.py)：下载后可用 Python 打开，或执行 `python FrameFlow-Online.py`。

启动器首次在旁边创建 FrameFlow-online 目录，展开应用并自动打开浏览器；以后重复启动保留本机数据。请保持运行窗口打开，Ctrl+C 停止。需要先安装 Python 3.12 或更新版本，无需安装第三方 Python 包。

这是本机启动方式，默认只允许本机访问。公司多人在线协作仍需依照包内 README 部署到公司服务器；这些文件不会自动发布公网。

Python 启动器已实际验证 HTTP 启动、注册、重复启动的数据保留和修改保护。Windows CMD 包装内嵌同一 Python 源码，已验证提取命令、参数和内容一致性；本环境没有 Windows，未做 Windows 实机验收。
