# FleetOps 车辆异常管理平台

面向企业内部团队的 Web 应用。首页、异常详情、车辆档案、运营分析、设置中心采用统一的后台布局，以 1440 × 900 为设计基准。

应用使用 Node.js + Express 提供服务，SQLite 保存业务数据；Vite 构建浏览器界面。初次运行数据库为空，由管理员创建工作空间，再登记车辆和异常。所有自动化测试只使用虚构车辆、人员和事件。

## 在自己的电脑上打开

下载部署 ZIP 包并完整解压，在解压后的 fleetops 文件夹中：

- **Windows**：双击 Start-Windows.cmd。
- **Mac**：双击 Start-Mac.command。

首次使用需要安装 Node.js 24 或以上版本。电脑尚未安装时，启动入口会打开官方安装页面；安装完成后重新双击入口即可。首次启动自动安装运行组件，需要联网，请等待安装完成。随后浏览器自动打开网站，创建工作空间和管理员账号即可使用。

请保持启动窗口运行；关闭窗口后本机网站服务停止，数据仍保存在 var/fleetops.sqlite。默认访问地址为 http://localhost:3000；端口已占用时会使用后续空闲端口，并在窗口中显示地址。本机启动仅供这台电脑访问；团队共享网址需要按下文部署到企业服务器。手机需通过已经部署的服务器网址访问。

如果系统限制双击启动，可以在该文件夹的终端执行 npm run open。

## 已实现的业务流程

- **首页**：左侧导航、异常统计、六类异常卡片，支持状态、时间范围和关键词筛选。六类为动力、电池温度、制动、胎压、通信、能耗。
- **异常详情**：实际请求加载状态、发现时间线、可能原因、人工诊断结果、处理方案、当前状态与负责人。
- **四步蛇形流程**：问题发现 → 原因分析 → 处理执行 → 结果确认。前两步从左向右，后两步从右向左；填写说明、记录诊断和处理后读数，人工核验后归档。
- **状态联动**：受理进入处理中，确认归档进入已完成；首页卡片、统计、事件列表和分析使用同一份服务器数据。
- **车辆与事件录入**：独立车辆档案，支持车辆编辑、单条异常录入及最多 200 条 CSV 原子导入。下载的模板只有表头。
- **团队协作**：管理员分派负责人，负责人推进任务，成员添加备注；每条记录保存实际操作者和服务器时间。草稿仅当前账号可见。
- **账号与权限**：首次创建管理员，管理员增加成员及调整角色、停用账号；个人修改密码、退出登录、保存偏好。
- **导出与备份**：事件 CSV、完整处理报告、管理员业务 JSON 导出、数据库一致性备份和恢复脚本。

| 角色 | 查看车辆与事件 | 登记车辆与异常 | 推进流程 | 管理成员与分派 |
| --- | --- | --- | --- | --- |
| 管理员 | 是 | 是 | 全部未归档事件 | 是 |
| 处理人员 | 是 | 是 | 自己负责或认领未分派事件 | 否 |
| 只读人员 | 是 | 否 | 否 | 否 |

权限由服务端校验。事件和车辆使用版本检查防止旧记录覆盖新记录；遇到冲突会保留当前表单并提示重新核对。页面每 15 秒检查工作空间变更，编辑表单时暂停自动刷新。断网或保存失败不会显示成功。

## 本地运行

需要 **Node.js 24 或更新版本**、npm。无需另外安装 SQLite 服务。

```bash
npm ci
npm run dev
```

打开 http://localhost:3000，首次创建工作空间和管理员。后端监听本机 3001，Vite 将 /api 请求代理到后端。业务数据保存在 var/fleetops.sqlite，数据库及账号不会提交到版本库。

构建后运行：

```bash
npm run build
npm start
```

本地 HTTP 模式仅用于本机开发验证。生产运行请使用下面的 HTTPS 部署配置。页面需要后台服务，不能作为离线 HTML 使用。

## 企业服务器部署：Docker Compose

部署包已包含 Dockerfile、Compose、Caddy HTTPS 网关、备份／恢复脚本及 Linux 服务模板。默认采用单实例应用与独立持久化卷。

