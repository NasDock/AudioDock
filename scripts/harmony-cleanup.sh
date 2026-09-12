#!/usr/bin/env bash
# scripts/harmony-cleanup.sh
#
# hvigor `assembleHap` 副作用清理（桌面小部件开发必备）。
#
# 现象：每次跑 `hvigorw ... assembleHap` 之后：
#   1. apps/harmony/build-profile.json5 的 compatibleSdkVersion 被降为 "6.0.0(20)"
#   2. 各子模块 BuildProfile.ets 被改成 BUILD_MODE_NAME='debug' / DEBUG=true
#   3. 偶尔产生 _tmp_* 空文件
#
# 这些副作用必须还原后再 git commit，否则会影响 dev/release 切换。
# 用法：
#   cd apps/harmony && env -u NODE_OPTIONS DEVECO_SDK_HOME="..." \
#     /Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw ... assembleHap
#   bash scripts/harmony-cleanup.sh
#
# 也可以 wrap 进 build 命令：
#   bash scripts/harmony-cleanup.sh && cd apps/harmony && hvigorw ... && \
#     bash scripts/harmony-cleanup.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

echo "[harmony-cleanup] 还原 hvigor 构建副作用..."

# 1. 还原被降 SDK 的 build-profile.json5
git checkout -- apps/harmony/build-profile.json5 2>/dev/null

# 2. 还原各子模块 BuildProfile.ets 的 debug 标记
git checkout -- \
  apps/harmony/common/audiodock_common/BuildProfile.ets \
  apps/harmony/features/i18n/BuildProfile.ets \
  apps/harmony/features/network/BuildProfile.ets \
  apps/harmony/features/player/BuildProfile.ets \
  apps/harmony/features/socket/BuildProfile.ets \
  apps/harmony/features/storage/BuildProfile.ets \
  apps/harmony/features/ui/BuildProfile.ets 2>/dev/null

# 3. 清理 _tmp_* 临时文件
find apps/harmony -name "_tmp_*" -type f -delete 2>/dev/null
true

# 4. 检查是否还有意外改动（提示用户）
remaining=$(git status --short apps/harmony/ 2>/dev/null | grep -E "BuildProfile\.ets|build-profile\.json5" | wc -l | tr -d ' ')
if [ "${remaining}" != "0" ]; then
  echo "[harmony-cleanup] ⚠️ 仍有未还原的 BuildProfile 改动："
  git status --short apps/harmony/ | grep -E "BuildProfile\.ets|build-profile\.json5"
  exit 1
fi

echo "[harmony-cleanup] ✅ 干净（working tree 没有意外的 BuildProfile 改动）"