1. 服务器安装 Docker Engine 与 Docker Compose v2。
2. 准备企业域名，将 DNS 指向服务器；公网证书方式需要域名可验证且 80/443 端口可达。仅内网域名或企业证书使用现有企业 HTTPS 网关，并参考下节。
3. 解压部署包进入目录，执行以下命令，将 fleet.company.com 换成实际域名：

```bash
node scripts/init-deploy.mjs fleet.company.com
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

初始化脚本需要主机 Node.js 24；如果主机只有 Docker，可改用：

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:24-bookworm-slim node scripts/init-deploy.mjs fleet.company.com
```

脚本生成 deploy/.env 和 deploy/secrets/setup-token.txt，不会覆盖已有配置。令牌目录权限为 0700；令牌文件在容器内需由非 root 应用读取。首次打开 https://你的域名，输入令牌并创建管理员。请通过服务器上的编辑器查看令牌，不要发送到聊天、日志或版本库。完成初始化后接口拒绝再次创建工作空间。

添加团队账号：**设置中心 → 团队成员 → 添加成员**，通过企业安全渠道交付初始密码，成员登录后可自行修改密码。没有预设账号或统一默认密码。

外部只开放网关 80/443；后端 3000 不映射到宿主机。网关自动签发和续期证书，数据库保存在 fleetops_data 卷，网关证书保存在 caddy_data 卷。关闭服务保留卷：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml down
```

不要使用 down -v，它会删除数据卷。更新版本前先备份，再重新执行 up -d --build。跨数据库版本升级需按相应版本发布说明执行。

## 企业服务器部署：Linux / 现有 HTTPS 网关

服务器安装 Node.js 24，创建专用 fleetops 用户，将代码放入 /opt/fleetops：

```bash
npm ci
npm run build
```

配置 /etc/fleetops.env，字段参考 deploy/node.env.example；设置真实 HTTPS 域名的 APP_ORIGIN、APP_HOST=127.0.0.1、TRUST_PROXY=1。使用企业网关将该域名代理到 127.0.0.1:3000，正确传递 Host 与 X-Forwarded-Proto；不要让客户端直接访问后端端口。

管理员在服务器生成初始化令牌文件，并让 fleetops 用户可读：

```bash
sudo install -d -m 750 -o root -g fleetops /etc/fleetops
sudo sh -c 'umask 027; openssl rand -hex 32 > /etc/fleetops/setup-token.txt'
sudo chown root:fleetops /etc/fleetops/setup-token.txt
sudo chmod 640 /etc/fleetops/setup-token.txt
sudo install -d -m 700 -o fleetops -g fleetops /opt/fleetops/var
sudo chmod 755 /opt/fleetops
```

将 deploy/fleetops.service 安装到 /etc/systemd/system/fleetops.service。确认 ExecStart 中的 node 路径与服务器实际安装路径一致，再运行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fleetops
sudo systemctl status fleetops
```

首次初始化和团队账号操作与 Docker 方式相同。

## 录入与使用

1. **车辆档案 → 添加车辆**，填写唯一编号、运营组、车型、能源类型及登记里程。
2. **异常概览 → 新增异常**，选车辆、六类异常之一、风险等级、发现时间和描述；可补充指标、读数、单位及正常区间。
3. 点击卡片进入最近的匹配事件；点击“查看列表”查看该类型全部事件。列表提供分类、风险、负责人、状态、搜索、排序及分页。
4. 管理员分派负责人，或处理人员认领未分派事件。受理后填写原因、诊断和方案，执行后记录结果，最后勾选人工核验并确认归档。
5. 在“处理记录”页添加协作备注；完成后下载完整报告。已归档的流程不可再推进，补充说明可使用协作备注。

CSV 表头：

```csv
车辆编号,异常分类,风险等级,异常描述,指标名称,发现读数,单位,正常区间,发现时间
```

前四项必填。异常分类使用页面完整名称或 power / temperature / brake / tire / connection / energy。风险等级填写高风险、中风险或低风险；描述至少 6 字。发现时间可留空，或使用带时区的 ISO 时间。车辆必须已登记；导入预览和服务器均会校验，任一条无效则全部不写入，相同请求重试不会重复导入。

## 备份、恢复与账号恢复

数据库备份包含账号密码散列、会话、业务数据与操作审计，请按企业数据管理要求保管；界面 JSON 导出不能代替完整数据库备份。

Docker 备份（命令从项目根目录执行）：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml exec app node scripts/backup.mjs /app/var/backups/latest.sqlite
mkdir -p deploy/backups
docker compose --env-file deploy/.env -f deploy/compose.yaml cp app:/app/var/backups/latest.sqlite deploy/backups/latest.sqlite
```

备份目标不能覆盖已存在文件；日常备份建议使用日期文件名，并将副本保存到另一台服务器或企业备份系统。VACUUM INTO 在应用运行时生成一致性备份，不能只复制正在写入的 SQLite 主文件。

Docker 恢复：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml stop app
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps -v "$PWD/deploy/backups:/restore:ro" --entrypoint node app scripts/restore.mjs --service-stopped /restore/latest.sqlite
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
```

恢复脚本验证文件完整性与版本、保留恢复前数据库，再替换数据；恢复后所有会话失效，需要重新登录。必须先停止应用，不能在运行中恢复。

Linux 备份：使用应用用户运行 npm run backup -- /备份目录/日期.sqlite；恢复前停止 systemd 服务，再以应用用户运行 node scripts/restore.mjs --service-stopped /备份路径，最后启动服务。

忘记密码时，由有服务器维护权限的管理员在终端运行；密码隐藏输入，不使用命令参数：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml exec app node scripts/reset-password.mjs 成员邮箱
```

Linux 方式运行 node scripts/reset-password.mjs 成员邮箱，需以有数据库访问权限的维护用户执行。重置后撤销该成员全部会话并记录恢复操作。

## 运行配置与健康检查

| 变量 | 用途 |
| --- | --- |
| NODE_ENV | production 时启用生产配置与 Secure 会话 Cookie |
| APP_ORIGIN | 生产访问地址，必须使用 https://，不带结尾斜杠 |
| APP_HOST / APP_PORT | 监听地址与端口 |
| TRUST_PROXY | 可信 HTTPS 网关后设置为 1；后端必须限制直连 |
| FLEETOPS_DB | 本地磁盘数据库路径 |
| FLEETOPS_SETUP_TOKEN_FILE | 首次初始化令牌文件路径 |

健康检查 GET /api/health 返回数据库可用状态；会话有效期 8 小时。密码使用随机盐 scrypt 散列；会话 Cookie 为 HttpOnly / SameSite=Strict，写请求进行 CSRF 和来源检查。操作审计表禁止应用层更新与删除。

当前版本用于单企业工作空间、单应用实例的内部协作，数据库应放在本地持久化磁盘。前端加载该工作空间的事件记录；超大车队、多实例或高可用部署需扩展服务器分页和数据库架构。目前提供人工录入和 CSV 导入，尚未接入企业 SSO、车辆遥测、企业通知或第三方业务系统；页面不会生成检测读数或自动诊断结论。

## 验证

```bash
npm test
npm run test:e2e
```

后端覆盖认证、生产初始化令牌、角色权限、四步流转、审计约束、版本冲突、重启持久化、导入原子性和会话撤销。浏览器覆盖首页 → 加载 → 详情 → 四步闭环 → 数量更新、不同浏览器账号共享数据、只读权限、网络失败保留输入、CSV 和 HTML 转义。浏览器测试优先使用 /usr/bin/chromium，也可配置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH 或安装 Playwright Chromium。

## 目录

- src/：页面、样式、分类定义、API 请求。
- server/：认证、权限、业务接口、数据库迁移。
- tests/：后端和浏览器测试，独立临时数据库。
- scripts/：开发启动、部署初始化、备份、恢复、密码恢复。
- deploy/：Docker Compose、HTTPS 网关及 Linux 服务配置。
- dist/：npm run build 生成的浏览器资源。
